"use strict";
/**
 * Shared internals for the content modules — id/timestamp generation,
 * slugs, and small validation helpers that produce consistent
 * `"<Client>.<method>: ..."` error messages.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateId = generateId;
exports.nowIso = nowIso;
exports.slugify = slugify;
exports.fail = fail;
exports.isPlainObject = isPlainObject;
exports.requireNonEmptyString = requireNonEmptyString;
exports.optionalString = optionalString;
exports.optionalBoolean = optionalBoolean;
exports.optionalNumber = optionalNumber;
exports.optionalPlainObject = optionalPlainObject;
exports.toNumber = toNumber;
/** UUID v4 via WebCrypto (Node 18+ exposes it globally) or Node crypto. */
function generateId() {
    const webCrypto = globalThis.crypto;
    if (webCrypto?.randomUUID)
        return webCrypto.randomUUID();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require('crypto');
    return nodeCrypto.randomUUID();
}
function nowIso() {
    return new Date().toISOString();
}
/** kebab-case slug from free text; never returns an empty string. */
function slugify(text) {
    const slug = text
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics left by NFKD
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'untitled';
}
function fail(context, message) {
    throw new Error(`${context}: ${message}`);
}
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function requireNonEmptyString(context, field, value) {
    if (typeof value !== 'string' || value.trim() === '') {
        fail(context, `"${field}" must be a non-empty string`);
    }
    return value;
}
function optionalString(context, field, value, fallback) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'string')
        fail(context, `"${field}" must be a string`);
    return value;
}
function optionalBoolean(context, field, value, fallback) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'boolean')
        fail(context, `"${field}" must be a boolean`);
    return value;
}
function optionalNumber(context, field, value, fallback) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail(context, `"${field}" must be a finite number`);
    }
    return value;
}
function optionalPlainObject(context, field, value, fallback) {
    if (value === undefined)
        return fallback;
    if (!isPlainObject(value))
        fail(context, `"${field}" must be a plain object`);
    return value;
}
/** Coerce Postgres numerics (which arrive as strings over JSON) to number. */
function toNumber(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
//# sourceMappingURL=util.js.map