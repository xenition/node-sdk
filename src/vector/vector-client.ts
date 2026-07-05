import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';
import {
  CreateCollectionInput,
  SearchOptions,
  VectorCollectionInfo,
  VectorDocument,
  VectorSearchResult,
} from './types';

/**
 * Qdrant-backed vector store. Per-app collections namespaced
 * `vec_<appId>_<name>` on the server — the SDK passes the short name.
 *
 *   await client.vector.createCollection({ name: 'docs', vectorSize: 1536 })
 *   await client.vector.upsert('docs', [{ id: 'x1', vector: [...], payload: {...} }])
 *   const hits = await client.vector.search('docs', queryVector, { limit: 10 })
 */
export class VectorClient {
  constructor(private readonly http: HttpClient) {}

  listCollections(): Promise<string[]> {
    return this.http.get<string[]>(API_ENDPOINTS.VECTOR.COLLECTIONS);
  }

  createCollection(input: CreateCollectionInput): Promise<VectorCollectionInfo | null> {
    return this.http.post<VectorCollectionInfo | null>(
      API_ENDPOINTS.VECTOR.COLLECTIONS,
      input,
    );
  }

  getCollection(name: string): Promise<VectorCollectionInfo | null> {
    return this.http.get<VectorCollectionInfo | null>(
      API_ENDPOINTS.VECTOR.COLLECTION(name),
    );
  }

  async deleteCollection(name: string): Promise<void> {
    await this.http.del<void>(API_ENDPOINTS.VECTOR.COLLECTION(name));
  }

  upsert(collection: string, vectors: VectorDocument[]): Promise<{ inserted: number }> {
    return this.http.post<{ inserted: number }>(
      API_ENDPOINTS.VECTOR.UPSERT(collection),
      { vectors },
    );
  }

  search(
    collection: string,
    vector: number[],
    options: SearchOptions = {},
  ): Promise<VectorSearchResult[]> {
    return this.http.post<VectorSearchResult[]>(
      API_ENDPOINTS.VECTOR.SEARCH(collection),
      { vector, ...options },
    );
  }

  async deleteMany(collection: string, ids: string[]): Promise<void> {
    await this.http.post<void>(
      API_ENDPOINTS.VECTOR.DELETE_POINTS(collection),
      { ids },
    );
  }
}
