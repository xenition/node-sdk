import { XenitionError } from '../core/errors';
import { DEFAULT_SCHEMA, INTROSPECTION_SQL, introspectSchema, readRowField } from './introspect';
import { RawCapableClient, RawResult } from './types';

type Row = Record<string, unknown>;

/**
 * A client that answers the introspection query from a fixed row set and
 * records what it was asked. The generator takes its client as a parameter
 * precisely so this is possible — none of these assertions could be made
 * against a real gateway without a service key and a seeded database.
 */
function fakeClient(rows: Row[], envelope: 'data' | 'rows' | 'array' = 'data') {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client: RawCapableClient = {
    async raw<T>(sql: string, params: unknown[] = []): Promise<RawResult<T>> {
      calls.push({ sql, params });
      const payload = rows as unknown as T[];
      if (envelope === 'array') return payload;
      if (envelope === 'rows') return { rows: payload };
      return { data: payload };
    },
  };
  return { client, calls };
}

/** One column of `items`, spelled the way the database spells its keys. */
const snakeRow = (overrides: Row = {}): Row => ({
  table_name: 'items',
  column_name: 'id',
  ordinal_position: 1,
  data_type: 'uuid',
  udt_name: 'uuid',
  is_nullable: 'NO',
  column_default: 'gen_random_uuid()',
  is_identity: 'NO',
  is_generated: 'NEVER',
  ...overrides,
});

/** The same column, spelled the way `raw()` used to camelCase its keys. */
const camelRow = (overrides: Row = {}): Row => ({
  tableName: 'items',
  columnName: 'id',
  ordinalPosition: 1,
  dataType: 'uuid',
  udtName: 'uuid',
  isNullable: 'NO',
  columnDefault: 'gen_random_uuid()',
  isIdentity: 'NO',
  isGenerated: 'NEVER',
  ...overrides,
});

describe('the introspection query', () => {
  it('asks information_schema.columns and binds the schema as a parameter', async () => {
    const { client, calls } = fakeClient([snakeRow()]);
    await introspectSchema(client, { schema: 'shop' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toBe(INTROSPECTION_SQL);
    expect(calls[0]?.params).toEqual(['shop']);
    expect(INTROSPECTION_SQL).toContain('information_schema.columns');
    expect(INTROSPECTION_SQL).toContain('table_schema = $1');
  });

  it('never interpolates the schema name into the SQL text', async () => {
    const { client, calls } = fakeClient([snakeRow()]);
    await introspectSchema(client, { schema: "public'; DROP TABLE users; --" });
    expect(calls[0]?.sql).not.toContain('DROP TABLE');
  });

  it('reads the public schema when the caller names none', async () => {
    const { client, calls } = fakeClient([snakeRow()]);
    const schema = await introspectSchema(client);
    expect(calls[0]?.params).toEqual([DEFAULT_SCHEMA]);
    expect(schema.schema).toBe('public');
  });
});

describe('reading rows in either key casing', () => {
  it('reads snake_case rows, which is what the gateway returns', async () => {
    const { client } = fakeClient([snakeRow()]);
    const schema = await introspectSchema(client);

    expect(schema.tables).toEqual([
      {
        name: 'items',
        columns: [
          {
            name: 'id',
            dataType: 'uuid',
            udtName: 'uuid',
            ordinalPosition: 1,
            isNullable: false,
            hasDefault: true,
            isGeneratedAlways: false,
          },
        ],
      },
    ]);
  });

  it('reads camelCase rows to exactly the same schema, so neither shape is a silent empty file', async () => {
    const snake = await introspectSchema(fakeClient([snakeRow()]).client);
    const camel = await introspectSchema(fakeClient([camelRow()]).client);
    expect(camel).toEqual(snake);
  });

  it('prefers the snake_case key when both are present, so a real null default stays null', async () => {
    // The failure this pins: reading with `??` would skip a legitimate
    // `column_default: null` and fall through to the camelCase key, making
    // a required column look defaulted and therefore optional on INSERT.
    const { client } = fakeClient([
      snakeRow({ column_default: null, columnDefault: 'now()', is_identity: 'NO' }),
    ]);
    const schema = await introspectSchema(client);
    expect(schema.tables[0]?.columns[0]?.hasDefault).toBe(false);
  });

  it('accepts the { rows } envelope and a bare array as well as { data }', async () => {
    const fromData = await introspectSchema(fakeClient([snakeRow()], 'data').client);
    const fromRows = await introspectSchema(fakeClient([snakeRow()], 'rows').client);
    const fromArray = await introspectSchema(fakeClient([snakeRow()], 'array').client);
    expect(fromRows).toEqual(fromData);
    expect(fromArray).toEqual(fromData);
  });
});

describe('readRowField', () => {
  it('finds the snake_case key', () => {
    expect(readRowField({ table_name: 'items' }, 'table_name')).toBe('items');
  });

  it('falls back to the camelCase spelling of the same key', () => {
    expect(readRowField({ tableName: 'items' }, 'table_name')).toBe('items');
    expect(readRowField({ isNullable: 'YES' }, 'is_nullable')).toBe('YES');
  });

  it('reports undefined when neither spelling is present', () => {
    expect(readRowField({ other: 1 }, 'table_name')).toBeUndefined();
  });

  it('returns a present-but-null value rather than looking further', () => {
    expect(readRowField({ column_default: null, columnDefault: 'now()' }, 'column_default')).toBe(
      null,
    );
  });
});

describe('what each column flag means for the generated types', () => {
  it('marks a nullable column nullable', async () => {
    const { client } = fakeClient([snakeRow({ column_name: 'note', is_nullable: 'YES' })]);
    const schema = await introspectSchema(client);
    expect(schema.tables[0]?.columns[0]?.isNullable).toBe(true);
  });

  it('accepts a boolean where information_schema would have said YES', async () => {
    const { client } = fakeClient([snakeRow({ is_nullable: true })]);
    const schema = await introspectSchema(client);
    expect(schema.tables[0]?.columns[0]?.isNullable).toBe(true);
  });

  it('treats a column with no default and no identity as required', async () => {
    const { client } = fakeClient([
      snakeRow({ column_name: 'price_cents', column_default: null, is_identity: 'NO' }),
    ]);
    const schema = await introspectSchema(client);
    expect(schema.tables[0]?.columns[0]?.hasDefault).toBe(false);
  });

  it('treats an identity column as defaulted, because the database supplies it', async () => {
    const { client } = fakeClient([snakeRow({ column_default: null, is_identity: 'YES' })]);
    const schema = await introspectSchema(client);
    expect(schema.tables[0]?.columns[0]?.hasDefault).toBe(true);
  });

  it('flags a GENERATED ALWAYS column so the emitter can keep it out of writes', async () => {
    const { client } = fakeClient([snakeRow({ is_generated: 'ALWAYS' })]);
    const schema = await introspectSchema(client);
    expect(schema.tables[0]?.columns[0]?.isGeneratedAlways).toBe(true);
  });
});

describe('grouping', () => {
  it('collects columns under their table in the order the query returned them', async () => {
    const { client } = fakeClient([
      snakeRow({ table_name: 'items', column_name: 'id', ordinal_position: 1 }),
      snakeRow({ table_name: 'items', column_name: 'name', ordinal_position: 2 }),
      snakeRow({ table_name: 'orders', column_name: 'id', ordinal_position: 1 }),
    ]);
    const schema = await introspectSchema(client);

    expect(schema.tables.map((table) => table.name)).toEqual(['items', 'orders']);
    expect(schema.tables[0]?.columns.map((column) => column.name)).toEqual(['id', 'name']);
  });
});

describe('failing loudly', () => {
  it('rejects a client that cannot run raw SQL', async () => {
    await expect(introspectSchema({} as RawCapableClient)).rejects.toThrow(/raw\(\) method/);
  });

  it('rejects an empty schema name instead of querying for it', async () => {
    const { client, calls } = fakeClient([snakeRow()]);
    await expect(introspectSchema(client, { schema: '  ' })).rejects.toBeInstanceOf(XenitionError);
    expect(calls).toHaveLength(0);
  });

  it('explains itself when rows arrive but carry neither key spelling', async () => {
    // The whole point of accepting both casings is that a third shape must
    // not look like "your database is empty".
    const { client } = fakeClient([{ TABLE_NAME: 'items', COLUMN_NAME: 'id' }]);
    await expect(introspectSchema(client)).rejects.toThrow(/TABLE_NAME, COLUMN_NAME/);
  });

  it('reports a genuinely empty schema as empty, leaving the refusal to the emitter', async () => {
    const { client } = fakeClient([]);
    await expect(introspectSchema(client)).resolves.toEqual({ schema: 'public', tables: [] });
  });
});
