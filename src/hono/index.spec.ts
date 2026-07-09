import { XenitionClient } from '../xenition-client';
import { XenitionApiConfigError, createClientFromEnv } from './client';
import { createXenitionApi } from './index';

const makeClient = () => {
  const cms = { getPageBySlug: jest.fn(), listItems: jest.fn(), getItemBySlug: jest.fn() };
  const forms = { getForm: jest.fn(), submit: jest.fn() };
  const reviews = { listApproved: jest.fn(), aggregate: jest.fn(), submit: jest.fn() };
  const use = jest.fn();
  const client = { modules: { use, cms, forms, reviews } } as unknown as XenitionClient;
  return { client, cms, forms, reviews, use };
};

describe('createXenitionApi — module mounting', () => {
  it('mounts all three module routers by default', async () => {
    const { client, cms, forms, reviews } = makeClient();
    cms.getPageBySlug.mockResolvedValue({ id: 'p1', slug: 'a', published: true });
    forms.getForm.mockResolvedValue({ id: 'f1', key: 'contact', name: 'C', fields: [] });
    reviews.listApproved.mockResolvedValue([]);
    reviews.aggregate.mockResolvedValue({ count: 0, average: null });
    const app = createXenitionApi({ client });
    expect((await app.request('/cms/pages/a')).status).toBe(200);
    expect((await app.request('/forms/contact')).status).toBe(200);
    expect((await app.request('/reviews/product/p1')).status).toBe(200);
  });

  it('mounts only the selected modules', async () => {
    const { client, cms } = makeClient();
    cms.getPageBySlug.mockResolvedValue({ id: 'p1', slug: 'a', published: true });
    const app = createXenitionApi({ client, modules: ['cms'] });
    expect((await app.request('/cms/pages/a')).status).toBe(200);
    const forms = await app.request('/forms/contact');
    expect(forms.status).toBe(404);
    expect((await forms.json() as any).error.code).toBe('NOT_FOUND');
    expect((await app.request('/reviews/product/p1')).status).toBe(404);
  });

  it('unmatched routes get a JSON 404 (not hono plain text)', async () => {
    const { client } = makeClient();
    const res = await createXenitionApi({ client }).request('/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

describe('createXenitionApi — CORS', () => {
  const origin = { Origin: 'https://app.example.com' };

  it('defaults to permissive CORS (*)', async () => {
    const { client, cms } = makeClient();
    cms.getPageBySlug.mockResolvedValue({ id: 'p1', slug: 'a', published: true });
    const app = createXenitionApi({ client });
    const res = await app.request('/cms/pages/a', { headers: origin });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('answers preflights', async () => {
    const { client } = makeClient();
    const app = createXenitionApi({ client });
    const res = await app.request('/forms/contact/submissions', {
      method: 'OPTIONS',
      headers: {
        ...origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('cors: string[] echoes only allowlisted origins', async () => {
    const { client, cms } = makeClient();
    cms.getPageBySlug.mockResolvedValue({ id: 'p1', slug: 'a', published: true });
    const app = createXenitionApi({ client, cors: ['https://app.example.com'] });
    const allowed = await app.request('/cms/pages/a', { headers: origin });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    const denied = await app.request('/cms/pages/a', {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('cors: false emits no CORS headers', async () => {
    const { client, cms } = makeClient();
    cms.getPageBySlug.mockResolvedValue({ id: 'p1', slug: 'a', published: true });
    const app = createXenitionApi({ client, cors: false });
    const res = await app.request('/cms/pages/a', { headers: origin });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('client resolution from the environment', () => {
  const KEY = 'xen_service_0123456789abcdef';

  afterEach(() => {
    delete process.env.XENITION_API_KEY;
    delete process.env.XENITION_API_URL;
  });

  it('createClientFromEnv builds a client from injected vars', () => {
    const client = createClientFromEnv({
      XENITION_API_KEY: KEY,
      XENITION_API_URL: 'https://per-deploy.example.com/v1',
    });
    expect(client).toBeInstanceOf(XenitionClient);
  });

  it('createClientFromEnv throws a config error without a key', () => {
    expect(() => createClientFromEnv({})).toThrow(XenitionApiConfigError);
    expect(() => createClientFromEnv({})).toThrow(/XENITION_API_KEY/);
  });

  it('answers 500 CONFIG_ERROR when no client and no env key are available', async () => {
    const app = createXenitionApi();
    const res = await app.request('/forms/contact');
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.error.code).toBe('CONFIG_ERROR');
    expect(body.error.message).toContain('XENITION_API_KEY');
  });

  it('reads secrets from the Hono context env (Workers bindings)', async () => {
    const app = createXenitionApi({ rateLimit: false });
    // Unroutable per-deploy URL: proves the env client was constructed
    // (gets past config), fails upstream, and maps to a sanitized 502.
    const res = await app.request(
      '/forms/contact',
      {},
      { XENITION_API_KEY: KEY, XENITION_API_URL: 'http://127.0.0.1:9' },
    );
    expect(res.status).toBe(502);
    const body = await res.json() as any;
    expect(JSON.stringify(body)).not.toContain('127.0.0.1');
    expect(JSON.stringify(body)).not.toContain(KEY);
  }, 15_000);

  it('falls back to process.env when the context env is empty (Node)', async () => {
    process.env.XENITION_API_KEY = KEY;
    process.env.XENITION_API_URL = 'http://127.0.0.1:9';
    const app = createXenitionApi({ rateLimit: false });
    const res = await app.request('/forms/contact');
    expect(res.status).toBe(502); // built from process.env, failed upstream
  }, 15_000);
});
