import { ColumnInfo } from './types';

/** The permissive alias every `json` / `jsonb` column is typed as. */
export const JSON_TYPE_NAME = 'Json';

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
export const PG_TYPE_MAP: Readonly<Record<string, string>> = Object.freeze({
  // Text-ish. `uuid` is a string: it crosses JSON as one, and a branded
  // type would reject every string literal a caller already passes.
  uuid: 'string',
  text: 'string',
  'character varying': 'string',
  varchar: 'string',
  character: 'string',
  char: 'string',
  bpchar: 'string',
  name: 'string',
  citext: 'string',
  xml: 'string',

  // Numbers. `bigint` and `numeric` can exceed what a double holds
  // exactly; they are still `number` because that is what the JSON hop
  // delivers, and typing them `string` would break arithmetic on every
  // ordinary-sized id and price. Values beyond 2^53 should be cast to text
  // in SQL rather than mistyped here.
  smallint: 'number',
  int2: 'number',
  integer: 'number',
  int: 'number',
  int4: 'number',
  bigint: 'number',
  int8: 'number',
  numeric: 'number',
  decimal: 'number',
  real: 'number',
  float4: 'number',
  'double precision': 'number',
  float8: 'number',

  boolean: 'boolean',
  bool: 'boolean',

  // Dates and times are strings, not `Date`. The value arrives as an ISO
  // string over JSON and stays one; declaring `Date` would make every
  // generated app's `row.created_at.getTime()` a runtime crash.
  date: 'string',
  'timestamp with time zone': 'string',
  timestamptz: 'string',
  'timestamp without time zone': 'string',
  timestamp: 'string',
  'time with time zone': 'string',
  timetz: 'string',
  'time without time zone': 'string',
  time: 'string',

  json: JSON_TYPE_NAME,
  jsonb: JSON_TYPE_NAME,
});

/** The `Json` alias, emitted once per generated file that needs it. */
export const JSON_TYPE_DECLARATION = `export type ${JSON_TYPE_NAME} =
  | string
  | number
  | boolean
  | null
  | { [key: string]: ${JSON_TYPE_NAME} | undefined }
  | ${JSON_TYPE_NAME}[];`;

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
export const usesJsonType = (type: MappedType): boolean =>
  type.ts === JSON_TYPE_NAME || type.ts === `${JSON_TYPE_NAME}[]`;

/**
 * Map one introspected column to a TypeScript type.
 *
 * Reads `udt_name` as well as `data_type` because arrays are otherwise
 * unrecoverable: `information_schema` reports every array as the single
 * `data_type` `ARRAY` and hides the element type in `udt_name` as `_text`,
 * `_int4`, and so on.
 */
export function mapPgType(column: Pick<ColumnInfo, 'dataType' | 'udtName'>): MappedType {
  const dataType = normalize(column.dataType);
  const udtName = normalize(column.udtName);

  const element = arrayElementOf(dataType, udtName);
  if (element !== null) {
    const mapped = element === '' ? undefined : PG_TYPE_MAP[element];
    if (mapped) return { ts: `${mapped}[]` };
    return { ts: 'unknown[]', unmappedPgType: element === '' ? 'ARRAY' : element };
  }

  const mapped = (dataType === '' ? undefined : PG_TYPE_MAP[dataType]) ??
    (udtName === '' ? undefined : PG_TYPE_MAP[udtName]);
  if (mapped) return { ts: mapped };
  return { ts: 'unknown', unmappedPgType: describe(column.dataType, column.udtName) };
}

/**
 * Strip the modifiers a type name may carry, and case-fold for lookup.
 * `information_schema.data_type` omits modifiers, but a gateway that builds
 * the type text itself can hand back `character varying(255)` or
 * `numeric(12, 2)`, and losing a mapping over a precision suffix would fill
 * the generated file with `unknown`s that are not honestly unknown.
 */
function normalize(name: string | undefined): string {
  return (name ?? '')
    .replace(/\s*\([^)]*\)/g, '')
    .trim()
    .toLowerCase();
}

/**
 * The element type of an array column, or `null` when the column is not an
 * array. An empty string means "an array whose element type could not be
 * determined" — still an array, so the caller keeps the `[]`.
 */
function arrayElementOf(dataType: string, udtName: string): string | null {
  if (dataType === 'array') {
    return udtName.startsWith('_') ? udtName.slice(1) : udtName;
  }
  if (dataType.endsWith('[]')) return dataType.slice(0, -2).trim();
  if (dataType === '' && udtName.startsWith('_')) return udtName.slice(1);
  return null;
}

/**
 * How an unmapped type is named in the generated comment. `USER-DEFINED` on
 * its own tells a reader nothing, so the udt name is appended whenever it
 * adds information: `USER-DEFINED (order_status)` is actionable. Reported
 * in the database's own spelling, not the case-folded lookup key.
 */
function describe(dataType: string | undefined, udtName: string | undefined): string {
  const type = (dataType ?? '').trim();
  const udt = (udtName ?? '').trim();
  if (type === '') return udt || 'unknown';
  if (udt === '' || udt.toLowerCase() === type.toLowerCase()) return type;
  return `${type} (${udt})`;
}
