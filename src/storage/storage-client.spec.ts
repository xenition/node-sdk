import { StorageClient } from './storage-client';
import { XenitionError } from '../core/errors';

describe('createUploadUrl — the gateway ignores operation:"upload"', () => {
  /**
   * Probed directly against api-dev: /storage/signed-url returns the same
   * download URL for operation:"upload" as for "download", and 404s
   * "file not found" for a path that does not exist yet — which is every
   * upload. Passing "file not found" through sends the caller looking for
   * a missing file instead of telling them the feature is unusable.
   */
  it('replaces the gateway 404 with what actually went wrong', async () => {
    const post = jest.fn().mockRejectedValue(
      new XenitionError('NOT_FOUND', 'file not found', { status: 404 }),
    );
    const storage = new StorageClient({ post } as never);
    await expect(storage.createUploadUrl('lab/new.m4a')).rejects.toThrow(
      /ignoring operation:"upload"/,
    );
    await expect(storage.createUploadUrl('lab/new.m4a')).rejects.toThrow(/lab\/new\.m4a/);
  });

  it('leaves every other error alone', async () => {
    const post = jest.fn().mockRejectedValue(
      new XenitionError('AUTH_FORBIDDEN', 'nope', { status: 403 }),
    );
    const storage = new StorageClient({ post } as never);
    await expect(storage.createUploadUrl('lab/new.m4a')).rejects.toThrow('nope');
  });

  it('passes a successful response straight through', async () => {
    const signed = { url: 'https://upload.example/put', expiresAt: '2026-01-01T00:00:00Z' };
    const post = jest.fn().mockResolvedValue(signed);
    const storage = new StorageClient({ post } as never);
    await expect(storage.createUploadUrl('lab/new.m4a')).resolves.toEqual(signed);
  });
});
