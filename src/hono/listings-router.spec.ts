import type { XenitionClient } from '../xenition-client';
import { listingsRouter } from './listings-router';

const makeClient = () => {
  const listings = {
    list: jest.fn(),
    getBySlug: jest.fn(),
    categories: jest.fn(),
    create: jest.fn(),
  };
  const use = jest.fn();
  const client = { modules: { use, listings } } as unknown as XenitionClient;
  return { client, listings, use };
};

const postJson = (
  app: ReturnType<typeof listingsRouter>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('GET /', () => {
  it('lists a category (rows normalized to camelCase, snake+camel upstream)', async () => {
    const { client, listings, use } = makeClient();
    // Upstream rows arrive mixed: engine snake_case + gateway camelCase.
    listings.list.mockResolvedValue([
      {
        id: 'l1',
        category: 'apartments',
        title: 'Loft',
        slug: 'loft',
        published_at: 't1',
        created_at: 't0',
        data: { price_text: '€1200' },
      },
      { id: 'l2', category: 'apartments', title: 'Studio', slug: 'studio', createdAt: 't2' },
    ]);
    const res = await listingsRouter({ client }).request('/?category=apartments');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.listings[0]).toEqual({
      id: 'l1',
      category: 'apartments',
      title: 'Loft',
      slug: 'loft',
      publishedAt: 't1',
      createdAt: 't0',
      // jsonb payload keys are the app's contract — never rewritten.
      data: { price_text: '€1200' },
    });
    expect(body.listings[1].createdAt).toBe('t2');
    expect(listings.list).toHaveBeenCalledWith('apartments', {
      status: undefined,
      featured: undefined,
      orderBy: undefined,
      direction: undefined,
      limit: undefined,
      offset: undefined,
    });
    expect(use).toHaveBeenCalledWith('listings');
  });

  it('requires the category query parameter (400)', async () => {
    const { client } = makeClient();
    const res = await listingsRouter({ client }).request('/');
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.message).toContain('category');
  });

  it('forwards status/featured/orderBy/direction/limit/offset', async () => {
    const { client, listings } = makeClient();
    listings.list.mockResolvedValue([]);
    await listingsRouter({ client }).request(
      '/?category=jobs&status=published&featured=1&orderBy=title&direction=ASC&limit=5&offset=10',
    );
    expect(listings.list).toHaveBeenCalledWith('jobs', {
      status: 'published',
      featured: true,
      orderBy: 'title',
      direction: 'ASC',
      limit: 5,
      offset: 10,
    });
  });

  it('400s bad featured / limit / direction values', async () => {
    const { client, listings } = makeClient();
    listings.list.mockResolvedValue([]);
    const app = listingsRouter({ client });
    expect((await app.request('/?category=jobs&featured=maybe')).status).toBe(400);
    expect((await app.request('/?category=jobs&limit=-1')).status).toBe(400);
    expect((await app.request('/?category=jobs&direction=sideways')).status).toBe(400);
  });

  it("400s with the SDK's validation message on an invalid status filter", async () => {
    const { client, listings } = makeClient();
    listings.list.mockRejectedValue(
      new Error('ListingsClient.list: "status" must be one of draft, pending, published, expired, archived — got "live"'),
    );
    const res = await listingsRouter({ client }).request('/?category=jobs&status=live');
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.message).toContain('"status" must be one of');
  });
});

describe('GET /meta/categories', () => {
  it('returns the distinct category list', async () => {
    const { client, listings } = makeClient();
    listings.categories.mockResolvedValue(['apartments', 'cars', 'jobs']);
    const res = await listingsRouter({ client }).request('/meta/categories');
    expect(res.status).toBe(200);
    expect((await res.json()) as any).toEqual({ categories: ['apartments', 'cars', 'jobs'] });
  });
});

describe('GET /:slug', () => {
  it('returns a single published listing, normalized', async () => {
    const { client, listings } = makeClient();
    listings.getBySlug.mockResolvedValue({
      id: 'l1',
      slug: 'loft',
      status: 'published',
      created_at: 't0',
      published_at: 't1',
    });
    const res = await listingsRouter({ client }).request('/loft');
    expect(res.status).toBe(200);
    expect((await res.json()) as any).toEqual({
      id: 'l1',
      slug: 'loft',
      status: 'published',
      createdAt: 't0',
      publishedAt: 't1',
    });
    expect(listings.getBySlug).toHaveBeenCalledWith('loft');
  });

  it('404s when the listing is missing/unpublished', async () => {
    const { client, listings } = makeClient();
    listings.getBySlug.mockResolvedValue(null);
    const res = await listingsRouter({ client }).request('/ghost');
    expect(res.status).toBe(404);
    expect((await res.json() as any).error.code).toBe('NOT_FOUND');
  });
});

describe('POST /', () => {
  it('submits a listing (always pending, never self-featured) and returns 201', async () => {
    const { client, listings } = makeClient();
    listings.create.mockResolvedValue({ id: 'l9', slug: 'sunny-loft', status: 'pending' });
    const res = await postJson(listingsRouter({ client }), '/', {
      category: 'apartments',
      title: 'Sunny Loft',
      summary: 'Bright and airy',
      body: 'Full description',
      data: { price: '€1200' },
      // hostile fields that must NOT reach create():
      status: 'published',
      featured: true,
    });
    expect(res.status).toBe(201);
    expect((await res.json()) as any).toEqual({ id: 'l9', slug: 'sunny-loft', status: 'pending' });
    expect(listings.create).toHaveBeenCalledWith({
      category: 'apartments',
      title: 'Sunny Loft',
      summary: 'Bright and airy',
      body: 'Full description',
      data: { price: '€1200' },
      status: 'pending',
    });
    // featured / caller-supplied status never forwarded.
    expect(listings.create.mock.calls[0][0]).not.toHaveProperty('featured');
  });

  it("400s with the SDK's validation message on bad input", async () => {
    const { client, listings } = makeClient();
    listings.create.mockRejectedValue(
      new Error('ListingsClient.create: "category" must be a non-empty string'),
    );
    const res = await postJson(listingsRouter({ client }), '/', { title: 'No category' });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.message).toContain('"category" must be a non-empty string');
  });

  it('400s a non-object body', async () => {
    const { client } = makeClient();
    expect((await postJson(listingsRouter({ client }), '/', 'hi')).status).toBe(400);
  });

  it('rate limits POSTs but never the GET list on the same path', async () => {
    const { client, listings } = makeClient();
    listings.create.mockResolvedValue({ id: 'l1', slug: 's', status: 'pending' });
    listings.list.mockResolvedValue([]);
    const app = listingsRouter({ client, rateLimit: 1 });
    const ip = { 'cf-connecting-ip': '203.0.113.9' };
    const submit = () => postJson(app, '/', { category: 'c', title: 't' }, ip);
    expect((await submit()).status).toBe(201);
    expect((await submit()).status).toBe(429);
    expect((await app.request('/?category=c', { headers: ip })).status).toBe(200);
  });
});
