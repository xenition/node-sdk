import { HttpClient } from '../../core/http-client';
import { API_ENDPOINTS } from '../../constants';
import { MigrationsClient, MIGRATIONS_LEDGER_TABLE } from '../../migrations';
import { QueryClient } from '../../query/query-client';
import { QueryPayload } from '../../query/types';
import { ModuleContext } from '../core';
import { ModulesClient } from '../modules-client';
import { CatalogClient, CATALOG_TABLES } from './catalog-client';

/**
 * Module clients run over a real QueryClient with the http layer mocked
 * (same seam as the query-builder / cms suites), so every assertion is
 * against the actual IR that would hit `/app-platform/query`.
 */
const makeCatalog = () => {
  const post = jest.fn();
  const query = new QueryClient({ post } as unknown as HttpClient);
  const ctx: ModuleContext = { query, raw: (sql, params = []) => query.raw(sql, params) };
  return { post, catalog: new CatalogClient(ctx) };
};

const payloadOf = (post: jest.Mock, call: number): QueryPayload =>
  post.mock.calls[call]![1] as QueryPayload;

const UUID_RE = /^[0-9a-f-]{36}$/;

describe('collections', () => {
  it('creates a collection with a kebab slug and omits created_at from the insert', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    const collection = await catalog.createCollection({ title: 'Summer Sale!' });

    expect(collection.slug).toBe('summer-sale');
    expect(collection.description).toBe('');
    expect(collection.sort).toBe(0);
    expect(collection.id).toMatch(UUID_RE);
    expect(collection.created_at).toEqual(expect.any(String));

    const lookup = payloadOf(post, 0);
    expect(lookup).toEqual(
      expect.objectContaining({
        type: 'SELECT',
        table: CATALOG_TABLES.COLLECTIONS,
        columns: ['slug'],
        where: [{ column: 'slug', operator: 'LIKE', value: 'summer-sale%', type: 'AND' }],
      }),
    );
    const insert = payloadOf(post, 1);
    expect(insert.type).toBe('INSERT');
    expect(insert.table).toBe(CATALOG_TABLES.COLLECTIONS);
    // created_at is owned by the DB default — never on the wire.
    expect(insert.data).not.toHaveProperty('created_at');
    expect(insert.data).toEqual(
      expect.objectContaining({ id: collection.id, slug: 'summer-sale', title: 'Summer Sale!' }),
    );
  });

  it('dedupes a taken collection slug with -2', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValueOnce({ data: [{ slug: 'shoes' }] }).mockResolvedValueOnce({ data: [] });
    const collection = await catalog.createCollection({ title: 'Shoes' });
    expect(collection.slug).toBe('shoes-2');
  });

  it('respects an explicit slug and skips the lookup', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValueOnce({ data: [] });
    const collection = await catalog.createCollection({ title: 'Shoes', slug: 'footwear' });
    expect(collection.slug).toBe('footwear');
    expect(post).toHaveBeenCalledTimes(1);
    expect(payloadOf(post, 0).type).toBe('INSERT');
  });

  it('validates createCollection input', async () => {
    const { catalog } = makeCatalog();
    await expect(catalog.createCollection({ title: '' })).rejects.toThrow(
      'CatalogClient.createCollection: "title" must be a non-empty string',
    );
  });

  it('getCollection selects by slug with limit 1 and resolves null when missing', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValueOnce({ data: [{ id: 'c1', slug: 'shoes' }] });
    await expect(catalog.getCollection('shoes')).resolves.toEqual({ id: 'c1', slug: 'shoes' });
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: CATALOG_TABLES.COLLECTIONS,
        where: [{ column: 'slug', operator: '=', value: 'shoes', type: 'AND' }],
        limit: 1,
      }),
    );
    post.mockResolvedValueOnce({ data: [] });
    await expect(catalog.getCollection('nope')).resolves.toBeNull();
  });

  it('listCollections orders by sort then title', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValueOnce({ data: [] });
    await catalog.listCollections();
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: CATALOG_TABLES.COLLECTIONS,
        orderBy: [
          { column: 'sort', direction: 'ASC' },
          { column: 'title', direction: 'ASC' },
        ],
      }),
    );
  });
});

describe('products: create', () => {
  it('creates a draft product with a kebab slug and omits null nullable columns', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    const product = await catalog.createProduct({ title: 'Classic Tee' });

    expect(product.slug).toBe('classic-tee');
    expect(product.status).toBe('draft');
    expect(product.collection_id).toBeNull();
    expect(product.image_url).toBeNull();
    expect(product.data).toEqual({});
    expect(product.variants).toEqual([]);

    const insert = payloadOf(post, 1);
    expect(insert.type).toBe('INSERT');
    expect(insert.table).toBe(CATALOG_TABLES.PRODUCTS);
    expect(insert.data).not.toHaveProperty('created_at');
    // Unset nullable columns are omitted so the DB stores NULL.
    expect(insert.data).not.toHaveProperty('collection_id');
    expect(insert.data).not.toHaveProperty('image_url');
    expect(insert.data).toEqual(
      expect.objectContaining({ slug: 'classic-tee', status: 'draft', data: {}, sort: 0 }),
    );
  });

  it('includes collectionId, imageUrl and status when provided', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    const product = await catalog.createProduct({
      title: 'Hoodie',
      collectionId: 'col_1',
      imageUrl: 'https://cdn/x.png',
      status: 'published',
      data: { tags: ['warm'] },
    });
    expect(product.collection_id).toBe('col_1');
    expect(product.status).toBe('published');
    const insert = payloadOf(post, 1);
    expect(insert.data).toEqual(
      expect.objectContaining({
        collection_id: 'col_1',
        image_url: 'https://cdn/x.png',
        status: 'published',
        data: { tags: ['warm'] },
      }),
    );
  });

  it('creates a product with an initial variants[] array (nested) — one bulk variant insert', async () => {
    const { post, catalog } = makeCatalog();
    post
      .mockResolvedValueOnce({ data: [] }) // slug lookup
      .mockResolvedValueOnce({ data: [] }) // product insert
      .mockResolvedValueOnce({ data: [] }); // variants bulk insert
    const product = await catalog.createProduct({
      title: 'Sneaker',
      status: 'published',
      variants: [
        { title: 'S', priceCents: 5000, options: { size: 'S' } },
        { title: 'M', priceCents: 5500, sku: 'SNK-M', compareAtCents: 6000 },
      ],
    });

    expect(product.variants).toHaveLength(2);
    expect(product.variants[0]!.price_cents).toBe(5000);
    expect(product.variants[0]!.product_id).toBe(product.id);
    expect(product.variants[1]!.compare_at_cents).toBe(6000);

    const variantInsert = payloadOf(post, 2);
    expect(variantInsert.type).toBe('INSERT');
    expect(variantInsert.table).toBe(CATALOG_TABLES.VARIANTS);
    const rows = variantInsert.data as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({ title: 'S', price_cents: 5000, currency: 'USD', options: { size: 'S' } }),
    );
    // First variant has no sku/compareAt — those nullable columns are omitted.
    expect(rows[0]).not.toHaveProperty('sku');
    expect(rows[0]).not.toHaveProperty('compare_at_cents');
    expect(rows[0]).not.toHaveProperty('created_at');
    expect(rows[1]).toEqual(
      expect.objectContaining({ sku: 'SNK-M', price_cents: 5500, compare_at_cents: 6000 }),
    );
  });

  it('keeps prices as integer minor units and rejects floats', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValue({ data: [] });
    await expect(
      catalog.createProduct({ title: 'x', slug: 'x', variants: [{ priceCents: 19.99 }] }),
    ).rejects.toThrow(/"priceCents" must be a non-negative integer/);
  });

  it('rejects a negative price', async () => {
    const { catalog } = makeCatalog();
    await expect(
      catalog.createProduct({ title: 'x', slug: 'x', variants: [{ priceCents: -1 }] }),
    ).rejects.toThrow(/"priceCents" must be a non-negative integer/);
  });

  it('rejects a non-array variants field and an empty title', async () => {
    const { catalog } = makeCatalog();
    await expect(catalog.createProduct({ title: '' })).rejects.toThrow(/"title"/);
    await expect(
      catalog.createProduct({ title: 'x', slug: 'x', variants: {} as never }),
    ).rejects.toThrow(/"variants" must be an array/);
  });

  it('rejects an invalid status', async () => {
    const { catalog } = makeCatalog();
    await expect(
      catalog.createProduct({ title: 'x', slug: 'x', status: 'archived' as never }),
    ).rejects.toThrow(/"status" must be one of draft, published/);
  });
});

describe('products: read', () => {
  const product = { id: 'p1', slug: 'tee', status: 'published' as const };

  it('getProduct returns a published product plus its variants (ordered by sort)', async () => {
    const { post, catalog } = makeCatalog();
    post
      .mockResolvedValueOnce({ data: [product] })
      .mockResolvedValueOnce({ data: [{ id: 'v1', product_id: 'p1', price_cents: 5000 }] });
    const result = await catalog.getProduct('tee');
    expect(result).toEqual({ ...product, variants: [{ id: 'v1', product_id: 'p1', price_cents: 5000 }] });

    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: CATALOG_TABLES.PRODUCTS,
        where: [{ column: 'slug', operator: '=', value: 'tee', type: 'AND' }],
        limit: 1,
      }),
    );
    expect(payloadOf(post, 1)).toEqual(
      expect.objectContaining({
        table: CATALOG_TABLES.VARIANTS,
        where: [{ column: 'product_id', operator: '=', value: 'p1', type: 'AND' }],
        orderBy: [{ column: 'sort', direction: 'ASC' }],
      }),
    );
  });

  it('getProduct hides a draft by default (public) but returns it with anyStatus', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValueOnce({ data: [{ id: 'p2', slug: 'wip', status: 'draft' }] });
    await expect(catalog.getProduct('wip')).resolves.toBeNull();
    expect(post).toHaveBeenCalledTimes(1); // never fetched variants

    post
      .mockResolvedValueOnce({ data: [{ id: 'p2', slug: 'wip', status: 'draft' }] })
      .mockResolvedValueOnce({ data: [] });
    const draft = await catalog.getProduct('wip', { anyStatus: true });
    expect(draft).toEqual(expect.objectContaining({ id: 'p2', status: 'draft', variants: [] }));
  });

  it('getProduct resolves null for an unknown slug', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValueOnce({ data: [] });
    await expect(catalog.getProduct('ghost')).resolves.toBeNull();
  });

  it('listProducts defaults to published-only ordered by sort', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValueOnce({ data: [] });
    await catalog.listProducts();
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: CATALOG_TABLES.PRODUCTS,
        where: [{ column: 'status', operator: '=', value: 'published', type: 'AND' }],
        orderBy: [{ column: 'sort', direction: 'ASC' }],
      }),
    );
  });

  it("listProducts status:'all' skips the status filter", async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValueOnce({ data: [] });
    await catalog.listProducts({ status: 'all' });
    expect(payloadOf(post, 0).where).toBeUndefined();
  });

  it('listProducts resolves a collection slug to its id and filters on it', async () => {
    const { post, catalog } = makeCatalog();
    post
      .mockResolvedValueOnce({ data: [{ id: 'c9', slug: 'shoes' }] }) // getCollection
      .mockResolvedValueOnce({ data: [] }); // products
    await catalog.listProducts({ collection: 'shoes', limit: 5, offset: 10, direction: 'DESC' });
    expect(payloadOf(post, 1)).toEqual(
      expect.objectContaining({
        table: CATALOG_TABLES.PRODUCTS,
        where: [
          { column: 'collection_id', operator: '=', value: 'c9', type: 'AND' },
          { column: 'status', operator: '=', value: 'published', type: 'AND' },
        ],
        orderBy: [{ column: 'sort', direction: 'DESC' }],
        limit: 5,
        offset: 10,
      }),
    );
  });

  it('listProducts returns [] for an unknown collection (only the lookup runs)', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValueOnce({ data: [] });
    await expect(catalog.listProducts({ collection: 'ghost' })).resolves.toEqual([]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('listProducts rejects a non-whitelisted orderBy', async () => {
    const { catalog } = makeCatalog();
    await expect(catalog.listProducts({ orderBy: 'price_cents; DROP' })).rejects.toThrow(
      /"orderBy" must be one of/,
    );
  });
});

describe('products: update / publish', () => {
  it('updateProduct emits a validated UPDATE (collectionId/imageUrl accept null)', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValue({ data: [] });
    await catalog.updateProduct('p1', {
      title: 'New',
      collectionId: null,
      imageUrl: null,
      sort: 3,
    });
    const payload = payloadOf(post, 0);
    expect(payload.type).toBe('UPDATE');
    expect(payload.where).toEqual([{ column: 'id', operator: '=', value: 'p1', type: 'AND' }]);
    expect(payload.data).toEqual({ title: 'New', collection_id: null, image_url: null, sort: 3 });
  });

  it('updateProduct rejects an empty patch', async () => {
    const { catalog } = makeCatalog();
    await expect(catalog.updateProduct('p1', {})).rejects.toThrow(/at least one field/);
  });

  it('publish flips status to published', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValue({ data: [] });
    await catalog.publish('p1');
    expect(payloadOf(post, 0)).toEqual({
      type: 'UPDATE',
      table: CATALOG_TABLES.PRODUCTS,
      data: { status: 'published' },
      where: [{ column: 'id', operator: '=', value: 'p1', type: 'AND' }],
    });
  });

  it('publish requires an id', async () => {
    const { catalog } = makeCatalog();
    await expect(catalog.publish('')).rejects.toThrow(/"id"/);
  });
});

describe('variants: CRUD', () => {
  it('addVariant inserts and returns the stored variant (price stays integer)', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValueOnce({ data: [] });
    const variant = await catalog.addVariant('p1', { title: 'L', priceCents: 7000, sku: 'X-L' });
    expect(variant.price_cents).toBe(7000);
    expect(variant.product_id).toBe('p1');
    expect(variant.currency).toBe('USD');
    const insert = payloadOf(post, 0);
    expect(insert.type).toBe('INSERT');
    expect(insert.table).toBe(CATALOG_TABLES.VARIANTS);
    expect(insert.data).not.toHaveProperty('created_at');
    expect(insert.data).toEqual(
      expect.objectContaining({ product_id: 'p1', title: 'L', price_cents: 7000, sku: 'X-L' }),
    );
  });

  it('addVariant requires a productId and rejects a float price', async () => {
    const { catalog } = makeCatalog();
    await expect(catalog.addVariant('', { priceCents: 100 })).rejects.toThrow(/"productId"/);
    await expect(catalog.addVariant('p1', { priceCents: 9.99 })).rejects.toThrow(
      /"priceCents" must be a non-negative integer/,
    );
  });

  it('listVariants scopes to the product and orders by sort', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValueOnce({ data: [] });
    await catalog.listVariants('p1');
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: CATALOG_TABLES.VARIANTS,
        where: [{ column: 'product_id', operator: '=', value: 'p1', type: 'AND' }],
        orderBy: [{ column: 'sort', direction: 'ASC' }],
      }),
    );
  });

  it('getVariant selects by id and resolves null when missing', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValueOnce({ data: [{ id: 'v1', price_cents: 500 }] });
    await expect(catalog.getVariant('v1')).resolves.toEqual({ id: 'v1', price_cents: 500 });
    post.mockResolvedValueOnce({ data: [] });
    await expect(catalog.getVariant('nope')).resolves.toBeNull();
  });

  it('updateVariant validates price, uppercases currency, and clears sku with null', async () => {
    const { post, catalog } = makeCatalog();
    post.mockResolvedValue({ data: [] });
    await catalog.updateVariant('v1', { priceCents: 8000, currency: 'eur', sku: null });
    const payload = payloadOf(post, 0);
    expect(payload.type).toBe('UPDATE');
    expect(payload.data).toEqual({ price_cents: 8000, currency: 'EUR', sku: null });
  });

  it('updateVariant rejects an empty patch and a bad currency', async () => {
    const { catalog } = makeCatalog();
    await expect(catalog.updateVariant('v1', {})).rejects.toThrow(/at least one field/);
    await expect(catalog.updateVariant('v1', { currency: 'dollars' })).rejects.toThrow(
      /"currency" must be a 3-letter/,
    );
  });
});

describe('catalog module lifecycle', () => {
  const makeModules = () => {
    const post = jest.fn(
      (_url: string, _body: { sql?: string; params?: unknown[] }): Promise<{ data: unknown[] }> =>
        Promise.resolve({ data: [] }),
    );
    const http = { post } as unknown as HttpClient;
    return { post, modules: new ModulesClient(http, new MigrationsClient(http)) };
  };

  it("enable('catalog') runs the three table migrations through the ledger", async () => {
    const { modules, post } = makeModules();
    await modules.enable('catalog');
    const sqls = post.mock.calls.map((call) => (call[1] as { sql: string }).sql);
    expect(sqls[0]).toContain(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_LEDGER_TABLE}`);
    expect(sqls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS catalog__collections'))).toBe(true);
    expect(sqls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS catalog__products'))).toBe(true);
    expect(sqls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS catalog__variants'))).toBe(true);
    expect(modules.isEnabled('catalog')).toBe(true);
  });

  it('after enable, the accessor returns a CatalogClient', async () => {
    const { modules } = makeModules();
    await modules.enable('catalog');
    expect(modules.catalog).toBeInstanceOf(CatalogClient);
    expect(modules.catalog).toBe(modules.catalog); // cached
  });
});
