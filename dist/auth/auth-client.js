"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthClient = void 0;
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
    logout() {
        return this.http.post(constants_1.API_ENDPOINTS.AUTH.LOGOUT);
    }
    me() {
        return this.http.get(constants_1.API_ENDPOINTS.AUTH.ME);
    }
    updateProfile(input) {
        return this.http.patch(constants_1.API_ENDPOINTS.AUTH.UPDATE_PROFILE, input);
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