import { AuthClient } from './auth-client';
import { XenitionError } from '../core/errors';
import {
  AuthChangeEvent,
  DEFAULT_REFRESH_MARGIN_MS,
  SessionManager,
  SessionManagerOptions,
} from './session-manager';
import { MemorySessionStore, SessionStore, StoredSession } from './session-store';
import { AuthResponse, User } from './types';

/**
 * The manager's only dependency is a handful of AuthClient methods, so a
 * bare mock stands in for the whole thing — the same pattern as
 * auth-client.spec.ts. Nothing here needs a gateway, which matters
 * doubly because `POST /app-platform/auth/refresh` does not exist on one
 * yet (docs/PLATFORM-ENDPOINTS.md §1); the 404 it answers today is one
 * of the cases pinned below.
 */
const USER: User = {
  id: 'user-1',
  email: 'a@example.com',
  role: 'authenticated',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** Frozen clock. 1767225600 is 2026-01-01T00:00:00Z in epoch seconds. */
const NOW_S = 1767225600;
const NOW_MS = NOW_S * 1000;

/**
 * A sign-in response whose access token dies `lifetimeS` seconds from
 * "now" — read off the fake clock at the moment it is built, so a
 * response minted inside a later refresh describes a token with a real
 * remaining life rather than one measured from the start of the test.
 */
const response = (lifetimeS: number, suffix = '1'): AuthResponse => ({
  user: USER,
  session: { id: `s-${suffix}`, userId: USER.id, expiresAt: 'e', createdAt: 'c' },
  token: `access-${suffix}`,
  refreshToken: `refresh-${suffix}`,
  expiresAt: Math.floor(Date.now() / 1000) + lifetimeS,
});

const makeAuth = () => {
  const login = jest.fn<Promise<AuthResponse>, [unknown]>();
  const register = jest.fn<Promise<AuthResponse>, [unknown]>();
  const refresh = jest.fn<Promise<AuthResponse>, [string]>();
  const logout = jest.fn().mockResolvedValue({ ok: true });
  const client = { login, register, refresh, logout } as unknown as AuthClient;
  return { login, register, refresh, logout, client };
};

/** A manager plus the event log every test asserts against. */
const makeManager = (options: SessionManagerOptions = {}) => {
  const auth = makeAuth();
  const store = options.store ?? new MemorySessionStore();
  const manager = new SessionManager(auth.client, { ...options, store });
  const events: Array<[AuthChangeEvent, string | null]> = [];
  const unsubscribe = manager.onAuthStateChange((event, session) =>
    events.push([event, session?.token ?? null]),
  );
  return { ...auth, store, manager, events, unsubscribe };
};

/** A store that records calls, for the "did it actually persist" assertions. */
const spyStore = (initial: StoredSession | null = null) => {
  const inner = new MemorySessionStore();
  if (initial) inner.set(initial);
  return {
    get: jest.fn(() => inner.get()),
    set: jest.fn((session: StoredSession) => inner.set(session)),
    clear: jest.fn(() => inner.clear()),
  } satisfies SessionStore;
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW_MS);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('SessionManager — a session survives past the call that created it', () => {
  it('persists the session after login and announces the sign-in', async () => {
    const store = spyStore();
    const { login, manager, events } = makeManager({ store });
    login.mockResolvedValue(response(600));

    await manager.login({ email: 'a@example.com', password: 'pw' });

    expect(store.set).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'access-1', refreshToken: 'refresh-1' }),
    );
    expect(events).toEqual([['SIGNED_IN', 'access-1']]);
  });

  it('persists the session after register too', async () => {
    const store = spyStore();
    const { register, manager, events } = makeManager({ store });
    register.mockResolvedValue(response(600));

    await manager.register({ email: 'a@example.com', password: 'pw' });

    expect(store.set).toHaveBeenCalledTimes(1);
    expect(events).toEqual([['SIGNED_IN', 'access-1']]);
  });

  it('returns the untouched AuthResponse so callers still see the user record', async () => {
    const { login, manager } = makeManager();
    const auth = response(600);
    login.mockResolvedValue(auth);
    await expect(manager.login({ email: 'a@example.com', password: 'pw' })).resolves.toBe(auth);
  });

  it('adopts a session minted by any other sign-in door', async () => {
    // verifyOtp, signInWithIdToken and handleOAuthCallback all return the
    // same AuthResponse; without adopt() a social login leaves the app
    // silently behaving as signed out.
    const store = spyStore();
    const { manager, events } = makeManager({ store });

    await manager.adopt(response(600));

    expect(store.set).toHaveBeenCalledTimes(1);
    expect(events).toEqual([['SIGNED_IN', 'access-1']]);
  });

  it('normalizes the gateway expiry to milliseconds when it stores it', async () => {
    const { login, manager } = makeManager();
    login.mockResolvedValue(response(600));
    await manager.login({ email: 'a@example.com', password: 'pw' });
    await expect(manager.getSession()).resolves.toMatchObject({
      expiresAt: NOW_MS + 600_000,
    });
  });
});

describe('SessionManager — restoring on launch', () => {
  const stored: StoredSession = {
    user: USER,
    token: 'access-stored',
    refreshToken: 'refresh-stored',
    expiresAt: NOW_MS + 600_000,
  };

  it('reads the session back out of the store on demand', async () => {
    const { manager } = makeManager({ store: spyStore(stored) });
    await expect(manager.getSession()).resolves.toEqual(stored);
  });

  it('does not hit the network to answer which screen to show', async () => {
    // Blocking the launch decision on a round trip is what produces a
    // splash screen that hangs on a bad connection.
    const { refresh, manager } = makeManager({ store: spyStore(stored) });
    await manager.getSession();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reads the store once and serves later calls from memory', async () => {
    // getAccessToken runs per request and the store may be the keychain.
    const store = spyStore(stored);
    const { manager } = makeManager({ store });
    await manager.getSession();
    await manager.getSession();
    await manager.getAccessToken();
    expect(store.get).toHaveBeenCalledTimes(1);
  });

  it('reports no session when the store is empty', async () => {
    const { manager } = makeManager();
    await expect(manager.getSession()).resolves.toBeNull();
    await expect(manager.getAccessToken()).resolves.toBeNull();
  });
});

describe('SessionManager — signing out', () => {
  it('revokes on the server, clears locally and announces the sign-out', async () => {
    const store = spyStore();
    const { login, logout, manager, events } = makeManager({ store });
    login.mockResolvedValue(response(600));
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await manager.logout();

    expect(logout).toHaveBeenCalledWith('access-1');
    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(await manager.getSession()).toBeNull();
    expect(events).toEqual([
      ['SIGNED_IN', 'access-1'],
      ['SIGNED_OUT', null],
    ]);
  });

  it('still signs the device out when the server call fails', async () => {
    // A user who taps sign out on a train and stays signed in has been
    // ignored on the one action where that is a security problem.
    const { login, logout, manager, events } = makeManager();
    login.mockResolvedValue(response(600));
    logout.mockRejectedValue(new XenitionError('NETWORK_ERROR', 'offline'));
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await expect(manager.logout()).resolves.toBeUndefined();

    expect(await manager.getSession()).toBeNull();
    expect(events).toContainEqual(['SIGNED_OUT', null]);
  });
});

describe('SessionManager — background refresh happens before expiry, not after a 401', () => {
  it('refreshes one margin ahead of the expiry and not a moment sooner', async () => {
    const { login, refresh, manager, events } = makeManager();
    login.mockResolvedValue(response(600));
    refresh.mockResolvedValue(response(600, '2'));
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await jest.advanceTimersByTimeAsync(600_000 - DEFAULT_REFRESH_MARGIN_MS - 1);
    expect(refresh).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(2);
    expect(refresh).toHaveBeenCalledWith('refresh-1');
    expect(events).toEqual([
      ['SIGNED_IN', 'access-1'],
      ['TOKEN_REFRESHED', 'access-2'],
    ]);
  });

  it('stores the NEW refresh token, because the gateway rotates them', async () => {
    // The gateway is asked to invalidate the token it was handed, so
    // keeping the old one makes the second refresh fail.
    const { login, refresh, manager } = makeManager();
    login.mockResolvedValue(response(600));
    refresh.mockResolvedValue(response(600, '2'));
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await jest.advanceTimersByTimeAsync(600_000 - DEFAULT_REFRESH_MARGIN_MS);

    await expect(manager.getSession()).resolves.toMatchObject({
      token: 'access-2',
      refreshToken: 'refresh-2',
    });
  });

  it('keeps refreshing for as long as the session lives', async () => {
    const { login, refresh, manager } = makeManager();
    login.mockResolvedValue(response(600));
    // Built at call time, so each refresh really does buy another 600s.
    refresh.mockImplementation(async () => response(600, `${Date.now()}`));
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await jest.advanceTimersByTimeAsync(600_000 - DEFAULT_REFRESH_MARGIN_MS);
    await jest.advanceTimersByTimeAsync(600_000 - DEFAULT_REFRESH_MARGIN_MS);

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('arms no timer when the server did not say when the token expires', async () => {
    const { login, refresh, manager } = makeManager();
    login.mockResolvedValue({ ...response(600), expiresAt: undefined as unknown as number });
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    // Unknown is not expired: the token is used until a request 401s.
    expect(refresh).not.toHaveBeenCalled();
    await expect(manager.getAccessToken()).resolves.toBe('access-1');
  });

  it('arms no timer at all when autoRefresh is off', async () => {
    // Cloudflare Workers have no long-lived process for a timer to fire in.
    const { login, refresh, manager } = makeManager({ autoRefresh: false });
    login.mockResolvedValue(response(600));
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(refresh).not.toHaveBeenCalled();
  });

  it('still refreshes lazily inside getAccessToken when autoRefresh is off', async () => {
    const { login, refresh, manager } = makeManager({ autoRefresh: false });
    login.mockResolvedValue(response(600));
    refresh.mockResolvedValue(response(600, '2'));
    await manager.login({ email: 'a@example.com', password: 'pw' });

    jest.setSystemTime(NOW_MS + 600_000 - 30_000);

    await expect(manager.getAccessToken()).resolves.toBe('access-2');
  });

  it('does not refresh a token that is still comfortably alive', async () => {
    const { login, refresh, manager } = makeManager();
    login.mockResolvedValue(response(600));
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await expect(manager.getAccessToken()).resolves.toBe('access-1');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('honours a caller-chosen margin for a deployment with short tokens', async () => {
    const { login, refresh, manager } = makeManager({ refreshMarginMs: 5_000 });
    login.mockResolvedValue(response(60));
    refresh.mockResolvedValue(response(60, '2'));
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await jest.advanceTimersByTimeAsync(54_999);
    expect(refresh).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('SessionManager — concurrent callers share one refresh', () => {
  /**
   * Six screens rendering at once all discover the same expiring token in
   * the same millisecond. On a gateway that rotates refresh tokens the
   * first refresh invalidates the token the other five are holding, so
   * five of them fail — and the last failure signs a healthy user out.
   */
  it('fires one request no matter how many callers ask at once', async () => {
    const { login, refresh, manager } = makeManager();
    login.mockResolvedValue(response(600));
    let release: (value: AuthResponse) => void = () => undefined;
    refresh.mockReturnValue(
      new Promise<AuthResponse>((resolve) => {
        release = resolve;
      }),
    );
    await manager.login({ email: 'a@example.com', password: 'pw' });

    const inFlight = [manager.refresh(), manager.refresh(), manager.refresh()];
    release(response(600, '2'));
    const results = await Promise.all(inFlight);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(results.map((session) => session?.token)).toEqual([
      'access-2',
      'access-2',
      'access-2',
    ]);
  });

  it('announces the refresh once, not once per waiting caller', async () => {
    const { login, refresh, manager, events } = makeManager();
    login.mockResolvedValue(response(600));
    refresh.mockResolvedValue(response(600, '2'));
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await Promise.all([manager.refresh(), manager.refresh()]);

    expect(events.filter(([event]) => event === 'TOKEN_REFRESHED')).toHaveLength(1);
  });

  it('starts a fresh request once the shared one has settled', async () => {
    // The shared promise is a de-duplicator, not a cache — a later refresh
    // must still reach the server.
    const { login, refresh, manager } = makeManager();
    login.mockResolvedValue(response(600));
    refresh.mockResolvedValue(response(600, '2'));
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await manager.refresh();
    await manager.refresh();

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('lets every waiting caller see the same failure', async () => {
    const { login, refresh, manager } = makeManager();
    login.mockResolvedValue(response(600));
    refresh.mockRejectedValue(new XenitionError('AUTH_INVALID_TOKEN', 'rotated away'));
    await manager.login({ email: 'a@example.com', password: 'pw' });

    const results = await Promise.allSettled([manager.refresh(), manager.refresh()]);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  });

  it('does nothing when there is no session to refresh', async () => {
    const { refresh, manager, events } = makeManager();
    await expect(manager.refresh()).resolves.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    // Never signed in is not a state change, so nothing is announced.
    expect(events).toEqual([]);
  });
});

describe('SessionManager — a refresh that fails clears the session and stops', () => {
  /**
   * `POST /app-platform/auth/refresh` 404s on the gateway today and
   * AuthClient rewrites that into a NOT_FOUND naming the endpoint. A
   * retry loop against an endpoint that does not exist would run until
   * the app is killed, so a failure is terminal: clear once, announce
   * once, never ask again.
   */
  const NOT_SHIPPED = new XenitionError(
    'NOT_FOUND',
    'AuthClient.refresh: this deployment does not implement /app-platform/auth/refresh.',
  );

  it('treats a gateway that has not shipped /auth/refresh as cannot-refresh', async () => {
    const store = spyStore();
    const { login, refresh, manager, events } = makeManager({ store });
    login.mockResolvedValue(response(600));
    refresh.mockRejectedValue(NOT_SHIPPED);
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await jest.advanceTimersByTimeAsync(600_000 - DEFAULT_REFRESH_MARGIN_MS);

    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(await manager.getSession()).toBeNull();
    expect(events).toEqual([
      ['SIGNED_IN', 'access-1'],
      ['SIGNED_OUT', null],
    ]);
  });

  it('never retries the failed refresh, however long the app stays open', async () => {
    const { login, refresh, manager } = makeManager();
    login.mockResolvedValue(response(600));
    refresh.mockRejectedValue(NOT_SHIPPED);
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await jest.advanceTimersByTimeAsync(600_000 - DEFAULT_REFRESH_MARGIN_MS);
    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not crash the process when the failure happens on the timer', async () => {
    // An unhandled rejection raised from a timer callback has no caller to
    // catch it: Node terminates, React Native shows a red screen.
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { login, refresh, manager } = makeManager();
      login.mockResolvedValue(response(600));
      refresh.mockRejectedValue(NOT_SHIPPED);
      await manager.login({ email: 'a@example.com', password: 'pw' });

      await jest.advanceTimersByTimeAsync(600_000 - DEFAULT_REFRESH_MARGIN_MS);
      await Promise.resolve();

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('rejects an explicit refresh with the real reason, having already cleaned up', async () => {
    const { login, refresh, manager } = makeManager();
    login.mockResolvedValue(response(600));
    refresh.mockRejectedValue(NOT_SHIPPED);
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await expect(manager.refresh()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await manager.getSession()).toBeNull();
  });

  it('leaves getAccessToken answering null rather than throwing at request time', async () => {
    const { login, refresh, manager } = makeManager();
    login.mockResolvedValue(response(600));
    refresh.mockRejectedValue(NOT_SHIPPED);
    await manager.login({ email: 'a@example.com', password: 'pw' });
    jest.setSystemTime(NOW_MS + 600_000 - 30_000);

    await expect(manager.getAccessToken()).resolves.toBeNull();
  });

  it('announces the sign-out exactly once even if several callers were waiting', async () => {
    const { login, refresh, manager, events } = makeManager();
    login.mockResolvedValue(response(600));
    refresh.mockRejectedValue(NOT_SHIPPED);
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await Promise.allSettled([manager.refresh(), manager.refresh()]);

    expect(events.filter(([event]) => event === 'SIGNED_OUT')).toHaveLength(1);
  });

  it('stops instead of spinning when the gateway returns an already-dead session', async () => {
    // A "successful" refresh that hands back an expired token would
    // schedule the next refresh immediately, forever.
    const { login, refresh, manager, events } = makeManager();
    login.mockResolvedValue(response(600));
    refresh.mockResolvedValue(response(-10, '2'));
    await manager.login({ email: 'a@example.com', password: 'pw' });

    await expect(manager.refresh()).rejects.toMatchObject({ code: 'AUTH_EXPIRED_TOKEN' });

    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(['SIGNED_OUT', null]);
  });
});

describe('SessionManager.onAuthStateChange', () => {
  it('says nothing at subscribe time', async () => {
    // A listener that received SIGNED_OUT before the store had been read
    // would bounce a signed-in user to the login screen on every launch.
    const { events } = makeManager({ store: new MemorySessionStore() });
    expect(events).toEqual([]);
  });

  it('stops delivering after the returned unsubscribe is called', async () => {
    const { login, manager, events, unsubscribe } = makeManager();
    login.mockResolvedValue(response(600));

    unsubscribe();
    await manager.login({ email: 'a@example.com', password: 'pw' });

    expect(events).toEqual([]);
  });

  it('survives a double unsubscribe without dropping someone else', async () => {
    // React StrictMode runs effect cleanups twice.
    const { login, manager, events, unsubscribe } = makeManager();
    const other: AuthChangeEvent[] = [];
    manager.onAuthStateChange((event) => other.push(event));
    login.mockResolvedValue(response(600));

    unsubscribe();
    unsubscribe();
    await manager.login({ email: 'a@example.com', password: 'pw' });

    expect(events).toEqual([]);
    expect(other).toEqual(['SIGNED_IN']);
  });

  it('lets a listener unsubscribe itself mid-notification without skipping the next one', async () => {
    const { login, manager } = makeManager();
    const seen: string[] = [];
    const off = manager.onAuthStateChange(() => {
      seen.push('first');
      off();
    });
    manager.onAuthStateChange(() => seen.push('second'));
    login.mockResolvedValue(response(600));

    await manager.login({ email: 'a@example.com', password: 'pw' });

    expect(seen).toEqual(['first', 'second']);
  });

  it('does not let a throwing listener break the sign-in', async () => {
    // Same rule as HttpClient's observability hooks: adding a listener
    // must never become a way to break production.
    const { login, manager } = makeManager();
    manager.onAuthStateChange(() => {
      throw new Error('listener blew up');
    });
    const survivor = jest.fn();
    manager.onAuthStateChange(survivor);
    login.mockResolvedValue(response(600));

    await expect(manager.login({ email: 'a@example.com', password: 'pw' })).resolves.toBeDefined();

    expect(survivor).toHaveBeenCalledWith('SIGNED_IN', expect.objectContaining({ token: 'access-1' }));
    await expect(manager.getSession()).resolves.toMatchObject({ token: 'access-1' });
  });

  it('does not let a throwing listener break a sign-out either', async () => {
    const { login, manager } = makeManager();
    login.mockResolvedValue(response(600));
    await manager.login({ email: 'a@example.com', password: 'pw' });
    manager.onAuthStateChange(() => {
      throw new Error('listener blew up');
    });

    await expect(manager.logout()).resolves.toBeUndefined();
    await expect(manager.getSession()).resolves.toBeNull();
  });
});

describe('SessionManager.destroy', () => {
  it('stops the refresh timer so an abandoned manager goes quiet', async () => {
    const { login, refresh, manager } = makeManager();
    login.mockResolvedValue(response(600));
    await manager.login({ email: 'a@example.com', password: 'pw' });

    manager.destroy();
    await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(refresh).not.toHaveBeenCalled();
  });

  it('drops every listener', async () => {
    const { login, manager, events } = makeManager();
    login.mockResolvedValue(response(600));

    manager.destroy();
    await manager.login({ email: 'a@example.com', password: 'pw' });

    expect(events).toEqual([]);
  });
});
