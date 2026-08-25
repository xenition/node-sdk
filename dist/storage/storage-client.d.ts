import { HttpClient } from '../core/http-client';
import { UploadBody } from '../core/multipart';
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
 * Upload input is anything the runtime holds — Blob, File, ArrayBuffer,
 * typed array, Buffer or string. The SDK has no `fs` access in a Worker, so
 * a filesystem path must be read by the caller first.
 */
export declare class StorageClient {
    private readonly http;
    constructor(http: HttpClient);
    /**
     * Upload bytes.
     *
     * Accepts whatever the runtime happens to hold: a `File` a worker just
     * received, a `Blob`, an `ArrayBuffer` or typed array from a fetch, a
     * Node `Buffer`, or a plain string. Previously this demanded a Buffer,
     * which forced every one of those through a conversion the SDK can do
     * itself — and which only worked in a Worker at all because
     * `nodejs_compat` shims Buffer.
     *
     * For anything large, prefer `createUploadUrl()`: it sends the bytes
     * straight to storage instead of through the app's worker.
     */
    upload(body: UploadBody, path: string, options?: UploadOptions): Promise<UploadResult>;
    /**
     * A presigned PUT the CLIENT uploads to directly.
     *
     * The path a mobile app should take for recordings, photos and video: the
     * bytes go to storage, never through the app's worker, so a long upload
     * costs no worker time, no CPU budget and no request-size ceiling. Follow
     * it with a call that records where the file landed.
     */
    createUploadUrl(path: string, options?: {
        bucket?: string;
        expiresInSeconds?: number;
        contentType?: string;
    }): Promise<SignedUrlResult>;
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