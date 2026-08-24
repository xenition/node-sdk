import { HttpClient } from '../core/http-client';
import { AuthResponse, ChangePasswordInput, ConfigureSocialProviderInput, DeleteAccountInput, DeleteAccountResult, IdTokenSignInInput, LoginInput, OAuthProvider, OAuthUrlResult, PagedResult, RegisterInput, ResetPasswordInput, SearchUsersOptions, SendOtpInput, SendOtpResult, Session, ListUsersOptions, SocialProviderStatus, Team, TeamInvitationInput, UpdateProfileInput, User, UserDataExport, VerifyOtpInput } from './types';
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
    refresh(refreshToken: string): Promise<AuthResponse>;
    /**
     * Sign in with an id token the device obtained natively.
     *
     * This is what mobile actually does. `getOAuthUrl()` / `handleOAuthCallback()`
     * are the browser redirect dance; on iOS and Android the platform SDK
     * completes sign-in locally and hands the app an `idToken`, which the
     * server verifies against the provider's published keys.
     *
     * Pass the `nonce` the app generated for this attempt. Apple echoes it
     * inside the token and the server compares the two — that is what stops a
     * token captured from another session being replayed here.
     */
    signInWithIdToken(input: IdTokenSignInInput): Promise<AuthResponse>;
    /**
     * Send a one-time code by email or SMS.
     *
     * `verifyEmail(token)` assumes a browser can be handed a link; on mobile
     * the user is looking at a keypad. Throttling is the server's job — a
     * client-side guard protects nobody.
     */
    sendOtp(input: SendOtpInput): Promise<SendOtpResult>;
    /** Redeem a one-time code. `purpose: 'signin'` returns a full session. */
    verifyOtp(input: VerifyOtpInput): Promise<AuthResponse>;
    /**
     * Change a signed-in user's password.
     *
     * Distinct from `resetPassword()`, which is the forgot-my-password path
     * and proves identity with an emailed token. This proves it with the
     * current password, so someone holding an unlocked phone cannot silently
     * lock the owner out of their own account.
     */
    changePassword(input: ChangePasswordInput, accessToken?: string): Promise<{
        changed: true;
    }>;
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
    deleteAccount(accessToken?: string, input?: DeleteAccountInput): Promise<DeleteAccountResult>;
    /**
     * Everything the platform holds about the caller.
     *
     * The other half of the same obligation as `deleteAccount()`: a user must
     * be able to leave WITH their data, not merely to leave.
     */
    exportData(accessToken?: string): Promise<UserDataExport>;
    /** The caller's active sessions — the "signed in on these devices" list. */
    listSessions(accessToken?: string): Promise<Session[]>;
    /** Sign one other device out. */
    revokeSession(sessionId: string, accessToken?: string): Promise<{
        revoked: true;
    }>;
    /**
     * Sign every device out, this one included — the button someone reaches
     * for after losing a phone.
     */
    revokeAllSessions(accessToken?: string): Promise<{
        revoked: number;
    }>;
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