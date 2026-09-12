"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthClient = void 0;
const errors_1 = require("../core/errors");
const constants_1 = require("../constants");
/**
 * Auth client — wraps the xenition backend's `/app-platform/auth/*`
 * surface. Used through `xenition.auth`, not instantiated directly.
 *
 * Every method accepts a plain request object and returns a plain
 * response type — no `.data` unwrapping needed by callers.
 *
 * Methods that require a service key:
 *   getUserById, listUsers, searchUsers, updateUser
 * The server enforces this via the `permissions` array on the key; if
 * an anon-key caller hits one of these, the SDK throws
 * `XenitionError(code: 'AUTH_FORBIDDEN')`.
 */
/**
 * Per-request `Authorization` header for calls made ON BEHALF OF an end
 * user, or `undefined` to fall back to the client's own API key.
 *
 * Deliberately per request rather than `client.setHeader()`: a backend
 * worker handles many users concurrently through ONE client, and mutating
 * shared default headers would let one request's token leak into another's.
 */
const asUser = (accessToken) => accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined;
function requireField(context, field, value) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new errors_1.XenitionError('VALIDATION_ERROR', `${context}: "${field}" is required.`);
    }
    return value;
}
/**
 * Translate a 404 from one of the mobile endpoints into a message naming
 * the endpoint that is missing.
 *
 * A bare NOT_FOUND from `/auth/refresh` reads like "no such user", which
 * sends people debugging their token instead of their deployment. These
 * endpoints are newer than most deployments, so the distinction is not
 * hypothetical.
 */
async function requiringEndpoint(context, endpoint, call) {
    try {
        return await call();
    }
    catch (err) {
        if (err instanceof errors_1.XenitionError && err.code === 'NOT_FOUND') {
            throw new errors_1.XenitionError('NOT_FOUND', `${context}: this deployment does not implement ${endpoint}. See ` +
                'docs/PLATFORM-ENDPOINTS.md for what the gateway needs to expose.', { details: { endpoint } });
        }
        throw err;
    }
}
class AuthClient {
    constructor(http) {
        this.http = http;
    }
    // ────────── Account lifecycle ────────────────────────────────────────────
    async register(input) {
        const context = 'AuthClient.register';
        requireField(context, 'email', input?.email);
        requireField(context, 'password', input?.password);
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.REGISTER, input);
    }
    /**
     * A missing field is checked here rather than at the server, because the
     * server answers a blank login with "Invalid email or password" — which
     * sends the caller looking for a credentials problem when the real fault
     * is an undefined variable that never reached the request.
     */
    async login(input) {
        const context = 'AuthClient.login';
        requireField(context, 'email', input?.email);
        requireField(context, 'password', input?.password);
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.LOGIN, input);
    }
    logout(accessToken) {
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.LOGOUT, undefined, asUser(accessToken));
    }
    me(accessToken) {
        return this.http.get(constants_1.API_ENDPOINTS.AUTH.ME, asUser(accessToken));
    }
    updateProfile(input, accessToken) {
        return this.http.patch(constants_1.API_ENDPOINTS.AUTH.UPDATE_PROFILE, input, asUser(accessToken));
    }
    /**
     * Resolve the end user an access token belongs to.
     *
     * This is the server-side half of end-user auth: a backend holding the
     * SERVICE key takes the `Authorization: Bearer <token>` its mobile/web
     * client sent, and asks the platform who that token is. The token is
     * carried per request, so one shared client can serve many concurrent
     * users without `setHeader()` mutation racing between them.
     *
     * Throws the usual typed errors — `AUTH_INVALID_TOKEN` /
     * `AUTH_EXPIRED_TOKEN` when the platform rejects the token — so callers
     * can distinguish "bad token" (401) from "platform is down" (502).
     */
    verifyToken(accessToken) {
        if (typeof accessToken !== 'string' || accessToken.trim() === '') {
            throw new errors_1.XenitionError('AUTH_INVALID_TOKEN', 'AuthClient.verifyToken: an access token is required.');
        }
        return this.me(accessToken);
    }
    // ────────── Mobile surface ──────────────────────────────────────────────
    //
    // These call the endpoints catalogued in docs/PLATFORM-ENDPOINTS.md. Where
    // a deployment has not shipped one, the 404 is rewritten to say so.
    /**
     * Exchange a refresh token for a fresh session.
     *
     * Access tokens are short-lived by design, so without this a mobile user
     * lands back on the login screen the moment theirs expires — the app has
     * no other way to recover. Call it when a request fails with
     * `AUTH_EXPIRED_TOKEN`, then retry that request once.
     *
     * Store what comes BACK: platforms that rotate refresh tokens invalidate
     * the one you sent, so reusing it fails the second time.
     */
    async refresh(refreshToken) {
        const context = 'AuthClient.refresh';
        requireField(context, 'refreshToken', refreshToken);
        return requiringEndpoint(context, constants_1.API_ENDPOINTS.AUTH.REFRESH, () => this.http.post(constants_1.API_ENDPOINTS.AUTH.REFRESH, { refreshToken }));
    }
    /**
     * Sign in with an id token the device obtained natively.
     *
     * The fast path, and the one with a hard prerequisite: it works ONLY for an
     * app that registered its own Google/Apple client ids. A native id token's
     * audience is the app's own bundle id, so Xenition's shared credentials
     * cannot verify one — which is why this is the single part of social sign-in
     * that is not covered by the zero-configuration default. Without them the
     * server answers 412 naming `startSignIn()` as the alternative.
     *
     * Google and Apple only. GitHub issues no id token at all.
     *
     * Pass the `nonce` the app generated for this attempt. Apple echoes it
     * inside the token and the server compares the two — that is what stops a
     * token captured from another session being replayed here. Hash it for
     * Apple, send the RAW value here.
     */
    async signInWithIdToken(input) {
        const context = 'AuthClient.signInWithIdToken';
        requireField(context, 'provider', input?.provider);
        requireField(context, 'idToken', input?.idToken);
        const url = constants_1.API_ENDPOINTS.AUTH.OAUTH_ID_TOKEN(input.provider);
        return requiringEndpoint(context, url, () => this.http.post(url, {
            idToken: input.idToken,
            nonce: input.nonce,
            name: input.name,
        }));
    }
    /**
     * Send a one-time code by email or SMS.
     *
     * `verifyEmail(token)` assumes a browser can be handed a link; on mobile
     * the user is looking at a keypad. Throttling is the server's job — a
     * client-side guard protects nobody.
     */
    async sendOtp(input) {
        const context = 'AuthClient.sendOtp';
        if (!input?.email && !input?.phone) {
            throw new errors_1.XenitionError('VALIDATION_ERROR', `${context}: "email" or "phone" is required.`);
        }
        return requiringEndpoint(context, constants_1.API_ENDPOINTS.AUTH.OTP_SEND, () => this.http.post(constants_1.API_ENDPOINTS.AUTH.OTP_SEND, input));
    }
    /** Redeem a one-time code. `purpose: 'signin'` returns a full session. */
    async verifyOtp(input) {
        const context = 'AuthClient.verifyOtp';
        requireField(context, 'code', input?.code);
        if (!input?.email && !input?.phone) {
            throw new errors_1.XenitionError('VALIDATION_ERROR', `${context}: "email" or "phone" is required.`);
        }
        return requiringEndpoint(context, constants_1.API_ENDPOINTS.AUTH.OTP_VERIFY, () => this.http.post(constants_1.API_ENDPOINTS.AUTH.OTP_VERIFY, input));
    }
    /**
     * Change a signed-in user's password.
     *
     * Distinct from `resetPassword()`, which is the forgot-my-password path
     * and proves identity with an emailed token. This proves it with the
     * current password, so someone holding an unlocked phone cannot silently
     * lock the owner out of their own account.
     */
    async changePassword(input, accessToken) {
        const context = 'AuthClient.changePassword';
        requireField(context, 'currentPassword', input?.currentPassword);
        requireField(context, 'newPassword', input?.newPassword);
        return requiringEndpoint(context, constants_1.API_ENDPOINTS.AUTH.CHANGE_PASSWORD, () => this.http.post(constants_1.API_ENDPOINTS.AUTH.CHANGE_PASSWORD, input, asUser(accessToken)));
    }
    /**
     * Delete the caller's account.
     *
     * Not a nice-to-have: Apple has required in-app account deletion since
     * June 2022, and an app without it is rejected at review regardless of
     * everything else. Play and GDPR expect the same.
     *
     * `purgeAt` comes back when the platform soft-deletes with a grace
     * period, so the app can say "removed on the 3rd" rather than implying
     * the data is already gone.
     */
    async deleteAccount(accessToken, input = {}) {
        const context = 'AuthClient.deleteAccount';
        return requiringEndpoint(context, constants_1.API_ENDPOINTS.AUTH.ACCOUNT, () => this.http.del(constants_1.API_ENDPOINTS.AUTH.ACCOUNT, {
            ...asUser(accessToken),
            data: input,
        }));
    }
    /**
     * Everything the platform holds about the caller.
     *
     * The other half of the same obligation as `deleteAccount()`: a user must
     * be able to leave WITH their data, not merely to leave.
     */
    async exportData(accessToken) {
        const context = 'AuthClient.exportData';
        return requiringEndpoint(context, constants_1.API_ENDPOINTS.AUTH.ACCOUNT_EXPORT, () => this.http.get(constants_1.API_ENDPOINTS.AUTH.ACCOUNT_EXPORT, asUser(accessToken)));
    }
    /** The caller's active sessions — the "signed in on these devices" list. */
    async listSessions(accessToken) {
        const context = 'AuthClient.listSessions';
        return requiringEndpoint(context, constants_1.API_ENDPOINTS.AUTH.SESSIONS, () => this.http.get(constants_1.API_ENDPOINTS.AUTH.SESSIONS, asUser(accessToken)));
    }
    /** Sign one other device out. */
    async revokeSession(sessionId, accessToken) {
        const context = 'AuthClient.revokeSession';
        requireField(context, 'sessionId', sessionId);
        const url = constants_1.API_ENDPOINTS.AUTH.SESSION(sessionId);
        return requiringEndpoint(context, url, () => this.http.del(url, asUser(accessToken)));
    }
    /**
     * Sign every device out, this one included — the button someone reaches
     * for after losing a phone.
     */
    async revokeAllSessions(accessToken) {
        const context = 'AuthClient.revokeAllSessions';
        return requiringEndpoint(context, constants_1.API_ENDPOINTS.AUTH.SESSIONS, () => this.http.del(constants_1.API_ENDPOINTS.AUTH.SESSIONS, asUser(accessToken)));
    }
    // ────────── Admin user operations (service key only) ─────────────────────
    getUserById(userId) {
        return this.http.get(constants_1.API_ENDPOINTS.AUTH.USER_BY_ID(userId));
    }
    updateUser(userId, patch) {
        return this.http.patch(constants_1.API_ENDPOINTS.AUTH.USER_BY_ID(userId), patch);
    }
    listUsers(options = {}) {
        return this.http.get(constants_1.API_ENDPOINTS.AUTH.LIST_USERS, {
            params: options,
        });
    }
    async searchUsers(query, options = {}) {
        try {
            return await this.http.get(constants_1.API_ENDPOINTS.AUTH.SEARCH_USERS, {
                params: { q: query, ...options },
            });
        }
        catch (err) {
            // A search that finds nothing returns an empty page — it never 404s.
            // A 404 here means the gateway matched /auth/users/:id first and read
            // the literal "search" as a user id, so it answers "user not found".
            // Passing that through tells the caller their search TERM was not
            // found, which is a different and much more misleading claim.
            if (err instanceof errors_1.XenitionError && err.code === 'NOT_FOUND') {
                throw new errors_1.XenitionError('NOT_FOUND', 'AuthClient.searchUsers: the gateway answered "user not found" for the search ' +
                    'endpoint itself. /app-platform/auth/users/search is being shadowed by ' +
                    '/app-platform/auth/users/:id, which matches "search" as an id. This is a route ' +
                    'ordering bug on the server, not an empty result — your query was never run.', { status: err.status, details: err.details });
            }
            throw err;
        }
    }
    // ────────── Password reset + email verification ──────────────────────────
    async requestPasswordReset(email, redirectUrl) {
        requireField('AuthClient.requestPasswordReset', 'email', email);
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.PASSWORD_RESET_REQUEST, { email, redirectUrl });
    }
    async resetPassword(input) {
        const context = 'AuthClient.resetPassword';
        requireField(context, 'token', input?.token);
        requireField(context, 'newPassword', input?.newPassword);
        /*
          `password` as well as `newPassword`, and `email` alongside the token.
    
          The gateway reads `password` and requires `email`; this client has always
          sent `newPassword` and nothing else, so the confirm step could not
          succeed for any input — the two halves never agreed on a single field.
          Sending both spellings fixes it without a breaking change to either side,
          and lets the gateway drop the alias whenever it likes.
        */
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.PASSWORD_RESET_CONFIRM, { ...input, password: input.newPassword });
    }
    /**
     * Confirm an address with the code that was mailed to it.
     *
     * `email` for the same reason `resetPassword` needs it: the gateway keys a
     * code by `(email, purpose)`, because six digits cannot identify an account.
     * Sending only the token failed with "email and token are required" — this
     * step, like the reset it mirrors, could not be completed by any caller.
     */
    async verifyEmail(token, email) {
        requireField('AuthClient.verifyEmail', 'token', token);
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.VERIFY_EMAIL, { token, email });
    }
    // ────────── OAuth ────────────────────────────────────────────────────────
    //
    // There are two ways a user signs in with Google, Apple or GitHub, and which
    // one an app gets is not a preference — it follows from what the app has
    // registered:
    //
    //   NATIVE    the platform SDK on the device produces an `idToken`, which
    //             `signInWithIdToken()` posts. One round trip, no browser. Google
    //             and Apple only, and ONLY for an app that registered its own
    //             client ids — a native token's audience IS the app's own bundle
    //             id, so there is nothing Xenition could supply on its behalf.
    //
    //   BROKERED  `startSignIn()` returns a consent URL to open, the gateway does
    //             the code exchange, and the app redeems the one-time code with
    //             `completeSignIn()`. Runs on Xenition's own OAuth clients unless
    //             the app configured its own, so it needs NO configuration at all.
    //             The only way GitHub can work — GitHub issues no id token — and
    //             the only way anything works in Expo Go or a web build.
    //
    // `signInWithProvider()` in `@xenition/sdk/mobile` picks between them. On the
    // server side, use these directly.
    /**
     * Start a brokered sign-in. Returns the provider consent URL to open in a
     * browser, plus whether the user will see this app's name or Xenition's.
     *
     * `returnTo` is where the finished sign-in is delivered — the app's own deep
     * link (`myapp://auth`), NOT a URL registered with the provider. It must be
     * accepted by the app's return-URL rules: with none registered, any
     * custom-scheme deep link and localhost work and other http(s) URLs do not.
     */
    startSignIn(provider, returnTo) {
        return this.http.get(constants_1.API_ENDPOINTS.AUTH.OAUTH_URL(provider), { params: { returnTo } });
    }
    /**
     * Redeem the one-time code the brokered callback delivered to `returnTo`.
     *
     * The code is not a session: it is valid two minutes, bound to this app, and
     * spent on first use. Redeeming it twice is an error rather than two
     * sessions — a retry after a dropped response has to restart the sign-in.
     */
    completeSignIn(code) {
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.OAUTH_EXCHANGE, { code });
    }
    /**
     * @deprecated Use {@link startSignIn}. Identical, under the older name.
     */
    getOAuthUrl(provider, redirectUrl) {
        return this.startSignIn(provider, redirectUrl);
    }
    /**
     * @deprecated Use {@link completeSignIn}, which takes only the code.
     *
     * This posted to the provider's own callback path, which is where the
     * PROVIDER redirects a browser — never something an app calls. The state is
     * consumed by the gateway during the exchange and an app never holds one, so
     * it is ignored here.
     */
    handleOAuthCallback(provider, code, _state) {
        void provider;
        void _state;
        return this.completeSignIn(code);
    }
    /**
     * The deep links and URLs a finished sign-in may be delivered to.
     *
     * `mode` is the part worth reading: `open-to-deep-links` means nothing is
     * registered and any custom-scheme deep link works, `allowlist` means the
     * list is exhaustive — registering one URL stops custom schemes working too.
     */
    listReturnUrls() {
        return this.http.get(constants_1.API_ENDPOINTS.AUTH.OAUTH_RETURN_URLS);
    }
    /**
     * Register a return URL. Service-key call.
     *
     * Registering the FIRST one changes the app's posture: the list becomes
     * exhaustive and custom-scheme deep links stop being accepted unless they are
     * on it. That is the point — it is how an app locks itself to a universal
     * link — but it will break a working sign-in if the deep link is not added.
     */
    addReturnUrl(url) {
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.OAUTH_RETURN_URLS, { url });
    }
    /** Remove a return URL. Service-key call. */
    removeReturnUrl(url) {
        return this.http.del(constants_1.API_ENDPOINTS.AUTH.OAUTH_RETURN_URLS, { params: { url } });
    }
    /**
     * List the status of every supported OAuth provider for the current app —
     * which have custom credentials configured, which are using platform SSO,
     * which are unavailable. Render only providers whose `isAvailable` flag
     * is true on your login screen.
     */
    listSocialProviders() {
        return this.http.get(constants_1.API_ENDPOINTS.AUTH.OAUTH_PROVIDERS);
    }
    /**
     * Set this app's OWN OAuth credentials for one provider. Service-key call
     * only (the seller dashboard, not end-user code).
     *
     * Doing this has two effects worth knowing before you call it: the consent
     * screen starts showing THIS app's name instead of Xenition's, and Google or
     * Apple become usable on the fast native path, which platform credentials can
     * never offer. `deleteSocialProviderConfig()` reverts to the platform's.
     *
     * PUT, not POST — the gateway route is a PUT, and this method posted to it
     * for as long as it has existed, which is a 405 every time it was called.
     */
    configureSocialProvider(provider, input) {
        return this.http.put(constants_1.API_ENDPOINTS.AUTH.OAUTH_PROVIDER_CONFIG(provider), input);
    }
    /**
     * Remove custom credentials for one provider — the app reverts to platform
     * SSO if available, or becomes unavailable otherwise.
     */
    deleteSocialProviderConfig(provider) {
        return this.http.del(constants_1.API_ENDPOINTS.AUTH.OAUTH_PROVIDER_CONFIG(provider));
    }
    // ────────── Teams ────────────────────────────────────────────────────────
    getTeams() {
        return this.http.get(constants_1.API_ENDPOINTS.AUTH.TEAMS);
    }
    createTeam(input) {
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.TEAMS, input);
    }
    inviteToTeam(input) {
        const { teamId, ...rest } = input;
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.TEAM_INVITE(teamId), rest);
    }
}
exports.AuthClient = AuthClient;
//# sourceMappingURL=auth-client.js.map