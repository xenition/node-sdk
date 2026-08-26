import { XenitionErrorCode } from '../core/errors';
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
/**
 * Reject a call with a message the caller can act on.
 *
 * Throws a `XenitionError`, not a bare `Error`: an app catching module
 * failures had no `code` to branch on, so every one of them surfaced as
 * UNKNOWN and could only be told apart by matching the message text.
 * `VALIDATION_ERROR` is the default because most of these are bad input;
 * pass `'CONFLICT'` for "this already exists" cases so a caller can
 * distinguish "you sent something wrong" from "the state says no".
 */
export declare function fail(context: string, message: string, code?: XenitionErrorCode): never;
export declare function isPlainObject(value: unknown): value is Record<string, unknown>;
export declare function requireNonEmptyString(context: string, field: string, value: unknown): string;
export declare function optionalString(context: string, field: string, value: unknown, fallback: string): string;
export declare function optionalBoolean(context: string, field: string, value: unknown, fallback: boolean): boolean;
export declare function optionalNumber(context: string, field: string, value: unknown, fallback: number): number;
export declare function optionalPlainObject(context: string, field: string, value: unknown, fallback: Record<string, unknown>): Record<string, unknown>;
/** Coerce Postgres numerics (which arrive as strings over JSON) to number. */
export declare function toNumber(value: unknown): number | null;
/**
 * Explain a slug lookup that was handed an id.
 *
 * Several modules read by slug (`getProduct`, `searchSlots`, `getAlbum`)
 * while their siblings write by id (`updateProduct`, `addItem`). Nothing
 * at the call site says which a method wants, and both are strings, so
 * TypeScript cannot help. Passing the wrong one produced a bare
 * `unknown resource "<uuid>"` — which reads as "that row is gone" and
 * sends the caller looking for missing data that is sitting right there.
 *
 * Appends the explanation only when the value actually looks like a UUID,
 * so a genuinely missing slug still gets the plain message.
 */
export declare function notFoundHint(kind: string, value: string): string;
//# sourceMappingURL=util.d.ts.map