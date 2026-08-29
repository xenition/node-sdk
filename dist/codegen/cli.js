"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.USAGE = exports.CLI_NAME = exports.DEFAULT_OUTPUT_PATH = void 0;
exports.main = main;
exports.parseArgs = parseArgs;
const errors_1 = require("../core/errors");
const emit_1 = require("./emit");
const introspect_1 = require("./introspect");
/** Where the generated file lands when `--out` is not given. */
exports.DEFAULT_OUTPUT_PATH = 'database.types.d.ts';
/** Name used in log lines and in the generated file's regenerate hint. */
exports.CLI_NAME = 'xenition-codegen';
exports.USAGE = `${exports.CLI_NAME} — generate TypeScript types from your app's database schema.

Usage:
  ${exports.CLI_NAME} --key <api-key> [--url <api-url>] [--out <path>] [--schema <name>]
  ${exports.CLI_NAME} <api-key> [<api-url>] [<out-path>] [<schema>]

Options:
  -k, --key <key>      Xenition service key. Falls back to $XENITION_API_KEY.
                       Must be a service key: raw SQL is refused for anon keys.
  -u, --url <url>      API base URL. Falls back to $XENITION_API_URL, then to
                       the SDK default.
  -o, --out <path>     Output file. Default ${exports.DEFAULT_OUTPUT_PATH}. Parent
                       directories are created.
  -s, --schema <name>  Postgres schema to read. Default ${introspect_1.DEFAULT_SCHEMA}.
  -h, --help           Show this message.

Example:
  ${exports.CLI_NAME} --key $XENITION_API_KEY --out src/database.types.d.ts`;
/**
 * Run the generator.
 *
 * `argv` is the argument list WITHOUT the node binary and script path —
 * `main(process.argv.slice(2))`. Returns a description of what happened;
 * throws `XenitionError` on anything that should stop a build.
 *
 * It throws rather than returning an exit code because every failure here
 * is one a person must read and act on: a missing key, an anon key, a
 * schema with nothing in it. The one outcome worth guarding hardest against
 * is a silent success that writes a file typing every table as `never` —
 * that gets discovered later, in someone else's compile error.
 */
async function main(argv = [], deps = {}) {
    const log = deps.log ?? ((line) => console.log(line));
    const env = deps.env ?? process.env;
    const args = parseArgs(argv);
    if (args.help) {
        log(exports.USAGE);
        return { kind: 'help' };
    }
    const apiKey = args.key ?? env.XENITION_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
        throw new errors_1.XenitionError('VALIDATION_ERROR', `${exports.CLI_NAME}: no API key. Pass --key <service-key> or set XENITION_API_KEY.`);
    }
    if (apiKey.startsWith('xen_anon_')) {
        // Caught here rather than at the first request, because the server's
        // 403 says "forbidden" and leaves the reader guessing which of the key,
        // the app or the schema was wrong.
        throw new errors_1.XenitionError('VALIDATION_ERROR', `${exports.CLI_NAME}: this is an anon key. Schema introspection reads information_schema over raw ` +
            'SQL, which the platform refuses for anon keys — use a service key (xen_service_...).');
    }
    const apiUrl = args.url ?? env.XENITION_API_URL ?? env.XENITION_BASE_URL;
    const outputPath = args.out ?? exports.DEFAULT_OUTPUT_PATH;
    const schemaName = args.schema ?? env.XENITION_SCHEMA ?? introspect_1.DEFAULT_SCHEMA;
    const createClient = deps.createClient ?? defaultCreateClient;
    const client = createClient(apiKey, apiUrl);
    const schema = await (0, introspect_1.introspectSchema)(client, { schema: schemaName });
    const tables = schema.tables.map((table) => table.name).sort();
    // Emitting before writing: `emitDatabaseTypes` refuses an empty schema,
    // and refusing before the file is opened means a failed run cannot leave
    // a truncated or `never`-typed file behind for the next build to consume.
    const contents = (0, emit_1.emitDatabaseTypes)(schema, {
        regenerateCommand: regenerateCommandFor(outputPath, schemaName),
    });
    const write = deps.writeFile ?? defaultWriteFile;
    await write(outputPath, contents);
    const bytes = Buffer.byteLength(contents, 'utf8');
    log(`${exports.CLI_NAME}: schema "${schemaName}" — ${tables.length} table(s): ${summarize(tables)}`);
    log(`${exports.CLI_NAME}: wrote ${outputPath} (${bytes} bytes)`);
    return { kind: 'generated', outputPath, schema: schemaName, tables, bytes };
}
const FLAGS = Object.freeze({
    '-k': 'key',
    '--key': 'key',
    '--api-key': 'key',
    '-u': 'url',
    '--url': 'url',
    '--api-url': 'url',
    '-o': 'out',
    '--out': 'out',
    '--output': 'out',
    '-s': 'schema',
    '--schema': 'schema',
});
/** Positional order, for `xenition-codegen <key> <url> <out> <schema>`. */
const POSITIONAL_ORDER = ['key', 'url', 'out', 'schema'];
/**
 * Parse the argument list.
 *
 * An unrecognised flag is an error rather than something ignored: a typo'd
 * `--schemas public` that is quietly dropped generates the `public` schema
 * and reports success, and the person who asked for a different schema
 * finds out from a missing table hours later.
 */
function parseArgs(argv) {
    const parsed = { help: false };
    let positional = 0;
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index] ?? '';
        if (token === '')
            continue;
        if (token === '-h' || token === '--help') {
            parsed.help = true;
            continue;
        }
        const equals = token.indexOf('=');
        if (token.startsWith('--') && equals > 2) {
            const name = FLAGS[token.slice(0, equals)];
            if (!name)
                throw unknownFlag(token.slice(0, equals));
            parsed[name] = token.slice(equals + 1);
            continue;
        }
        const name = FLAGS[token];
        if (name) {
            const value = argv[index + 1];
            if (value === undefined || value.startsWith('-')) {
                throw new errors_1.XenitionError('VALIDATION_ERROR', `${exports.CLI_NAME}: ${token} needs a value.`);
            }
            parsed[name] = value;
            index += 1;
            continue;
        }
        if (token.startsWith('-'))
            throw unknownFlag(token);
        const positionalName = POSITIONAL_ORDER[positional];
        if (!positionalName) {
            throw new errors_1.XenitionError('VALIDATION_ERROR', `${exports.CLI_NAME}: unexpected argument "${token}". Run with --help.`);
        }
        parsed[positionalName] = token;
        positional += 1;
    }
    return parsed;
}
function unknownFlag(flag) {
    return new errors_1.XenitionError('VALIDATION_ERROR', `${exports.CLI_NAME}: unknown option "${flag}". Run with --help.`);
}
/** Trim a long table list so the summary stays one readable line. */
function summarize(tables, limit = 12) {
    if (tables.length === 0)
        return '(none)';
    if (tables.length <= limit)
        return tables.join(', ');
    return `${tables.slice(0, limit).join(', ')}, and ${tables.length - limit} more`;
}
function regenerateCommandFor(outputPath, schemaName) {
    const schemaFlag = schemaName === introspect_1.DEFAULT_SCHEMA ? '' : ` --schema ${schemaName}`;
    return `npx ${exports.CLI_NAME} --out ${outputPath}${schemaFlag}`;
}
/**
 * Built lazily, and only when the caller injected nothing, so that
 * importing this module does not drag axios and socket.io in behind it —
 * and so the CLI's own tests never load the transport at all.
 */
function defaultCreateClient(apiKey, apiUrl) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { XenitionClient } = require('../xenition-client');
    return new XenitionClient(apiKey, apiUrl ? { baseUrl: apiUrl } : {});
}
/**
 * Same reasoning as the client factory: `fs` is required at call time so
 * this module stays loadable by a bundler that has no Node builtins, which
 * matters because `src/codegen` sits inside a package that also ships a
 * browser build.
 */
function defaultWriteFile(outputPath, contents) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const directory = path.dirname(path.resolve(outputPath));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(outputPath, contents, 'utf8');
}
//# sourceMappingURL=cli.js.map