import { ModuleContext } from './core';
/**
 * Per-tick batch loading — turn N single-row lookups into one `whereIn`.
 *
 * Every module query is one HTTP round trip to the gateway, so an N+1 in a
 * list view is N network calls: rendering 50 posts and resolving each
 * post's author is 50 requests that all say the same thing with a different
 * id. The fix is not a cache and not a join — both change what a caller
 * reads. It is to notice that those 50 lookups are issued in the SAME tick,
 * hold them for one microtask, and send `WHERE id IN (…50 ids…)` once.
 *
 *   const ctx = withBatching(baseCtx);            // opt in, once
 *   const author = await loadOneBy<AuthorRow>(    // in the module client
 *     ctx, { table: 'cms__authors', column: 'id' }, post.author_id,
 *   );
 *
 * OFF BY DEFAULT, and that is the point rather than a caution. Batching
 * changes WHEN a query executes: a lookup that used to leave for the
 * network immediately now waits for the microtask queue to drain. That is
 * invisible to well-written async code and lethal to code that is
 * accidentally ordering itself around the network — a test that asserts on
 * call counts, a route that starts a lookup and then synchronously reads a
 * variable the lookup was supposed to have filled. Those bugs surface as
 * "it works locally, it fails under load", which is the most expensive
 * class of bug this SDK could ship. So nothing batches until an app builds
 * a context with `withBatching()` (or calls
 * `client.modules.enableBatching()`), and a `ModuleContext` without a
 * `batch` scope behaves exactly as it does today, one query per lookup.
 *
 * Deliberately NOT a cache. A loader coalesces work that is already in
 * flight together; it never answers a later read from an earlier read's
 * rows. Caching across ticks would mean a caller who asked for fewer round
 * trips silently started receiving stale rows, which is a correctness
 * change nobody opted into by asking for a performance one.
 */
/** What a row can be looked up by. Anything an `IN` list can carry. */
export type BatchKey = string | number;
/** An equality (or IS NULL) filter applied to every query in a batch. */
export type BatchScopeFilters = Record<string, BatchKey | boolean | null>;
export interface BatchLoaderOptions {
    /** Table to read from, e.g. `cms__authors`. */
    table: string;
    /** The column the keys match against — a unique/indexed one. */
    column: string;
    /** Columns to select. Defaults to everything, like a plain lookup. */
    select?: string[];
    /**
     * Extra equality filters ANDed onto every batched query — a workspace
     * id, `deleted_at IS NULL`, a tenant discriminator.
     *
     * Part of the loader's identity, compared BY VALUE: two loaders asking
     * for the same table and column under different filters never merge into
     * one request, because the row a filtered lookup is allowed to see is
     * not the row an unfiltered one is.
     */
    scope?: BatchScopeFilters;
    /**
     * Maximum keys per request. Default 100.
     *
     * Chunked rather than sent as one enormous `IN` list for two reasons that
     * both bite at exactly the traffic this exists to survive: every key is a
     * bound parameter and the request body has a size limit at the gateway,
     * and a single 5,000-key request turns one timeout into 5,000 failed
     * lookups. Chunks fail independently — see `runChunk`.
     */
    maxBatchSize?: number;
}
export interface BatchLoader<TRow extends Record<string, unknown> = Record<string, unknown>> {
    /** The row whose `column` equals `key`, or null when there is none. */
    load(key: BatchKey): Promise<TRow | null>;
    /**
     * One result per key, positionally aligned with `keys` — including the
     * nulls. Duplicate keys are looked up once and answered twice.
     */
    loadMany(keys: readonly BatchKey[]): Promise<Array<TRow | null>>;
    readonly table: string;
    readonly column: string;
}
/**
 * The set of loaders that are allowed to share a request.
 *
 * SECURITY — why a scope exists at all, instead of one process-wide map
 * keyed by table name. Coalescing two lookups means the rows come back in
 * ONE request, under ONE credential, and are then handed to both callers.
 * That is only safe when both callers could each have made that request
 * alone. In this SDK the thing that decides "could have" is the
 * `ModuleContext`: its `query` is bound to a single `HttpClient`, whose
 * `x-api-key` encodes app_id + key_type server-side, and per-END-USER
 * authority is never carried on the context — `AuthClient` passes a user's
 * bearer token per request precisely so one worker's many users cannot
 * leak into each other (see `asUser` in auth/auth-client.ts). So two
 * lookups made through the SAME context already carry identical authority,
 * and batching them together sends exactly the rows either one could have
 * fetched by itself.
 *
 * A global registry keyed by `table` would break that in the deployment
 * this SDK is actually used in: a backend that builds one client per
 * tenant, or one per key type, has several contexts alive at once, and a
 * shared loader would answer tenant B's caller with the rows fetched under
 * tenant A's key. So the batch key is (this scope instance) + table +
 * column + select + scope filters, and a scope is created from exactly one
 * context and never shared between two.
 */
export interface BatchScope {
    /**
     * The loader for this table+column+filters, created on first use and
     * reused after — reuse is what lets separate call sites in the same tick
     * land in the same request.
     */
    loader<TRow extends Record<string, unknown> = Record<string, unknown>>(options: BatchLoaderOptions): BatchLoader<TRow>;
}
/**
 * A loader bound to one context, one table and one column.
 *
 * Use this directly when a module client wants to own its loader for the
 * life of a request. Most call sites should prefer `loadOneBy`, which uses
 * the context's shared scope when batching is on and falls back to today's
 * single-row query when it is off.
 */
export declare function createBatchLoader<TRow extends Record<string, unknown> = Record<string, unknown>>(ctx: ModuleContext, options: BatchLoaderOptions): BatchLoader<TRow>;
/**
 * A batch scope over one context — the loader registry `withBatching`
 * attaches. Exported for apps that build a context by hand.
 */
export declare function createBatchScope(ctx: ModuleContext): BatchScope;
/**
 * Turn per-tick batching on for a context.
 *
 * Returns a NEW context rather than mutating the one passed in: a module
 * client that already captured the plain context keeps the behaviour it was
 * built and tested with, so turning batching on is a decision made at one
 * place with one blast radius instead of a global switch that reaches into
 * clients constructed before it was flipped.
 *
 *   const batched = withBatching(ctx);
 *   const client = myModule.factory(batched);
 */
export declare function withBatching(ctx: ModuleContext): ModuleContext;
/**
 * The adoption path for a module client: read one row by a column, through
 * the context's batch scope when the app turned batching on and through a
 * plain single-row query when it did not.
 *
 * Written as a free function rather than a method on the context so a
 * client can switch to it without changing its constructor, and so the
 * unbatched branch stays byte-for-byte the query it issues today —
 * `.where(column, key).first()`, limit 1, same payload, same result.
 */
export declare function loadOneBy<TRow extends Record<string, unknown> = Record<string, unknown>>(ctx: ModuleContext, options: BatchLoaderOptions, key: BatchKey): Promise<TRow | null>;
/**
 * Several rows by key in one go — the list view's own call.
 *
 * Batched, this is one request for the whole list. Unbatched it is the N
 * requests the caller makes today, issued in parallel, so adopting this
 * helper is not itself a behaviour change.
 */
export declare function loadManyBy<TRow extends Record<string, unknown> = Record<string, unknown>>(ctx: ModuleContext, options: BatchLoaderOptions, keys: readonly BatchKey[]): Promise<Array<TRow | null>>;
//# sourceMappingURL=batch.d.ts.map