/**
 * listings module types — a directory / classified / real-estate /
 * job-board core over a single `listings__listings` table.
 *
 * A listing is a slugged, categorized content record whose domain-specific
 * fields (location, price-as-text, contact, image urls, tags, …) live in an
 * arbitrary `data` jsonb payload, so one table serves cars, rentals, jobs,
 * … without per-domain schemas. There are NO payments here — this is the
 * content primitive, not a marketplace checkout.
 */

export type ListingStatus = 'draft' | 'pending' | 'published' | 'expired' | 'archived';

export interface Listing {
  id: string;
  /** Free-text bucket the listing belongs to, e.g. 'apartments', 'jobs'. */
  category: string;
  title: string;
  slug: string;
  summary: string;
  body: string;
  /** Arbitrary app-authored fields (location, price text, contact, …). */
  data: Record<string, unknown>;
  status: ListingStatus;
  featured: boolean;
  created_at: string;
  /** Set when the listing goes live (via publish()); null otherwise. */
  published_at: string | null;
  /** Optional expiry; null when the listing never expires. */
  expires_at: string | null;
}

export interface CreateListingInput {
  category: string;
  title: string;
  /** Explicit slug; auto-generated from the title (deduped) when omitted. */
  slug?: string;
  summary?: string;
  body?: string;
  data?: Record<string, unknown>;
  /**
   * Initial status — one of 'draft' | 'pending' | 'published'. Defaults to
   * 'pending'. 'expired'/'archived' are moderation-only end states and are
   * rejected here.
   */
  status?: ListingStatus;
  featured?: boolean;
}

export interface ListListingsOptions {
  /** Status filter — defaults to 'published' (the public surface). */
  status?: ListingStatus;
  /** Restrict to featured (true) / non-featured (false); unset = either. */
  featured?: boolean;
  /** Whitelisted sort column; defaults to 'created_at'. */
  orderBy?: string;
  /** Defaults to 'DESC'. */
  direction?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
}

export interface GetBySlugOptions {
  /**
   * Public reads see published rows only. Set true to fetch a listing in
   * any status (a service-key/back-office opt-in) — mirrors the cms
   * published-any read.
   */
  anyStatus?: boolean;
}

export interface SearchListingsOptions {
  limit?: number;
}
