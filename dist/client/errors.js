"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppClientError = void 0;
exports.errorFromResponse = errorFromResponse;
/**
 * The one error type the browser client throws. It carries the HTTP status
 * and (when the backend sent one) the router's error `code` + message. The
 * routers already scrub keys/URLs out of 4xx messages and send generic text
 * for 5xx (see ../hono/errors.ts), so nothing internal leaks through here —
 * this class only re-surfaces what the server chose to say.
 */
class AppClientError extends Error {
    constructor(status, code, message) {
        super(message ?? `Request failed with status ${status}`);
        this.name = 'AppClientError';
        this.status = status;
        this.code = code;
    }
}
exports.AppClientError = AppClientError;
/**
 * Build an `AppClientError` from a non-2xx `Response`, pulling the router's
 * `{ error: { code, message } }` body when present (POST validation 400s
 * carry the server's aggregated message this way). Never throws — a
 * non-JSON / empty body falls back to a status-only message.
 */
async function errorFromResponse(res) {
    let code;
    let message;
    try {
        const body = await res.json();
        if (body && typeof body === 'object' && 'error' in body) {
            const err = body.error;
            if (err && typeof err === 'object') {
                const c = err.code;
                const m = err.message;
                if (typeof c === 'string')
                    code = c;
                if (typeof m === 'string')
                    message = m;
            }
        }
    }
    catch {
        /* non-JSON body — fall back to a status-only message */
    }
    return new AppClientError(res.status, code, message);
}
//# sourceMappingURL=errors.js.map