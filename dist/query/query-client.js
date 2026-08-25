"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryClient = void 0;
const constants_1 = require("../constants");
const query_builder_1 = require("./query-builder");
/**
 * Thin wrapper exposing the Supabase-style `.from(table)` entry point and
 * the raw SQL escape hatch. Generated apps use `client.query.from(...)` for
 * everything; service-key-only tooling uses `client.raw(sql, params)`.
 */
class QueryClient {
    constructor(http) {
        this.http = http;
    }
    from(table) {
        return new query_builder_1.QueryBuilder(this.http).from(table);
    }
    /**
     * Direct parameterized SQL against the per-app DB. Requires the service
     * key. Unsafe in anon contexts — the server rejects it with 403.
     */
    async raw(sql, params = []) {
        const res = await this.http.post(constants_1.API_ENDPOINTS.QUERY.RAW, { sql, params });
        if (Array.isArray(res.data))
            return res;
        const raw = res;
        return { data: raw.rows ?? [], count: raw.rowCount };
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
    async transaction(statements, options = {}) {
        if (!Array.isArray(statements) || statements.length === 0) {
            throw new Error('QueryClient.transaction: pass at least one statement.');
        }
        for (const [index, statement] of statements.entries()) {
            if (typeof statement?.sql !== 'string' || statement.sql.trim() === '') {
                throw new Error(`QueryClient.transaction: statement ${index} has no sql.`);
            }
        }
        const res = await this.http.post(constants_1.API_ENDPOINTS.QUERY.TRANSACTION, {
            statements: statements.map((statement) => ({
                sql: statement.sql,
                params: statement.params ?? [],
            })),
        }, options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined);
        const list = Array.isArray(res) ? res : (res.results ?? []);
        return list.map((entry) => {
            if (Array.isArray(entry.data))
                return entry;
            const raw = entry;
            return { data: raw.rows ?? [], count: raw.rowCount };
        });
    }
}
exports.QueryClient = QueryClient;
//# sourceMappingURL=query-client.js.map