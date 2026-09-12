"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = authRouter;
const hono_1 = require("hono");
const auth_1 = require("./auth");
const client_1 = require("./client");
const errors_1 = require("./errors");
const errors_2 = require("../core/errors");
const normalize_1 = require("./normalize");
const rate_limit_1 = require("./rate-limit");
const router_utils_1 = require("./router-utils");
/**
 * An end-user credential was rejected — wrong password, wrong code, spent refresh
 * token. Carried as its own type so the router answers 401 rather than letting the
 * shared handler read it as a service-key failure and answer 502.
 */
class EndUserAuthRejection extends Error {
    constructor(message) {
        super(message);
        this.name = 'EndUserAuthRejection';
    }
}
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
const OAUTH_PROVIDERS = [
    'google',
    'github',
    'facebook',
    'twitter',
    'apple',
];
/** Every scope an OTP can carry. See `otpPurpose` for why it is checked. */
const OTP_PURPOSES = [
    'signin',
    'verify_email',
    'verify_phone',
    'reset_password',
];
function authRouter(options = {}) {
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError((err, c) => {
        if (err instanceof EndUserAuthRejection)
            return (0, errors_1.unauthorized)(c, err.message);
        return (0, errors_1.honoErrorHandler)(err, c);
    });
    app.notFound(errors_1.jsonNotFound);
    // `null`, not a module name: this router talks to `client.auth`, which is
    // not a data module and has no accessor to unlock.
    const resolveClient = (0, client_1.makeClientResolver)(null, options.client);
    const authOf = (c) => resolveClient(c).auth;
    const guard = (0, auth_1.requireAuth)({ client: options.client });
    /* ── rate limits ──────────────────────────────────────────────────────
     *
     * `Math.min` rather than `??`: an operator who lowers the global write
     * limit means it for the credential routes too, but raising it must
     * never loosen them — that is the entire reason this is a separate
     * number rather than a default.
     */
    if (options.rateLimit !== false) {
        const write = options.rateLimit ?? 10;
        const credential = (0, rate_limit_1.rateLimiter)(Math.min(write, CREDENTIAL_LIMIT));
        const standard = (0, rate_limit_1.rateLimiter)(write);
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
        app.post('/auth/oauth/exchange', standard);
    }
    /* ── sign-in (public — a signed-out user has to reach these) ─────────── */
    /**
     * Run a call that checks an END USER's credential, surfacing a rejection as 401.
     *
     * `statusForCode` maps every `AUTH_*` error to 502, and for most routes that is
     * exactly right: the worker calls the gateway with its own service key, so a 401
     * upstream means that key is bad — an operator's problem, not the caller's.
     *
     * These routes break that assumption. A password, a one-time code, a refresh
     * token and an id token are all supplied by the person at the keyboard, so a
     * rejection is about THEM. Without this, the most ordinary event in any app —
     * mistyping a password — answered `502 Upstream request failed`, which tells the
     * user the server is broken and gives the client nothing to branch on. Every app
     * on this SDK showed "something went wrong" for a typo.
     *
     * It also broke this SDK's OWN retry: `AuthClient` refreshes once on a 401, and a
     * dead refresh token returned 502, so the retry never fired and the session was
     * dropped instead of renewed.
     *
     * Deliberately narrow. Only the handlers that validate a caller-supplied
     * credential use it; everywhere else `AUTH_*` still means the service key and
     * still means 502.
     */
    const asEndUserAuth = async (c, call, message) => {
        try {
            return await call();
        }
        catch (err) {
            if (err instanceof errors_2.XenitionError && err.code.startsWith('AUTH_')) {
                // Thrown, not returned, so the handler's own `return c.json(...)` is never
                // reached and the router's error handler renders it.
                throw new EndUserAuthRejection(message);
            }
            throw err;
        }
    };
    app.post('/auth/register', async (c) => {
        const body = await readObjectBody(c);
        if (!body)
            return (0, errors_1.badRequest)(c, 'Body must be a JSON object.');
        const email = stringField(body, 'email');
        const password = stringField(body, 'password');
        if (!email || !password)
            return (0, errors_1.badRequest)(c, '"email" and "password" are required.');
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
        if (!body)
            return (0, errors_1.badRequest)(c, 'Body must be a JSON object.');
        const email = stringField(body, 'email');
        const password = stringField(body, 'password');
        if (!email || !password)
            return (0, errors_1.badRequest)(c, '"email" and "password" are required.');
        const result = await asEndUserAuth(c, () => authOf(c).login({ email, password }), 'That email and password do not match.');
        return c.json(authResultBody(result));
    });
    /**
     * Public on purpose: the caller's access token has just expired, which is
     * precisely why they are here. The refresh token IS the credential.
     */
    app.post('/auth/refresh', async (c) => {
        const body = await readObjectBody(c);
        const refreshToken = body ? stringField(body, 'refreshToken') : undefined;
        if (!refreshToken)
            return (0, errors_1.badRequest)(c, '"refreshToken" is required.');
        const result = await asEndUserAuth(c, () => authOf(c).refresh(refreshToken), 'That session has expired. Please sign in again.');
        return c.json(authResultBody(result));
    });
    /* ── one-time codes (public) ──────────────────────────────────────────── */
    app.post('/auth/otp/send', async (c) => {
        const body = await readObjectBody(c);
        if (!body)
            return (0, errors_1.badRequest)(c, 'Body must be a JSON object.');
        if (!stringField(body, 'email') && !stringField(body, 'phone')) {
            return (0, errors_1.badRequest)(c, '"email" or "phone" is required.');
        }
        const purpose = otpPurpose(body);
        if (body.purpose !== undefined && !purpose)
            return (0, errors_1.badRequest)(c, purposeMessage(body));
        // The response says a code was sent and when it expires — never whether
        // the address was one the platform knows, which would turn this route
        // into an account-enumeration oracle.
        const result = await authOf(c).sendOtp({
            ...optionalString(body, 'email'),
            ...optionalString(body, 'phone'),
            ...(purpose ? { purpose } : {}),
        });
        return c.json((0, normalize_1.normalizeRow)(result));
    });
    app.post('/auth/otp/verify', async (c) => {
        const body = await readObjectBody(c);
        if (!body)
            return (0, errors_1.badRequest)(c, 'Body must be a JSON object.');
        const code = stringField(body, 'code');
        if (!code)
            return (0, errors_1.badRequest)(c, '"code" is required.');
        if (!stringField(body, 'email') && !stringField(body, 'phone')) {
            return (0, errors_1.badRequest)(c, '"email" or "phone" is required.');
        }
        const purpose = otpPurpose(body);
        if (body.purpose !== undefined && !purpose)
            return (0, errors_1.badRequest)(c, purposeMessage(body));
        const result = await asEndUserAuth(c, () => authOf(c).verifyOtp({
            code,
            ...optionalString(body, 'email'),
            ...optionalString(body, 'phone'),
            ...(purpose ? { purpose } : {}),
        }), 'That code is not valid or has expired.');
        return c.json(authResultBody(result));
    });
    /* ── password reset + email verification (public) ─────────────────────── */
    app.post('/auth/password-reset/request', async (c) => {
        const body = await readObjectBody(c);
        if (!body)
            return (0, errors_1.badRequest)(c, 'Body must be a JSON object.');
        const email = stringField(body, 'email');
        const redirectUrl = stringField(body, 'redirectUrl');
        if (!email || !redirectUrl)
            return (0, errors_1.badRequest)(c, '"email" and "redirectUrl" are required.');
        // `{ requested: true }` whether or not the address exists — same reason
        // as the OTP route above.
        return c.json(await authOf(c).requestPasswordReset(email, redirectUrl));
    });
    app.post('/auth/password-reset/confirm', async (c) => {
        const body = await readObjectBody(c);
        if (!body)
            return (0, errors_1.badRequest)(c, 'Body must be a JSON object.');
        const token = stringField(body, 'token');
        const newPassword = stringField(body, 'newPassword');
        // Rebuilt rather than forwarded, so a caller cannot smuggle extra fields
        // upstream — but `email` has to come with it. The gateway keys a reset code
        // by (email, purpose) because six digits cannot identify an account, and
        // dropping it here made the confirm step unreachable for every caller.
        const email = stringField(body, 'email');
        if (!token || !newPassword)
            return (0, errors_1.badRequest)(c, '"token" and "newPassword" are required.');
        return c.json(await asEndUserAuth(c, () => authOf(c).resetPassword({ token, newPassword, email }), 'That code is not right, or it has expired.'));
    });
    app.post('/auth/email/verify', async (c) => {
        const body = await readObjectBody(c);
        const token = body ? stringField(body, 'token') : undefined;
        // Same rebuild, same omission as the reset confirm above: the address is
        // what the code is keyed by, so dropping it made this unreachable too.
        const email = body ? stringField(body, 'email') : undefined;
        if (!token)
            return (0, errors_1.badRequest)(c, '"token" is required.');
        return c.json(await asEndUserAuth(c, () => authOf(c).verifyEmail(token, email), 'That code is not right, or it has expired.'));
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
        return c.json({ providers: (0, normalize_1.normalizeRows)(providers) });
    });
    /**
     * Start a brokered sign-in: hand back the provider consent URL to open.
     *
     * `returnTo` is the app's OWN deep link, not anything registered with the
     * provider — the provider always redirects to the gateway, which then
     * delivers a one-time code here. `redirectUrl` is accepted as the older
     * spelling of the same parameter.
     */
    app.get('/auth/oauth/:provider/url', async (c) => {
        const provider = oauthProvider(c);
        if (!provider)
            return (0, errors_1.badRequest)(c, providerMessage(c));
        const returnTo = c.req.query('returnTo') ?? c.req.query('redirectUrl');
        if (!returnTo) {
            return (0, errors_1.badRequest)(c, '"returnTo" is required — the deep link this sign-in should come back to, such as myapp://auth.');
        }
        return c.json((0, normalize_1.normalizeRow)(await authOf(c).startSignIn(provider, returnTo)));
    });
    /**
     * Redeem the one-time code the sign-in was delivered to the app with.
     *
     * Not under `/:provider/` and not the provider's own callback path: the code
     * is bound to the app and the user, not to which button was pressed, and an
     * app receiving a deep link should not have to remember which provider
     * produced it. The old `/auth/oauth/:provider/callback` still works and
     * ignores the provider, because that is what apps already call.
     */
    app.post('/auth/oauth/exchange', async (c) => {
        const body = await readObjectBody(c);
        if (!body)
            return (0, errors_1.badRequest)(c, 'Body must be a JSON object.');
        const code = stringField(body, 'code');
        if (!code)
            return (0, errors_1.badRequest)(c, '"code" is required.');
        return c.json(authResultBody(await authOf(c).completeSignIn(code)));
    });
    app.post('/auth/oauth/:provider/callback', async (c) => {
        const body = await readObjectBody(c);
        if (!body)
            return (0, errors_1.badRequest)(c, 'Body must be a JSON object.');
        const code = stringField(body, 'code');
        if (!code)
            return (0, errors_1.badRequest)(c, '"code" is required.');
        return c.json(authResultBody(await authOf(c).completeSignIn(code)));
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
        if (!provider)
            return (0, errors_1.badRequest)(c, providerMessage(c));
        const body = await readObjectBody(c);
        if (!body)
            return (0, errors_1.badRequest)(c, 'Body must be a JSON object.');
        const idToken = stringField(body, 'idToken');
        if (!idToken)
            return (0, errors_1.badRequest)(c, '"idToken" is required.');
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
    app.get('/auth/me', guard, (c) => c.json((0, normalize_1.normalizeRow)((0, auth_1.requireUser)(c).record)));
    app.patch('/auth/profile', guard, async (c) => {
        const body = await readObjectBody(c);
        if (!body)
            return (0, errors_1.badRequest)(c, 'Body must be a JSON object.');
        const user = (0, auth_1.requireUser)(c);
        // Three fields, copied by name. Forwarding the caller's object wholesale
        // to a service-key call is how `{"role":"admin"}` or `{"id":"someone
        // -else"}` rides along with a name change.
        const updated = await authOf(c).updateProfile({
            ...optionalString(body, 'name'),
            ...optionalString(body, 'phone'),
            ...optionalObject(body, 'metadata'),
        }, user.accessToken);
        return c.json((0, normalize_1.normalizeRow)(updated));
    });
    /**
     * Change a password while signed in. Proves identity with the current
     * password rather than an emailed token, so someone holding an unlocked
     * phone cannot silently lock the owner out of their own account —
     * `/auth/password-reset/*` is the forgot-my-password path.
     */
    app.post('/auth/password', guard, async (c) => {
        const body = await readObjectBody(c);
        if (!body)
            return (0, errors_1.badRequest)(c, 'Body must be a JSON object.');
        const currentPassword = stringField(body, 'currentPassword');
        const newPassword = stringField(body, 'newPassword');
        if (!currentPassword || !newPassword) {
            return (0, errors_1.badRequest)(c, '"currentPassword" and "newPassword" are required.');
        }
        const changed = await asEndUserAuth(c, () => authOf(c).changePassword({ currentPassword, newPassword }, (0, auth_1.requireUser)(c).accessToken), 'That current password is not right.');
        return c.json(changed);
    });
    app.post('/auth/logout', guard, async (c) => {
        return c.json(await authOf(c).logout((0, auth_1.requireUser)(c).accessToken));
    });
    /* ── sessions — the "signed in on these devices" screen ───────────────── */
    app.get('/auth/sessions', guard, async (c) => {
        // `AuthClient.listSessions` answers a bare array; the client expects
        // `{ sessions }`. Wrapped here rather than changed there, so a later
        // `nextCursor` has somewhere to live without breaking every caller.
        const sessions = await authOf(c).listSessions((0, auth_1.requireUser)(c).accessToken);
        return c.json({ sessions: (0, normalize_1.normalizeRows)(sessions) });
    });
    app.delete('/auth/sessions/:sessionId', guard, async (c) => {
        const sessionId = c.req.param('sessionId');
        if (!sessionId)
            return (0, errors_1.badRequest)(c, '"sessionId" is required.');
        // Scoped by the caller's own token, never by a user id in the path: the
        // platform refuses a session that is not theirs, and this router never
        // gives it the chance to be asked about someone else's.
        const revoked = await authOf(c).revokeSession(sessionId, (0, auth_1.requireUser)(c).accessToken);
        return c.json(revoked);
    });
    /** Sign every device out, this one included — the lost-phone button. */
    app.delete('/auth/sessions', guard, async (c) => {
        return c.json(await authOf(c).revokeAllSessions((0, auth_1.requireUser)(c).accessToken));
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
        const result = await authOf(c).deleteAccount((0, auth_1.requireUser)(c).accessToken, {
            ...optionalString(body, 'password'),
            ...optionalString(body, 'reason'),
        });
        return c.json((0, normalize_1.normalizeRow)(result));
    });
    /**
     * Everything the platform holds about the caller — the other half of the
     * same obligation as deletion: a user must be able to leave WITH their
     * data, not merely to leave.
     */
    app.get('/auth/account/export', guard, async (c) => {
        const dump = await authOf(c).exportData((0, auth_1.requireUser)(c).accessToken);
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
function oauthProvider(c) {
    const value = c.req.param('provider');
    return OAUTH_PROVIDERS.find((provider) => provider === value);
}
const providerMessage = (c) => `"provider" must be one of ${OAUTH_PROVIDERS.join(', ')} — got "${c.req.param('provider')}"`;
const purposeMessage = (body) => `"purpose" must be one of ${OTP_PURPOSES.join(', ')} — got "${String(body.purpose)}"`;
/**
 * A session response, camelCased all the way down.
 *
 * `normalizeRow` only touches TOP-LEVEL keys by design (jsonb payloads keep
 * their app-authored casing), and an auth result nests two real rows inside
 * itself — so `user` and `session` are normalized explicitly. Without this
 * an engine-served `{ user: { created_at } }` would reach a frontend that
 * the gateway had taught to read `createdAt`.
 */
function authResultBody(result) {
    const body = (0, normalize_1.normalizeRow)(result);
    if (body.user)
        body.user = (0, normalize_1.normalizeRow)(body.user);
    if (body.session)
        body.session = (0, normalize_1.normalizeRow)(body.session);
    return body;
}
/** Same treatment for the data export's nested user, sessions and rows. */
function exportBody(dump) {
    const body = (0, normalize_1.normalizeRow)(dump);
    if (body.user)
        body.user = (0, normalize_1.normalizeRow)(body.user);
    if (Array.isArray(body.sessions))
        body.sessions = (0, normalize_1.normalizeRows)(body.sessions);
    if (isPlainObject(body.data)) {
        const tables = {};
        for (const [table, rows] of Object.entries(body.data)) {
            tables[table] = (0, normalize_1.normalizeRows)(rows);
        }
        body.data = tables;
    }
    return body;
}
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
function stringField(body, key) {
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
function optionalString(body, key) {
    const value = stringField(body, key);
    return (value === undefined ? {} : { [key]: value });
}
/** The same, for the free-form `metadata` object. */
function optionalObject(body, key) {
    const value = body[key];
    return (isPlainObject(value) ? { [key]: value } : {});
}
/**
 * `purpose`, matched against the known codes.
 *
 * Servers scope OTP codes so that a sign-in code cannot reset a password.
 * Forwarding an unrecognised value would either be dropped upstream — the
 * caller silently getting the default scope they did not ask for — or
 * widen it, and neither is worth guessing about.
 */
function otpPurpose(body) {
    const value = stringField(body, 'purpose');
    return OTP_PURPOSES.find((purpose) => purpose === value);
}
async function readObjectBody(c) {
    const body = await c.req.json().catch(() => undefined);
    if (typeof body !== 'object' || body === null || Array.isArray(body))
        return undefined;
    return body;
}
//# sourceMappingURL=auth-router.js.map