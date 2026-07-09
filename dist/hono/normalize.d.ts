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
export declare function camelizeKey(key: string): string;
/**
 * Camelize a row's top-level keys. Values (including nested objects and
 * arrays — the jsonb payloads) are passed through untouched. Non-object
 * inputs are returned as-is so the helper is safe on `null` / scalars.
 */
export declare function normalizeRow<T = Record<string, unknown>>(row: unknown): T;
/** `normalizeRow` over an array. Non-arrays return an empty array. */
export declare function normalizeRows<T = Record<string, unknown>>(rows: unknown): T[];
//# sourceMappingURL=normalize.d.ts.map