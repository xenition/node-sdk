import type { Context } from 'hono';
import type { EntitlementCheck } from '../modules/billing';
/** Belt-and-braces: strip anything key- or URL-shaped from 4xx messages. */
export declare function scrubMessage(message: string): string;
/** Shared `app.onError` handler — see module doc for the mapping rules. */
export declare function honoErrorHandler(err: Error | unknown, c: Context): Response;
/** JSON 404 for unmatched routes (hono's default is text/plain). */
export declare function jsonNotFound(c: Context): Response;
/**
 * A capability this app never configured — e.g. Google purchase secrets in
 * an iOS-only app.
 *
 * Distinct from `XenitionApiConfigError`: that one means a REQUIRED secret
 * is missing and something is broken. This one means an optional platform
 * was simply never set up, which is a legitimate state, so it answers 501
 * Not Implemented rather than a 500 that reads like a fault.
 */
export declare class NotConfiguredError extends Error {
    constructor(message: string);
}
/** 400 helper for router-level input validation (query params, body shape). */
export declare function badRequest(c: Context, message: string): Response;
/**
 * 401 — the CALLER did not prove who they are (missing/invalid/expired
 * end-user token).
 *
 * Deliberately not routed through `statusForCode`: an `AUTH_*`
 * XenitionError reaching the shared handler means the worker's OWN service
 * key was rejected, which is a 502 config problem. End-user auth failures
 * are answered here so the two never blur together.
 */
export declare function unauthorized(c: Context, message: string, code?: string): Response;
/** 403 — the caller is known, but not allowed to do this. */
export declare function forbidden(c: Context, message: string, code?: string): Response;
/**
 * Two different things refuse a paid feature, and they used to disagree
 * about how to say so.
 *
 * `requireEntitlement` answered `{ error: { code: 'ENTITLEMENT_REQUIRED' },
 * entitlement: <the whole EntitlementCheck> }`. An app metering a free tier
 * with the `quotas` module answered whatever it hand-rolled around
 * `quotas.consume()`. Both are 402, both mean "pay to continue", and a
 * client could not tell "you must upgrade" from "you are out of runs"
 * without parsing two shapes — so which paywall the app showed depended on
 * which SDK feature happened to say no.
 *
 * One shape now, for both. `error.code` is always `PAYMENT_REQUIRED`.
 * `entitlement` is always the flat key the caller lacks, so a client that
 * only needs "upgrade to what?" reads one string. `quota` is present only
 * when a meter is what refused — its presence IS the distinction between
 * the two cases, and its numbers are what lets the app say "5 of 5 used,
 * resets on the 1st" instead of a bare upsell.
 *
 * `check` carries the gate's full `EntitlementCheck` when the refusal came
 * from `requireEntitlement`. It is what lets an app tell an expired
 * subscription from one that never existed, which is a different paywall;
 * it stays optional so nothing has to read it.
 */
export interface PaymentRequiredQuota {
    /** The quota key it was consumed under — `quotas.consume(u, key, …)`. */
    key: string;
    limit: number;
    used: number;
    /** When the window rolls over. Null for a `total` quota, which never does. */
    resetAt: string | null;
}
export interface PaymentRequiredBody {
    error: {
        code: 'PAYMENT_REQUIRED';
        message: string;
    };
    /** The entitlement that unlocks this — the key, never the check. */
    entitlement: string;
    /** Present only when a metered quota is what refused. */
    quota?: PaymentRequiredQuota;
    /** The full check, when an entitlement gate is what refused. */
    check?: EntitlementCheck;
}
export interface PaymentRequiredOptions {
    entitlement: string;
    /** Overrides the default upgrade prompt; shown to the user by the app. */
    message?: string;
    /**
     * A `QuotaState` from `quotas.consume()` satisfies this once the key it
     * was consumed under is spread in:
     *
     *   const quota = await quotas.consume(userId, 'analysis', { limit: 5 });
     *   if (!quota.allowed) {
     *     return paymentRequired(c, {
     *       entitlement: 'premium',
     *       quota: { key: 'analysis', ...quota },
     *     });
     *   }
     *
     * Only the four fields above reach the body — `remaining` and `period`
     * are derivable, and every extra field is one more thing a client has to
     * be told about.
     */
    quota?: PaymentRequiredQuota;
    check?: EntitlementCheck;
}
/**
 * Build the body without sending it — for the callers that need it inside
 * something else, e.g. attaching it to a thrown exception rather than
 * returning it:
 *
 *   throw new HTTPException(402, {
 *     res: Response.json(paymentRequiredBody({ entitlement: 'premium' }), { status: 402 }),
 *   });
 *
 * `honoErrorHandler` passes an exception's own `res` through untouched, so
 * that arrives at the client exactly as built.
 */
export declare function paymentRequiredBody(options: PaymentRequiredOptions): PaymentRequiredBody;
/** 402 — the caller may ask, they just have not paid. Never 403. */
export declare function paymentRequired(c: Context, options: PaymentRequiredOptions): Response;
//# sourceMappingURL=errors.d.ts.map