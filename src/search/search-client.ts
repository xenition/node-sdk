import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';
import {
  ConfigureSearchInput,
  SearchConfig,
  UnifiedSearchOptions,
  UnifiedSearchResult,
} from './types';

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
export class SearchClient {
  constructor(private readonly http: HttpClient) {}

  unifiedSearch(
    table: string,
    query: string,
    options: UnifiedSearchOptions = {},
  ): Promise<UnifiedSearchResult> {
    return this.http.post<UnifiedSearchResult>(API_ENDPOINTS.SEARCH.UNIFIED, {
      table,
      query,
      ...options,
    });
  }

  configureSearch(
    table: string,
    input: ConfigureSearchInput,
  ): Promise<SearchConfig> {
    return this.http.post<SearchConfig>(API_ENDPOINTS.SEARCH.CONFIGURE, {
      table,
      ...input,
    });
  }

  listConfigs(): Promise<SearchConfig[]> {
    return this.http.get<SearchConfig[]>(API_ENDPOINTS.SEARCH.CONFIGS);
  }

  indexDocument(
    table: string,
    recordId: string,
    content?: string,
  ): Promise<{ indexed: boolean }> {
    return this.http.post<{ indexed: boolean }>(API_ENDPOINTS.SEARCH.INDEX, {
      table,
      recordId,
      content,
    });
  }

  bulkIndex(
    table: string,
    options: { columns?: string[]; reindex?: boolean } = {},
  ): Promise<{ indexed: number }> {
    return this.http.post<{ indexed: number }>(
      API_ENDPOINTS.SEARCH.BULK_INDEX,
      { table, ...options },
    );
  }
}
