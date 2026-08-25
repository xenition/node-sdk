import { Hono } from 'hono';
import type { XenitionRouterOptions } from './types';
/**
 * `/auth` — end-user accounts over HTTP, for the app's own frontend.
 *
 * Until this router existed, `src/hono/` shipped auth MIDDLEWARE
 * (`requireAuth`) but nothing that could produce the token the middleware
 * checks. Every generated app hand-wrote its own `/auth/*` proxy, and
 * `createAppClient().auth` — the typed client for exactly these paths —
 * pointed at 404s. This is the router that contract names.
 *
 * The flow it serves:
 *
 *   1. The app posts credentials to `/auth/register` or `/auth/login` (or
 *      redeems an OTP, or hands over a native Google/Apple id token).
 *   2. It stores the `token` AND the `refreshToken` that come back.
 *   3. It sends `Authorization: Bearer <token>` on everything else — this
 *      router's account half, and every other router's `requireAuth()`
 *      routes.
 *   4. When a call answers 401 it posts the refresh token to
 *      `/auth/refresh` and retries once, rather than dumping the user back
 *      on the login screen.
 *
 * Three rules decide the whole shape of this file.
 *
 * **The user id never comes from the body.** `me`, `updateProfile`,
 * `changePassword`, `deleteAccount`, `exportData` and the session routes
 * all take it from `requireUser(c).id` / the caller's own access token.
 * These routes run inside a worker holding the platform SERVICE key, which
 * can read and write everything in the app: a `userId` field in the body
 * would not be a convenience, it would let anyone act as anyone.
 *
 * **The service-key half of `AuthClient` is not reachable from here.**
 * `listUsers`, `searchUsers`, `getUserById`, `updateUser`,
 * `configureSocialProvider`, `getTeams`, `inviteToTeam` and friends have no
 * route and must never get one. This router is mounted on a public surface
 * with the service key behind it, and a `GET /auth/users` on that surface
 * is a user directory with the door taken off. The only provider route here
 * is the read-only availability list a login screen needs.
 *
 * **Every body is whitelisted, never forwarded.** A route copies the fields
 * its input type declares and drops the rest. Passing the caller's JSON
 * through to a service-key call is how a `{"role":"admin"}` alongside a
 * registration becomes a privilege escalation.
 *
 * Two traps worth knowing about:
 *
 *   - `POST /auth/refresh`, `DELETE /auth/account` and
 *     `GET /auth/account/export` call gateway endpoints that not every
 *     deployment has shipped yet. They are mounted anyway. `AuthClient`
 *     rewrites the upstream 404 into a `NOT_FOUND` naming the missing
 *     endpoint, so the app gets "this deployment does not implement
 *     /app-platform/auth/refresh" instead of a bare 404 that reads like
 *     "no such user". Nothing here fakes or hides them: in-app account
 *     deletion has been an App Store review requirement since June 2022,
 *     and an app needs this route to exist the day the gateway ships it —
 *     not a release later.
 *   - `POST /auth/logout` ends the session upstream, but `requireAuth()`'s
 *     token cache is isolate-local with no eviction hook, so a token can
 *     still authenticate here for up to `cacheTtlSeconds` (default 60)
 *     after its owner signed out. That ceiling is the reason the cache TTL
 *     is capped low; an app that cannot tolerate even that should mount
 *     the middleware with `cacheTtlSeconds: 0`.
 *
 * Public routes are the ones a signed-out user must be able to reach:
 * register, login, refresh, OTP send/verify, password reset request and
 * confirm, email verification, native id-token sign-in, the OAuth URL and
 * callback, and the social-provider list. Everything else is behind
 * `requireAuth()`.
 */
export type AuthRouterOptions = XenitionRouterOptions;
export declare function authRouter(options?: AuthRouterOptions): Hono;
//# sourceMappingURL=auth-router.d.ts.map