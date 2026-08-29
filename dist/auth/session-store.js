"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SESSION_KEY = exports.MemorySessionStore = void 0;
exports.toExpiryMs = toExpiryMs;
exports.toStoredSession = toStoredSession;
exports.isStoredSession = isStoredSession;
exports.createKeyValueSessionStore = createKeyValueSessionStore;
/**
 * Below this, a timestamp cannot plausibly be milliseconds.
 *
 * 1e11 ms is March 1973 and 1e11 seconds is the year 5138, so no real
 * token expiry is ambiguous. The heuristic exists because servers
 * disagree: the xenition gateway documents epoch seconds, most JWT `exp`
 * claims are seconds, and plenty of platforms hand back milliseconds.
 * Guessing wrong in either direction is silent — seconds read as ms
 * expires everything immediately, ms read as seconds never refreshes at
 * all — so the SDK decides once instead of asking the caller.
 */
const MILLISECOND_FLOOR = 1e11;
/** Normalize a server `expiresAt` to epoch milliseconds. */
function toExpiryMs(expiresAt) {
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= 0) {
        // An absent or nonsense expiry must not be turned into "expired": that
        // would send a perfectly good token straight into a refresh it does not
        // need. 0 means "unknown", and scheduling skips it.
        return 0;
    }
    return expiresAt < MILLISECOND_FLOOR ? Math.round(expiresAt * 1000) : Math.round(expiresAt);
}
/**
 * Reduce a sign-in response to the part worth persisting.
 *
 * Used for every path that mints a session — login, register, OTP verify,
 * native id-token sign-in, OAuth callback and refresh — so they all store
 * the same shape and the restore path only has one case to handle.
 */
function toStoredSession(response) {
    return {
        user: response.user,
        token: response.token,
        refreshToken: response.refreshToken,
        expiresAt: toExpiryMs(response.expiresAt),
    };
}
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
function isStoredSession(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const candidate = value;
    return (typeof candidate.token === 'string' &&
        candidate.token !== '' &&
        typeof candidate.refreshToken === 'string' &&
        typeof candidate.expiresAt === 'number' &&
        typeof candidate.user === 'object' &&
        candidate.user !== null);
}
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
class MemorySessionStore {
    constructor() {
        this.session = null;
    }
    get() {
        return this.session;
    }
    set(session) {
        this.session = session;
    }
    clear() {
        this.session = null;
    }
}
exports.MemorySessionStore = MemorySessionStore;
/** Default storage key. Namespaced so it cannot collide with app state. */
exports.DEFAULT_SESSION_KEY = 'xenition.auth.session';
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
function createKeyValueSessionStore(storage, key = exports.DEFAULT_SESSION_KEY) {
    return {
        async get() {
            const raw = await storage.getItem(key);
            if (typeof raw !== 'string' || raw === '')
                return null;
            let parsed;
            try {
                parsed = JSON.parse(raw);
            }
            catch {
                await storage.removeItem(key);
                return null;
            }
            if (!isStoredSession(parsed)) {
                await storage.removeItem(key);
                return null;
            }
            return parsed;
        },
        async set(session) {
            await storage.setItem(key, JSON.stringify(session));
        },
        async clear() {
            await storage.removeItem(key);
        },
    };
}
//# sourceMappingURL=session-store.js.map