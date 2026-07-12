/**
 * Response + request types for `@xenition/sdk/client`.
 *
 * These are the CAMEL-CASE API shapes — the exact JSON a template receives
 * from its own backend (the `@xenition/sdk/hono` routers normalize every row
 * to camelCase; see ../hono/normalize.ts). They are the single source of
 * truth templates import, so they can never drift from the routers.
 *
 * NOTE: the sibling module row types (`../modules/<name>/types.ts`) are snake_case
 * shapes (the wire contract with the platform engine). The types here are
 * their camelCase API projections — defined explicitly so a column rename in
 * a module type can't silently change the public client contract.
 */
export interface CmsPage {
    id: string;
    slug: string;
    title: string;
    bodyHtml: string;
    seo: Record<string, unknown>;
    published: boolean;
    sort: number;
    createdAt: string;
    updatedAt: string;
}
export interface CmsItem {
    id: string;
    collectionId: string;
    slug: string;
    title: string;
    data: Record<string, unknown>;
    published: boolean;
    sort: number;
    createdAt: string;
    updatedAt: string;
}
export interface CmsItemsOptions {
    /** Filter on the published flag; omit for the router's published-only default. */
    published?: boolean;
    /** Column to order by (whitelisted server-side); defaults to `sort`. */
    orderBy?: string;
    direction?: 'ASC' | 'DESC';
    limit?: number;
    offset?: number;
}
export type ListingStatus = 'draft' | 'pending' | 'published' | 'expired' | 'archived';
export interface Listing {
    id: string;
    category: string;
    title: string;
    slug: string;
    summary: string;
    body: string;
    data: Record<string, unknown>;
    status: ListingStatus;
    featured: boolean;
    createdAt: string;
    publishedAt: string | null;
    expiresAt: string | null;
}
export interface ListingsListOptions {
    /**
     * Free-text category bucket. The router REQUIRES this (a missing category
     * is a 400) — it is optional here only so the type mirrors the query.
     */
    category?: string;
    /** Status filter — defaults to 'published' (the public surface). */
    status?: ListingStatus;
    /** Restrict to featured (true) / non-featured (false); unset = either. */
    featured?: boolean;
    orderBy?: string;
    direction?: 'ASC' | 'DESC';
    limit?: number;
    offset?: number;
}
export interface ListingSubmitInput {
    category: string;
    title: string;
    summary?: string;
    body?: string;
    data?: Record<string, unknown>;
}
export interface ListingSubmitResult {
    id: string;
    slug: string;
    /** Public submissions always land 'pending'. */
    status: ListingStatus;
}
export type EventStatus = 'draft' | 'published' | 'cancelled';
/** Which slice of the calendar `events.list()` returns. */
export type EventWhen = 'upcoming' | 'past' | 'all';
/** The list-route event shape (no seat counts). */
export interface EventSummary {
    id: string;
    slug: string;
    title: string;
    summary: string;
    body: string;
    data: Record<string, unknown>;
    startsAt: string;
    endsAt: string | null;
    capacity: number;
    status: EventStatus;
    createdAt: string;
}
/** A single event merged with its live seat tallies (the get route). */
export interface EventDetail extends EventSummary {
    confirmedCount: number;
    waitlistCount: number;
    /** null for unlimited (capacity 0) events. */
    spotsLeft: number | null;
}
export interface EventsListOptions {
    /** 'upcoming' (default) | 'past' | 'all'. */
    when?: EventWhen;
    /** A specific status (default 'published'), or 'all' to skip the filter. */
    status?: EventStatus | 'all';
    limit?: number;
    offset?: number;
}
export interface RsvpInput {
    name: string;
    email: string;
    /** 1–20; defaults to 1. */
    partySize?: number;
}
export interface RsvpResult {
    id: string;
    status: 'confirmed' | 'waitlist';
}
export type FormFieldType = 'text' | 'email' | 'number' | 'boolean' | 'select';
export interface FormField {
    name: string;
    type: FormFieldType;
    required?: boolean;
    maxLength?: number;
    options?: string[];
}
/** The form's renderable field schema (GET /forms/:key). */
export interface FormSchema {
    id: string;
    key: string;
    name: string;
    fields: FormField[];
    createdAt: string;
    updatedAt: string;
}
export interface FormSubmitResult {
    id: string;
}
export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export interface Review {
    id: string;
    targetType: string;
    targetId: string;
    authorName: string;
    /** Integer 1–5. */
    rating: number;
    title: string;
    body: string;
    status: ReviewStatus;
    createdAt: string;
}
export interface ReviewAggregate {
    /** Number of approved reviews for the target. */
    count: number;
    /** Mean approved rating, or null when there are none. */
    average: number | null;
}
/** Reviews + aggregate in one payload (a review widget needs both). */
export interface ReviewsResult {
    reviews: Review[];
    aggregate: ReviewAggregate;
}
export interface ReviewSubmitInput {
    authorName: string;
    rating: number;
    title?: string;
    body?: string;
}
export interface ReviewSubmitResult {
    id: string;
    /** Submissions always land 'pending'. */
    status: ReviewStatus;
}
export type ResourceStatus = 'active' | 'inactive';
export type BookingStatus = 'confirmed' | 'cancelled';
/**
 * One weekly availability rule: the resource is open on `weekday`
 * (0=Sunday..6=Saturday) from `start` to `end`, each `HH:MM` resource-local
 * wall clock. These jsonb inner keys are already camelCase, so they survive
 * normalization unchanged.
 */
export interface AvailabilityRule {
    /** 0=Sunday .. 6=Saturday. */
    weekday: number;
    /** `HH:MM`, resource-local wall clock. */
    start: string;
    /** `HH:MM` (may be `24:00`), resource-local wall clock; must be > `start`. */
    end: string;
}
/** A bookable resource (person, room, table, or equipment). */
export interface BookingResource {
    id: string;
    slug: string;
    name: string;
    /** Free-form kind: 'service', 'room', 'table', 'staff', … */
    type: string;
    /** IANA timezone id (e.g. 'America/New_York'). */
    timezone: string;
    /** Concurrent capacity per slot (>=1). */
    capacity: number;
    /** Slot length in minutes. */
    slotMinutes: number;
    /** Gap enforced after each slot before the next can start. */
    bufferMinutes: number;
    /** How far ahead of now a slot must be to be bookable. */
    minNoticeMinutes: number;
    /** How far into the future bookings are allowed. */
    maxAdvanceDays: number;
    /** Weekly availability rules. */
    availability: AvailabilityRule[];
    /** Free-form jsonb payload: description, price hint, location, … */
    data: Record<string, unknown>;
    status: ResourceStatus;
    createdAt: string;
}
export interface BookingResourcesOptions {
    /** A specific status (default 'active'), or 'all' to skip the filter. */
    status?: ResourceStatus | 'all';
}
/** The window to expand availability over. Both ISO-8601; `to` after `from`. */
export interface SlotsRange {
    from: string;
    to: string;
}
/** A concrete bookable slot. `spotsLeft` is capacity minus confirmed seats. */
export interface BookingSlot {
    /** ISO-8601 (UTC). */
    startsAt: string;
    /** ISO-8601 (UTC). */
    endsAt: string;
    spotsLeft: number;
}
export interface BookForm {
    /** ISO-8601 slot start; must match a real, open slot. */
    startsAt: string;
    customerName: string;
    customerEmail: string;
    /** Seats requested within the slot's capacity; defaults to 1. */
    partySize?: number;
    notes?: string;
}
/** The 201 result of a booking. A lost slot is a 409 SLOT_UNAVAILABLE throw. */
export interface BookResult {
    id: string;
    startsAt: string;
    status: BookingStatus;
}
export type MediaKind = 'image' | 'video';
export interface MediaAlbum {
    id: string;
    slug: string;
    title: string;
    description: string;
    /** Storage URL of the cover image; null when unset. */
    coverUrl: string | null;
    /** Free-form jsonb payload: theme, credits, layout hints, … */
    data: Record<string, unknown>;
    published: boolean;
    sort: number;
    createdAt: string;
}
export interface MediaItem {
    id: string;
    albumId: string;
    /** Storage URL of the underlying file. */
    url: string;
    kind: MediaKind;
    caption: string;
    alt: string;
    /** Pixel dimensions; null when unknown. */
    width: number | null;
    height: number | null;
    sort: number;
    data: Record<string, unknown>;
    createdAt: string;
}
/** An album merged with its ordered items (the `album(slug)` shape). */
export type MediaAlbumWithItems = MediaAlbum & {
    items: MediaItem[];
};
export interface MediaAlbumsOptions {
    /** Filter on the published flag; omit for all rows. */
    published?: boolean;
    /** Column to order by (whitelisted server-side); defaults to `sort`. */
    orderBy?: string;
    direction?: 'ASC' | 'DESC';
    limit?: number;
    offset?: number;
}
export type ProductStatus = 'draft' | 'published';
/** A collection groups products (a storefront category / department). */
export interface Collection {
    id: string;
    slug: string;
    title: string;
    description: string;
    sort: number;
    createdAt: string;
}
/**
 * The catalog entry a shopper browses. The product routes add a `variants`
 * array (see `ProductWithVariants`). All money is integer minor units (cents).
 */
export interface Product {
    id: string;
    slug: string;
    title: string;
    description: string;
    /** Owning collection id, or null when uncategorized. */
    collectionId: string | null;
    status: ProductStatus;
    /** Primary image, or null. */
    imageUrl: string | null;
    /** Free-form jsonb payload: specs, tags, SEO, … */
    data: Record<string, unknown>;
    sort: number;
    createdAt: string;
}
/** One purchasable SKU of a product. Price lives on the variant. */
export interface ProductVariant {
    id: string;
    productId: string;
    /** Stock-keeping unit code, or null. */
    sku: string | null;
    title: string;
    /** Price in integer minor units (cents). Never a float. */
    priceCents: number;
    /** ISO-4217 currency code; defaults to 'USD'. */
    currency: string;
    /** Optional "was" price in cents (for a strike-through), or null. */
    compareAtCents: number | null;
    /** Variant axes, e.g. `{ size: 'M', color: 'Red' }`. */
    options: Record<string, unknown>;
    /** Variant image, or null. */
    imageUrl: string | null;
    sort: number;
    createdAt: string;
}
/** A product enriched with its variants (ordered by sort). */
export type ProductWithVariants = Product & {
    variants: ProductVariant[];
};
export interface ProductsListOptions {
    /** Filter to a collection by SLUG; unknown slug yields an empty list. */
    collection?: string;
    /** A specific status (default 'published'), or 'all' to skip the filter. */
    status?: ProductStatus | 'all';
    /** Whitelisted order column; defaults to 'sort'. */
    orderBy?: string;
    direction?: 'ASC' | 'DESC';
    limit?: number;
    offset?: number;
}
export type StockPolicy = 'deny' | 'continue';
/**
 * A variant's derived availability. A variant with no stock row reads as
 * all-zero / policy 'deny' (out of stock), never a 404.
 */
export interface Stock {
    variantId: string;
    quantity: number;
    reserved: number;
    /** `quantity - reserved` (can be negative under an oversell policy). */
    available: number;
    policy: StockPolicy;
}
/**
 * A single line in the computed cart view. `lineTotalCents = unitPriceCents ×
 * quantity`. Price + titles are snapshotted from the catalog at add time.
 */
export interface CartItem {
    id: string;
    variantId: string;
    quantity: number;
    unitPriceCents: number;
    title: string | null;
    variantTitle: string | null;
    imageUrl: string | null;
    /** `unitPriceCents × quantity` (integer cents). */
    lineTotalCents: number;
}
/**
 * The computed cart view. `subtotalCents = Σ (unitPriceCents × quantity)`.
 * An unknown token reads as an empty `open` cart, never null.
 */
export interface Cart {
    token: string;
    currency: string;
    items: CartItem[];
    /** Σ line totals, integer minor units (cents). No tax/shipping (v0). */
    subtotalCents: number;
}
export interface CartAddItemInput {
    variantId: string;
    quantity: number;
}
export interface CartUpdateItemInput {
    quantity: number;
}
export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';
/** One order line. Price + titles are snapshotted at order time. */
export interface OrderItem {
    id: string;
    orderId: string;
    variantId: string;
    title: string | null;
    variantTitle: string | null;
    quantity: number;
    /** Snapshot of the price paid per unit, integer minor units (cents). */
    unitPriceCents: number;
}
/**
 * A placed order plus its line items — the confirmation-page surface (the
 * shape GET /orders/:id, GET /checkout/order/:id serve). All money is integer
 * minor units (cents); v0 has no tax/shipping so `totalCents === subtotalCents`.
 */
export interface Order {
    id: string;
    /** Human-ish unique reference, e.g. `XN-7QK4ZP`. */
    number: string;
    /** Token of the cart this order was created from, or null. */
    cartToken: string | null;
    email: string;
    currency: string;
    subtotalCents: number;
    totalCents: number;
    status: OrderStatus;
    /** Payment gateway ('mock' | 'stripe'), or null before payment. */
    paymentProvider: string | null;
    /** Gateway reference, or null before payment. */
    paymentRef: string | null;
    /** Free-form jsonb payload (notes, shipping address, …). */
    data: Record<string, unknown>;
    createdAt: string;
    items: OrderItem[];
}
export type CheckoutMode = 'mock' | 'stripe';
export interface CheckoutStartInput {
    /** Buyer email — the order's contact + email-gated lookup key. */
    email: string;
    /** Stripe success redirect path; defaults server-side to '/checkout/success'. */
    successPath?: string;
    /** Stripe cancel redirect path; defaults server-side to '/checkout/cancel'. */
    cancelPath?: string;
}
/**
 * The result of starting checkout. `payUrl` is the mock pay page in mock mode
 * (the default) or the Stripe hosted-checkout URL in stripe mode.
 */
export interface CheckoutStartResult {
    orderId: string;
    mode: CheckoutMode;
    payUrl: string;
}
export interface CmsClient {
    /** A published cms page, or null when the slug is unknown. */
    page(slug: string): Promise<CmsPage | null>;
    /** Published items in a collection (options mirror the list route). */
    items(collectionKey: string, options?: CmsItemsOptions): Promise<CmsItem[]>;
    /** A single published item, or null when the slug is unknown. */
    item(collectionKey: string, slug: string): Promise<CmsItem | null>;
}
export interface ListingsClient {
    list(options?: ListingsListOptions): Promise<Listing[]>;
    /** A single published listing, or null when the slug is unknown. */
    get(slug: string): Promise<Listing | null>;
    categories(): Promise<string[]>;
    submit(input: ListingSubmitInput): Promise<ListingSubmitResult>;
}
export interface EventsClient {
    list(options?: EventsListOptions): Promise<EventSummary[]>;
    /** A single event with seat counts, or null when the slug is unknown. */
    get(slug: string): Promise<EventDetail | null>;
    rsvp(slug: string, input: RsvpInput): Promise<RsvpResult>;
}
export interface FormsClient {
    /** The form's field schema. Throws AppClientError(404) for an unknown key. */
    schema(key: string): Promise<FormSchema>;
    submit(key: string, data: Record<string, unknown>): Promise<FormSubmitResult>;
}
export interface ReviewsClient {
    list(targetType: string, targetId: string): Promise<ReviewsResult>;
    submit(targetType: string, targetId: string, input: ReviewSubmitInput): Promise<ReviewSubmitResult>;
}
export interface BookingClient {
    /** Bookable resources (defaults to status 'active'). */
    resources(options?: BookingResourcesOptions): Promise<BookingResource[]>;
    /** A single resource, or null when the slug is unknown. */
    resource(slug: string): Promise<BookingResource | null>;
    /** Concrete open slots for a resource across the `{from, to}` window. */
    slots(slug: string, range: SlotsRange): Promise<BookingSlot[]>;
    /**
     * Take a slot. A lost slot throws `AppClientError(409, 'SLOT_UNAVAILABLE')`;
     * bad input surfaces the server's 400 message.
     */
    book(slug: string, input: BookForm): Promise<BookResult>;
}
export interface MediaClient {
    /** Published albums (options mirror the list route). */
    albums(options?: MediaAlbumsOptions): Promise<MediaAlbum[]>;
    /** An album merged with its items, or null when unknown/unpublished. */
    album(slug: string): Promise<MediaAlbumWithItems | null>;
}
export interface CatalogClient {
    /** Published products (no variants); options mirror the list route. */
    products(options?: ProductsListOptions): Promise<Product[]>;
    /** A single product with its variants, or null when unknown/unpublished. */
    product(slug: string): Promise<ProductWithVariants | null>;
    collections(): Promise<Collection[]>;
    /** Products in a collection. Throws AppClientError(404) for an unknown slug. */
    collectionProducts(slug: string): Promise<Product[]>;
}
export interface InventoryClient {
    /** A variant's derived availability (all-zero / 'deny' when it has no row). */
    stock(variantId: string): Promise<Stock>;
}
export interface CartClient {
    /** Mint a fresh empty cart; returns its opaque `{ token }`. */
    create(): Promise<{
        token: string;
    }>;
    /** The cart view for a token (an unknown token reads as an empty cart). */
    get(token: string): Promise<Cart | null>;
    /** Add a line item; returns the updated cart view. */
    addItem(token: string, input: CartAddItemInput): Promise<Cart>;
    /** Set a line item's quantity; returns the updated cart view. */
    updateItem(token: string, itemId: string, input: CartUpdateItemInput): Promise<Cart>;
    /** Remove a line item; returns the updated cart view. */
    removeItem(token: string, itemId: string): Promise<Cart>;
}
export interface OrdersClient {
    /** An order by its (unguessable) id, or null when unknown. */
    get(id: string): Promise<Order | null>;
    /** An order by number, email-gated; null when unknown or the email mismatches. */
    byNumber(number: string, email: string): Promise<Order | null>;
}
export interface CheckoutClient {
    /** Turn a cart into a pending order and get its pay URL + mode. */
    start(cartToken: string, input: CheckoutStartInput): Promise<CheckoutStartResult>;
    /**
     * Simulate the payment webhook in mock mode (the default); returns the paid
     * order. Throws AppClientError(403) when COMMERCE_MODE=stripe.
     */
    mockComplete(orderId: string): Promise<Order>;
    /** An order by id (the checkout confirmation surface), or null when unknown. */
    order(id: string): Promise<Order | null>;
}
export interface AppClient {
    cms: CmsClient;
    listings: ListingsClient;
    events: EventsClient;
    forms: FormsClient;
    reviews: ReviewsClient;
    booking: BookingClient;
    media: MediaClient;
    catalog: CatalogClient;
    inventory: InventoryClient;
    cart: CartClient;
    orders: OrdersClient;
    checkout: CheckoutClient;
}
//# sourceMappingURL=types.d.ts.map