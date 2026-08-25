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

/* ------------------------------------------------------------------ cms -- */

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

/* ------------------------------------------------------------- listings -- */

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

/* --------------------------------------------------------------- events -- */

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

/**
 * A full RSVP record — the confirmation-page surface (GET /events/rsvps/:id).
 * v0 access model: the `id` is an unguessable UUID, so it doubles as the
 * access token, same as `Order`.
 */
export interface Rsvp {
  id: string;
  eventId: string;
  name: string;
  email: string;
  partySize: number;
  status: 'confirmed' | 'waitlist' | 'cancelled';
  createdAt: string;
}

/* ---------------------------------------------------------------- forms -- */

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

/* -------------------------------------------------------------- reviews -- */

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

/* -------------------------------------------------------------- booking -- */

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

/**
 * A full booking record — the confirmation-page surface (GET
 * /booking/bookings/:id). v0 access model: the `id` is an unguessable UUID,
 * so it doubles as the access token, same as `Order`.
 */
export interface Booking {
  id: string;
  resourceId: string;
  customerName: string;
  customerEmail: string;
  /** ISO-8601; the slot start. */
  startsAt: string;
  /** ISO-8601; `startsAt` + the resource's `slotMinutes`. */
  endsAt: string;
  partySize: number;
  status: BookingStatus;
  notes: string;
  data: Record<string, unknown>;
  createdAt: string;
}

/* ---------------------------------------------------------------- media -- */

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
export type MediaAlbumWithItems = MediaAlbum & { items: MediaItem[] };

export interface MediaAlbumsOptions {
  /** Filter on the published flag; omit for all rows. */
  published?: boolean;
  /** Column to order by (whitelisted server-side); defaults to `sort`. */
  orderBy?: string;
  direction?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
}

/* -------------------------------------------------------------- catalog -- */

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
export type ProductWithVariants = Product & { variants: ProductVariant[] };

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

/* ------------------------------------------------------------ inventory -- */

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

/* ----------------------------------------------------------------- cart -- */

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

/* --------------------------------------------------------------- orders -- */

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

/* ------------------------------------------------------------- checkout -- */

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

/* -------------------------------------------------------------- billing -- */

/** Where a purchase came from. `stripe` is the web/card path. */
export type BillingPlatform = 'apple' | 'google' | 'stripe';

/** What kind of thing was sold — decides whether expiry is meaningful. */
export type ProductKind = 'subscription' | 'non_consumable' | 'consumable';

/**
 * A row from the paywall's catalogue. NOT a store price: the app asks
 * StoreKit / Play Billing for the localized price and shows THAT. This is
 * the mapping from a store identifier to the entitlement buying it grants.
 */
export interface BillingProduct {
  id: string;
  /** Store identifier, exactly as configured in App Store Connect / Play. */
  productId: string;
  platform: BillingPlatform;
  /** Entitlement this product grants while its purchase is active. */
  entitlement: string;
  kind: ProductKind;
  /** Informational — 'monthly' / 'yearly' / null. Expiry comes from the store. */
  period: string | null;
  active: boolean;
  createdAt: string;
}

export interface BillingProductsOptions {
  /** Only this store's products. Anything else is a 400 from the router. */
  platform?: BillingPlatform;
}

/** Where an entitlement came from. */
export type EntitlementSource = 'purchase' | 'trial' | 'grant';

export type EntitlementStatus = 'active' | 'expired' | 'revoked';

/**
 * A stored entitlement RECORD — one row of "this user has premium, from
 * this source, until then". This is what the list/restore routes return.
 *
 * Not the same thing as `EntitlementCheck`, which is the derived answer to
 * "may they, right now". A paywall wants the check; an account screen
 * listing what someone owns wants these.
 */
export interface Entitlement {
  id: string;
  userId: string;
  /** The capability name the app checks, e.g. 'premium'. */
  entitlement: string;
  source: EntitlementSource;
  status: EntitlementStatus;
  /** Null means perpetual (a lifetime unlock or an open-ended grant). */
  expiresAt: string | null;
  /** The purchase backing this, when source is 'purchase'. */
  purchaseId: string | null;
  grantedAt: string;
  updatedAt: string;
}

/**
 * The answer a paywall branches on. `allowed` is the ONLY field that
 * decides whether to show it; the rest is for "3 days left" and support.
 *
 * `status: 'none'` (with `source: null`) is the never-had-it case — it is
 * a normal answer, not an error, and the route returns 200 for it.
 */
export interface EntitlementCheck {
  allowed: boolean;
  entitlement: string;
  source: EntitlementSource | null;
  status: EntitlementStatus | 'none';
  expiresAt: string | null;
  /** Whole days remaining, rounded up. Null when perpetual or not allowed. */
  daysRemaining: number | null;
  /** True while this is a free trial rather than a paid purchase. */
  isTrial: boolean;
  /** Machine-readable why-not: 'expired' | 'revoked' | 'none'. */
  reason: string | null;
}

/**
 * Google's two purchase shapes. Deliberately NOT `ProductKind`: the verify
 * route only distinguishes a subscription from a one-off, and anything
 * that is not the literal `'product'` is treated as a subscription.
 */
export type GooglePurchaseKind = 'subscription' | 'product';

/**
 * What the device hands back after StoreKit / Play Billing completed the
 * purchase ON THE DEVICE. A discriminated union because the two stores
 * identify a purchase with different things and the router rejects the
 * wrong pairing with a 400 — a single loose "id" field is how an app ships
 * an Android build that cannot verify anything.
 *
 * Nothing here decides the user is paid. The server asks the store.
 */
export type VerifyPurchaseInput =
  | {
      platform: 'apple';
      /** The StoreKit 2 transaction id. */
      transactionId: string;
    }
  | {
      platform: 'google';
      productId: string;
      purchaseToken: string;
      /** Defaults to 'subscription' server-side. */
      kind?: GooglePurchaseKind;
    };

/** The 201 from a verified purchase. */
export interface VerifyPurchaseResult {
  ok: true;
  /**
   * Null when the purchase is real but its product was never declared with
   * `defineProduct` — the purchase IS recorded, and saying null beats
   * pretending the user was granted something.
   */
  entitlement: EntitlementCheck | null;
  product: BillingProduct | null;
  /**
   * Google only, and only when the purchase needed acknowledging: `false`
   * means Play was not told, and Play auto-refunds anything unacknowledged
   * after three days. Absent for Apple and for already-acknowledged rows.
   */
  acknowledged?: boolean;
}

/**
 * "Restore purchases" — the button Apple requires on every paywall.
 *
 * Apple restores a whole transaction CHAIN from its original id (the app
 * may send the current `transactionId` instead; the router accepts either,
 * preferring `originalTransactionId`). Google has no chain concept here —
 * it re-verifies one token, so a restore needs the same fields a verify
 * does. An app that sends only `{ platform }` gets a 400.
 */
export type RestorePurchasesInput =
  | {
      platform: 'apple';
      /** The chain id. One of these two is required. */
      originalTransactionId?: string;
      transactionId?: string;
    }
  | {
      platform: 'google';
      productId: string;
      purchaseToken: string;
      kind?: GooglePurchaseKind;
    };

/* ------------------------------------------------------ payment required -- */

/**
 * The meter that refused, when a metered free tier is what said no.
 *
 * Deliberately four fields: `remaining` and `period` are derivable, and
 * every extra field is one more thing a client has to be told about. These
 * are what let a paywall say "5 of 5 used, resets on the 1st" instead of a
 * bare upsell.
 */
export interface PaymentRequiredQuota {
  /** The quota key it was consumed under, e.g. 'analysis'. */
  key: string;
  limit: number;
  used: number;
  /** When the window rolls over. Null for a `total` quota, which never does. */
  resetAt: string | null;
}

/**
 * What a 402 carries beside its `{ error: { code, message } }`.
 *
 * Two different things refuse a paid feature — an entitlement gate ("you
 * must upgrade") and a metered allowance ("you are out of runs") — and both
 * answer 402. The PRESENCE of `quota` is what tells them apart, so an app
 * picks its paywall from a field rather than from prose.
 *
 * `entitlement` is the flat KEY the caller lacks ('premium'), always
 * present, so a client that only needs "upgrade to what?" reads one string.
 * `check` is the gate's full `EntitlementCheck` when a gate is what refused
 * — that is how an app tells an EXPIRED subscription (win them back) from
 * one that never existed (sell it), which is a different screen.
 *
 * Read all of it off `AppClientError` — never by matching the message.
 */
export interface PaymentRequiredDetails {
  /** The entitlement that unlocks this — the key, never the check. */
  entitlement?: string;
  /** Present only when a metered quota is what refused. */
  quota?: PaymentRequiredQuota;
  /** The full check, when an entitlement gate is what refused. */
  check?: EntitlementCheck;
}

/* ----------------------------------------------------------------- auth -- */

/**
 * The signed-in user, as the platform holds them. `record`-level fields
 * beyond id/email/role are optional because a deployment may not populate
 * every one of them.
 */
export interface AuthUser {
  id: string;
  email: string;
  role: string;
  createdAt: string;
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

/** One device's sign-in — a row of the "signed in on these devices" list. */
export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

/**
 * A fresh session. Store `token` AND `refreshToken`: access tokens are
 * short-lived by design, and without the refresh token a user is thrown
 * back to the login screen the moment theirs expires.
 *
 * Store what comes BACK from every call that returns this — a platform
 * that rotates refresh tokens invalidates the one you sent.
 */
export interface AuthResult {
  user: AuthUser;
  session: AuthSession;
  /** The access token to send as `Authorization: Bearer <token>`. */
  token: string;
  refreshToken: string;
  /** Epoch milliseconds. */
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

/**
 * Changing a password while signed in. Distinct from `resetPassword`,
 * which is the forgot-my-password path: this one proves identity with the
 * current password, so someone holding an unlocked phone cannot silently
 * lock the owner out of their own account.
 */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface ResetPasswordInput {
  /** The token from the reset email. */
  token: string;
  newPassword: string;
}

export type OAuthProvider = 'google' | 'github' | 'facebook' | 'twitter' | 'apple';

/**
 * Native sign-in — what a phone actually does. The platform SDK completes
 * sign-in ON THE DEVICE and hands the app an id token; the server verifies
 * it against the provider's published keys. The redirect dance
 * (`oauthUrl` / `oauthCallback`) is the browser path.
 */
export interface IdTokenSignInInput {
  provider: OAuthProvider;
  /** The `idToken` from Google Sign-In / Sign in with Apple. */
  idToken: string;
  /**
   * The nonce the app generated for this attempt. Apple echoes it inside
   * the token and the server compares the two — that is what stops a token
   * captured from another session being replayed.
   */
  nonce?: string;
  /** Apple only surfaces the name on the FIRST authorization, ever. */
  name?: string;
}

export interface OAuthUrlResult {
  url: string;
  state: string;
}

/**
 * One provider's availability for this app. Render only providers whose
 * `isAvailable` is true — a sign-in button for an unconfigured provider is
 * a dead end the user has no way to understand.
 */
export interface SocialProvider {
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

export type OtpChannel = 'email' | 'sms';

/** Servers scope codes, so a login code cannot reset a password. */
export type OtpPurpose = 'signin' | 'verify_email' | 'verify_phone' | 'reset_password';

/** One of `email` / `phone` is required. */
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

/** One of `email` / `phone` is required, alongside the code. */
export interface VerifyOtpInput {
  email?: string;
  phone?: string;
  code: string;
  purpose?: OtpPurpose;
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

/**
 * Everything the platform holds about the caller — the other half of the
 * same obligation as account deletion: a user must be able to leave WITH
 * their data, not merely to leave.
 */
export interface UserDataExport {
  user: AuthUser;
  sessions?: AuthSession[];
  /** Per-table rows the platform is willing to include. */
  data?: Record<string, unknown[]>;
  generatedAt: string;
}

/* ----------------------------------------------------------------- jobs -- */

/**
 * Where a job is. `failed` is a REST between retries — the job goes back
 * to `queued` after a backoff — while `dead` is terminal. A client that
 * treats `failed` as final gives up on work that is still coming.
 */
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead';

/**
 * The polling view of a background job. Deliberately narrower than the
 * stored row: no payload (it named the owner), and no error TEXT — the
 * stored message is internal, so it surfaces only as the `failed` flag.
 */
export interface Job {
  id: string;
  /** Handler key, e.g. `speech.analyze`. */
  type: string;
  status: JobStatus;
  attempts: number;
  /** Stop polling when this is true — `succeeded` or `dead`. */
  done: boolean;
  /** The handler's return value; null until it succeeds. */
  result: Record<string, unknown> | null;
  /** True only for `dead`. `status: 'failed'` will still be retried. */
  failed: boolean;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------- notifications -- */

/** Where a notification can land. */
export type NotificationChannel = 'in_app' | 'push' | 'email';

/** One row of the in-app inbox. */
export interface InboxNotification {
  id: string;
  userId: string;
  /**
   * What KIND of notification this is — 'reminder', 'social', 'billing'.
   * Preferences and quiet hours are per category, because "stop nagging me
   * about streaks" must not also silence "your payment failed".
   */
  category: string;
  title: string;
  body: string;
  /** App-authored payload; its inner keys are never re-cased. */
  data: Record<string, unknown>;
  /** Null while unread. */
  readAt: string | null;
  createdAt: string;
  /** Past this the inbox hides it. Null for permanent. */
  expiresAt: string | null;
}

export interface InboxOptions {
  /** Only unread rows. */
  unread?: boolean;
  category?: string;
  /** Server default 25, clamped to 100 rather than rejected. */
  limit?: number;
  /** The `nextCursor` from the previous page. */
  before?: string;
}

/**
 * One page of the inbox.
 *
 * `nextCursor` is a KEYSET cursor — the `createdAt` of the last row — not
 * an offset, because an inbox is written to while it is read and offset
 * paging silently skips and duplicates rows. Null means the feed is done.
 *
 * There is no total and no unread count here: the badge is its own route
 * (`unreadCount()`), so a page of the feed cannot be mistaken for one.
 */
export interface InboxPage {
  notifications: InboxNotification[];
  nextCursor: string | null;
}

/**
 * One category's delivery settings.
 *
 * Quiet hours are minutes past LOCAL midnight plus the offset that defines
 * local, so the wrap-around window (22:00 → 07:00) is plain arithmetic
 * rather than date handling. Null start/end means no quiet window.
 */
export interface NotificationPreference {
  id: string;
  userId: string;
  category: string;
  inApp: boolean;
  push: boolean;
  email: boolean;
  quietStartMinute: number | null;
  quietEndMinute: number | null;
  /** Minutes to ADD to UTC to get the user's local time. */
  utcOffsetMinutes: number;
  updatedAt: string;
}

/**
 * A preference patch. Every field is optional and the three states are
 * distinct: absent means "leave it alone", `null` on a quiet field means
 * "clear the window", and a value sets it.
 *
 * `category` decides the SCOPE of the write. Omit it and the patch lands
 * on every category the app configures — which is what a single
 * quiet-hours control on a settings screen means. Name one and only that
 * category changes.
 */
export interface NotificationPreferenceInput {
  category?: string;
  inApp?: boolean;
  push?: boolean;
  email?: boolean;
  /** 0–1439, or null to clear. */
  quietStartMinute?: number | null;
  /** 0–1439, or null to clear. */
  quietEndMinute?: number | null;
  /** -840…840. */
  utcOffsetMinutes?: number;
}

/* ---------------------------------------------------------- client shape -- */

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
  /** An RSVP by its (unguessable) id, or null when unknown. */
  getRsvp(id: string): Promise<Rsvp | null>;
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
  /** A booking by its (unguessable) id, or null when unknown. */
  getBooking(id: string): Promise<Booking | null>;
}

export interface MediaClient {
  /** Published albums (options mirror the list route). */
  albums(options?: MediaAlbumsOptions): Promise<MediaAlbum[]>;
  /** An album merged with its items, or null when unknown/unpublished. */
  album(slug: string): Promise<MediaAlbumWithItems | null>;
  /**
   * A code-gated "private" album (a client gallery, not listed by
   * `albums()`) merged with its items, or null when unknown/wrong code.
   * `published` doesn't apply here — the code is the gate.
   */
  privateAlbum(slug: string, code: string): Promise<MediaAlbumWithItems | null>;
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
  create(): Promise<{ token: string }>;
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

export interface BillingClient {
  /**
   * The paywall's catalogue. PUBLIC — a paywall is shown before sign-in,
   * so this is the one billing call that works without a token.
   */
  products(options?: BillingProductsOptions): Promise<BillingProduct[]>;
  /**
   * The derived "may they, right now" answer for EVERY capability the caller
   * holds — not the raw entitlement rows. The router builds these from the
   * records, so an expired subscription arrives as `allowed: false` with
   * `reason: 'expired'` rather than as a row you have to date-compare.
   */
  entitlements(): Promise<EntitlementCheck[]>;
  /** The derived "may they, right now" answer for one capability. */
  entitlement(key: string): Promise<EntitlementCheck>;
  /**
   * Step 3 of a purchase: the store completed it on the device, this asks
   * the server whether that is real. A rejected receipt surfaces the
   * router's 400 message.
   */
  verify(input: VerifyPurchaseInput): Promise<VerifyPurchaseResult>;
  /** "Restore purchases". Returns the caller's entitlements afterwards. */
  restore(input: RestorePurchasesInput): Promise<EntitlementCheck[]>;
  /**
   * Start the free trial the SERVER defines — its length is never a client
   * argument. Idempotent: a second tap returns the current state rather
   * than an error. Throws `AppClientError(501, 'NOT_CONFIGURED')` when the
   * app offers no trial.
   */
  startTrial(): Promise<EntitlementCheck>;
}

/**
 * Sign-in, the account screen, and the two things App Store review checks
 * for (deletion and export).
 *
 * The END-USER half only. There is no `listUsers`, no `searchUsers`, no
 * provider configuration and no team administration here: those need the
 * platform service key, this client carries none, and a method on it is a
 * promise that a phone may call it.
 *
 * Served by `authRouter()` in `@xenition/sdk/hono`, which mounts exactly
 * these paths and refuses to mount the service-key ones.
 */
export interface AuthClient {
  register(input: RegisterInput): Promise<AuthResult>;
  login(input: LoginInput): Promise<AuthResult>;
  /**
   * Exchange a refresh token for a fresh session. Call it when a request
   * fails with 401, then retry that request once — without this the user
   * lands back on the login screen the moment their access token expires.
   */
  refresh(refreshToken: string): Promise<AuthResult>;
  /** Native Google/Apple sign-in with an id token obtained on the device. */
  signInWithIdToken(input: IdTokenSignInInput): Promise<AuthResult>;
  /** Send a one-time code by email or SMS. Throttling is the server's job. */
  sendOtp(input: SendOtpInput): Promise<SendOtpResult>;
  /** Redeem a one-time code. `purpose: 'signin'` returns a full session. */
  verifyOtp(input: VerifyOtpInput): Promise<AuthResult>;
  /** The signed-in caller. Throws `AppClientError(401)` for a guest. */
  me(): Promise<AuthUser>;
  updateProfile(input: UpdateProfileInput): Promise<AuthUser>;
  changePassword(input: ChangePasswordInput): Promise<{ changed: true }>;
  /** Send the reset email. Answers the same whether the address exists. */
  requestPasswordReset(email: string, redirectUrl: string): Promise<{ requested: true }>;
  resetPassword(input: ResetPasswordInput): Promise<{ reset: true }>;
  verifyEmail(token: string): Promise<{ verified: true }>;
  logout(): Promise<{ ok: true }>;
  /** The caller's active sessions — the "signed in on these devices" list. */
  sessions(): Promise<AuthSession[]>;
  /** Sign one other device out. */
  revokeSession(sessionId: string): Promise<{ revoked: true }>;
  /** Sign every device out, this one included. Returns how many. */
  revokeAllSessions(): Promise<number>;
  /**
   * Delete the caller's account. Apple has required in-app account
   * deletion since June 2022; an app without it is rejected at review.
   */
  deleteAccount(input?: DeleteAccountInput): Promise<DeleteAccountResult>;
  /** Everything the platform holds about the caller. */
  exportData(): Promise<UserDataExport>;
  /** Which sign-in buttons to render — check `isAvailable` on each. */
  socialProviders(): Promise<SocialProvider[]>;
  /** Start the browser redirect flow. Mobile uses `signInWithIdToken`. */
  oauthUrl(provider: OAuthProvider, redirectUrl: string): Promise<OAuthUrlResult>;
  /** Finish the browser redirect flow with the code + state it came back with. */
  oauthCallback(provider: OAuthProvider, code: string, state: string): Promise<AuthResult>;
}

export interface JobsClient {
  /**
   * Poll one background job. Null when the id is unknown OR the job is not
   * the caller's — deliberately the same answer, since telling them apart
   * would confirm which ids exist.
   *
   * There is no `enqueue`: the app decides what work exists and what it
   * costs, and a route that let a device queue arbitrary jobs would be a
   * free denial-of-service against its own worker.
   */
  get(id: string): Promise<Job | null>;
}

export interface NotificationsClient {
  /** One page of the caller's inbox. Page with `before: page.nextCursor`. */
  inbox(options?: InboxOptions): Promise<InboxPage>;
  /** The badge number. */
  unreadCount(): Promise<number>;
  /**
   * Mark one read. Idempotent, and silent about ids that are not the
   * caller's — a stranger's id touches nothing and still reports success.
   */
  markRead(id: string): Promise<void>;
  /** Mark everything read; returns the resulting unread count (the badge). */
  markAllRead(): Promise<number>;
  /**
   * The settings screen. A fresh account still gets a switch per category
   * — the server fills unset ones in with the module's own defaults rather
   * than returning an empty list.
   */
  preferences(): Promise<NotificationPreference[]>;
  /**
   * Save a patch and get back every preference row it touched. PLURAL on
   * purpose: omitting `category` writes to every configured category, so
   * one quiet-hours control silences everything rather than one thing.
   */
  savePreferences(input: NotificationPreferenceInput): Promise<NotificationPreference[]>;
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
  billing: BillingClient;
  auth: AuthClient;
  jobs: JobsClient;
  notifications: NotificationsClient;
}

/**
 * The end user's access token, for the routes behind `requireAuth()`
 * (everything under billing except `products()`, all of jobs, all of
 * notifications, and the signed-in half of auth).
 *
 * This is the USER's own credential, not a key: it is minted by
 * `auth.login()`, belongs to the person holding the phone, and grants only
 * what that person may do. The platform SERVICE key stays in the backend
 * and never appears here — that distinction is the whole reason this
 * client is safe to bundle into an app.
 *
 * Pass a function when the token can change (it is refreshed, the user
 * signs out) so every request reads the current one; it is awaited per
 * request, so reading it from async device storage is fine. Resolving to
 * null/undefined simply sends no header, which is what a public route and
 * a signed-out app both want.
 */
export type AccessTokenSource =
  | string
  | (() => string | null | undefined | Promise<string | null | undefined>);

export interface AppClientOptions {
  /** How to get the signed-in user's access token. Omit for a guest client. */
  accessToken?: AccessTokenSource;
}
