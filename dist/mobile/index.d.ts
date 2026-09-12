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
import type { AuthResponse, OAuthProvider, SignInLane } from '../auth/types';
/** The slice of the client this module needs. Structural, so both the platform
 *  client (`xenition.auth`) and an app's own typed client satisfy it. */
export interface MobileAuthClient {
    startSignIn(provider: OAuthProvider, returnTo: string): Promise<{
        url: string;
        state?: string;
        usingSSO?: boolean;
    }>;
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
export type AuthSessionOpener = (url: string, returnTo: string) => Promise<AuthSessionResult>;
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
export declare class SignInCancelled extends Error {
    readonly cancelled = true;
    constructor();
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
export declare function signInWithProvider(options: SignInOptions): Promise<SignInResult>;
/**
 * Pull `code` or `error` out of the deep link the gateway redirected to.
 *
 * Hand-parsed rather than run through `URL`: a custom scheme like
 * `myapp://auth?code=x` is not a hierarchical URL, and `new URL()` parses it
 * inconsistently across Hermes, JSC and browsers — on some it returns an empty
 * `searchParams` with no error at all, which reads as "the provider sent no
 * code" and sends you debugging the server.
 */
export declare function readCallbackUrl(raw: string): {
    code?: string;
    error?: string;
};
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
export declare function createAppleNonce(options?: {
    sha256?: (value: string) => Promise<string>;
}): Promise<{
    raw: string;
    hashed: string;
}>;
//# sourceMappingURL=index.d.ts.map