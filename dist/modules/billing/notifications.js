"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAppleNotification = handleAppleNotification;
exports.handleGoogleNotification = handleGoogleNotification;
const jws_1 = require("./jws");
const util_1 = require("../util");
/* ── Apple ─────────────────────────────────────────────────────────────── */
/**
 * Handle one App Store Server Notification (v2).
 *
 * Apple retries for up to three days, so this must be idempotent — it is,
 * through `notificationUUID`.
 */
async function handleAppleNotification(options) {
    const { billing, apple, signedPayload } = options;
    if (typeof signedPayload !== 'string' || signedPayload === '') {
        throw new Error('handleAppleNotification: "signedPayload" is required.');
    }
    const payload = (0, jws_1.decodeJwsPayloadUnverified)(signedPayload);
    const notificationType = String(payload.notificationType ?? 'UNKNOWN');
    const subtype = payload.subtype ? `.${payload.subtype}` : '';
    const eventId = String(payload.notificationUUID ?? '');
    const data = (payload.data ?? {});
    const transaction = typeof data.signedTransactionInfo === 'string'
        ? (0, jws_1.decodeJwsPayloadUnverified)(data.signedTransactionInfo)
        : {};
    const originalTransactionId = typeof transaction.originalTransactionId === 'string'
        ? transaction.originalTransactionId
        : null;
    const transactionId = typeof transaction.transactionId === 'string' ? transaction.transactionId : null;
    const base = {
        platform: 'apple',
        notificationType: `${notificationType}${subtype}`,
        originalTransactionId,
    };
    const recorded = await billing.recordEvent({
        platform: 'apple',
        notificationType: base.notificationType,
        originalTransactionId,
        eventId: eventId || `apple:${transactionId ?? (0, util_1.generateId)()}`,
        payload: payload,
    });
    if (!recorded)
        return { ...base, handled: false, reason: 'duplicate' };
    // Apple's own connectivity check. It names no purchase by design.
    if (notificationType === 'TEST')
        return { ...base, handled: true, reason: 'test' };
    const owner = originalTransactionId
        ? await findOwner(billing, 'apple', originalTransactionId)
        : null;
    if (!owner || !transactionId) {
        // A purchase this backend never recorded — someone else's app sharing an
        // Apple team, or a notification that arrived before the client verified.
        // Nothing to update, and inventing a user here would be worse than
        // waiting for the client to verify normally.
        return { ...base, handled: true, reason: 'unknown_purchase' };
    }
    const verified = await apple.verify({ userId: owner, transactionId });
    const purchase = await billing.recordPurchase(verified);
    return { ...base, handled: true, purchase };
}
/* ── Google ────────────────────────────────────────────────────────────── */
/**
 * Handle one Real-time Developer Notification, delivered as a Pub/Sub push.
 *
 * Pub/Sub redelivers on any non-2xx, and at-least-once even without one —
 * so `messageId` is the replay key.
 */
async function handleGoogleNotification(options) {
    const { billing, google, body } = options;
    const message = (body?.message ?? {});
    const encoded = message.data;
    if (typeof encoded !== 'string' || encoded === '') {
        throw new Error('handleGoogleNotification: body.message.data is required.');
    }
    const notification = decodeBase64Json(encoded);
    const subscription = (notification.subscriptionNotification ?? {});
    const oneTime = (notification.oneTimeProductNotification ?? {});
    const isTest = Boolean(notification.testNotification);
    const purchaseToken = typeof subscription.purchaseToken === 'string'
        ? subscription.purchaseToken
        : typeof oneTime.purchaseToken === 'string'
            ? oneTime.purchaseToken
            : null;
    const productId = typeof subscription.subscriptionId === 'string'
        ? subscription.subscriptionId
        : typeof oneTime.sku === 'string'
            ? oneTime.sku
            : null;
    const typeCode = Number(subscription.notificationType ?? oneTime.notificationType ?? 0);
    const notificationType = isTest
        ? 'TEST'
        : (GOOGLE_NOTIFICATION_TYPES[typeCode] ?? `UNKNOWN_${typeCode}`);
    const base = {
        platform: 'google',
        notificationType,
        originalTransactionId: purchaseToken,
    };
    const recorded = await billing.recordEvent({
        platform: 'google',
        notificationType,
        originalTransactionId: purchaseToken,
        eventId: String(message.messageId ?? `google:${purchaseToken ?? (0, util_1.generateId)()}`),
        payload: notification,
    });
    if (!recorded)
        return { ...base, handled: false, reason: 'duplicate' };
    if (isTest)
        return { ...base, handled: true, reason: 'test' };
    if (!purchaseToken || !productId)
        return { ...base, handled: true, reason: 'unsupported' };
    const owner = await findOwner(billing, 'google', purchaseToken);
    if (!owner)
        return { ...base, handled: true, reason: 'unknown_purchase' };
    const verified = await google.verify({
        userId: owner,
        productId,
        purchaseToken,
        kind: notification.oneTimeProductNotification ? 'product' : 'subscription',
    });
    const purchase = await billing.recordPurchase(verified);
    return { ...base, handled: true, purchase };
}
/**
 * Play's numeric notification types. Names only — the STATE always comes
 * from re-reading the purchase, so a type this table does not know is
 * harmless.
 */
const GOOGLE_NOTIFICATION_TYPES = {
    1: 'SUBSCRIPTION_RECOVERED',
    2: 'SUBSCRIPTION_RENEWED',
    3: 'SUBSCRIPTION_CANCELED',
    4: 'SUBSCRIPTION_PURCHASED',
    5: 'SUBSCRIPTION_ON_HOLD',
    6: 'SUBSCRIPTION_IN_GRACE_PERIOD',
    7: 'SUBSCRIPTION_RESTARTED',
    8: 'SUBSCRIPTION_PRICE_CHANGE_CONFIRMED',
    9: 'SUBSCRIPTION_DEFERRED',
    10: 'SUBSCRIPTION_PAUSED',
    11: 'SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED',
    12: 'SUBSCRIPTION_REVOKED',
    13: 'SUBSCRIPTION_EXPIRED',
    20: 'SUBSCRIPTION_PENDING_PURCHASE_CANCELED',
};
/* ── shared ────────────────────────────────────────────────────────────── */
/**
 * Which user owns this transaction chain.
 *
 * Notifications never carry a user id — the store has no idea who your
 * users are. The chain was bound to an account when the client verified the
 * original purchase, so that binding is the only source of ownership here.
 */
async function findOwner(billing, platform, originalTransactionId) {
    const purchase = await billing.findPurchase(platform, originalTransactionId);
    return purchase?.user_id ?? null;
}
function decodeBase64Json(encoded) {
    const text = new TextDecoder().decode((0, jws_1.base64UrlToBytes)(encoded.replace(/\+/g, '-').replace(/\//g, '_')));
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('handleGoogleNotification: message.data is not a JSON object.');
    }
    return parsed;
}
//# sourceMappingURL=notifications.js.map