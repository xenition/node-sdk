"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignInCancelled = void 0;
exports.signInWithProvider = signInWithProvider;
exports.readCallbackUrl = readCallbackUrl;
exports.createAppleNonce = createAppleNonce;
const errors_1 = require("../core/errors");
/** Raised when the user closed the consent screen. Not a failure to report as
 *  one: a cancelled sign-in is a decision, and an error dialog on top of it is
 *  noise. */
class SignInCancelled extends Error {
    constructor() {
        super('Sign-in was cancelled.');
        this.cancelled = true;
        this.name = 'SignInCancelled';
    }
}
exports.SignInCancelled = SignInCancelled;
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
async function signInWithProvider(options) {
    const { client, provider, returnTo, native, lane = 'auto' } = options;
    if (!returnTo) {
        throw new errors_1.XenitionError('VALIDATION_ERROR', 'signInWithProvider: "returnTo" is required — the deep link this sign-in comes back to, such as myapp://auth.');
    }
    const nativePossible = provider === 'google' || provider === 'apple';
    const wantsNative = lane === 'native' || (lane === 'auto' && !!native && nativePossible);
    if (lane === 'native' && !native) {
        throw new errors_1.XenitionError('VALIDATION_ERROR', 'signInWithProvider: lane "native" needs a `native` function that produces an id token.');
    }
    if (lane === 'native' && !nativePossible) {
        throw new errors_1.XenitionError('VALIDATION_ERROR', `signInWithProvider: ${provider} has no native sign-in — it issues no id token. Use the brokered lane.`);
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
        }
        catch (err) {
            // A server that says "this app has no native credentials" is not a
            // failure — it is an app that has not registered its own client ids yet,
            // which is the ordinary starting state. Fall through to the lane that
            // needs no configuration. Anything else is a real error and is rethrown,
            // because silently retrying through a browser would hide a broken native
            // setup behind a slower path that happens to work.
            if (lane === 'native' || !isProviderNotConfigured(err))
                throw err;
        }
    }
    const session = await brokeredSignIn(options);
    return { session, lane: 'brokered' };
}
async function brokeredSignIn(options) {
    const { client, provider, returnTo } = options;
    const open = resolveOpener(options);
    const { url } = await client.startSignIn(provider, returnTo);
    const result = await open(url, returnTo);
    // Anything that is not a success carrying a URL is a sign-in that did not
    // finish — cancelled, dismissed, or a browser that never opened.
    if (result.type !== 'success' || !result.url)
        throw new SignInCancelled();
    const { code, error } = readCallbackUrl(result.url);
    if (error)
        throw new errors_1.XenitionError('AUTH_INVALID_CREDENTIALS', error);
    if (!code) {
        throw new errors_1.XenitionError('AUTH_INVALID_CREDENTIALS', 'That sign-in came back without a code. Please try again.');
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
function readCallbackUrl(raw) {
    const q = raw.indexOf('?');
    if (q === -1)
        return {};
    const out = {};
    for (const pair of raw.slice(q + 1).split('&')) {
        if (!pair)
            continue;
        const eq = pair.indexOf('=');
        const key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
        const value = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
        if (key === 'code')
            out.code = value;
        if (key === 'error')
            out.error = value;
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
async function createAppleNonce(options = {}) {
    const raw = randomString(32);
    return { raw, hashed: await sha256Hex(raw, options.sha256) };
}
const webCrypto = () => globalThis.crypto;
function randomString(bytes) {
    const buf = new Uint8Array(bytes);
    const source = webCrypto();
    if (source?.getRandomValues) {
        source.getRandomValues(buf);
    }
    else {
        // Only reachable on a runtime with no Web Crypto at all. Better than
        // throwing at a login screen, and the nonce's job — binding one token to
        // one attempt — survives a weaker source than its secrecy would.
        for (let i = 0; i < buf.length; i += 1)
            buf[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(value, inject) {
    if (inject)
        return inject(value);
    const source = webCrypto();
    if (source?.subtle) {
        const digest = await source.subtle.digest('SHA-256', new TextEncoder().encode(value));
        return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    }
    // React Native has no SubtleCrypto at all, so there is nothing to fall back
    // to here. Naming expo-crypto beats "crypto is undefined" from three frames
    // down inside a login screen.
    throw new errors_1.XenitionError('VALIDATION_ERROR', 'createAppleNonce: this runtime has no SHA-256. Pass `sha256` — on React ' +
        "Native use expo-crypto's digestStringAsync.");
}
/** Work out how to open the consent screen, or say exactly what is missing. */
function resolveOpener(options) {
    if (options.openAuthSession)
        return options.openAuthSession;
    const browser = options.webBrowser;
    if (browser?.openAuthSessionAsync) {
        return (url, returnTo) => browser.openAuthSessionAsync(url, returnTo);
    }
    throw new errors_1.XenitionError('VALIDATION_ERROR', 'signInWithProvider: brokered sign-in needs a browser. Pass `webBrowser` ' +
        "(import * as WebBrowser from 'expo-web-browser') or your own `openAuthSession`.");
}
/** Does this error mean "this app has not registered its own client ids"? */
function isProviderNotConfigured(err) {
    if (!(err instanceof errors_1.XenitionError))
        return false;
    return err.code === 'AUTH_PROVIDER_NOT_CONFIGURED' || err.status === 412;
}
//# sourceMappingURL=index.js.map