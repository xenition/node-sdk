import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { XenitionClient } from '../xenition-client';
import { AppleStore, GoogleStore } from '../modules/billing';
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
}
export declare function billingRouter(options?: BillingRouterOptions): Hono;
export interface RequireEntitlementOptions {
    client?: XenitionClient;
    /** Message for the 402 body. Defaults to a generic upgrade prompt. */
    message?: string;
}
/**
 * Gate a route on an entitlement — the paywall, as one line per route.
 *
 *   app.use('/coach/*', requireAuth(), requireEntitlement('premium'));
 *
 * Answers 402 Payment Required rather than 403: the caller is perfectly
 * entitled to ask, they just have not paid, and the app should show the
 * paywall instead of an error. The body carries the same `EntitlementCheck`
 * the client gets from `/billing/entitlements/:key`, so one code path in the
 * app can render the paywall from either.
 *
 * Must be mounted AFTER `requireAuth()` — without a caller there is nothing
 * to check, and that is a wiring bug rather than a payment problem.
 */
export declare function requireEntitlement(entitlement: string, options?: RequireEntitlementOptions): MiddlewareHandler;
//# sourceMappingURL=billing-router.d.ts.map