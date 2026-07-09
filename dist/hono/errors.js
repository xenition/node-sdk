"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrubMessage = scrubMessage;
exports.honoErrorHandler = honoErrorHandler;
exports.jsonNotFound = jsonNotFound;
exports.badRequest = badRequest;
const errors_1 = require("../core/errors");
const client_1 = require("./client");
const GENERIC_UPSTREAM = 'Upstream request failed.';
const GENERIC_INTERNAL = 'Internal error.';
/** Belt-and-braces: strip anything key- or URL-shaped from 4xx messages. */
function scrubMessage(message) {
    return message
        .replace(/xen_(?:service|anon)_[A-Za-z0-9]+/g, '[redacted]')
        .replace(/https?:\/\/[^\s"')]+/gi, '[redacted]');
}
function statusForCode(code) {
    switch (code) {
        case 'VALIDATION_ERROR':
            return 400;
        case 'NOT_FOUND':
            return 404;
        case 'CONFLICT':
            return 409;
        case 'RATE_LIMITED':
            return 429;
        case 'TIMEOUT':
            return 504;
        case 'NETWORK_ERROR':
        case 'SERVER_ERROR':
            return 502;
        default:
            // AUTH_* here means the worker's own service key was rejected —
            // an upstream/config problem, not the browser caller's fault.
            return code.startsWith('AUTH_') ? 502 : 500;
    }
}
/**
 * Plain `Error`s thrown by the module clients' own validation
 * (`fail(context, …)` → "FormsClient.submit: …"). These are client-input
 * problems, not bugs, so they become 400s — except "unknown form/
 * collection", which is a 404.
 */
const SDK_VALIDATION_RE = /^[A-Z][A-Za-z]*Client\.[A-Za-z]+: /;
const SDK_NOT_FOUND_RE = /unknown (form|collection|event|resource|cart|order) /;
function errorBody(code, message) {
    return { error: { code, message } };
}
/** Shared `app.onError` handler — see module doc for the mapping rules. */
function honoErrorHandler(err, c) {
    if (err instanceof errors_1.XenitionError) {
        const status = statusForCode(err.code);
        const message = status < 500 ? scrubMessage(err.message) : GENERIC_UPSTREAM;
        return c.json(errorBody(err.code, message), status);
    }
    if (err instanceof client_1.XenitionApiConfigError) {
        // Operator-facing and contains no secrets by construction.
        return c.json(errorBody('CONFIG_ERROR', err.message), 500);
    }
    if (err instanceof Error && SDK_VALIDATION_RE.test(err.message)) {
        const notFound = SDK_NOT_FOUND_RE.test(err.message);
        return c.json(errorBody(notFound ? 'NOT_FOUND' : 'VALIDATION_ERROR', scrubMessage(err.message)), notFound ? 404 : 400);
    }
    return c.json(errorBody('INTERNAL', GENERIC_INTERNAL), 500);
}
/** JSON 404 for unmatched routes (hono's default is text/plain). */
function jsonNotFound(c) {
    return c.json(errorBody('NOT_FOUND', 'Route not found.'), 404);
}
/** 400 helper for router-level input validation (query params, body shape). */
function badRequest(c, message) {
    return c.json(errorBody('VALIDATION_ERROR', message), 400);
}
//# sourceMappingURL=errors.js.map