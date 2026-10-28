import { AppleStore } from './apple';
import { BillingClient } from './billing-client';
import { GoogleStore } from './google';
import { base64UrlToBytes, decodeJwsPayloadUnverified } from './jws';
import { generateId } from '../util';
import { BillingPlatform, Purchase } from './types';
import { classifyPurchaseChange, type PurchaseEvent } from './offers';
import { verifyJwsX5c, type VerifyX5cOptions } from './x509';
import { verifyPubSubToken, type VerifyPubSubOptions } from './pubsub';

/**
 * Server notifications from Apple and Google.
 *
 * Verification at purchase time answers "did they pay?" once. Everything
 * that happens AFTERWARDS — renewals, cancellations, refunds, failed cards,
 * family-sharing revocations — happens while the app is closed, and the
 * only way to hear about it is these notifications. An app without them
 * shows premium to people who refunded months ago and locks out people
 * whose subscription renewed fine.
 *
 * THE DESIGN DECISION, because it drives everything else here:
 *
 *   A notification is a TRIGGER, never a source of truth.
 *
 * The body is used only to learn WHICH purchase changed. The new state is
 * then read back from the store's own API over TLS, exactly as at purchase
 * time. So a forged notification cannot grant anything — the worst it can
 * do is make the server perform one redundant lookup, and if it names a
 * purchase we have never seen, nothing happens at all.
 *
 * That is a deliberate alternative to verifying Apple's JWS certificate
 * chain in-process. Chain validation is worth adding as a second layer, but
 * as the ONLY layer it is a single subtle bug away from accepting forged
 * state, and it cannot protect against a replayed genuine notification at
 * all. Re-reading from the store is immune to both.
 *
 * Replay is handled separately: every notification carries the store's own
 * id, recorded in `billing__events` under a unique index, so a redelivery
 * is a no-op.
 */

/** What a notification did, for the caller's logs and the HTTP response. */
export interface NotificationResult {
  /** False when this notification id had already been processed. */
  handled: boolean;
  platform: BillingPlatform;
  notificationType: string;
  /** The chain the notification concerned, when it named one. */
  originalTransactionId: string | null;
  /** Why nothing happened, when `handled` is false or no purchase changed. */
  reason?: 'duplicate' | 'unknown_purchase' | 'test' | 'unsupported' | 'invalid_signature';
  /** The refreshed purchase, when one was re-verified. */
  purchase?: Purchase;
  /**
   * What changed, the same words for both stores (`classifyPurchaseChange`):
   * trial_started, trial_converted, renewed, cancelled, expired, refunded…
   * Set whenever `purchase` is.
   */
  event?: PurchaseEvent;
  /**
   * How the owner was found: an earlier verify of this chain, the chain it
   * replaced (Play linkedPurchaseToken), or the purchase's account token.
   */
  ownerFrom?: 'chain' | 'linked_chain' | 'account_token';
}

/**
 * Map the account token the app attached at purchase time to one of YOUR
 * users, or null when it is not one.
 *
 * The app passes it to the store when buying — StoreKit `appAccountToken`
 * (must be a UUID) and Play `obfuscatedAccountId` — and the store hands it
 * back on every transaction of that chain. It lets a notification find its
 * owner when it arrives BEFORE the app's own `/billing/verify` (the app was
 * killed mid-purchase, the network dropped), instead of answering
 * `unknown_purchase` until the customer taps Restore.
 *
 * Opt-in, and it must CHECK the token: the simplest correct implementation
 * looks the id up — `async (t) => (await users.exists(t)) ? t : null`.
 */
export type ResolveAccount = (token: string, platform: BillingPlatform) => Promise<string | null> | string | null;

export interface AppleNotificationOptions {
  billing: BillingClient;
  apple: AppleStore;
  /** The raw `signedPayload` string from Apple's POST body. */
  signedPayload: string;
  /** Resolve a chain no account has verified yet through its appAccountToken. */
  resolveAccount?: ResolveAccount;
  /**
   * Check the JWS certificate chain (x5c → Apple Root CA - G3) before doing
   * anything. `true` pins Apple's root; pass options to pin others (tests).
   * A failed check answers `{ handled: false, reason: 'invalid_signature' }`
   * and records nothing. Off by default: the store re-read already makes a
   * forged notification harmless; this also keeps it out of the event log.
   */
  verifySignature?: boolean | VerifyX5cOptions;
}

export interface GoogleNotificationOptions {
  billing: BillingClient;
  google: GoogleStore;
  /** The decoded Pub/Sub push body: `{ message: { data, messageId } }`. */
  body: Record<string, unknown>;
  /** Resolve a token no account has verified yet through its obfuscatedAccountId. */
  resolveAccount?: ResolveAccount;
  /**
   * Check the Pub/Sub push's OIDC token before doing anything: pass the
   * request's `Authorization` header and what to expect. A failed check
   * answers `{ handled: false, reason: 'invalid_signature' }` and records
   * nothing. Off when omitted.
   */
  verifyPubSub?: VerifyPubSubOptions & { authorization: string | null | undefined };
}

/* ── Apple ─────────────────────────────────────────────────────────────── */

/**
 * Handle one App Store Server Notification (v2).
 *
 * Apple retries for up to three days, so this must be idempotent — it is,
 * through `notificationUUID`.
 */
export async function handleAppleNotification(
  options: AppleNotificationOptions,
): Promise<NotificationResult> {
  const { billing, apple, signedPayload } = options;
  if (typeof signedPayload !== 'string' || signedPayload === '') {
    throw new Error('handleAppleNotification: "signedPayload" is required.');
  }

  if (options.verifySignature) {
    try {
      await verifyJwsX5c(signedPayload, options.verifySignature === true ? {} : options.verifySignature);
    } catch {
      const claimed = safeAppleType(signedPayload);
      return { handled: false, platform: 'apple', notificationType: claimed, originalTransactionId: null, reason: 'invalid_signature' };
    }
  }
  const payload = decodeJwsPayloadUnverified<AppleNotificationPayload>(signedPayload);
  const notificationType = String(payload.notificationType ?? 'UNKNOWN');
  const subtype = payload.subtype ? `.${payload.subtype}` : '';
  const eventId = String(payload.notificationUUID ?? '');
  const data = (payload.data ?? {}) as Record<string, unknown>;

  const transaction =
    typeof data.signedTransactionInfo === 'string'
      ? decodeJwsPayloadUnverified<Record<string, unknown>>(data.signedTransactionInfo)
      : {};
  const originalTransactionId =
    typeof transaction.originalTransactionId === 'string'
      ? transaction.originalTransactionId
      : null;
  const transactionId =
    typeof transaction.transactionId === 'string' ? transaction.transactionId : null;

  const base = {
    platform: 'apple' as const,
    notificationType: `${notificationType}${subtype}`,
    originalTransactionId,
  };

  const recorded = await billing.recordEvent({
    platform: 'apple',
    notificationType: base.notificationType,
    originalTransactionId,
    eventId: eventId || `apple:${transactionId ?? generateId()}`,
    payload: payload as unknown as Record<string, unknown>,
  });
  if (!recorded) return { ...base, handled: false, reason: 'duplicate' };

  // Apple's own connectivity check. It names no purchase by design.
  if (notificationType === 'TEST') return { ...base, handled: true, reason: 'test' };

  let owner = originalTransactionId
    ? await findOwner(billing, 'apple', originalTransactionId)
    : null;
  let ownerFrom: NotificationResult['ownerFrom'] = owner ? 'chain' : undefined;
  if (!owner && transactionId && options.resolveAccount) {
    // Not verified by any account yet. The app said who was buying when it
    // bought (appAccountToken); the app's resolver decides if that is a user.
    const token = typeof transaction.appAccountToken === 'string' ? transaction.appAccountToken : '';
    owner = token ? await options.resolveAccount(token, 'apple') : null;
    if (owner) ownerFrom = 'account_token';
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
  return { ...base, handled: true, purchase, ownerFrom, event: classifyPurchaseChange(before, purchase) };
}

/** The notification type a payload claims, for the log line of a refused one. */
function safeAppleType(signedPayload: string): string {
  try {
    return String(decodeJwsPayloadUnverified<AppleNotificationPayload>(signedPayload).notificationType ?? 'UNKNOWN');
  } catch {
    return 'UNREADABLE';
  }
}

interface AppleNotificationPayload {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/* ── Google ────────────────────────────────────────────────────────────── */

/**
 * Handle one Real-time Developer Notification, delivered as a Pub/Sub push.
 *
 * Pub/Sub redelivers on any non-2xx, and at-least-once even without one —
 * so `messageId` is the replay key.
 */
export async function handleGoogleNotification(
  options: GoogleNotificationOptions,
): Promise<NotificationResult> {
  const { billing, google, body } = options;
  if (options.verifyPubSub) {
    try {
      await verifyPubSubToken(options.verifyPubSub.authorization, options.verifyPubSub);
    } catch {
      return { handled: false, platform: 'google', notificationType: 'UNVERIFIED', originalTransactionId: null, reason: 'invalid_signature' };
    }
  }
  const message = (body?.message ?? {}) as Record<string, unknown>;
  const encoded = message.data;
  if (typeof encoded !== 'string' || encoded === '') {
    throw new Error('handleGoogleNotification: body.message.data is required.');
  }

  const notification = decodeBase64Json(encoded);
  if (notification.voidedPurchaseNotification) {
    return handleGoogleVoided(billing, google, notification, String(message.messageId ?? ''));
  }
  const subscription = (notification.subscriptionNotification ?? {}) as Record<string, unknown>;
  const oneTime = (notification.oneTimeProductNotification ?? {}) as Record<string, unknown>;
  const isTest = Boolean(notification.testNotification);

  const purchaseToken =
    typeof subscription.purchaseToken === 'string'
      ? subscription.purchaseToken
      : typeof oneTime.purchaseToken === 'string'
        ? oneTime.purchaseToken
        : null;
  const productId =
    typeof subscription.subscriptionId === 'string'
      ? subscription.subscriptionId
      : typeof oneTime.sku === 'string'
        ? oneTime.sku
        : null;
  const typeCode = Number(subscription.notificationType ?? oneTime.notificationType ?? 0);
  const notificationType = isTest
    ? 'TEST'
    : (GOOGLE_NOTIFICATION_TYPES[typeCode] ?? `UNKNOWN_${typeCode}`);

  const base = {
    platform: 'google' as const,
    notificationType,
    originalTransactionId: purchaseToken,
  };

  const recorded = await billing.recordEvent({
    platform: 'google',
    notificationType,
    originalTransactionId: purchaseToken,
    eventId: String(message.messageId ?? `google:${purchaseToken ?? generateId()}`),
    payload: notification,
  });
  if (!recorded) return { ...base, handled: false, reason: 'duplicate' };

  if (isTest) return { ...base, handled: true, reason: 'test' };
  if (!purchaseToken || !productId) return { ...base, handled: true, reason: 'unsupported' };

  const kind = notification.oneTimeProductNotification ? 'product' : 'subscription';
  const owner = await findOwner(billing, 'google', purchaseToken);
  if (owner) {
    const before = await billing.findPurchase('google', purchaseToken);
    const verified = await google.verify({ userId: owner, productId, purchaseToken, kind });
    const purchase = await billing.recordPurchase(verified);
    return { ...base, handled: true, purchase, ownerFrom: 'chain', event: classifyPurchaseChange(before, purchase) };
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
    return { ...base, handled: true, purchase, ownerFrom: 'linked_chain', event: classifyPurchaseChange(null, purchase) };
  }
  if (!options.resolveAccount) return { ...base, handled: true, reason: 'unknown_purchase' };
  const token = playAccountToken(fetched.raw);
  const resolved = token ? await options.resolveAccount(token, 'google') : null;
  if (!resolved) return { ...base, handled: true, reason: 'unknown_purchase' };
  const purchase = await billing.recordPurchase({ ...fetched, userId: resolved });
  return { ...base, handled: true, purchase, ownerFrom: 'account_token', event: classifyPurchaseChange(null, purchase) };
}

/**
 * A refund or chargeback (Play "voided purchase"). It names the token but not
 * the product, and it is still only a trigger: the purchase this backend
 * already recorded is re-read from Play and Play's answer is stored — a
 * revoked subscription comes back expired, a voided one-time product
 * cancelled, and access stops. A token nobody recorded changes nothing.
 */
async function handleGoogleVoided(
  billing: BillingClient,
  google: GoogleStore,
  notification: Record<string, unknown>,
  messageId: string,
): Promise<NotificationResult> {
  const voided = (notification.voidedPurchaseNotification ?? {}) as Record<string, unknown>;
  const purchaseToken = typeof voided.purchaseToken === 'string' ? voided.purchaseToken : null;
  // productType 1 = subscription, 2 = one-time product (Play's enum).
  const kind = Number(voided.productType) === 2 ? 'product' : 'subscription';
  const base = { platform: 'google' as const, notificationType: 'VOIDED_PURCHASE', originalTransactionId: purchaseToken };

  const recorded = await billing.recordEvent({
    platform: 'google',
    notificationType: base.notificationType,
    originalTransactionId: purchaseToken,
    eventId: messageId || `google:voided:${purchaseToken ?? generateId()}`,
    payload: notification,
  });
  if (!recorded) return { ...base, handled: false, reason: 'duplicate' };
  if (!purchaseToken) return { ...base, handled: true, reason: 'unsupported' };

  const known = await billing.findPurchase('google', purchaseToken);
  if (!known) return { ...base, handled: true, reason: 'unknown_purchase' };

  const verified = await google.verify({ userId: known.user_id, productId: known.product_id, purchaseToken, kind });
  const purchase = await billing.recordPurchase(verified);
  return { ...base, handled: true, purchase, ownerFrom: 'chain', event: classifyPurchaseChange(known, purchase) };
}

/** Placeholder owner while a Play purchase is read before its account is known. Never recorded. */
const UNRESOLVED = '__unresolved__';

/** Play's obfuscatedAccountId, as subscriptionsv2 and products return it. */
function playAccountToken(raw: Record<string, unknown> | undefined): string | null {
  const ids = (raw?.externalAccountIdentifiers ?? {}) as Record<string, unknown>;
  const token = ids.obfuscatedExternalAccountId ?? raw?.obfuscatedExternalAccountId;
  return typeof token === 'string' && token !== '' ? token : null;
}

/**
 * Play's numeric notification types. Names only — the STATE always comes
 * from re-reading the purchase, so a type this table does not know is
 * harmless.
 */
const GOOGLE_NOTIFICATION_TYPES: Record<number, string> = {
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
async function findOwner(
  billing: BillingClient,
  platform: BillingPlatform,
  originalTransactionId: string,
): Promise<string | null> {
  const purchase = await billing.findPurchase(platform, originalTransactionId);
  return purchase?.user_id ?? null;
}

function decodeBase64Json(encoded: string): Record<string, unknown> {
  const text = new TextDecoder().decode(
    base64UrlToBytes(encoded.replace(/\+/g, '-').replace(/\//g, '_')),
  );
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('handleGoogleNotification: message.data is not a JSON object.');
  }
  return parsed as Record<string, unknown>;
}
