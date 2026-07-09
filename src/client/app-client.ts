import { errorFromResponse } from './errors';
import type {
  AppClient,
  BookForm,
  BookResult,
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
  EventDetail,
  EventSummary,
  EventsListOptions,
  FormSchema,
  FormSubmitResult,
  Listing,
  ListingSubmitInput,
  ListingSubmitResult,
  ListingsListOptions,
  MediaAlbum,
  MediaAlbumWithItems,
  MediaAlbumsOptions,
  Order,
  Product,
  ProductWithVariants,
  ProductsListOptions,
  Review,
  ReviewAggregate,
  ReviewSubmitInput,
  ReviewSubmitResult,
  ReviewsResult,
  RsvpInput,
  RsvpResult,
  SlotsRange,
  Stock,
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
 * Error contract:
 *   - single-get (cms.page/cms.item, listings.get, events.get) → 404 is null
 *   - every other non-2xx throws `AppClientError(status, code?, message)`
 *     (POST validation 400s surface the server's message).
 */
export function createAppClient(baseUrl: string): AppClient {
  const base = baseUrl.replace(/\/+$/, '');
  const url = (path: string) => `${base}${path}`;

  /** GET expecting JSON; throws AppClientError on any non-2xx (incl. 404). */
  async function getJson<T>(path: string): Promise<T> {
    const res = await fetch(url(path));
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as T;
  }

  /** GET a single resource; 404 collapses to null, other non-2xx throw. */
  async function getOrNull<T>(path: string): Promise<T | null> {
    const res = await fetch(url(path));
    if (res.status === 404) return null;
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as T;
  }

  /**
   * Send a write (`POST`/`PATCH`/`DELETE`); throws AppClientError on non-2xx
   * (surfacing the 400/409 message). A `body` of `undefined` sends no body /
   * Content-Type — used by DELETE and the body-less `POST /cart`.
   */
  async function sendJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
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
