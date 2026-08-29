import { JSON_TYPE_NAME, mapPgType, usesJsonType } from './pg-types';

const map = (dataType: string, udtName?: string) => mapPgType({ dataType, udtName }).ts;

describe('mapping the types a Xenition app actually uses', () => {
  it('types uuid, text and varchar as string under either spelling', () => {
    expect(map('uuid', 'uuid')).toBe('string');
    expect(map('text', 'text')).toBe('string');
    expect(map('character varying', 'varchar')).toBe('string');
    expect(map('character', 'bpchar')).toBe('string');
  });

  it('types every integer and decimal width as number', () => {
    expect(map('smallint', 'int2')).toBe('number');
    expect(map('integer', 'int4')).toBe('number');
    expect(map('bigint', 'int8')).toBe('number');
    expect(map('numeric', 'numeric')).toBe('number');
    expect(map('double precision', 'float8')).toBe('number');
  });

  it('types boolean as boolean', () => {
    expect(map('boolean', 'bool')).toBe('boolean');
  });

  it('types timestamps and dates as string, because that is what crosses JSON', () => {
    expect(map('timestamp with time zone', 'timestamptz')).toBe('string');
    expect(map('timestamp without time zone', 'timestamp')).toBe('string');
    expect(map('date', 'date')).toBe('string');
    expect(map('time without time zone', 'time')).toBe('string');
  });

  it('types json and jsonb as the permissive Json alias rather than any', () => {
    expect(map('json', 'json')).toBe(JSON_TYPE_NAME);
    expect(map('jsonb', 'jsonb')).toBe(JSON_TYPE_NAME);
  });

  it('recognises a type whose modifier came along for the ride', () => {
    expect(map('character varying(255)', 'varchar')).toBe('string');
    expect(map('numeric(12, 2)', 'numeric')).toBe('number');
  });

  it('is indifferent to the case the gateway reports the type in', () => {
    expect(map('TEXT', 'TEXT')).toBe('string');
    expect(map('Timestamp With Time Zone')).toBe('string');
  });
});

describe('arrays', () => {
  it('recovers the element type from udt_name, which is the only place it survives', () => {
    expect(map('ARRAY', '_text')).toBe('string[]');
    expect(map('ARRAY', '_int4')).toBe('number[]');
    expect(map('ARRAY', '_jsonb')).toBe(`${JSON_TYPE_NAME}[]`);
  });

  it('also understands a gateway that spells the type `text[]`', () => {
    expect(map('text[]')).toBe('string[]');
  });

  it('keeps the array when the element type is unrecognised, and names the element', () => {
    const mapped = mapPgType({ dataType: 'ARRAY', udtName: '_geometry' });
    expect(mapped.ts).toBe('unknown[]');
    expect(mapped.unmappedPgType).toBe('geometry');
  });

  it('still reports an array when udt_name is missing entirely', () => {
    const mapped = mapPgType({ dataType: 'ARRAY' });
    expect(mapped.ts).toBe('unknown[]');
    expect(mapped.unmappedPgType).toBe('ARRAY');
  });
});

describe('types we refuse to guess at', () => {
  it('falls back to unknown and names the pg type instead of inventing one', () => {
    const mapped = mapPgType({ dataType: 'tsvector', udtName: 'tsvector' });
    expect(mapped.ts).toBe('unknown');
    expect(mapped.unmappedPgType).toBe('tsvector');
  });

  it('names the enum behind a USER-DEFINED column, which is the actionable part', () => {
    const mapped = mapPgType({ dataType: 'USER-DEFINED', udtName: 'order_status' });
    expect(mapped.ts).toBe('unknown');
    expect(mapped.unmappedPgType).toBe('USER-DEFINED (order_status)');
  });

  it('leaves bytea, interval and money unknown rather than plausibly wrong', () => {
    expect(map('bytea', 'bytea')).toBe('unknown');
    expect(map('interval', 'interval')).toBe('unknown');
    expect(map('money', 'money')).toBe('unknown');
  });

  it('does not crash on a column the gateway described with nothing at all', () => {
    const mapped = mapPgType({ dataType: '' });
    expect(mapped.ts).toBe('unknown');
    expect(mapped.unmappedPgType).toBe('unknown');
  });
});

describe('usesJsonType', () => {
  it('is true only for the alias and arrays of it, so the alias is emitted when needed', () => {
    expect(usesJsonType({ ts: 'Json' })).toBe(true);
    expect(usesJsonType({ ts: 'Json[]' })).toBe(true);
    expect(usesJsonType({ ts: 'string' })).toBe(false);
    expect(usesJsonType({ ts: 'unknown' })).toBe(false);
  });
});
