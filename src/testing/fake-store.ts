import { HttpClient } from '../core/http-client';
import { QueryClient } from '../query/query-client';
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
export class FakeStore {
  readonly tables = new Map<string, Record<string, unknown>[]>();
  /** Every payload seen, for tests that assert on the emitted IR itself. */
  readonly payloads: QueryPayload[] = [];

  rows(table: string): Record<string, unknown>[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  /** Seed a table directly, bypassing the builder. */
  seed(table: string, rows: Record<string, unknown>[]): void {
    this.rows(table).push(...rows);
  }

  handle(payload: QueryPayload): { data: Record<string, unknown>[] } {
    this.payloads.push(payload);
    switch (payload.type) {
      case 'SELECT':
        return { data: this.select(payload) };
      case 'INSERT':
        return { data: this.insert(payload) };
      case 'UPDATE':
        return { data: this.update(payload) };
      case 'DELETE':
        return { data: this.remove(payload) };
      default:
        throw new Error(`FakeStore: unsupported query type ${payload.type}`);
    }
  }

  private select(payload: QueryPayload): Record<string, unknown>[] {
    let rows = this.rows(payload.table).filter((row) => matches(row, payload.where));
    for (const order of [...(payload.orderBy ?? [])].reverse()) {
      rows = [...rows].sort((a, b) => {
        const av = a[order.column];
        const bv = b[order.column];
        const cmp = av === bv ? 0 : (av as never) > (bv as never) ? 1 : -1;
        return order.direction === 'DESC' ? -cmp : cmp;
      });
    }
    const offset = payload.offset ?? 0;
    const limited = payload.limit === undefined ? rows : rows.slice(offset, offset + payload.limit);
    return (payload.offset !== undefined && payload.limit === undefined
      ? rows.slice(offset)
      : limited
    ).map((row) => ({ ...row }));
  }

  private insert(payload: QueryPayload): Record<string, unknown>[] {
    const incoming = Array.isArray(payload.data) ? payload.data : [payload.data ?? {}];
    const stored = incoming.map((row) => ({ ...row }));
    this.rows(payload.table).push(...stored);
    return stored.map((row) => ({ ...row }));
  }

  private update(payload: QueryPayload): Record<string, unknown>[] {
    const patch = (payload.data ?? {}) as Record<string, unknown>;
    const touched: Record<string, unknown>[] = [];
    for (const row of this.rows(payload.table)) {
      if (!matches(row, payload.where)) continue;
      Object.assign(row, patch);
      touched.push({ ...row });
    }
    return touched;
  }

  private remove(payload: QueryPayload): Record<string, unknown>[] {
    const rows = this.rows(payload.table);
    const kept = rows.filter((row) => !matches(row, payload.where));
    const removed = rows.filter((row) => matches(row, payload.where));
    this.tables.set(payload.table, kept);
    return removed;
  }
}

function matches(row: Record<string, unknown>, where?: WhereCondition[]): boolean {
  if (!where || where.length === 0) return true;
  // Billing only ever emits ANDed conditions; an OR would silently widen
  // these results, so refuse rather than quietly answer the wrong question.
  const or = where.find((condition, index) => index > 0 && condition.type === 'OR');
  if (or) throw new Error('FakeStore: OR conditions are not supported');
  return where.every((condition) => matchesOne(row, condition));
}

function matchesOne(row: Record<string, unknown>, condition: WhereCondition): boolean {
  const actual = row[condition.column];
  switch (condition.operator) {
    case '=':
      return actual === condition.value;
    case '!=':
      return actual !== condition.value;
    case 'IN':
      return (condition.value as unknown[]).includes(actual);
    case 'NOT IN':
      return !(condition.value as unknown[]).includes(actual);
    case 'IS NULL':
      return actual === null || actual === undefined;
    case 'IS NOT NULL':
      return actual !== null && actual !== undefined;
    case '>':
      return (actual as never) > (condition.value as never);
    case '>=':
      return (actual as never) >= (condition.value as never);
    case '<':
      return (actual as never) < (condition.value as never);
    case '<=':
      return (actual as never) <= (condition.value as never);
    default:
      throw new Error(`FakeStore: unsupported operator ${condition.operator}`);
  }
}

/** A ModuleContext backed by the fake store, plus the store to assert on. */
export function makeFakeContext(): { store: FakeStore; ctx: ModuleContext } {
  const store = new FakeStore();
  const post = jest.fn((_url: string, body: QueryPayload | { sql: string }) => {
    if ('sql' in body) throw new Error('FakeStore: raw SQL is not supported');
    return Promise.resolve(store.handle(body));
  });
  const query = new QueryClient({ post } as unknown as HttpClient);
  return { store, ctx: { query, raw: (sql, params = []) => query.raw(sql, params) } };
}
