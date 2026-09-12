/**
 * `@xenition/sdk/mobile` — social sign-in on a device, in one call.
 *
 * Everything here is runtime-agnostic on purpose. This package is installed by
 * Cloudflare Workers backends as often as by Expo apps, so it declares no
 * dependency on React Native, Expo, or anything native, and nothing in this
 * file imports one at module scope.
 *
 * That last part is not fastidiousness. A static `import` of a native module
 * runs its bridge setup the moment the file is evaluated, which on web and in
 * Expo Go throws before any component renders — the screen goes blank with no
 * error anyone can act on.
 *
 * The tempting fix is for this file to load `expo-web-browser` itself behind a
 * dynamic import. It does not, and deliberately: Metro resolves `require` at
 * bundle time, so a literal one fails the build of every app that has not
 * installed the package, and the usual escape (`new Function('return import(m)')`)
 * relies on `eval`, which Hermes disables in release builds. It would work in
 * development, work in tests, and return null on a real device — which is the
 * worst failure shape there is.
 *
 * So the browser is passed IN. Either hand over the module you already imported
 * (`webBrowser: WebBrowser`) or your own `openAuthSession`. One line at the call
 * site, resolved by the app's own bundler, no way to fail only in production.
 *
 * ## What this actually decides
 *
 * There are two ways to sign in and the right one is not a preference:
 *
 *   NATIVE    Google Sign-In / Sign in with Apple on the device produces an
 *             `idToken`. One round trip, no browser. Requires the app's OWN
 *             client ids — a native token's audience IS the app's bundle id,
 *             so the platform cannot supply one on its behalf.
 *
 *   BROKERED  An in-app browser, the gateway does the code exchange, a
 *             one-time code comes back through the app's deep link. Runs on
 *             Xenition's own OAuth clients, so it needs NO configuration. The
 *             only lane GitHub can use, and the only one that works in Expo Go
 *             or a web build.
 *
 * `signInWithProvider()` tries native when the app supplied a way to get a
 * native token, and falls back to brokered when the server says this app has
 * no native credentials. So an app ships working sign-in on day one and gets
 * the fast path automatically on the day it registers its own client ids —
 * with no code change.
 */

import { XenitionError } from '../core/errors';
import type { AuthResponse, OAuthProvider, SignInLane } from '../auth/types';

/** The slice of the client this module needs. Structural, so both the platform
 *  client (`xenition.auth`) and an app's own typed client satisfy it. */
export interface MobileAuthClient {
  startSignIn(
    provider: OAuthProvider,
    returnTo: string,
  ): Promise<{ url: string; state?: string; usingSSO?: boolean }>;
  completeSignIn(code: string): Promise<AuthResponse>;
  signInWithIdToken(input: {
    provider: OAuthProvider;
    idToken: string;
    nonce?: string;
    name?: string;
  }): Promise<AuthResponse>;
}

/** What a native sign-in on the device produced. */
export interface NativeCredential {
  idToken: string;
  /**
   * The RAW nonce, if one was used. Apple is given its SHA-256 and echoes that
   * inside the token; the server compares against the raw value. Send the raw
   * one here — `createAppleNonce()` returns both halves so they cannot be
   * mixed up.
   */
  nonce?: string;
  /** Apple surfaces a name only on the FIRST authorization, ever. */
  name?: string;
}

/**
 * Opens a URL in an in-app browser and resolves when it returns to `returnTo`.
 *
 * Defaults to `expo-web-browser`'s `openAuthSessionAsync`, loaded dynamically.
 * Supply your own to use a different browser, or to test without one.
 */
export type AuthSessionOpener = (
  url: string,
  returnTo: string,
) => Promise<AuthSessionResult>;

/**
 * What an in-app browser reports back.
 *
 * Deliberately loose. The obvious shape is
 * `{type:'success';url:string} | {type:'cancel'|'dismiss'}`, and it is wrong:
 * `expo-web-browser` also returns `opened` and `locked`, so the narrow union
 * fails to typecheck against the very module it was written for. Anything that
 * is not a `success` carrying a URL is a sign-in that did not finish, and
 * enumerating the ways it can fail buys nothing.
 */
export interface AuthSessionResult {
  type: string;
  url?: string;
}

/** The one function this needs from `expo-web-browser`. */
export interface WebBrowserModule {
  openAuthSessionAsync(url: string, returnTo: string): Promise<AuthSessionResult>;
}

export interface SignInOptions {
  client: MobileAuthClient;
  provider: OAuthProvider;
  /**
   * The app's own deep link, e.g. `myapp://auth`. This is NOT registered with
   * Google or Apple — the provider always returns to the gateway, which then
   * delivers a one-time code here.
   */
  returnTo: string;
  /**
   * How to obtain a native id token, when the app has a native SDK wired up.
   * Omit it and sign-in is always brokered.
   *
   * Load the native module INSIDE this function with `await import()`. A
   * top-level import of `@react-native-google-signin/google-signin` or
   * `expo-apple-authentication` runs native bridge setup at evaluation time and
   * blanks the route on web and in Expo Go.
   */
  native?: () => Promise<NativeCredential>;
  /**
   * The `expo-web-browser` module, imported by the app.
   *
   * ```ts
   * import * as WebBrowser from 'expo-web-browser';
   * signInWithProvider({ ..., webBrowser: WebBrowser });
   * ```
   *
   * Structurally typed, so anything exposing `openAuthSessionAsync` works.
   */
  webBrowser?: WebBrowserModule;
  /** Full control over how the consent screen is opened. Wins over `webBrowser`. */
  openAuthSession?: AuthSessionOpener;
  /**
   * Force a lane instead of letting it be decided. `'auto'` (the default) tries
   * native when `native` is supplied and falls back to brokered.
   */
  lane?: SignInLane | 'auto';
}

export interface SignInResult {
  session: AuthResponse;
  /** Which lane actually ran. Useful in a log when sign-in is slower than
   *  expected — `brokered` means the app has no native credentials yet. */
  lane: SignInLane;
}

/** Raised when the user closed the consent screen. Not a failure to report as
 *  one: a cancelled sign-in is a decision, and an error dialog on top of it is
 *  noise. */
export class SignInCancelled extends Error {
  readonly cancelled = true;
  constructor() {
    super('Sign-in was cancelled.');
    this.name = 'SignInCancelled';
  }
}

/**
 * Sign in with Google, Apple or GitHub, choosing the lane automatically.
 *
 * ```ts
 * const { session } = await signInWithProvider({
 *   client: api.auth,
 *   provider: 'github',
 *   returnTo: 'myapp://auth',
 * });
 * ```
 */
export async function signInWithProvider(
  options: SignInOptions,
): Promise<SignInResult> {
  const { client, provider, returnTo, native, lane = 'auto' } = options;

  if (!returnTo) {
    throw new XenitionError(
      'VALIDATION_ERROR',
      'signInWithProvider: "returnTo" is required — the deep link this sign-in comes back to, such as myapp://auth.',
    );
  }

  const nativePossible = provider === 'google' || provider === 'apple';
  const wantsNative = lane === 'native' || (lane === 'auto' && !!native && nativePossible);

  if (lane === 'native' && !native) {
    throw new XenitionError(
      'VALIDATION_ERROR',
      'signInWithProvider: lane "native" needs a `native` function that produces an id token.',
    );
  }
  if (lane === 'native' && !nativePossible) {
    throw new XenitionError(
      'VALIDATION_ERROR',
      `signInWithProvider: ${provider} has no native sign-in — it issues no id token. Use the brokered lane.`,
    );
  }

  if (wantsNative && native) {
    try {
      const credential = await native();
      const session = await client.signInWithIdToken({
        provider,
        idToken: credential.idToken,
        nonce: credential.nonce,
        name: credential.name,
      });
      return { session, lane: 'native' };
    } catch (err) {
      // A server that says "this app has no native credentials" is not a
      // failure — it is an app that has not registered its own client ids yet,
      // which is the ordinary starting state. Fall through to the lane that
      // needs no configuration. Anything else is a real error and is rethrown,
      // because silently retrying through a browser would hide a broken native
      // setup behind a slower path that happens to work.
      if (lane === 'native' || !isProviderNotConfigured(err)) throw err;
    }
  }

  const session = await brokeredSignIn(options);
  return { session, lane: 'brokered' };
}

async function brokeredSignIn(options: SignInOptions): Promise<AuthResponse> {
  const { client, provider, returnTo } = options;
  const open = resolveOpener(options);

  const { url } = await client.startSignIn(provider, returnTo);
  const result = await open(url, returnTo);
  // Anything that is not a success carrying a URL is a sign-in that did not
  // finish — cancelled, dismissed, or a browser that never opened.
  if (result.type !== 'success' || !result.url) throw new SignInCancelled();

  const { code, error } = readCallbackUrl(result.url);
  if (error) throw new XenitionError('AUTH_INVALID_CREDENTIALS', error);
  if (!code) {
    throw new XenitionError(
      'AUTH_INVALID_CREDENTIALS',
      'That sign-in came back without a code. Please try again.',
    );
  }
  return client.completeSignIn(code);
}

/**
 * Pull `code` or `error` out of the deep link the gateway redirected to.
 *
 * Hand-parsed rather than run through `URL`: a custom scheme like
 * `myapp://auth?code=x` is not a hierarchical URL, and `new URL()` parses it
 * inconsistently across Hermes, JSC and browsers — on some it returns an empty
 * `searchParams` with no error at all, which reads as "the provider sent no
 * code" and sends you debugging the server.
 */
export function readCallbackUrl(raw: string): { code?: string; error?: string } {
  const q = raw.indexOf('?');
  if (q === -1) return {};
  const out: { code?: string; error?: string } = {};
  for (const pair of raw.slice(q + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
    const value = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
    if (key === 'code') out.code = value;
    if (key === 'error') out.error = value;
  }
  return out;
}

/**
 * A nonce for Sign in with Apple, in both forms it is needed in.
 *
 * Apple is given the SHA-256 `hashed` value and echoes it inside the id token;
 * the server compares the token's claim against the `raw` one. Sending the same
 * value to both, in either direction, fails verification — so this returns the
 * pair rather than leaving two similar strings to be told apart at a call site.
 *
 * Uses Web Crypto where it exists. React Native has no `crypto.subtle`, so
 * there pass `sha256` — `expo-crypto`'s `digestStringAsync` is the usual one:
 *
 * ```ts
 * import * as Crypto from 'expo-crypto';
 * await createAppleNonce({
 *   sha256: (v) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, v),
 * });
 * ```
 */
export async function createAppleNonce(options: {
  sha256?: (value: string) => Promise<string>;
} = {}): Promise<{ raw: string; hashed: string }> {
  const raw = randomString(32);
  return { raw, hashed: await sha256Hex(raw, options.sha256) };
}

/**
 * The slice of Web Crypto used here, declared structurally rather than relying
 * on the DOM lib — this package compiles without it, and React Native provides
 * `getRandomValues` but no `subtle`.
 */
interface MinimalCrypto {
  getRandomValues?(array: Uint8Array): Uint8Array;
  subtle?: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> };
}

const webCrypto = (): MinimalCrypto | undefined =>
  (globalThis as { crypto?: MinimalCrypto }).crypto;

function randomString(bytes: number): string {
  const buf = new Uint8Array(bytes);
  const source = webCrypto();
  if (source?.getRandomValues) {
    source.getRandomValues(buf);
  } else {
    // Only reachable on a runtime with no Web Crypto at all. Better than
    // throwing at a login screen, and the nonce's job — binding one token to
    // one attempt — survives a weaker source than its secrecy would.
    for (let i = 0; i < buf.length; i += 1) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(
  value: string,
  inject?: (value: string) => Promise<string>,
): Promise<string> {
  if (inject) return inject(value);
  const source = webCrypto();
  if (source?.subtle) {
    const digest = await source.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // React Native has no SubtleCrypto at all, so there is nothing to fall back
  // to here. Naming expo-crypto beats "crypto is undefined" from three frames
  // down inside a login screen.
  throw new XenitionError(
    'VALIDATION_ERROR',
    'createAppleNonce: this runtime has no SHA-256. Pass `sha256` — on React ' +
      "Native use expo-crypto's digestStringAsync.",
  );
}

/** Work out how to open the consent screen, or say exactly what is missing. */
function resolveOpener(options: SignInOptions): AuthSessionOpener {
  if (options.openAuthSession) return options.openAuthSession;
  const browser = options.webBrowser;
  if (browser?.openAuthSessionAsync) {
    return (url, returnTo) => browser.openAuthSessionAsync(url, returnTo);
  }
  throw new XenitionError(
    'VALIDATION_ERROR',
    'signInWithProvider: brokered sign-in needs a browser. Pass `webBrowser` ' +
      "(import * as WebBrowser from 'expo-web-browser') or your own `openAuthSession`.",
  );
}

/** Does this error mean "this app has not registered its own client ids"? */
function isProviderNotConfigured(err: unknown): boolean {
  if (!(err instanceof XenitionError)) return false;
  return err.code === 'AUTH_PROVIDER_NOT_CONFIGURED' || err.status === 412;
}
