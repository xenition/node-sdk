"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryParamError = void 0;
exports.applyCors = applyCors;
exports.parseNonNegativeInt = parseNonNegativeInt;
exports.parsePublished = parsePublished;
exports.parseBooleanFlag = parseBooleanFlag;
exports.parseDirection = parseDirection;
const cors_1 = require("hono/cors");
/**
 * Small shared pieces for the routers: CORS wiring and query-string
 * parsing that reports precise 400 messages instead of coercing garbage.
 */
function applyCors(app, option) {
    if (option === false)
        return;
    const origin = option === true || option === undefined ? '*' : option;
    app.use('*', (0, cors_1.cors)({
        origin,
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type'],
        maxAge: 600,
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