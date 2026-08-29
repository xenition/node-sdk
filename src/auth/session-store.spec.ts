import {
  DEFAULT_SESSION_KEY,
  KeyValueStorage,
  MemorySessionStore,
  StoredSession,
  createKeyValueSessionStore,
  isStoredSession,
  toExpiryMs,
  toStoredSession,
} from './session-store';
import { AuthResponse, User } from './types';

const USER: User = {
  id: 'user-1',
  email: 'a@example.com',
  role: 'authenticated',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** The wire shape documented in docs/PLATFORM-ENDPOINTS.md §1. */
const RESPONSE: AuthResponse = {
  user: USER,
  session: { id: 's1', userId: 'user-1', expiresAt: 'e', createdAt: 'c' },
  token: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1767225600,
};

const SESSION: StoredSession = {
  user: USER,
  token: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1767225600_000,
};

/** A `localStorage`-shaped double — the same three methods RN and Expo expose. */
const makeStorage = (initial?: Record<string, string>) => {
  const values = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    values,
    getItem: jest.fn((key: string) => values.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: jest.fn((key: string) => {
      values.delete(key);
    }),
  } satisfies KeyValueStorage & { values: Map<string, string> };
};

describe('toExpiryMs — the seconds-vs-milliseconds decision', () => {
  /**
   * The gateway documents epoch SECONDS. Comparing that number against
   * Date.now() puts every expiry in 1970, so every restored session looks
   * expired and the user is signed out on launch.
   */
  it('reads the gateway expiresAt as seconds and returns milliseconds', () => {
    expect(toExpiryMs(1767225600)).toBe(1767225600_000);
  });

  it('leaves a value that is already milliseconds alone', () => {
    expect(toExpiryMs(1767225600_000)).toBe(1767225600_000);
  });

  it('reports a missing or nonsense expiry as unknown rather than as expired', () => {
    // "Unknown" must not be turned into "expired": that would send a
    // perfectly good token into a refresh it does not need.
    expect(toExpiryMs(undefined)).toBe(0);
    expect(toExpiryMs(null)).toBe(0);
    expect(toExpiryMs('1767225600')).toBe(0);
    expect(toExpiryMs(Number.NaN)).toBe(0);
    expect(toExpiryMs(Number.POSITIVE_INFINITY)).toBe(0);
    expect(toExpiryMs(-1)).toBe(0);
  });
});

describe('toStoredSession', () => {
  it('keeps only what is needed to resume, with the expiry normalized', () => {
    expect(toStoredSession(RESPONSE)).toEqual(SESSION);
  });

  it('does not persist the server-side session record', () => {
    // It describes the session (ip, user agent, id) rather than restoring
    // it, and writing it to a keychain entry only widens what leaks.
    expect(toStoredSession(RESPONSE)).not.toHaveProperty('session');
  });
});

describe('isStoredSession — storage is untrusted input', () => {
  it('accepts a whole session', () => {
    expect(isStoredSession(SESSION)).toBe(true);
  });

  const broken: Array<[string, unknown]> = [
    ['null', null],
    ['a string', 'access-1'],
    ['an empty object', {}],
    ['a session with no token', { ...SESSION, token: '' }],
    ['a session with no user', { ...SESSION, user: null }],
    ['a session whose expiry is a string', { ...SESSION, expiresAt: '123' }],
    ['a session with no refresh token', { ...SESSION, refreshToken: undefined }],
  ];
  it.each(broken)('rejects %s', (_label, value) => {
    // A half-session read as real produces `Bearer undefined` on every
    // request, which the server answers 401 and the app reports to the
    // user as "wrong password".
    expect(isStoredSession(value)).toBe(false);
  });
});

describe('MemorySessionStore', () => {
  it('returns null before anything has been stored', () => {
    expect(new MemorySessionStore().get()).toBeNull();
  });

  it('round-trips a session and forgets it on clear', () => {
    const store = new MemorySessionStore();
    store.set(SESSION);
    expect(store.get()).toEqual(SESSION);
    store.clear();
    expect(store.get()).toBeNull();
  });
});

describe('createKeyValueSessionStore', () => {
  it('writes JSON under a namespaced key so it cannot collide with app state', async () => {
    const storage = makeStorage();
    const store = createKeyValueSessionStore(storage);
    await store.set(SESSION);
    expect(storage.setItem).toHaveBeenCalledWith(DEFAULT_SESSION_KEY, JSON.stringify(SESSION));
  });

  it('honours a caller-supplied key', async () => {
    const storage = makeStorage();
    const store = createKeyValueSessionStore(storage, 'my-app.session');
    await store.set(SESSION);
    await store.get();
    expect(storage.getItem).toHaveBeenCalledWith('my-app.session');
  });

  it('reads back exactly what it wrote', async () => {
    const storage = makeStorage();
    const store = createKeyValueSessionStore(storage);
    await store.set(SESSION);
    await expect(store.get()).resolves.toEqual(SESSION);
  });

  it('reports no session when the key is empty', async () => {
    const store = createKeyValueSessionStore(makeStorage());
    await expect(store.get()).resolves.toBeNull();
  });

  it('deletes a truncated value instead of throwing on every launch', async () => {
    // A process killed mid-write leaves unparseable JSON. Throwing from
    // the restore path leaves the app unable to reach even the login
    // screen, and unfixable without a reinstall.
    const storage = makeStorage({ [DEFAULT_SESSION_KEY]: '{"token":"acc' });
    const store = createKeyValueSessionStore(storage);
    await expect(store.get()).resolves.toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(DEFAULT_SESSION_KEY);
  });

  it('deletes a value that parses but is not a session', async () => {
    const storage = makeStorage({ [DEFAULT_SESSION_KEY]: '{"token":"acc"}' });
    const store = createKeyValueSessionStore(storage);
    await expect(store.get()).resolves.toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(DEFAULT_SESSION_KEY);
  });

  it('clears by removing the key', async () => {
    const storage = makeStorage();
    const store = createKeyValueSessionStore(storage);
    await store.set(SESSION);
    await store.clear();
    expect(storage.values.has(DEFAULT_SESSION_KEY)).toBe(false);
  });

  it('works over a promise-based storage as well as a synchronous one', async () => {
    // AsyncStorage and expo-secure-store return promises; localStorage does
    // not. One adapter has to serve both without the caller adapting.
    const values = new Map<string, string>();
    const asyncStorage: KeyValueStorage = {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value);
      },
      removeItem: async (key) => {
        values.delete(key);
      },
    };
    const store = createKeyValueSessionStore(asyncStorage);
    await store.set(SESSION);
    await expect(store.get()).resolves.toEqual(SESSION);
    await store.clear();
    await expect(store.get()).resolves.toBeNull();
  });
});
