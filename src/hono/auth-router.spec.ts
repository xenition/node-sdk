import { Hono } from 'hono';
import { XenitionClient } from '../xenition-client';
import { createAppClient } from '../client/app-client';
import { AppClientError } from '../client/errors';
import { XenitionError } from '../core/errors';
import type { AuthResponse, Session, User } from '../auth/types';
import { authRouter } from './auth-router';

/**
 * The contract test for `/auth/*`.
 *
 * This drives the REAL `createAppClient()` against the REAL `authRouter()`
 * over `app.request` — `global.fetch` is a two-line bridge into the mounted
 * router and nothing else. That is deliberate: two independent suites, one
 * asserting the client's URLs and one asserting the router's routes, would
 * have agreed with each other right up until somebody renamed a path in one
 * of them. Here, a path or body-shape disagreement is a 404 or a 400 in
 * these tests rather than a bug in an app.
 *
 * Only `client.auth` — the platform SDK's own HTTP layer — is stubbed.
 * Everything between the frontend call and that boundary is the shipped
 * code.
 */

const USER: User = {
  id: 'user-1',
  email: 'ada@example.com',
  role: 'authenticated',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const SESSION: Session = {
  id: 'sess-1',
  userId: 'user-1',
  expiresAt: '2026-02-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const AUTH_RESPONSE: AuthResponse = {
  user: USER,
  session: SESSION,
  token: 'access-tok',
  refreshToken: 'refresh-tok',
  expiresAt: 1_800_000_000_000,
};

/** Every end-user method the router is allowed to call, stubbed. */
const makeAuthStub = () => ({
  verifyToken: jest.fn(async () => USER),
  register: jest.fn(async () => AUTH_RESPONSE),
  login: jest.fn(async () => AUTH_RESPONSE),
  refresh: jest.fn(async () => AUTH_RESPONSE),
  signInWithIdToken: jest.fn(async () => AUTH_RESPONSE),
  verifyOtp: jest.fn(async () => AUTH_RESPONSE),
  handleOAuthCallback: jest.fn(async () => AUTH_RESPONSE),
  sendOtp: jest.fn(async () => ({
    sent: true as const,
    channel: 'email' as const,
    expiresAt: '2026-01-01T00:05:00.000Z',
  })),
  me: jest.fn(async () => USER),
  updateProfile: jest.fn(async () => ({ ...USER, userMetadata: { name: 'Ada Lovelace' } })),
  changePassword: jest.fn(async () => ({ changed: true as const })),
  requestPasswordReset: jest.fn(async () => ({ requested: true as const })),
  resetPassword: jest.fn(async () => ({ reset: true as const })),
  verifyEmail: jest.fn(async () => ({ verified: true as const })),
  logout: jest.fn(async () => ({ ok: true as const })),
  listSessions: jest.fn(async () => [SESSION]),
  revokeSession: jest.fn(async () => ({ revoked: true as const })),
  revokeAllSessions: jest.fn(async () => ({ revoked: 3 })),
  deleteAccount: jest.fn(async () => ({ deleted: true as const, purgeAt: '2026-02-01' })),
  exportData: jest.fn(async () => ({ user: USER, sessions: [SESSION], generatedAt: 'now' })),
  getOAuthUrl: jest.fn(async () => ({ url: 'https://accounts.google.com/o/x', state: 'st-1' })),
  listSocialProviders: jest.fn(async () => [
    {
      provider: 'google' as const,
      configured: true,
      enabled: true,
      ssoAvailable: false,
      isAvailable: true,
      usingSSO: false,
      clientIdMasked: '1234…abcd',
      redirectUri: 'https://app.example.com/cb',
      scopes: ['email'],
      updatedAt: null,
    },
  ]),
});

/**
 * A worker with the router mounted at `/api`, plus an app client pointed at
 * it. `global.fetch` becomes `app.request` — no network, no second copy of
 * the URL table.
 */
function makeApp(options: Record<string, unknown> = {}, token: string | null = 'tok') {
  const auth = makeAuthStub();
  const client = { auth, modules: { use: jest.fn() } } as unknown as XenitionClient;

  const app = new Hono();
  app.route('/api', authRouter({ client, ...options }));

  (global as { fetch: unknown }).fetch = (url: string, init?: RequestInit) =>
    app.request(url, init);

  const api = createAppClient('/api', token ? { accessToken: token } : {});
  return { api, auth, app };
}

/** The first argument the stub was called with. */
const firstArg = (fn: jest.Mock): unknown => fn.mock.calls[0]?.[0];

describe('sign-in (public — no token attached)', () => {
  it('register posts to /auth/register and returns the session', async () => {
    const { api, auth } = makeApp({}, null);
    const result = await api.auth.register({ email: 'ada@example.com', password: 'pw' });

    expect(auth.register).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'pw' });
    expect(result).toMatchObject({
      token: 'access-tok',
      refreshToken: 'refresh-tok',
      expiresAt: 1_800_000_000_000,
      user: { id: 'user-1', email: 'ada@example.com' },
      session: { id: 'sess-1', userId: 'user-1' },
    });
  });

  it('login works without any Authorization header', async () => {
    const { api, auth } = makeApp({}, null);
    const result = await api.auth.login({ email: 'ada@example.com', password: 'pw' });
    expect(auth.login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'pw' });
    expect(result.token).toBe('access-tok');
  });

  it('refresh is public — the caller is here because their token expired', async () => {
    const { api, auth } = makeApp({}, null);
    const result = await api.auth.refresh('refresh-tok');
    expect(auth.refresh).toHaveBeenCalledWith('refresh-tok');
    expect(result.refreshToken).toBe('refresh-tok');
  });

  it('signInWithIdToken hits the per-provider path', async () => {
    const { api, auth } = makeApp({}, null);
    await api.auth.signInWithIdToken({ provider: 'apple', idToken: 'idt', nonce: 'n1' });
    expect(auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      idToken: 'idt',
      nonce: 'n1',
    });
  });

  it('sends and verifies a one-time code', async () => {
    const { api, auth } = makeApp({}, null);
    const sent = await api.auth.sendOtp({ email: 'ada@example.com', purpose: 'signin' });
    expect(sent).toMatchObject({ sent: true, channel: 'email' });
    expect(auth.sendOtp).toHaveBeenCalledWith({ email: 'ada@example.com', purpose: 'signin' });

    const session = await api.auth.verifyOtp({ email: 'ada@example.com', code: '123456' });
    expect(session.token).toBe('access-tok');
  });

  it('runs the password-reset and email-verification pair', async () => {
    const { api, auth } = makeApp({}, null);
    expect(await api.auth.requestPasswordReset('ada@example.com', 'https://app/reset')).toEqual({
      requested: true,
    });
    expect(auth.requestPasswordReset).toHaveBeenCalledWith('ada@example.com', 'https://app/reset');
    expect(await api.auth.resetPassword({ token: 't', newPassword: 'pw2' })).toEqual({ reset: true });
    expect(await api.auth.verifyEmail('vt')).toEqual({ verified: true });
  });

  it('lists social providers and starts the redirect flow', async () => {
    const { api, auth } = makeApp({}, null);
    const providers = await api.auth.socialProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({ provider: 'google', isAvailable: true });

    const started = await api.auth.oauthUrl('google', 'https://app/cb');
    expect(auth.getOAuthUrl).toHaveBeenCalledWith('google', 'https://app/cb');
    expect(started).toEqual({ url: 'https://accounts.google.com/o/x', state: 'st-1' });

    const finished = await api.auth.oauthCallback('google', 'code-1', 'st-1');
    expect(auth.handleOAuthCallback).toHaveBeenCalledWith('google', 'code-1', 'st-1');
    expect(finished.token).toBe('access-tok');
  });
});

describe('the account half (behind requireAuth)', () => {
  it('me answers the bearer of the token', async () => {
    const { api } = makeApp();
    expect(await api.auth.me()).toMatchObject({ id: 'user-1', email: 'ada@example.com' });
  });

  it('me is a 401 for a guest, not a null', async () => {
    const { api } = makeApp({}, null);
    await expect(api.auth.me()).rejects.toBeInstanceOf(AppClientError);
    await expect(api.auth.me()).rejects.toMatchObject({ status: 401 });
  });

  it('updateProfile sends the caller their own token, never a user id', async () => {
    const { api, auth } = makeApp();
    await api.auth.updateProfile({ name: 'Ada Lovelace' });
    expect(auth.updateProfile).toHaveBeenCalledWith({ name: 'Ada Lovelace' }, 'tok');
  });

  it('changePassword and logout round-trip', async () => {
    const { api, auth } = makeApp();
    expect(await api.auth.changePassword({ currentPassword: 'a', newPassword: 'b' })).toEqual({
      changed: true,
    });
    expect(auth.changePassword).toHaveBeenCalledWith(
      { currentPassword: 'a', newPassword: 'b' },
      'tok',
    );
    expect(await api.auth.logout()).toEqual({ ok: true });
  });

  it('unwraps the session list the client expects from the array the SDK returns', async () => {
    const { api, auth } = makeApp();
    const sessions = await api.auth.sessions();
    expect(auth.listSessions).toHaveBeenCalledWith('tok');
    expect(sessions).toEqual([SESSION]);
  });

  it('revokes one session and all of them', async () => {
    const { api, auth } = makeApp();
    expect(await api.auth.revokeSession('sess-2')).toEqual({ revoked: true });
    expect(auth.revokeSession).toHaveBeenCalledWith('sess-2', 'tok');
    expect(await api.auth.revokeAllSessions()).toBe(3);
  });

  it('deletes the account and exports the data', async () => {
    const { api, auth } = makeApp();
    expect(await api.auth.deleteAccount({ reason: 'done' })).toMatchObject({ deleted: true });
    expect(auth.deleteAccount).toHaveBeenCalledWith('tok', { reason: 'done' });

    const dump = await api.auth.exportData();
    expect(dump).toMatchObject({ user: { id: 'user-1' }, generatedAt: 'now' });
    expect(dump.sessions).toEqual([SESSION]);
  });

  it('every account route refuses a guest with 401', async () => {
    const { app } = makeApp();
    const routes: Array<[string, string]> = [
      ['GET', '/api/auth/me'],
      ['PATCH', '/api/auth/profile'],
      ['POST', '/api/auth/password'],
      ['POST', '/api/auth/logout'],
      ['GET', '/api/auth/sessions'],
      ['DELETE', '/api/auth/sessions'],
      ['DELETE', '/api/auth/sessions/sess-1'],
      ['DELETE', '/api/auth/account'],
      ['GET', '/api/auth/account/export'],
    ];
    for (const [method, path] of routes) {
      const res = await app.request(path, { method });
      expect([path, res.status]).toEqual([path, 401]);
    }
  });
});

describe('what must NOT be reachable', () => {
  /**
   * The service-key half of `AuthClient` on a public surface would be a user
   * directory with the door taken off. These are 404s because there is no
   * route, and this test is what keeps it that way.
   */
  it('exposes no admin, provider-config or team routes', async () => {
    const { app, auth } = makeApp();
    const forbidden: Array<[string, string]> = [
      ['GET', '/api/auth/users'],
      ['GET', '/api/auth/users/search?q=ada'],
      ['GET', '/api/auth/users/user-2'],
      ['PATCH', '/api/auth/users/user-2'],
      ['GET', '/api/auth/teams'],
      ['POST', '/api/auth/teams'],
      ['POST', '/api/auth/teams/team-1/invite'],
      ['POST', '/api/auth/oauth/google/config'],
      ['DELETE', '/api/auth/oauth/google/config'],
    ];
    for (const [method, path] of forbidden) {
      const res = await app.request(path, {
        method,
        headers: { Authorization: 'Bearer tok' },
      });
      expect([path, res.status]).toEqual([path, 404]);
    }
    // And nothing above reached the SDK on its way to that 404.
    expect(auth.listSocialProviders).not.toHaveBeenCalled();
  });

  it('refuses a provider name that is not a provider', async () => {
    const { app, auth } = makeApp();
    // Unchecked, this would interpolate into the upstream service-key path.
    const res = await app.request('/api/auth/oauth/..%2F..%2Fusers/url?redirectUrl=x');
    expect(res.status).toBe(400);
    expect(auth.getOAuthUrl).not.toHaveBeenCalled();
  });

  it('drops body fields the input type does not declare', async () => {
    const { app, auth } = makeApp();
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ada@example.com',
        password: 'pw',
        role: 'admin',
        id: 'user-2',
      }),
    });
    expect(firstArg(auth.register as jest.Mock)).toEqual({
      email: 'ada@example.com',
      password: 'pw',
    });
  });

  it('ignores a user id in the profile body — the token decides who this is', async () => {
    const { app, auth } = makeApp();
    await app.request('/api/auth/profile', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'someone-else', name: 'Ada' }),
    });
    expect(auth.updateProfile).toHaveBeenCalledWith({ name: 'Ada' }, 'tok');
  });
});

describe('validation', () => {
  const post = (app: Hono, path: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('400s on the missing required field rather than forwarding it', async () => {
    const { app, auth } = makeApp();
    expect((await post(app, '/api/auth/register', { email: 'a@b.c' })).status).toBe(400);
    expect((await post(app, '/api/auth/login', { password: 'pw' })).status).toBe(400);
    expect((await post(app, '/api/auth/refresh', {})).status).toBe(400);
    expect((await post(app, '/api/auth/otp/send', {})).status).toBe(400);
    expect((await post(app, '/api/auth/email/verify', {})).status).toBe(400);
    expect(auth.register).not.toHaveBeenCalled();
    expect(auth.login).not.toHaveBeenCalled();
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it('400s on an OTP purpose outside the known scopes', async () => {
    const { app, auth } = makeApp();
    const res = await post(app, '/api/auth/otp/send', {
      email: 'a@b.c',
      purpose: 'reset_everything',
    });
    expect(res.status).toBe(400);
    expect(auth.sendOtp).not.toHaveBeenCalled();
  });

  it('requires redirectUrl on the OAuth URL route', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/auth/oauth/google/url')).status).toBe(400);
  });
});

describe('endpoints the gateway has not shipped', () => {
  /**
   * `AuthClient` rewrites the upstream 404 into a NOT_FOUND naming the
   * endpoint. The router mounts the route anyway and lets that surface
   * verbatim — an app that hides account deletion until the gateway catches
   * up fails App Store review, and one that fakes it lies to the user.
   */
  it('surfaces the "not implemented here" 404 honestly', async () => {
    const { api, auth } = makeApp();
    auth.deleteAccount.mockRejectedValueOnce(
      new XenitionError(
        'NOT_FOUND',
        'AuthClient.deleteAccount: this deployment does not implement ' +
          '/app-platform/auth/account. See docs/PLATFORM-ENDPOINTS.md for what the gateway ' +
          'needs to expose.',
      ),
    );
    await expect(api.auth.deleteAccount()).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    await expect(api.auth.deleteAccount()).resolves.toMatchObject({ deleted: true });
  });
});

describe('rate limiting', () => {
  it('holds the credential routes to a tighter budget than the writes', async () => {
    // rateLimit: 10 is the write default; the credential routes cap at 5.
    const { app } = makeApp({ rateLimit: 10 });
    const login = () =>
      app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '1.2.3.4' },
        body: JSON.stringify({ email: 'a@b.c', password: 'pw' }),
      });

    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await login()).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
  });

  it('a lower global limit still applies — Math.min, not a default', async () => {
    const { app } = makeApp({ rateLimit: 2 });
    const send = () =>
      app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '5.6.7.8' },
        body: JSON.stringify({ email: 'a@b.c', password: 'pw' }),
      });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });
});

describe('response normalization', () => {
  it('camelCases the nested user and session an engine served snake_case', async () => {
    const { api, auth } = makeApp({}, null);
    (auth.login as jest.Mock).mockResolvedValueOnce({
      user: { id: 'user-1', email: 'ada@example.com', created_at: 'then' },
      session: { id: 'sess-1', user_id: 'user-1', expires_at: 'later' },
      token: 'access-tok',
      refresh_token: 'refresh-tok',
      expires_at: 1,
    } as unknown as AuthResponse);

    const result = await api.auth.login({ email: 'ada@example.com', password: 'pw' });
    expect(result).toMatchObject({
      refreshToken: 'refresh-tok',
      expiresAt: 1,
      user: { createdAt: 'then' },
      session: { userId: 'user-1', expiresAt: 'later' },
    });
  });
});
