import { XenitionError } from '../core/errors';
import {
  createAppleNonce,
  readCallbackUrl,
  signInWithProvider,
  SignInCancelled,
  type AuthSessionResult,
  type MobileAuthClient,
} from './index';

const SESSION = { token: 'access-tok', refreshToken: 'refresh-tok', user: { id: 'u1' } } as never;

const makeClient = (overrides: Partial<MobileAuthClient> = {}) => {
  const client = {
    startSignIn: jest.fn(async () => ({ url: 'https://consent.example/auth', usingSSO: true })),
    completeSignIn: jest.fn(async () => SESSION),
    signInWithIdToken: jest.fn(async () => SESSION),
    ...overrides,
  };
  return client as unknown as MobileAuthClient & typeof client;
};

const opener = (result: AuthSessionResult) => jest.fn(async () => result);

const notConfigured = () =>
  new XenitionError('AUTH_PROVIDER_NOT_CONFIGURED', 'native google sign-in is not configured', {
    status: 412,
  });

describe('signInWithProvider lane selection', () => {
  it('uses the brokered lane when the app has no native sign-in wired up', async () => {
    const client = makeClient();
    const open = opener({ type: 'success', url: 'myapp://auth?code=code-1' });

    const result = await signInWithProvider({
      client,
      provider: 'github',
      returnTo: 'myapp://auth',
      openAuthSession: open,
    });

    expect(result.lane).toBe('brokered');
    expect(client.startSignIn).toHaveBeenCalledWith('github', 'myapp://auth');
    expect(open).toHaveBeenCalledWith('https://consent.example/auth', 'myapp://auth');
    expect(client.completeSignIn).toHaveBeenCalledWith('code-1');
  });

  it('prefers native when the app can produce an id token', async () => {
    const client = makeClient();
    const open = opener({ type: 'cancel' });

    const result = await signInWithProvider({
      client,
      provider: 'google',
      returnTo: 'myapp://auth',
      native: async () => ({ idToken: 'id-tok', nonce: 'raw-nonce' }),
      openAuthSession: open,
    });

    expect(result.lane).toBe('native');
    expect(client.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'google',
      idToken: 'id-tok',
      nonce: 'raw-nonce',
      name: undefined,
    });
    // No browser was opened at all — that is the whole point of the fast lane.
    expect(open).not.toHaveBeenCalled();
    expect(client.startSignIn).not.toHaveBeenCalled();
  });

  /**
   * This is the upgrade path working with no code change: an app ships with
   * native wired up, the server says it has no credentials of its own yet, and
   * the user still gets signed in through the browser. The day the app
   * registers its client ids, the same call starts taking the fast path.
   */
  it('falls back to brokered when the app has no native credentials yet', async () => {
    const client = makeClient({
      signInWithIdToken: jest.fn(async () => {
        throw notConfigured();
      }),
    });
    const open = opener({ type: 'success', url: 'myapp://auth?code=code-2' });

    const result = await signInWithProvider({
      client,
      provider: 'google',
      returnTo: 'myapp://auth',
      native: async () => ({ idToken: 'id-tok' }),
      openAuthSession: open,
    });

    expect(result.lane).toBe('brokered');
    expect(client.completeSignIn).toHaveBeenCalledWith('code-2');
  });

  /**
   * Any OTHER native failure is a real one. Retrying it through a browser would
   * hide a broken native setup behind a slower path that happens to work, and
   * nobody would find out until they wondered why sign-in takes three seconds.
   */
  it('does not paper over a genuine native failure', async () => {
    const client = makeClient({
      signInWithIdToken: jest.fn(async () => {
        throw new XenitionError('AUTH_INVALID_TOKEN', 'that sign-in could not be verified', {
          status: 401,
        });
      }),
    });
    const open = opener({ type: 'success', url: 'myapp://auth?code=x' });

    await expect(
      signInWithProvider({
        client,
        provider: 'google',
        returnTo: 'myapp://auth',
        native: async () => ({ idToken: 'forged' }),
        openAuthSession: open,
      }),
    ).rejects.toThrow('could not be verified');
    expect(open).not.toHaveBeenCalled();
  });

  // GitHub issues no id token, so there is nothing a native lane could do.
  it('refuses an explicit native lane for github', async () => {
    await expect(
      signInWithProvider({
        client: makeClient(),
        provider: 'github',
        returnTo: 'myapp://auth',
        native: async () => ({ idToken: 'x' }),
        lane: 'native',
      }),
    ).rejects.toThrow(/no native sign-in/);
  });

  it('never tries native for github even when a native function is supplied', async () => {
    const client = makeClient();
    const open = opener({ type: 'success', url: 'myapp://auth?code=c' });
    const native = jest.fn(async () => ({ idToken: 'x' }));

    await signInWithProvider({
      client,
      provider: 'github',
      returnTo: 'myapp://auth',
      native,
      openAuthSession: open,
    });
    expect(native).not.toHaveBeenCalled();
  });

  it('forces the brokered lane when asked, even with native available', async () => {
    const client = makeClient();
    const open = opener({ type: 'success', url: 'myapp://auth?code=c' });

    const result = await signInWithProvider({
      client,
      provider: 'google',
      returnTo: 'myapp://auth',
      native: async () => ({ idToken: 'x' }),
      openAuthSession: open,
      lane: 'brokered',
    });
    expect(result.lane).toBe('brokered');
    expect(client.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('requires a returnTo', async () => {
    await expect(
      signInWithProvider({ client: makeClient(), provider: 'google', returnTo: '' }),
    ).rejects.toThrow(/returnTo/);
  });
});

describe('signInWithProvider outcomes', () => {
  // A cancelled sign-in is a decision, not a failure to show an error dialog for.
  it('raises a distinguishable error when the user closes the browser', async () => {
    const promise = signInWithProvider({
      client: makeClient(),
      provider: 'github',
      returnTo: 'myapp://auth',
      openAuthSession: opener({ type: 'cancel' }),
    });
    await expect(promise).rejects.toBeInstanceOf(SignInCancelled);
  });

  it('surfaces an error the gateway put in the deep link', async () => {
    await expect(
      signInWithProvider({
        client: makeClient(),
        provider: 'github',
        returnTo: 'myapp://auth',
        openAuthSession: opener({
          type: 'success',
          url: 'myapp://auth?error=that%20account%20did%20not%20share%20an%20email%20address',
        }),
      }),
    ).rejects.toThrow('that account did not share an email address');
  });

  it('complains clearly when the browser came back with nothing', async () => {
    await expect(
      signInWithProvider({
        client: makeClient(),
        provider: 'github',
        returnTo: 'myapp://auth',
        openAuthSession: opener({ type: 'success', url: 'myapp://auth' }),
      }),
    ).rejects.toThrow(/without a code/);
  });
});

/**
 * Parsed by hand rather than with `URL`, because a custom scheme is not a
 * hierarchical URL and `new URL('myapp://auth?code=x').searchParams` comes back
 * empty on some React Native engines with no error at all — which reads as "the
 * server sent no code" and sends you debugging the wrong half.
 */
describe('readCallbackUrl', () => {
  it('reads a code from a custom-scheme deep link', () => {
    expect(readCallbackUrl('myapp://auth?code=abc123')).toEqual({ code: 'abc123' });
  });

  it('reads a code from an https universal link', () => {
    expect(readCallbackUrl('https://app.example.com/auth?code=abc123')).toEqual({
      code: 'abc123',
    });
  });

  it('decodes percent-encoding and plus-encoded spaces', () => {
    expect(readCallbackUrl('myapp://auth?error=sign-in+was%20cancelled')).toEqual({
      error: 'sign-in was cancelled',
    });
  });

  it('keeps the code when the app deep link already had its own query', () => {
    expect(readCallbackUrl('myapp://auth?from=login&code=abc')).toEqual({ code: 'abc' });
  });

  it('returns nothing for a link with no query at all', () => {
    expect(readCallbackUrl('myapp://auth')).toEqual({});
  });

  it('survives malformed pairs rather than throwing at a login screen', () => {
    expect(readCallbackUrl('myapp://auth?&&code=abc&novalue')).toEqual({ code: 'abc' });
  });
});

/**
 * Apple gets the SHA-256 and echoes it inside the token; the server compares
 * the token's claim against the RAW value. Sending the same string to both, in
 * either direction, fails verification — which is why this returns the pair
 * rather than leaving two similar strings to be told apart at a call site.
 */
describe('createAppleNonce', () => {
  it('returns a raw value and its SHA-256, which are not the same string', async () => {
    const { raw, hashed } = await createAppleNonce();
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toBe(raw);
  });

  it('produces a different nonce every time', async () => {
    const a = await createAppleNonce();
    const b = await createAppleNonce();
    expect(a.raw).not.toBe(b.raw);
  });

  it('hashes the raw value it returns', async () => {
    const { raw, hashed } = await createAppleNonce();
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(raw),
    );
    const expected = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    expect(hashed).toBe(expected);
  });
});

/**
 * The browser is injected rather than imported here, and these pin why. Metro
 * resolves `require` at bundle time, so a literal one would fail the build of
 * every app that has not installed expo-web-browser; the usual escape hatch
 * (`new Function('return import(m)')`) needs `eval`, which Hermes disables in
 * release builds — it would work in dev, work in these tests, and return null
 * on a real device.
 */
describe('how the browser is supplied', () => {
  it('accepts the expo-web-browser module directly', async () => {
    const openAuthSessionAsync = jest.fn(
      async (): Promise<AuthSessionResult> => ({ type: 'success', url: 'myapp://auth?code=c' }),
    );
    const client = makeClient();

    const result = await signInWithProvider({
      client,
      provider: 'github',
      returnTo: 'myapp://auth',
      webBrowser: { openAuthSessionAsync },
    });

    expect(result.lane).toBe('brokered');
    expect(openAuthSessionAsync).toHaveBeenCalledWith('https://consent.example/auth', 'myapp://auth');
  });

  it('says exactly what is missing when no browser was passed', async () => {
    await expect(
      signInWithProvider({
        client: makeClient(),
        provider: 'github',
        returnTo: 'myapp://auth',
      }),
    ).rejects.toThrow(/expo-web-browser.*openAuthSession|webBrowser/s);
  });

  // A native-lane sign-in never opens a browser, so it must not demand one.
  it('does not need a browser for the native lane', async () => {
    const client = makeClient();
    const result = await signInWithProvider({
      client,
      provider: 'apple',
      returnTo: 'myapp://auth',
      native: async () => ({ idToken: 'id-tok', name: 'Ada Lovelace' }),
    });
    expect(result.lane).toBe('native');
  });
});

describe('createAppleNonce with an injected hash', () => {
  it('uses the supplied sha256, which is the React Native path', async () => {
    const sha256 = jest.fn(async () => 'deadbeef');
    const { raw, hashed } = await createAppleNonce({ sha256 });
    expect(sha256).toHaveBeenCalledWith(raw);
    expect(hashed).toBe('deadbeef');
  });
});

/**
 * The obvious result union — success | cancel | dismiss — does not typecheck
 * against expo-web-browser, which also returns `opened` and `locked`. Anything
 * that is not a success carrying a URL is a sign-in that did not finish.
 */
describe('browser results that are not a clean success', () => {
  it.each(['cancel', 'dismiss', 'opened', 'locked'])(
    'treats %s as a cancellation',
    async (type) => {
      await expect(
        signInWithProvider({
          client: makeClient(),
          provider: 'github',
          returnTo: 'myapp://auth',
          openAuthSession: opener({ type } as AuthSessionResult),
        }),
      ).rejects.toBeInstanceOf(SignInCancelled);
    },
  );

  it('treats a success with no url as a cancellation rather than a crash', async () => {
    await expect(
      signInWithProvider({
        client: makeClient(),
        provider: 'github',
        returnTo: 'myapp://auth',
        openAuthSession: opener({ type: 'success' } as AuthSessionResult),
      }),
    ).rejects.toBeInstanceOf(SignInCancelled);
  });
});
