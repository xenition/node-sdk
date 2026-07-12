import { HttpClient } from '../../core/http-client';
import { API_ENDPOINTS } from '../../constants';
import { QueryClient } from '../../query/query-client';
import { QueryPayload } from '../../query/types';
import { ModuleContext } from '../core';
import { CmsClient, CMS_TABLES } from './cms-client';

/**
 * Module clients run over a real QueryClient with the http layer mocked
 * (same seam as the query-builder suite), so every assertion here is
 * against the actual IR that would hit `/app-platform/query`.
 */
const makeCms = () => {
  const post = jest.fn();
  const query = new QueryClient({ post } as unknown as HttpClient);
  const ctx: ModuleContext = { query, raw: (sql, params = []) => query.raw(sql, params) };
  return { post, cms: new CmsClient(ctx) };
};

const payloadOf = (post: jest.Mock, call: number): QueryPayload =>
  post.mock.calls[call]![1] as QueryPayload;

/** Respond to the slug-lookup SELECT with these rows, then succeed the write. */
const primeSlugLookup = (post: jest.Mock, slugs: string[]) => {
  post
    .mockResolvedValueOnce({ data: slugs.map((slug) => ({ slug })) })
    .mockResolvedValueOnce({ data: [] });
};

describe('pages: create + slug generation', () => {
  it('creates a page with kebab slug from the title and sane defaults', async () => {
    const { post, cms } = makeCms();
    primeSlugLookup(post, []);
    const page = await cms.createPage({ title: 'Héllo, Wörld! Page' });

    expect(page.slug).toBe('hello-world-page');
    expect(page.body_html).toBe('');
    expect(page.seo).toEqual({});
    expect(page.published).toBe(false);
    expect(page.sort).toBe(0);
    expect(page.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(page.created_at).toBe(page.updated_at);

    // Call 0: slug lookup. Call 1: the INSERT carrying the full row.
    const lookup = payloadOf(post, 0);
    expect(lookup).toEqual(
      expect.objectContaining({
        type: 'SELECT',
        table: CMS_TABLES.PAGES,
        columns: ['slug'],
        where: [
          { column: 'slug', operator: 'LIKE', value: 'hello-world-page%', type: 'AND' },
        ],
      }),
    );
    const insert = payloadOf(post, 1);
    expect(insert.type).toBe('INSERT');
    expect(insert.table).toBe(CMS_TABLES.PAGES);
    expect(insert.data).toEqual({ ...page });
    expect(post).toHaveBeenCalledWith(API_ENDPOINTS.QUERY.EXECUTE, expect.anything());
  });

  it('dedupes a taken slug with a -2 suffix', async () => {
    const { post, cms } = makeCms();
    primeSlugLookup(post, ['about']);
    const page = await cms.createPage({ title: 'About' });
    expect(page.slug).toBe('about-2');
  });

  it('keeps counting past existing suffixes (-2 taken → -3)', async () => {
    const { post, cms } = makeCms();
    primeSlugLookup(post, ['about', 'about-2', 'about-us']);
    const page = await cms.createPage({ title: 'About' });
    expect(page.slug).toBe('about-3');
  });

  it('respects an explicit slug and skips the lookup query entirely', async () => {
    const { post, cms } = makeCms();
    post.mockResolvedValueOnce({ data: [] });
    const page = await cms.createPage({ title: 'About', slug: 'about-us' });
    expect(page.slug).toBe('about-us');
    expect(post).toHaveBeenCalledTimes(1); // just the INSERT
    expect(payloadOf(post, 0).type).toBe('INSERT');
  });

  it('validates createPage input with clear errors', async () => {
    const { cms } = makeCms();
    await expect(cms.createPage({ title: '' })).rejects.toThrow(
      'CmsClient.createPage: "title" must be a non-empty string',
    );
    await expect(
      cms.createPage({ title: 'x', seo: 'nope' as unknown as Record<string, unknown> }),
    ).rejects.toThrow(/"seo" must be a plain object/);
    await expect(
      cms.createPage({ title: 'x', sort: 'high' as unknown as number }),
    ).rejects.toThrow(/"sort" must be a finite number/);
    await expect(
      cms.createPage({ title: 'x', published: 1 as unknown as boolean }),
    ).rejects.toThrow(/"published" must be a boolean/);
  });
});

describe('pages: read / update / delete IR', () => {
  it('getPageBySlug selects by slug with limit 1', async () => {
    const { post, cms } = makeCms();
    post.mockResolvedValue({ data: [{ id: 'p1', slug: 'about' }] });
    await expect(cms.getPageBySlug('about')).resolves.toEqual({ id: 'p1', slug: 'about' });
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: CMS_TABLES.PAGES,
        where: [{ column: 'slug', operator: '=', value: 'about', type: 'AND' }],
        limit: 1,
      }),
    );
  });

  it('getPageBySlug resolves null for a missing page', async () => {
    const { post, cms } = makeCms();
    post.mockResolvedValue({ data: [] });
    await expect(cms.getPageBySlug('nope')).resolves.toBeNull();
  });

  it('updatePage emits a validated UPDATE and bumps updated_at', async () => {
    const { post, cms } = makeCms();
    post.mockResolvedValue({ data: [] });
    await cms.updatePage('p1', { title: 'New title', published: true });
    const payload = payloadOf(post, 0);
    expect(payload.type).toBe('UPDATE');
    expect(payload.where).toEqual([{ column: 'id', operator: '=', value: 'p1', type: 'AND' }]);
    expect(payload.data).toEqual(
      expect.objectContaining({ title: 'New title', published: true }),
    );
    expect((payload.data as Record<string, unknown>).updated_at).toEqual(expect.any(String));
  });

  it('updatePage rejects an empty patch and invalid patch values', async () => {
    const { cms } = makeCms();
    await expect(cms.updatePage('p1', {})).rejects.toThrow(/at least one field/);
    await expect(cms.updatePage('p1', { title: '' })).rejects.toThrow(/"title"/);
    await expect(cms.updatePage('', { title: 'x' })).rejects.toThrow(/"id"/);
  });

  it('deletePage issues a hard DELETE by id', async () => {
    const { post, cms } = makeCms();
    post.mockResolvedValue({ data: [] });
    await cms.deletePage('p1');
    expect(payloadOf(post, 0)).toEqual({
      type: 'DELETE',
      table: CMS_TABLES.PAGES,
      where: [{ column: 'id', operator: '=', value: 'p1', type: 'AND' }],
    });
  });

  it('listPages filters on published and orders by a whitelisted column', async () => {
    const { post, cms } = makeCms();
    post.mockResolvedValue({ data: [] });
    await cms.listPages({ published: true, orderBy: 'created_at', direction: 'DESC', limit: 10 });
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: CMS_TABLES.PAGES,
        where: [{ column: 'published', operator: '=', value: true, type: 'AND' }],
        orderBy: [{ column: 'created_at', direction: 'DESC' }],
        limit: 10,
      }),
    );
  });

  it('listPages rejects a non-whitelisted orderBy column', async () => {
    const { cms } = makeCms();
    await expect(cms.listPages({ orderBy: 'body_html; DROP TABLE' })).rejects.toThrow(
      /"orderBy" must be one of/,
    );
  });
});

describe('collections', () => {
  it('ensureCollection returns the existing row without inserting', async () => {
    const { post, cms } = makeCms();
    const existing = { id: 'c1', key: 'menu', name: 'Menu' };
    post.mockResolvedValue({ data: [existing] });
    await expect(cms.ensureCollection('menu')).resolves.toEqual(existing);
    expect(post).toHaveBeenCalledTimes(1); // lookup only
  });

  it('ensureCollection creates a missing collection (name defaults to key)', async () => {
    const { post, cms } = makeCms();
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    const collection = await cms.ensureCollection('speakers');
    expect(collection).toEqual(
      expect.objectContaining({ key: 'speakers', name: 'speakers' }),
    );
    const insert = payloadOf(post, 1);
    expect(insert.type).toBe('INSERT');
    expect(insert.table).toBe(CMS_TABLES.COLLECTIONS);
    expect(insert.data).toEqual({ ...collection });
  });
});

describe('items', () => {
  const collection = { id: 'c1', key: 'menu', name: 'Menu' };

  it('createItem resolves the collection, scopes slug dedupe to it, and inserts', async () => {
    const { post, cms } = makeCms();
    post
      .mockResolvedValueOnce({ data: [collection] }) // getCollection
      .mockResolvedValueOnce({ data: [{ slug: 'espresso' }] }) // slug lookup
      .mockResolvedValueOnce({ data: [] }); // insert
    const item = await cms.createItem('menu', { title: 'Espresso', data: { price: 3.5 } });

    expect(item.collection_id).toBe('c1');
    expect(item.slug).toBe('espresso-2');
    expect(item.data).toEqual({ price: 3.5 });

    const slugLookup = payloadOf(post, 1);
    expect(slugLookup.where).toEqual([
      { column: 'slug', operator: 'LIKE', value: 'espresso%', type: 'AND' },
      { column: 'collection_id', operator: '=', value: 'c1', type: 'AND' },
    ]);
    const insert = payloadOf(post, 2);
    expect(insert.type).toBe('INSERT');
    expect(insert.table).toBe(CMS_TABLES.ITEMS);
    expect(insert.data).toEqual({ ...item });
  });

  it('createItem fails fast on an unknown collection', async () => {
    const { post, cms } = makeCms();
    post.mockResolvedValue({ data: [] });
    await expect(cms.createItem('ghosts', { title: 'x' })).rejects.toThrow(
      /unknown collection "ghosts" — call ensureCollection/,
    );
    expect(post).toHaveBeenCalledTimes(1); // stopped after the lookup
  });

  it('listItems scopes to the collection and honors published/orderBy', async () => {
    const { post, cms } = makeCms();
    post.mockResolvedValueOnce({ data: [collection] }).mockResolvedValueOnce({ data: [] });
    await cms.listItems('menu', { published: true });
    expect(payloadOf(post, 1)).toEqual(
      expect.objectContaining({
        table: CMS_TABLES.ITEMS,
        where: [
          { column: 'collection_id', operator: '=', value: 'c1', type: 'AND' },
          { column: 'published', operator: '=', value: true, type: 'AND' },
        ],
        orderBy: [{ column: 'sort', direction: 'ASC' }],
      }),
    );
  });

  it('getItemBySlug queries within the collection', async () => {
    const { post, cms } = makeCms();
    const row = { id: 'i1', slug: 'espresso', collection_id: 'c1' };
    post.mockResolvedValueOnce({ data: [collection] }).mockResolvedValueOnce({ data: [row] });
    await expect(cms.getItemBySlug('menu', 'espresso')).resolves.toEqual(row);
    expect(payloadOf(post, 1).where).toEqual([
      { column: 'collection_id', operator: '=', value: 'c1', type: 'AND' },
      { column: 'slug', operator: '=', value: 'espresso', type: 'AND' },
    ]);
  });

  it('updateItem validates the jsonb data field and bumps updated_at', async () => {
    const { post, cms } = makeCms();
    post.mockResolvedValue({ data: [] });
    await cms.updateItem('i1', { data: { price: 4 }, sort: 2 });
    const payload = payloadOf(post, 0);
    expect(payload.type).toBe('UPDATE');
    expect(payload.data).toEqual(
      expect.objectContaining({ data: { price: 4 }, sort: 2, updated_at: expect.any(String) }),
    );
    await expect(
      cms.updateItem('i1', { data: [1, 2] as unknown as Record<string, unknown> }),
    ).rejects.toThrow(/"data" must be a plain object/);
  });

  it('deleteItem issues a hard DELETE by id', async () => {
    const { post, cms } = makeCms();
    post.mockResolvedValue({ data: [] });
    await cms.deleteItem('i1');
    expect(payloadOf(post, 0)).toEqual({
      type: 'DELETE',
      table: CMS_TABLES.ITEMS,
      where: [{ column: 'id', operator: '=', value: 'i1', type: 'AND' }],
    });
  });
});
