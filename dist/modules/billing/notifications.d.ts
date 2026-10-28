import { AppleStore } from './apple';
import { BillingClient } from './billing-client';
import { GoogleStore } from './google';
import { BillingPlatform, Purchase } from './types';
import { type PurchaseEvent } from './offers';
import { type VerifyX5cOptions } from './x509';
import { type VerifyPubSubOptions } from './pubsub';
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
    verifyPubSub?: VerifyPubSubOptions & {
        authorization: string | null | undefined;
    };
}
/**
 * Handle one App Store Server Notification (v2).
 *
 * Apple retries for up to three days, so this must be idempotent — it is,
 * through `notificationUUID`.
 */
export declare function handleAppleNotification(options: AppleNotificationOptions): Promise<NotificationResult>;
/**
 * Handle one Real-time Developer Notification, delivered as a Pub/Sub push.
 *
 * Pub/Sub redelivers on any non-2xx, and at-least-once even without one —
 * so `messageId` is the replay key.
 */
export declare function handleGoogleNotification(options: GoogleNotificationOptions): Promise<NotificationResult>;
//# sourceMappingURL=notifications.d.ts.map