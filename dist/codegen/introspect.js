"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SCHEMA = exports.CURRENT_SCHEMA_SQL = exports.INTROSPECTION_SQL = void 0;
exports.resolveDefaultSchema = resolveDefaultSchema;
exports.introspectSchema = introspectSchema;
exports.readRowField = readRowField;
exports.toCamelCase = toCamelCase;
const errors_1 = require("../core/errors");
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
exports.INTROSPECTION_SQL = `SELECT table_name,
       column_name,
       ordinal_position,
       data_type,
       udt_name,
       is_nullable,
       column_default,
       is_identity,
       is_generated
  FROM information_schema.columns
 WHERE table_schema = $1
 ORDER BY table_name, ordinal_position`;
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
exports.CURRENT_SCHEMA_SQL = 'SELECT current_schema() AS schema';
/**
 * Kept for callers that want the literal, and for the case where
 * `current_schema()` cannot be read.
 */
exports.DEFAULT_SCHEMA = 'public';
/** Ask the connection which schema it is pointed at. */
async function resolveDefaultSchema(client) {
    try {
        const result = await client.raw(exports.CURRENT_SCHEMA_SQL, []);
        // Same three envelope shapes `rowsOf` already tolerates — a probe that
        // understood fewer shapes than the real query would fail on exactly the
        // gateways this is meant to work against.
        const found = readRowField(rowsOf(result)[0] ?? {}, 'schema');
        return typeof found === 'string' && found.trim() !== '' ? found : exports.DEFAULT_SCHEMA;
    }
    catch {
        // A gateway that refuses the probe should not stop a caller who named
        // the schema themselves; fall back rather than fail the whole run.
        return exports.DEFAULT_SCHEMA;
    }
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
async function introspectSchema(client, options = {}) {
    const context = 'introspectSchema';
    if (!client || typeof client.raw !== 'function') {
        throw new errors_1.XenitionError('VALIDATION_ERROR', `${context}: pass a client with a raw() method (XenitionClient, or client.query).`);
    }
    const schema = options.schema ?? (await resolveDefaultSchema(client));
    if (typeof schema !== 'string' || schema.trim() === '') {
        throw new errors_1.XenitionError('VALIDATION_ERROR', `${context}: "schema" must be a non-empty string.`);
    }
    const result = await client.raw(exports.INTROSPECTION_SQL, [schema]);
    const rows = rowsOf(result);
    // Insertion order is the SQL's ORDER BY, which is already table name then
    // ordinal position. No sorting here: the emitter is the single place that
    // owns output ordering, so there is one implementation to keep honest and
    // one place the determinism guarantee is tested.
    const byTable = new Map();
    for (const row of rows) {
        const tableName = stringField(row, 'table_name');
        const columnName = stringField(row, 'column_name');
        if (tableName === undefined || columnName === undefined)
            continue;
        const columns = byTable.get(tableName) ?? [];
        columns.push(toColumn(columnName, row));
        byTable.set(tableName, columns);
    }
    if (rows.length > 0 && byTable.size === 0) {
        // Rows arrived but nothing in them was recognisable. Almost always a
        // key-shape change on the wire; say so, and show what did arrive,
        // rather than reporting "no tables" and sending the reader to check
        // their database.
        throw new errors_1.XenitionError('QUERY_FAILED', `${context}: got ${rows.length} row(s) from information_schema but none carried a ` +
            `table_name/column_name pair. Row keys were: ${describeKeys(rows[0])}.`, { details: { schema } });
    }
    const tables = [];
    for (const [name, columns] of byTable)
        tables.push({ name, columns });
    return { schema, tables };
}
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
function readRowField(row, snakeKey) {
    if (!row || typeof row !== 'object')
        return undefined;
    if (Object.prototype.hasOwnProperty.call(row, snakeKey))
        return row[snakeKey];
    const camelKey = toCamelCase(snakeKey);
    if (Object.prototype.hasOwnProperty.call(row, camelKey))
        return row[camelKey];
    return undefined;
}
/** `is_nullable` → `isNullable`. */
function toCamelCase(snakeKey) {
    return snakeKey.replace(/_([a-z0-9])/g, (_match, char) => char.toUpperCase());
}
function toColumn(name, row) {
    const columnDefault = readRowField(row, 'column_default');
    const isIdentity = isYes(readRowField(row, 'is_identity'));
    const ordinal = Number(readRowField(row, 'ordinal_position'));
    return {
        name,
        dataType: stringField(row, 'data_type') ?? '',
        udtName: stringField(row, 'udt_name'),
        ordinalPosition: Number.isFinite(ordinal) ? ordinal : undefined,
        isNullable: isYes(readRowField(row, 'is_nullable')),
        // An identity column is a default by another name — the database
        // supplies the value, so the caller may omit it on INSERT.
        hasDefault: hasValue(columnDefault) || isIdentity,
        isGeneratedAlways: String(readRowField(row, 'is_generated') ?? '').toUpperCase() === 'ALWAYS',
    };
}
/**
 * Unwrap whatever envelope `raw()` resolved to. `QueryClient.raw`
 * normalizes `{ rows }` to `{ data }`, but the generator accepts any client
 * the caller has — including a stub written against the older shape — and
 * the cost of accepting all three is smaller than the cost of an empty
 * generated file.
 */
function rowsOf(result) {
    if (Array.isArray(result))
        return result;
    if (!result)
        return [];
    if (Array.isArray(result.data))
        return result.data;
    if (Array.isArray(result.rows))
        return result.rows;
    return [];
}
function stringField(row, snakeKey) {
    const value = readRowField(row, snakeKey);
    if (typeof value === 'string' && value !== '')
        return value;
    return undefined;
}
/** `information_schema` answers YES/NO; a gateway may coerce to a boolean. */
function isYes(value) {
    if (typeof value === 'boolean')
        return value;
    return String(value ?? '').toUpperCase() === 'YES';
}
function hasValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
}
function describeKeys(row) {
    if (!row || typeof row !== 'object')
        return '(not an object)';
    const keys = Object.keys(row);
    return keys.length === 0 ? '(none)' : keys.join(', ');
}
//# sourceMappingURL=introspect.js.map