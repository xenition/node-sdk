import { Hono } from 'hono';
import { XenitionClient } from '../xenition-client';
import { XenitionError } from '../core/errors';
import type { User } from '../auth/types';
import {
  bearerToken,
  currentUser,
  currentUserId,
  requireAuth,
  requireUser,
  xenitionAuth,
} from './auth';
import { honoErrorHandler } from './errors';

/**
 * The middleware's only dependency is `client.auth.verifyToken`, so a stub
 * client stands in for the platform. These tests pin the contract the
 * routers rely on: who gets through, what the 401 body looks like, and —
 * most importantly — that a broken PLATFORM never masquerades as a bad
 * CALLER token.
 */
const USER: User = {
  id: 'user-1',
  email: 'a@example.com',
  role: 'authenticated',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const makeClient = (verify?: jest.Mock) => {
  const verifyToken = verify ?? jest.fn().mockResolvedValue(USER);
  return {
    verifyToken,
    client: { auth: { verifyToken } } as unknown as XenitionClient,
  };
};

/** App with `requireAuth` on /private and the shared error handler wired. */
const makeApp = (client: XenitionClient, options = {}) => {
  const app = new Hono();
  app.onError(honoErrorHandler);
  app.use('/private/*', requireAuth({ client, ...options }));
  app.get('/private/me', (c) => c.json(requireUser(c)));
  app.use('/public/*', xenitionAuth({ client, ...options }));
  app.get('/public/who', (c) => c.json({ id: currentUserId(c) ?? null }));
  return app;
};

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe('bearerToken', () => {
  const tokenFor = (header?: string): string | undefined => {
    const c = {
      req: { header: (name: string) => (name.toLowerCase() === 'authorization' ? header : undefined) },
    };
    return bearerToken(c as never);
  };

  it('reads a well-formed header', () => {
    expect(tokenFor('Bearer abc123')).toBe('abc123');
  });

  it('accepts a lowercase scheme', () => {
    expect(tokenFor('bearer abc123')).toBe('abc123');
  });

  it('trims whitespace a shell-built header leaves behind', () => {
    expect(tokenFor('Bearer  abc123 \n')).toBe('abc123');
  });

  it('ignores a missing header, a bare scheme, and a different scheme', () => {
    expect(tokenFor(undefined)).toBeUndefined();
    expect(tokenFor('Bearer')).toBeUndefined();
    expect(tokenFor('Bearer   ')).toBeUndefined();
    expect(tokenFor('Basic abc123')).toBeUndefined();
  });
});

describe('requireAuth', () => {
  it('lets a valid token through and exposes the user', async () => {
    const { client, verifyToken } = makeClient();
    const res = await makeApp(client).request('/private/me', auth('tok'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      id: 'user-1',
      email: 'a@example.com',
      accessToken: 'tok',
    });
    expect(verifyToken).toHaveBeenCalledWith('tok');
  });

  it('401s with UNAUTHENTICATED when no token is sent', async () => {
    const { client, verifyToken } = makeClient();
    const res = await makeApp(client).request('/private/me');
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: { code: 'UNAUTHENTICATED', message: expect.stringContaining('Authorization') },
    });
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('401s with AUTH_INVALID_TOKEN when the platform rejects the token', async () => {
    const verify = jest.fn().mockRejectedValue(new XenitionError('AUTH_INVALID_TOKEN', 'nope'));
    const { client } = makeClient(verify);
    const res = await makeApp(client).request('/private/me', auth('bad'));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: 'AUTH_INVALID_TOKEN' },
    });
  });

  it('401s on an expired token', async () => {
    const verify = jest.fn().mockRejectedValue(new XenitionError('AUTH_EXPIRED_TOKEN', 'old'));
    const { client } = makeClient(verify);
    const res = await makeApp(client).request('/private/me', auth('old'));
    expect(res.status).toBe(401);
  });

  it('does NOT turn a platform outage into a 401', async () => {
    // The worker's own service key or the platform is the problem here —
    // answering 401 would send the app into a pointless re-login loop.
    const verify = jest.fn().mockRejectedValue(new XenitionError('SERVER_ERROR', 'upstream down'));
    const { client } = makeClient(verify);
    const res = await makeApp(client).request('/private/me', auth('tok'));
    expect(res.status).toBe(502);
  });

  it('never leaks the token back in the error body', async () => {
    const verify = jest.fn().mockRejectedValue(new XenitionError('AUTH_INVALID_TOKEN', 'nope'));
    const { client } = makeClient(verify);
    const res = await makeApp(client).request('/private/me', auth('super-secret-token'));
    expect(await res.text()).not.toContain('super-secret-token');
  });
});

describe('xenitionAuth (optional)', () => {
  it('serves guests without a token', async () => {
    const { client, verifyToken } = makeClient();
    const res = await makeApp(client).request('/public/who');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: null });
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('populates the user when a valid token is present', async () => {
    const { client } = makeClient();
    const res = await makeApp(client).request('/public/who', auth('tok'));
    await expect(res.json()).resolves.toEqual({ id: 'user-1' });
  });

  it('serves a guest rather than 401 when the token is bad', async () => {
    const verify = jest.fn().mockRejectedValue(new XenitionError('AUTH_INVALID_TOKEN', 'nope'));
    const { client } = makeClient(verify);
    const res = await makeApp(client).request('/public/who', auth('bad'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: null });
  });
});

describe('verification cache', () => {
  it('verifies once for repeated requests with the same token', async () => {
    const { client, verifyToken } = makeClient();
    const app = makeApp(client);
    await app.request('/private/me', auth('tok'));
    await app.request('/private/me', auth('tok'));
    await app.request('/private/me', auth('tok'));
    expect(verifyToken).toHaveBeenCalledTimes(1);
  });

  it('keeps different tokens apart', async () => {
    const verify = jest.fn(async (token: string) => ({ ...USER, id: `user-${token}` }));
    const { client } = makeClient(verify as unknown as jest.Mock);
    const app = makeApp(client);
    const a = await app.request('/public/who', auth('a'));
    const b = await app.request('/public/who', auth('b'));
    await expect(a.json()).resolves.toEqual({ id: 'user-a' });
    await expect(b.json()).resolves.toEqual({ id: 'user-b' });
  });

  it('verifies on every request when the cache is disabled', async () => {
    const { client, verifyToken } = makeClient();
    const app = makeApp(client, { cacheTtlSeconds: 0 });
    await app.request('/private/me', auth('tok'));
    await app.request('/private/me', auth('tok'));
    expect(verifyToken).toHaveBeenCalledTimes(2);
  });

  it('re-verifies once the entry has expired', async () => {
    jest.useFakeTimers();
    try {
      const { client, verifyToken } = makeClient();
      const app = makeApp(client, { cacheTtlSeconds: 60 });
      await app.request('/private/me', auth('tok'));
      jest.setSystemTime(Date.now() + 61_000);
      await app.request('/private/me', auth('tok'));
      expect(verifyToken).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('stays bounded when sprayed with distinct tokens', async () => {
    const { client } = makeClient();
    const app = makeApp(client, { cacheMaxEntries: 4 });
    for (let i = 0; i < 50; i++) {
      const res = await app.request('/private/me', auth(`tok-${i}`));
      expect(res.status).toBe(200);
    }
  });
});

describe('requireUser', () => {
  it('fails loudly when the route was mounted without requireAuth', async () => {
    const app = new Hono();
    app.onError(honoErrorHandler);
    app.get('/oops', (c) => c.json(requireUser(c)));
    const res = await app.request('/oops');
    // A wiring bug, surfaced as an operator-facing 500 — never a silent
    // undefined that reads as "no user" and quietly serves everyone's data.
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'CONFIG_ERROR' } });
  });

  it('currentUser is undefined for an unauthenticated request', async () => {
    const app = new Hono();
    app.get('/x', (c) => c.json({ user: currentUser(c) ?? null }));
    await expect((await app.request('/x')).json()).resolves.toEqual({ user: null });
  });
});
