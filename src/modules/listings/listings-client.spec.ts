import { HttpClient } from '../../core/http-client';
import { API_ENDPOINTS } from '../../constants';
import { MigrationsClient, MIGRATIONS_LEDGER_TABLE } from '../../migrations';
import { QueryClient } from '../../query/query-client';
import { QueryPayload } from '../../query/types';
import { ModuleContext } from '../core';
import { ModulesClient } from '../modules-client';
import { ListingsClient, LISTINGS_TABLE } from './listings-client';
import { CreateListingInput } from './types';

/**
 * Module clients run over a real QueryClient with the http layer mocked
 * (same seam as the query-builder / cms / reviews suites), so every
 * assertion is against the actual IR that would hit `/app-platform/query`.
 */
const makeListings = () => {
  const post = jest.fn();
  const query = new QueryClient({ post } as unknown as HttpClient);
  const ctx: ModuleContext = { query, raw: (sql, params = []) => query.raw(sql, params) };
  return { post, listings: new ListingsClient(ctx) };
};

const payloadOf = (post: jest.Mock, call: number): QueryPayload =>
  post.mock.calls[call]![1] as QueryPayload;

/** Respond to the slug-lookup SELECT with these rows, then succeed the write. */
const primeSlugLookup = (post: jest.Mock, slugs: string[]) => {
  post
    .mockResolvedValueOnce({ data: slugs.map((slug) => ({ slug })) })
    .mockResolvedValueOnce({ data: [] });
};

const input = (overrides: Partial<CreateListingInput> = {}): CreateListingInput => ({
  category: 'apartments',
  title: 'Sunny 2BR Loft',
  ...overrides,
});

// ───────── module lifecycle ─────────

describe('listings module lifecycle', () => {
  const makeHttp = () => {
    const post = jest.fn(
      (url: string, body: { sql?: string; params?: unknown[] }): Promise<{ data: unknown[] }> =>
        Promise.resolve({ data: [] }),
    );
    return { post, http: { post } as unknown as HttpClient };
  };
  const makeModules = () => {
    const { post, http } = makeHttp();
    return { post, modules: new ModulesClient(http, new MigrationsClient(http)) };
  };

  it("enable('listings') runs the module's migrations through the ledger", async () => {
    const { modules, post } = makeModules();
    await modules.enable('listings');
    const sqls = post.mock.calls.map((call) => (call[1] as { sql: string }).sql);
    expect(sqls[0]).toContain(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_LEDGER_TABLE}`);
    expect(sqls.some((sql) => sql.includes(`CREATE TABLE IF NOT EXISTS ${LISTINGS_TABLE}`))).toBe(true);
    expect(sqls.some((sql) => sql.includes('listings__listings_category_idx'))).toBe(true);
    expect(modules.isEnabled('listings')).toBe(true);
  });

  it('after enable, the accessor returns the typed client (cached)', async () => {
    const { modules } = makeModules();
    await modules.enable('listings');
    expect(modules.listings).toBeInstanceOf(ListingsClient);
    expect(modules.listings).toBe(modules.listings);
  });

  it('use() unlocks the accessor without touching the network (anon-key path)', () => {
    const { modules, post } = makeModules();
    modules.use('listings');
    expect(modules.listings).toBeInstanceOf(ListingsClient);
    expect(post).not.toHaveBeenCalled();
  });

  it('accessing listings before enable()/use() throws with the fix in the message', () => {
    const { modules } = makeModules();
    expect(() => modules.listings).toThrow(/not enabled/);
    expect(() => modules.listings).toThrow(/enable\('listings'\)/);
  });
});

// ───────── create + slug generation ─────────

describe('create: slug generation + defaults', () => {
  it('creates a pending listing with a kebab slug and sane defaults', async () => {
    const { post, listings } = makeListings();
    primeSlugLookup(post, []);
    const listing = await listings.create(input({ title: 'Héllo, Wörld! Loft' }));

    expect(listing.slug).toBe('hello-world-loft');
    expect(listing.status).toBe('pending');
    expect(listing.summary).toBe('');
    expect(listing.body).toBe('');
    expect(listing.data).toEqual({});
    expect(listing.featured).toBe(false);
    expect(listing.published_at).toBeNull();
    expect(listing.expires_at).toBeNull();
    expect(listing.id).toMatch(/^[0-9a-f-]{36}$/);

    // Call 0: slug lookup. Call 1: the INSERT carrying the row.
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        type: 'SELECT',
        table: LISTINGS_TABLE,
        columns: ['slug'],
        where: [{ column: 'slug', operator: 'LIKE', value: 'hello-world-loft%', type: 'AND' }],
      }),
    );
    const insert = payloadOf(post, 1);
    expect(insert.type).toBe('INSERT');
    expect(insert.table).toBe(LISTINGS_TABLE);
    expect(post).toHaveBeenCalledWith(API_ENDPOINTS.QUERY.EXECUTE, expect.anything());
  });

  it('omits the three timestamptz columns from the wire insert (DB owns them)', async () => {
    const { post, listings } = makeListings();
    primeSlugLookup(post, []);
    const listing = await listings.create(input());
    const data = payloadOf(post, 1).data as Record<string, unknown>;
    expect(data).not.toHaveProperty('created_at');
    expect(data).not.toHaveProperty('published_at');
    expect(data).not.toHaveProperty('expires_at');
    // Everything else is present and equal to the returned object.
    const { created_at: _c, published_at: _p, expires_at: _e, ...row } = listing;
    expect(data).toEqual(row);
  });

  it('dedupes a taken slug with a -2 suffix', async () => {
    const { post, listings } = makeListings();
    primeSlugLookup(post, ['sunny-2br-loft']);
    const listing = await listings.create(input());
    expect(listing.slug).toBe('sunny-2br-loft-2');
  });

  it('keeps counting past existing suffixes (-2 taken → -3)', async () => {
    const { post, listings } = makeListings();
    primeSlugLookup(post, ['sunny-2br-loft', 'sunny-2br-loft-2', 'sunny-2br-loft-extra']);
    const listing = await listings.create(input());
    expect(listing.slug).toBe('sunny-2br-loft-3');
  });

  it('respects an explicit slug and skips the lookup query entirely', async () => {
    const { post, listings } = makeListings();
    post.mockResolvedValueOnce({ data: [] });
    const listing = await listings.create(input({ slug: 'my-custom-slug' }));
    expect(listing.slug).toBe('my-custom-slug');
    expect(post).toHaveBeenCalledTimes(1); // just the INSERT
    expect(payloadOf(post, 0).type).toBe('INSERT');
  });

  it('carries the jsonb data payload through untouched', async () => {
    const { post, listings } = makeListings();
    primeSlugLookup(post, []);
    const data = { location: 'Berlin', price: '€1200/mo', tags: ['balcony', 'pets-ok'] };
    const listing = await listings.create(input({ data }));
    expect(listing.data).toEqual(data);
    expect((payloadOf(post, 1).data as Record<string, unknown>).data).toEqual(data);
  });
});

describe('create: status matrix + validation', () => {
  it.each(['draft', 'pending', 'published'] as const)(
    'accepts %p as an initial status',
    async (status) => {
      const { post, listings } = makeListings();
      primeSlugLookup(post, []);
      const listing = await listings.create(input({ status }));
      expect(listing.status).toBe(status);
    },
  );

  it.each(['expired', 'archived', 'bogus'])(
    'rejects %p as an initial status (moderation-only / unknown)',
    async (status) => {
      const { listings } = makeListings();
      await expect(
        listings.create(input({ status: status as never })),
      ).rejects.toThrow(/"status" must be one of draft, pending, published at create time/);
    },
  );

  it('validates required strings and typed fields with clear errors', async () => {
    const { listings } = makeListings();
    await expect(listings.create(input({ category: '' }))).rejects.toThrow(
      'ListingsClient.create: "category" must be a non-empty string',
    );
    await expect(listings.create(input({ title: '  ' }))).rejects.toThrow(/"title"/);
    await expect(
      listings.create(input({ data: [1, 2] as unknown as Record<string, unknown> })),
    ).rejects.toThrow(/"data" must be a plain object/);
    await expect(
      listings.create(input({ featured: 1 as unknown as boolean })),
    ).rejects.toThrow(/"featured" must be a boolean/);
    await expect(
      listings.create(input({ summary: 5 as unknown as string })),
    ).rejects.toThrow(/"summary" must be a string/);
  });
});

// ───────── publish / moderate ─────────

describe('publish', () => {
  it('issues a raw UPDATE that stamps published_at via the server-side now()', async () => {
    const { post, listings } = makeListings();
    post.mockResolvedValue({ data: [] });
    await listings.publish('l_1');
    expect(post).toHaveBeenCalledWith(
      API_ENDPOINTS.QUERY.RAW,
      expect.objectContaining({
        sql: expect.stringMatching(/UPDATE .*SET status = 'published', published_at = now\(\) WHERE id = \$1/),
        params: ['l_1'],
      }),
    );
  });

  it('rejects an empty id', async () => {
    const { listings } = makeListings();
    await expect(listings.publish('')).rejects.toThrow(/"id"/);
  });
});

describe('moderate', () => {
  it.each(['draft', 'pending', 'published', 'expired', 'archived'] as const)(
    'flips the status to %p by id',
    async (status) => {
      const { post, listings } = makeListings();
      post.mockResolvedValue({ data: [] });
      await listings.moderate('l_1', status);
      expect(payloadOf(post, 0)).toEqual(
        expect.objectContaining({
          type: 'UPDATE',
          table: LISTINGS_TABLE,
          data: { status },
          where: [{ column: 'id', operator: '=', value: 'l_1', type: 'AND' }],
        }),
      );
    },
  );

  it('rejects unknown statuses and empty ids', async () => {
    const { listings } = makeListings();
    await expect(listings.moderate('l_1', 'starred' as never)).rejects.toThrow(
      /"status" must be one of draft, pending, published, expired, archived/,
    );
    await expect(listings.moderate('', 'published')).rejects.toThrow(/"id"/);
  });
});

// ───────── list ─────────

describe('list', () => {
  it('filters category + published (default) newest first', async () => {
    const { post, listings } = makeListings();
    post.mockResolvedValue({ data: [{ id: 'l1' }] });
    await expect(listings.list('apartments')).resolves.toEqual([{ id: 'l1' }]);
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: LISTINGS_TABLE,
        where: [
          { column: 'category', operator: '=', value: 'apartments', type: 'AND' },
          { column: 'status', operator: '=', value: 'published', type: 'AND' },
        ],
        orderBy: [{ column: 'created_at', direction: 'DESC' }],
      }),
    );
  });

  it('adds the featured filter and honors status/orderBy/direction/limit/offset', async () => {
    const { post, listings } = makeListings();
    post.mockResolvedValue({ data: [] });
    await listings.list('jobs', {
      status: 'draft',
      featured: true,
      orderBy: 'title',
      direction: 'ASC',
      limit: 5,
      offset: 10,
    });
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: LISTINGS_TABLE,
        where: [
          { column: 'category', operator: '=', value: 'jobs', type: 'AND' },
          { column: 'status', operator: '=', value: 'draft', type: 'AND' },
          { column: 'featured', operator: '=', value: true, type: 'AND' },
        ],
        orderBy: [{ column: 'title', direction: 'ASC' }],
        limit: 5,
        offset: 10,
      }),
    );
  });

  it('requires a category', async () => {
    const { listings } = makeListings();
    await expect(listings.list('')).rejects.toThrow(/"category"/);
  });

  it('rejects a non-whitelisted orderBy column', async () => {
    const { listings } = makeListings();
    await expect(
      listings.list('jobs', { orderBy: 'body; DROP TABLE' }),
    ).rejects.toThrow(/"orderBy" must be one of/);
  });

  it('rejects an invalid status filter', async () => {
    const { listings } = makeListings();
    await expect(
      listings.list('jobs', { status: 'live' as never }),
    ).rejects.toThrow(/"status" must be one of draft, pending, published, expired, archived/);
  });
});

// ───────── getBySlug ─────────

describe('getBySlug', () => {
  it('reads published-only by default, limit 1', async () => {
    const { post, listings } = makeListings();
    post.mockResolvedValue({ data: [{ id: 'l1', slug: 'a', status: 'published' }] });
    await expect(listings.getBySlug('a')).resolves.toEqual({
      id: 'l1',
      slug: 'a',
      status: 'published',
    });
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: LISTINGS_TABLE,
        where: [
          { column: 'slug', operator: '=', value: 'a', type: 'AND' },
          { column: 'status', operator: '=', value: 'published', type: 'AND' },
        ],
        limit: 1,
      }),
    );
  });

  it('drops the status filter with { anyStatus: true } (back-office opt-in)', async () => {
    const { post, listings } = makeListings();
    post.mockResolvedValue({ data: [] });
    await listings.getBySlug('draft-slug', { anyStatus: true });
    expect(payloadOf(post, 0).where).toEqual([
      { column: 'slug', operator: '=', value: 'draft-slug', type: 'AND' },
    ]);
  });

  it('resolves null for a missing listing', async () => {
    const { post, listings } = makeListings();
    post.mockResolvedValue({ data: [] });
    await expect(listings.getBySlug('nope')).resolves.toBeNull();
  });

  it('rejects an empty slug', async () => {
    const { listings } = makeListings();
    await expect(listings.getBySlug('')).rejects.toThrow(/"slug"/);
  });
});

// ───────── search ─────────

describe('search', () => {
  it('matches title OR summary (ILIKE) scoped to published + category, with a limit', async () => {
    const { post, listings } = makeListings();
    post.mockResolvedValue({ data: [{ id: 'l1' }] });
    await expect(listings.search('cars', 'civic', { limit: 20 })).resolves.toEqual([{ id: 'l1' }]);
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: LISTINGS_TABLE,
        where: [
          { column: 'status', operator: '=', value: 'published', type: 'AND' },
          { column: 'category', operator: '=', value: 'cars', type: 'AND' },
          { column: 'title', operator: 'ILIKE', value: '%civic%', type: 'AND' },
          { column: 'summary', operator: 'ILIKE', value: '%civic%', type: 'OR' },
        ],
        limit: 20,
      }),
    );
  });

  it('omits the category filter when category is undefined', async () => {
    const { post, listings } = makeListings();
    post.mockResolvedValue({ data: [] });
    await listings.search(undefined, 'loft');
    expect(payloadOf(post, 0).where).toEqual([
      { column: 'status', operator: '=', value: 'published', type: 'AND' },
      { column: 'title', operator: 'ILIKE', value: '%loft%', type: 'AND' },
      { column: 'summary', operator: 'ILIKE', value: '%loft%', type: 'OR' },
    ]);
  });

  it('rejects an empty term', async () => {
    const { listings } = makeListings();
    await expect(listings.search('cars', '  ')).rejects.toThrow(/"term"/);
  });
});

// ───────── categories ─────────

describe('categories', () => {
  it('selects DISTINCT category among published rows', async () => {
    const { post, listings } = makeListings();
    post.mockResolvedValue({ data: [{ category: 'jobs' }, { category: 'cars' }] });
    await listings.categories();
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        type: 'SELECT',
        table: LISTINGS_TABLE,
        columns: ['category'],
        distinct: true,
        where: [{ column: 'status', operator: '=', value: 'published', type: 'AND' }],
      }),
    );
  });

  it('dedupes, drops non-string/empty values, and sorts the result', async () => {
    const { post, listings } = makeListings();
    post.mockResolvedValue({
      data: [
        { category: 'jobs' },
        { category: 'cars' },
        { category: 'jobs' },
        { category: '' },
        { category: null },
        { category: 42 },
      ],
    });
    await expect(listings.categories()).resolves.toEqual(['cars', 'jobs']);
  });
});
