"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeStore = void 0;
exports.makeFakeContext = makeFakeContext;
const query_client_1 = require("../query/query-client");
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
class FakeStore {
    constructor() {
        this.tables = new Map();
        /** Every payload seen, for tests that assert on the emitted IR itself. */
        this.payloads = [];
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
        const stored = incoming.map((row) => ({ ...row }));
        this.rows(payload.table).push(...stored);
        return stored.map((row) => ({ ...row }));
    }
    update(payload) {
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
    const post = (_url, body) => {
        if ('sql' in body) {
            if (!options.raw) {
                throw new Error(`FakeStore: raw SQL is not supported unless makeFakeContext({ raw }) is given. SQL: ${body.sql.slice(0, 80)}`);
            }
            return Promise.resolve({ data: options.raw(body.sql, body.params ?? [], store) });
        }
        return Promise.resolve(store.handle(body));
    };
    const query = new query_client_1.QueryClient({ post });
    return { store, ctx: { query, raw: (sql, params = []) => query.raw(sql, params) } };
}
//# sourceMappingURL=fake-store.js.map