/**
 * Typed error hierarchy.
 *
 * Every error thrown by the SDK extends `XenitionError` and carries a
 * stable `code` for programmatic handling. Callers inspect `err.code`
 * instead of parsing error messages — messages may change, codes don't.
 */
export type XenitionErrorCode = 'NETWORK_ERROR' | 'TIMEOUT' | 'SERVER_ERROR' | 'RATE_LIMITED' | 'AUTH_INVALID_CREDENTIALS' | 'AUTH_INVALID_TOKEN' | 'AUTH_EXPIRED_TOKEN' | 'AUTH_EMAIL_EXISTS' | 'AUTH_WEAK_PASSWORD' | 'AUTH_FORBIDDEN' | 'AUTH_PROVIDER_NOT_CONFIGURED' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CONFLICT' | 'QUERY_FAILED' | 'QUERY_TABLE_NOT_FOUND' | 'UNKNOWN';
export declare class XenitionError extends Error {
    readonly code: XenitionErrorCode;
    readonly status: number | null;
    readonly details: unknown;
    constructor(code: XenitionErrorCode, message: string, opts?: {
        status?: number | null;
        details?: unknown;
    });
}
export declare const isAuthError: (err: unknown) => err is XenitionError;
export declare const isNotFound: (err: unknown) => err is XenitionError;
export declare const isRateLimited: (err: unknown) => err is XenitionError;
//# sourceMappingURL=errors.d.ts.map