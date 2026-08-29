"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_OUTPUT_PATH = exports.CLI_NAME = exports.USAGE = exports.parseArgs = exports.runCodegenCli = exports.JSON_TYPE_DECLARATION = exports.JSON_TYPE_NAME = exports.PG_TYPE_MAP = exports.mapPgType = exports.DEFAULT_REGENERATE_COMMAND = exports.quoteIdentifier = exports.emitDatabaseTypes = exports.DEFAULT_SCHEMA = exports.INTROSPECTION_SQL = exports.readRowField = exports.introspectSchema = void 0;
var introspect_1 = require("./introspect");
Object.defineProperty(exports, "introspectSchema", { enumerable: true, get: function () { return introspect_1.introspectSchema; } });
Object.defineProperty(exports, "readRowField", { enumerable: true, get: function () { return introspect_1.readRowField; } });
Object.defineProperty(exports, "INTROSPECTION_SQL", { enumerable: true, get: function () { return introspect_1.INTROSPECTION_SQL; } });
Object.defineProperty(exports, "DEFAULT_SCHEMA", { enumerable: true, get: function () { return introspect_1.DEFAULT_SCHEMA; } });
var emit_1 = require("./emit");
Object.defineProperty(exports, "emitDatabaseTypes", { enumerable: true, get: function () { return emit_1.emitDatabaseTypes; } });
Object.defineProperty(exports, "quoteIdentifier", { enumerable: true, get: function () { return emit_1.quoteIdentifier; } });
Object.defineProperty(exports, "DEFAULT_REGENERATE_COMMAND", { enumerable: true, get: function () { return emit_1.DEFAULT_REGENERATE_COMMAND; } });
var pg_types_1 = require("./pg-types");
Object.defineProperty(exports, "mapPgType", { enumerable: true, get: function () { return pg_types_1.mapPgType; } });
Object.defineProperty(exports, "PG_TYPE_MAP", { enumerable: true, get: function () { return pg_types_1.PG_TYPE_MAP; } });
Object.defineProperty(exports, "JSON_TYPE_NAME", { enumerable: true, get: function () { return pg_types_1.JSON_TYPE_NAME; } });
Object.defineProperty(exports, "JSON_TYPE_DECLARATION", { enumerable: true, get: function () { return pg_types_1.JSON_TYPE_DECLARATION; } });
var cli_1 = require("./cli");
Object.defineProperty(exports, "runCodegenCli", { enumerable: true, get: function () { return cli_1.main; } });
Object.defineProperty(exports, "parseArgs", { enumerable: true, get: function () { return cli_1.parseArgs; } });
Object.defineProperty(exports, "USAGE", { enumerable: true, get: function () { return cli_1.USAGE; } });
Object.defineProperty(exports, "CLI_NAME", { enumerable: true, get: function () { return cli_1.CLI_NAME; } });
Object.defineProperty(exports, "DEFAULT_OUTPUT_PATH", { enumerable: true, get: function () { return cli_1.DEFAULT_OUTPUT_PATH; } });
//# sourceMappingURL=index.js.map