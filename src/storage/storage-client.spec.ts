import { AxiosProgressEvent } from 'axios';
import { StorageClient, UploadProgress } from './storage-client';
import { RequestOptions } from '../core/http-client';
import { XenitionError } from '../core/errors';

describe('createUploadUrl — presigned PUT', () => {
  /**
   * Older gateways looked the path up as a download and 404'd "file not
   * found" for every new file; a disk-backed gateway answers 501. Either way
   * the caller needs to hear that upload URLs are unavailable, not go looking
   * for a missing file.
   */
  it('replaces an old gateway 404 with what actually went wrong', async () => {
    const post = jest.fn().mockRejectedValue(
      new XenitionError('NOT_FOUND', 'file not found', { status: 404 }),
    );
    const storage = new StorageClient({ post } as never);
    await expect(storage.createUploadUrl('lab/new.m4a')).rejects.toThrow(/cannot issue upload URLs/);
    await expect(storage.createUploadUrl('lab/new.m4a')).rejects.toThrow(/lab\/new\.m4a/);
  });

  it('explains a store that cannot presign', async () => {
    const post = jest.fn().mockRejectedValue(
      new XenitionError('NOT_IMPLEMENTED', 'cannot presign', { status: 501 }),
    );
    const storage = new StorageClient({ post } as never);
    await expect(storage.createUploadUrl('a.mp4')).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('sends the content type and the size to sign into the URL', async () => {
    const post = jest.fn().mockResolvedValue({});
    const storage = new StorageClient({ post } as never);
    await storage.createUploadUrl('videos/intro.mp4', { bucket: 'media', contentType: 'video/mp4', sizeBytes: 1234 });
    expect(post).toHaveBeenCalledWith('/app-platform/storage/signed-url', {
      bucket: 'media', path: 'videos/intro.mp4', operation: 'upload',
      expiresInSeconds: 3600, contentType: 'video/mp4', sizeBytes: 1234,
    });
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

/**
 * Upload progress. An app cannot draw a progress bar for a call that says
 * nothing until it is over — but it must not draw a fake one either.
 */
describe('upload progress', () => {
  /** A hundred bytes, so the numbers in these tests are checkable by eye. */
  const BODY = 'x'.repeat(100);

  /**
   * A fake HttpClient that keeps the request config `upload()` built, so a
   * test can drive the progress callback the way a transport would.
   */
  const harness = () => {
    const postForm = jest.fn().mockResolvedValue({ id: 'f_1' });
    const storage = new StorageClient({ postForm } as never);
    const config = () => postForm.mock.calls[0]?.[2] as RequestOptions | undefined;
    const emit = (event: Partial<AxiosProgressEvent>) =>
      config()?.onUploadProgress?.(event as AxiosProgressEvent);
    return { storage, postForm, config, emit };
  };

  it('reports bytes sent, the total and the fraction between them', async () => {
    const seen: UploadProgress[] = [];
    const { storage, emit } = harness();
    await storage.upload(BODY, 'clips/take.m4a', { onProgress: (p) => seen.push(p) });

    emit({ loaded: 25, total: 100 });
    emit({ loaded: 100, total: 100 });
    expect(seen).toEqual([
      { loaded: 25, total: 100, fraction: 0.25 },
      { loaded: 100, total: 100, fraction: 1 },
    ]);
  });

  it('falls back to the size of the body when the transport reports no total', async () => {
    // The one number we can know without asking the transport anything.
    const seen: UploadProgress[] = [];
    const { storage, emit } = harness();
    await storage.upload(BODY, 'clips/take.m4a', { onProgress: (p) => seen.push(p) });

    emit({ loaded: 50 });
    expect(seen).toEqual([{ loaded: 50, total: 100, fraction: 0.5 }]);
  });

  it('clamps the fraction at 1 rather than reporting more than 100%', async () => {
    // The fallback total is the payload, which does not include the
    // multipart boundaries and headers also going down the wire.
    const seen: UploadProgress[] = [];
    const { storage, emit } = harness();
    await storage.upload(BODY, 'clips/take.m4a', { onProgress: (p) => seen.push(p) });

    emit({ loaded: 340 });
    expect(seen[0]?.fraction).toBe(1);
  });

  it('invents no progress when the runtime reports none, as a Worker does not', async () => {
    // A bar that sits at 0 and then jumps to 100 is a lie about what has
    // been sent; an honest silence lets the caller show a spinner instead.
    const onProgress = jest.fn();
    const { storage } = harness();
    await storage.upload(BODY, 'clips/take.m4a', { onProgress });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('attaches nothing to the request when the caller did not ask for progress', async () => {
    const { storage, config } = harness();
    await storage.upload(BODY, 'clips/take.m4a');
    expect(config()).toBeUndefined();
  });

  it('a throwing progress callback never fails the upload', async () => {
    const { storage, emit } = harness();
    await expect(
      storage.upload(BODY, 'clips/take.m4a', {
        onProgress: () => {
          throw new Error('bad progress bar');
        },
      }),
    ).resolves.toEqual({ id: 'f_1' });
    expect(() => emit({ loaded: 10, total: 100 })).not.toThrow();
  });

  it('forwards an abort signal, so a long upload can be given up on', async () => {
    const controller = new AbortController();
    const { storage, config } = harness();
    await storage.upload(BODY, 'clips/take.m4a', { signal: controller.signal });
    expect(config()?.signal).toBe(controller.signal);
  });
});
