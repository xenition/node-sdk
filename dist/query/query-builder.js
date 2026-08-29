"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryBuilder = void 0;
const errors_1 = require("../core/errors");
const constants_1 = require("../constants");
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
 *  - `.stream()` is an addition, not part of the mirrored surface: it pages
 *    a SELECT for the caller so nobody has to hand-write the offset loop.
 *    Read its note before using it on a table under concurrent writes.
 */
/**
 * Refuse a filter value JSON cannot carry.
 *
 * `JSON.stringify(NaN)` is `null`, and an `undefined` property vanishes
 * from the payload entirely. So `where('price', '>=', Number(userInput))`
 * with a non-numeric input used to reach the server as `price >= NULL`,
 * which matches no rows. The caller then sees an empty list and reads it
 * as "no results" rather than "the filter was broken" — a wrong answer
 * wearing the costume of a valid one, which is worse than an error.
 *
 * `null` stays legal on purpose: `where('deleted_at', null)` is a real
 * IS NULL filter that callers depend on.
 */
function assertFilterable(column, operator, value) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new errors_1.XenitionError('VALIDATION_ERROR', `QueryBuilder.where("${column}", "${operator}", ${String(value)}): ` +
            `${String(value)} cannot be sent as a filter — it becomes NULL in JSON and the ` +
            'query would silently match nothing. Check the value before filtering on it.');
    }
    if (value === undefined) {
        throw new errors_1.XenitionError('VALIDATION_ERROR', `QueryBuilder.where("${column}", "${operator}", undefined): undefined is dropped from ` +
            'the request, so the server would receive a filter with no value. Pass null for an ' +
            'IS NULL check, or skip the filter entirely.');
    }
}
/**
 * Refuse a paging number the query cannot honour.
 *
 * Same disappearing act as `assertFilterable`, with a louder consequence.
 * `.limit(Number(req.query.limit))` on a non-numeric input is `NaN`, and
 * `JSON.stringify(NaN)` is `null` — so the limit does not arrive and the
 * server returns **the whole table**. A paging bug becomes a full table
 * read on a public endpoint. A vanished `offset` is quieter and worse to
 * debug: every page comes back as page one, and nothing errors.
 *
 * Negative and fractional values do reach the server and it does refuse
 * them, but as `LIMIT must not be negative (SQLSTATE 2201W)` or a flat
 * `invalid query payload` — neither names the call that was wrong. Refusing
 * here costs no round trip and says which one to fix.
 */
function assertRowCount(method, n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
        // Name the actual consequence per clause. "Runs unbounded" is true of a
        // dropped LIMIT and wrong about a dropped OFFSET, and a message that
        // describes the wrong symptom sends the reader looking in the wrong place.
        const consequence = method === 'offset'
            ? 'the clause is dropped and every page comes back as the first one'
            : 'the clause is dropped and the query runs unbounded — the whole table comes back';
        throw new errors_1.XenitionError('VALIDATION_ERROR', `QueryBuilder.${method}(${String(n)}): ${String(n)} cannot be sent — it becomes NULL ` +
            `in JSON, so ${consequence}. Check the value before paging on it.`);
    }
    if (!Number.isInteger(n)) {
        throw new errors_1.XenitionError('VALIDATION_ERROR', `QueryBuilder.${method}(${n}): must be a whole number of rows.`);
    }
    if (n < 0) {
        throw new errors_1.XenitionError('VALIDATION_ERROR', `QueryBuilder.${method}(${n}): must not be negative.`);
    }
}
/**
 * How many rows one `stream()` request asks for.
 *
 * The two costs pull against each other: every page is a round trip, and
 * every page is held whole in memory while it is yielded. A page of 20 —
 * the `paginate()` default, which is sized for a screen rather than for a
 * scan — turns a 100k-row table into 5,000 requests, and the round trips
 * dominate the wall clock entirely. 500 makes the same scan 200 requests
 * while keeping an ordinary page well inside a normal JSON response.
 *
 * Override it per call with `stream({ pageSize })`: down for rows that are
 * unusually wide (a JSON blob or a base64 column per row, where 500 at once
 * is a large buffer), up for narrow rows being scanned in bulk.
 */
const DEFAULT_STREAM_PAGE_SIZE = 500;
class QueryBuilder {
    constructor(http) {
        this.http = http;
        // Query state. All private to prevent external mutation.
        this.queryType = 'SELECT';
        this.tableName = '';
        this.selectColumns = ['*'];
        this.whereConditions = [];
        this.joinClauses = [];
        this.orderByClause = [];
        this.groupByColumns = [];
        this.havingConditions = [];
        this.distinctFlag = false;
        this.returningColumns = [];
        this.insertData = [];
        this.updateData = {};
    }
    // ───────── entry points (immutable: return a fresh builder) ─────────
    from(table) {
        const next = this.clone();
        next.queryType = 'SELECT';
        next.tableName = table;
        return next;
    }
    insert(data) {
        const next = this.clone();
        next.queryType = 'INSERT';
        next.insertData = Array.isArray(data) ? data : [data];
        return next;
    }
    update(data) {
        const next = this.clone();
        next.queryType = 'UPDATE';
        next.updateData = data;
        return next;
    }
    delete() {
        const next = this.clone();
        next.queryType = 'DELETE';
        return next;
    }
    // ───────── SELECT shape (mutating) ─────────
    select(...columns) {
        this.selectColumns = columns.length > 0 ? columns : ['*'];
        return this;
    }
    distinct() {
        this.distinctFlag = true;
        return this;
    }
    // ───────── WHERE clauses ─────────
    where(column, opOrValue, value) {
        return this.pushWhere('AND', column, opOrValue, value);
    }
    orWhere(column, opOrValue, value) {
        return this.pushWhere('OR', column, opOrValue, value);
    }
    whereIn(column, values) {
        this.whereConditions.push({ column, operator: 'IN', value: values, type: 'AND' });
        return this;
    }
    whereNotIn(column, values) {
        this.whereConditions.push({ column, operator: 'NOT IN', value: values, type: 'AND' });
        return this;
    }
    whereNull(column) {
        this.whereConditions.push({ column, operator: 'IS NULL', value: null, type: 'AND' });
        return this;
    }
    whereNotNull(column) {
        this.whereConditions.push({ column, operator: 'IS NOT NULL', value: null, type: 'AND' });
        return this;
    }
    whereBetween(column, min, max) {
        this.whereConditions.push({
            column,
            operator: 'BETWEEN',
            value: [min, max],
            type: 'AND',
        });
        return this;
    }
    whereLike(column, pattern) {
        this.whereConditions.push({ column, operator: 'LIKE', value: pattern, type: 'AND' });
        return this;
    }
    whereILike(column, pattern) {
        this.whereConditions.push({ column, operator: 'ILIKE', value: pattern, type: 'AND' });
        return this;
    }
    whereRaw(sql, params) {
        this.whereConditions.push({
            column: '',
            operator: 'RAW',
            value: { sql, params: params ?? [] },
            type: 'AND',
        });
        return this;
    }
    // Ergonomic shorthand.
    gt(column, value) { return this.where(column, '>', value); }
    gte(column, value) { return this.where(column, '>=', value); }
    lt(column, value) { return this.where(column, '<', value); }
    lte(column, value) { return this.where(column, '<=', value); }
    ne(column, value) { return this.where(column, '!=', value); }
    in(column, values) { return this.whereIn(column, values); }
    notIn(column, values) { return this.whereNotIn(column, values); }
    like(column, pattern) { return this.whereLike(column, pattern); }
    ilike(column, pattern) { return this.whereILike(column, pattern); }
    isNull(column) { return this.whereNull(column); }
    isNotNull(column) { return this.whereNotNull(column); }
    between(column, min, max) {
        return this.whereBetween(column, min, max);
    }
    // OR shorthand.
    orGt(column, value) { return this.orWhere(column, '>', value); }
    orGte(column, value) { return this.orWhere(column, '>=', value); }
    orLt(column, value) { return this.orWhere(column, '<', value); }
    orLte(column, value) { return this.orWhere(column, '<=', value); }
    orNe(column, value) { return this.orWhere(column, '!=', value); }
    orLike(column, pattern) { return this.orWhere(column, 'LIKE', pattern); }
    orIlike(column, pattern) { return this.orWhere(column, 'ILIKE', pattern); }
    orIn(column, values) {
        this.whereConditions.push({ column, operator: 'IN', value: values, type: 'OR' });
        return this;
    }
    // ───────── joins ─────────
    join(table, firstCol, op, secondCol) {
        return this.pushJoin('INNER', table, firstCol, op, secondCol);
    }
    leftJoin(table, firstCol, op, secondCol) {
        return this.pushJoin('LEFT', table, firstCol, op, secondCol);
    }
    rightJoin(table, firstCol, op, secondCol) {
        return this.pushJoin('RIGHT', table, firstCol, op, secondCol);
    }
    fullJoin(table, firstCol, op, secondCol) {
        return this.pushJoin('FULL', table, firstCol, op, secondCol);
    }
    // ───────── grouping / ordering / pagination ─────────
    groupBy(...columns) {
        this.groupByColumns = columns;
        return this;
    }
    having(column, opOrValue, value) {
        let operator = '=';
        let actual = opOrValue;
        if (value !== undefined) {
            operator = opOrValue;
            actual = value;
        }
        this.havingConditions.push({ column, operator, value: actual, type: 'AND' });
        return this;
    }
    orderBy(column, direction = 'ASC') {
        const normalized = direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        this.orderByClause.push({ column, direction: normalized });
        return this;
    }
    limit(n) { assertRowCount('limit', n); this.limitValue = n; return this; }
    offset(n) { assertRowCount('offset', n); this.offsetValue = n; return this; }
    paginate(page, perPage = 20) {
        // Validated before the arithmetic, not after: `paginate(NaN, 20)` would
        // otherwise report a NaN offset, which points at a call the caller
        // never made.
        assertRowCount('paginate', perPage);
        if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) {
            throw new errors_1.XenitionError('VALIDATION_ERROR', `QueryBuilder.paginate(${String(page)}): page is 1-based, so it must be a whole ` +
                'number of 1 or more.');
        }
        this.limitValue = perPage;
        this.offsetValue = (page - 1) * perPage;
        return this;
    }
    returning(...columns) {
        this.returningColumns = columns.length > 0 ? columns : ['*'];
        return this;
    }
    // ───────── aggregates (SELECT expression shortcuts) ─────────
    sum(column) { this.selectColumns = [`SUM(${column}) as sum`]; return this; }
    avg(column) { this.selectColumns = [`AVG(${column}) as avg`]; return this; }
    min(column) { this.selectColumns = [`MIN(${column}) as min`]; return this; }
    max(column) { this.selectColumns = [`MAX(${column}) as max`]; return this; }
    async count(column = '*') {
        const { count } = await this.http.post(constants_1.API_ENDPOINTS.QUERY.COUNT, { table: this.tableName, column, where: this.whereConditions });
        return count ?? 0;
    }
    async exists() {
        const res = await this.http.post(constants_1.API_ENDPOINTS.QUERY.EXISTS, { table: this.tableName, where: this.whereConditions });
        return res.exists === true;
    }
    // ───────── terminals ─────────
    async execute() {
        const payload = this.buildPayload();
        const res = await this.http.post(constants_1.API_ENDPOINTS.QUERY.EXECUTE, payload);
        if (Array.isArray(res.data)) {
            return res;
        }
        const raw = res;
        return { data: raw.rows ?? [], count: raw.rowCount };
    }
    async run() { return this.execute(); }
    async exec() { return this.execute(); }
    async rows() {
        const result = await this.execute();
        return result.data ?? [];
    }
    async get() { return this.rows(); }
    async all() { return this.rows(); }
    async fetch() { return this.rows(); }
    async toArray() { return this.rows(); }
    /**
     * The first matching row, or null.
     *
     * SELECT only. `.update({…}).first()` reads like "update it and give me
     * the row back", which is why it kept being written — but it is a SELECT
     * verb on a write, and it used to quietly attach `limit: 1` to an UPDATE.
     * Use `.returning('*')` then `.rows()` for that instead, which is what the
     * error says.
     */
    async first() {
        if (this.queryType !== 'SELECT') {
            throw new Error(`QueryBuilder.first(): cannot be used on ${this.queryType}. ` +
                `Use .returning('*') then .rows() to read back the affected rows.`);
        }
        this.limitValue = 1;
        const result = await this.execute();
        return result.data?.[0] ?? null;
    }
    async one() { return this.first(); }
    async find() { return this.first(); }
    async findFirst() { return this.first(); }
    async single() { return this.first(); }
    async value(column) {
        this.selectColumns = [column];
        const row = await this.first();
        return row ? (row[column] ?? null) : null;
    }
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
    stream(options = {}) {
        // Validated here rather than inside the generator body: a generator does
        // not run a line of itself until the first `next()`, so a misuse would
        // otherwise surface at the `for await` instead of at the `.stream()` that
        // is actually wrong — and would be missed entirely by code that builds the
        // iterator and never iterates it.
        if (this.queryType !== 'SELECT') {
            throw new errors_1.XenitionError('VALIDATION_ERROR', `QueryBuilder.stream(): cannot be used on ${this.queryType}. Streaming pages with ` +
                'LIMIT/OFFSET, which Postgres has for SELECT only. To walk the rows a write ' +
                `touched, use .returning('*') then .rows().`);
        }
        const pageSize = options.pageSize ?? DEFAULT_STREAM_PAGE_SIZE;
        assertRowCount('stream', pageSize);
        if (pageSize < 1) {
            // `assertRowCount` lets 0 through because `LIMIT 0` is a legal count-only
            // probe. It is not legal here: a page of no rows makes no progress, so
            // the offset never advances and the loop asks the same question forever.
            throw new errors_1.XenitionError('VALIDATION_ERROR', 'QueryBuilder.stream({ pageSize: 0 }): a page of zero rows never advances the ' +
                'offset, so the stream would request forever and yield nothing. Ask for at ' +
                'least one row per page.');
        }
        // Snapshot now. `first()` sets `limitValue` on the live builder, which is
        // why `qb.first()` quietly leaves a `limit: 1` behind on a builder the
        // caller meant to reuse; streaming must not repeat that. Every page is
        // executed against a private copy, so the caller's builder is byte-for-byte
        // what it was before the call and later edits to it cannot change a stream
        // that is already running.
        return this.pageThrough(this.clone(), pageSize);
    }
    async *pageThrough(source, pageSize) {
        const ceiling = source.limitValue; // undefined = read until the table ends
        let offset = source.offsetValue ?? 0;
        let yielded = 0;
        for (;;) {
            // Never ask for more than the caller's remaining budget, so the last page
            // of a `.limit(25).stream({ pageSize: 10 })` requests 5 rows rather than
            // fetching 10 and discarding half of them.
            const wanted = ceiling === undefined ? pageSize : Math.min(pageSize, ceiling - yielded);
            if (wanted <= 0)
                return;
            const page = source.clone();
            page.limitValue = wanted;
            page.offsetValue = offset;
            const rows = (await page.execute()).data ?? [];
            for (const row of rows) {
                yield row;
                yielded += 1;
                // The ceiling is enforced against rows actually yielded, not against
                // what was requested: a server that ignores or clamps `limit` and hands
                // back a longer page must not push the stream past the caller's limit.
                if (ceiling !== undefined && yielded >= ceiling)
                    return;
            }
            // A page shorter than the one requested is itself the proof that there is
            // nothing after it, so stop without paying for a request to confirm it.
            // An exactly-full last page cannot prove that, and does cost one final
            // empty request — the honest price of not knowing the total.
            if (rows.length < wanted)
                return;
            offset += rows.length;
        }
    }
    // Promise-like (`await qb` works without an explicit terminal).
    then(onfulfilled, onrejected) {
        return this.execute().then(onfulfilled, onrejected);
    }
    catch(onrejected) {
        return this.execute().catch(onrejected);
    }
    // ───────── introspection ─────────
    toPayload() { return this.buildPayload(); }
    // ───────── internals ─────────
    pushWhere(type, column, opOrValue, value) {
        let operator = '=';
        let actual = opOrValue;
        if (value !== undefined) {
            operator = opOrValue;
            actual = value;
        }
        assertFilterable(column, operator, actual);
        this.whereConditions.push({ column, operator, value: actual, type });
        return this;
    }
    pushJoin(type, table, firstColumn, operator, secondColumn) {
        this.joinClauses.push({ type, table, firstColumn, operator, secondColumn });
        return this;
    }
    buildPayload() {
        const payload = {
            type: this.queryType,
            table: this.tableName,
        };
        switch (this.queryType) {
            case 'SELECT':
                payload.columns = this.selectColumns;
                if (this.distinctFlag)
                    payload.distinct = true;
                break;
            case 'INSERT':
                payload.data =
                    this.insertData.length === 1 ? this.insertData[0] : this.insertData;
                break;
            case 'UPDATE':
                payload.data = this.updateData;
                break;
            case 'DELETE':
                break;
        }
        if (this.whereConditions.length > 0)
            payload.where = this.whereConditions;
        if (this.joinClauses.length > 0)
            payload.joins = this.joinClauses;
        if (this.groupByColumns.length > 0)
            payload.groupBy = this.groupByColumns;
        if (this.havingConditions.length > 0)
            payload.having = this.havingConditions;
        if (this.orderByClause.length > 0)
            payload.orderBy = this.orderByClause;
        // SELECT only. Postgres has no `UPDATE … LIMIT` or `DELETE … LIMIT`, so
        // sending one is at best ignored and at worst a syntax error — and the
        // way to reach here is not exotic: `.update({…}).first()` is the obvious
        // way to ask for the updated row back, and it silently set limit = 1.
        // `first()` now refuses that outright; this is the backstop for anyone
        // who calls `.limit()` directly on a write.
        if (this.queryType === 'SELECT') {
            if (this.limitValue !== undefined)
                payload.limit = this.limitValue;
            if (this.offsetValue !== undefined)
                payload.offset = this.offsetValue;
        }
        if (this.returningColumns.length > 0)
            payload.returning = this.returningColumns;
        return payload;
    }
    clone() {
        const next = new QueryBuilder(this.http);
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
exports.QueryBuilder = QueryBuilder;
//# sourceMappingURL=query-builder.js.map