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
    url: string;
    state: string;
}
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
}
//# sourceMappingURL=types.d.ts.map