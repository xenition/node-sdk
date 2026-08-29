/**
 * The shapes the schema type generator passes between its three stages:
 * introspect the live database, map each column to a TypeScript type, emit
 * a `.d.ts`. Keeping the middle stage a plain data structure is what lets
 * the emitter be tested against a fixed fake schema with no network.
 */
/**
 * The only capability the generator needs from a client: parameterized raw
 * SQL. Declared structurally rather than importing `XenitionClient` so the
 * introspector can be handed a stub in tests, and so this module never
 * drags the whole SDK (axios, socket.io) into a caller that only wanted to
 * generate types. `XenitionClient`, `QueryClient`, and any test double with
 * a matching `raw` all satisfy it.
 */
export interface RawCapableClient {
    raw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<RawResult<T>>;
}
/**
 * What `raw()` resolves to. `QueryClient.raw` normalizes the server's
 * `{ rows }` envelope to `{ data }`, but the generator is handed whatever
 * client the caller has — including older builds and hand-rolled stubs — so
 * both envelopes (and a bare array) are accepted at the read site. Being
 * strict here would turn a cosmetic server-side rename into "codegen
 * produced an empty file".
 */
export type RawResult<T> = {
    data?: T[];
    rows?: T[];
} | T[];
/** One column of one table, as `information_schema.columns` describes it. */
export interface ColumnInfo {
    name: string;
    /**
     * `data_type` verbatim — `text`, `timestamp with time zone`, `ARRAY`,
     * `USER-DEFINED`. Kept unmapped so an unrecognised type can be named in
     * the emitted comment instead of being guessed at.
     */
    dataType: string;
    /**
     * `udt_name`. The only place an array's element type (`_text`) or an
     * enum's actual name shows up — `data_type` flattens both to a useless
     * `ARRAY` / `USER-DEFINED`.
     */
    udtName?: string;
    /** `ordinal_position`, so emitted fields follow the table's own order. */
    ordinalPosition?: number;
    isNullable: boolean;
    /**
     * The column has a `DEFAULT`, or is an identity column. Both mean the
     * same thing to a caller: you may omit it on INSERT and it will still be
     * present on SELECT. That asymmetry is the entire reason Insert and Row
     * are separate types.
     */
    hasDefault: boolean;
    /**
     * `GENERATED ALWAYS AS (...) STORED`. Postgres rejects any attempt to
     * write one, so these are omitted from Insert and Update entirely — a
     * type that permits a statement the database will refuse is precisely
     * the class of bug generated types exist to remove.
     */
    isGeneratedAlways: boolean;
}
/** One table (or view) and its columns, in ordinal order. */
export interface TableInfo {
    name: string;
    columns: ColumnInfo[];
}
/** Everything the emitter needs. Produced by `introspectSchema`. */
export interface IntrospectedSchema {
    /** The Postgres schema that was read, e.g. `public`. */
    schema: string;
    tables: TableInfo[];
}
//# sourceMappingURL=types.d.ts.map