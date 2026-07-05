"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryBuilder = void 0;
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
 */
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
    limit(n) { this.limitValue = n; return this; }
    offset(n) { this.offsetValue = n; return this; }
    paginate(page, perPage = 20) {
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
    async first() {
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
        if (this.limitValue !== undefined)
            payload.limit = this.limitValue;
        if (this.offsetValue !== undefined)
            payload.offset = this.offsetValue;
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