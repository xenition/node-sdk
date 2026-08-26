/**
 * The gateway does not speak one error dialect.
 *
 * Some routes answer with the SDK's own envelope:
 *
 *   { success: false, error: { code: 'CONFLICT', message: 'already exists' } }
 *
 * Others — anything served straight by the Nest layer — answer flat:
 *
 *   { statusCode: 409, error: 'Conflict', message: 'an account with this
 *     email already exists', path: '/v1/...', timestamp: '...' }
 *
 * Reading only the first shape is why `auth.register()` on a duplicate
 * email used to throw "Request failed with status code 409" while the
 * server had plainly said "an account with this email already exists".
 * A sign-up screen has nothing useful to show the user from that, and the
 * real sentence was two levels down in `error.details`, where nobody
 * looks.
 *
 * `message` is sometimes an array — Nest's validation pipe returns one
 * line per failed field — so it is joined rather than stringified into
 * "[object Object]".
 */
/** Either envelope shape, plus room for the fields neither documents. */
export interface ErrorEnvelope {
    success?: boolean;
    /** Nested shape: an object. Flat shape: a status label like 'Conflict'. */
    error?: {
        code?: string;
        message?: string;
    } | string;
    /** Flat shape only. A string, or one line per failed field. */
    message?: string | string[];
    statusCode?: number;
    path?: string;
    timestamp?: string;
}
/**
 * The most specific human-readable sentence the server offered, or
 * undefined when it offered none — the caller then keeps its own fallback.
 */
export declare function messageFromEnvelope(envelope: unknown): string | undefined;
/**
 * The server's own error code, when it sent a real one.
 *
 * Only the nested shape carries a code. The flat shape's `error` is a
 * status label — 'Conflict', 'Not Found' — which reads like a code but is
 * not one, so it is deliberately ignored and the HTTP status classifies
 * the error instead.
 */
export declare function codeFromEnvelope(envelope: unknown): string | undefined;
//# sourceMappingURL=error-envelope.d.ts.map