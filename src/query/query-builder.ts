import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';
import {
  JoinClause,
  JoinType,
  OrderByClause,
  OrderDirection,
  QueryPayload,
  QueryResult,
  QueryType,
  WhereCondition,
  WhereOperator,
} from './types';

/**
 * Chainable SQL builder. Mirrors the @fluxez/node-sdk QueryBuilder surface
 * method-for-method — swapping SDK imports in an existing app is all that
 * should be needed. Behavioral differences:
 *
 *  - Every terminal method hits a single `POST /app-platform/query` (or the
 *    `/count`, `/exists`, `/raw` siblings) so the backend sees the full IR
 *    in one request. Fluxez fanned out across /query-builder/{select,insert,…}.
 *  - `.clone()` is called on every type-switching call (`from`, `insert`,
 *    `update`, `delete`) so builders stay immutable between type changes.
 *    Non-type-switching calls mutate in place for ergonomics.
 *  - Thenable: `await client.query.from('x').where(...)` works without a
 *    trailing `.execute()`.
 */
export class QueryBuilder<T = Record<string, unknown>> {
  // Query state. All private to prevent external mutation.
  private queryType: QueryType = 'SELECT';
  private tableName: string = '';
  private selectColumns: string[] = ['*'];
  private whereConditions: WhereCondition[] = [];
  private joinClauses: JoinClause[] = [];
  private orderByClause: OrderByClause[] = [];
  private groupByColumns: string[] = [];
  private havingConditions: WhereCondition[] = [];
  private limitValue?: number;
  private offsetValue?: number;
  private distinctFlag: boolean = false;
  private returningColumns: string[] = [];
  private insertData: Record<string, unknown>[] = [];
  private updateData: Record<string, unknown> = {};

  constructor(private readonly http: HttpClient) {}

  // ───────── entry points (immutable: return a fresh builder) ─────────

  from(table: string): QueryBuilder<T> {
    const next = this.clone();
    next.queryType = 'SELECT';
    next.tableName = table;
    return next;
  }

  insert(data: Record<string, unknown> | Record<string, unknown>[]): QueryBuilder<T> {
    const next = this.clone();
    next.queryType = 'INSERT';
    next.insertData = Array.isArray(data) ? data : [data];
    return next;
  }

  update(data: Record<string, unknown>): QueryBuilder<T> {
    const next = this.clone();
    next.queryType = 'UPDATE';
    next.updateData = data;
    return next;
  }

  delete(): QueryBuilder<T> {
    const next = this.clone();
    next.queryType = 'DELETE';
    return next;
  }

  // ───────── SELECT shape (mutating) ─────────

  select(...columns: string[]): this {
    this.selectColumns = columns.length > 0 ? columns : ['*'];
    return this;
  }

  distinct(): this {
    this.distinctFlag = true;
    return this;
  }

  // ───────── WHERE clauses ─────────

  where(column: string, opOrValue: WhereOperator | unknown, value?: unknown): this {
    return this.pushWhere('AND', column, opOrValue, value);
  }

  orWhere(column: string, opOrValue: WhereOperator | unknown, value?: unknown): this {
    return this.pushWhere('OR', column, opOrValue, value);
  }

  whereIn(column: string, values: unknown[]): this {
    this.whereConditions.push({ column, operator: 'IN', value: values, type: 'AND' });
    return this;
  }

  whereNotIn(column: string, values: unknown[]): this {
    this.whereConditions.push({ column, operator: 'NOT IN', value: values, type: 'AND' });
    return this;
  }

  whereNull(column: string): this {
    this.whereConditions.push({ column, operator: 'IS NULL', value: null, type: 'AND' });
    return this;
  }

  whereNotNull(column: string): this {
    this.whereConditions.push({ column, operator: 'IS NOT NULL', value: null, type: 'AND' });
    return this;
  }

  whereBetween(column: string, min: unknown, max: unknown): this {
    this.whereConditions.push({
      column,
      operator: 'BETWEEN',
      value: [min, max],
      type: 'AND',
    });
    return this;
  }

  whereLike(column: string, pattern: string): this {
    this.whereConditions.push({ column, operator: 'LIKE', value: pattern, type: 'AND' });
    return this;
  }

  whereILike(column: string, pattern: string): this {
    this.whereConditions.push({ column, operator: 'ILIKE', value: pattern, type: 'AND' });
    return this;
  }

  whereRaw(sql: string, params?: unknown[]): this {
    this.whereConditions.push({
      column: '',
      operator: 'RAW',
      value: { sql, params: params ?? [] },
      type: 'AND',
    });
    return this;
  }

  // Ergonomic shorthand.
  gt(column: string, value: unknown): this { return this.where(column, '>', value); }
  gte(column: string, value: unknown): this { return this.where(column, '>=', value); }
  lt(column: string, value: unknown): this { return this.where(column, '<', value); }
  lte(column: string, value: unknown): this { return this.where(column, '<=', value); }
  ne(column: string, value: unknown): this { return this.where(column, '!=', value); }
  in(column: string, values: unknown[]): this { return this.whereIn(column, values); }
  notIn(column: string, values: unknown[]): this { return this.whereNotIn(column, values); }
  like(column: string, pattern: string): this { return this.whereLike(column, pattern); }
  ilike(column: string, pattern: string): this { return this.whereILike(column, pattern); }
  isNull(column: string): this { return this.whereNull(column); }
  isNotNull(column: string): this { return this.whereNotNull(column); }
  between(column: string, min: unknown, max: unknown): this {
    return this.whereBetween(column, min, max);
  }

  // OR shorthand.
  orGt(column: string, value: unknown): this { return this.orWhere(column, '>', value); }
  orGte(column: string, value: unknown): this { return this.orWhere(column, '>=', value); }
  orLt(column: string, value: unknown): this { return this.orWhere(column, '<', value); }
  orLte(column: string, value: unknown): this { return this.orWhere(column, '<=', value); }
  orNe(column: string, value: unknown): this { return this.orWhere(column, '!=', value); }
  orLike(column: string, pattern: string): this { return this.orWhere(column, 'LIKE', pattern); }
  orIlike(column: string, pattern: string): this { return this.orWhere(column, 'ILIKE', pattern); }
  orIn(column: string, values: unknown[]): this {
    this.whereConditions.push({ column, operator: 'IN', value: values, type: 'OR' });
    return this;
  }

  // ───────── joins ─────────

  join(table: string, firstCol: string, op: string, secondCol: string): this {
    return this.pushJoin('INNER', table, firstCol, op, secondCol);
  }

  leftJoin(table: string, firstCol: string, op: string, secondCol: string): this {
    return this.pushJoin('LEFT', table, firstCol, op, secondCol);
  }

  rightJoin(table: string, firstCol: string, op: string, secondCol: string): this {
    return this.pushJoin('RIGHT', table, firstCol, op, secondCol);
  }

  fullJoin(table: string, firstCol: string, op: string, secondCol: string): this {
    return this.pushJoin('FULL', table, firstCol, op, secondCol);
  }

  // ───────── grouping / ordering / pagination ─────────

  groupBy(...columns: string[]): this {
    this.groupByColumns = columns;
    return this;
  }

  having(column: string, opOrValue: WhereOperator | unknown, value?: unknown): this {
    let operator: WhereOperator = '=';
    let actual: unknown = opOrValue;
    if (value !== undefined) {
      operator = opOrValue as WhereOperator;
      actual = value;
    }
    this.havingConditions.push({ column, operator, value: actual, type: 'AND' });
    return this;
  }

  orderBy(column: string, direction: OrderDirection = 'ASC'): this {
    const normalized = direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    this.orderByClause.push({ column, direction: normalized });
    return this;
  }

  limit(n: number): this { this.limitValue = n; return this; }
  offset(n: number): this { this.offsetValue = n; return this; }
  paginate(page: number, perPage: number = 20): this {
    this.limitValue = perPage;
    this.offsetValue = (page - 1) * perPage;
    return this;
  }

  returning(...columns: string[]): this {
    this.returningColumns = columns.length > 0 ? columns : ['*'];
    return this;
  }

  // ───────── aggregates (SELECT expression shortcuts) ─────────

  sum(column: string): this { this.selectColumns = [`SUM(${column}) as sum`]; return this; }
  avg(column: string): this { this.selectColumns = [`AVG(${column}) as avg`]; return this; }
  min(column: string): this { this.selectColumns = [`MIN(${column}) as min`]; return this; }
  max(column: string): this { this.selectColumns = [`MAX(${column}) as max`]; return this; }

  async count(column: string = '*'): Promise<number> {
    const { count } = await this.http.post<{ count: number }>(
      API_ENDPOINTS.QUERY.COUNT,
      { table: this.tableName, column, where: this.whereConditions },
    );
    return count ?? 0;
  }

  async exists(): Promise<boolean> {
    const res = await this.http.post<{ exists: boolean }>(
      API_ENDPOINTS.QUERY.EXISTS,
      { table: this.tableName, where: this.whereConditions },
    );
    return res.exists === true;
  }

  // ───────── terminals ─────────

  async execute<R = T>(): Promise<QueryResult<R>> {
    const payload = this.buildPayload();
    const res = await this.http.post<QueryResult<R> | { rows: R[]; rowCount?: number }>(
      API_ENDPOINTS.QUERY.EXECUTE,
      payload,
    );
    if (Array.isArray((res as QueryResult<R>).data)) {
      return res as QueryResult<R>;
    }
    const raw = res as { rows: R[]; rowCount?: number };
    return { data: raw.rows ?? [], count: raw.rowCount };
  }

  async run<R = T>(): Promise<QueryResult<R>> { return this.execute<R>(); }
  async exec<R = T>(): Promise<QueryResult<R>> { return this.execute<R>(); }

  async rows<R = T>(): Promise<R[]> {
    const result = await this.execute<R>();
    return result.data ?? [];
  }

  async get<R = T>(): Promise<R[]> { return this.rows<R>(); }
  async all<R = T>(): Promise<R[]> { return this.rows<R>(); }
  async fetch<R = T>(): Promise<R[]> { return this.rows<R>(); }
  async toArray<R = T>(): Promise<R[]> { return this.rows<R>(); }

  async first<R = T>(): Promise<R | null> {
    this.limitValue = 1;
    const result = await this.execute<R>();
    return result.data?.[0] ?? null;
  }

  async one<R = T>(): Promise<R | null> { return this.first<R>(); }
  async find<R = T>(): Promise<R | null> { return this.first<R>(); }
  async findFirst<R = T>(): Promise<R | null> { return this.first<R>(); }
  async single<R = T>(): Promise<R | null> { return this.first<R>(); }

  async value<V = unknown>(column: string): Promise<V | null> {
    this.selectColumns = [column];
    const row = await this.first<Record<string, V>>();
    return row ? (row[column] ?? null) : null;
  }

  // Promise-like (`await qb` works without an explicit terminal).
  then<TR1 = QueryResult<T>, TR2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => TR1 | PromiseLike<TR1>) | null,
    onrejected?: ((reason: unknown) => TR2 | PromiseLike<TR2>) | null,
  ): Promise<TR1 | TR2> {
    return this.execute<T>().then(onfulfilled, onrejected);
  }

  catch<TR2 = never>(
    onrejected?: ((reason: unknown) => TR2 | PromiseLike<TR2>) | null,
  ): Promise<QueryResult<T> | TR2> {
    return this.execute<T>().catch(onrejected);
  }

  // ───────── introspection ─────────

  toPayload(): QueryPayload { return this.buildPayload(); }

  // ───────── internals ─────────

  private pushWhere(
    type: 'AND' | 'OR',
    column: string,
    opOrValue: WhereOperator | unknown,
    value: unknown | undefined,
  ): this {
    let operator: WhereOperator = '=';
    let actual: unknown = opOrValue;
    if (value !== undefined) {
      operator = opOrValue as WhereOperator;
      actual = value;
    }
    this.whereConditions.push({ column, operator, value: actual, type });
    return this;
  }

  private pushJoin(
    type: JoinType,
    table: string,
    firstColumn: string,
    operator: string,
    secondColumn: string,
  ): this {
    this.joinClauses.push({ type, table, firstColumn, operator, secondColumn });
    return this;
  }

  private buildPayload(): QueryPayload {
    const payload: QueryPayload = {
      type: this.queryType,
      table: this.tableName,
    };

    switch (this.queryType) {
      case 'SELECT':
        payload.columns = this.selectColumns;
        if (this.distinctFlag) payload.distinct = true;
        break;
      case 'INSERT':
        payload.data =
          this.insertData.length === 1 ? this.insertData[0]! : this.insertData;
        break;
      case 'UPDATE':
        payload.data = this.updateData;
        break;
      case 'DELETE':
        break;
    }

    if (this.whereConditions.length > 0) payload.where = this.whereConditions;
    if (this.joinClauses.length > 0) payload.joins = this.joinClauses;
    if (this.groupByColumns.length > 0) payload.groupBy = this.groupByColumns;
    if (this.havingConditions.length > 0) payload.having = this.havingConditions;
    if (this.orderByClause.length > 0) payload.orderBy = this.orderByClause;
    if (this.limitValue !== undefined) payload.limit = this.limitValue;
    if (this.offsetValue !== undefined) payload.offset = this.offsetValue;
    if (this.returningColumns.length > 0) payload.returning = this.returningColumns;

    return payload;
  }

  private clone(): QueryBuilder<T> {
    const next = new QueryBuilder<T>(this.http);
    next.queryType = this.queryType;
    next.tableName = this.tableName;
    next.selectColumns = [...this.selectColumns];
    next.whereConditions = [...this.whereConditions];
    next.joinClauses = [...this.joinClauses];
    next.orderByClause = [...this.orderByClause];
    next.groupByColumns = [...this.groupByColumns];
    next.havingConditions = [...this.havingConditions];
    next.limitValue = this.limitValue;
    next.offsetValue = this.offsetValue;
    next.distinctFlag = this.distinctFlag;
    next.returningColumns = [...this.returningColumns];
    next.insertData = [...this.insertData];
    next.updateData = { ...this.updateData };
    return next;
  }
}
