import { RawCapableClient } from './types';
/** Where the generated file lands when `--out` is not given. */
export declare const DEFAULT_OUTPUT_PATH = "database.types.d.ts";
/** Name used in log lines and in the generated file's regenerate hint. */
export declare const CLI_NAME = "xenition-codegen";
export declare const USAGE = "xenition-codegen \u2014 generate TypeScript types from your app's database schema.\n\nUsage:\n  xenition-codegen --key <api-key> [--url <api-url>] [--out <path>] [--schema <name>]\n  xenition-codegen <api-key> [<api-url>] [<out-path>] [<schema>]\n\nOptions:\n  -k, --key <key>      Xenition service key. Falls back to $XENITION_API_KEY.\n                       Must be a service key: raw SQL is refused for anon keys.\n  -u, --url <url>      API base URL. Falls back to $XENITION_API_URL, then to\n                       the SDK default.\n  -o, --out <path>     Output file. Default database.types.d.ts. Parent\n                       directories are created.\n  -s, --schema <name>  Postgres schema to read. Default public.\n  -h, --help           Show this message.\n\nExample:\n  xenition-codegen --key $XENITION_API_KEY --out src/database.types.d.ts";
/**
 * Everything the CLI touches that is not a pure function, injectable so the
 * command can be tested as a command — argument parsing, error messages and
 * the printed summary are the parts most likely to be wrong, and they are
 * untestable if running `main()` needs a network, a service key and a
 * writable disk.
 */
export interface CodegenCliDeps {
    createClient?(apiKey: string, apiUrl?: string): RawCapableClient;
    writeFile?(outputPath: string, contents: string): void | Promise<void>;
    log?(line: string): void;
    /** Environment to read fallbacks from. Defaults to `process.env`. */
    env?: Record<string, string | undefined>;
}
export type CodegenRunResult = {
    kind: 'help';
} | {
    kind: 'generated';
    outputPath: string;
    schema: string;
    tables: string[];
    bytes: number;
};
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
export declare function main(argv?: string[], deps?: CodegenCliDeps): Promise<CodegenRunResult>;
interface ParsedArgs {
    help: boolean;
    key?: string;
    url?: string;
    out?: string;
    schema?: string;
}
/**
 * Parse the argument list.
 *
 * An unrecognised flag is an error rather than something ignored: a typo'd
 * `--schemas public` that is quietly dropped generates the `public` schema
 * and reports success, and the person who asked for a different schema
 * finds out from a missing table hours later.
 */
export declare function parseArgs(argv: string[]): ParsedArgs;
export {};
//# sourceMappingURL=cli.d.ts.map