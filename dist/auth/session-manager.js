"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = exports.MIN_USABLE_LIFETIME_MS = exports.MIN_REFRESH_DELAY_MS = exports.DEFAULT_REFRESH_MARGIN_MS = void 0;
const errors_1 = require("../core/errors");
const session_store_1 = require("./session-store");
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
exports.DEFAULT_REFRESH_MARGIN_MS = 60000;
/**
 * Never arm the refresh timer for less than this. Without a floor, a
 * session that is already inside its margin schedules at 0ms and the
 * timer becomes a tight loop against the network.
 */
exports.MIN_REFRESH_DELAY_MS = 1000;
/**
 * A refreshed session with less life left than this cannot make progress
 * — refreshing it would immediately schedule another refresh, forever.
 * Treated as a failed refresh instead, so the loop ends in one clean
 * sign-out rather than hammering the gateway until the app is killed.
 */
exports.MIN_USABLE_LIFETIME_MS = 2000;
/**
 * Report a listener failure without letting it become the auth flow's
 * failure. Matches `HttpClient.observe`: a hook is observability, and
 * adding a listener must never be a way to break sign-in.
 */
function notify(listeners, event, session) {
    // Iterate a copy: a listener that unsubscribes itself (the common React
    // cleanup) would otherwise mutate the array mid-loop and silently skip
    // whichever listener shifted into its place.
    for (const listener of [...listeners]) {
        try {
            listener(event, session);
        }
        catch {
            /* ignored on purpose */
        }
    }
}
class SessionManager {
    constructor(auth, options = {}) {
        this.auth = auth;
        this.listeners = [];
        this.timer = null;
        /**
         * The session, cached in memory after the first read.
         *
         * `getAccessToken()` runs on every outgoing request; the store behind
         * it may be the iOS keychain, which is disk I/O and a measurable stall
         * if it is consulted that often. `loaded` distinguishes "we have read
         * the store and there was nothing" from "we have not read it yet", so
         * a cold start does not mistake an unread store for a signed-out user.
         */
        this.current = null;
        this.loaded = false;
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
        this.inFlight = null;
        this.store = options.store ?? new session_store_1.MemorySessionStore();
        this.margin = options.refreshMarginMs ?? exports.DEFAULT_REFRESH_MARGIN_MS;
        this.autoRefresh = options.autoRefresh ?? true;
    }
    // ────────── Observing ────────────────────────────────────────────────────
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
    onAuthStateChange(listener) {
        this.listeners.push(listener);
        let active = true;
        return () => {
            // Guard against a double unsubscribe: React StrictMode runs effect
            // cleanups twice, and without this the second call removes whichever
            // unrelated listener now sits at that index.
            if (!active)
                return;
            active = false;
            const index = this.listeners.indexOf(listener);
            if (index !== -1)
                this.listeners.splice(index, 1);
        };
    }
    // ────────── Reading ──────────────────────────────────────────────────────
    /**
     * The stored session, read from the store on first call.
     *
     * This is the "restore on launch" entry point. It does not refresh — an
     * app calls it to decide which screen to show, and blocking that
     * decision on a network round trip is what produces a splash screen
     * that hangs on a bad connection. It DOES arm the background refresh
     * timer, so a restored session starts being kept alive from here.
     */
    async getSession() {
        if (this.loaded)
            return this.current;
        const stored = await this.store.get();
        this.loaded = true;
        this.current = stored ?? null;
        if (this.current)
            this.schedule(this.current);
        return this.current;
    }
    /** Whether a session is expired or inside the refresh margin. */
    needsRefresh(session) {
        // 0 means the server never told us when this expires; there is nothing
        // to be early about, so leave it alone and let a 401 drive recovery.
        if (session.expiresAt <= 0)
            return false;
        return session.expiresAt - this.margin <= Date.now();
    }
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
    async getAccessToken() {
        const session = await this.getSession();
        if (!session)
            return null;
        if (!this.needsRefresh(session))
            return session.token;
        // A failed refresh has already cleared and notified; the caller asked
        // for a token and the honest answer is that there is not one.
        const refreshed = await this.refresh().catch(() => null);
        return refreshed?.token ?? null;
    }
    // ────────── Writing ──────────────────────────────────────────────────────
    /**
     * Persist a sign-in response and announce it.
     *
     * Public because sign-in has more doors than `login()`: `verifyOtp()`,
     * `signInWithIdToken()` and `handleOAuthCallback()` all return the same
     * `AuthResponse`, and every one of them must end with a stored session
     * and a `SIGNED_IN` event or the app silently behaves as signed out
     * after a social login.
     */
    async adopt(response) {
        const session = (0, session_store_1.toStoredSession)(response);
        await this.persist(session);
        notify(this.listeners, 'SIGNED_IN', session);
        return session;
    }
    async login(input) {
        const response = await this.auth.login(input);
        await this.adopt(response);
        return response;
    }
    async register(input) {
        const response = await this.auth.register(input);
        await this.adopt(response);
        return response;
    }
    /**
     * Sign out: tell the server, then clear locally and emit `SIGNED_OUT`.
     *
     * The local clear happens even when the server call fails. A user who
     * taps "sign out" on a train, gets a network error and stays signed in
     * has been ignored on the one action where being ignored is a security
     * problem — most of all on a shared or borrowed device. The server-side
     * revoke is best effort; the device-side sign-out is not optional.
     */
    async logout() {
        const session = await this.getSession();
        if (session) {
            try {
                await this.auth.logout(session.token);
            }
            catch {
                /* best effort — the local sign-out below is the part that matters */
            }
        }
        await this.clearLocalSession();
        notify(this.listeners, 'SIGNED_OUT', null);
    }
    // ────────── Refresh ──────────────────────────────────────────────────────
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
    refresh() {
        if (this.inFlight)
            return this.inFlight;
        const run = this.runRefresh();
        this.inFlight = run;
        return run.finally(() => {
            this.inFlight = null;
        });
    }
    async runRefresh() {
        const session = await this.getSession();
        if (!session || !session.refreshToken) {
            // Never signed in, or signed in by a server that issued no refresh
            // token. Not a failure and not a sign-out — there is simply nothing
            // to refresh, and emitting SIGNED_OUT here would fire an event for a
            // state change that did not happen.
            return null;
        }
        let response;
        try {
            response = await this.auth.refresh(session.refreshToken);
        }
        catch (err) {
            // Everything lands here: a 404 from a gateway that has not shipped
            // /auth/refresh yet, an AUTH_INVALID_TOKEN from a rotated-away
            // token, a revoked session, a dead network. None of them can be
            // fixed by asking again — the first three are permanent and a retry
            // loop against a 404 would run until the app is killed — so the
            // session is cleared once and the app is told, exactly once.
            await this.failRefresh();
            throw err;
        }
        const refreshed = (0, session_store_1.toStoredSession)(response);
        if (refreshed.expiresAt > 0 && refreshed.expiresAt - Date.now() < exports.MIN_USABLE_LIFETIME_MS) {
            // A "successful" refresh that returns an already-dead token would
            // schedule the next refresh immediately and spin. Stop here instead.
            await this.failRefresh();
            throw new errors_1.XenitionError('AUTH_EXPIRED_TOKEN', 'SessionManager.refresh: the gateway returned a session that has already expired. ' +
                'Refreshing again cannot make progress, so the session was cleared.');
        }
        await this.persist(refreshed);
        notify(this.listeners, 'TOKEN_REFRESHED', refreshed);
        return refreshed;
    }
    /** Clear + announce, without retrying. */
    async failRefresh() {
        const hadSession = this.current !== null;
        await this.clearLocalSession();
        if (hadSession)
            notify(this.listeners, 'SIGNED_OUT', null);
    }
    // ────────── Timer ────────────────────────────────────────────────────────
    schedule(session) {
        this.cancelTimer();
        if (!this.autoRefresh || session.expiresAt <= 0)
            return;
        const timer = setTimeout(() => {
            void this.backgroundRefresh();
        }, this.nextDelayMs(session));
        // A pending timer keeps a Node process alive, so a CLI or a script
        // that signed in would hang at exit for the length of a token. unref
        // exists only on Node's timer object; browsers and RN return a number.
        const handle = timer;
        if (typeof handle.unref === 'function')
            handle.unref();
        this.timer = timer;
    }
    nextDelayMs(session) {
        const remaining = session.expiresAt - Date.now();
        // Already inside the margin (a session restored after the app was
        // backgrounded for an hour, or a deployment issuing tokens shorter
        // than the margin): go at half the life that is left rather than at
        // once, so a short-token deployment refreshes on a sane cadence
        // instead of on every tick.
        if (remaining <= this.margin) {
            return Math.max(Math.floor(remaining / 2), exports.MIN_REFRESH_DELAY_MS);
        }
        return remaining - this.margin;
    }
    /**
     * The timer's entry point. It swallows the rejection `refresh()` throws
     * because an unhandled rejection raised from a timer callback has no
     * caller to catch it: in Node it terminates the process, and in React
     * Native it shows the user a red screen. The failure has already been
     * handled properly — cleared and announced — before it reaches here.
     */
    async backgroundRefresh() {
        try {
            await this.refresh();
        }
        catch {
            /* already cleared and announced by failRefresh */
        }
    }
    cancelTimer() {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    // ────────── Teardown ─────────────────────────────────────────────────────
    /**
     * Stop refreshing and drop every listener.
     *
     * Needed wherever a manager is created per user or per test rather than
     * once per app: an abandoned one goes on refreshing on its own timer,
     * against a store someone else now owns.
     */
    destroy() {
        this.cancelTimer();
        this.listeners = [];
    }
    // ────────── Internals ────────────────────────────────────────────────────
    async persist(session) {
        this.current = session;
        this.loaded = true;
        await this.store.set(session);
        this.schedule(session);
    }
    async clearLocalSession() {
        this.cancelTimer();
        this.current = null;
        // Stay `loaded`: the store has been consulted and is now known empty,
        // so a later getSession() must not re-read and resurrect a value some
        // other writer put there.
        this.loaded = true;
        await this.store.clear();
    }
}
exports.SessionManager = SessionManager;
//# sourceMappingURL=session-manager.js.map