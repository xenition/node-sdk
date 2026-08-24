import { HttpClient } from '../core/http-client';
import { basename, buildMultipart, UploadBody } from '../core/multipart';
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
   */
  async upload(
    body: UploadBody,
    path: string,
    options: UploadOptions = {},
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
    return this.http.postForm<UploadResult>(API_ENDPOINTS.STORAGE.UPLOAD, form);
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
    return this.http.post<SignedUrlResult>(API_ENDPOINTS.STORAGE.SIGNED_URL, {
      bucket: options.bucket || DEFAULT_BUCKET,
      path,
      operation: 'upload' as const,
      expiresInSeconds: options.expiresInSeconds ?? 3600,
      contentType: options.contentType,
    });
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

