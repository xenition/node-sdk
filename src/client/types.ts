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

export interface AppClient {
  cms: CmsClient;
  listings: ListingsClient;
  events: EventsClient;
  forms: FormsClient;
  reviews: ReviewsClient;
}
