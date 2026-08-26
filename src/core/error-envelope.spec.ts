import { codeFromEnvelope, messageFromEnvelope } from './error-envelope';

describe('messageFromEnvelope', () => {
  it('reads the flat gateway shape', () => {
    // Verbatim from api-dev on a duplicate-email register. The SDK used to
    // drop this sentence and throw axios's "Request failed with status
    // code 409" instead, which a sign-up screen cannot show a user.
    const envelope = {
      error: 'Conflict',
      message: 'an account with this email already exists',
      path: '/v1/app-platform/auth/register',
      statusCode: 409,
      timestamp: '2026-08-26T06:14:48Z',
    };
    expect(messageFromEnvelope(envelope)).toBe('an account with this email already exists');
  });

  it('reads the nested SDK shape', () => {
    const envelope = { success: false, error: { code: 'CONFLICT', message: 'already exists' } };
    expect(messageFromEnvelope(envelope)).toBe('already exists');
  });

  it('prefers the nested message when both are present', () => {
    const envelope = {
      error: { code: 'CONFLICT', message: 'written for the caller' },
      message: 'written for the log',
    };
    expect(messageFromEnvelope(envelope)).toBe('written for the caller');
  });

  it('joins the validation-pipe array instead of stringifying it', () => {
    const envelope = {
      statusCode: 400,
      error: 'Bad Request',
      message: ['email must be an email', 'password is too short'],
    };
    expect(messageFromEnvelope(envelope)).toBe('email must be an email; password is too short');
  });

  it('ignores blank and non-string messages so the caller keeps its fallback', () => {
    expect(messageFromEnvelope({ message: '' })).toBeUndefined();
    expect(messageFromEnvelope({ message: '   ' })).toBeUndefined();
    expect(messageFromEnvelope({ error: { message: '' }, message: 'from the flat field' })).toBe(
      'from the flat field',
    );
    expect(messageFromEnvelope({ message: [] })).toBeUndefined();
    expect(messageFromEnvelope({ message: 42 })).toBeUndefined();
  });

  it('survives bodies that are not envelopes at all', () => {
    expect(messageFromEnvelope(undefined)).toBeUndefined();
    expect(messageFromEnvelope(null)).toBeUndefined();
    expect(messageFromEnvelope('<html>502 Bad Gateway</html>')).toBeUndefined();
    expect(messageFromEnvelope(['a', 'b'])).toBeUndefined();
  });
});

describe('codeFromEnvelope', () => {
  it('takes the code from the nested shape', () => {
    expect(codeFromEnvelope({ error: { code: 'CONFLICT', message: 'x' } })).toBe('CONFLICT');
  });

  it('does NOT mistake the flat shape status label for a code', () => {
    // 'Conflict' is a human label, not a XenitionErrorCode. Treating it as
    // one would classify by a string the gateway never promised to keep
    // stable; the HTTP status is the reliable signal there.
    expect(codeFromEnvelope({ error: 'Conflict', statusCode: 409 })).toBeUndefined();
  });

  it('survives non-envelopes', () => {
    expect(codeFromEnvelope(undefined)).toBeUndefined();
    expect(codeFromEnvelope('nope')).toBeUndefined();
  });
});
