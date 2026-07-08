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
}
exports.QueryClient = QueryClient;
//# sourceMappingURL=query-client.js.map