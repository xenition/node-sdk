import { errorFromResponse } from './errors';
import type {
  AppClient,
  AppClientOptions,
  AuthResult,
  AuthSession,
  AuthUser,
  BillingProduct,
  BillingProductsOptions,
  BookForm,
  BookResult,
  Booking,
  BookingResource,
  BookingResourcesOptions,
  BookingSlot,
  Cart,
  CartAddItemInput,
  CartUpdateItemInput,
  CheckoutStartInput,
  CheckoutStartResult,
  CmsItem,
  CmsItemsOptions,
  CmsPage,
  Collection,
  DeleteAccountInput,
  DeleteAccountResult,
  Entitlement,
  EntitlementCheck,
  EventDetail,
  EventSummary,
  EventsListOptions,
  FormSchema,
  FormSubmitResult,
  IdTokenSignInInput,
  InboxOptions,
  InboxPage,
  Job,
  Listing,
  ListingSubmitInput,
  ListingSubmitResult,
  ListingsListOptions,
  LoginInput,
  MediaAlbum,
  MediaAlbumWithItems,
  MediaAlbumsOptions,
  NotificationPreference,
  NotificationPreferenceInput,
  OAuthProvider,
  OAuthUrlResult,
  Order,
  Product,
  ProductWithVariants,
  ProductsListOptions,
  RegisterInput,
  ResetPasswordInput,
  RestorePurchasesInput,
  Review,
  ReviewAggregate,
  ReviewSubmitInput,
  ReviewSubmitResult,
  ReviewsResult,
  Rsvp,
  RsvpInput,
  RsvpResult,
  SendOtpInput,
  SendOtpResult,
  SlotsRange,
  SocialProvider,
  Stock,
  UpdateProfileInput,
  UserDataExport,
  VerifyOtpInput,
  VerifyPurchaseInput,
  VerifyPurchaseResult,
} from './types';

/**
 * `@xenition/sdk/client` — a framework-agnostic browser/worker data client
 * for a generated app's OWN backend.
 *
 * Templates render as static frontends whose backend mounts the
 * `@xenition/sdk/hono` routers (which hold the platform SERVICE key). This
 * client talks ONLY to that backend over the global `fetch` — it carries NO
 * key, no axios, and no node builtins, so it is safe to bundle into any
 * browser/worker frontend. It mirrors the router contract 1:1 and returns
 * the camelCase shapes declared in ./types.
 *
 *   import { createAppClient } from '@xenition/sdk/client';
 *   const api = createAppClient(`${import.meta.env.VITE_API_URL ?? ''}/api`);
 *   const posts = await api.cms.items('posts', { orderBy: 'created_at', direction: 'DESC' });
 *
 * Signed-in routes (all of `auth`'s account half, `jobs`, `notifications`,
 * and everything under `billing` except its public product list) sit behind
 * the backend's `requireAuth()`. Hand the client the END USER's access
 * token — their own credential from `auth.login()`, never a platform key —
 * and it attaches the `Authorization` header to every request:
 *
 *   const api = createAppClient('/api', { accessToken: () => store.getToken() });
 *   const check = await api.billing.entitlement('premium');
 *
 * Error contract:
 *   - single-get (cms.page/cms.item, listings.get, events.get, events.getRsvp,
 *     booking.getBooking, jobs.get) → 404 is null
 *   - every other non-2xx throws `AppClientError(status, code?, message)`
 *     (POST validation 400s surface the server's message).
 *   - a 402 is a PAYWALL, not a failure of the request: check
 *     `err.isPaymentRequired` and read `err.entitlement` / `err.quota`.
 *     Never branch on the message text.
 */
export function createAppClient(baseUrl: string, options: AppClientOptions = {}): AppClient {
  const base = baseUrl.replace(/\/+$/, '');
  const url = (path: string) => `${base}${path}`;

  /**
   * The `Authorization` header for this request, or undefined.
   *
   * Resolved per request rather than once at construction: a token is
   * refreshed, and a user signs out, while the client object lives on. A
   * client built without one sends no header at all — which is exactly
   * right for the public routes and for a signed-out app.
   */
  async function authHeader(): Promise<Record<string, string> | undefined> {
    const source = options.accessToken;
    if (source === undefined) return undefined;
    const token = typeof source === 'function' ? await source() : source;
    return token ? { Authorization: `Bearer ${token}` } : undefined;
  }

  /** GET, carrying the caller's token when there is one. */
  async function get(path: string): Promise<Response> {
    const headers = await authHeader();
    return headers ? fetch(url(path), { headers }) : fetch(url(path));
  }

  /** GET expecting JSON; throws AppClientError on any non-2xx (incl. 404). */
  async function getJson<T>(path: string): Promise<T> {
    const res = await get(path);
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as T;
  }

  /** GET a single resource; 404 collapses to null, other non-2xx throw. */
  async function getOrNull<T>(path: string): Promise<T | null> {
    const res = await get(path);
    if (res.status === 404) return null;
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as T;
  }

  /**
   * Send a write (`POST`/`PATCH`/`PUT`/`DELETE`); throws AppClientError on
   * non-2xx (surfacing the 400/409 message). A `body` of `undefined` sends
   * no body / Content-Type — used by DELETE and by the routes that read no
   * body at all (`POST /billing/trial`, the two mark-read routes).
   */
  async function sendJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method };
    const headers: Record<string, string> = { ...(await authHeader()) };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    if (Object.keys(headers).length > 0) init.headers = headers;
    const res = await fetch(url(path), init);
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as T;
  }

  /** POST a JSON body; throws AppClientError on non-2xx (surfacing 400 msg). */
  function postJson<T>(path: string, body: unknown): Promise<T> {
    return sendJson<T>('POST', path, body);
  }

  return {
    cms: {
      page(slug) {
        return getOrNull<CmsPage>(`/cms/pages/${encodeURIComponent(slug)}`);
      },
      async items(collectionKey, options: CmsItemsOptions = {}) {
        const qs = query({
          published: options.published,
          orderBy: options.orderBy,
          direction: options.direction,
          limit: options.limit,
          offset: options.offset,
        });
        const body = await getJson<{ items: CmsItem[] }>(
          `/cms/collections/${encodeURIComponent(collectionKey)}/items${qs}`,
        );
        return body.items ?? [];
      },
      item(collectionKey, slug) {
        return getOrNull<CmsItem>(
          `/cms/collections/${encodeURIComponent(collectionKey)}/items/${encodeURIComponent(slug)}`,
        );
      },
    },

    listings: {
      async list(options: ListingsListOptions = {}) {
        const qs = query({
          category: options.category,
          status: options.status,
          featured: options.featured,
          orderBy: options.orderBy,
          direction: options.direction,
          limit: options.limit,
          offset: options.offset,
        });
        const body = await getJson<{ listings: Listing[] }>(`/listings${qs}`);
        return body.listings ?? [];
      },
      get(slug) {
        return getOrNull<Listing>(`/listings/${encodeURIComponent(slug)}`);
      },
      async categories() {
        const body = await getJson<{ categories: string[] }>(`/listings/meta/categories`);
        return body.categories ?? [];
      },
      submit(input: ListingSubmitInput) {
        return postJson<ListingSubmitResult>(`/listings`, input);
      },
    },

    events: {
      async list(options: EventsListOptions = {}) {
        const qs = query({
          when: options.when,
          status: options.status,
          limit: options.limit,
          offset: options.offset,
        });
        const body = await getJson<{ events: EventSummary[] }>(`/events${qs}`);
        return body.events ?? [];
      },
      get(slug) {
        return getOrNull<EventDetail>(`/events/${encodeURIComponent(slug)}`);
      },
      rsvp(slug, input: RsvpInput) {
        return postJson<RsvpResult>(`/events/${encodeURIComponent(slug)}/rsvps`, input);
      },
      getRsvp(id) {
        return getOrNull<Rsvp>(`/events/rsvps/${encodeURIComponent(id)}`);
      },
    },

    forms: {
      schema(key) {
        return getJson<FormSchema>(`/forms/${encodeURIComponent(key)}`);
      },
      submit(key, data: Record<string, unknown>) {
        return postJson<FormSubmitResult>(`/forms/${encodeURIComponent(key)}/submissions`, data);
      },
    },

    reviews: {
      list(targetType, targetId) {
        return getJson<ReviewsResult>(
          `/reviews/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`,
        );
      },
      submit(targetType, targetId, input: ReviewSubmitInput) {
        return postJson<ReviewSubmitResult>(
          `/reviews/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`,
          input,
        );
      },
    },

    booking: {
      async resources(options: BookingResourcesOptions = {}) {
        const qs = query({ status: options.status });
        const body = await getJson<{ resources: BookingResource[] }>(`/booking/resources${qs}`);
        return body.resources ?? [];
      },
      resource(slug) {
        return getOrNull<BookingResource>(`/booking/resources/${encodeURIComponent(slug)}`);
      },
      async slots(slug, range: SlotsRange) {
        const qs = query({ from: range.from, to: range.to });
        const body = await getJson<{ slots: BookingSlot[] }>(
          `/booking/resources/${encodeURIComponent(slug)}/slots${qs}`,
        );
        return body.slots ?? [];
      },
      book(slug, input: BookForm) {
        return postJson<BookResult>(
          `/booking/resources/${encodeURIComponent(slug)}/bookings`,
          input,
        );
      },
      getBooking(id) {
        return getOrNull<Booking>(`/booking/bookings/${encodeURIComponent(id)}`);
      },
    },

    media: {
      async albums(options: MediaAlbumsOptions = {}) {
        const qs = query({
          published: options.published,
          orderBy: options.orderBy,
          direction: options.direction,
          limit: options.limit,
          offset: options.offset,
        });
        const body = await getJson<{ albums: MediaAlbum[] }>(`/media/albums${qs}`);
        return body.albums ?? [];
      },
      album(slug) {
        return getOrNull<MediaAlbumWithItems>(`/media/albums/${encodeURIComponent(slug)}`);
      },
      privateAlbum(slug, code) {
        return getOrNull<MediaAlbumWithItems>(
          `/media/albums/${encodeURIComponent(slug)}/private?code=${encodeURIComponent(code)}`,
        );
      },
    },

    catalog: {
      async products(options: ProductsListOptions = {}) {
        const qs = query({
          collection: options.collection,
          status: options.status,
          orderBy: options.orderBy,
          direction: options.direction,
          limit: options.limit,
          offset: options.offset,
        });
        const body = await getJson<{ products: Product[] }>(`/catalog/products${qs}`);
        return body.products ?? [];
      },
      product(slug) {
        return getOrNull<ProductWithVariants>(`/catalog/products/${encodeURIComponent(slug)}`);
      },
      async collections() {
        const body = await getJson<{ collections: Collection[] }>(`/catalog/collections`);
        return body.collections ?? [];
      },
      async collectionProducts(slug) {
        const body = await getJson<{ products: Product[] }>(
          `/catalog/collections/${encodeURIComponent(slug)}/products`,
        );
        return body.products ?? [];
      },
    },

    inventory: {
      stock(variantId) {
        return getJson<Stock>(`/inventory/${encodeURIComponent(variantId)}`);
      },
    },

    cart: {
      create() {
        return postJson<{ token: string }>(`/cart`, {});
      },
      get(token) {
        return getOrNull<Cart>(`/cart/${encodeURIComponent(token)}`);
      },
      addItem(token, input: CartAddItemInput) {
        return postJson<Cart>(`/cart/${encodeURIComponent(token)}/items`, input);
      },
      updateItem(token, itemId, input: CartUpdateItemInput) {
        return sendJson<Cart>(
          'PATCH',
          `/cart/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}`,
          input,
        );
      },
      removeItem(token, itemId) {
        return sendJson<Cart>(
          'DELETE',
          `/cart/${encodeURIComponent(token)}/items/${encodeURIComponent(itemId)}`,
        );
      },
    },

    orders: {
      get(id) {
        return getOrNull<Order>(`/orders/${encodeURIComponent(id)}`);
      },
      byNumber(number, email) {
        const qs = query({ email });
        return getOrNull<Order>(`/orders/by-number/${encodeURIComponent(number)}${qs}`);
      },
    },

    checkout: {
      start(cartToken, input: CheckoutStartInput) {
        return postJson<CheckoutStartResult>(`/checkout/${encodeURIComponent(cartToken)}`, input);
      },
      mockComplete(orderId) {
        return postJson<Order>(`/checkout/mock/complete`, { orderId });
      },
      order(id) {
        return getOrNull<Order>(`/checkout/order/${encodeURIComponent(id)}`);
      },
    },

    billing: {
      async products(options: BillingProductsOptions = {}) {
        const qs = query({ platform: options.platform });
        const body = await getJson<{ products: BillingProduct[] }>(`/billing/products${qs}`);
        return body.products ?? [];
      },
      async entitlements() {
        // Already camelCase, and not rows at all: `listEntitlements` BUILDS
        // an EntitlementCheck per record rather than handing the row through,
        // so there is nothing for ../hono/normalize.ts to do and nothing to
        // do here. What comes back is the derived "may they, right now"
        // answer for every capability — an expired subscription arrives as
        // `allowed: false, reason: 'expired'` rather than as a date to compare.
        const body = await getJson<{ entitlements: EntitlementCheck[] }>(`/billing/entitlements`);
        return body.entitlements ?? [];
      },
      entitlement(key) {
        // Already camelCase — the module BUILDS an EntitlementCheck rather
        // than returning a row, so there is nothing to normalize.
        return getJson<EntitlementCheck>(`/billing/entitlements/${encodeURIComponent(key)}`);
      },
      verify(input: VerifyPurchaseInput) {
        return postJson<VerifyPurchaseResult>(`/billing/verify`, input);
      },
      async restore(input: RestorePurchasesInput) {
        // The router answers restore from `listEntitlements` too, so this is
        // the caller's whole entitlement picture rather than only what this
        // call recovered.
        const body = await postJson<{ entitlements: EntitlementCheck[] }>(`/billing/restore`, input);
        return body.entitlements ?? [];
      },
      startTrial() {
        // No body: the trial's length is the server's, never a client
        // argument — otherwise anyone could grant themselves ten years.
        return sendJson<EntitlementCheck>('POST', `/billing/trial`);
      },
    },

    // These paths and bodies mirror the end-user half of
    // `src/auth/auth-client.ts` (and the segments of API_ENDPOINTS.AUTH,
    // minus its `/app-platform` prefix). `authRouter()` in
    // `@xenition/sdk/hono` serves them — and `hono/auth-router.spec.ts`
    // drives THIS client against THAT router, so a path or body renamed on
    // one side fails there rather than in somebody's app.
    //
    // What is deliberately absent is the service-key half — `listUsers`,
    // `searchUsers`, `getUserById`, `updateUser`, `configureSocialProvider`,
    // team administration. This client carries no key and must never look
    // like it could: a method here is a promise that a phone may call it.
    auth: {
      register(input: RegisterInput) {
        return postJson<AuthResult>(`/auth/register`, input);
      },
      login(input: LoginInput) {
        return postJson<AuthResult>(`/auth/login`, input);
      },
      refresh(refreshToken) {
        return postJson<AuthResult>(`/auth/refresh`, { refreshToken });
      },
      signInWithIdToken(input: IdTokenSignInInput) {
        return postJson<AuthResult>(
          `/auth/oauth/${encodeURIComponent(input.provider)}/id-token`,
          { idToken: input.idToken, nonce: input.nonce, name: input.name },
        );
      },
      sendOtp(input: SendOtpInput) {
        return postJson<SendOtpResult>(`/auth/otp/send`, input);
      },
      verifyOtp(input: VerifyOtpInput) {
        return postJson<AuthResult>(`/auth/otp/verify`, input);
      },
      me() {
        // Not `getOrNull`: a guest gets a 401 here, and collapsing that to
        // null would read as "no such user" and send someone debugging the
        // wrong thing.
        return getJson<AuthUser>(`/auth/me`);
      },
      updateProfile(input: UpdateProfileInput) {
        return sendJson<AuthUser>('PATCH', `/auth/profile`, input);
      },
      changePassword(input) {
        return postJson<{ changed: true }>(`/auth/password`, input);
      },
      requestPasswordReset(email, redirectUrl) {
        return postJson<{ requested: true }>(`/auth/password-reset/request`, {
          email,
          redirectUrl,
        });
      },
      resetPassword(input: ResetPasswordInput) {
        return postJson<{ reset: true }>(`/auth/password-reset/confirm`, input);
      },
      verifyEmail(token) {
        return postJson<{ verified: true }>(`/auth/email/verify`, { token });
      },
      logout() {
        return sendJson<{ ok: true }>('POST', `/auth/logout`);
      },
      async sessions() {
        const body = await getJson<{ sessions: AuthSession[] }>(`/auth/sessions`);
        return body.sessions ?? [];
      },
      revokeSession(sessionId) {
        return sendJson<{ revoked: true }>(
          'DELETE',
          `/auth/sessions/${encodeURIComponent(sessionId)}`,
        );
      },
      async revokeAllSessions() {
        const body = await sendJson<{ revoked: number }>('DELETE', `/auth/sessions`);
        return body.revoked ?? 0;
      },
      deleteAccount(input: DeleteAccountInput = {}) {
        return sendJson<DeleteAccountResult>('DELETE', `/auth/account`, input);
      },
      exportData() {
        return getJson<UserDataExport>(`/auth/account/export`);
      },
      async socialProviders() {
        const body = await getJson<{ providers: SocialProvider[] }>(`/auth/oauth/providers`);
        return body.providers ?? [];
      },
      oauthUrl(provider: OAuthProvider, redirectUrl) {
        const qs = query({ redirectUrl });
        return getJson<OAuthUrlResult>(
          `/auth/oauth/${encodeURIComponent(provider)}/url${qs}`,
        );
      },
      oauthCallback(provider: OAuthProvider, code, state) {
        return postJson<AuthResult>(`/auth/oauth/${encodeURIComponent(provider)}/callback`, {
          code,
          state,
        });
      },
    },

    jobs: {
      // One method, because the router is one route. Enqueuing is NOT a
      // public operation: the app decides what work exists and what it
      // costs, and an endpoint that let a device queue arbitrary job types
      // would be a free denial-of-service against its own worker. A job the
      // caller does not own answers 404, same as one that does not exist.
      get(id) {
        return getOrNull<Job>(`/jobs/${encodeURIComponent(id)}`);
      },
    },

    notifications: {
      inbox(options: InboxOptions = {}) {
        const qs = query({
          unread: options.unread,
          category: options.category,
          limit: options.limit,
          before: options.before,
        });
        return getJson<InboxPage>(`/notifications${qs}`);
      },
      async unreadCount() {
        const body = await getJson<{ count: number }>(`/notifications/unread-count`);
        return body.count ?? 0;
      },
      async markRead(id) {
        // The route reads no body, and its `{ read: true }` says nothing the
        // caller did not already know, so nothing is returned.
        await sendJson<{ read: true }>(
          'POST',
          `/notifications/${encodeURIComponent(id)}/read`,
        );
      },
      async markAllRead() {
        // The badge is the thing the caller actually wanted changed, and the
        // router returns it here rather than making the app pay for a second
        // round trip a moment later.
        const body = await sendJson<{ read: true; unreadCount: number }>(
          'POST',
          `/notifications/read-all`,
        );
        return body.unreadCount ?? 0;
      },
      async preferences() {
        const body = await getJson<{ preferences: NotificationPreference[] }>(
          `/notifications/preferences`,
        );
        return body.preferences ?? [];
      },
      async savePreferences(input: NotificationPreferenceInput) {
        const body = await sendJson<{ preferences: NotificationPreference[] }>(
          'PUT',
          `/notifications/preferences`,
          input,
        );
        return body.preferences ?? [];
      },
    },
  };
}

/**
 * Build a `?a=1&b=2` query string from a param map, skipping `undefined`
 * values. Booleans become the router's `1`/`0` flags; numbers stringify.
 * Returns '' when nothing is set.
 */
function query(params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    qs.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}
