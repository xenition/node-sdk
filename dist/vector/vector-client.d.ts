import { HttpClient } from '../core/http-client';
import { CreateCollectionInput, SearchOptions, VectorCollectionInfo, VectorDocument, VectorSearchResult } from './types';
/**
 * Qdrant-backed vector store. Per-app collections namespaced
 * `vec_<appId>_<name>` on the server — the SDK passes the short name.
 *
 *   await client.vector.createCollection({ name: 'docs', vectorSize: 1536 })
 *   await client.vector.upsert('docs', [{ id: 'x1', vector: [...], payload: {...} }])
 *   const hits = await client.vector.search('docs', queryVector, { limit: 10 })
 */
export declare class VectorClient {
    private readonly http;
    constructor(http: HttpClient);
    listCollections(): Promise<string[]>;
    createCollection(input: CreateCollectionInput): Promise<VectorCollectionInfo | null>;
    getCollection(name: string): Promise<VectorCollectionInfo | null>;
    deleteCollection(name: string): Promise<void>;
    upsert(collection: string, vectors: VectorDocument[]): Promise<{
        inserted: number;
    }>;
    search(collection: string, vector: number[], options?: SearchOptions): Promise<VectorSearchResult[]>;
    deleteMany(collection: string, ids: string[]): Promise<void>;
}
//# sourceMappingURL=vector-client.d.ts.map