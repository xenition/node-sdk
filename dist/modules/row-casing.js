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
 * Only module clients are wrapped. `client.query` stays exactly as the
 * platform returned it, because apps and the hono routers already depend on
 * that (the routers camelCase deliberately, on purpose, as their contract).
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
                if (typeof prop === 'string' && ROW_RETURNING.has(prop) && isPromise(result)) {
                    return result.then(normalizeResult);
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