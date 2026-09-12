import { HttpClient } from '../core/http-client';
import { AuthResponse, ChangePasswordInput, ConfigureSocialProviderInput, DeleteAccountInput, DeleteAccountResult, IdTokenSignInInput, LoginInput, OAuthProvider, OAuthUrlResult, PagedResult, RegisterInput, ResetPasswordInput, SearchUsersOptions, SendOtpInput, SendOtpResult, Session, ListUsersOptions, ReturnUrlMode, ReturnUrlPolicy, SocialProviderStatus, Team, TeamInvitationInput, UpdateProfileInput, User, UserDataExport, VerifyOtpInput } from './types';
export declare class AuthClient {
    private readonly http;
    constructor(http: HttpClient);
    register(input: RegisterInput): Promise<AuthResponse>;
    /**
     * A missing field is checked here rather than at the server, because the
     * server answers a blank login with "Invalid email or password" — which
     * sends the caller looking for a credentials problem when the real fault
     * is an undefined variable that never reached the request.
     */
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
    /**
     * Confirm an address with the code that was mailed to it.
     *
     * `email` for the same reason `resetPassword` needs it: the gateway keys a
     * code by `(email, purpose)`, because six digits cannot identify an account.
     * Sending only the token failed with "email and token are required" — this
     * step, like the reset it mirrors, could not be completed by any caller.
     */
    verifyEmail(token: string, email?: string): Promise<{
        verified: true;
    }>;
    /**
     * Start a brokered sign-in. Returns the provider consent URL to open in a
     * browser, plus whether the user will see this app's name or Xenition's.
     *
     * `returnTo` is where the finished sign-in is delivered — the app's own deep
     * link (`myapp://auth`), NOT a URL registered with the provider. It must be
     * accepted by the app's return-URL rules: with none registered, any
     * custom-scheme deep link and localhost work and other http(s) URLs do not.
     */
    startSignIn(provider: OAuthProvider, returnTo: string): Promise<OAuthUrlResult>;
    /**
     * Redeem the one-time code the brokered callback delivered to `returnTo`.
     *
     * The code is not a session: it is valid two minutes, bound to this app, and
     * spent on first use. Redeeming it twice is an error rather than two
     * sessions — a retry after a dropped response has to restart the sign-in.
     */
    completeSignIn(code: string): Promise<AuthResponse>;
    /**
     * @deprecated Use {@link startSignIn}. Identical, under the older name.
     */
    getOAuthUrl(provider: OAuthProvider, redirectUrl: string): Promise<OAuthUrlResult>;
    /**
     * @deprecated Use {@link completeSignIn}, which takes only the code.
     *
     * This posted to the provider's own callback path, which is where the
     * PROVIDER redirects a browser — never something an app calls. The state is
     * consumed by the gateway during the exchange and an app never holds one, so
     * it is ignored here.
     */
    handleOAuthCallback(provider: OAuthProvider, code: string, _state?: string): Promise<AuthResponse>;
    /**
     * The deep links and URLs a finished sign-in may be delivered to.
     *
     * `mode` is the part worth reading: `open-to-deep-links` means nothing is
     * registered and any custom-scheme deep link works, `allowlist` means the
     * list is exhaustive — registering one URL stops custom schemes working too.
     */
    listReturnUrls(): Promise<ReturnUrlPolicy>;
    /**
     * Register a return URL. Service-key call.
     *
     * Registering the FIRST one changes the app's posture: the list becomes
     * exhaustive and custom-scheme deep links stop being accepted unless they are
     * on it. That is the point — it is how an app locks itself to a universal
     * link — but it will break a working sign-in if the deep link is not added.
     */
    addReturnUrl(url: string): Promise<{
        url: string;
        registered: true;
    }>;
    /** Remove a return URL. Service-key call. */
    removeReturnUrl(url: string): Promise<{
        removed: string;
        remaining: number;
        mode: ReturnUrlMode;
    }>;
    /**
     * List the status of every supported OAuth provider for the current app —
     * which have custom credentials configured, which are using platform SSO,
     * which are unavailable. Render only providers whose `isAvailable` flag
     * is true on your login screen.
     */
    listSocialProviders(): Promise<SocialProviderStatus[]>;
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