/**
 * Schema type generation.
 *
 * `client.query.from('lab__items').where('price_cents', '>=', 0)` is three
 * strings and a value: a renamed column survives compilation and fails in
 * production, and a method expecting a slug happily accepts an id because
 * both are `string`. This module reads the app's real schema through
 * `client.raw()` and writes a `.d.ts` that makes those mistakes fail at the
 * keyboard instead.
 *
 *   import { introspectSchema, emitDatabaseTypes } from '@xenition/sdk';
 *
 *   const schema = await introspectSchema(client, { schema: 'public' });
 *   await fs.writeFile('database.types.d.ts', emitDatabaseTypes(schema));
 *
 * or, from a terminal:
 *
 *   npx xenition-codegen --key $XENITION_API_KEY --out src/database.types.d.ts
 */

export { introspectSchema, readRowField, INTROSPECTION_SQL, DEFAULT_SCHEMA } from './introspect';
export type { IntrospectOptions } from './introspect';

export { emitDatabaseTypes, quoteIdentifier, DEFAULT_REGENERATE_COMMAND } from './emit';
export type { EmitOptions } from './emit';

export { mapPgType, PG_TYPE_MAP, JSON_TYPE_NAME, JSON_TYPE_DECLARATION } from './pg-types';
export type { MappedType } from './pg-types';

export { main as runCodegenCli, parseArgs, USAGE, CLI_NAME, DEFAULT_OUTPUT_PATH } from './cli';
export type { CodegenCliDeps, CodegenRunResult } from './cli';

export type {
  ColumnInfo,
  IntrospectedSchema,
  RawCapableClient,
  RawResult,
  TableInfo,
} from './types';
