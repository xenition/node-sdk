import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AuthClient } from '../auth/auth-client';
import type { AuthResponse, OAuthProvider, OtpPurpose, UserDataExport } from '../auth/types';
import { requireAuth, requireUser } from './auth';
import { makeClientResolver } from './client';
import { badRequest, honoErrorHandler, jsonNotFound } from './errors';
import { normalizeRow, normalizeRows } from './normalize';
import { rateLimiter } from './rate-limit';
import { applyCors } from './router-utils';
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

/**
 * Credential routes are rate limited harder than the write default (10/min).
 *
 * Five per minute per IP sits far above any human: someone mistyping a
 * password tries it three times and then reaches for the reset link. It
 * takes a credential-stuffing run down to ~7,200 attempts a day per IP per
 * isolate, which is useless against any real password — and, more to the
 * point, against a six-digit OTP that expires in minutes and would
 * otherwise fall to a few hours of guessing at the default limit.
 */
const CREDENTIAL_LIMIT = 5;

/** Every provider the platform knows. Anything else is a 400 — see below. */
const OAUTH_PROVIDERS: readonly OAuthProvider[] = [
  'google',
  'github',
  'facebook',
  'twitter',
  'apple',
];

/** Every scope an OTP can carry. See `otpPurpose` for why it is checked. */
const OTP_PURPOSES: readonly OtpPurpose[] = [
  'signin',
  'verify_email',
  'verify_phone',
  'reset_password',
];

export function authRouter(options: AuthRouterOptions = {}): Hono {
  const app = new Hono();
  applyCors(app, options.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  // `null`, not a module name: this router talks to `client.auth`, which is
  // not a data module and has no accessor to unlock.
  const resolveClient = makeClientResolver(null, options.client);
  const authOf = (c: Context): AuthClient => resolveClient(c).auth;
  const guard = requireAuth({ client: options.client });

  /* ── rate limits ──────────────────────────────────────────────────────
   *
   * `Math.min` rather than `??`: an operator who lowers the global write
   * limit means it for the credential routes too, but raising it must
   * never loosen them — that is the entire reason this is a separate
   * number rather than a default.
   */
  if (options.rateLimit !== false) {
    const write = options.rateLimit ?? 10;
    const credential = rateLimiter(Math.min(write, CREDENTIAL_LIMIT));
    const standard = rateLimiter(write);

    app.post('/auth/register', credential);
    app.post('/auth/login', credential);
    app.post('/auth/otp/send', credential);
    app.post('/auth/otp/verify', credential);
    app.post('/auth/password-reset/request', credential);
    app.post('/auth/password-reset/confirm', credential);
    // Guessing the CURRENT password is the brute-force target here, and an
    // unlocked phone is the attacker, so this belongs with the credentials
    // rather than with the ordinary writes.
    app.post('/auth/password', credential);

    app.post('/auth/email/verify', standard);
    app.post('/auth/logout', standard);
    app.patch('/auth/profile', standard);
    app.delete('/auth/sessions', standard);
    app.delete('/auth/sessions/:sessionId', standard);
    app.delete('/auth/account', standard);
    app.post('/auth/oauth/:provider/id-token', standard);
    app.post('/auth/oauth/:provider/callback', standard);
  }

  /* ── sign-in (public — a signed-out user has to reach these) ─────────── */

  app.post('/auth/register', async (c) => {
    const body = await readObjectBody(c);
    if (!body) return badRequest(c, 'Body must be a JSON object.');
    const email = stringField(body, 'email');
    const password = stringField(body, 'password');
    if (!email || !password) return badRequest(c, '"email" and "password" are required.');
    const result = await authOf(c).register({
      email,
      password,
      ...optionalString(body, 'name'),
      ...optionalObject(body, 'metadata'),
    });
    return c.json(authResultBody(result), 201);
  });

  app.post('/auth/login', async (c) => {
    const body = await readObjectBody(c);
    if (!body) return badRequest(c, 'Body must be a JSON object.');
    const email = stringField(body, 'email');
    const password = stringField(body, 'password');
    if (!email || !password) return badRequest(c, '"email" and "password" are required.');
    return c.json(authResultBody(await authOf(c).login({ email, password })));
  });

  /**
   * Public on purpose: the caller's access token has just expired, which is
   * precisely why they are here. The refresh token IS the credential.
   */
  app.post('/auth/refresh', async (c) => {
    const body = await readObjectBody(c);
    const refreshToken = body ? stringField(body, 'refreshToken') : undefined;
    if (!refreshToken) return badRequest(c, '"refreshToken" is required.');
    return c.json(authResultBody(await authOf(c).refresh(refreshToken)));
  });

  /* ── one-time codes (public) ──────────────────────────────────────────── */

  app.post('/auth/otp/send', async (c) => {
    const body = await readObjectBody(c);
    if (!body) return badRequest(c, 'Body must be a JSON object.');
    if (!stringField(body, 'email') && !stringField(body, 'phone')) {
      return badRequest(c, '"email" or "phone" is required.');
    }
    const purpose = otpPurpose(body);
    if (body.purpose !== undefined && !purpose) return badRequest(c, purposeMessage(body));
    // The response says a code was sent and when it expires — never whether
    // the address was one the platform knows, which would turn this route
    // into an account-enumeration oracle.
    const result = await authOf(c).sendOtp({
      ...optionalString(body, 'email'),
      ...optionalString(body, 'phone'),
      ...(purpose ? { purpose } : {}),
    });
    return c.json(normalizeRow(result));
  });

  app.post('/auth/otp/verify', async (c) => {
    const body = await readObjectBody(c);
    if (!body) return badRequest(c, 'Body must be a JSON object.');
    const code = stringField(body, 'code');
    if (!code) return badRequest(c, '"code" is required.');
    if (!stringField(body, 'email') && !stringField(body, 'phone')) {
      return badRequest(c, '"email" or "phone" is required.');
    }
    const purpose = otpPurpose(body);
    if (body.purpose !== undefined && !purpose) return badRequest(c, purposeMessage(body));
    const result = await authOf(c).verifyOtp({
      code,
      ...optionalString(body, 'email'),
      ...optionalString(body, 'phone'),
      ...(purpose ? { purpose } : {}),
    });
    return c.json(authResultBody(result));
  });

  /* ── password reset + email verification (public) ─────────────────────── */

  app.post('/auth/password-reset/request', async (c) => {
    const body = await readObjectBody(c);
    if (!body) return badRequest(c, 'Body must be a JSON object.');
    const email = stringField(body, 'email');
    const redirectUrl = stringField(body, 'redirectUrl');
    if (!email || !redirectUrl) return badRequest(c, '"email" and "redirectUrl" are required.');
    // `{ requested: true }` whether or not the address exists — same reason
    // as the OTP route above.
    return c.json(await authOf(c).requestPasswordReset(email, redirectUrl));
  });

  app.post('/auth/password-reset/confirm', async (c) => {
    const body = await readObjectBody(c);
    if (!body) return badRequest(c, 'Body must be a JSON object.');
    const token = stringField(body, 'token');
    const newPassword = stringField(body, 'newPassword');
    if (!token || !newPassword) return badRequest(c, '"token" and "newPassword" are required.');
    return c.json(await authOf(c).resetPassword({ token, newPassword }));
  });

  app.post('/auth/email/verify', async (c) => {
    const body = await readObjectBody(c);
    const token = body ? stringField(body, 'token') : undefined;
    if (!token) return badRequest(c, '"token" is required.');
    return c.json(await authOf(c).verifyEmail(token));
  });

  /* ── OAuth ───────────────────────────────────────────────────────────── */

  /**
   * Which sign-in buttons to render. Public — a login screen is drawn
   * before anyone has signed in — and read-only: `configureSocialProvider`
   * writes the seller's client secrets with the service key and has no
   * route here at all.
   *
   * Registered before the `:provider` routes below. It cannot actually be
   * captured by them (they carry a third segment), but the two shapes are
   * one refactor away from colliding, and `providers` being read as a
   * provider name is not a failure anyone would enjoy debugging.
   */
  app.get('/auth/oauth/providers', async (c) => {
    const providers = await authOf(c).listSocialProviders();
    return c.json({ providers: normalizeRows(providers) });
  });

  app.get('/auth/oauth/:provider/url', async (c) => {
    const provider = oauthProvider(c);
    if (!provider) return badRequest(c, providerMessage(c));
    const redirectUrl = c.req.query('redirectUrl');
    if (!redirectUrl) return badRequest(c, '"redirectUrl" is required.');
    return c.json(normalizeRow(await authOf(c).getOAuthUrl(provider, redirectUrl)));
  });

  app.post('/auth/oauth/:provider/callback', async (c) => {
    const provider = oauthProvider(c);
    if (!provider) return badRequest(c, providerMessage(c));
    const body = await readObjectBody(c);
    if (!body) return badRequest(c, 'Body must be a JSON object.');
    const code = stringField(body, 'code');
    const state = stringField(body, 'state');
    if (!code || !state) return badRequest(c, '"code" and "state" are required.');
    const result = await authOf(c).handleOAuthCallback(provider, code, state);
    return c.json(authResultBody(result));
  });

  /**
   * Native sign-in — what a phone actually does. The device's Google/Apple
   * SDK completes sign-in locally and hands the app an id token, which the
   * platform verifies against the provider's published keys. Pass the
   * `nonce` the app generated: Apple echoes it inside the token and the
   * server compares the two, which is what stops a token captured from
   * another session being replayed here.
   */
  app.post('/auth/oauth/:provider/id-token', async (c) => {
    const provider = oauthProvider(c);
    if (!provider) return badRequest(c, providerMessage(c));
    const body = await readObjectBody(c);
    if (!body) return badRequest(c, 'Body must be a JSON object.');
    const idToken = stringField(body, 'idToken');
    if (!idToken) return badRequest(c, '"idToken" is required.');
    const result = await authOf(c).signInWithIdToken({
      provider,
      idToken,
      ...optionalString(body, 'nonce'),
      ...optionalString(body, 'name'),
    });
    return c.json(authResultBody(result));
  });

  /* ── the account half (every route below is the CALLER's own) ─────────── */

  /**
   * The signed-in caller.
   *
   * Answered from `requireUser(c).record` — the middleware just resolved
   * that by calling `auth.me()` with this very token, so asking again would
   * double the platform round trips on the route an app hits first and most
   * often. The cost is that it is as fresh as the middleware's token cache,
   * up to `cacheTtlSeconds` (default 60) old; `PATCH /auth/profile` returns
   * the updated record itself, so an app that just changed something never
   * has to come back here for it.
   */
  app.get('/auth/me', guard, (c) => c.json(normalizeRow(requireUser(c).record)));

  app.patch('/auth/profile', guard, async (c) => {
    const body = await readObjectBody(c);
    if (!body) return badRequest(c, 'Body must be a JSON object.');
    const user = requireUser(c);
    // Three fields, copied by name. Forwarding the caller's object wholesale
    // to a service-key call is how `{"role":"admin"}` or `{"id":"someone
    // -else"}` rides along with a name change.
    const updated = await authOf(c).updateProfile(
      {
        ...optionalString(body, 'name'),
        ...optionalString(body, 'phone'),
        ...optionalObject(body, 'metadata'),
      },
      user.accessToken,
    );
    return c.json(normalizeRow(updated));
  });

  /**
   * Change a password while signed in. Proves identity with the current
   * password rather than an emailed token, so someone holding an unlocked
   * phone cannot silently lock the owner out of their own account —
   * `/auth/password-reset/*` is the forgot-my-password path.
   */
  app.post('/auth/password', guard, async (c) => {
    const body = await readObjectBody(c);
    if (!body) return badRequest(c, 'Body must be a JSON object.');
    const currentPassword = stringField(body, 'currentPassword');
    const newPassword = stringField(body, 'newPassword');
    if (!currentPassword || !newPassword) {
      return badRequest(c, '"currentPassword" and "newPassword" are required.');
    }
    const changed = await authOf(c).changePassword(
      { currentPassword, newPassword },
      requireUser(c).accessToken,
    );
    return c.json(changed);
  });

  app.post('/auth/logout', guard, async (c) => {
    return c.json(await authOf(c).logout(requireUser(c).accessToken));
  });

  /* ── sessions — the "signed in on these devices" screen ───────────────── */

  app.get('/auth/sessions', guard, async (c) => {
    // `AuthClient.listSessions` answers a bare array; the client expects
    // `{ sessions }`. Wrapped here rather than changed there, so a later
    // `nextCursor` has somewhere to live without breaking every caller.
    const sessions = await authOf(c).listSessions(requireUser(c).accessToken);
    return c.json({ sessions: normalizeRows(sessions) });
  });

  app.delete('/auth/sessions/:sessionId', guard, async (c) => {
    const sessionId = c.req.param('sessionId');
    if (!sessionId) return badRequest(c, '"sessionId" is required.');
    // Scoped by the caller's own token, never by a user id in the path: the
    // platform refuses a session that is not theirs, and this router never
    // gives it the chance to be asked about someone else's.
    const revoked = await authOf(c).revokeSession(sessionId, requireUser(c).accessToken);
    return c.json(revoked);
  });

  /** Sign every device out, this one included — the lost-phone button. */
  app.delete('/auth/sessions', guard, async (c) => {
    return c.json(await authOf(c).revokeAllSessions(requireUser(c).accessToken));
  });

  /* ── account deletion + export ────────────────────────────────────────── */

  /**
   * Delete the caller's own account. Not a nice-to-have: Apple has required
   * in-app account deletion since June 2022 and rejects at review without
   * it, and Play and GDPR expect the same. See the router docstring for why
   * this is mounted before the gateway implements it.
   */
  app.delete('/auth/account', guard, async (c) => {
    // Optional body — the client sends `{}` when it has nothing to say.
    const body = (await readObjectBody(c)) ?? {};
    const result = await authOf(c).deleteAccount(requireUser(c).accessToken, {
      ...optionalString(body, 'password'),
      ...optionalString(body, 'reason'),
    });
    return c.json(normalizeRow(result));
  });

  /**
   * Everything the platform holds about the caller — the other half of the
   * same obligation as deletion: a user must be able to leave WITH their
   * data, not merely to leave.
   */
  app.get('/auth/account/export', guard, async (c) => {
    const dump = await authOf(c).exportData(requireUser(c).accessToken);
    return c.json(exportBody(dump));
  });

  return app;
}

/* ── helpers ───────────────────────────────────────────────────────────── */

/**
 * The `:provider` path param, validated against the known providers.
 *
 * Not cosmetic validation. The param is interpolated straight into the
 * upstream path (`/app-platform/auth/oauth/${provider}/url`), so an
 * unchecked value is path traversal against the platform API with the
 * SERVICE key attached — `../../users` would reach the admin surface this
 * router exists to keep out of reach.
 */
function oauthProvider(c: Context): OAuthProvider | undefined {
  const value = c.req.param('provider');
  return OAUTH_PROVIDERS.find((provider) => provider === value);
}

const providerMessage = (c: Context): string =>
  `"provider" must be one of ${OAUTH_PROVIDERS.join(', ')} — got "${c.req.param('provider')}"`;

const purposeMessage = (body: Record<string, unknown>): string =>
  `"purpose" must be one of ${OTP_PURPOSES.join(', ')} — got "${String(body.purpose)}"`;

/**
 * A session response, camelCased all the way down.
 *
 * `normalizeRow` only touches TOP-LEVEL keys by design (jsonb payloads keep
 * their app-authored casing), and an auth result nests two real rows inside
 * itself — so `user` and `session` are normalized explicitly. Without this
 * an engine-served `{ user: { created_at } }` would reach a frontend that
 * the gateway had taught to read `createdAt`.
 */
function authResultBody(result: AuthResponse): Record<string, unknown> {
  const body = normalizeRow<Record<string, unknown>>(result);
  if (body.user) body.user = normalizeRow(body.user);
  if (body.session) body.session = normalizeRow(body.session);
  return body;
}

/** Same treatment for the data export's nested user, sessions and rows. */
function exportBody(dump: UserDataExport): Record<string, unknown> {
  const body = normalizeRow<Record<string, unknown>>(dump);
  if (body.user) body.user = normalizeRow(body.user);
  if (Array.isArray(body.sessions)) body.sessions = normalizeRows(body.sessions);
  if (isPlainObject(body.data)) {
    const tables: Record<string, unknown> = {};
    for (const [table, rows] of Object.entries(body.data)) {
      tables[table] = normalizeRows(rows);
    }
    body.data = tables;
  }
  return body;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * `{ key: value }` when the field is a non-empty string, `{}` otherwise.
 *
 * Spread into the input object so an omitted optional field stays omitted
 * rather than becoming an explicit `undefined` — which some serializers
 * turn into a `null` that reads as "clear this".
 */
function optionalString<K extends string>(
  body: Record<string, unknown>,
  key: K,
): { [P in K]?: string } {
  const value = stringField(body, key);
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: string };
}

/** The same, for the free-form `metadata` object. */
function optionalObject<K extends string>(
  body: Record<string, unknown>,
  key: K,
): { [P in K]?: Record<string, unknown> } {
  const value = body[key];
  return (isPlainObject(value) ? { [key]: value } : {}) as {
    [P in K]?: Record<string, unknown>;
  };
}

/**
 * `purpose`, matched against the known codes.
 *
 * Servers scope OTP codes so that a sign-in code cannot reset a password.
 * Forwarding an unrecognised value would either be dropped upstream — the
 * caller silently getting the default scope they did not ask for — or
 * widen it, and neither is worth guessing about.
 */
function otpPurpose(body: Record<string, unknown>): OtpPurpose | undefined {
  const value = stringField(body, 'purpose');
  return OTP_PURPOSES.find((purpose) => purpose === value);
}

async function readObjectBody(c: Context): Promise<Record<string, unknown> | undefined> {
  const body = await c.req.json().catch(() => undefined);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  return body as Record<string, unknown>;
}
