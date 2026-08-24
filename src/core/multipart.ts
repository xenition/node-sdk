/**
 * Building multipart bodies without `form-data`.
 *
 * The node `form-data` package is stream-based and Buffer-based, which made
 * upload the least portable call in the SDK: a Cloudflare Worker has Web
 * `FormData`, `Blob` and `File`, and only has `Buffer` at all because
 * `nodejs_compat` shims it. Web `FormData` exists in both runtimes (Node 18+
 * and Workers), so one implementation serves both and the dependency goes.
 *
 * It also widens what a caller may pass. A worker that just received an
 * upload holds a `File`; one that fetched a remote asset holds a
 * `ReadableStream` or an `ArrayBuffer`; a Node script holds a `Buffer`.
 * Demanding a Buffer forced every one of those through a conversion the SDK
 * could do itself.
 */

/** Anything the SDK will accept as file content. */
export type UploadBody =
  | Blob
  | ArrayBuffer
  | ArrayBufferView
  | Uint8Array
  | string;

/** Node's Buffer, without requiring @types/node in the browser build. */
interface BufferLike extends Uint8Array {
  readonly byteOffset: number;
}

function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value as ArrayBufferView);
}

/**
 * Wrap file content as a `Blob` with the right content type.
 *
 * A `Buffer` is a `Uint8Array`, so it needs no special case — but it is
 * often a VIEW onto a larger pooled ArrayBuffer, so the underlying buffer
 * must never be handed over whole. Passing the view itself lets Blob respect
 * `byteOffset` and `byteLength`; passing `.buffer` would silently upload
 * whatever else happened to share Node's allocation pool.
 */
export function toBlob(body: UploadBody, contentType: string): Blob {
  if (typeof Blob !== 'function') {
    throw new TypeError(
      'This runtime has no Blob. Node 18+ and Cloudflare Workers both provide one.',
    );
  }
  if (body instanceof Blob) return body.type ? body : new Blob([body], { type: contentType });
  if (typeof body === 'string') return new Blob([body], { type: contentType });
  if (isArrayBufferView(body)) {
    const view = body as BufferLike;
    // Copy into a fresh, exactly-sized buffer rather than slicing the
    // backing one. `.buffer` may be a SharedArrayBuffer, and Blob will not
    // take one — and a Node Buffer's backing store is a shared pool, so
    // handing it over whole would upload unrelated memory.
    const bytes = new Uint8Array(view.byteLength);
    bytes.set(new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength));
    return new Blob([bytes], { type: contentType });
  }
  if (body instanceof ArrayBuffer) return new Blob([body], { type: contentType });
  throw new TypeError(
    'Unsupported upload body. Pass a Blob, File, ArrayBuffer, TypedArray, Buffer or string.',
  );
}

/** Size in bytes when it can be known without consuming the body. */
export function byteLengthOf(body: UploadBody): number | null {
  if (typeof Blob === 'function' && body instanceof Blob) return body.size;
  if (isArrayBufferView(body)) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength;
  return null;
}

/**
 * A Web `FormData` carrying one file plus string fields.
 *
 * Fields with an `undefined` value are omitted rather than sent as the
 * string "undefined", which is what a naive `String(value)` produces and
 * what then lands in a database column.
 */
export function buildMultipart(
  file: { body: UploadBody; filename: string; contentType: string },
  fields: Record<string, string | undefined> = {},
): FormData {
  if (typeof FormData !== 'function') {
    throw new TypeError(
      'This runtime has no FormData. Node 18+ and Cloudflare Workers both provide one.',
    );
  }
  const form = new FormData();
  form.append('file', toBlob(file.body, file.contentType), file.filename);
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) form.append(key, value);
  }
  return form;
}

/** Last path segment, for a default filename. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || 'file';
}
