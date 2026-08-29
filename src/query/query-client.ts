import { HttpClient } from '../core/http-client';
import { XenitionError } from '../core/errors';
import { API_ENDPOINTS } from '../constants';
import { QueryBuilder } from './query-builder';
import { snakeRows } from '../modules/row-casing';
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
   *
   * The rows in `data` are guaranteed snake_cased, whichever runtime
   * answered. That is a change of return shape, and it is deliberate: the
   * gateway camelCases what it sends back from `/raw` but returns
   * `.from(...)` rows with the column names verbatim, so the SAME row read
   * two ways gave two different objects —
   *
   *     client.query.from('items').rows()        // created_at, price_cents
   *     client.raw('SELECT * FROM items')        // createdAt,  priceCents
   *
   * — and an app that lists with one and reports with the other renders
   * both through the same component. `item.created_at` is a date on one
   * screen and `undefined` on the other, and nothing throws. That is the
   * silent failure mode that once let an EXPIRED subscription read as
   * active, because `isExpired(undefined)` is `false`. The whole rationale
   * lives in src/modules/row-casing.ts.
   *
   * Normalization is one level deep, on the row's own keys only. A jsonb
   * column's inner keys are the APP's contract rather than the database's,
   * so they are left exactly as stored. A row that already arrived
   * snake_cased passes through unchanged — `snakeKey` leaves an
   * already-snake key alone, so there is no second pass to fear.
   */
  async raw<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const res = await this.http.post<
      QueryResult<T> | { rows: T[]; rowCount?: number }
    >(API_ENDPOINTS.QUERY.RAW, { sql, params });
    const envelope: QueryResult<T> = Array.isArray((res as QueryResult<T>).data)
      ? (res as QueryResult<T>)
      : { data: (res as { rows: T[] }).rows ?? [], count: (res as { rowCount?: number }).rowCount };
    // The envelope's own fields (`count`, `metadata`) are this SDK's
    // contract and stay as they are; only the rows inside it are touched.
    return {
      ...envelope,
      data: snakeRows(envelope.data as Record<string, unknown>[]) as T[],
    };
  }

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
  async transaction<T = Record<string, unknown>>(
    statements: Array<{ sql: string; params?: unknown[] }>,
    options: { idempotencyKey?: string } = {},
  ): Promise<QueryResult<T>[]> {
    // Typed, like every other refusal in the SDK. A bare Error carries no
    // `code`, so a caller branching on `err.code` — which is what this
    // codebase tells them to do rather than parsing messages — gets
    // undefined and falls through to its generic handler.
    if (!Array.isArray(statements) || statements.length === 0) {
      throw new XenitionError(
        'VALIDATION_ERROR',
        'QueryClient.transaction: pass at least one statement.',
      );
    }
    for (const [index, statement] of statements.entries()) {
      if (typeof statement?.sql !== 'string' || statement.sql.trim() === '') {
        throw new XenitionError(
          'VALIDATION_ERROR',
          `QueryClient.transaction: statement ${index} has no sql.`,
        );
      }
    }

    const res = await this.http.post<
      { results?: Array<QueryResult<T> | { rows: T[]; rowCount?: number }> } | Array<QueryResult<T>>
    >(
      API_ENDPOINTS.QUERY.TRANSACTION,
      {
        statements: statements.map((statement) => ({
          sql: statement.sql,
          params: statement.params ?? [],
        })),
      },
      options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
    );

    // Same snake_case guarantee as `raw()` and `from()`. transaction() posts
    // to the same gateway family as raw(), which camelCases on the way out —
    // so without this a statement's rows came back shaped differently from
    // the identical SELECT run through any other read path, and only for
    // callers using the primitive that exists to keep two writes consistent.
    const list = Array.isArray(res) ? res : (res.results ?? []);
    return list.map((entry) => {
      const envelope = Array.isArray((entry as QueryResult<T>).data)
        ? (entry as QueryResult<T>)
        : {
            data: (entry as { rows: T[] }).rows ?? [],
            count: (entry as { rowCount?: number }).rowCount,
          };
      return {
        ...envelope,
        data: snakeRows(envelope.data as Record<string, unknown>[]) as T[],
      };
    });
  }
}
