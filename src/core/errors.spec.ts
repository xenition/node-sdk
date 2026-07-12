import {
  XenitionError,
  XENITION_ERROR_CODES,
  isXenitionErrorCode,
  isAuthError,
  isNotFound,
  isRateLimited,
} from './errors';

describe('XenitionError', () => {
  it('carries code, message, status and details', () => {
    const err = new XenitionError('NOT_FOUND', 'missing thing', {
      status: 404,
      details: { hint: 'check the id' },
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(XenitionError);
    expect(err.name).toBe('XenitionError');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('missing thing');
    expect(err.status).toBe(404);
    expect(err.details).toEqual({ hint: 'check the id' });
  });

  it('defaults status to null and details to undefined', () => {
    const err = new XenitionError('UNKNOWN', 'oops');
    expect(err.status).toBeNull();
    expect(err.details).toBeUndefined();
  });
});

describe('isXenitionErrorCode', () => {
  it('accepts every code in the union', () => {
    for (const code of XENITION_ERROR_CODES) {
      expect(isXenitionErrorCode(code)).toBe(true);
    }
  });

  it('rejects strings outside the union', () => {
    expect(isXenitionErrorCode('TOTALLY_MADE_UP')).toBe(false);
    expect(isXenitionErrorCode('')).toBe(false);
    expect(isXenitionErrorCode('not_found')).toBe(false); // case-sensitive
  });

  it('rejects non-strings', () => {
    expect(isXenitionErrorCode(undefined)).toBe(false);
    expect(isXenitionErrorCode(null)).toBe(false);
    expect(isXenitionErrorCode(42)).toBe(false);
    expect(isXenitionErrorCode({ code: 'NOT_FOUND' })).toBe(false);
  });
});

describe('helper guards', () => {
  it('isAuthError matches every AUTH_* code and nothing else', () => {
    expect(isAuthError(new XenitionError('AUTH_INVALID_TOKEN', 'x'))).toBe(true);
    expect(isAuthError(new XenitionError('AUTH_EXPIRED_TOKEN', 'x'))).toBe(true);
    expect(isAuthError(new XenitionError('AUTH_FORBIDDEN', 'x'))).toBe(true);
    expect(isAuthError(new XenitionError('NOT_FOUND', 'x'))).toBe(false);
    expect(isAuthError(new Error('AUTH_FORBIDDEN'))).toBe(false); // plain Error
    expect(isAuthError('AUTH_FORBIDDEN')).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
  });

  it('isNotFound matches only NOT_FOUND XenitionErrors', () => {
    expect(isNotFound(new XenitionError('NOT_FOUND', 'x'))).toBe(true);
    expect(isNotFound(new XenitionError('VALIDATION_ERROR', 'x'))).toBe(false);
    expect(isNotFound(new Error('not found'))).toBe(false);
  });

  it('isRateLimited matches only RATE_LIMITED XenitionErrors', () => {
    expect(isRateLimited(new XenitionError('RATE_LIMITED', 'x'))).toBe(true);
    expect(isRateLimited(new XenitionError('SERVER_ERROR', 'x'))).toBe(false);
    expect(isRateLimited(null)).toBe(false);
  });
});
