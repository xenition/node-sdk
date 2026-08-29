import { XenitionError } from '../core/errors';
import { CLI_NAME, DEFAULT_OUTPUT_PATH, main, parseArgs, USAGE } from './cli';
import { RawCapableClient, RawResult } from './types';

type Row = Record<string, unknown>;

const column = (table: string, name: string, overrides: Row = {}): Row => ({
  table_name: table,
  column_name: name,
  ordinal_position: 1,
  data_type: 'uuid',
  udt_name: 'uuid',
  is_nullable: 'NO',
  column_default: 'gen_random_uuid()',
  is_identity: 'NO',
  is_generated: 'NEVER',
  ...overrides,
});

const ROWS: Row[] = [column('lab__items', 'id'), column('lab__orders', 'id')];

/**
 * A CLI harness with no network, no disk and no ambient environment. The
 * environment is injected rather than read from `process.env` so a machine
 * that happens to export XENITION_API_KEY cannot turn the "no key" test
 * green.
 */
function harness(rows: Row[] = ROWS) {
  const created: Array<{ apiKey: string; apiUrl?: string }> = [];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const written: Array<{ path: string; contents: string }> = [];
  const logged: string[] = [];

  const client: RawCapableClient = {
    async raw<T>(sql: string, params: unknown[] = []): Promise<RawResult<T>> {
      queries.push({ sql, params });
      return { data: rows as unknown as T[] };
    },
  };

  return {
    created,
    queries,
    written,
    logged,
    deps: {
      createClient(apiKey: string, apiUrl?: string) {
        created.push({ apiKey, apiUrl });
        return client;
      },
      writeFile(path: string, contents: string) {
        written.push({ path, contents });
      },
      log(line: string) {
        logged.push(line);
      },
      env: {} as Record<string, string | undefined>,
    },
  };
}

describe('parseArgs', () => {
  it('reads long flags', () => {
    expect(parseArgs(['--key', 'k', '--url', 'u', '--out', 'o', '--schema', 's'])).toEqual({
      help: false,
      key: 'k',
      url: 'u',
      out: 'o',
      schema: 's',
    });
  });

  it('reads the --flag=value form', () => {
    expect(parseArgs(['--key=k', '--schema=shop'])).toMatchObject({ key: 'k', schema: 'shop' });
  });

  it('reads short flags', () => {
    expect(parseArgs(['-k', 'k', '-o', 'out.d.ts'])).toMatchObject({ key: 'k', out: 'out.d.ts' });
  });

  it('reads bare arguments as key, url, out, schema in that order', () => {
    expect(parseArgs(['k', 'https://api', 'out.d.ts', 'shop'])).toEqual({
      help: false,
      key: 'k',
      url: 'https://api',
      out: 'out.d.ts',
      schema: 'shop',
    });
  });

  it('rejects an unknown option instead of ignoring it', () => {
    // A dropped `--schemas shop` would generate `public` and report
    // success, and the missing tables would be someone else's problem.
    expect(() => parseArgs(['--schemas', 'shop'])).toThrow(/unknown option "--schemas"/);
    expect(() => parseArgs(['--schemas=shop'])).toThrow(/unknown option "--schemas"/);
  });

  it('rejects a flag whose value is missing rather than swallowing the next flag', () => {
    expect(() => parseArgs(['--key', '--out', 'o'])).toThrow(/--key needs a value/);
    expect(() => parseArgs(['--key'])).toThrow(/--key needs a value/);
  });

  it('rejects a fifth bare argument, which can only be a mistake', () => {
    expect(() => parseArgs(['k', 'u', 'o', 's', 'extra'])).toThrow(/unexpected argument "extra"/);
  });
});

describe('--help', () => {
  it('prints usage and generates nothing', async () => {
    const { deps, logged, written } = harness();
    await expect(main(['--help'], deps)).resolves.toEqual({ kind: 'help' });
    expect(logged).toEqual([USAGE]);
    expect(written).toEqual([]);
  });

  it('documents the options it actually accepts', () => {
    expect(USAGE).toContain('--key');
    expect(USAGE).toContain('--out');
    expect(USAGE).toContain('--schema');
    expect(USAGE).toContain(DEFAULT_OUTPUT_PATH);
  });
});

describe('the key', () => {
  it('fails loudly when no key is given anywhere', async () => {
    const { deps, written } = harness();
    await expect(main([], deps)).rejects.toThrow(/no API key.*XENITION_API_KEY/s);
    expect(written).toEqual([]);
  });

  it('falls back to XENITION_API_KEY', async () => {
    const { deps, created } = harness();
    deps.env.XENITION_API_KEY = 'xen_service_env';
    await main([], deps);
    expect(created[0]?.apiKey).toBe('xen_service_env');
  });

  it('refuses an anon key before making a request, because the 403 explains nothing', async () => {
    const { deps, created } = harness();
    await expect(main(['--key', 'xen_anon_abc'], deps)).rejects.toThrow(/anon key.*service key/s);
    expect(created).toEqual([]);
  });

  it('throws XenitionError so a build script can branch on the code', async () => {
    const { deps } = harness();
    await expect(main([], deps)).rejects.toBeInstanceOf(XenitionError);
  });
});

describe('a successful run', () => {
  it('builds the client from the key and the url', async () => {
    const { deps, created } = harness();
    await main(['--key', 'xen_service_abc', '--url', 'https://api.example/v1'], deps);
    expect(created).toEqual([{ apiKey: 'xen_service_abc', apiUrl: 'https://api.example/v1' }]);
  });

  it('leaves the url undefined when none is given, so the SDK default applies', async () => {
    const { deps, created } = harness();
    await main(['--key', 'xen_service_abc'], deps);
    expect(created[0]?.apiUrl).toBeUndefined();
  });

  it('introspects the schema it was asked for', async () => {
    const { deps, queries } = harness();
    await main(['--key', 'xen_service_abc', '--schema', 'shop'], deps);
    expect(queries[0]?.params).toEqual(['shop']);
  });

  it('introspects public by default', async () => {
    const { deps, queries } = harness();
    await main(['--key', 'xen_service_abc'], deps);
    expect(queries[0]?.params).toEqual(['public']);
  });

  it('writes the generated types to --out', async () => {
    const { deps, written } = harness();
    await main(['--key', 'xen_service_abc', '--out', 'src/db.d.ts'], deps);
    expect(written).toHaveLength(1);
    expect(written[0]?.path).toBe('src/db.d.ts');
    expect(written[0]?.contents).toContain('export interface Database {');
    expect(written[0]?.contents).toContain('lab__items: {');
  });

  it('writes to a documented default path when --out is omitted', async () => {
    const { deps, written } = harness();
    await main(['--key', 'xen_service_abc'], deps);
    expect(written[0]?.path).toBe(DEFAULT_OUTPUT_PATH);
  });

  it('puts a regenerate command in the file that reproduces this exact run', async () => {
    const { deps, written } = harness();
    await main(['--key', 'xen_service_abc', '--out', 'src/db.d.ts', '--schema', 'shop'], deps);
    expect(written[0]?.contents).toContain(`npx ${CLI_NAME} --out src/db.d.ts --schema shop`);
  });

  it('reports what it found and what it wrote', async () => {
    const { deps, logged } = harness();
    const result = await main(['--key', 'xen_service_abc', '--out', 'src/db.d.ts'], deps);

    expect(logged[0]).toContain('2 table(s): lab__items, lab__orders');
    expect(logged[1]).toContain('wrote src/db.d.ts');
    expect(result).toMatchObject({
      kind: 'generated',
      outputPath: 'src/db.d.ts',
      schema: 'public',
      tables: ['lab__items', 'lab__orders'],
    });
  });

  it('reports a byte count that matches the file it wrote', async () => {
    const { deps, written } = harness();
    const result = await main(['--key', 'xen_service_abc'], deps);
    if (result.kind !== 'generated') throw new Error('expected a generated result');
    expect(result.bytes).toBe(Buffer.byteLength(written[0]?.contents ?? '', 'utf8'));
  });

  it('reads camelCase introspection rows just as well as snake_case ones', async () => {
    // The gateway is mid-rename; a CLI that only understands one spelling
    // silently produces an empty file for half the fleet.
    const camel = harness([
      {
        tableName: 'lab__items',
        columnName: 'id',
        ordinalPosition: 1,
        dataType: 'uuid',
        udtName: 'uuid',
        isNullable: 'NO',
        columnDefault: 'gen_random_uuid()',
        isIdentity: 'NO',
        isGenerated: 'NEVER',
      },
    ]);
    const snake = harness([column('lab__items', 'id')]);

    await main(['--key', 'xen_service_abc'], camel.deps);
    await main(['--key', 'xen_service_abc'], snake.deps);

    expect(camel.written[0]?.contents).toBe(snake.written[0]?.contents);
  });
});

describe('an empty schema', () => {
  it('fails instead of writing a file that types every table as never', async () => {
    const { deps, written } = harness([]);
    await expect(main(['--key', 'xen_service_abc'], deps)).rejects.toThrow(/no tables/);
    expect(written).toEqual([]);
  });

  it('leaves any previously generated file untouched, because nothing is opened', async () => {
    const { deps, written, logged } = harness([]);
    await expect(main(['--key', 'xen_service_abc'], deps)).rejects.toThrow(XenitionError);
    expect(written).toEqual([]);
    expect(logged).toEqual([]);
  });
});
