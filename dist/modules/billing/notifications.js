"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAppleNotification = handleAppleNotification;
exports.handleGoogleNotification = handleGoogleNotification;
const jws_1 = require("./jws");
const util_1 = require("../util");
const offers_1 = require("./offers");
const x509_1 = require("./x509");
const pubsub_1 = require("./pubsub");
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
    if (options.verifySignature) {
        try {
            await (0, x509_1.verifyJwsX5c)(signedPayload, options.verifySignature === true ? {} : options.verifySignature);
        }
        catch {
            const claimed = safeAppleType(signedPayload);
            return { handled: false, platform: 'apple', notificationType: claimed, originalTransactionId: null, reason: 'invalid_signature' };
        }
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
    let owner = originalTransactionId
        ? await findOwner(billing, 'apple', originalTransactionId)
        : null;
    let ownerFrom = owner ? 'chain' : undefined;
    if (!owner && transactionId && options.resolveAccount) {
        // Not verified by any account yet. The app said who was buying when it
        // bought (appAccountToken); the app's resolver decides if that is a user.
        const token = typeof transaction.appAccountToken === 'string' ? transaction.appAccountToken : '';
        owner = token ? await options.resolveAccount(token, 'apple') : null;
        if (owner)
            ownerFrom = 'account_token';
    }
    if (!owner || !transactionId) {
        // A purchase this backend never recorded — someone else's app sharing an
        // Apple team, or a notification that arrived before the client verified
        // with no account token to go on. Nothing to update, and inventing a user
        // here would be worse than waiting for the client to verify normally.
        return { ...base, handled: true, reason: 'unknown_purchase' };
    }
    const before = originalTransactionId ? await billing.findPurchase('apple', originalTransactionId) : null;
    const verified = await apple.verify({ userId: owner, transactionId });
    const purchase = await billing.recordPurchase(verified);
    return { ...base, handled: true, purchase, ownerFrom, event: (0, offers_1.classifyPurchaseChange)(before, purchase) };
}
/** The notification type a payload claims, for the log line of a refused one. */
function safeAppleType(signedPayload) {
    try {
        return String((0, jws_1.decodeJwsPayloadUnverified)(signedPayload).notificationType ?? 'UNKNOWN');
    }
    catch {
        return 'UNREADABLE';
    }
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
    if (options.verifyPubSub) {
        try {
            await (0, pubsub_1.verifyPubSubToken)(options.verifyPubSub.authorization, options.verifyPubSub);
        }
        catch {
            return { handled: false, platform: 'google', notificationType: 'UNVERIFIED', originalTransactionId: null, reason: 'invalid_signature' };
        }
    }
    const message = (body?.message ?? {});
    const encoded = message.data;
    if (typeof encoded !== 'string' || encoded === '') {
        throw new Error('handleGoogleNotification: body.message.data is required.');
    }
    const notification = decodeBase64Json(encoded);
    if (notification.voidedPurchaseNotification) {
        return handleGoogleVoided(billing, google, notification, String(message.messageId ?? ''));
    }
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
    const kind = notification.oneTimeProductNotification ? 'product' : 'subscription';
    const owner = await findOwner(billing, 'google', purchaseToken);
    if (owner) {
        const before = await billing.findPurchase('google', purchaseToken);
        const verified = await google.verify({ userId: owner, productId, purchaseToken, kind });
        const purchase = await billing.recordPurchase(verified);
        return { ...base, handled: true, purchase, ownerFrom: 'chain', event: (0, offers_1.classifyPurchaseChange)(before, purchase) };
    }
    // Not verified by any account yet: read it from Play (the RTDN carries no
    // account). Two ways it can still be someone's:
    //   - a plan switch or resubscribe: Play issued a NEW token whose
    //     linkedPurchaseToken is the chain a user already owns;
    //   - the app's resolver maps the purchase's obfuscatedAccountId.
    const fetched = await google.verify({ userId: UNRESOLVED, productId, purchaseToken, kind });
    const linked = typeof fetched.raw?.linkedPurchaseToken === 'string' ? fetched.raw.linkedPurchaseToken : null;
    const linkedOwner = linked ? await findOwner(billing, 'google', linked) : null;
    if (linkedOwner) {
        const purchase = await billing.recordPurchase({ ...fetched, userId: linkedOwner });
        return { ...base, handled: true, purchase, ownerFrom: 'linked_chain', event: (0, offers_1.classifyPurchaseChange)(null, purchase) };
    }
    if (!options.resolveAccount)
        return { ...base, handled: true, reason: 'unknown_purchase' };
    const token = playAccountToken(fetched.raw);
    const resolved = token ? await options.resolveAccount(token, 'google') : null;
    if (!resolved)
        return { ...base, handled: true, reason: 'unknown_purchase' };
    const purchase = await billing.recordPurchase({ ...fetched, userId: resolved });
    return { ...base, handled: true, purchase, ownerFrom: 'account_token', event: (0, offers_1.classifyPurchaseChange)(null, purchase) };
}
/**
 * A refund or chargeback (Play "voided purchase"). It names the token but not
 * the product, and it is still only a trigger: the purchase this backend
 * already recorded is re-read from Play and Play's answer is stored — a
 * revoked subscription comes back expired, a voided one-time product
 * cancelled, and access stops. A token nobody recorded changes nothing.
 */
async function handleGoogleVoided(billing, google, notification, messageId) {
    const voided = (notification.voidedPurchaseNotification ?? {});
    const purchaseToken = typeof voided.purchaseToken === 'string' ? voided.purchaseToken : null;
    // productType 1 = subscription, 2 = one-time product (Play's enum).
    const kind = Number(voided.productType) === 2 ? 'product' : 'subscription';
    const base = { platform: 'google', notificationType: 'VOIDED_PURCHASE', originalTransactionId: purchaseToken };
    const recorded = await billing.recordEvent({
        platform: 'google',
        notificationType: base.notificationType,
        originalTransactionId: purchaseToken,
        eventId: messageId || `google:voided:${purchaseToken ?? (0, util_1.generateId)()}`,
        payload: notification,
    });
    if (!recorded)
        return { ...base, handled: false, reason: 'duplicate' };
    if (!purchaseToken)
        return { ...base, handled: true, reason: 'unsupported' };
    const known = await billing.findPurchase('google', purchaseToken);
    if (!known)
        return { ...base, handled: true, reason: 'unknown_purchase' };
    const verified = await google.verify({ userId: known.user_id, productId: known.product_id, purchaseToken, kind });
    const purchase = await billing.recordPurchase(verified);
    return { ...base, handled: true, purchase, ownerFrom: 'chain', event: (0, offers_1.classifyPurchaseChange)(known, purchase) };
}
/** Placeholder owner while a Play purchase is read before its account is known. Never recorded. */
const UNRESOLVED = '__unresolved__';
/** Play's obfuscatedAccountId, as subscriptionsv2 and products return it. */
function playAccountToken(raw) {
    const ids = (raw?.externalAccountIdentifiers ?? {});
    const token = ids.obfuscatedExternalAccountId ?? raw?.obfuscatedExternalAccountId;
    return typeof token === 'string' && token !== '' ? token : null;
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