import { ColumnInfo } from './types';
/** The permissive alias every `json` / `jsonb` column is typed as. */
export declare const JSON_TYPE_NAME = "Json";
/**
 * Postgres type → TypeScript type.
 *
 * The rule this file follows, and the reason it is a lookup table rather
 * than a pile of `includes()` checks: a wrong guess is worse than no guess.
 * A column typed `string` that actually arrives as an object compiles
 * cleanly and fails in production, which is the exact failure generated
 * types exist to prevent. So anything not listed here becomes `unknown`
 * with the pg type named in a comment — the reader then narrows it
 * deliberately, or tells us to add a mapping.
 *
 * Keys cover both vocabularies, because `information_schema` speaks two:
 * `data_type` is the SQL standard spelling (`character varying`, `timestamp
 * with time zone`) while `udt_name` is the pg catalog spelling (`varchar`,
 * `timestamptz`) — and `udt_name` is the only one that survives for the
 * element type of an array.
 *
 * Deliberately absent, and therefore `unknown`: `bytea` (a Buffer, or
 * base64, depending on the hop), `interval` (an object, not a string),
 * `money` (a locale-formatted string), and every `USER-DEFINED` type — an
 * enum's honest type is a union of its labels, which
 * `information_schema.columns` does not carry, and `string` would silently
 * accept a label the database will reject.
 */
export declare const PG_TYPE_MAP: Readonly<Record<string, string>>;
/** The `Json` alias, emitted once per generated file that needs it. */
export declare const JSON_TYPE_DECLARATION = "export type Json =\n  | string\n  | number\n  | boolean\n  | null\n  | { [key: string]: Json | undefined }\n  | Json[];";
export interface MappedType {
    /** TypeScript type text, e.g. `string`, `number[]`, `Json`, `unknown`. */
    ts: string;
    /**
     * Set only when the mapping failed. Carries the pg type to name in the
     * emitted comment, so a reader of the generated file sees exactly which
     * column needs attention instead of hunting for the bare `unknown`.
     */
    unmappedPgType?: string;
}
/** Whether a mapped type references the `Json` alias. */
export declare const usesJsonType: (type: MappedType) => boolean;
/**
 * Map one introspected column to a TypeScript type.
 *
 * Reads `udt_name` as well as `data_type` because arrays are otherwise
 * unrecoverable: `information_schema` reports every array as the single
 * `data_type` `ARRAY` and hides the element type in `udt_name` as `_text`,
 * `_int4`, and so on.
 */
export declare function mapPgType(column: Pick<ColumnInfo, 'dataType' | 'udtName'>): MappedType;
//# sourceMappingURL=pg-types.d.ts.map