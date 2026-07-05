export type VectorDistance = 'cosine' | 'euclid' | 'dot';
export interface VectorDocument {
    id: string;
    vector: number[];
    payload?: Record<string, unknown>;
}
export interface VectorSearchResult {
    id: string;
    score: number;
    payload?: Record<string, unknown>;
}
export interface VectorCollectionInfo {
    name: string;
    vectorSize: number;
    distance: VectorDistance;
    points: number;
    status: string;
}
export interface CreateCollectionInput {
    name: string;
    vectorSize: number;
    distance?: VectorDistance;
}
export interface SearchOptions {
    limit?: number;
    filter?: Record<string, unknown>;
    threshold?: number;
}
//# sourceMappingURL=types.d.ts.map