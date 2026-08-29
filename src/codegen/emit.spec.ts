import * as ts from 'typescript';
import { XenitionError } from '../core/errors';
import { compareIdentifiers, emitDatabaseTypes, quoteIdentifier } from './emit';
import { ColumnInfo, IntrospectedSchema, TableInfo } from './types';

const col = (name: string, dataType: string, overrides: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name,
  dataType,
  isNullable: false,
  hasDefault: false,
  isGeneratedAlways: false,
  ...overrides,
});

const schemaOf = (...tables: TableInfo[]): IntrospectedSchema => ({ schema: 'public', tables });

/**
 * Three columns covering the distinction the whole generator exists for: a
 * defaulted id, a required value, and a nullable one.
 */
const SMALL = schemaOf({
  name: 'lab__items',
  columns: [
    col('id', 'uuid', { udtName: 'uuid', ordinalPosition: 1, hasDefault: true }),
    col('price_cents', 'integer', { udtName: 'int4', ordinalPosition: 2 }),
    col('note', 'text', { udtName: 'text', ordinalPosition: 3, isNullable: true }),
  ],
});

/** Everything awkward, in one table: arrays, json, an enum, a generated column. */
const AWKWARD = schemaOf(
  {
    name: 'lab__items',
    columns: [
      col('id', 'uuid', { udtName: 'uuid', ordinalPosition: 1, hasDefault: true }),
      col('tags', 'ARRAY', { udtName: '_text', ordinalPosition: 2, isNullable: true }),
      col('meta', 'jsonb', { udtName: 'jsonb', ordinalPosition: 3, hasDefault: true }),
      col('search', 'tsvector', { udtName: 'tsvector', ordinalPosition: 4, isNullable: true }),
      col('total_cents', 'integer', { ordinalPosition: 5, isGeneratedAlways: true }),
    ],
  },
  {
    name: 'lab__orders',
    columns: [
      col('id', 'bigint', { udtName: 'int8', ordinalPosition: 1, hasDefault: true }),
      col('status', 'USER-DEFINED', { udtName: 'order_status', ordinalPosition: 2 }),
    ],
  },
);

/** The generated file from `export interface Database` onward. */
const body = (text: string): string => text.slice(text.indexOf('export interface Database'));

/** The field lines of one member of one table, without indentation. */
function memberFields(text: string, table: string, member: 'Row' | 'Insert' | 'Update'): string[] {
  const tableStart = text.indexOf(`  ${quoteIdentifier(table)}: {`);
  if (tableStart < 0) throw new Error(`no table ${table} in emitted output`);
  const tableEnd = text.indexOf('\n  };', tableStart);
  const block = text.slice(tableStart, tableEnd);
  const memberStart = block.indexOf(`    ${member}: {`);
  if (memberStart < 0) return [];
  const memberEnd = block.indexOf('\n    };', memberStart);
  return block
    .slice(block.indexOf('\n', memberStart) + 1, memberEnd)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

describe('the shape of the generated file', () => {
  it('emits the Database interface exactly, so the format is reviewable rather than incidental', () => {
    expect(body(emitDatabaseTypes(SMALL))).toBe(
      `export interface Database {
  lab__items: {
    Row: {
      id: string;
      price_cents: number;
      note: string | null;
    };
    Insert: {
      id?: string;
      price_cents: number;
      note?: string | null;
    };
    Update: {
      id?: string;
      price_cents?: number;
      note?: string | null;
    };
  };
}

/** Every table name in the schema. */
export type TableName = keyof Database;

/** The row type of one table: \`Tables<'orders'>\`. */
export type Tables<T extends TableName> = Database[T]['Row'];

/** What INSERT accepts for one table. */
export type TablesInsert<T extends TableName> = Database[T]['Insert'];

/** What a partial UPDATE accepts for one table. */
export type TablesUpdate<T extends TableName> = Database[T]['Update'];
`,
    );
  });

  it('names the schema and the table count in the header', () => {
    const text = emitDatabaseTypes(SMALL);
    expect(text).toContain('Postgres schema "public", 1 table.');
    expect(emitDatabaseTypes(AWKWARD)).toContain('Postgres schema "public", 2 tables.');
  });

  it('tells the reader not to edit it and how to regenerate it', () => {
    const text = emitDatabaseTypes(SMALL, { regenerateCommand: 'npm run types' });
    expect(text).toContain('DO NOT EDIT BY HAND');
    expect(text).toContain('npm run types');
  });

  it('ends with a single trailing newline, so the file needs no fixing up after writing', () => {
    const text = emitDatabaseTypes(SMALL);
    expect(text.endsWith("Database[T]['Update'];\n")).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('parses as TypeScript — the generated file is the one nobody proofreads', () => {
    const output = ts.transpileModule(emitDatabaseTypes(AWKWARD), {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    });
    expect(output.diagnostics ?? []).toEqual([]);
  });
});

describe('Row, Insert and Update say different things', () => {
  it('Row carries every column, with a nullable one widened to include null', () => {
    expect(memberFields(emitDatabaseTypes(SMALL), 'lab__items', 'Row')).toEqual([
      'id: string;',
      'price_cents: number;',
      'note: string | null;',
    ]);
  });

  it('Insert makes a defaulted column optional, because the database supplies it', () => {
    expect(memberFields(emitDatabaseTypes(SMALL), 'lab__items', 'Insert')).toContain('id?: string;');
  });

  it('Insert keeps a column with neither default nor null required', () => {
    expect(memberFields(emitDatabaseTypes(SMALL), 'lab__items', 'Insert')).toContain(
      'price_cents: number;',
    );
  });

  it('Insert makes a nullable column optional but still lets it be set to null', () => {
    expect(memberFields(emitDatabaseTypes(SMALL), 'lab__items', 'Insert')).toContain(
      'note?: string | null;',
    );
  });

  it('Update makes every column optional, including the ones Insert required', () => {
    const fields = memberFields(emitDatabaseTypes(SMALL), 'lab__items', 'Update');
    expect(fields.every((field) => field.includes('?:'))).toBe(true);
  });
});

describe('GENERATED ALWAYS columns', () => {
  const text = emitDatabaseTypes(AWKWARD);

  it('appear in Row, where they are real, and say why they are read-only', () => {
    expect(memberFields(text, 'lab__items', 'Row')).toContain(
      'total_cents: number; // GENERATED ALWAYS — not writable',
    );
  });

  it('are absent from Insert and Update, because Postgres rejects writing them', () => {
    expect(memberFields(text, 'lab__items', 'Insert').join('\n')).not.toContain('total_cents');
    expect(memberFields(text, 'lab__items', 'Update').join('\n')).not.toContain('total_cents');
  });

  it('leave a table whose columns are all generated with Record<string, never>, not {}', () => {
    // `{}` accepts every object in TypeScript, so it would type-check a
    // misspelled column — the opposite of the guarantee being made.
    const generatedOnly = schemaOf({
      name: 'stats',
      columns: [col('total', 'integer', { ordinalPosition: 1, isGeneratedAlways: true })],
    });
    expect(emitDatabaseTypes(generatedOnly)).toContain('    Insert: Record<string, never>;');
  });
});

describe('types that need care', () => {
  const text = emitDatabaseTypes(AWKWARD);

  it('renders an array as an array of its element type', () => {
    expect(memberFields(text, 'lab__items', 'Row')).toContain('tags: string[] | null;');
  });

  it('declares the Json alias once and uses it for jsonb', () => {
    expect(text).toContain('export type Json =');
    expect(memberFields(text, 'lab__items', 'Row')).toContain('meta: Json;');
  });

  it('omits the Json alias entirely when no column needs it', () => {
    expect(emitDatabaseTypes(SMALL)).not.toContain('export type Json');
  });

  it('names the pg type beside an unknown rather than guessing at string', () => {
    expect(memberFields(text, 'lab__items', 'Row')).toContain(
      'search: unknown | null; // unmapped pg type: tsvector',
    );
    expect(memberFields(text, 'lab__orders', 'Row')).toContain(
      'status: unknown; // unmapped pg type: USER-DEFINED (order_status)',
    );
  });
});

describe('identifiers that are not valid TypeScript property names', () => {
  it('quotes a table name containing a hyphen', () => {
    const text = emitDatabaseTypes(
      schemaOf({ name: 'order-items', columns: [col('id', 'uuid', { ordinalPosition: 1 })] }),
    );
    expect(text).toContain("  'order-items': {");
  });

  it('quotes column names with spaces, leading digits and dollar-free punctuation', () => {
    const text = emitDatabaseTypes(
      schemaOf({
        name: 'weird',
        columns: [
          col('2024 total', 'integer', { ordinalPosition: 1 }),
          col('per-unit', 'integer', { ordinalPosition: 2 }),
        ],
      }),
    );
    expect(text).toContain("      '2024 total': number;");
    expect(text).toContain("      'per-unit': number;");
  });

  it('leaves a reserved word unquoted, because it is a legal property name', () => {
    const text = emitDatabaseTypes(
      schemaOf({ name: 'rows', columns: [col('default', 'text', { ordinalPosition: 1 })] }),
    );
    expect(text).toContain('      default: string;');
  });

  it('still parses as TypeScript once the awkward names are quoted', () => {
    const text = emitDatabaseTypes(
      schemaOf({
        name: 'order-items',
        columns: [
          col("it's odd", 'text', { ordinalPosition: 1 }),
          col('2024 total', 'integer', { ordinalPosition: 2 }),
        ],
      }),
    );
    const output = ts.transpileModule(text, { reportDiagnostics: true });
    expect(output.diagnostics ?? []).toEqual([]);
  });
});

describe('quoteIdentifier', () => {
  it('leaves an ordinary identifier alone', () => {
    expect(quoteIdentifier('price_cents')).toBe('price_cents');
    expect(quoteIdentifier('$weird')).toBe('$weird');
    expect(quoteIdentifier('_private')).toBe('_private');
  });

  it('quotes anything that would not parse bare', () => {
    expect(quoteIdentifier('order-items')).toBe("'order-items'");
    expect(quoteIdentifier('2024')).toBe("'2024'");
    expect(quoteIdentifier('has space')).toBe("'has space'");
  });

  it('escapes the quote character so a hostile name cannot end the string early', () => {
    expect(quoteIdentifier("it's")).toBe("'it\\'s'");
    expect(quoteIdentifier('back\\slash')).toBe("'back\\\\slash'");
    expect(quoteIdentifier('two\nlines')).toBe("'two\\nlines'");
  });
});

describe('determinism — the generated file is committed, so it must not churn', () => {
  it('produces byte-identical output for the same schema', () => {
    expect(emitDatabaseTypes(AWKWARD)).toBe(emitDatabaseTypes(AWKWARD));
  });

  it('carries no timestamp, so regenerating an unchanged schema is an empty diff', () => {
    const text = emitDatabaseTypes(SMALL);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text.toLowerCase()).not.toContain('generated at');
  });

  it('sorts tables by name, so the order rows arrived in cannot reorder the file', () => {
    const forwards = emitDatabaseTypes(AWKWARD);
    const backwards = emitDatabaseTypes({
      schema: 'public',
      tables: [...AWKWARD.tables].reverse(),
    });
    expect(backwards).toBe(forwards);
  });

  it('sorts columns by ordinal position rather than by the order they were listed', () => {
    const shuffled = emitDatabaseTypes(
      schemaOf({
        name: 'lab__items',
        columns: [...(SMALL.tables[0]?.columns ?? [])].reverse(),
      }),
    );
    expect(shuffled).toBe(emitDatabaseTypes(SMALL));
  });

  it('falls back to name order when a schema carries no ordinal positions at all', () => {
    const columns = [col('b', 'text'), col('a', 'text')];
    const text = emitDatabaseTypes(schemaOf({ name: 't', columns }));
    expect(memberFields(text, 't', 'Row')).toEqual(['a: string;', 'b: string;']);
  });

  it('compares identifiers by codepoint, not by locale, so another machine agrees', () => {
    // localeCompare would sort these case-insensitively and disagree across
    // ICU builds, reordering the file for whoever regenerates it next.
    expect(['apple', 'Banana', 'Zebra'].sort(compareIdentifiers)).toEqual([
      'Banana',
      'Zebra',
      'apple',
    ]);
  });
});

describe('refusing to emit nothing', () => {
  it('throws rather than writing a Database with no tables in it', () => {
    expect(() => emitDatabaseTypes({ schema: 'public', tables: [] })).toThrow(XenitionError);
  });

  it('names the schema and the two things that actually cause it', () => {
    expect(() => emitDatabaseTypes({ schema: 'shop', tables: [] })).toThrow(
      /schema "shop" has no tables[\s\S]*service key/,
    );
  });

  it('rejects a value that is not an introspected schema at all', () => {
    expect(() => emitDatabaseTypes(undefined as unknown as IntrospectedSchema)).toThrow(
      /introspected schema/,
    );
  });
});
