import { HttpClient } from '../core/http-client';
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
export class AuthClient {
  constructor(private readonly http: HttpClient) {}

  // ────────── Account lifecycle ────────────────────────────────────────────

  register(input: RegisterInput): Promise<AuthResponse> {
    return this.http.post<AuthResponse>(API_ENDPOINTS.AUTH.REGISTER, input);
  }

  login(input: LoginInput): Promise<AuthResponse> {
    return this.http.post<AuthResponse>(API_ENDPOINTS.AUTH.LOGIN, input);
  }

  logout(): Promise<{ ok: true }> {
    return this.http.post<{ ok: true }>(API_ENDPOINTS.AUTH.LOGOUT);
  }

  me(): Promise<User> {
    return this.http.get<User>(API_ENDPOINTS.AUTH.ME);
  }

  updateProfile(input: UpdateProfileInput): Promise<User> {
    return this.http.patch<User>(API_ENDPOINTS.AUTH.UPDATE_PROFILE, input);
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
