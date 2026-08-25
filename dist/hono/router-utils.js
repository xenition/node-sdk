"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryParamError = void 0;
exports.applyCors = applyCors;
exports.parseNonNegativeInt = parseNonNegativeInt;
exports.parsePublished = parsePublished;
exports.parseBooleanFlag = parseBooleanFlag;
exports.parseDirection = parseDirection;
const cors_1 = require("hono/cors");
/** Every method the SDK's own routers answer with. */
const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
/**
 * Headers every client already sends. `Authorization` is the load-bearing
 * one — without it no authenticated request survives a preflight.
 */
const DEFAULT_HEADERS = ['Content-Type', 'Authorization'];
const unique = (values) => [...new Set(values)];
function applyCors(app, option) {
    if (option === false)
        return;
    const config = option === true || option === undefined
        ? {}
        : Array.isArray(option)
            ? { origin: option }
            : option;
    // `credentials` and a wildcard origin are mutually exclusive by spec, and a
    // browser rejects the pair silently — which reads as "CORS is broken"
    // rather than "this combination is not allowed".
    if (config.credentials && (config.origin === undefined || config.origin === '*')) {
        throw new Error('cors: `credentials: true` requires an explicit origin allowlist — a browser ' +
            'refuses credentialed requests against `Access-Control-Allow-Origin: *`.');
    }
    app.use('*', (0, cors_1.cors)({
        origin: config.origin ?? '*',
        allowMethods: unique([...DEFAULT_METHODS, ...(config.allowMethods ?? [])]),
        allowHeaders: unique([...DEFAULT_HEADERS, ...(config.allowHeaders ?? [])]),
        ...(config.exposeHeaders ? { exposeHeaders: config.exposeHeaders } : {}),
        ...(config.credentials ? { credentials: true } : {}),
        maxAge: config.maxAge ?? 600,
    }));
}
/** Thrown by the parse helpers; routers convert it to a 400. */
class QueryParamError extends Error {
    constructor(message) {
        super(message);
        this.name = 'QueryParamError';
    }
}
exports.QueryParamError = QueryParamError;
/** Non-negative integer query param, or undefined when absent. */
function parseNonNegativeInt(name, value) {
    if (value === undefined || value === '')
        return undefined;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
        throw new QueryParamError(`"${name}" must be a non-negative integer, got "${value}"`);
    }
    return n;
}
/**
 * `published` filter for the public list route. These routers run with the
 * SERVICE key on a public surface, so the safe default is published-only:
 *   - omitted / '1' / 'true'  → true
 *   - '0' / 'false'           → false (drafts — same visibility the anon
 *                                key already has for reads)
 *   - 'all'                   → undefined (no filter)
 */
function parsePublished(value) {
    if (value === undefined || value === '' || value === '1' || value === 'true')
        return true;
    if (value === '0' || value === 'false')
        return false;
    if (value === 'all')
        return undefined;
    throw new QueryParamError(`"published" must be one of 1, 0, true, false, all — got "${value}"`);
}
/**
 * Optional boolean query flag: `1`/`true` → true, `0`/`false` → false,
 * absent → undefined (no filter). Anything else is a 400.
 */
function parseBooleanFlag(name, value) {
    if (value === undefined || value === '')
        return undefined;
    if (value === '1' || value === 'true')
        return true;
    if (value === '0' || value === 'false')
        return false;
    throw new QueryParamError(`"${name}" must be one of 1, 0, true, false — got "${value}"`);
}
/** Sort direction: case-insensitive ASC/DESC, or undefined when absent. */
function parseDirection(value) {
    if (value === undefined || value === '')
        return undefined;
    const upper = value.toUpperCase();
    if (upper === 'ASC' || upper === 'DESC')
        return upper;
    throw new QueryParamError(`"direction" must be ASC or DESC — got "${value}"`);
}
//# sourceMappingURL=router-utils.js.map