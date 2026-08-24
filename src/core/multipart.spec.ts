import { basename, buildMultipart, byteLengthOf, toBlob } from './multipart';

/**
 * The point of this module is that an upload works with whatever the
 * runtime happens to hold, so most of these tests are "does this shape go
 * through". The Buffer case has a real hazard behind it and gets its own.
 */
describe('toBlob', () => {
  it('accepts a string', async () => {
    const blob = toBlob('hello', 'text/plain');
    expect(await blob.text()).toBe('hello');
    expect(blob.type).toBe('text/plain');
  });

  it('accepts an ArrayBuffer and a typed array', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(toBlob(bytes, 'application/octet-stream').size).toBe(3);
    expect(toBlob(bytes.buffer, 'application/octet-stream').size).toBe(3);
  });

  it('accepts a Node Buffer', async () => {
    const blob = toBlob(Buffer.from('hi'), 'text/plain');
    expect(await blob.text()).toBe('hi');
  });

  it('uploads only the view, never the pool behind it', async () => {
    // A Node Buffer is usually a window onto a larger shared allocation.
    // Handing over `.buffer` would upload whatever else lives in that pool —
    // other requests' data, in a busy process.
    const pool = Buffer.alloc(64, 0x41); // 'A' × 64
    const view = pool.subarray(8, 13); // 5 bytes
    const blob = toBlob(view, 'application/octet-stream');
    expect(blob.size).toBe(5);
    expect(await blob.text()).toBe('AAAAA');
  });

  it('keeps a Blob that already has a type', async () => {
    const original = new Blob(['x'], { type: 'image/png' });
    expect(toBlob(original, 'application/octet-stream').type).toBe('image/png');
  });

  it('gives an untyped Blob the declared content type', () => {
    expect(toBlob(new Blob(['x']), 'image/webp').type).toBe('image/webp');
  });

  it('rejects something that is not file content', () => {
    expect(() => toBlob({ nope: true } as never, 'text/plain')).toThrow(/Unsupported upload body/);
  });
});

describe('buildMultipart', () => {
  it('sends the file under `file` with its filename', () => {
    const form = buildMultipart({
      body: 'data',
      filename: 'alice.png',
      contentType: 'image/png',
    });
    const file = form.get('file') as File;
    expect(file.name).toBe('alice.png');
    expect(file.type).toBe('image/png');
  });

  it('includes string fields', () => {
    const form = buildMultipart(
      { body: 'x', filename: 'f', contentType: 'text/plain' },
      { path: 'avatars/a.png', bucket: 'default' },
    );
    expect(form.get('path')).toBe('avatars/a.png');
    expect(form.get('bucket')).toBe('default');
  });

  it('omits an undefined field rather than sending the string "undefined"', () => {
    // Which is what String(value) produces, and what then lands in a column.
    const form = buildMultipart(
      { body: 'x', filename: 'f', contentType: 'text/plain' },
      { metadata: undefined },
    );
    expect(form.has('metadata')).toBe(false);
  });
});

describe('byteLengthOf', () => {
  it('measures what it can without consuming', () => {
    expect(byteLengthOf('abc')).toBe(3);
    expect(byteLengthOf(new Uint8Array(7))).toBe(7);
    expect(byteLengthOf(new ArrayBuffer(4))).toBe(4);
    expect(byteLengthOf(new Blob(['12345']))).toBe(5);
  });

  it('counts bytes rather than characters', () => {
    expect(byteLengthOf('é')).toBe(2);
  });
});

describe('basename', () => {
  it('takes the last segment of either separator', () => {
    expect(basename('avatars/alice.png')).toBe('alice.png');
    expect(basename('avatars\\alice.png')).toBe('alice.png');
    expect(basename('alice.png')).toBe('alice.png');
  });

  it('falls back rather than returning an empty filename', () => {
    expect(basename('avatars/')).toBe('file');
    expect(basename('')).toBe('file');
  });
});
