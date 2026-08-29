import { AuthResponse, User } from './types';
/**
 * Session persistence for the auth module.
 *
 * Every app built on this SDK has so far hand-rolled the same three
 * things: where to put the token, how to tell whether it is still good,
 * and what to do with a half-written value left behind by a killed
 * process. This file owns all three so an app does not have to.
 *
 * Nothing here imports a platform package. The SDK runs in Node, in
 * Cloudflare Workers, in React Native and in a browser, and a single
 * `import 'react-native'` or `localStorage` reference would break three
 * of those four at module load — before any caller could opt out. The
 * caller supplies the binding; this file supplies the shape and the
 * defensive reading.
 */
/**
 * A session as it is persisted: the four things needed to resume without
 * sending the user back to the login screen.
 *
 * Deliberately NOT the whole `AuthResponse`. The `session` record on that
 * response is a server-side row describing the session (ip, user agent,
 * its own id) which is useful to display and useless to restore, and
 * writing it to a keychain entry only widens what leaks if the device is
 * compromised.
 */
export interface StoredSession {
    user: User;
    /** The JWT sent as `Authorization: Bearer <token>`. */
    token: string;
    refreshToken: string;
    /**
     * Epoch MILLISECONDS — normalized, not whatever the server sent.
     *
     * The gateway returns `expiresAt` in epoch SECONDS (see
     * docs/PLATFORM-ENDPOINTS.md). Storing that number as-is and comparing
     * it against `Date.now()` puts every expiry in 1970, which makes every
     * restored session look expired and signs the user out on launch — the
     * exact failure this module exists to prevent. Normalizing once, here,
     * means no consumer has to remember which unit it is holding.
     *
     * `0` means the server did not tell us. That is not "expired": it means
     * proactive refresh has nothing to schedule against, so the session is
     * used until a request comes back 401.
     */
    expiresAt: number;
}
/**
 * Where a `StoredSession` lives between launches.
 *
 * Every method may be sync or async because the real backings differ:
 * `localStorage` is synchronous, AsyncStorage and expo-secure-store are
 * promise-based, and a file or a KV namespace is async. Declaring the
 * union lets one interface cover all of them without forcing a browser
 * caller to write `async` around a synchronous read.
 *
 * Implementations must not throw for "nothing stored" — return `null`.
 * A store that throws on a cold launch takes the app down before the
 * login screen renders.
 */
export interface SessionStore {
    get(): StoredSession | null | Promise<StoredSession | null>;
    set(session: StoredSession): void | Promise<void>;
    clear(): void | Promise<void>;
}
/** Normalize a server `expiresAt` to epoch milliseconds. */
export declare function toExpiryMs(expiresAt: unknown): number;
/**
 * Reduce a sign-in response to the part worth persisting.
 *
 * Used for every path that mints a session — login, register, OTP verify,
 * native id-token sign-in, OAuth callback and refresh — so they all store
 * the same shape and the restore path only has one case to handle.
 */
export declare function toStoredSession(response: AuthResponse): StoredSession;
/**
 * Whether a value read back out of storage is usable.
 *
 * Storage is untrusted input even when we wrote it: an app killed
 * mid-write leaves a truncated string, a user's older SDK version wrote
 * an older shape, and a shared key can be overwritten by something else
 * entirely. Reading a half-session and treating it as real produces
 * `Bearer undefined` on every request, which the server answers with 401
 * and the app reports as "wrong password".
 */
export declare function isStoredSession(value: unknown): value is StoredSession;
/**
 * The default store: the session lives in this process and dies with it.
 *
 * It exists so that a caller who configures nothing still gets working
 * in-process session handling — background refresh, sign-out events, one
 * shared refresh — rather than a crash or a silent no-op. It is NOT
 * persistence: on a phone this means the user signs in again after every
 * cold start, which is precisely why a real app passes
 * `createKeyValueSessionStore(SecureStore)` instead.
 *
 * On a server this is usually the right store, since a session there
 * belongs to one request-scoped client and must not outlive it.
 */
export declare class MemorySessionStore implements SessionStore {
    private session;
    get(): StoredSession | null;
    set(session: StoredSession): void;
    clear(): void;
}
/**
 * The shape AsyncStorage, expo-secure-store and `localStorage` all
 * already have. Declaring it structurally is what lets one adapter serve
 * all three without the SDK depending on any of them.
 */
export interface KeyValueStorage {
    getItem(key: string): string | null | Promise<string | null>;
    setItem(key: string, value: string): unknown;
    removeItem(key: string): unknown;
}
/** Default storage key. Namespaced so it cannot collide with app state. */
export declare const DEFAULT_SESSION_KEY = "xenition.auth.session";
/**
 * Wrap a key/value storage as a `SessionStore`.
 *
 *   createKeyValueSessionStore(AsyncStorage)
 *   createKeyValueSessionStore(SecureStore)   // expo-secure-store
 *   createKeyValueSessionStore(localStorage)
 *
 * The JSON handling is the reason this is shipped rather than left to
 * each app. A value that will not parse — truncated by a process kill,
 * written by an older SDK, or clobbered by another writer on the same key
 * — is DELETED and reported as "no session", because the alternative is
 * an exception thrown on every launch from inside the restore path, which
 * leaves the app unable to reach even the login screen and unfixable
 * without a reinstall.
 */
export declare function createKeyValueSessionStore(storage: KeyValueStorage, key?: string): SessionStore;
//# sourceMappingURL=session-store.d.ts.map