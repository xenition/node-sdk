import { XenitionError } from '../core/errors';
import type { XenitionClient } from '../xenition-client';
import { cmsRouter } from './cms-router';

const makeClient = () => {
  const cms = {
    getPageBySlug: jest.fn(),
    listItems: jest.fn(),
    getItemBySlug: jest.fn(),
  };
  const use = jest.fn();
  const client = { modules: { use, cms } } as unknown as XenitionClient;
  return { client, cms, use };
};

const snakePage = {
  id: 'p1',
  slug: 'about',
  title: 'About',
  body_html: '<h1>Hi</h1>',
  seo: { og_title: 'About us' },
  published: true,
  sort: 0,
  created_at: 't0',
  updated_at: 't1',
};

describe('GET /pages/:slug', () => {
  it('returns the page normalized to camelCase (snake_case upstream)', async () => {
    const { client, cms, use } = makeClient();
    cms.getPageBySlug.mockResolvedValue(snakePage);
    const res = await cmsRouter({ client }).request('/pages/about');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({
      id: 'p1',
      slug: 'about',
      title: 'About',
      bodyHtml: '<h1>Hi</h1>',
      seo: { og_title: 'About us' }, // jsonb inner keys untouched
      published: true,
      sort: 0,
      createdAt: 't0',
      updatedAt: 't1',
    });
    expect(cms.getPageBySlug).toHaveBeenCalledWith('about');
    expect(use).toHaveBeenCalledWith('cms');
  });

  it('keeps camelCase upstream rows stable (gateway runtime)', async () => {
    const { client, cms } = makeClient();
    cms.getPageBySlug.mockResolvedValue({
      id: 'p1',
      slug: 'about',
      bodyHtml: '<h1>Hi</h1>',
      published: true,
      createdAt: 't0',
    });
    const res = await cmsRouter({ client }).request('/pages/about');
    const body = await res.json() as any;
    expect(body.bodyHtml).toBe('<h1>Hi</h1>');
    expect(body.createdAt).toBe('t0');
  });

  it('404s a missing page', async () => {
    const { client, cms } = makeClient();
    cms.getPageBySlug.mockResolvedValue(null);
    const res = await cmsRouter({ client }).request('/pages/nope');
    expect(res.status).toBe(404);
    expect((await res.json() as any).error.code).toBe('NOT_FOUND');
  });

  it('404s an unpublished page (service key must not leak drafts by default)', async () => {
    const { client, cms } = makeClient();
    cms.getPageBySlug.mockResolvedValue({ ...snakePage, published: false });
    const res = await cmsRouter({ client }).request('/pages/about');
    expect(res.status).toBe(404);
  });
});

describe('GET /collections/:key/items', () => {
  it('lists items published-only by default, normalized', async () => {
    const { client, cms } = makeClient();
    cms.listItems.mockResolvedValue([
      { id: 'i1', collection_id: 'c1', slug: 'a', data: { img_url: '/a.png' }, published: true },
    ]);
    const res = await cmsRouter({ client }).request('/collections/menu/items');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.items).toEqual([
      { id: 'i1', collectionId: 'c1', slug: 'a', data: { img_url: '/a.png' }, published: true },
    ]);
    expect(cms.listItems).toHaveBeenCalledWith(
      'menu',
      expect.objectContaining({ published: true }),
    );
  });

  it('forwards published=0, orderBy, direction, limit and offset', async () => {
    const { client, cms } = makeClient();
    cms.listItems.mockResolvedValue([]);
    const res = await cmsRouter({ client }).request(
      '/collections/menu/items?published=0&orderBy=created_at&direction=desc&limit=5&offset=10',
    );
    expect(res.status).toBe(200);
    expect(cms.listItems).toHaveBeenCalledWith('menu', {
      published: false,
      orderBy: 'created_at',
      direction: 'DESC',
      limit: 5,
      offset: 10,
    });
  });

  it('published=all removes the filter', async () => {
    const { client, cms } = makeClient();
    cms.listItems.mockResolvedValue([]);
    await cmsRouter({ client }).request('/collections/menu/items?published=all');
    expect(cms.listItems).toHaveBeenCalledWith(
      'menu',
      expect.objectContaining({ published: undefined }),
    );
  });

  it('400s an invalid limit', async () => {
    const { client } = makeClient();
    const res = await cmsRouter({ client }).request('/collections/menu/items?limit=abc');
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.code).toBe('VALIDATION_ERROR');
  });

  it('400s an invalid direction', async () => {
    const { client } = makeClient();
    const res = await cmsRouter({ client }).request('/collections/menu/items?direction=up');
    expect(res.status).toBe(400);
  });

  it('maps the SDK "unknown collection" error to 404', async () => {
    const { client, cms } = makeClient();
    cms.listItems.mockRejectedValue(
      new Error('CmsClient.listItems: unknown collection "menu" — call ensureCollection("menu") first'),
    );
    const res = await cmsRouter({ client }).request('/collections/menu/items');
    expect(res.status).toBe(404);
    expect((await res.json() as any).error.code).toBe('NOT_FOUND');
  });
});

describe('GET /collections/:key/items/:slug', () => {
  it('returns a published item normalized', async () => {
    const { client, cms } = makeClient();
    cms.getItemBySlug.mockResolvedValue({
      id: 'i1',
      collection_id: 'c1',
      slug: 'espresso',
      published: true,
      created_at: 't0',
    });
    const res = await cmsRouter({ client }).request('/collections/menu/items/espresso');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.collectionId).toBe('c1');
    expect(body.createdAt).toBe('t0');
    expect(cms.getItemBySlug).toHaveBeenCalledWith('menu', 'espresso');
  });

  it('404s missing and unpublished items', async () => {
    const { client, cms } = makeClient();
    cms.getItemBySlug.mockResolvedValueOnce(null);
    const app = cmsRouter({ client });
    expect((await app.request('/collections/menu/items/nope')).status).toBe(404);
    cms.getItemBySlug.mockResolvedValueOnce({ id: 'i1', slug: 'draft', published: false });
    expect((await app.request('/collections/menu/items/draft')).status).toBe(404);
  });
});

describe('error mapping', () => {
  it('turns an upstream SERVER_ERROR into a generic 502 (no URL / key leak)', async () => {
    const { client, cms } = makeClient();
    cms.getPageBySlug.mockRejectedValue(
      new XenitionError('SERVER_ERROR', 'POST https://api-dev.xenition.com/v1/app-platform/query failed with key xen_service_abc123', {
        status: 500,
      }),
    );
    const res = await cmsRouter({ client }).request('/pages/about');
    expect(res.status).toBe(502);
    const body = await res.json() as any;
    expect(body.error.code).toBe('SERVER_ERROR');
    expect(JSON.stringify(body)).not.toContain('xen_service_');
    expect(JSON.stringify(body)).not.toContain('http');
  });

  it('maps upstream NOT_FOUND / RATE_LIMITED / AUTH_FORBIDDEN codes to statuses', async () => {
    const { client, cms } = makeClient();
    const app = cmsRouter({ client });
    cms.getPageBySlug.mockRejectedValueOnce(new XenitionError('NOT_FOUND', 'missing'));
    expect((await app.request('/pages/x')).status).toBe(404);
    cms.getPageBySlug.mockRejectedValueOnce(new XenitionError('RATE_LIMITED', 'slow down'));
    expect((await app.request('/pages/x')).status).toBe(429);
    cms.getPageBySlug.mockRejectedValueOnce(new XenitionError('AUTH_FORBIDDEN', 'bad key'));
    expect((await app.request('/pages/x')).status).toBe(502);
  });

  it('hides unexpected internal errors behind a generic 500', async () => {
    const { client, cms } = makeClient();
    cms.getPageBySlug.mockRejectedValue(new TypeError('x is not a function'));
    const res = await cmsRouter({ client }).request('/pages/about');
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).not.toContain('x is not a function');
  });
});
