"use strict";
/**
 * Response-shape normalization for the Hono routers.
 *
 * The two platform runtimes disagree on row casing: the gateway camelCases
 * column names, while the engine returns snake_case verbatim. Frontends
 * must see ONE stable shape, so every row that leaves a router goes
 * through `normalizeRow` — snake_case keys become camelCase, keys that are
 * already camelCase pass through unchanged.
 *
 * Only the row's TOP-LEVEL keys are touched. jsonb payload columns
 * (`data`, `seo`, `meta`, `fields`, …) hold app-authored keys whose casing
 * is the app's contract — their inner keys are never rewritten.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.camelizeKey = camelizeKey;
exports.normalizeRow = normalizeRow;
exports.normalizeRows = normalizeRows;
/** `body_html` → `bodyHtml`; leading underscores survive (`_sdk_x` → `_sdkX`). */
function camelizeKey(key) {
    const match = /^(_*)(.*)$/.exec(key);
    const prefix = match?.[1] ?? '';
    const rest = match?.[2] ?? key;
    return prefix + rest.replace(/_+([a-zA-Z0-9])/g, (_m, ch) => ch.toUpperCase());
}
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/**
 * Camelize a row's top-level keys. Values (including nested objects and
 * arrays — the jsonb payloads) are passed through untouched. Non-object
 * inputs are returned as-is so the helper is safe on `null` / scalars.
 */
function normalizeRow(row) {
    if (!isPlainObject(row))
        return row;
    const out = {};
    for (const [key, value] of Object.entries(row)) {
        out[camelizeKey(key)] = value;
    }
    return out;
}
/** `normalizeRow` over an array. Non-arrays return an empty array. */
function normalizeRows(rows) {
    if (!Array.isArray(rows))
        return [];
    return rows.map((row) => normalizeRow(row));
}
//# sourceMappingURL=normalize.js.map