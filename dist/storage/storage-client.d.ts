import { HttpClient } from '../core/http-client';
import { UploadBody } from '../core/multipart';
import { ListFilesOptions, ListFilesResult, SignedUrlOptions, SignedUrlResult, UploadOptions, UploadResult } from './types';
/** One report of how much of an upload has left the process so far. */
export interface UploadProgress {
    /** Bytes handed to the transport. */
    loaded: number;
    /**
     * Total bytes to send, or null when neither the transport nor the body
     * itself could say — a stream, for instance, has no length until it ends.
     */
    total: number | null;
    /** `loaded / total`, 0..1, or null when the total is unknown. */
    fraction: number | null;
}
/** `upload()` options: the wire fields plus this call's own concerns. */
export interface UploadCallOptions extends UploadOptions {
    /**
     * Called as bytes leave, so an app can draw a progress bar.
     *
     * NOT guaranteed to fire. Upload progress comes from the runtime's HTTP
     * stack, and a Cloudflare Worker's fetch reports nothing until the
     * request is finished — so in a Worker this callback may never be called
     * even though the upload is proceeding normally. The SDK does not paper
     * over that with a synthetic 0% and 100%: a bar that sits still and then
     * jumps is a lie about what has actually been sent, and it is worse than
     * an honest indeterminate spinner, which is what a caller should show
     * until the first real event arrives.
     */
    onProgress?(progress: UploadProgress): void;
    /**
     * Abort the upload. An upload is the call most worth cancelling — it is
     * the longest one an app makes, and the one a user is most likely to
     * change their mind about halfway through.
     */
    signal?: AbortSignal;
}
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
     *
     * Pass `onProgress` to drive a progress bar — read its doc first, it does
     * not fire in every runtime.
     */
    upload(body: UploadBody, path: string, options?: UploadCallOptions): Promise<UploadResult>;
    /**
     * The per-request config for one upload: cancellation, and a progress
     * adapter attached only when someone asked for progress — handing axios a
     * callback nobody reads makes it compute progress on every chunk for
     * nothing.
     */
    private uploadConfig;
    /**
     * Normalize one axios progress event into `UploadProgress`.
     *
     * `event.total` is missing whenever the transport could not work out a
     * content length, so we fall back to the size of the bytes we were handed
     * — the one number we know without asking anyone. That total omits the
     * multipart framing (a few hundred bytes of boundaries and headers), so
     * `loaded` can overshoot it near the end; the fraction is clamped rather
     * than allowed to report 103% at a progress bar.
     */
    private report;
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