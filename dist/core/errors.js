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