import { HttpClient } from '../core/http-client';
import { OrderDirection, QueryPayload, QueryResult, WhereOperator } from './types';
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
export declare class QueryBuilder<T = Record<string, unknown>> {
    private readonly http;
    private queryType;
    private tableName;
    private selectColumns;
    private whereConditions;
    private joinClauses;
    private orderByClause;
    private groupByColumns;
    private havingConditions;
    private limitValue?;
    private offsetValue?;
    private distinctFlag;
    private returningColumns;
    private insertData;
    private updateData;
    constructor(http: HttpClient);
    from(table: string): QueryBuilder<T>;
    insert(data: Record<string, unknown> | Record<string, unknown>[]): QueryBuilder<T>;
    update(data: Record<string, unknown>): QueryBuilder<T>;
    delete(): QueryBuilder<T>;
    select(...columns: string[]): this;
    distinct(): this;
    where(column: string, opOrValue: WhereOperator | unknown, value?: unknown): this;
    orWhere(column: string, opOrValue: WhereOperator | unknown, value?: unknown): this;
    whereIn(column: string, values: unknown[]): this;
    whereNotIn(column: string, values: unknown[]): this;
    whereNull(column: string): this;
    whereNotNull(column: string): this;
    whereBetween(column: string, min: unknown, max: unknown): this;
    whereLike(column: string, pattern: string): this;
    whereILike(column: string, pattern: string): this;
    whereRaw(sql: string, params?: unknown[]): this;
    gt(column: string, value: unknown): this;
    gte(column: string, value: unknown): this;
    lt(column: string, value: unknown): this;
    lte(column: string, value: unknown): this;
    ne(column: string, value: unknown): this;
    in(column: string, values: unknown[]): this;
    notIn(column: string, values: unknown[]): this;
    like(column: string, pattern: string): this;
    ilike(column: string, pattern: string): this;
    isNull(column: string): this;
    isNotNull(column: string): this;
    between(column: string, min: unknown, max: unknown): this;
    orGt(column: string, value: unknown): this;
    orGte(column: string, value: unknown): this;
    orLt(column: string, value: unknown): this;
    orLte(column: string, value: unknown): this;
    orNe(column: string, value: unknown): this;
    orLike(column: string, pattern: string): this;
    orIlike(column: string, pattern: string): this;
    orIn(column: string, values: unknown[]): this;
    join(table: string, firstCol: string, op: string, secondCol: string): this;
    leftJoin(table: string, firstCol: string, op: string, secondCol: string): this;
    rightJoin(table: string, firstCol: string, op: string, secondCol: string): this;
    fullJoin(table: string, firstCol: string, op: string, secondCol: string): this;
    groupBy(...columns: string[]): this;
    having(column: string, opOrValue: WhereOperator | unknown, value?: unknown): this;
    orderBy(column: string, direction?: OrderDirection): this;
    limit(n: number): this;
    offset(n: number): this;
    paginate(page: number, perPage?: number): this;
    returning(...columns: string[]): this;
    sum(column: string): this;
    avg(column: string): this;
    min(column: string): this;
    max(column: string): this;
    count(column?: string): Promise<number>;
    exists(): Promise<boolean>;
    execute<R = T>(): Promise<QueryResult<R>>;
    run<R = T>(): Promise<QueryResult<R>>;
    exec<R = T>(): Promise<QueryResult<R>>;
    rows<R = T>(): Promise<R[]>;
    get<R = T>(): Promise<R[]>;
    all<R = T>(): Promise<R[]>;
    fetch<R = T>(): Promise<R[]>;
    toArray<R = T>(): Promise<R[]>;
    first<R = T>(): Promise<R | null>;
    one<R = T>(): Promise<R | null>;
    find<R = T>(): Promise<R | null>;
    findFirst<R = T>(): Promise<R | null>;
    single<R = T>(): Promise<R | null>;
    value<V = unknown>(column: string): Promise<V | null>;
    then<TR1 = QueryResult<T>, TR2 = never>(onfulfilled?: ((value: QueryResult<T>) => TR1 | PromiseLike<TR1>) | null, onrejected?: ((reason: unknown) => TR2 | PromiseLike<TR2>) | null): Promise<TR1 | TR2>;
    catch<TR2 = never>(onrejected?: ((reason: unknown) => TR2 | PromiseLike<TR2>) | null): Promise<QueryResult<T> | TR2>;
    toPayload(): QueryPayload;
    private pushWhere;
    private pushJoin;
    private buildPayload;
    private clone;
}
//# sourceMappingURL=query-builder.d.ts.map