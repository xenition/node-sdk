import { AxiosProgressEvent } from 'axios';
import { HttpClient, RequestOptions } from '../core/http-client';
import { basename, buildMultipart, byteLengthOf, UploadBody } from '../core/multipart';
import { XenitionError } from '../core/errors';
import { API_ENDPOINTS } from '../constants';
import {
  ListFilesOptions,
  ListFilesResult,
  SignedUrlOptions,
  SignedUrlResult,
  StorageFile,
  UploadOptions,
  UploadResult,
} from './types';

const DEFAULT_BUCKET = 'default';

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
export class StorageClient {
  constructor(private readonly http: HttpClient) {}

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
  async upload(
    body: UploadBody,
    path: string,
    options: UploadCallOptions = {},
  ): Promise<UploadResult> {
    if (body === undefined || body === null) {
      throw new TypeError(
        'StorageClient.upload: expected file content (Blob, File, ArrayBuffer, ' +
          'TypedArray, Buffer or string).',
      );
    }
    const form = buildMultipart(
      {
        body,
        filename: basename(path),
        contentType: options.contentType || 'application/octet-stream',
      },
      {
        path,
        bucket: options.bucket || DEFAULT_BUCKET,
        metadata: options.metadata ? JSON.stringify(options.metadata) : undefined,
      },
    );
    return this.http.postForm<UploadResult>(
      API_ENDPOINTS.STORAGE.UPLOAD,
      form,
      this.uploadConfig(body, options),
    );
  }

  /**
   * The per-request config for one upload: cancellation, and a progress
   * adapter attached only when someone asked for progress — handing axios a
   * callback nobody reads makes it compute progress on every chunk for
   * nothing.
   */
  private uploadConfig(
    body: UploadBody,
    options: UploadCallOptions,
  ): RequestOptions | undefined {
    const { onProgress, signal } = options;
    if (!onProgress && !signal) return undefined;
    // Measured once, not per event: `byteLengthOf` walks the body, and the
    // answer cannot change while the upload is in flight.
    const knownLength = onProgress ? byteLengthOf(body) : null;
    return {
      signal,
      onUploadProgress: onProgress
        ? (event: AxiosProgressEvent) => this.report(onProgress, event, knownLength)
        : undefined,
    };
  }

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
  private report(
    onProgress: NonNullable<UploadCallOptions['onProgress']>,
    event: AxiosProgressEvent,
    knownLength: number | null,
  ): void {
    const total =
      typeof event.total === 'number' && event.total > 0 ? event.total : knownLength;
    const loaded = event.loaded ?? 0;
    try {
      onProgress({
        loaded,
        total,
        fraction: total && total > 0 ? Math.min(1, loaded / total) : null,
      });
    } catch {
      // Advisory, like the observability hooks on HttpClient: drawing a
      // progress bar must never become a way to fail an upload that is
      // otherwise going through fine.
    }
  }

  /**
   * A presigned PUT the CLIENT uploads to directly.
   *
   * The path a mobile app should take for recordings, photos and video: the
   * bytes go to storage, never through the app's worker, so a long upload
   * costs no worker time, no CPU budget and no request-size ceiling. Follow
   * it with a call that records where the file landed.
   */
  async createUploadUrl(
    path: string,
    options: { bucket?: string; expiresInSeconds?: number; contentType?: string } = {},
  ): Promise<SignedUrlResult> {
    try {
      return await this.http.post<SignedUrlResult>(API_ENDPOINTS.STORAGE.SIGNED_URL, {
        bucket: options.bucket || DEFAULT_BUCKET,
        path,
        operation: 'upload' as const,
        expiresInSeconds: options.expiresInSeconds ?? 3600,
        contentType: options.contentType,
      });
    } catch (err) {
      // The gateway currently ignores `operation` and looks the path up as
      // if this were a download, so it answers "file not found" — for the
      // one call whose whole purpose is a file that does not exist yet.
      // Passing that through sends the caller hunting for a missing file
      // instead of telling them presigned upload is not usable.
      if (err instanceof XenitionError && err.code === 'NOT_FOUND') {
        throw new XenitionError(
          'NOT_FOUND',
          `StorageClient.createUploadUrl("${path}"): the gateway answered "file not found". ` +
            'It is ignoring operation:"upload" on /app-platform/storage/signed-url and ' +
            'resolving the path as a download, so no upload URL can be issued for a new ' +
            'file. Use upload() to send the bytes through your worker until the gateway ' +
            'honours the operation field. See docs/PLATFORM-ENDPOINTS.md.',
          { status: err.status, details: err.details },
        );
      }
      throw err;
    }
  }

  /**
   * Returns a short-lived signed URL the caller can follow to download
   * the bytes. The SDK intentionally does not proxy bytes through the
   * xenition backend — R2's presigned-URL path is cheaper and faster.
   */
  async download(
    path: string,
    opts: { bucket?: string; expiresInSeconds?: number } = {},
  ): Promise<SignedUrlResult> {
    const body = {
      bucket: opts.bucket || DEFAULT_BUCKET,
      path,
      operation: 'download' as const,
      expiresInSeconds: opts.expiresInSeconds ?? 3600,
    };
    return this.http.post<SignedUrlResult>(
      API_ENDPOINTS.STORAGE.SIGNED_URL,
      body,
    );
  }

  async delete(
    path: string,
    opts: { bucket?: string } = {},
  ): Promise<void> {
    const bucket = opts.bucket || DEFAULT_BUCKET;
    await this.http.del<void>(API_ENDPOINTS.STORAGE.OBJECT(bucket, path));
  }

  async list(options: ListFilesOptions = {}): Promise<ListFilesResult> {
    const params = new URLSearchParams();
    if (options.bucket) params.set('bucket', options.bucket);
    if (options.prefix !== undefined) params.set('prefix', options.prefix);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    const qs = params.toString();
    const url = qs.length > 0
      ? `${API_ENDPOINTS.STORAGE.LIST}?${qs}`
      : API_ENDPOINTS.STORAGE.LIST;
    return this.http.get<ListFilesResult>(url);
  }

  async getPublicUrl(
    path: string,
    opts: { bucket?: string } = {},
  ): Promise<string | null> {
    const bucket = opts.bucket || DEFAULT_BUCKET;
    const file = await this.http.get<StorageFile>(
      API_ENDPOINTS.STORAGE.OBJECT(bucket, path),
    );
    return file?.publicUrl ?? null;
  }

  async createSignedUrl(
    path: string,
    expiresInSeconds: number = 3600,
    opts: Omit<SignedUrlOptions, 'expiresInSeconds'> = {},
  ): Promise<SignedUrlResult> {
    const body = {
      bucket: opts.bucket || DEFAULT_BUCKET,
      path,
      operation: opts.operation ?? 'download',
      expiresInSeconds,
      contentType: opts.contentType,
    };
    return this.http.post<SignedUrlResult>(
      API_ENDPOINTS.STORAGE.SIGNED_URL,
      body,
    );
  }
}

