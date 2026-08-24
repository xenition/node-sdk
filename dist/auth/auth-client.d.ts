import { HttpClient } from '../core/http-client';
import { AuthResponse, ConfigureSocialProviderInput, LoginInput, OAuthProvider, OAuthUrlResult, PagedResult, RegisterInput, ResetPasswordInput, SearchUsersOptions, ListUsersOptions, SocialProviderStatus, Team, TeamInvitationInput, UpdateProfileInput, User } from './types';
export declare class AuthClient {
    private readonly http;
    constructor(http: HttpClient);
    register(input: RegisterInput): Promise<AuthResponse>;
    login(input: LoginInput): Promise<AuthResponse>;
    logout(accessToken?: string): Promise<{
        ok: true;
    }>;
    me(accessToken?: string): Promise<User>;
    updateProfile(input: UpdateProfileInput, accessToken?: string): Promise<User>;
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
    verifyToken(accessToken: string): Promise<User>;
    getUserById(userId: string): Promise<User>;
    updateUser(userId: string, patch: Partial<User>): Promise<User>;
    listUsers(options?: ListUsersOptions): Promise<PagedResult<User>>;
    searchUsers(query: string, options?: SearchUsersOptions): Promise<PagedResult<User>>;
    requestPasswordReset(email: string, redirectUrl: string): Promise<{
        requested: true;
    }>;
    resetPassword(input: ResetPasswordInput): Promise<{
        reset: true;
    }>;
    verifyEmail(token: string): Promise<{
        verified: true;
    }>;
    getOAuthUrl(provider: OAuthProvider, redirectUrl: string): Promise<OAuthUrlResult>;
    handleOAuthCallback(provider: OAuthProvider, code: string, state: string): Promise<AuthResponse>;
    /**
     * List the status of every supported OAuth provider for the current app —
     * which have custom credentials configured, which are using platform SSO,
     * which are unavailable. Render only providers whose `isAvailable` flag
     * is true on your login screen.
     */
    listSocialProviders(): Promise<SocialProviderStatus[]>;
    /**
     * Set custom OAuth credentials for one provider on this app. Service-key
     * call only (the seller dashboard, not end-user code). Re-configuring
     * with no `clientSecret` preserves the existing one.
     */
    configureSocialProvider(provider: OAuthProvider, input: ConfigureSocialProviderInput): Promise<SocialProviderStatus>;
    /**
     * Remove custom credentials for one provider — the app reverts to platform
     * SSO if available, or becomes unavailable otherwise.
     */
    deleteSocialProviderConfig(provider: OAuthProvider): Promise<SocialProviderStatus>;
    getTeams(): Promise<Team[]>;
    createTeam(input: {
        name: string;
        description?: string;
    }): Promise<Team>;
    inviteToTeam(input: TeamInvitationInput): Promise<{
        invited: true;
        token: string;
    }>;
}
//# sourceMappingURL=auth-client.d.ts.map