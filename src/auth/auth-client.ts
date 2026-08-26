import { HttpClient } from '../core/http-client';
import { XenitionError } from '../core/errors';
import { API_ENDPOINTS } from '../constants';
import {
  AuthResponse,
  ChangePasswordInput,
  ConfigureSocialProviderInput,
  DeleteAccountInput,
  DeleteAccountResult,
  IdTokenSignInInput,
  LoginInput,
  OAuthProvider,
  OAuthUrlResult,
  PagedResult,
  RegisterInput,
  ResetPasswordInput,
  SearchUsersOptions,
  SendOtpInput,
  SendOtpResult,
  Session,
  ListUsersOptions,
  SocialProviderStatus,
  Team,
  TeamInvitationInput,
  UpdateProfileInput,
  User,
  UserDataExport,
  VerifyOtpInput,
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

function requireField(context: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new XenitionError('VALIDATION_ERROR', `${context}: "${field}" is required.`);
  }
  return value;
}

/**
 * Translate a 404 from one of the mobile endpoints into a message naming
 * the endpoint that is missing.
 *
 * A bare NOT_FOUND from `/auth/refresh` reads like "no such user", which
 * sends people debugging their token instead of their deployment. These
 * endpoints are newer than most deployments, so the distinction is not
 * hypothetical.
 */
async function requiringEndpoint<T>(
  context: string,
  endpoint: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof XenitionError && err.code === 'NOT_FOUND') {
      throw new XenitionError(
        'NOT_FOUND',
        `${context}: this deployment does not implement ${endpoint}. See ` +
          'docs/PLATFORM-ENDPOINTS.md for what the gateway needs to expose.',
        { details: { endpoint } },
      );
    }
    throw err;
  }
}

export class AuthClient {
  constructor(private readonly http: HttpClient) {}

  // ────────── Account lifecycle ────────────────────────────────────────────

  async register(input: RegisterInput): Promise<AuthResponse> {
    const context = 'AuthClient.register';
    requireField(context, 'email', input?.email);
    requireField(context, 'password', input?.password);
    return this.http.post<AuthResponse>(API_ENDPOINTS.AUTH.REGISTER, input);
  }

  /**
   * A missing field is checked here rather than at the server, because the
   * server answers a blank login with "Invalid email or password" — which
   * sends the caller looking for a credentials problem when the real fault
   * is an undefined variable that never reached the request.
   */
  async login(input: LoginInput): Promise<AuthResponse> {
    const context = 'AuthClient.login';
    requireField(context, 'email', input?.email);
    requireField(context, 'password', input?.password);
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

  // ────────── Mobile surface ──────────────────────────────────────────────
  //
  // These call the endpoints catalogued in docs/PLATFORM-ENDPOINTS.md. Where
  // a deployment has not shipped one, the 404 is rewritten to say so.

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
  async refresh(refreshToken: string): Promise<AuthResponse> {
    const context = 'AuthClient.refresh';
    requireField(context, 'refreshToken', refreshToken);
    return requiringEndpoint(context, API_ENDPOINTS.AUTH.REFRESH, () =>
      this.http.post<AuthResponse>(API_ENDPOINTS.AUTH.REFRESH, { refreshToken }),
    );
  }

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
  async signInWithIdToken(input: IdTokenSignInInput): Promise<AuthResponse> {
    const context = 'AuthClient.signInWithIdToken';
    requireField(context, 'provider', input?.provider);
    requireField(context, 'idToken', input?.idToken);
    const url = API_ENDPOINTS.AUTH.OAUTH_ID_TOKEN(input.provider);
    return requiringEndpoint(context, url, () =>
      this.http.post<AuthResponse>(url, {
        idToken: input.idToken,
        nonce: input.nonce,
        name: input.name,
      }),
    );
  }

  /**
   * Send a one-time code by email or SMS.
   *
   * `verifyEmail(token)` assumes a browser can be handed a link; on mobile
   * the user is looking at a keypad. Throttling is the server's job — a
   * client-side guard protects nobody.
   */
  async sendOtp(input: SendOtpInput): Promise<SendOtpResult> {
    const context = 'AuthClient.sendOtp';
    if (!input?.email && !input?.phone) {
      throw new XenitionError('VALIDATION_ERROR', `${context}: "email" or "phone" is required.`);
    }
    return requiringEndpoint(context, API_ENDPOINTS.AUTH.OTP_SEND, () =>
      this.http.post<SendOtpResult>(API_ENDPOINTS.AUTH.OTP_SEND, input),
    );
  }

  /** Redeem a one-time code. `purpose: 'signin'` returns a full session. */
  async verifyOtp(input: VerifyOtpInput): Promise<AuthResponse> {
    const context = 'AuthClient.verifyOtp';
    requireField(context, 'code', input?.code);
    if (!input?.email && !input?.phone) {
      throw new XenitionError('VALIDATION_ERROR', `${context}: "email" or "phone" is required.`);
    }
    return requiringEndpoint(context, API_ENDPOINTS.AUTH.OTP_VERIFY, () =>
      this.http.post<AuthResponse>(API_ENDPOINTS.AUTH.OTP_VERIFY, input),
    );
  }

  /**
   * Change a signed-in user's password.
   *
   * Distinct from `resetPassword()`, which is the forgot-my-password path
   * and proves identity with an emailed token. This proves it with the
   * current password, so someone holding an unlocked phone cannot silently
   * lock the owner out of their own account.
   */
  async changePassword(
    input: ChangePasswordInput,
    accessToken?: string,
  ): Promise<{ changed: true }> {
    const context = 'AuthClient.changePassword';
    requireField(context, 'currentPassword', input?.currentPassword);
    requireField(context, 'newPassword', input?.newPassword);
    return requiringEndpoint(context, API_ENDPOINTS.AUTH.CHANGE_PASSWORD, () =>
      this.http.post<{ changed: true }>(
        API_ENDPOINTS.AUTH.CHANGE_PASSWORD,
        input,
        asUser(accessToken),
      ),
    );
  }

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
  async deleteAccount(
    accessToken?: string,
    input: DeleteAccountInput = {},
  ): Promise<DeleteAccountResult> {
    const context = 'AuthClient.deleteAccount';
    return requiringEndpoint(context, API_ENDPOINTS.AUTH.ACCOUNT, () =>
      this.http.del<DeleteAccountResult>(API_ENDPOINTS.AUTH.ACCOUNT, {
        ...asUser(accessToken),
        data: input,
      }),
    );
  }

  /**
   * Everything the platform holds about the caller.
   *
   * The other half of the same obligation as `deleteAccount()`: a user must
   * be able to leave WITH their data, not merely to leave.
   */
  async exportData(accessToken?: string): Promise<UserDataExport> {
    const context = 'AuthClient.exportData';
    return requiringEndpoint(context, API_ENDPOINTS.AUTH.ACCOUNT_EXPORT, () =>
      this.http.get<UserDataExport>(API_ENDPOINTS.AUTH.ACCOUNT_EXPORT, asUser(accessToken)),
    );
  }

  /** The caller's active sessions — the "signed in on these devices" list. */
  async listSessions(accessToken?: string): Promise<Session[]> {
    const context = 'AuthClient.listSessions';
    return requiringEndpoint(context, API_ENDPOINTS.AUTH.SESSIONS, () =>
      this.http.get<Session[]>(API_ENDPOINTS.AUTH.SESSIONS, asUser(accessToken)),
    );
  }

  /** Sign one other device out. */
  async revokeSession(sessionId: string, accessToken?: string): Promise<{ revoked: true }> {
    const context = 'AuthClient.revokeSession';
    requireField(context, 'sessionId', sessionId);
    const url = API_ENDPOINTS.AUTH.SESSION(sessionId);
    return requiringEndpoint(context, url, () =>
      this.http.del<{ revoked: true }>(url, asUser(accessToken)),
    );
  }

  /**
   * Sign every device out, this one included — the button someone reaches
   * for after losing a phone.
   */
  async revokeAllSessions(accessToken?: string): Promise<{ revoked: number }> {
    const context = 'AuthClient.revokeAllSessions';
    return requiringEndpoint(context, API_ENDPOINTS.AUTH.SESSIONS, () =>
      this.http.del<{ revoked: number }>(API_ENDPOINTS.AUTH.SESSIONS, asUser(accessToken)),
    );
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

  async searchUsers(
    query: string,
    options: SearchUsersOptions = {},
  ): Promise<PagedResult<User>> {
    try {
      return await this.http.get<PagedResult<User>>(API_ENDPOINTS.AUTH.SEARCH_USERS, {
        params: { q: query, ...options },
      });
    } catch (err) {
      // A search that finds nothing returns an empty page — it never 404s.
      // A 404 here means the gateway matched /auth/users/:id first and read
      // the literal "search" as a user id, so it answers "user not found".
      // Passing that through tells the caller their search TERM was not
      // found, which is a different and much more misleading claim.
      if (err instanceof XenitionError && err.code === 'NOT_FOUND') {
        throw new XenitionError(
          'NOT_FOUND',
          'AuthClient.searchUsers: the gateway answered "user not found" for the search ' +
            'endpoint itself. /app-platform/auth/users/search is being shadowed by ' +
            '/app-platform/auth/users/:id, which matches "search" as an id. This is a route ' +
            'ordering bug on the server, not an empty result — your query was never run.',
          { status: err.status, details: err.details },
        );
      }
      throw err;
    }
  }

  // ────────── Password reset + email verification ──────────────────────────

  async requestPasswordReset(
    email: string,
    redirectUrl: string,
  ): Promise<{ requested: true }> {
    requireField('AuthClient.requestPasswordReset', 'email', email);
    return this.http.post<{ requested: true }>(
      API_ENDPOINTS.AUTH.PASSWORD_RESET_REQUEST,
      { email, redirectUrl },
    );
  }

  async resetPassword(input: ResetPasswordInput): Promise<{ reset: true }> {
    const context = 'AuthClient.resetPassword';
    requireField(context, 'token', input?.token);
    requireField(context, 'newPassword', input?.newPassword);
    return this.http.post<{ reset: true }>(
      API_ENDPOINTS.AUTH.PASSWORD_RESET_CONFIRM,
      input,
    );
  }

  async verifyEmail(token: string): Promise<{ verified: true }> {
    requireField('AuthClient.verifyEmail', 'token', token);
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
