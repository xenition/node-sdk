import { QueryPayload, WhereCondition } from '../query/types';
import { ModuleContext } from '../modules/core';
/**
 * A tiny in-memory interpreter for the QueryBuilder's IR, used by the
 * billing suite.
 *
 * The house pattern elsewhere is `mockResolvedValueOnce` chained in call
 * order, which works well for a client that reads once and writes once.
 * Billing does neither: nearly every operation is a read-then-upsert whose
 * behavior DEPENDS on what a previous call stored (a renewal must find the
 * existing chain; a trial must find the existing entitlement). Choreographing
 * that by call index would test the order of the calls rather than the rule
 * being enforced, and would have to be rewritten whenever an internal read
 * moved.
 *
 * So: real rows, real filtering, assertions about state. Only the subset of
 * the IR that billing actually emits is implemented — equality, IN, IS NULL,
 * ordering, limit/offset — and anything else throws loudly rather than
 * silently returning the wrong rows.
 */
/**
 * What `.count()` and `.exists()` post. Deliberately NOT a `QueryPayload`:
 * those two terminals skip `/query` for the `/query/count` and
 * `/query/exists` siblings, and their bodies carry no `type` discriminator —
 * which is exactly why routing them through `handle()` used to end in
 * `unsupported query type undefined`.
 */
export interface AggregatePayload {
    table: string;
    /** COUNT's argument. `'*'` counts rows; a named column skips NULLs. */
    column?: string;
    where?: WhereCondition[];
}
export declare class FakeStore {
    readonly tables: Map<string, Record<string, unknown>[]>;
    /** Every payload seen, for tests that assert on the emitted IR itself. */
    readonly payloads: QueryPayload[];
    /**
     * The count/exists bodies seen, kept apart from `payloads` only because
     * they are a different shape and callers already narrow that array on
     * `.type`.
     */
    readonly aggregates: AggregatePayload[];
    rows(table: string): Record<string, unknown>[];
    /** Seed a table directly, bypassing the builder. */
    seed(table: string, rows: Record<string, unknown>[]): void;
    handle(payload: QueryPayload): {
        data: Record<string, unknown>[];
    };
    /**
     * `POST /query/count` — the endpoint behind `QueryBuilder.count()`.
     *
     * Without it every row cap answered 500 under test, so the one rule a
     * suite most wants to pin down — the free-tier limit — was the one rule
     * that could not be tested at all. The WHERE clause is honoured through
     * the same `matches()` the SELECT path uses, because a count that ignored
     * the scoping would be worse than no count: a paywall check reading the
     * whole table's size instead of the caller's would pass its test and fail
     * in production.
     *
     * `COUNT(col)` skips NULLs the way Postgres does; `COUNT(*)`, which is
     * what the builder sends unless a column is named, counts every match.
     */
    count(payload: AggregatePayload): {
        count: number;
    };
    /** `POST /query/exists` — `QueryBuilder.exists()`, same WHERE handling. */
    exists(payload: AggregatePayload): {
        exists: boolean;
    };
    private select;
    private insert;
    private update;
    private remove;
}
/**
 * Raw-SQL stand-in. The builder IR can be interpreted generically; SQL
 * cannot, so a suite whose client uses `raw()` supplies a handler that
 * simulates ITS statements against the same in-memory rows.
 */
export type RawHandler = (sql: string, params: unknown[], store: FakeStore) => Record<string, unknown>[];
export interface FakeContextOptions {
    /** Simulate the raw statements this suite's client issues. */
    raw?: RawHandler;
}
/** A ModuleContext backed by the fake store, plus the store to assert on. */
export declare function makeFakeContext(options?: FakeContextOptions): {
    store: FakeStore;
    ctx: ModuleContext;
};
//# sourceMappingURL=fake-store.d.ts.map