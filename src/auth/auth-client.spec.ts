import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';
import { XenitionError } from '../core/errors';
import { AuthClient } from './auth-client';
import { User } from './types';

/**
 * The client's only dependency is the HttpClient verb methods, so a bare
 * mock stands in for the whole thing — same pattern as the migrations
 * suite. These tests pin the END-USER token path: the header must ride on
 * the individual request and never on the shared client defaults.
 */
const USER: User = {
  id: 'user-1',
  email: 'a@example.com',
  role: 'authenticated',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const makeHttp = () => {
  const get = jest.fn().mockResolvedValue(USER);
  const post = jest.fn().mockResolvedValue({ ok: true });
  const patch = jest.fn().mockResolvedValue(USER);
  const setHeader = jest.fn();
  const http = { get, post, patch, setHeader } as unknown as HttpClient;
  return { get, post, patch, setHeader, auth: new AuthClient(http) };
};

const authHeader = (config: unknown): string | undefined =>
  (config as { headers?: Record<string, string> } | undefined)?.headers?.Authorization;

describe('AuthClient end-user token', () => {
  it('sends no Authorization header when no token is passed', async () => {
    const { get, auth } = makeHttp();
    await auth.me();
    expect(get).toHaveBeenCalledWith(API_ENDPOINTS.AUTH.ME, undefined);
  });

  it('carries the token as a per-request Bearer header on me()', async () => {
    const { get, auth } = makeHttp();
    await auth.me('tok-abc');
    expect(get).toHaveBeenCalledWith(API_ENDPOINTS.AUTH.ME, {
      headers: { Authorization: 'Bearer tok-abc' },
    });
  });

  it('carries the token on logout() and updateProfile()', async () => {
    const { post, patch, auth } = makeHttp();
    await auth.logout('tok-abc');
    await auth.updateProfile({ name: 'Ada' }, 'tok-abc');
    expect(authHeader(post.mock.calls[0][2])).toBe('Bearer tok-abc');
    expect(authHeader(patch.mock.calls[0][2])).toBe('Bearer tok-abc');
    expect(patch.mock.calls[0][1]).toEqual({ name: 'Ada' });
  });

  it('never mutates the shared client defaults', async () => {
    const { setHeader, auth } = makeHttp();
    await auth.me('tok-abc');
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('does not leak one user token into the next request', async () => {
    const { get, auth } = makeHttp();
    await auth.me('tok-first');
    await auth.me();
    expect(authHeader(get.mock.calls[1][1])).toBeUndefined();
  });
});

describe('AuthClient.verifyToken', () => {
  it('resolves the user behind the token', async () => {
    const { get, auth } = makeHttp();
    await expect(auth.verifyToken('tok-abc')).resolves.toEqual(USER);
    expect(authHeader(get.mock.calls[0][1])).toBe('Bearer tok-abc');
  });

  const rejected: Array<[string, string]> = [
    ['', 'empty'],
    ['   ', 'blank'],
    [undefined as unknown as string, 'missing'],
  ];
  it.each(rejected)('rejects a %s token as AUTH_INVALID_TOKEN (%s)', (token) => {
    const { get, auth } = makeHttp();
    expect(() => auth.verifyToken(token)).toThrow(XenitionError);
    try {
      auth.verifyToken(token);
    } catch (err) {
      expect((err as XenitionError).code).toBe('AUTH_INVALID_TOKEN');
    }
    expect(get).not.toHaveBeenCalled();
  });

  it('propagates the platform error instead of swallowing it', async () => {
    const { get, auth } = makeHttp();
    get.mockRejectedValueOnce(new XenitionError('AUTH_EXPIRED_TOKEN', 'expired'));
    await expect(auth.verifyToken('tok-old')).rejects.toMatchObject({
      code: 'AUTH_EXPIRED_TOKEN',
    });
  });
});

/**
 * The mobile surface calls endpoints a deployment may not have shipped yet.
 * These tests pin two things: the wire shape the gateway will be built
 * against (see docs/PLATFORM-ENDPOINTS.md), and that a missing endpoint
 * produces a message naming it rather than a bare NOT_FOUND that reads like
 * "no such user".
 */
describe('AuthClient mobile surface', () => {
  const SESSION = {
    user: USER,
    session: { id: 's1', userId: 'user-1', expiresAt: 'e', createdAt: 'c' },
    token: 'new-access',
    refreshToken: 'new-refresh',
    expiresAt: 1767225600,
  };

  it('refresh posts the token and returns a whole new session', async () => {
    const { post, auth } = makeHttp();
    post.mockResolvedValueOnce(SESSION);
    await expect(auth.refresh('r1')).resolves.toMatchObject({ refreshToken: 'new-refresh' });
    expect(post).toHaveBeenCalledWith(API_ENDPOINTS.AUTH.REFRESH, { refreshToken: 'r1' });
  });

  it('signInWithIdToken posts to the provider path with the nonce', async () => {
    // The nonce is what stops a token captured elsewhere being replayed.
    const { post, auth } = makeHttp();
    post.mockResolvedValueOnce(SESSION);
    await auth.signInWithIdToken({ provider: 'apple', idToken: 'idt', nonce: 'n1', name: 'Ada' });
    expect(post).toHaveBeenCalledWith(API_ENDPOINTS.AUTH.OAUTH_ID_TOKEN('apple'), {
      idToken: 'idt',
      nonce: 'n1',
      name: 'Ada',
    });
  });

  it('otp requires an identifier and a code', async () => {
    const { auth } = makeHttp();
    await expect(auth.sendOtp({})).rejects.toThrow(/"email" or "phone" is required/);
    await expect(auth.verifyOtp({ code: '', email: 'a@b.c' })).rejects.toThrow(/"code" is required/);
    await expect(auth.verifyOtp({ code: '123456' })).rejects.toThrow(
      /"email" or "phone" is required/,
    );
  });

  it('changePassword carries the end-user token', async () => {
    const { post, auth } = makeHttp();
    post.mockResolvedValueOnce({ changed: true });
    await auth.changePassword({ currentPassword: 'old', newPassword: 'new' }, 'tok');
    expect(authHeader(post.mock.calls[0][2])).toBe('Bearer tok');
  });

  it('deleteAccount sends a DELETE carrying the token and reports the purge date', async () => {
    const del = jest.fn().mockResolvedValue({ deleted: true, purgeAt: '2026-09-23T00:00:00.000Z' });
    const http = { del, get: jest.fn(), post: jest.fn(), patch: jest.fn() } as unknown as HttpClient;
    const auth = new AuthClient(http);

    const result = await auth.deleteAccount('tok', { reason: 'done' });

    expect(result).toMatchObject({ deleted: true, purgeAt: '2026-09-23T00:00:00.000Z' });
    expect(del).toHaveBeenCalledWith(
      API_ENDPOINTS.AUTH.ACCOUNT,
      expect.objectContaining({ data: { reason: 'done' } }),
    );
    expect(authHeader(del.mock.calls[0][1])).toBe('Bearer tok');
  });

  it('exportData reads the account export as the user', async () => {
    const { get, auth } = makeHttp();
    get.mockResolvedValueOnce({ user: USER, generatedAt: 'now' });
    await auth.exportData('tok');
    expect(get).toHaveBeenCalledWith(API_ENDPOINTS.AUTH.ACCOUNT_EXPORT, {
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('names the missing endpoint when a deployment has not shipped it', async () => {
    // A bare NOT_FOUND from /auth/refresh reads like "no such user" and sends
    // people debugging their token instead of their deployment.
    const { post, auth } = makeHttp();
    post.mockRejectedValueOnce(new XenitionError('NOT_FOUND', 'Not Found'));
    await expect(auth.refresh('r1')).rejects.toThrow(
      /does not implement \/app-platform\/auth\/refresh/,
    );
  });

  it('leaves other errors untouched', async () => {
    const { post, auth } = makeHttp();
    post.mockRejectedValueOnce(new XenitionError('AUTH_INVALID_TOKEN', 'nope'));
    await expect(auth.refresh('r1')).rejects.toMatchObject({ code: 'AUTH_INVALID_TOKEN' });
  });

  it('rejects blank required fields before hitting the network', async () => {
    const { post, auth } = makeHttp();
    await expect(auth.refresh('')).rejects.toThrow(/"refreshToken" is required/);
    await expect(
      auth.signInWithIdToken({ provider: 'google', idToken: '' }),
    ).rejects.toThrow(/"idToken" is required/);
    expect(post).not.toHaveBeenCalled();
  });

  it('revokeAllSessions deletes the collection', async () => {
    const del = jest.fn().mockResolvedValue({ revoked: 3 });
    const auth = new AuthClient({ del } as unknown as HttpClient);
    await expect(auth.revokeAllSessions('tok')).resolves.toEqual({ revoked: 3 });
    expect(del).toHaveBeenCalledWith(API_ENDPOINTS.AUTH.SESSIONS, {
      headers: { Authorization: 'Bearer tok' },
    });
  });
});

describe('AuthClient — required fields are checked before the request', () => {
  /**
   * The server answers a blank login with "Invalid email or password",
   * which reads as a credentials problem. It is usually an undefined
   * variable that never reached the request, so these fail locally with
   * the field name instead.
   */
  const noCall = () => {
    throw new Error('should not have reached the network');
  };

  it('login refuses a missing email or password without calling the server', async () => {
    const auth = new AuthClient({ post: noCall } as never);
    await expect(auth.login({ password: 'x' } as never)).rejects.toThrow(/"email" is required/);
    await expect(auth.login({ email: 'a@b.com' } as never)).rejects.toThrow(/"password" is required/);
    await expect(auth.login({} as never)).rejects.toThrow(/AuthClient.login/);
  });

  it('register refuses a missing email or password', async () => {
    const auth = new AuthClient({ post: noCall } as never);
    await expect(auth.register({ password: 'x' } as never)).rejects.toThrow(/"email" is required/);
    await expect(auth.register({ email: 'a@b.com' } as never)).rejects.toThrow(/"password" is required/);
  });

  it('the reset flow refuses blanks', async () => {
    const auth = new AuthClient({ post: noCall } as never);
    await expect(auth.requestPasswordReset('', 'https://x')).rejects.toThrow(/"email" is required/);
    await expect(auth.resetPassword({ token: '', newPassword: 'x' })).rejects.toThrow(/"token" is required/);
    await expect(auth.verifyEmail('')).rejects.toThrow(/"token" is required/);
  });

  it('a whitespace-only value counts as missing', async () => {
    const auth = new AuthClient({ post: noCall } as never);
    await expect(auth.login({ email: '   ', password: 'x' })).rejects.toThrow(/"email" is required/);
  });
});
