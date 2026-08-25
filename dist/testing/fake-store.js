"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeStore = void 0;
exports.makeFakeContext = makeFakeContext;
const constants_1 = require("../constants");
const query_client_1 = require("../query/query-client");
const util_1 = require("../modules/util");
class FakeStore {
    constructor() {
        this.tables = new Map();
        /** Every payload seen, for tests that assert on the emitted IR itself. */
        this.payloads = [];
        /**
         * The count/exists bodies seen, kept apart from `payloads` only because
         * they are a different shape and callers already narrow that array on
         * `.type`.
         */
        this.aggregates = [];
    }
    rows(table) {
        let rows = this.tables.get(table);
        if (!rows) {
            rows = [];
            this.tables.set(table, rows);
        }
        return rows;
    }
    /** Seed a table directly, bypassing the builder. */
    seed(table, rows) {
        this.rows(table).push(...rows);
    }
    handle(payload) {
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
    count(payload) {
        this.aggregates.push(payload);
        const rows = this.rows(payload.table).filter((row) => matches(row, payload.where));
        const column = payload.column ?? '*';
        if (column === '*')
            return { count: rows.length };
        return {
            count: rows.filter((row) => row[column] !== null && row[column] !== undefined).length,
        };
    }
    /** `POST /query/exists` — `QueryBuilder.exists()`, same WHERE handling. */
    exists(payload) {
        this.aggregates.push(payload);
        return { exists: this.rows(payload.table).some((row) => matches(row, payload.where)) };
    }
    select(payload) {
        let rows = this.rows(payload.table).filter((row) => matches(row, payload.where));
        for (const order of [...(payload.orderBy ?? [])].reverse()) {
            rows = [...rows].sort((a, b) => {
                const av = a[order.column];
                const bv = b[order.column];
                const cmp = av === bv ? 0 : av > bv ? 1 : -1;
                return order.direction === 'DESC' ? -cmp : cmp;
            });
        }
        const offset = payload.offset ?? 0;
        const limited = payload.limit === undefined ? rows : rows.slice(offset, offset + payload.limit);
        return (payload.offset !== undefined && payload.limit === undefined
            ? rows.slice(offset)
            : limited).map((row) => ({ ...row }));
    }
    insert(payload) {
        const incoming = Array.isArray(payload.data) ? payload.data : [payload.data ?? {}];
        const stored = incoming.map((row) => withDefaults(row));
        this.rows(payload.table).push(...stored);
        return stored.map((row) => ({ ...row }));
    }
    update(payload) {
        // No `updated_at` bump here, on purpose. A column default fires on
        // INSERT only; nothing in the shipped DDL installs an UPDATE trigger,
        // so real Postgres leaves the old value alone too, and every module
        // that wants a fresh one puts `updated_at: nowIso()` in its own patch
        // (see CmsClient's update path). Bumping it here would make the fake
        // MORE forgiving than the database and hide exactly the bug — a client
        // that forgot to set it — a test is there to catch.
        const patch = (payload.data ?? {});
        const touched = [];
        for (const row of this.rows(payload.table)) {
            if (!matches(row, payload.where))
                continue;
            Object.assign(row, patch);
            touched.push({ ...row });
        }
        return touched;
    }
    remove(payload) {
        const rows = this.rows(payload.table);
        const kept = rows.filter((row) => !matches(row, payload.where));
        const removed = rows.filter((row) => matches(row, payload.where));
        this.tables.set(payload.table, kept);
        return removed;
    }
}
exports.FakeStore = FakeStore;
/**
 * Fill in what a column default would have filled in.
 *
 * The store used to keep the row exactly as it arrived, which is wrong in a
 * way that costs an afternoon: real tables declare `id uuid DEFAULT
 * gen_random_uuid()` and `created_at/updated_at DEFAULT now()`, so an
 * `insert(...).returning('*')` that trusts them came back with
 * `id: undefined` here. The route then answered `{ item: { id: undefined } }`
 * and the next request went to `/pantry/undefined` — a failure three frames
 * from its cause, and one that says nothing about the code under test.
 *
 * The fake cannot read a schema, so this is a CONVENTION, not a simulation
 * of DDL: only `id`, `created_at` and `updated_at` are filled, because those
 * are the three the SDK's own module tables and every generated app declare
 * with defaults. A table without them is unaffected; a table with a
 * different default (a `status` that starts `'draft'`, say) still needs the
 * value passed explicitly, exactly as it does against a fake with no
 * defaults at all.
 *
 * A supplied value always wins, and `null` counts as supplied — an explicit
 * NULL beats a column default in Postgres too, and treating it as absent
 * would quietly turn a test's deliberate null into a uuid.
 */
function withDefaults(row) {
    const filled = { ...row };
    if (filled.id === undefined)
        filled.id = (0, util_1.generateId)();
    const at = (0, util_1.nowIso)();
    if (filled.created_at === undefined)
        filled.created_at = at;
    if (filled.updated_at === undefined)
        filled.updated_at = at;
    return filled;
}
function matches(row, where) {
    if (!where || where.length === 0)
        return true;
    // Billing only ever emits ANDed conditions; an OR would silently widen
    // these results, so refuse rather than quietly answer the wrong question.
    const or = where.find((condition, index) => index > 0 && condition.type === 'OR');
    if (or)
        throw new Error('FakeStore: OR conditions are not supported');
    return where.every((condition) => matchesOne(row, condition));
}
function matchesOne(row, condition) {
    const actual = row[condition.column];
    switch (condition.operator) {
        case '=':
            return actual === condition.value;
        case '!=':
            return actual !== condition.value;
        case 'IN':
            return condition.value.includes(actual);
        case 'NOT IN':
            return !condition.value.includes(actual);
        case 'IS NULL':
            return actual === null || actual === undefined;
        case 'IS NOT NULL':
            return actual !== null && actual !== undefined;
        case '>':
            return actual > condition.value;
        case '>=':
            return actual >= condition.value;
        case '<':
            return actual < condition.value;
        case '<=':
            return actual <= condition.value;
        default:
            throw new Error(`FakeStore: unsupported operator ${condition.operator}`);
    }
}
/** A ModuleContext backed by the fake store, plus the store to assert on. */
function makeFakeContext(options = {}) {
    const store = new FakeStore();
    // A plain function rather than `jest.fn`: this module ships as
    // `@xenition/sdk/testing`, and a published helper must not require a test
    // runner to be present. Assertions read `store.payloads` instead.
    const post = (url, body) => {
        if ('sql' in body) {
            if (!options.raw) {
                throw new Error(`FakeStore: raw SQL is not supported unless makeFakeContext({ raw }) is given. SQL: ${body.sql.slice(0, 80)}`);
            }
            return Promise.resolve({ data: options.raw(body.sql, body.params ?? [], store) });
        }
        // Count and exists are told apart by the URL, not by the body. Their
        // payloads differ only in whether `column` is present, and leaning on
        // that would break the day either endpoint grows a field; the endpoint
        // is what the builder actually chose between.
        if (url === constants_1.API_ENDPOINTS.QUERY.COUNT) {
            return Promise.resolve(store.count(body));
        }
        if (url === constants_1.API_ENDPOINTS.QUERY.EXISTS) {
            return Promise.resolve(store.exists(body));
        }
        return Promise.resolve(store.handle(body));
    };
    const query = new query_client_1.QueryClient({ post });
    return { store, ctx: { query, raw: (sql, params = []) => query.raw(sql, params) } };
}
//# sourceMappingURL=fake-store.js.map