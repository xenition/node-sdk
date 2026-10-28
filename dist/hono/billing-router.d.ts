import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { XenitionClient } from '../xenition-client';
import { AppleStore, GoogleStore } from '../modules/billing';
import type { ResolveAccount, VerifyPubSubOptions, VerifyX5cOptions } from '../modules/billing';
import type { XenitionRouterOptions } from './types';
/**
 * `/billing` — in-app purchases over HTTP, for the mobile client.
 *
 * The flow this router exists to serve:
 *
 *   1. The app shows a paywall built from `GET /billing/products`.
 *   2. StoreKit / Play Billing completes the purchase ON THE DEVICE and
 *      hands the app a transaction id (iOS) or purchase token (Android).
 *   3. The app POSTs it to `/billing/verify` with its access token.
 *   4. This router asks Apple or Google whether that is real, records it,
 *      and answers with the resulting entitlement.
 *   5. Everything afterwards — renewal, cancellation, refund — arrives on
 *      the webhook routes without the app being involved at all.
 *
 * Every purchase route is behind `requireAuth()`: a purchase must attach to
 * an account, and taking the user id from the request body would let anyone
 * move anyone else's subscription onto their own account.
 *
 * The webhook routes are deliberately NOT authenticated — the stores cannot
 * present a user token. They are safe because a notification only ever acts
 * as a trigger to re-read state from the store; see modules/billing/notifications.
 *
 * Configuration comes from worker secrets:
 *
 *   APPLE_KEY_ID, APPLE_ISSUER_ID, APPLE_PRIVATE_KEY, APPLE_BUNDLE_ID
 *   APPLE_ENVIRONMENT           production | sandbox | auto (default auto)
 *   GOOGLE_PACKAGE_NAME, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY
 *   BILLING_TRIAL_DAYS          enables POST /billing/trial when > 0
 *
 * A platform whose secrets are absent answers 501 rather than 500, so an
 * iOS-only app simply never configures Google and gets a clear message if
 * something calls it anyway.
 */
export interface BillingRouterOptions extends XenitionRouterOptions {
    /** Override the store adapters (tests, or credentials from elsewhere). */
    apple?: AppleStore;
    google?: GoogleStore;
    /**
     * Free trial length offered by `POST /billing/trial`. Server-side on
     * purpose: a client-supplied length would let anyone grant themselves a
     * ten-year trial. Falls back to `BILLING_TRIAL_DAYS`; without either, the
     * route is not mounted.
     */
    trialDays?: number;
    /** Entitlement the trial grants. Defaults to `premium`. */
    trialEntitlement?: string;
    /**
     * Map a purchase's account token (StoreKit appAccountToken / Play
     * obfuscatedAccountId, set by the app when buying) to a user, so a store
     * notification that arrives before `/billing/verify` still finds its owner.
     * See `ResolveAccount`. Off when omitted.
     */
    resolveAccount?: ResolveAccount;
    /** Check Apple's x5c certificate chain on `/billing/webhooks/apple` (true = pin Apple Root CA - G3). */
    verifyAppleSignature?: boolean | VerifyX5cOptions;
    /** Check the Pub/Sub OIDC token on `/billing/webhooks/google` (audience / service account to expect). */
    verifyGooglePubSub?: VerifyPubSubOptions;
}
export declare function billingRouter(options?: BillingRouterOptions): Hono;
export interface RequireEntitlementOptions {
    client?: XenitionClient;
    /** Message for the 402 body. Defaults to a generic upgrade prompt. */
    message?: string;
    /**
     * WHOSE entitlement decides. Defaults to the caller. A shared space where
     * one person pays for everyone (a household, a team) returns the payer's
     * user id here, so a member is let in on the owner's subscription.
     */
    subject?: (c: Context, callerId: string) => string | Promise<string>;
    /**
     * When billing itself cannot answer (the platform is down): `'deny'`
     * (default) lets the error surface; `'allow'` lets the request through and
     * logs it — a hard paywall should not lock out every paying customer
     * because a dependency blinked.
     */
    onBillingError?: 'deny' | 'allow';
}
/** The EntitlementCheck `requireEntitlement` decided on, for the handler: `c.get(ENTITLEMENT_CHECK)`. */
export declare const ENTITLEMENT_CHECK = "xenition:entitlementCheck";
/**
 * Gate a route on an entitlement — the paywall, as one line per route.
 *
 *   app.use('/coach/*', requireAuth(), requireEntitlement('premium'));
 *
 * Answers 402 Payment Required rather than 403: the caller is perfectly
 * entitled to ask, they just have not paid, and the app should show the
 * paywall instead of an error.
 *
 * The body is `paymentRequiredBody` — the SAME shape a metered quota
 * refuses with, so a client renders one paywall from `error.code` rather
 * than learning which SDK feature said no. It still carries the full
 * `EntitlementCheck` the client gets from `/billing/entitlements/:key`,
 * under `check`: that moved out of the top-level `entitlement` field, which
 * is now the flat entitlement key.
 *
 * Must be mounted AFTER `requireAuth()` — without a caller there is nothing
 * to check, and that is a wiring bug rather than a payment problem.
 */
export declare function requireEntitlement(entitlement: string, options?: RequireEntitlementOptions): MiddlewareHandler;
//# sourceMappingURL=billing-router.d.ts.map