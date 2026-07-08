/**
 * Shared internals for the content modules — id/timestamp generation,
 * slugs, and small validation helpers that produce consistent
 * `"<Client>.<method>: ..."` error messages.
 */
/** UUID v4 via WebCrypto (Node 18+ exposes it globally) or Node crypto. */
export declare function generateId(): string;
export declare function nowIso(): string;
/** kebab-case slug from free text; never returns an empty string. */
export declare function slugify(text: string): string;
export declare function fail(context: string, message: string): never;
export declare function isPlainObject(value: unknown): value is Record<string, unknown>;
export declare function requireNonEmptyString(context: string, field: string, value: unknown): string;
export declare function optionalString(context: string, field: string, value: unknown, fallback: string): string;
export declare function optionalBoolean(context: string, field: string, value: unknown, fallback: boolean): boolean;
export declare function optionalNumber(context: string, field: string, value: unknown, fallback: number): number;
export declare function optionalPlainObject(context: string, field: string, value: unknown, fallback: Record<string, unknown>): Record<string, unknown>;
/** Coerce Postgres numerics (which arrive as strings over JSON) to number. */
export declare function toNumber(value: unknown): number | null;
//# sourceMappingURL=util.d.ts.map