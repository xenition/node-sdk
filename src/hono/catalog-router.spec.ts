import type { XenitionClient } from '../xenition-client';
import { catalogRouter } from './catalog-router';

const makeClient = () => {
  const catalog = {
    listProducts: jest.fn(),
    getProduct: jest.fn(),
    listCollections: jest.fn(),
    getCollection: jest.fn(),
  };
  const use = jest.fn();
  const client = { modules: { use, catalog } } as unknown as XenitionClient;
  return { client, catalog, use };
};

describe('GET /catalog/products', () => {
  it('lists products normalized to camelCase and forwards filters', async () => {
    const { client, catalog, use } = makeClient();
    catalog.listProducts.mockResolvedValue([
      { id: 'p1', slug: 'tee', collection_id: 'c1', image_url: 'x', created_at: 't0' },
    ]);
    const res = await catalogRouter({ client }).request(
      '/catalog/products?collection=shoes&status=all&limit=5&offset=10&direction=DESC',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.products).toEqual([
      expect.objectContaining({ id: 'p1', collectionId: 'c1', imageUrl: 'x', createdAt: 't0' }),
    ]);
    expect(catalog.listProducts).toHaveBeenCalledWith({
      collection: 'shoes',
      status: 'all',
      orderBy: undefined,
      direction: 'DESC',
      limit: 5,
      offset: 10,
    });
    expect(use).toHaveBeenCalledWith('catalog');
  });

  it('400s a bad limit query param', async () => {
    const { client } = makeClient();
    const res = await catalogRouter({ client }).request('/catalog/products?limit=-3');
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.message).toContain('"limit"');
  });
});

describe('GET /catalog/products/:slug', () => {
  it('returns the product camelCased with its variants', async () => {
    const { client, catalog } = makeClient();
    catalog.getProduct.mockResolvedValue({
      id: 'p1',
      slug: 'tee',
      status: 'published',
      image_url: 'x',
      variants: [{ id: 'v1', product_id: 'p1', price_cents: 5000, compare_at_cents: 6000 }],
    });
    const res = await catalogRouter({ client }).request('/catalog/products/tee');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual(
      expect.objectContaining({ id: 'p1', slug: 'tee', imageUrl: 'x' }),
    );
    expect(body).not.toHaveProperty('variants.0.product_id');
    expect(body.variants).toEqual([
      expect.objectContaining({ productId: 'p1', priceCents: 5000, compareAtCents: 6000 }),
    ]);
    expect(catalog.getProduct).toHaveBeenCalledWith('tee');
  });

  it('404s an unknown / unpublished product', async () => {
    const { client, catalog } = makeClient();
    catalog.getProduct.mockResolvedValue(null);
    const res = await catalogRouter({ client }).request('/catalog/products/ghost');
    expect(res.status).toBe(404);
    expect((await res.json() as any).error.code).toBe('NOT_FOUND');
  });
});

describe('GET /catalog/collections', () => {
  it('lists collections camelCased', async () => {
    const { client, catalog } = makeClient();
    catalog.listCollections.mockResolvedValue([
      { id: 'c1', slug: 'shoes', title: 'Shoes', created_at: 't0' },
    ]);
    const res = await catalogRouter({ client }).request('/catalog/collections');
    expect(res.status).toBe(200);
    expect((await res.json() as any).collections).toEqual([
      expect.objectContaining({ id: 'c1', slug: 'shoes', createdAt: 't0' }),
    ]);
  });
});

describe('GET /catalog/collections/:slug/products', () => {
  it('returns the collection plus its products, scoped by slug', async () => {
    const { client, catalog } = makeClient();
    catalog.getCollection.mockResolvedValue({ id: 'c1', slug: 'shoes', title: 'Shoes', created_at: 't0' });
    catalog.listProducts.mockResolvedValue([{ id: 'p1', slug: 'runner', created_at: 't1' }]);
    const res = await catalogRouter({ client }).request('/catalog/collections/shoes/products');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.collection).toEqual(expect.objectContaining({ id: 'c1', createdAt: 't0' }));
    expect(body.products).toEqual([expect.objectContaining({ id: 'p1', createdAt: 't1' })]);
    expect(catalog.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'shoes' }),
    );
  });

  it('404s an unknown collection without listing products', async () => {
    const { client, catalog } = makeClient();
    catalog.getCollection.mockResolvedValue(null);
    const res = await catalogRouter({ client }).request('/catalog/collections/ghost/products');
    expect(res.status).toBe(404);
    expect(catalog.listProducts).not.toHaveBeenCalled();
  });
});
