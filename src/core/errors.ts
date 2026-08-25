/**
 * Typed error hierarchy.
 *
 * Every error thrown by the SDK extends `XenitionError` and carries a
 * stable `code` for programmatic handling. Callers inspect `err.code`
 * instead of parsing error messages — messages may change, codes don't.
 */

export const XENITION_ERROR_CODES = [
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
] as const;

export type XenitionErrorCode = (typeof XENITION_ERROR_CODES)[number];

/**
 * Runtime guard for the code union. Server responses cross a network
 * boundary, so `error.code` is untrusted input — validate before it is
 * allowed to inhabit `XenitionErrorCode`. Unknown codes should fall back
 * to status-based classification (or 'UNKNOWN'), with the raw server
 * code preserved in the error's `details`.
 */
export const isXenitionErrorCode = (code: unknown): code is XenitionErrorCode =>
  typeof code === 'string' &&
  (XENITION_ERROR_CODES as readonly string[]).includes(code);

export class XenitionError extends Error {
  readonly code: XenitionErrorCode;
  readonly status: number | null;
  readonly details: unknown;

  constructor(
    code: XenitionErrorCode,
    message: string,
    opts: { status?: number | null; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'XenitionError';
    this.code = code;
    this.status = opts.status ?? null;
    this.details = opts.details;
  }
}

export const isAuthError = (err: unknown): err is XenitionError =>
  err instanceof XenitionError && err.code.startsWith('AUTH_');

export const isNotFound = (err: unknown): err is XenitionError =>
  err instanceof XenitionError && err.code === 'NOT_FOUND';

export const isRateLimited = (err: unknown): err is XenitionError =>
  err instanceof XenitionError && err.code === 'RATE_LIMITED';
