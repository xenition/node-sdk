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
class AuthClient {
    constructor(http) {
        this.http = http;
    }
    // ────────── Account lifecycle ────────────────────────────────────────────
    register(input) {
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.REGISTER, input);
    }
    login(input) {
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
    searchUsers(query, options = {}) {
        return this.http.get(constants_1.API_ENDPOINTS.AUTH.SEARCH_USERS, {
            params: { q: query, ...options },
        });
    }
    // ────────── Password reset + email verification ──────────────────────────
    requestPasswordReset(email, redirectUrl) {
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.PASSWORD_RESET_REQUEST, { email, redirectUrl });
    }
    resetPassword(input) {
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.PASSWORD_RESET_CONFIRM, input);
    }
    verifyEmail(token) {
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.VERIFY_EMAIL, { token });
    }
    // ────────── OAuth ────────────────────────────────────────────────────────
    getOAuthUrl(provider, redirectUrl) {
        return this.http.get(constants_1.API_ENDPOINTS.AUTH.OAUTH_URL(provider), { params: { redirectUrl } });
    }
    handleOAuthCallback(provider, code, state) {
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.OAUTH_CALLBACK(provider), { code, state });
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
     * Set custom OAuth credentials for one provider on this app. Service-key
     * call only (the seller dashboard, not end-user code). Re-configuring
     * with no `clientSecret` preserves the existing one.
     */
    configureSocialProvider(provider, input) {
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.OAUTH_PROVIDER_CONFIG(provider), input);
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