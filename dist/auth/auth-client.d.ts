import { HttpClient } from '../core/http-client';
import { AuthResponse, ConfigureSocialProviderInput, LoginInput, OAuthProvider, OAuthUrlResult, PagedResult, RegisterInput, ResetPasswordInput, SearchUsersOptions, ListUsersOptions, SocialProviderStatus, Team, TeamInvitationInput, UpdateProfileInput, User } from './types';
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
export declare class AuthClient {
    private readonly http;
    constructor(http: HttpClient);
    register(input: RegisterInput): Promise<AuthResponse>;
    login(input: LoginInput): Promise<AuthResponse>;
    logout(): Promise<{
        ok: true;
    }>;
    me(): Promise<User>;
    updateProfile(input: UpdateProfileInput): Promise<User>;
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