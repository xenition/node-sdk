/**
 * The one error type the browser client throws. It carries the HTTP status
 * and (when the backend sent one) the router's error `code` + message. The
 * routers already scrub keys/URLs out of 4xx messages and send generic text
 * for 5xx (see ../hono/errors.ts), so nothing internal leaks through here —
 * this class only re-surfaces what the server chose to say.
 */
export declare class AppClientError extends Error {
    readonly status: number;
    readonly code?: string;
    constructor(status: number, code?: string, message?: string);
}
/**
 * Build an `AppClientError` from a non-2xx `Response`, pulling the router's
 * `{ error: { code, message } }` body when present (POST validation 400s
 * carry the server's aggregated message this way). Never throws — a
 * non-JSON / empty body falls back to a status-only message.
 */
export declare function errorFromResponse(res: Response): Promise<AppClientError>;
//# sourceMappingURL=errors.d.ts.map