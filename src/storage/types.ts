/**
 * Wire contract for the storage module. These shapes round-trip through
 * `/app-platform/storage/*`; keep in sync with the xenition backend's
 * `modules/app-platform-storage/` types.
 */

export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, unknown>;
  /** Defaults to `default`. */
  bucket?: string;
}

export interface StorageFile {
  id: string;
  bucket: string;
  path: string;
  size: number;
  contentType: string;
  publicUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UploadResult extends StorageFile {
  /** Pre-resolved public/CDN URL if the bucket is public, else null. */
  url: string | null;
}

export interface SignedUrlResult {
  url: string;
  expiresAt: string;
}

/** A presigned PUT from `createUploadUrl()`. */
export interface UploadUrlResult extends SignedUrlResult {
  method: 'PUT';
  /**
   * Headers the PUT must carry exactly — the URL is signed over them, so a
   * different Content-Type (or Content-Length, when `sizeBytes` was given)
   * is rejected by storage.
   */
  headers: Record<string, string>;
  bucket: string;
  path: string;
  /** Where the file is served once the PUT lands. */
  publicUrl: string;
}

export interface CreateUploadUrlOptions {
  bucket?: string;
  /** Seconds the URL stays valid. Default 3600, at most 86400. */
  expiresInSeconds?: number;
  contentType?: string;
  /** The exact size to be uploaded. Signed into the URL, so nothing larger can be stored with it. */
  sizeBytes?: number;
}

export interface ListFilesOptions {
  bucket?: string;
  prefix?: string;
  limit?: number;
  offset?: number;
}

export interface ListFilesResult {
  files: StorageFile[];
  total: number;
  bucket: string;
  prefix: string;
}

export interface SignedUrlOptions {
  bucket?: string;
  /** Seconds until the URL expires. Default 3600. */
  expiresInSeconds?: number;
  /** `download` issues a presigned GET; `upload` issues a presigned PUT. */
  operation?: 'download' | 'upload';
  contentType?: string;
}
