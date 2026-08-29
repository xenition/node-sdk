"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBatchLoader = createBatchLoader;
exports.createBatchScope = createBatchScope;
exports.withBatching = withBatching;
exports.loadOneBy = loadOneBy;
exports.loadManyBy = loadManyBy;
const util_1 = require("./util");
const DEFAULT_MAX_BATCH_SIZE = 100;
class TickBatchLoader {
    constructor(ctx, options) {
        this.ctx = ctx;
        this.pending = new Map();
        this.scheduled = false;
        const context = 'createBatchLoader';
        this.table = (0, util_1.requireNonEmptyString)(context, 'table', options?.table);
        this.column = (0, util_1.requireNonEmptyString)(context, 'column', options?.column);
        this.select = options.select && options.select.length > 0 ? [...options.select] : undefined;
        this.scope = options.scope ? { ...options.scope } : undefined;
        const max = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
        if (!Number.isInteger(max) || max < 1) {
            (0, util_1.fail)(context, '"maxBatchSize" must be a positive integer');
        }
        this.maxBatchSize = max;
    }
    load(key) {
        // Rejected, not thrown. A promise-returning method that throws
        // synchronously escapes the caller's `.catch()` and takes down a
        // request handler that was correctly handling its errors — and a bad
        // key is the one failure here a caller is most likely to hit.
        try {
            assertLoadable(key);
        }
        catch (err) {
            return Promise.reject(err);
        }
        const id = keyId(key);
        let entry = this.pending.get(id);
        if (!entry) {
            entry = { key, settlers: [] };
            this.pending.set(id, entry);
        }
        const waiters = entry.settlers;
        const promise = new Promise((resolve, reject) => {
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
    async loadMany(keys) {
        if (!Array.isArray(keys))
            (0, util_1.fail)('BatchLoader.loadMany', '"keys" must be an array');
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
    schedule() {
        if (this.scheduled)
            return;
        this.scheduled = true;
        void Promise.resolve().then(() => this.flush());
    }
    flush() {
        const batch = [...this.pending.values()];
        // Reset BEFORE any awaiting so a `load()` issued from a settler's own
        // continuation opens a fresh batch instead of joining one already in
        // flight (and never resolving).
        this.pending = new Map();
        this.scheduled = false;
        if (batch.length === 0)
            return;
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
    async runChunk(chunk) {
        let rows;
        try {
            rows = await this.selectRows(chunk.map((entry) => entry.key));
        }
        catch (err) {
            for (const entry of chunk) {
                for (const settler of entry.settlers)
                    settler.reject(err);
            }
            return;
        }
        // Matched by column VALUE, never by position. The server is free to
        // return an `IN` result in any order, and Postgres generally does not
        // return it in the order of the list — zipping rows to keys by index
        // would hand callers each other's rows, silently and only sometimes.
        const byKey = new Map();
        for (const row of rows) {
            const value = row?.[this.column];
            if (value === null || value === undefined)
                continue;
            const id = String(value);
            // First row wins: the column is meant to be unique, and picking
            // arbitrarily between duplicates at least stays consistent for every
            // caller in the batch.
            if (!byKey.has(id))
                byKey.set(id, row);
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
                settler.resolve(row ? { ...row } : null);
            }
        }
    }
    async selectRows(keys) {
        let builder = this.ctx.query.from(this.table);
        if (this.select)
            builder = builder.select(...this.select);
        builder = builder.whereIn(this.column, keys);
        return applyScope(builder, this.scope).rows();
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
function createBatchLoader(ctx, options) {
    if (!ctx || typeof ctx.query?.from !== 'function') {
        (0, util_1.fail)('createBatchLoader', '"ctx" must be a ModuleContext with a query client');
    }
    return new TickBatchLoader(ctx, options);
}
/**
 * A batch scope over one context — the loader registry `withBatching`
 * attaches. Exported for apps that build a context by hand.
 */
function createBatchScope(ctx) {
    const loaders = new Map();
    return {
        loader(options) {
            const id = loaderId(options);
            let loader = loaders.get(id);
            if (!loader) {
                loader = createBatchLoader(ctx, options);
                loaders.set(id, loader);
            }
            return loader;
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
function withBatching(ctx) {
    if (!ctx || typeof ctx.query?.from !== 'function') {
        (0, util_1.fail)('withBatching', '"ctx" must be a ModuleContext with a query client');
    }
    if (ctx.batch)
        return ctx;
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
async function loadOneBy(ctx, options, key) {
    if (ctx?.batch)
        return ctx.batch.loader(options).load(key);
    assertLoadable(key);
    const table = (0, util_1.requireNonEmptyString)('loadOneBy', 'table', options?.table);
    const column = (0, util_1.requireNonEmptyString)('loadOneBy', 'column', options?.column);
    let builder = ctx.query.from(table);
    if (options.select && options.select.length > 0)
        builder = builder.select(...options.select);
    builder = builder.where(column, key);
    return applyScope(builder, options.scope).first();
}
/**
 * Several rows by key in one go — the list view's own call.
 *
 * Batched, this is one request for the whole list. Unbatched it is the N
 * requests the caller makes today, issued in parallel, so adopting this
 * helper is not itself a behaviour change.
 */
async function loadManyBy(ctx, options, keys) {
    if (!Array.isArray(keys))
        (0, util_1.fail)('loadManyBy', '"keys" must be an array');
    if (ctx?.batch)
        return ctx.batch.loader(options).loadMany(keys);
    return Promise.all(keys.map((key) => loadOneBy(ctx, options, key)));
}
function applyScope(builder, scope) {
    if (!scope)
        return builder;
    for (const [column, value] of Object.entries(scope)) {
        // `where(col, null)` would be sent as `= NULL`, which matches nothing in
        // Postgres — the caller means IS NULL (`deleted_at: null` is the reason
        // this option exists at all), so say so explicitly.
        if (value === null)
            builder.whereNull(column);
        else
            builder.where(column, value);
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
function assertLoadable(key) {
    if (typeof key === 'string')
        return;
    if (typeof key === 'number' && Number.isFinite(key))
        return;
    (0, util_1.fail)('BatchLoader.load', `"key" must be a string or a finite number, got ${key === null ? 'null' : typeof key === 'number' ? String(key) : typeof key} — a key that cannot be sent would resolve to null and read as a missing row`);
}
/**
 * Number 1 and string '1' are kept as separate pending entries even though
 * they resolve to the same row: which one the caller passed is the caller's
 * business, and collapsing them would make the `IN` list's element types
 * depend on which call site happened to run first.
 */
function keyId(key) {
    return typeof key === 'number' ? `n:${key}` : `s:${key}`;
}
/**
 * The identity two call sites must agree on to share a request. Filters are
 * sorted so `{a, b}` and `{b, a}` are the same loader, and typed so the
 * string `'1'` and the number 1 are not.
 */
function loaderId(options) {
    const scope = options.scope
        ? Object.entries(options.scope)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([column, value]) => `${column}=${typeof value}:${String(value)}`)
            .join(',')
        : '';
    const select = options.select ? [...options.select].join(',') : '*';
    return [options.table, options.column, select, scope, options.maxBatchSize ?? ''].join(' ');
}
//# sourceMappingURL=batch.js.map