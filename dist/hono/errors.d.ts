import type { Context } from 'hono';
/** Belt-and-braces: strip anything key- or URL-shaped from 4xx messages. */
export declare function scrubMessage(message: string): string;
/** Shared `app.onError` handler — see module doc for the mapping rules. */
export declare function honoErrorHandler(err: Error | unknown, c: Context): Response;
/** JSON 404 for unmatched routes (hono's default is text/plain). */
export declare function jsonNotFound(c: Context): Response;
/** 400 helper for router-level input validation (query params, body shape). */
export declare function badRequest(c: Context, message: string): Response;
//# sourceMappingURL=errors.d.ts.map