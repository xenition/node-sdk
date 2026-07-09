import { camelizeKey, normalizeRow, normalizeRows } from './normalize';

describe('camelizeKey', () => {
  it('converts snake_case to camelCase', () => {
    expect(camelizeKey('body_html')).toBe('bodyHtml');
    expect(camelizeKey('created_at')).toBe('createdAt');
    expect(camelizeKey('target_type')).toBe('targetType');
  });

  it('leaves camelCase and single-word keys unchanged', () => {
    expect(camelizeKey('bodyHtml')).toBe('bodyHtml');
    expect(camelizeKey('slug')).toBe('slug');
    expect(camelizeKey('published')).toBe('published');
  });

  it('preserves leading underscores', () => {
    expect(camelizeKey('_sdk_migrations')).toBe('_sdkMigrations');
  });

  it('handles digits and consecutive underscores', () => {
    expect(camelizeKey('utm_source_2')).toBe('utmSource2');
    expect(camelizeKey('a__b')).toBe('aB');
  });
});

describe('normalizeRow', () => {
  it('camelizes top-level snake_case keys (engine runtime rows)', () => {
    const row = {
      id: 'p1',
      body_html: '<h1>Hi</h1>',
      created_at: 't0',
      updated_at: 't1',
      published: true,
    };
    expect(normalizeRow(row)).toEqual({
      id: 'p1',
      bodyHtml: '<h1>Hi</h1>',
      createdAt: 't0',
      updatedAt: 't1',
      published: true,
    });
  });

  it('is a no-op on already-camelCase keys (gateway runtime rows)', () => {
    const row = { id: 'p1', bodyHtml: '<h1>Hi</h1>', createdAt: 't0' };
    expect(normalizeRow(row)).toEqual(row);
  });

  it('never touches inner keys of jsonb payload values', () => {
    const row = {
      id: 'i1',
      collection_id: 'c1',
      data: { hero_image: '/x.png', price_usd: 12, nested: { deep_key: 1 } },
      seo: { og_title: 'X' },
    };
    const normalized = normalizeRow<Record<string, unknown>>(row);
    expect(normalized.collectionId).toBe('c1');
    expect(normalized.data).toEqual({
      hero_image: '/x.png',
      price_usd: 12,
      nested: { deep_key: 1 },
    });
    expect(normalized.seo).toEqual({ og_title: 'X' });
  });

  it('passes through non-object inputs unchanged', () => {
    expect(normalizeRow(null)).toBeNull();
    expect(normalizeRow('x')).toBe('x');
    expect(normalizeRow(42)).toBe(42);
  });
});

describe('normalizeRows', () => {
  it('normalizes every row in an array', () => {
    const rows = [
      { author_name: 'Ada', rating: 5 },
      { authorName: 'Grace', rating: 4 },
    ];
    expect(normalizeRows(rows)).toEqual([
      { authorName: 'Ada', rating: 5 },
      { authorName: 'Grace', rating: 4 },
    ]);
  });

  it('returns an empty array for non-array inputs', () => {
    expect(normalizeRows(undefined)).toEqual([]);
    expect(normalizeRows({ not: 'an array' })).toEqual([]);
  });
});
