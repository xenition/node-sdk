"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageFromEnvelope = messageFromEnvelope;
exports.codeFromEnvelope = codeFromEnvelope;
/**
 * The most specific human-readable sentence the server offered, or
 * undefined when it offered none — the caller then keeps its own fallback.
 */
function messageFromEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object')
        return undefined;
    const env = envelope;
    // Nested shape wins: it is the one the SDK's own routers emit, and its
    // message is written for a caller rather than for a log.
    if (env.error && typeof env.error === 'object') {
        const nested = env.error.message;
        if (typeof nested === 'string' && nested.trim() !== '')
            return nested;
    }
    if (Array.isArray(env.message)) {
        const lines = env.message.filter((m) => typeof m === 'string' && m.trim() !== '');
        if (lines.length)
            return lines.join('; ');
    }
    if (typeof env.message === 'string' && env.message.trim() !== '')
        return env.message;
    return undefined;
}
/**
 * The server's own error code, when it sent a real one.
 *
 * Only the nested shape carries a code. The flat shape's `error` is a
 * status label — 'Conflict', 'Not Found' — which reads like a code but is
 * not one, so it is deliberately ignored and the HTTP status classifies
 * the error instead.
 */
function codeFromEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object')
        return undefined;
    const env = envelope;
    if (env.error && typeof env.error === 'object')
        return env.error.code;
    return undefined;
}
//# sourceMappingURL=error-envelope.js.map