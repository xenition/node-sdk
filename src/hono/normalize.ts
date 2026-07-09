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

/** `body_html` → `bodyHtml`; leading underscores survive (`_sdk_x` → `_sdkX`). */
export function camelizeKey(key: string): string {
  const match = /^(_*)(.*)$/.exec(key);
  const prefix = match?.[1] ?? '';
  const rest = match?.[2] ?? key;
  return prefix + rest.replace(/_+([a-zA-Z0-9])/g, (_m, ch: string) => ch.toUpperCase());
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Camelize a row's top-level keys. Values (including nested objects and
 * arrays — the jsonb payloads) are passed through untouched. Non-object
 * inputs are returned as-is so the helper is safe on `null` / scalars.
 */
export function normalizeRow<T = Record<string, unknown>>(row: unknown): T {
  if (!isPlainObject(row)) return row as T;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[camelizeKey(key)] = value;
  }
  return out as T;
}

/** `normalizeRow` over an array. Non-arrays return an empty array. */
export function normalizeRows<T = Record<string, unknown>>(rows: unknown): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => normalizeRow<T>(row));
}
