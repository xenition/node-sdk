import { IntrospectedSchema, RawCapableClient } from './types';
/**
 * One query answers the whole question. `information_schema.columns` is
 * readable with a service key over `client.raw()`, so schema introspection
 * needs no new platform endpoint.
 *
 * `column_default`, `is_identity` and `is_generated` are selected alongside
 * the four obvious columns because they are what separates Insert from Row:
 * a column with a default may be omitted when writing but is always present
 * when reading. Without them the generated Insert type demands values the
 * database would have supplied, and callers abandon it.
 *
 * The schema name is bound as `$1` rather than interpolated. It is usually
 * a literal `public`, but it can come from a CLI flag, and a generator that
 * concatenates user input into SQL is a generator that can drop a table.
 */
export declare const INTROSPECTION_SQL = "SELECT table_name,\n       column_name,\n       ordinal_position,\n       data_type,\n       udt_name,\n       is_nullable,\n       column_default,\n       is_identity,\n       is_generated\n  FROM information_schema.columns\n WHERE table_schema = $1\n ORDER BY table_name, ordinal_position";
/**
 * The schema read when the caller names none.
 *
 * NOT `public`. An app's tables live in a per-app schema — `app_app_today`,
 * say — and `current_schema()` is what the service key is already pointed
 * at. Defaulting to `public` produced the worst possible outcome: 133
 * platform control-plane tables, a clean-compiling `Database` type, and not
 * one of the app's own tables in it. Nothing errored, because `public`
 * genuinely exists and genuinely has tables — it just is not yours.
 *
 * Resolved per connection rather than hardcoded, so a key pointed somewhere
 * else keeps working.
 */
export declare const CURRENT_SCHEMA_SQL = "SELECT current_schema() AS schema";
/**
 * Kept for callers that want the literal, and for the case where
 * `current_schema()` cannot be read.
 */
export declare const DEFAULT_SCHEMA = "public";
/** Ask the connection which schema it is pointed at. */
export declare function resolveDefaultSchema(client: RawCapableClient): Promise<string>;
export interface IntrospectOptions {
    /** Postgres schema to read. Default `public`. */
    schema?: string;
}
/**
 * Read every table and column in one schema through an injected
 * raw-capable client.
 *
 * The client is a parameter rather than something constructed here so the
 * generator can be exercised against a stub — the emitter's correctness is
 * the part worth testing, and it would be untestable if reaching it
 * required a live gateway and a service key.
 *
 * Views come back alongside tables, since `information_schema.columns`
 * makes no distinction. Their Row type is correct and useful; their
 * Insert/Update types are advisory, which the generated header says.
 */
export declare function introspectSchema(client: RawCapableClient, options?: IntrospectOptions): Promise<IntrospectedSchema>;
/**
 * Read one field from a result row, tolerating either key casing.
 *
 * `raw()` has returned camelCase (`tableName`) and returns snake_case
 * (`table_name`) as the platform converges on the database's own spelling.
 * A generator that picks one and is wrong does not fail loudly — it reports
 * zero tables and writes a file that types every table as `never`. Reading
 * both is two lines and removes the failure entirely.
 *
 * Presence is tested with `hasOwnProperty` rather than `??`, because a null
 * `column_default` is meaningful: it means "no default", and falling
 * through to the camelCase key on a legitimate null would be a different
 * bug wearing the same clothes.
 */
export declare function readRowField(row: Record<string, unknown>, snakeKey: string): unknown;
/** `is_nullable` → `isNullable`. */
export declare function toCamelCase(snakeKey: string): string;
//# sourceMappingURL=introspect.d.ts.map