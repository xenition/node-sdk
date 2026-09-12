/**
 * Types for the auth module. Mirrors the DB shapes in
 * backend/sql/app-database/0001_auth.sql so the SDK surface matches
 * server persistence 1:1.
 */
export interface User {
    id: string;
    email: string;
    role: string;
    /** ISO string */
    createdAt: string;
    /** ISO string */
    updatedAt: string;
    emailConfirmedAt?: string | null;
    lastSignInAt?: string | null;
    phone?: string | null;
    phoneConfirmedAt?: string | null;
    isSuperAdmin?: boolean;
    /** Free-form metadata set by `updateProfile()`. */
    userMetadata?: Record<string, unknown>;
    /** Server-side metadata. Rarely surfaced in clients. */
    appMetadata?: Record<string, unknown>;
    bannedUntil?: string | null;
    deletedAt?: string | null;
}
export interface Session {
    id: string;
    userId: string;
    expiresAt: string;
    createdAt: string;
    userAgent?: string | null;
    ipAddress?: string | null;
}
export interface AuthToken {
    /** JWT access token. Client stores this and sends as `Authorization: Bearer <token>`. */
    token: string;
    refreshToken: string;
    expiresAt: number;
}
export interface AuthResponse {
    user: User;
    session: Session;
    token: string;
    refreshToken: string;
    expiresAt: number;
}
export interface RegisterInput {
    email: string;
    password: string;
    name?: string;
    metadata?: Record<string, unknown>;
}
export interface LoginInput {
    email: string;
    password: string;
}
export interface UpdateProfileInput {
    name?: string;
    phone?: string;
    metadata?: Record<string, unknown>;
}
export interface ListUsersOptions {
    limit?: number;
    offset?: number;
    orderBy?: 'email' | 'created_at' | 'updated_at' | 'last_sign_in_at';
    ascending?: boolean;
}
export interface SearchUsersOptions {
    page?: number;
    limit?: number;
    sortField?: 'email' | 'created_at' | 'updated_at' | 'last_sign_in_at';
    sortDirection?: 'asc' | 'desc';
}
export interface PagedResult<T> {
    items: T[];
    total: number;
    page?: number;
    limit: number;
}
export type OAuthProvider = 'google' | 'github' | 'facebook' | 'twitter' | 'apple';
export interface OAuthUrlResult {
    /** The provider consent URL to open in a browser. */
    url: string;
    /**
     * The sealed state this sign-in carries. Returned for logging and testing
     * only — an app never has to send it back. The gateway consumes it at the
     * callback, which the app never sees.
     */
    state: string;
    provider?: OAuthProvider;
    /**
     * Whose name the user will see on the consent screen: `true` for Xenition's
     * shared OAuth client, `false` for this app's own. Worth surfacing on a login
     * screen that wants to explain the Xenition name, and the signal that this
     * app could upgrade to the faster native path by registering its own
     * credentials.
     */
    usingSSO?: boolean;
}
/**
 * How an app's return-URL rules currently behave.
 *
 * `open-to-deep-links` — nothing registered. Any custom-scheme deep link
 * (`myapp://auth`) and localhost are accepted; other http(s) URLs are not.
 * This is what makes brokered sign-in work with no configuration.
 *
 * `allowlist` — at least one URL registered, and the list is now EXHAUSTIVE.
 * Custom-scheme deep links stop working unless they are on it.
 */
export type ReturnUrlMode = 'open-to-deep-links' | 'allowlist';
export interface ReturnUrlPolicy {
    urls: string[];
    mode: ReturnUrlMode;
    /** A sentence describing `mode`, safe to show in a dashboard. */
    explanation: string;
}
/** Which sign-in path a provider will actually take for this app. */
export type SignInLane = 'native' | 'brokered';
/**
 * Status of one OAuth provider for the current app — merged view of the
 * seller's custom credentials (if any) and the platform's SSO availability.
 * Returned by `auth.listSocialProviders()`.
 */
export interface SocialProviderStatus {
    provider: OAuthProvider;
    /** Seller stored custom credentials in the dashboard. */
    configured: boolean;
    /** Custom credentials stored AND enabled. */
    enabled: boolean;
    /** Platform SSO available (xenition's shared OAuth app). */
    ssoAvailable: boolean;
    /** Login will work via either source. */
    isAvailable: boolean;
    /** Request will use platform SSO (no custom override active). */
    usingSSO: boolean;
    /** Masked client_id when configured, e.g. "1234…abcd". Never the secret. */
    clientIdMasked: string | null;
    redirectUri: string | null;
    scopes: string[] | null;
    updatedAt: string | null;
}
export interface ConfigureSocialProviderInput {
    clientId: string;
    /** Required for non-Apple providers on first configure. */
    clientSecret?: string;
    redirectUri: string;
    scopes?: string[];
    enabled?: boolean;
    /** Apple-only — server signs a JWT-derived client_secret from these. */
    teamId?: string;
    keyId?: string;
    privateKey?: string;
}
export interface Team {
    id: string;
    name: string;
    description?: string | null;
    createdBy?: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface TeamInvitationInput {
    teamId: string;
    email: string;
    role?: string;
}
export interface ResetPasswordInput {
    token: string;
    newPassword: string;
    /**
     * The address the code was sent to.
     *
     * The gateway keys a reset code by `(email, purpose)` — a six-digit code is
     * not globally unique, so it cannot identify an account on its own. Without
     * this the confirm call fails with "email and token are required" no matter
     * what else is sent.
     *
     * Optional only because a future link-style token could carry the identity
     * itself; every code-based reset must pass it.
     */
    email?: string;
}
/** Native sign-in: the id token the platform SDK produced on the device. */
export interface IdTokenSignInInput {
    provider: OAuthProvider;
    /** The `idToken` from Google Sign-In / Sign in with Apple, ON THE DEVICE. */
    idToken: string;
    /**
     * The nonce the app generated for this sign-in. Apple echoes it inside
     * the token; the server compares them to stop a token captured from
     * another session being replayed here.
     */
    nonce?: string;
    /** Apple only surfaces the name on the FIRST authorization, ever. */
    name?: string;
}
export type OtpChannel = 'email' | 'sms';
/** What the code is for. Servers scope codes so a login code cannot reset a password. */
export type OtpPurpose = 'signin' | 'verify_email' | 'verify_phone' | 'reset_password';
export interface SendOtpInput {
    email?: string;
    phone?: string;
    purpose?: OtpPurpose;
}
export interface SendOtpResult {
    sent: true;
    channel: OtpChannel;
    /** When the code stops working. */
    expiresAt: string;
    /** Seconds before another code may be requested. */
    retryAfterSeconds?: number;
}
export interface VerifyOtpInput {
    email?: string;
    phone?: string;
    code: string;
    purpose?: OtpPurpose;
}
export interface ChangePasswordInput {
    currentPassword: string;
    newPassword: string;
}
/**
 * Everything the platform holds about one user, for the export both the
 * App Store and GDPR expect an app to be able to produce.
 */
export interface UserDataExport {
    user: User;
    sessions?: Session[];
    /** Per-table rows the platform is willing to include. */
    data?: Record<string, unknown[]>;
    generatedAt: string;
}
export interface DeleteAccountInput {
    /** Some flows require the password again before destroying an account. */
    password?: string;
    reason?: string;
}
export interface DeleteAccountResult {
    deleted: true;
    /**
     * Set when the platform soft-deletes with a grace period, so the app can
     * say "your account will be removed on the 3rd" instead of implying the
     * data is already gone.
     */
    purgeAt?: string | null;
}
//# sourceMappingURL=types.d.ts.map