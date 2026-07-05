"use strict";
/**
 * Typed error hierarchy.
 *
 * Every error thrown by the SDK extends `XenitionError` and carries a
 * stable `code` for programmatic handling. Callers inspect `err.code`
 * instead of parsing error messages — messages may change, codes don't.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRateLimited = exports.isNotFound = exports.isAuthError = exports.XenitionError = void 0;
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