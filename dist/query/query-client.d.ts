import { HttpClient } from '../core/http-client';
import { QueryBuilder } from './query-builder';
import { QueryResult } from './types';
/**
 * Thin wrapper exposing the Supabase-style `.from(table)` entry point and
 * the raw SQL escape hatch. Generated apps use `client.query.from(...)` for
 * everything; service-key-only tooling uses `client.raw(sql, params)`.
 */
export declare class QueryClient {
    private readonly http;
    constructor(http: HttpClient);
    from<T = Record<string, unknown>>(table: string): QueryBuilder<T>;
    /**
     * Direct parameterized SQL against the per-app DB. Requires the service
     * key. Unsafe in anon contexts — the server rejects it with 403.
     */
    raw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
    /**
     * Run several statements as ONE transaction: all of them commit, or none
     * of them do.
     *
     * The gap this closes: "deduct a credit and write the record" is two
     * round trips today, and a failure between them leaves the user charged
     * for nothing or credited for free. The inventory module's
     * reserve/commit protocol exists to work around exactly this, which is
     * evidence the primitive is needed rather than a substitute for it.
     *
     *   await client.query.transaction([
     *     { sql: 'UPDATE wallets SET credits = credits - $1 WHERE user_id = $2', params: [1, id] },
     *     { sql: 'INSERT INTO uses (user_id, kind) VALUES ($1, $2)', params: [id, 'analysis'] },
     *   ]);
     *
     * Results come back positionally, one per statement. Service key only.
     *
     * An `idempotencyKey` is worth passing whenever a client can retry the
     * call: the transaction protects against a PARTIAL apply, not against a
     * whole one happening twice.
     */
    transaction<T = Record<string, unknown>>(statements: Array<{
        sql: string;
        params?: unknown[];
    }>, options?: {
        idempotencyKey?: string;
    }): Promise<QueryResult<T>[]>;
}
//# sourceMappingURL=query-client.d.ts.map