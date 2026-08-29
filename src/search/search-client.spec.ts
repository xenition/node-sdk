import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';
import { SearchClient } from './search-client';
import { SearchHit } from './types';

/**
 * The split these tests pin: the gateway camelCases the row it nests inside
 * a search hit but returns `client.query.from(...)` rows verbatim, so the
 * SAME database row was `created_at` when listed and `createdAt` when
 * searched. An app renders both through one component, so `item.created_at`
 * was a date on one screen and `undefined` on the other — no throw, no log.
 * That is the shape of the bug that once let an EXPIRED subscription read as
 * active, and the reason src/modules/row-casing.ts exists.
 *
 * The hit's own fields are the other half of the guarantee: they are the
 * search API's contract, camelCase on purpose, and must survive untouched.
 */
const makeSearch = (result: unknown) => {
  const post = jest.fn().mockResolvedValue(result);
  return { post, search: new SearchClient({ post } as unknown as HttpClient) };
};

const hit = (over: Partial<SearchHit>): SearchHit => ({
  id: 'i1',
  score: 0.91,
  table: 'lab__items',
  ...over,
});

describe('unifiedSearch', () => {
  it('returns each hit row in the same snake_case shape client.query returns', async () => {
    const { search } = makeSearch({
      hits: [hit({ row: { id: '1', createdAt: 'now', priceCents: 250 } })],
      mode: 'hybrid',
      total: 1,
    });
    const { hits } = await search.unifiedSearch('lab__items', 'widget');
    expect(hits[0]!.row).toEqual({ id: '1', created_at: 'now', price_cents: 250 });
  });

  it('leaves the hit envelope alone — id, score, table and highlight are the search API contract', async () => {
    const { search } = makeSearch({
      hits: [
        hit({
          row: { createdAt: 'now' },
          highlight: { title: '<em>widget</em>' },
        }),
      ],
      mode: 'keyword',
      total: 1,
    });
    const { hits, mode, total } = await search.unifiedSearch('lab__items', 'widget');
    expect(hits[0]).toMatchObject({
      id: 'i1',
      score: 0.91,
      table: 'lab__items',
      highlight: { title: '<em>widget</em>' },
    });
    expect(mode).toBe('keyword');
    expect(total).toBe(1);
  });

  it('leaves the indexed payload alone — its keys belong to the app, not the database', async () => {
    // `payload` is the document the app itself handed the indexer. Rewriting
    // its keys would corrupt exactly what the app stored, the same way
    // deepening snakeRow would corrupt a jsonb column.
    const { search } = makeSearch({
      hits: [hit({ row: { createdAt: 'now' }, payload: { sessionId: 's1', userId: 'u1' } })],
      mode: 'semantic',
      total: 1,
    });
    const { hits } = await search.unifiedSearch('lab__items', 'widget');
    expect(hits[0]!.payload).toEqual({ sessionId: 's1', userId: 'u1' });
  });

  it('does not rewrite the inner keys of a jsonb column on the row', async () => {
    const { search } = makeSearch({
      hits: [hit({ row: { createdAt: 'now', metadata: { sourceUrl: 'x', pageCount: 2 } } })],
      mode: 'hybrid',
      total: 1,
    });
    const { hits } = await search.unifiedSearch('lab__items', 'widget');
    expect(hits[0]!.row).toEqual({
      created_at: 'now',
      metadata: { sourceUrl: 'x', pageCount: 2 },
    });
  });

  it('leaves a row that already arrived snake_cased exactly as it was', async () => {
    // The engine answers with the column names verbatim. Normalizing an
    // already-snake row must be a no-op, not a second pass that mangles it.
    const row = { id: '1', created_at: 'now', price_cents: 250 };
    const { search } = makeSearch({ hits: [hit({ row })], mode: 'keyword', total: 1 });
    const { hits } = await search.unifiedSearch('lab__items', 'widget');
    expect(hits[0]!.row).toEqual(row);
  });

  it('returns a hit that carries no row untouched', async () => {
    // Keyword mode can answer with scores alone; a missing row must not
    // become an empty object the caller then reads fields off.
    const { search } = makeSearch({ hits: [hit({})], mode: 'keyword', total: 1 });
    const { hits } = await search.unifiedSearch('lab__items', 'widget');
    expect(hits[0]).toEqual({ id: 'i1', score: 0.91, table: 'lab__items' });
  });

  it('hands back a response with no hits array rather than inventing an empty result', async () => {
    const { search } = makeSearch({ error: 'index not configured' });
    await expect(search.unifiedSearch('lab__items', 'widget')).resolves.toEqual({
      error: 'index not configured',
    });
  });

  it('still sends the table, the query and the options in one request', async () => {
    const { post, search } = makeSearch({ hits: [], mode: 'hybrid', total: 0 });
    await search.unifiedSearch('lab__items', 'widget', { mode: 'hybrid', limit: 20 });
    expect(post).toHaveBeenCalledWith(API_ENDPOINTS.SEARCH.UNIFIED, {
      table: 'lab__items',
      query: 'widget',
      mode: 'hybrid',
      limit: 20,
    });
  });
});
