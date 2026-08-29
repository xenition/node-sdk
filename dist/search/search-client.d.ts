import { HttpClient } from '../core/http-client';
import { ConfigureSearchInput, SearchConfig, UnifiedSearchOptions, UnifiedSearchResult } from './types';
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
export declare class SearchClient {
    private readonly http;
    constructor(http: HttpClient);
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
    unifiedSearch(table: string, query: string, options?: UnifiedSearchOptions): Promise<UnifiedSearchResult>;
    configureSearch(table: string, input: ConfigureSearchInput): Promise<SearchConfig>;
    listConfigs(): Promise<SearchConfig[]>;
    indexDocument(table: string, recordId: string, content?: string): Promise<{
        indexed: boolean;
    }>;
    bulkIndex(table: string, options?: {
        columns?: string[];
        reindex?: boolean;
    }): Promise<{
        indexed: number;
    }>;
}
//# sourceMappingURL=search-client.d.ts.map