"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VectorClient = void 0;
const constants_1 = require("../constants");
/**
 * Qdrant-backed vector store. Per-app collections namespaced
 * `vec_<appId>_<name>` on the server — the SDK passes the short name.
 *
 *   await client.vector.createCollection({ name: 'docs', vectorSize: 1536 })
 *   await client.vector.upsert('docs', [{ id: 'x1', vector: [...], payload: {...} }])
 *   const hits = await client.vector.search('docs', queryVector, { limit: 10 })
 */
class VectorClient {
    constructor(http) {
        this.http = http;
    }
    listCollections() {
        return this.http.get(constants_1.API_ENDPOINTS.VECTOR.COLLECTIONS);
    }
    createCollection(input) {
        return this.http.post(constants_1.API_ENDPOINTS.VECTOR.COLLECTIONS, input);
    }
    getCollection(name) {
        return this.http.get(constants_1.API_ENDPOINTS.VECTOR.COLLECTION(name));
    }
    async deleteCollection(name) {
        await this.http.del(constants_1.API_ENDPOINTS.VECTOR.COLLECTION(name));
    }
    upsert(collection, vectors) {
        return this.http.post(constants_1.API_ENDPOINTS.VECTOR.UPSERT(collection), { vectors });
    }
    search(collection, vector, options = {}) {
        return this.http.post(constants_1.API_ENDPOINTS.VECTOR.SEARCH(collection), { vector, ...options });
    }
    async deleteMany(collection, ids) {
        await this.http.post(constants_1.API_ENDPOINTS.VECTOR.DELETE_POINTS(collection), { ids });
    }
}
exports.VectorClient = VectorClient;
//# sourceMappingURL=vector-client.js.map