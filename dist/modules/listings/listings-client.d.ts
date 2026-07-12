import { Migration } from '../../migrations/types';
import { ModuleContext } from '../core';
import { CreateListingInput, GetBySlugOptions, Listing, ListingStatus, ListListingsOptions, SearchListingsOptions } from './types';
export declare const LISTINGS_TABLE = "listings__listings";
export declare const LISTINGS_MIGRATIONS: Migration[];
/**
 * listings module client — a directory / classified / real-estate /
 * job-board core over `listings__listings`.
 *
 * `create()` is the write primitive (validated client-side per the v0 trust
 * model in modules/core.ts): it auto-slugs from the title with `-2`, `-3`, …
 * dedupe (same as cms) and defaults to status `pending`, so a public submit
 * lands in moderation. `publish()` / `moderate()` are the service-key
 * back-office calls; public reads (`list`, `getBySlug`, `search`,
 * `categories`) only ever see published rows unless a service-key caller
 * opts out.
 */
export declare class ListingsClient {
    private readonly ctx;
    constructor(ctx: ModuleContext);
    /**
     * Insert a listing. Validates everything before the slug lookup so bad
     * input never costs a network round-trip; the slug is generated from the
     * title (deduped) when not supplied. Status defaults to `pending`.
     */
    create(input: CreateListingInput): Promise<Listing>;
    /**
     * Take a listing live: status → 'published' and published_at → now().
     * Service key. Uses raw SQL with the server-side now() so the timestamptz
     * is stamped by the DB (never bound as an ISO string from the client).
     */
    publish(id: string): Promise<void>;
    /** Flip a listing's moderation status (service key). */
    moderate(id: string, status: ListingStatus): Promise<void>;
    /**
     * Listings in a category, filtered by status (default 'published') and
     * optionally by featured, ordered by a whitelisted column (default
     * created_at DESC).
     */
    list(category: string, options?: ListListingsOptions): Promise<Listing[]>;
    /**
     * A single listing by slug. Public reads (the default) see published rows
     * only; pass `{ anyStatus: true }` from a service-key/back-office context
     * to fetch a listing in any status.
     */
    getBySlug(slug: string, options?: GetBySlugOptions): Promise<Listing | null>;
    /**
     * Full-text-ish search over published listings — title OR summary matched
     * case-insensitively (ILIKE), optionally scoped to a category.
     */
    search(category: string | undefined, term: string, options?: SearchListingsOptions): Promise<Listing[]>;
    /**
     * Distinct categories among published listings, sorted. Uses a DISTINCT
     * select on the category column and dedupes/sorts client-side as a belt
     * against a runtime that ignores the flag (same defensive stance as
     * reviews' client-side averaging).
     */
    categories(): Promise<string[]>;
    private validateStatus;
    private validateCreateStatus;
    /**
     * Kebab slug, deduped against existing rows: `honda-civic`,
     * `honda-civic-2`, … One LIKE query fetches the candidate set; the suffix
     * is computed locally (same approach as cms).
     */
    private uniqueSlug;
}
/** The listings module definition — wire it up via `client.modules.enable('listings')`. */
export declare const listingsModule: import("../core").ModuleDefinition<ListingsClient>;
//# sourceMappingURL=listings-client.d.ts.map