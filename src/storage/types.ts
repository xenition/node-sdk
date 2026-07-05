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
