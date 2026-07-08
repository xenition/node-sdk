"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchClient = void 0;
const constants_1 = require("../constants");
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
    unifiedSearch(table, query, options = {}) {
        return this.http.post(constants_1.API_ENDPOINTS.SEARCH.UNIFIED, {
            table,
            query,
            ...options,
        });
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
//# sourceMappingURL=search-client.js.map