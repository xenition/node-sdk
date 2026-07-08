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