/**
 * Shared internals for the content modules — id/timestamp generation,
 * slugs, and small validation helpers that produce consistent
 * `"<Client>.<method>: ..."` error messages.
 */

/** UUID v4 via WebCrypto (Node 18+ exposes it globally) or Node crypto. */
export function generateId(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require('crypto') as typeof import('crypto');
  return nodeCrypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** kebab-case slug from free text; never returns an empty string. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics left by NFKD
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

export function fail(context: string, message: string): never {
  throw new Error(`${context}: ${message}`);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireNonEmptyString(context: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(context, `"${field}" must be a non-empty string`);
  }
  return value;
}

export function optionalString(
  context: string,
  field: string,
  value: unknown,
  fallback: string,
): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') fail(context, `"${field}" must be a string`);
  return value;
}

export function optionalBoolean(
  context: string,
  field: string,
  value: unknown,
  fallback: boolean,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(context, `"${field}" must be a boolean`);
  return value;
}

export function optionalNumber(
  context: string,
  field: string,
  value: unknown,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(context, `"${field}" must be a finite number`);
  }
  return value;
}

export function optionalPlainObject(
  context: string,
  field: string,
  value: unknown,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  if (value === undefined) return fallback;
  if (!isPlainObject(value)) fail(context, `"${field}" must be a plain object`);
  return value;
}

/** Coerce Postgres numerics (which arrive as strings over JSON) to number. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
