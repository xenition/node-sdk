import type { QueryClient } from '../query/query-client';
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
export declare function snakeKey(key: string): string;
/**
 * Snake-case a row's own keys, one level deep.
 *
 * Deliberately shallow: `data`, `payload`, `feedback` and `raw` are jsonb
 * columns whose inner keys are the APP's contract, not the database's.
 * Rewriting those would corrupt exactly the payloads modules store verbatim.
 */
export declare function snakeRow<T extends Record<string, unknown>>(row: T): T;
export declare function snakeRows<T extends Record<string, unknown>>(rows: T[]): T[];
/**
 * A QueryClient whose rows always arrive snake_cased.
 *
 * Proxied rather than subclassed so it keeps working when the builder gains
 * methods — a new terminal verb that is not in `ROW_RETURNING` passes
 * through untouched rather than breaking.
 */
export declare function snakeCaseQueryClient(query: QueryClient): QueryClient;
//# sourceMappingURL=row-casing.d.ts.map