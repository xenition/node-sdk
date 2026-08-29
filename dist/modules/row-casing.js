"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snakeKey = snakeKey;
exports.snakeRow = snakeRow;
exports.snakeRows = snakeRows;
exports.snakeCaseQueryClient = snakeCaseQueryClient;
/**
 * Make module clients immune to which runtime answered.
 *
 * The platform has two: the gateway camelCases every row on the way out,
 * and the engine returns the column names verbatim. So the SAME query
 * returns `expires_at` from one and `expiresAt` from the other — and a
 * module client reading `row.expires_at` gets `undefined` against the
 * gateway, silently.
 *
 * That is not a cosmetic bug. In the billing module it read like this:
 *
 *     const expired = isExpired(row.expires_at);       // undefined
 *     const allowed = row.status === 'active' && !expired;
 *
 * `isExpired(undefined)` is `false`, because a null expiry means perpetual.
 * So an EXPIRED subscription came back `allowed: true` — a free premium
 * account, forever, with nothing in the logs. Found by pointing a real app
 * at a real gateway; every unit test passed throughout, because the fake
 * store returns exactly what was written to it.
 *
 * Fixing it at each read site would mean auditing every underscored field
 * in four modules and getting it right again on every future one. Instead
 * every row a module reads is normalized to snake_case here — the shape the
 * module clients were written against, and the shape the SQL actually uses.
 *
 * Only module clients are wrapped by `snakeCaseQueryClient`.
 * `client.query.from(...)` stays exactly as the platform returned it,
 * because apps and the hono routers already depend on that (the routers
 * camelCase deliberately, on purpose, as their contract).
 *
 * The HELPERS below reach further than the wrapper does. `client.raw()` and
 * `client.search.unifiedSearch()` call `snakeRow`/`snakeRows` directly,
 * because the gateway camelCases those two responses while it returns
 * `.from(...)` rows verbatim — so the same row arrived in two different
 * shapes depending only on which read path an app happened to use. The doc
 * comments on those two methods carry the detail.
 */
/** `expiresAt` → `expires_at`. Leaves an already-snake key alone. */
function snakeKey(key) {
    return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
/**
 * Snake-case a row's own keys, one level deep.
 *
 * Deliberately shallow: `data`, `payload`, `feedback` and `raw` are jsonb
 * columns whose inner keys are the APP's contract, not the database's.
 * Rewriting those would corrupt exactly the payloads modules store verbatim.
 */
function snakeRow(row) {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
        const snake = snakeKey(key);
        // A row carrying both spellings means the runtime already gave us the
        // snake one; never let the camel copy overwrite it.
        if (snake in out && out[snake] !== undefined)
            continue;
        out[snake] = value;
    }
    return out;
}
function snakeRows(rows) {
    return rows.map((row) => (row && typeof row === 'object' ? snakeRow(row) : row));
}
/** The terminal methods that hand rows back to a caller. */
const ROW_RETURNING = new Set(['rows', 'first', 'execute', 'run', 'exec', 'get', 'all', 'fetch', 'toArray', 'one', 'find', 'findFirst', 'single']);
/**
 * Terminals that hand rows back one at a time instead of in a promise.
 *
 * `stream()` returns an async iterator, so it never matched the promise
 * branch below and escaped the wrapper entirely: the same wrapped builder
 * gave snake_cased rows from `.rows()` and camelCased rows from `.stream()`
 * — a split inside a single object whose whole purpose is not to have one.
 * Found by paging a real table through both, not by reading this file.
 */
const ROW_STREAMING = new Set(['stream']);
/** Normalize each row on its way out of an async iterator. */
async function* normalizeStream(source) {
    for await (const row of source) {
        yield row && typeof row === 'object' && !Array.isArray(row)
            ? snakeRow(row)
            : row;
    }
}
/** True for something that can be consumed with `for await`. */
function isAsyncIterable(value) {
    return (typeof value === 'object' &&
        value !== null &&
        typeof value[Symbol.asyncIterator] === 'function');
}
/**
 * A QueryClient whose rows always arrive snake_cased.
 *
 * Proxied rather than subclassed so it keeps working when the builder gains
 * methods — a new terminal verb that is not in `ROW_RETURNING` passes
 * through untouched rather than breaking.
 */
function snakeCaseQueryClient(query) {
    return new Proxy(query, {
        get(target, prop, receiver) {
            if (prop !== 'from')
                return Reflect.get(target, prop, receiver);
            return (table) => wrapBuilder(target.from(table));
        },
    });
}
/**
 * Duck-typed so a cloned builder is recognised without importing the class
 * for an instanceof check the bundler would have to keep alive.
 */
function isBuilder(value) {
    if (!value || typeof value !== 'object')
        return false;
    const candidate = value;
    return typeof candidate.rows === 'function' && typeof candidate.toPayload === 'function';
}
function wrapBuilder(builder) {
    return new Proxy(builder, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function')
                return value;
            return (...args) => {
                const result = value.apply(target, args);
                // Chainable methods return the builder itself; keep it wrapped so the
                // normalization survives `.where(...).orderBy(...).rows()`.
                if (result === target)
                    return receiver;
                // ...but insert(), update() and delete() return a CLONE rather than
                // `this`, so identity is not enough. Without this the chain escapes
                // the proxy at the first write call and `.returning('*').rows()`
                // comes back camelCased while a SELECT on the same table comes back
                // snake_cased — the exact split this wrapper exists to prevent.
                if (isBuilder(result) && result !== receiver) {
                    return wrapBuilder(result);
                }
                if (typeof prop === 'string' && ROW_RETURNING.has(prop) && isPromise(result)) {
                    return result.then(normalizeResult);
                }
                if (typeof prop === 'string' && ROW_STREAMING.has(prop) && isAsyncIterable(result)) {
                    return normalizeStream(result);
                }
                return result;
            };
        },
    });
}
function isPromise(value) {
    return Boolean(value) && typeof value.then === 'function';
}
/** Rows, a single row, or a `{data}` envelope — whichever the verb returns. */
function normalizeResult(result) {
    if (Array.isArray(result))
        return snakeRows(result);
    if (result && typeof result === 'object') {
        const envelope = result;
        if (Array.isArray(envelope.data)) {
            return { ...envelope, data: snakeRows(envelope.data) };
        }
        return snakeRow(result);
    }
    return result;
}
//# sourceMappingURL=row-casing.js.map