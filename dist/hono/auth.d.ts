import type { Context, MiddlewareHandler } from 'hono';
import { XenitionClient } from '../xenition-client';
import type { User } from '../auth/types';
/**
 * End-user authentication for generated app backends.
 *
 * The routers in this directory run inside the app's own worker holding
 * the platform SERVICE key — a key that can read and write EVERYTHING in
 * the app. Without this middleware there is no notion of "who is asking",
 * so every route is effectively public and every row belongs to everyone.
 * That is fine for a brochure site and wrong for any app with accounts.
 *
 *   import { Hono } from 'hono';
 *   import { requireAuth, currentUser } from '@xenition/sdk/hono';
 *
 *   const app = new Hono();
 *   app.use('/me/*', requireAuth());
 *   app.get('/me/profile', (c) => c.json(currentUser(c)));
 *
 * The mobile/web client sends the access token it got from
 * `auth.login()` as `Authorization: Bearer <token>`; the worker asks the
 * platform who that token belongs to and hangs the answer on the request
 * context. The token is carried per request (never `setHeader()`), so one
 * shared client serves concurrent users without cross-talk.
 *
 * Two middlewares, on purpose:
 *   - `xenitionAuth()` — populate the user IF a token is present, never
 *     reject. For routes that serve guests and members differently.
 *   - `requireAuth()`  — the same, but answer 401 when the token is
 *     missing, malformed, or rejected by the platform.
 */
/** The identity of the caller, as resolved from their access token. */
export interface AuthUser {
    id: string;
    email: string;
    role: string;
    /** The full platform user record — metadata, timestamps, flags. */
    record: User;
    /** The token the caller presented, for calls made on their behalf. */
    accessToken: string;
}
export interface XenitionAuthOptions {
    /**
     * Use this client instead of building one from the environment
     * (`XENITION_API_KEY` / `XENITION_API_URL`), matching the routers.
     */
    client?: XenitionClient;
    /**
     * Seconds to reuse a verification result for the same token. Every
     * request would otherwise cost a round trip to the platform just to
     * learn who is calling.
     *
     * Default 60. Pass 0 to verify on every request. The ceiling is
     * deliberately low: this cache is how long a logged-out or banned user
     * can still be served, so it trades a little staleness for a lot of
     * latency, and never more than a minute of it.
     */
    cacheTtlSeconds?: number;
    /** Max tokens held in the isolate-local cache. Default 1000. */
    cacheMaxEntries?: number;
}
/**
 * The bearer token from the `Authorization` header, or undefined.
 *
 * Scheme match is case-insensitive ("Bearer", "bearer") because clients
 * disagree, and the value is trimmed because a trailing newline from a
 * shell-built header is a very common and very confusing 401.
 */
export declare function bearerToken(c: Context): string | undefined;
/**
 * Populate the caller's identity when they present a valid token, and
 * carry on regardless. Routes read it with `currentUser(c)`, which returns
 * undefined for guests.
 */
export declare function xenitionAuth(options?: XenitionAuthOptions): MiddlewareHandler;
/**
 * Same, but answer 401 when the caller is not authenticated. Downstream
 * handlers can use `requireUser(c)` and never deal with undefined.
 */
export declare function requireAuth(options?: XenitionAuthOptions): MiddlewareHandler;
/** The authenticated caller, or undefined when the request is a guest. */
export declare function currentUser(c: Context): AuthUser | undefined;
/**
 * The authenticated caller, or a thrown error. Only call this behind
 * `requireAuth()` — the throw means the route was mounted without it,
 * which is a wiring bug rather than a request the caller can fix.
 */
export declare function requireUser(c: Context): AuthUser;
/** The caller's id, or undefined for guests — the common case in queries. */
export declare function currentUserId(c: Context): string | undefined;
//# sourceMappingURL=auth.d.ts.map