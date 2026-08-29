"use strict";
/**
 * Typed error hierarchy.
 *
 * Every error thrown by the SDK extends `XenitionError` and carries a
 * stable `code` for programmatic handling. Callers inspect `err.code`
 * instead of parsing error messages — messages may change, codes don't.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRateLimited = exports.isNotFound = exports.isAuthError = exports.XenitionError = exports.isXenitionErrorCode = exports.XENITION_ERROR_CODES = void 0;
exports.XENITION_ERROR_CODES = [
    // Transport / infra
    'NETWORK_ERROR',
    'TIMEOUT',
    'SERVER_ERROR',
    'RATE_LIMITED',
    // The caller stopped this request through an AbortSignal. Its own code
    // rather than TIMEOUT or NETWORK_ERROR, because both of those tell an
    // on-call engineer the network misbehaved when nothing did — and both are
    // codes a caller's own retry wrapper will happily retry, which is exactly
    // what cancelling was meant to prevent. Prefer `isCancelledError(err)`
    // over comparing this string: it also recognises a cancellation raised
    // through a handle this SDK was not given.
    'CANCELLED',
    // Auth
    'AUTH_INVALID_CREDENTIALS',
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
    'AUTH_EMAIL_EXISTS',
    'AUTH_WEAK_PASSWORD',
    'AUTH_FORBIDDEN',
    'AUTH_PROVIDER_NOT_CONFIGURED',
    // Resources
    'NOT_FOUND',
    'VALIDATION_ERROR',
    'CONFLICT',
    // Data access
    'QUERY_FAILED',
    'QUERY_TABLE_NOT_FOUND',
    // Money. Distinct codes because a client must branch on them: a declined
    // card is retryable with a different card, a missing entitlement means
    // "show the paywall", and an invalid receipt means "do not retry at all".
    'PAYMENT_FAILED',
    'ENTITLEMENT_REQUIRED',
    'IAP_INVALID_RECEIPT',
    'IAP_ALREADY_OWNED',
    // Limits. A quota is a product decision the user can act on (upgrade,
    // wait until next month); RATE_LIMITED is a technical backpressure signal
    // meaning "the same request will work shortly". Collapsing them tells the
    // user to wait when they should be shown a plan.
    'QUOTA_EXCEEDED',
    // Storage
    'STORAGE_TOO_LARGE',
    'STORAGE_FAILED',
    // Background work
    'JOB_FAILED',
    // The model did not return usable JSON for a schema-constrained call
    'AI_UNPARSEABLE',
    // The deployment does not implement this endpoint yet
    'NOT_IMPLEMENTED',
    // Generic fallback
    'UNKNOWN',
];
/**
 * Runtime guard for the code union. Server responses cross a network
 * boundary, so `error.code` is untrusted input — validate before it is
 * allowed to inhabit `XenitionErrorCode`. Unknown codes should fall back
 * to status-based classification (or 'UNKNOWN'), with the raw server
 * code preserved in the error's `details`.
 */
const isXenitionErrorCode = (code) => typeof code === 'string' &&
    exports.XENITION_ERROR_CODES.includes(code);
exports.isXenitionErrorCode = isXenitionErrorCode;
class XenitionError extends Error {
    constructor(code, message, opts = {}) {
        super(message);
        this.name = 'XenitionError';
        this.code = code;
        this.status = opts.status ?? null;
        this.details = opts.details;
    }
}
exports.XenitionError = XenitionError;
const isAuthError = (err) => err instanceof XenitionError && err.code.startsWith('AUTH_');
exports.isAuthError = isAuthError;
const isNotFound = (err) => err instanceof XenitionError && err.code === 'NOT_FOUND';
exports.isNotFound = isNotFound;
const isRateLimited = (err) => err instanceof XenitionError && err.code === 'RATE_LIMITED';
exports.isRateLimited = isRateLimited;
//# sourceMappingURL=errors.js.map