import FormData from 'form-data';
import { HttpClient } from '../core/http-client';
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
 * Buffers are the primary upload input. Strings (filesystem paths) work
 * only in Node — in Workers the SDK has no `fs` access, so the caller
 * must read the file themselves and pass the bytes.
 */
export class StorageClient {
  constructor(private readonly http: HttpClient) {}

  async upload(
    buffer: Buffer,
    path: string,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError(
        'StorageClient.upload: expected a Buffer. Read the file first if you have a path.',
      );
    }
    const form = new FormData();
    form.append('file', buffer, {
      filename: basename(path) || 'file',
      contentType: options.contentType || 'application/octet-stream',
    });
    form.append('path', path);
    form.append('bucket', options.bucket || DEFAULT_BUCKET);
    if (options.metadata) {
      form.append('metadata', JSON.stringify(options.metadata));
    }
    return this.http.postForm<UploadResult>(API_ENDPOINTS.STORAGE.UPLOAD, form);
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

function basename(p: string): string {
  const clean = p.replace(/\\/g, '/');
  const idx = clean.lastIndexOf('/');
  return idx === -1 ? clean : clean.slice(idx + 1);
}
