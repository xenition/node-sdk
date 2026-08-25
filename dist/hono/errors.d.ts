import type { Context } from 'hono';
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
//# sourceMappingURL=errors.d.ts.map