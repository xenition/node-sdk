"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageClient = void 0;
const form_data_1 = __importDefault(require("form-data"));
const constants_1 = require("../constants");
const DEFAULT_BUCKET = 'default';
/**
 * R2-backed file surface for generated apps. All objects live under the
 * per-app prefix `app/<appId>/<bucket>/<path>`; the xenition backend
 * enforces the prefix — the SDK just passes `bucket` + `path`.
 *
 *   client.storage.upload(buffer, 'avatars/alice.png', { contentType: 'image/png' })
 *   client.storage.download('avatars/alice.png')
 *   client.storage.list({ prefix: 'avatars/' })
 *   client.storage.createSignedUrl('avatars/alice.png', 3600)
 *
 * Buffers are the primary upload input. Strings (filesystem paths) work
 * only in Node — in Workers the SDK has no `fs` access, so the caller
 * must read the file themselves and pass the bytes.
 */
class StorageClient {
    constructor(http) {
        this.http = http;
    }
    async upload(buffer, path, options = {}) {
        if (!Buffer.isBuffer(buffer)) {
            throw new TypeError('StorageClient.upload: expected a Buffer. Read the file first if you have a path.');
        }
        const form = new form_data_1.default();
        form.append('file', buffer, {
            filename: basename(path) || 'file',
            contentType: options.contentType || 'application/octet-stream',
        });
        form.append('path', path);
        form.append('bucket', options.bucket || DEFAULT_BUCKET);
        if (options.metadata) {
            form.append('metadata', JSON.stringify(options.metadata));
        }
        return this.http.postForm(constants_1.API_ENDPOINTS.STORAGE.UPLOAD, form);
    }
    /**
     * Returns a short-lived signed URL the caller can follow to download
     * the bytes. The SDK intentionally does not proxy bytes through the
     * xenition backend — R2's presigned-URL path is cheaper and faster.
     */
    async download(path, opts = {}) {
        const body = {
            bucket: opts.bucket || DEFAULT_BUCKET,
            path,
            operation: 'download',
            expiresInSeconds: opts.expiresInSeconds ?? 3600,
        };
        return this.http.post(constants_1.API_ENDPOINTS.STORAGE.SIGNED_URL, body);
    }
    async delete(path, opts = {}) {
        const bucket = opts.bucket || DEFAULT_BUCKET;
        await this.http.del(constants_1.API_ENDPOINTS.STORAGE.OBJECT(bucket, path));
    }
    async list(options = {}) {
        const params = new URLSearchParams();
        if (options.bucket)
            params.set('bucket', options.bucket);
        if (options.prefix !== undefined)
            params.set('prefix', options.prefix);
        if (options.limit !== undefined)
            params.set('limit', String(options.limit));
        if (options.offset !== undefined)
            params.set('offset', String(options.offset));
        const qs = params.toString();
        const url = qs.length > 0
            ? `${constants_1.API_ENDPOINTS.STORAGE.LIST}?${qs}`
            : constants_1.API_ENDPOINTS.STORAGE.LIST;
        return this.http.get(url);
    }
    async getPublicUrl(path, opts = {}) {
        const bucket = opts.bucket || DEFAULT_BUCKET;
        const file = await this.http.get(constants_1.API_ENDPOINTS.STORAGE.OBJECT(bucket, path));
        return file?.publicUrl ?? null;
    }
    async createSignedUrl(path, expiresInSeconds = 3600, opts = {}) {
        const body = {
            bucket: opts.bucket || DEFAULT_BUCKET,
            path,
            operation: opts.operation ?? 'download',
            expiresInSeconds,
            contentType: opts.contentType,
        };
        return this.http.post(constants_1.API_ENDPOINTS.STORAGE.SIGNED_URL, body);
    }
}
exports.StorageClient = StorageClient;
function basename(p) {
    const clean = p.replace(/\\/g, '/');
    const idx = clean.lastIndexOf('/');
    return idx === -1 ? clean : clean.slice(idx + 1);
}
//# sourceMappingURL=storage-client.js.map