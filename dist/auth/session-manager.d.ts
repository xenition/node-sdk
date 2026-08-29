import { AuthClient } from './auth-client';
import { AuthResponse, LoginInput, RegisterInput } from './types';
import { SessionStore, StoredSession } from './session-store';
/**
 * Session lifecycle on top of `AuthClient`.
 *
 * `AuthClient` is stateless by design — every method is one request and
 * the caller carries the token. That is right for a server handling many
 * users through one client, and wrong for an app serving exactly one
 * user, which then has to hand-roll storage, expiry arithmetic, a
 * refresh timer and a way to notice sign-out. This class is that missing
 * half, and it is the piece apps ask for most.
 *
 * ─────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE DEBUGGING A SIGN-OUT: `POST /app-platform/auth/refresh`
 * DOES NOT EXIST on the gateway today. It answers 404, and `AuthClient`
 * rewrites that 404 into a NOT_FOUND naming the endpoint (see
 * docs/PLATFORM-ENDPOINTS.md §1). So on current deployments a proactive
 * refresh CANNOT succeed. Everything here is built to behave correctly
 * either way: a refresh failure — 404 included — clears the session once
 * and emits `SIGNED_OUT`, and is never retried. The machinery starts
 * working the day the endpoint ships, with no SDK change.
 * ─────────────────────────────────────────────────────────────────────
 */
/**
 * Refresh this long before the access token actually expires.
 *
 * 60 seconds, chosen to cover the three things that make "refresh exactly
 * at expiry" fail in practice:
 *
 *   - Device clocks drift. A phone a few seconds ahead of the gateway
 *     believes a token is still good after the server has retired it.
 *   - The refresh is itself a network round trip, on the worst network
 *     the user will ever have. It needs to complete before the old token
 *     dies, not start then.
 *   - Requests already in flight when the timer fires must still be
 *     holding a token the server accepts.
 *
 * It is also small relative to a typical 15–60 minute access token — at
 * most a few percent of its life — so it does not multiply refresh
 * traffic. Override with `refreshMarginMs` if a deployment issues
 * unusually short tokens.
 */
export declare const DEFAULT_REFRESH_MARGIN_MS = 60000;
/**
 * Never arm the refresh timer for less than this. Without a floor, a
 * session that is already inside its margin schedules at 0ms and the
 * timer becomes a tight loop against the network.
 */
export declare const MIN_REFRESH_DELAY_MS = 1000;
/**
 * A refreshed session with less life left than this cannot make progress
 * — refreshing it would immediately schedule another refresh, forever.
 * Treated as a failed refresh instead, so the loop ends in one clean
 * sign-out rather than hammering the gateway until the app is killed.
 */
export declare const MIN_USABLE_LIFETIME_MS = 2000;
/**
 * What happened. Named after the events Supabase and Firebase clients
 * emit, because these listeners are usually being ported from one of
 * them and a different vocabulary buys nothing.
 */
export type AuthChangeEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';
export type AuthStateListener = (event: AuthChangeEvent, session: StoredSession | null) => void;
export interface SessionManagerOptions {
    /**
     * Where the session is persisted. Defaults to `MemorySessionStore`,
     * which keeps everything working but does not survive a restart.
     */
    store?: SessionStore;
    /** See `DEFAULT_REFRESH_MARGIN_MS`. */
    refreshMarginMs?: number;
    /**
     * Arm a timer to refresh in the background. Default true.
     *
     * Turn it off in a Cloudflare Worker or any request-scoped server use:
     * there is no long-lived process for a timer to fire in, and an open
     * timer can hold a request's lifetime open. With it off, refresh still
     * happens — lazily, inside `getAccessToken()`.
     */
    autoRefresh?: boolean;
}
export declare class SessionManager {
    private readonly auth;
    private readonly store;
    private readonly margin;
    private readonly autoRefresh;
    private listeners;
    private timer;
    /**
     * The session, cached in memory after the first read.
     *
     * `getAccessToken()` runs on every outgoing request; the store behind
     * it may be the iOS keychain, which is disk I/O and a measurable stall
     * if it is consulted that often. `loaded` distinguishes "we have read
     * the store and there was nothing" from "we have not read it yet", so
     * a cold start does not mistake an unread store for a signed-out user.
     */
    private current;
    private loaded;
    /**
     * The single in-flight refresh, shared by every concurrent caller.
     *
     * Six screens rendering at once will each discover the token is about
     * to expire within the same millisecond. Without this they fire six
     * refreshes; on a gateway that ROTATES refresh tokens (which
     * docs/PLATFORM-ENDPOINTS.md asks it to) the first one invalidates the
     * token the other five are holding, so five of them fail and the last
     * failure signs a perfectly healthy user out.
     */
    private inFlight;
    constructor(auth: AuthClient, options?: SessionManagerOptions);
    /**
     * Subscribe to sign-in, sign-out and token-refresh. Returns the
     * unsubscribe function.
     *
     * Nothing is emitted on subscribe. A listener registered during app
     * startup would otherwise receive `SIGNED_OUT` before the store had
     * been read, and every app that routes on this event would bounce a
     * signed-in user to the login screen on every launch. Call
     * `getSession()` for the current state; use this for changes to it.
     */
    onAuthStateChange(listener: AuthStateListener): () => void;
    /**
     * The stored session, read from the store on first call.
     *
     * This is the "restore on launch" entry point. It does not refresh — an
     * app calls it to decide which screen to show, and blocking that
     * decision on a network round trip is what produces a splash screen
     * that hangs on a bad connection. It DOES arm the background refresh
     * timer, so a restored session starts being kept alive from here.
     */
    getSession(): Promise<StoredSession | null>;
    /** Whether a session is expired or inside the refresh margin. */
    private needsRefresh;
    /**
     * A token that is good right now, refreshing first if it is about to
     * expire. `null` when there is no session to work with.
     *
     * This is what request code should call. Reaching for
     * `(await getSession())?.token` skips the expiry check and reintroduces
     * the 401-then-retry dance this class removes.
     *
     * Also the whole refresh story for `autoRefresh: false` callers: with
     * no timer, this is where a stale token gets renewed.
     */
    getAccessToken(): Promise<string | null>;
    /**
     * Persist a sign-in response and announce it.
     *
     * Public because sign-in has more doors than `login()`: `verifyOtp()`,
     * `signInWithIdToken()` and `handleOAuthCallback()` all return the same
     * `AuthResponse`, and every one of them must end with a stored session
     * and a `SIGNED_IN` event or the app silently behaves as signed out
     * after a social login.
     */
    adopt(response: AuthResponse): Promise<StoredSession>;
    login(input: LoginInput): Promise<AuthResponse>;
    register(input: RegisterInput): Promise<AuthResponse>;
    /**
     * Sign out: tell the server, then clear locally and emit `SIGNED_OUT`.
     *
     * The local clear happens even when the server call fails. A user who
     * taps "sign out" on a train, gets a network error and stays signed in
     * has been ignored on the one action where being ignored is a security
     * problem — most of all on a shared or borrowed device. The server-side
     * revoke is best effort; the device-side sign-out is not optional.
     */
    logout(): Promise<void>;
    /**
     * Exchange the refresh token for a new session.
     *
     * Concurrent callers share ONE request: the first caller starts it and
     * everyone who asks while it is running receives the same promise. See
     * `inFlight` for why a rotating gateway makes parallel refreshes
     * actively harmful rather than merely wasteful.
     *
     * Rejects with the underlying `XenitionError` so an explicit caller can
     * see why — but by then the session has already been cleared and
     * `SIGNED_OUT` emitted, so no caller needs to clean up after it.
     */
    refresh(): Promise<StoredSession | null>;
    private runRefresh;
    /** Clear + announce, without retrying. */
    private failRefresh;
    private schedule;
    private nextDelayMs;
    /**
     * The timer's entry point. It swallows the rejection `refresh()` throws
     * because an unhandled rejection raised from a timer callback has no
     * caller to catch it: in Node it terminates the process, and in React
     * Native it shows the user a red screen. The failure has already been
     * handled properly — cleared and announced — before it reaches here.
     */
    private backgroundRefresh;
    private cancelTimer;
    /**
     * Stop refreshing and drop every listener.
     *
     * Needed wherever a manager is created per user or per test rather than
     * once per app: an abandoned one goes on refreshing on its own timer,
     * against a store someone else now owns.
     */
    destroy(): void;
    private persist;
    private clearLocalSession;
}
//# sourceMappingURL=session-manager.d.ts.map