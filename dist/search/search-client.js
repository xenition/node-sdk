"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchClient = void 0;
const constants_1 = require("../constants");
const row_casing_1 = require("../modules/row-casing");
/**
 * Hybrid search over per-app `public.*` tables. Keyword (pg_trgm),
 * semantic (Qdrant), or RRF-fused hybrid.
 *
 *   // one-time setup
 *   await client.search.configureSearch('articles', {
 *     fullTextColumns: ['title', 'body'],
 *     semanticColumns: ['title', 'summary'],
 *   });
 *   await client.search.bulkIndex('articles');
 *
 *   // runtime
 *   const { hits } = await client.search.unifiedSearch('articles', 'quantum computing', {
 *     mode: 'hybrid',
 *     limit: 20,
 *     highlight: true,
 *   });
 */
class SearchClient {
    constructor(http) {
        this.http = http;
    }
    /**
     * Search, with every hit's `row` in the same snake_case shape
     * `client.query.from(table).rows()` hands back.
     *
     * That is a change of return shape, and it is deliberate. The gateway
     * camelCases the row it nests inside a hit but returns `.from(...)` rows
     * with the column names verbatim, so the SAME database row was
     * `created_at` when listed and `createdAt` when searched. Apps list and
     * search into one component; `item.created_at` was therefore a date on
     * the list screen and `undefined` on the results screen, with nothing
     * thrown and nothing logged. That is the failure mode that once let an
     * EXPIRED subscription read as active — see src/modules/row-casing.ts.
     *
     * Only the ROW is touched. The hit's own fields — `id`, `score`, `table`,
     * `highlight` — are this search API's contract and are camelCase on
     * purpose, so normalizing them would break the callers they were written
     * for. `payload` is left alone for the opposite reason: it is the
     * document the app itself indexed, so its keys belong to the app, not to
     * the database. For the same reason the row is normalized one level deep
     * only, leaving jsonb columns exactly as they were stored.
     */
    async unifiedSearch(table, query, options = {}) {
        const result = await this.http.post(constants_1.API_ENDPOINTS.SEARCH.UNIFIED, { table, query, ...options });
        // A response without a `hits` array is not something this method can
        // improve on; hand it back rather than inventing an empty result and
        // hiding whatever the server actually said.
        if (!result || !Array.isArray(result.hits))
            return result;
        return { ...result, hits: result.hits.map(snakeHitRow) };
    }
    configureSearch(table, input) {
        return this.http.post(constants_1.API_ENDPOINTS.SEARCH.CONFIGURE, {
            table,
            ...input,
        });
    }
    listConfigs() {
        return this.http.get(constants_1.API_ENDPOINTS.SEARCH.CONFIGS);
    }
    indexDocument(table, recordId, content) {
        return this.http.post(constants_1.API_ENDPOINTS.SEARCH.INDEX, {
            table,
            recordId,
            content,
        });
    }
    bulkIndex(table, options = {}) {
        return this.http.post(constants_1.API_ENDPOINTS.SEARCH.BULK_INDEX, { table, ...options });
    }
}
exports.SearchClient = SearchClient;
/**
 * Snake-case the row a hit carries, and nothing else about the hit.
 *
 * Spread rather than mutated because the hit is the caller's object as far
 * as the caller is concerned; a hit with no row (keyword mode can return
 * scores alone) is returned untouched rather than gaining an empty one.
 */
function snakeHitRow(hit) {
    if (!hit || !hit.row || typeof hit.row !== 'object')
        return hit;
    return { ...hit, row: (0, row_casing_1.snakeRow)(hit.row) };
}
//# sourceMappingURL=search-client.js.map