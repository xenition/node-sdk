import { HttpClient } from '../core/http-client';
import { OrderDirection, QueryPayload, QueryResult, WhereOperator } from './types';
/** Options for {@link QueryBuilder.stream}. */
export interface StreamOptions {
    /** Rows per underlying request. Defaults to 500; see the constant's note. */
    pageSize?: number;
}
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
    /**
     * The first matching row, or null.
     *
     * SELECT only. `.update({…}).first()` reads like "update it and give me
     * the row back", which is why it kept being written — but it is a SELECT
     * verb on a write, and it used to quietly attach `limit: 1` to an UPDATE.
     * Use `.returning('*')` then `.rows()` for that instead, which is what the
     * error says.
     */
    first<R = T>(): Promise<R | null>;
    one<R = T>(): Promise<R | null>;
    find<R = T>(): Promise<R | null>;
    findFirst<R = T>(): Promise<R | null>;
    single<R = T>(): Promise<R | null>;
    value<V = unknown>(column: string): Promise<V | null>;
    /**
     * Every matching row, one at a time, paging underneath.
     *
     *     for await (const row of client.query.from('items').where('active', true).stream()) {
     *       …
     *     }
     *
     * This exists because the hand-written paging loop is where the bugs were.
     * The two that kept recurring: bumping `offset` before checking for a short
     * page, which spends a pointless request per scan and, when the last page is
     * exactly full, reads one page past the data; and stopping only on an
     * **empty** page, which never terminates against a server that clamps a
     * too-large `limit` down to its own maximum. This method stops on the first
     * page shorter than the one it asked for, so a page that already proves it
     * is the last costs no extra request.
     *
     * A `limit()` set before the call is a ceiling on the whole stream, not on
     * each page: `.limit(30).stream({ pageSize: 10 })` makes three requests and
     * yields thirty rows. An `offset()` set before the call is where the scan
     * starts. `limit(0)` yields nothing and issues no request at all.
     *
     * ## Paging is by OFFSET, and here is what that costs
     *
     * A stream is many separate reads, not one snapshot. Under concurrent
     * writes, offset paging silently skips and repeats: a row inserted before
     * the current window shifts everything after it forward, so one row is
     * yielded twice; a delete shifts backward, so one row is never yielded at
     * all. Nothing errors — every row you get is a real row that existed when it
     * was read, but the set as a whole is not a consistent view of any single
     * instant. On an append-only or quiet table that is nothing; on a hot queue
     * table it is real.
     *
     * The keyset cursor used elsewhere in this SDK (`InboxPage.nextCursor` — the
     * `createdAt` of the last row seen) does not generalise to this builder, and
     * guessing at one here would be worse than the drift it fixes:
     *
     *  - Keyset needs an ordering that is unique and total, and the builder
     *    cannot know whether it has one. `orderBy('created_at')` on two rows
     *    written in the same millisecond makes a `>` cursor skip a row and a
     *    `>=` cursor return the same page forever — the non-termination this
     *    method exists to remove, reintroduced by the fix for it.
     *  - The cursor condition would have to be appended to `whereConditions`,
     *    which is a flat list with no grouping. Appending `AND id > $cursor` to
     *    `a = 1 OR b = 2` binds to the `b = 2` alone, so the stream would return
     *    rows the caller's filter never asked for.
     *
     * If a scan must not skip or repeat, page it by a unique key yourself —
     * `.where('id', '>', lastId).orderBy('id').limit(n)`, the same shape the
     * inbox cursor uses — or take the whole thing inside one server-side
     * transaction. This method trades that guarantee for not having to.
     */
    stream<R = T>(options?: StreamOptions): AsyncIterableIterator<R>;
    private pageThrough;
    then<TR1 = QueryResult<T>, TR2 = never>(onfulfilled?: ((value: QueryResult<T>) => TR1 | PromiseLike<TR1>) | null, onrejected?: ((reason: unknown) => TR2 | PromiseLike<TR2>) | null): Promise<TR1 | TR2>;
    catch<TR2 = never>(onrejected?: ((reason: unknown) => TR2 | PromiseLike<TR2>) | null): Promise<QueryResult<T> | TR2>;
    toPayload(): QueryPayload;
    private pushWhere;
    private pushJoin;
    private buildPayload;
    private clone;
}
//# sourceMappingURL=query-builder.d.ts.map