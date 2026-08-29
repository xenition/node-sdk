import { ModuleContext } from './core';
import { fail, requireNonEmptyString } from './util';

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
  loader<TRow extends Record<string, unknown> = Record<string, unknown>>(
    options: BatchLoaderOptions,
  ): BatchLoader<TRow>;
}

const DEFAULT_MAX_BATCH_SIZE = 100;

/**
 * One key's place in a pending batch: the key itself plus everyone waiting
 * on it. A second `load('u_1')` in the same tick appends a settler here
 * rather than adding `u_1` to the `IN` list twice.
 */
interface PendingKey<TRow> {
  key: BatchKey;
  settlers: Array<{
    resolve(row: TRow | null): void;
    reject(err: unknown): void;
  }>;
}

class TickBatchLoader<TRow extends Record<string, unknown>> implements BatchLoader<TRow> {
  readonly table: string;
  readonly column: string;
  private readonly select?: string[];
  private readonly scope?: BatchScopeFilters;
  private readonly maxBatchSize: number;
  private pending = new Map<string, PendingKey<TRow>>();
  private scheduled = false;

  constructor(
    private readonly ctx: ModuleContext,
    options: BatchLoaderOptions,
  ) {
    const context = 'createBatchLoader';
    this.table = requireNonEmptyString(context, 'table', options?.table);
    this.column = requireNonEmptyString(context, 'column', options?.column);
    this.select = options.select && options.select.length > 0 ? [...options.select] : undefined;
    this.scope = options.scope ? { ...options.scope } : undefined;
    const max = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
    if (!Number.isInteger(max) || max < 1) {
      fail(context, '"maxBatchSize" must be a positive integer');
    }
    this.maxBatchSize = max;
  }

  load(key: BatchKey): Promise<TRow | null> {
    // Rejected, not thrown. A promise-returning method that throws
    // synchronously escapes the caller's `.catch()` and takes down a
    // request handler that was correctly handling its errors — and a bad
    // key is the one failure here a caller is most likely to hit.
    try {
      assertLoadable(key);
    } catch (err) {
      return Promise.reject(err);
    }
    const id = keyId(key);
    let entry = this.pending.get(id);
    if (!entry) {
      entry = { key, settlers: [] };
      this.pending.set(id, entry);
    }
    const waiters = entry.settlers;
    const promise = new Promise<TRow | null>((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
    this.schedule();
    return promise;
  }

  // `async` only so a bad argument rejects rather than throwing at a caller
  // that is holding a `.catch()`. The queuing below still happens in the
  // synchronous part of the body: every key must be pending BEFORE the
  // first await, because a map with an `await` inside would flush after the
  // first key and send the rest in a second request — the bug this file
  // exists to remove.
  async loadMany(keys: readonly BatchKey[]): Promise<Array<TRow | null>> {
    if (!Array.isArray(keys)) fail('BatchLoader.loadMany', '"keys" must be an array');
    return Promise.all(keys.map((key) => this.load(key)));
  }

  /**
   * Queue the flush for the end of this tick.
   *
   * A microtask, never a timer. A timer would hold a request open waiting
   * for sibling work that may never arrive — paying every lookup a latency
   * tax for a batch of one — and this is a live production engine where the
   * single-lookup path has to stay as fast as it is today. Draining on the
   * microtask queue bounds the wait by "whatever the caller was already
   * doing synchronously", which is exactly the window in which an N+1's N
   * calls are issued.
   */
  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    void Promise.resolve().then(() => this.flush());
  }

  private flush(): void {
    const batch = [...this.pending.values()];
    // Reset BEFORE any awaiting so a `load()` issued from a settler's own
    // continuation opens a fresh batch instead of joining one already in
    // flight (and never resolving).
    this.pending = new Map();
    this.scheduled = false;
    if (batch.length === 0) return;
    for (let i = 0; i < batch.length; i += this.maxBatchSize) {
      void this.runChunk(batch.slice(i, i + this.maxBatchSize));
    }
  }

  /**
   * One request, one chunk of keys.
   *
   * Failure is contained to the callers who were actually in this request:
   * they all rejected together in real life, so they all reject here — but
   * a sibling chunk, and every later tick's batch, is untouched. Nothing is
   * remembered about the failure, so the next `load()` of the same key
   * tries again exactly as an unbatched lookup would have.
   */
  private async runChunk(chunk: Array<PendingKey<TRow>>): Promise<void> {
    let rows: TRow[];
    try {
      rows = await this.selectRows(chunk.map((entry) => entry.key));
    } catch (err) {
      for (const entry of chunk) {
        for (const settler of entry.settlers) settler.reject(err);
      }
      return;
    }

    // Matched by column VALUE, never by position. The server is free to
    // return an `IN` result in any order, and Postgres generally does not
    // return it in the order of the list — zipping rows to keys by index
    // would hand callers each other's rows, silently and only sometimes.
    const byKey = new Map<string, TRow>();
    for (const row of rows) {
      const value = row?.[this.column];
      if (value === null || value === undefined) continue;
      const id = String(value);
      // First row wins: the column is meant to be unique, and picking
      // arbitrarily between duplicates at least stays consistent for every
      // caller in the batch.
      if (!byKey.has(id)) byKey.set(id, row);
    }

    for (const entry of chunk) {
      const row = byKey.get(String(entry.key)) ?? null;
      for (const settler of entry.settlers) {
        // A row is copied per caller rather than shared. Unbatched, each of
        // these lookups was its own request and got its own object; sharing
        // one object between callers would mean a caller that annotates the
        // row it was handed silently mutates what its neighbour sees. The
        // copy is shallow for the same reason `snakeRow` is: a jsonb
        // payload is the app's own value, and deep-cloning one on every
        // read would cost more than the round trip we just saved.
        settler.resolve(row ? ({ ...row } as TRow) : null);
      }
    }
  }

  private async selectRows(keys: BatchKey[]): Promise<TRow[]> {
    let builder = this.ctx.query.from<TRow>(this.table);
    if (this.select) builder = builder.select(...this.select);
    builder = builder.whereIn(this.column, keys);
    return applyScope(builder, this.scope).rows<TRow>();
  }
}

/**
 * A loader bound to one context, one table and one column.
 *
 * Use this directly when a module client wants to own its loader for the
 * life of a request. Most call sites should prefer `loadOneBy`, which uses
 * the context's shared scope when batching is on and falls back to today's
 * single-row query when it is off.
 */
export function createBatchLoader<TRow extends Record<string, unknown> = Record<string, unknown>>(
  ctx: ModuleContext,
  options: BatchLoaderOptions,
): BatchLoader<TRow> {
  if (!ctx || typeof ctx.query?.from !== 'function') {
    fail('createBatchLoader', '"ctx" must be a ModuleContext with a query client');
  }
  return new TickBatchLoader<TRow>(ctx, options);
}

/**
 * A batch scope over one context — the loader registry `withBatching`
 * attaches. Exported for apps that build a context by hand.
 */
export function createBatchScope(ctx: ModuleContext): BatchScope {
  const loaders = new Map<string, BatchLoader<Record<string, unknown>>>();
  return {
    loader<TRow extends Record<string, unknown>>(options: BatchLoaderOptions): BatchLoader<TRow> {
      const id = loaderId(options);
      let loader = loaders.get(id);
      if (!loader) {
        loader = createBatchLoader<Record<string, unknown>>(ctx, options);
        loaders.set(id, loader);
      }
      return loader as unknown as BatchLoader<TRow>;
    },
  };
}

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
export function withBatching(ctx: ModuleContext): ModuleContext {
  if (!ctx || typeof ctx.query?.from !== 'function') {
    fail('withBatching', '"ctx" must be a ModuleContext with a query client');
  }
  if (ctx.batch) return ctx;
  return { ...ctx, batch: createBatchScope(ctx) };
}

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
export async function loadOneBy<TRow extends Record<string, unknown> = Record<string, unknown>>(
  ctx: ModuleContext,
  options: BatchLoaderOptions,
  key: BatchKey,
): Promise<TRow | null> {
  if (ctx?.batch) return ctx.batch.loader<TRow>(options).load(key);

  assertLoadable(key);
  const table = requireNonEmptyString('loadOneBy', 'table', options?.table);
  const column = requireNonEmptyString('loadOneBy', 'column', options?.column);
  let builder = ctx.query.from<TRow>(table);
  if (options.select && options.select.length > 0) builder = builder.select(...options.select);
  builder = builder.where(column, key);
  return applyScope(builder, options.scope).first<TRow>();
}

/**
 * Several rows by key in one go — the list view's own call.
 *
 * Batched, this is one request for the whole list. Unbatched it is the N
 * requests the caller makes today, issued in parallel, so adopting this
 * helper is not itself a behaviour change.
 */
export async function loadManyBy<TRow extends Record<string, unknown> = Record<string, unknown>>(
  ctx: ModuleContext,
  options: BatchLoaderOptions,
  keys: readonly BatchKey[],
): Promise<Array<TRow | null>> {
  if (!Array.isArray(keys)) fail('loadManyBy', '"keys" must be an array');
  if (ctx?.batch) return ctx.batch.loader<TRow>(options).loadMany(keys);
  return Promise.all(keys.map((key) => loadOneBy<TRow>(ctx, options, key)));
}

// ───────── internals ─────────

/** A builder is generic in its row type; the scope clauses are not. */
interface ScopableBuilder {
  where(column: string, value: unknown): unknown;
  whereNull(column: string): unknown;
}

function applyScope<TBuilder extends ScopableBuilder>(
  builder: TBuilder,
  scope: BatchScopeFilters | undefined,
): TBuilder {
  if (!scope) return builder;
  for (const [column, value] of Object.entries(scope)) {
    // `where(col, null)` would be sent as `= NULL`, which matches nothing in
    // Postgres — the caller means IS NULL (`deleted_at: null` is the reason
    // this option exists at all), so say so explicitly.
    if (value === null) builder.whereNull(column);
    else builder.where(column, value);
  }
  return builder;
}

/**
 * Refuse a key an `IN` list cannot carry.
 *
 * Same failure `QueryBuilder.assertFilterable` guards: `undefined` vanishes
 * from the JSON payload and `NaN` becomes `null`, so the key would neither
 * match nor error — the caller would see `null` and read it as "that row is
 * gone" rather than "the id I passed was garbage". Worse here than in a
 * plain query, because a broken key sitting in a batch of 50 good ones
 * produces one wrong answer inside a page of right ones.
 */
function assertLoadable(key: unknown): asserts key is BatchKey {
  if (typeof key === 'string') return;
  if (typeof key === 'number' && Number.isFinite(key)) return;
  fail(
    'BatchLoader.load',
    `"key" must be a string or a finite number, got ${
      key === null ? 'null' : typeof key === 'number' ? String(key) : typeof key
    } — a key that cannot be sent would resolve to null and read as a missing row`,
  );
}

/**
 * Number 1 and string '1' are kept as separate pending entries even though
 * they resolve to the same row: which one the caller passed is the caller's
 * business, and collapsing them would make the `IN` list's element types
 * depend on which call site happened to run first.
 */
function keyId(key: BatchKey): string {
  return typeof key === 'number' ? `n:${key}` : `s:${key}`;
}

/**
 * The identity two call sites must agree on to share a request. Filters are
 * sorted so `{a, b}` and `{b, a}` are the same loader, and typed so the
 * string `'1'` and the number 1 are not.
 */
function loaderId(options: BatchLoaderOptions): string {
  const scope = options.scope
    ? Object.entries(options.scope)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([column, value]) => `${column}=${typeof value}:${String(value)}`)
        .join(',')
    : '';
  const select = options.select ? [...options.select].join(',') : '*';
  return [options.table, options.column, select, scope, options.maxBatchSize ?? ''].join(' ');
}
