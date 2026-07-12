import type { XenitionClient } from '../xenition-client';
import { formsRouter } from './forms-router';

const makeClient = () => {
  const forms = {
    getForm: jest.fn(),
    submit: jest.fn(),
  };
  const use = jest.fn();
  const client = { modules: { use, forms } } as unknown as XenitionClient;
  return { client, forms, use };
};

const postJson = (
  app: ReturnType<typeof formsRouter>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('GET /:key', () => {
  it('returns the form schema normalized to camelCase', async () => {
    const { client, forms, use } = makeClient();
    forms.getForm.mockResolvedValue({
      id: 'f1',
      key: 'contact',
      name: 'Contact',
      fields: [{ name: 'email', type: 'email', required: true }],
      created_at: 't0',
      updated_at: 't1',
    });
    const res = await formsRouter({ client }).request('/contact');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.createdAt).toBe('t0');
    expect(body.fields).toEqual([{ name: 'email', type: 'email', required: true }]);
    expect(use).toHaveBeenCalledWith('forms');
  });

  it('404s an unknown form', async () => {
    const { client, forms } = makeClient();
    forms.getForm.mockResolvedValue(null);
    const res = await formsRouter({ client }).request('/nope');
    expect(res.status).toBe(404);
  });
});

describe('POST /:key/submissions', () => {
  it('submits through the SDK and returns 201 {id} with request meta', async () => {
    const { client, forms } = makeClient();
    forms.submit.mockResolvedValue({ id: 's1', form_key: 'contact', status: 'new' });
    const res = await postJson(
      formsRouter({ client }),
      '/contact/submissions',
      { email: 'ada@example.com' },
      { 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'jest' },
    );
    expect(res.status).toBe(201);
    expect(await res.json() as any).toEqual({ id: 's1' });
    expect(forms.submit).toHaveBeenCalledWith(
      'contact',
      { email: 'ada@example.com' },
      { ip: '203.0.113.9', userAgent: 'jest' },
    );
  });

  it("400s with the SDK's aggregated validation message", async () => {
    const { client, forms } = makeClient();
    forms.submit.mockRejectedValue(
      new Error(
        'FormsClient.submit: invalid submission for form "contact": missing required field "email"; field "age" must be a finite number',
      ),
    );
    const res = await postJson(formsRouter({ client }), '/contact/submissions', { age: 'x' });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('missing required field "email"');
    expect(body.error.message).toContain('field "age" must be a finite number');
  });

  it('404s an unknown form on submit', async () => {
    const { client, forms } = makeClient();
    forms.submit.mockRejectedValue(
      new Error('FormsClient.submit: unknown form "nope" — call ensureForm("nope", fields) first'),
    );
    const res = await postJson(formsRouter({ client }), '/nope/submissions', { email: 'a@b.co' });
    expect(res.status).toBe(404);
  });

  it('400s a non-object body', async () => {
    const { client } = makeClient();
    const app = formsRouter({ client });
    expect((await postJson(app, '/contact/submissions', [1, 2])).status).toBe(400);
    const res = await app.request('/contact/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('rate limits per IP with 429 after the budget is spent', async () => {
    const { client, forms } = makeClient();
    forms.submit.mockResolvedValue({ id: 's1' });
    const app = formsRouter({ client, rateLimit: 2 });
    const ip = { 'cf-connecting-ip': '203.0.113.1' };
    expect((await postJson(app, '/contact/submissions', { a: 1 }, ip)).status).toBe(201);
    expect((await postJson(app, '/contact/submissions', { a: 1 }, ip)).status).toBe(201);
    const limited = await postJson(app, '/contact/submissions', { a: 1 }, ip);
    expect(limited.status).toBe(429);
    expect((await limited.json() as any).error.code).toBe('RATE_LIMITED');
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });

  it('rate limit buckets are per IP', async () => {
    const { client, forms } = makeClient();
    forms.submit.mockResolvedValue({ id: 's1' });
    const app = formsRouter({ client, rateLimit: 1 });
    expect(
      (await postJson(app, '/c/submissions', {}, { 'cf-connecting-ip': '203.0.113.1' })).status,
    ).toBe(201);
    expect(
      (await postJson(app, '/c/submissions', {}, { 'cf-connecting-ip': '203.0.113.2' })).status,
    ).toBe(201);
    expect(
      (await postJson(app, '/c/submissions', {}, { 'cf-connecting-ip': '203.0.113.1' })).status,
    ).toBe(429);
  });

  it('rateLimit: false disables limiting entirely', async () => {
    const { client, forms } = makeClient();
    forms.submit.mockResolvedValue({ id: 's1' });
    const app = formsRouter({ client, rateLimit: false });
    for (let i = 0; i < 25; i++) {
      expect((await postJson(app, '/c/submissions', {})).status).toBe(201);
    }
  });

  it('does not rate limit GETs (reads stay unmetered)', async () => {
    const { client, forms } = makeClient();
    forms.getForm.mockResolvedValue({ id: 'f1', key: 'c', name: 'C', fields: [] });
    const app = formsRouter({ client, rateLimit: 1 });
    for (let i = 0; i < 5; i++) {
      expect((await app.request('/c')).status).toBe(200);
    }
  });
});
