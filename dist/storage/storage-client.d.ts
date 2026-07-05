import { HttpClient } from '../core/http-client';
import { ListFilesOptions, ListFilesResult, SignedUrlOptions, SignedUrlResult, UploadOptions, UploadResult } from './types';
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
export declare class StorageClient {
    private readonly http;
    constructor(http: HttpClient);
    upload(buffer: Buffer, path: string, options?: UploadOptions): Promise<UploadResult>;
    /**
     * Returns a short-lived signed URL the caller can follow to download
     * the bytes. The SDK intentionally does not proxy bytes through the
     * xenition backend — R2's presigned-URL path is cheaper and faster.
     */
    download(path: string, opts?: {
        bucket?: string;
        expiresInSeconds?: number;
    }): Promise<SignedUrlResult>;
    delete(path: string, opts?: {
        bucket?: string;
    }): Promise<void>;
    list(options?: ListFilesOptions): Promise<ListFilesResult>;
    getPublicUrl(path: string, opts?: {
        bucket?: string;
    }): Promise<string | null>;
    createSignedUrl(path: string, expiresInSeconds?: number, opts?: Omit<SignedUrlOptions, 'expiresInSeconds'>): Promise<SignedUrlResult>;
}
//# sourceMappingURL=storage-client.d.ts.map