import type { EntitlementCheck, PaymentRequiredDetails, PaymentRequiredQuota } from './types';
/**
 * The one error type the browser client throws. It carries the HTTP status
 * and (when the backend sent one) the router's error `code` + message. The
 * routers already scrub keys/URLs out of 4xx messages and send generic text
 * for 5xx (see ../hono/errors.ts), so nothing internal leaks through here —
 * this class only re-surfaces what the server chose to say.
 *
 * One status is special. A **402** is not a failure of the request: the
 * caller was perfectly entitled to ask, they simply have not paid, and the
 * app should show its paywall rather than an error screen. The server says
 * WHICH paywall in structured fields beside the error (see
 * `PaymentRequiredDetails`), and they are lifted onto the error here so one
 * can render straight from the throw:
 *
 *   try { await api.coach.analyze(id); }
 *   catch (err) {
 *     if (isPaymentRequired(err)) {
 *       // `quota` present → "5 of 5 used, resets on the 1st"
 *       // `quota` absent  → "upgrade to premium"
 *       return showPaywall(err.entitlement, err.quota, err.check);
 *     }
 *     throw err;
 *   }
 *
 * The point of the fields is that nothing has to match on the MESSAGE. A
 * client that decides which paywall to show by looking for the word
 * "premium" in prose breaks the first time someone edits the copy.
 */
export declare class AppClientError extends Error {
    readonly status: number;
    readonly code?: string;
    /** The 402's entitlement KEY — what to upgrade to. */
    readonly entitlement?: string;
    /** The 402's quota block. Present only when a meter is what refused. */
    readonly quota?: PaymentRequiredQuota;
    /** The 402's full check, when an entitlement gate is what refused. */
    readonly check?: EntitlementCheck;
    constructor(status: number, code?: string, message?: string, details?: PaymentRequiredDetails);
    /**
     * Show the paywall. Keyed on the STATUS rather than on
     * `code === 'PAYMENT_REQUIRED'`: 402 is the one status the whole API
     * reserves for "pay to continue", and it reaches a client from routes
     * that never went through the SDK's own helper — an app's own
     * `HTTPException(402)`, a proxy in front of the worker. Those carry no
     * blocks and still mean the paywall.
     */
    get isPaymentRequired(): boolean;
}
/**
 * Narrow an unknown catch to a payment-required `AppClientError`.
 *
 * `catch (err)` is `unknown`, so the `instanceof` + status check is two
 * lines at every call site that wants a paywall. This is that check, once.
 */
export declare function isPaymentRequired(err: unknown): err is AppClientError;
/**
 * Build an `AppClientError` from a non-2xx `Response`, pulling the router's
 * `{ error: { code, message } }` body when present (POST validation 400s
 * carry the server's aggregated message this way), plus the entitlement /
 * quota / check fields a 402 sits beside it. Never throws — a non-JSON /
 * empty body falls back to a status-only message.
 */
export declare function errorFromResponse(res: Response): Promise<AppClientError>;
//# sourceMappingURL=errors.d.ts.map