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
}
//# sourceMappingURL=query-client.d.ts.map