import { AiProvider } from '../ai/types';

export interface SearchConfig {
  id: string;
  tableName: string;
  fullTextColumns: string[];
  semanticColumns: string[];
  vectorDimension: number;
  embeddingModel: string;
  embeddingProvider: AiProvider;
  createdAt: string;
  updatedAt: string;
}

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export interface SearchHit {
  id: string;
  score: number;
  table: string;
  row?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  highlight?: Record<string, string>;
}

export interface UnifiedSearchResult {
  hits: SearchHit[];
  mode: SearchMode;
  total: number;
}

export interface UnifiedSearchOptions {
  mode?: SearchMode;
  columns?: string[];
  limit?: number;
  filters?: Record<string, unknown>;
  highlight?: boolean;
  threshold?: number;
}

export interface ConfigureSearchInput {
  fullTextColumns: string[];
  semanticColumns?: string[];
  vectorDimension?: number;
  embeddingModel?: string;
  embeddingProvider?: AiProvider;
}
