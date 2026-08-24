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
