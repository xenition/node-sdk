import { HttpClient } from '../core/http-client';
import { XenitionError } from '../core/errors';
import { API_ENDPOINTS } from '../constants';
import {
  AuthResponse,
  ConfigureSocialProviderInput,
  LoginInput,
  OAuthProvider,
  OAuthUrlResult,
  PagedResult,
  RegisterInput,
  ResetPasswordInput,
  SearchUsersOptions,
  ListUsersOptions,
  SocialProviderStatus,
  Team,
  TeamInvitationInput,
  UpdateProfileInput,
  User,
} from './types';

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
const asUser = (accessToken?: string) =>
  accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined;

export class AuthClient {
  constructor(private readonly http: HttpClient) {}

  // ────────── Account lifecycle ────────────────────────────────────────────

  register(input: RegisterInput): Promise<AuthResponse> {
    return this.http.post<AuthResponse>(API_ENDPOINTS.AUTH.REGISTER, input);
  }

  login(input: LoginInput): Promise<AuthResponse> {
    return this.http.post<AuthResponse>(API_ENDPOINTS.AUTH.LOGIN, input);
  }

  logout(accessToken?: string): Promise<{ ok: true }> {
    return this.http.post<{ ok: true }>(
      API_ENDPOINTS.AUTH.LOGOUT,
      undefined,
      asUser(accessToken),
    );
  }

  me(accessToken?: string): Promise<User> {
    return this.http.get<User>(API_ENDPOINTS.AUTH.ME, asUser(accessToken));
  }

  updateProfile(input: UpdateProfileInput, accessToken?: string): Promise<User> {
    return this.http.patch<User>(
      API_ENDPOINTS.AUTH.UPDATE_PROFILE,
      input,
      asUser(accessToken),
    );
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
  verifyToken(accessToken: string): Promise<User> {
    if (typeof accessToken !== 'string' || accessToken.trim() === '') {
      throw new XenitionError(
        'AUTH_INVALID_TOKEN',
        'AuthClient.verifyToken: an access token is required.',
      );
    }
    return this.me(accessToken);
  }

  // ────────── Admin user operations (service key only) ─────────────────────

  getUserById(userId: string): Promise<User> {
    return this.http.get<User>(API_ENDPOINTS.AUTH.USER_BY_ID(userId));
  }

  updateUser(userId: string, patch: Partial<User>): Promise<User> {
    return this.http.patch<User>(API_ENDPOINTS.AUTH.USER_BY_ID(userId), patch);
  }

  listUsers(options: ListUsersOptions = {}): Promise<PagedResult<User>> {
    return this.http.get<PagedResult<User>>(API_ENDPOINTS.AUTH.LIST_USERS, {
      params: options,
    });
  }

  searchUsers(
    query: string,
    options: SearchUsersOptions = {},
  ): Promise<PagedResult<User>> {
    return this.http.get<PagedResult<User>>(API_ENDPOINTS.AUTH.SEARCH_USERS, {
      params: { q: query, ...options },
    });
  }

  // ────────── Password reset + email verification ──────────────────────────

  requestPasswordReset(
    email: string,
    redirectUrl: string,
  ): Promise<{ requested: true }> {
    return this.http.post<{ requested: true }>(
      API_ENDPOINTS.AUTH.PASSWORD_RESET_REQUEST,
      { email, redirectUrl },
    );
  }

  resetPassword(input: ResetPasswordInput): Promise<{ reset: true }> {
    return this.http.post<{ reset: true }>(
      API_ENDPOINTS.AUTH.PASSWORD_RESET_CONFIRM,
      input,
    );
  }

  verifyEmail(token: string): Promise<{ verified: true }> {
    return this.http.post<{ verified: true }>(
      API_ENDPOINTS.AUTH.VERIFY_EMAIL,
      { token },
    );
  }

  // ────────── OAuth ────────────────────────────────────────────────────────

  getOAuthUrl(
    provider: OAuthProvider,
    redirectUrl: string,
  ): Promise<OAuthUrlResult> {
    return this.http.get<OAuthUrlResult>(
      API_ENDPOINTS.AUTH.OAUTH_URL(provider),
      { params: { redirectUrl } },
    );
  }

  handleOAuthCallback(
    provider: OAuthProvider,
    code: string,
    state: string,
  ): Promise<AuthResponse> {
    return this.http.post<AuthResponse>(
      API_ENDPOINTS.AUTH.OAUTH_CALLBACK(provider),
      { code, state },
    );
  }

  /**
   * List the status of every supported OAuth provider for the current app —
   * which have custom credentials configured, which are using platform SSO,
   * which are unavailable. Render only providers whose `isAvailable` flag
   * is true on your login screen.
   */
  listSocialProviders(): Promise<SocialProviderStatus[]> {
    return this.http.get<SocialProviderStatus[]>(API_ENDPOINTS.AUTH.OAUTH_PROVIDERS);
  }

  /**
   * Set custom OAuth credentials for one provider on this app. Service-key
   * call only (the seller dashboard, not end-user code). Re-configuring
   * with no `clientSecret` preserves the existing one.
   */
  configureSocialProvider(
    provider: OAuthProvider,
    input: ConfigureSocialProviderInput,
  ): Promise<SocialProviderStatus> {
    return this.http.post<SocialProviderStatus>(
      API_ENDPOINTS.AUTH.OAUTH_PROVIDER_CONFIG(provider),
      input,
    );
  }

  /**
   * Remove custom credentials for one provider — the app reverts to platform
   * SSO if available, or becomes unavailable otherwise.
   */
  deleteSocialProviderConfig(
    provider: OAuthProvider,
  ): Promise<SocialProviderStatus> {
    return this.http.del<SocialProviderStatus>(
      API_ENDPOINTS.AUTH.OAUTH_PROVIDER_CONFIG(provider),
    );
  }

  // ────────── Teams ────────────────────────────────────────────────────────

  getTeams(): Promise<Team[]> {
    return this.http.get<Team[]>(API_ENDPOINTS.AUTH.TEAMS);
  }

  createTeam(input: { name: string; description?: string }): Promise<Team> {
    return this.http.post<Team>(API_ENDPOINTS.AUTH.TEAMS, input);
  }

  inviteToTeam(
    input: TeamInvitationInput,
  ): Promise<{ invited: true; token: string }> {
    const { teamId, ...rest } = input;
    return this.http.post<{ invited: true; token: string }>(
      API_ENDPOINTS.AUTH.TEAM_INVITE(teamId),
      rest,
    );
  }
}
