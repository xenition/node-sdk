import { Hono } from 'hono';
import { QUOTAS_TABLE, periodStartFor } from '../modules/quotas';
import { createTestClient } from '../testing';
import { createXenitionApi } from './index';
import { quotasRouter } from './quotas-router';

/**
 * The two things this router has to get right: a read never spends a run,
 * and the limit is never the caller's to choose.
 */
const auth = { headers: { Authorization: 'Bearer test' } };
const QUOTAS = {
  analysis: { limit: 5 },
  export: { limit: 2, period: 'day' as const },
};

const counter = (over: Record<string, unknown> = {}) => ({
  id: `q-${Math.random().toString(36).slice(2)}`,
  subject: 'test-user',
  quota_key: 'analysis',
  period_start: periodStartFor('month', new Date()),
  period: 'month',
  used: 2,
  updated_at: new Date().toISOString(),
  ...over,
});

const makeApp = (options: Record<string, unknown> = { quotas: QUOTAS }) => {
  const { client, store, user } = createTestClient();
  const app = new Hono();
  app.route('/api', quotasRouter({ client, ...options }));
  return { app, store, client, user };
};

describe('GET /quotas/:key', () => {
  it('reports usage against the configured limit', async () => {
    const { app, store } = makeApp();
    store.seed(QUOTAS_TABLE, [counter({ used: 2 })]);

    const res = await app.request('/api/quotas/analysis', auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      key: 'analysis',
      allowed: true,
      used: 2,
      limit: 5,
      remaining: 3,
      period: 'month',
    });
  });

  it('IGNORES a limit from the caller', async () => {
    // The whole point. A client-supplied limit would let anyone grant
    // themselves an unlimited allowance by asking for one.
    const { app, store } = makeApp();
    store.seed(QUOTAS_TABLE, [counter({ used: 5 })]);

    const res = await app.request('/api/quotas/analysis?limit=999999&period=total', auth);
    const body = (await res.json()) as { limit: number; allowed: boolean; period: string };
    expect(body.limit).toBe(5);
    expect(body.allowed).toBe(false);
    expect(body.period).toBe('month');
  });

  it('never consumes — a read must not spend a run', async () => {
    const { app, store } = makeApp();
    store.seed(QUOTAS_TABLE, [counter({ used: 2 })]);

    await app.request('/api/quotas/analysis', auth);
    await app.request('/api/quotas/analysis', auth);

    const rows = store.rows(QUOTAS_TABLE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.used).toBe(2);
    expect(store.payloads.every((payload) => payload.type === 'SELECT')).toBe(true);
  });

  it('is the caller’s meter, not a subject the request names', async () => {
    const { app, store } = makeApp();
    store.seed(QUOTAS_TABLE, [counter({ subject: 'someone-else', used: 5 })]);

    const body = (await (
      await app.request('/api/quotas/analysis?subject=someone-else', auth)
    ).json()) as { used: number };
    expect(body.used).toBe(0);
  });

  it('reads zero for a quota with no counter yet', async () => {
    const { app } = makeApp();
    expect(await (await app.request('/api/quotas/export', auth)).json()).toMatchObject({
      used: 0,
      limit: 2,
      remaining: 2,
      period: 'day',
      allowed: true,
    });
  });

  it('404s a quota this app does not meter, and says which it does', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/quotas/unicorns', auth);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).toContain('analysis');
  });

  it('401s without a token', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/quotas/analysis')).status).toBe(401);
  });

  it('501s when the app declared no quotas at all', async () => {
    // Not a 500: metering against a made-up denominator would be worse
    // than saying this app has no quotas.
    const { app } = makeApp({});
    const res = await app.request('/api/quotas/analysis', auth);
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_CONFIGURED' } });
  });
});

describe('GET /quotas', () => {
  it('peeks every configured quota when no keys are given', async () => {
    const { app, store } = makeApp();
    store.seed(QUOTAS_TABLE, [counter({ used: 4 })]);

    const body = (await (await app.request('/api/quotas', auth)).json()) as {
      quotas: Array<{ key: string; used: number; limit: number }>;
    };
    expect(body.quotas.map((q) => q.key)).toEqual(['analysis', 'export']);
    expect(body.quotas[0]).toMatchObject({ used: 4, limit: 5, remaining: 1 });
    expect(body.quotas[1]).toMatchObject({ used: 0, limit: 2, period: 'day' });
  });

  it('peeks the listed keys', async () => {
    const { app } = makeApp();
    const body = (await (await app.request('/api/quotas?keys=export', auth)).json()) as {
      quotas: Array<{ key: string }>;
    };
    expect(body.quotas.map((q) => q.key)).toEqual(['export']);
  });

  it('400s an unknown key rather than quietly dropping it', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/quotas?keys=analysis,unicorns', auth);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('unicorns');
  });
});

describe('mounting', () => {
  it('takes its quota map from createXenitionApi', async () => {
    const { client } = createTestClient();
    const api = createXenitionApi({ client, quotas: QUOTAS });
    const res = await api.request('/quotas/analysis', auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ key: 'analysis', limit: 5 });
  });

  it('is mounted by default, and honest about being unconfigured', async () => {
    const { client } = createTestClient();
    const api = createXenitionApi({ client });
    expect((await api.request('/quotas/analysis', auth)).status).toBe(501);
  });

  it('is absent when not selected', async () => {
    const { client } = createTestClient();
    const api = createXenitionApi({ client, modules: ['cms'] });
    expect((await api.request('/quotas/analysis', auth)).status).toBe(404);
  });
});
