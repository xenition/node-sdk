import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';
import { QueryBuilder } from './query-builder';
import { QueryResult } from './types';

/**
 * Thin wrapper exposing the Supabase-style `.from(table)` entry point and
 * the raw SQL escape hatch. Generated apps use `client.query.from(...)` for
 * everything; service-key-only tooling uses `client.raw(sql, params)`.
 */
export class QueryClient {
  constructor(private readonly http: HttpClient) {}

  from<T = Record<string, unknown>>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(this.http).from(table);
  }

  /**
   * Direct parameterized SQL against the per-app DB. Requires the service
   * key. Unsafe in anon contexts — the server rejects it with 403.
   */
  async raw<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const res = await this.http.post<
      QueryResult<T> | { rows: T[]; rowCount?: number }
    >(API_ENDPOINTS.QUERY.RAW, { sql, params });
    if (Array.isArray((res as QueryResult<T>).data)) return res as QueryResult<T>;
    const raw = res as { rows: T[]; rowCount?: number };
    return { data: raw.rows ?? [], count: raw.rowCount };
  }
}
