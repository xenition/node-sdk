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
export type UploadBody = Blob | ArrayBuffer | ArrayBufferView | Uint8Array | string;
/**
 * Wrap file content as a `Blob` with the right content type.
 *
 * A `Buffer` is a `Uint8Array`, so it needs no special case — but it is
 * often a VIEW onto a larger pooled ArrayBuffer, so the underlying buffer
 * must never be handed over whole. Passing the view itself lets Blob respect
 * `byteOffset` and `byteLength`; passing `.buffer` would silently upload
 * whatever else happened to share Node's allocation pool.
 */
export declare function toBlob(body: UploadBody, contentType: string): Blob;
/** Size in bytes when it can be known without consuming the body. */
export declare function byteLengthOf(body: UploadBody): number | null;
/**
 * A Web `FormData` carrying one file plus string fields.
 *
 * Fields with an `undefined` value are omitted rather than sent as the
 * string "undefined", which is what a naive `String(value)` produces and
 * what then lands in a database column.
 */
export declare function buildMultipart(file: {
    body: UploadBody;
    filename: string;
    contentType: string;
}, fields?: Record<string, string | undefined>): FormData;
/** Last path segment, for a default filename. */
export declare function basename(path: string): string;
//# sourceMappingURL=multipart.d.ts.map