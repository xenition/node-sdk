import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createTestClient } from '../testing';
import { currentUserId } from './auth';
import { defineRouter } from './define-router';
import { buildOpenApi } from './docs';
import { jsonNotFound, paymentRequiredBody } from './errors';
import { createXenitionApi } from './index';

/**
 * The value of a custom router is what it INHERITS, so these tests are
 * mostly about the things it gets for free: the shared error mapping, auth,
 * the entitlement gate, and a place in the generated spec.
 */
const auth = { headers: { Authorization: 'Bearer test' } };

const makeApp = (definition: ReturnType<typeof defineRouter>, unauthenticated = false) => {
  const { client, store, user } = createTestClient({ unauthenticated });
  const app = new Hono();
  app.route('/api', createXenitionApi({ client, custom: [definition] }));
  return { app, store, user, client };
};

describe('defineRouter', () => {
  it('rejects a name that is not kebab-case', () => {
    expect(() => defineRouter({ name: 'Speeches', build: () => undefined })).toThrow(
      /must be kebab-case/,
    );
    expect(() => defineRouter({ name: '', build: () => undefined })).toThrow(/kebab-case/);
  });

  it('requires a build function', () => {
    expect(() => defineRouter({ name: 'x' } as never)).toThrow(/needs a build function/);
  });

  it('freezes the definition so a mounted router cannot be mutated later', () => {
    const definition = defineRouter({ name: 'x', build: () => undefined });
    expect(Object.isFrozen(definition)).toBe(true);
  });
});

describe('mounted custom routes', () => {
  const speeches = defineRouter({
    name: 'speeches',
    build(app, { requireAuth }) {
      app.get('/speeches/public', (c) => c.json({ ok: true }));
      app.get('/speeches/mine', requireAuth, (c) => c.json({ userId: currentUserId(c) }));
    },
    paths: { '/speeches/mine': { get: { tags: ['speeches'], summary: 'The caller’s speeches' } } },
  });

  it('serves a public custom route', async () => {
    const { app } = makeApp(speeches);
    const res = await app.request('/api/speeches/public');
    expect(res.status).toBe(200);
  });

  it('gets requireAuth from the toolkit', async () => {
    const { app } = makeApp(speeches);
    expect((await app.request('/api/speeches/mine')).status).toBe(401);

    const ok = await app.request('/api/speeches/mine', auth);
    expect(await ok.json()).toEqual({ userId: 'test-user' });
  });

  it('inherits the shared error mapping instead of leaking a stack', async () => {
    // This is the main reason custom routes belong on the same parent.
    const boom = defineRouter({
      name: 'boom',
      build(app) {
        app.get('/boom', () => {
          throw new Error('secret detail postgres://user:pw@host');
        });
      },
    });
    const { app } = makeApp(boom);
    const res = await app.request('/api/boom');
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain('postgres://');
    expect(JSON.parse(body)).toMatchObject({ error: { code: 'INTERNAL' } });
  });

  it('answers a thrown HTTPException with its own status, in JSON', async () => {
    // The idiomatic Hono refusal, thrown from an app's own route. It used to
    // match nothing in the shared handler and become a 500 INTERNAL: every
    // validation error and ownership check in a generated app answered
    // "internal error", and a paywall's 402 never reached the client.
    const strict = defineRouter({
      name: 'strict',
      build(app) {
        app.get('/pantries/:id', () => {
          throw new HTTPException(404, { message: 'No such pantry.' });
        });
        app.get('/pantries/:id/plan', () => {
          throw new HTTPException(402, {
            res: Response.json(paymentRequiredBody({ entitlement: 'premium' }), { status: 402 }),
          });
        });
      },
    });
    const { app } = makeApp(strict);

    const missing = await app.request('/api/pantries/7');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/json');
    await expect(missing.json()).resolves.toEqual({
      error: { code: 'NOT_FOUND', message: 'No such pantry.' },
    });

    // A typed body attached to the exception survives the handler intact.
    const paywalled = await app.request('/api/pantries/7/plan');
    expect(paywalled.status).toBe(402);
    await expect(paywalled.json()).resolves.toMatchObject({
      error: { code: 'PAYMENT_REQUIRED' },
      entitlement: 'premium',
    });
  });

  it('answers the JSON 404 for an unmatched path', async () => {
    const { client } = createTestClient();
    const api = createXenitionApi({ client, custom: [speeches] });
    const res = await api.request('/speeches/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('needs jsonNotFound on the root app when mounted under a prefix', async () => {
    // Hono does not carry a sub-app's notFound across a prefixed mount, so
    // this applies to the built-in routers too — it is documented rather
    // than silently inconsistent.
    const { client } = createTestClient();
    const bare = new Hono();
    bare.route('/api', createXenitionApi({ client, custom: [speeches] }));
    expect((await bare.request('/api/speeches/nope')).headers.get('content-type')).toContain(
      'text/plain',
    );

    const fixed = new Hono();
    fixed.notFound(jsonNotFound);
    fixed.route('/api', createXenitionApi({ client, custom: [speeches] }));
    expect((await fixed.request('/api/speeches/nope')).headers.get('content-type')).toContain(
      'application/json',
    );
  });

  it('still mounts the built-in module routers alongside', async () => {
    const { app } = makeApp(speeches);
    expect((await app.request('/api/billing/products')).status).toBe(200);
  });

  it('gates a route behind an entitlement', async () => {
    const premium = defineRouter({
      name: 'coach',
      build(app, { requireAuth, requireEntitlement }) {
        app.get('/coach', requireAuth, requireEntitlement('premium'), (c) => c.json({ ok: true }));
      },
    });
    const { app, client } = makeApp(premium);

    const denied = await app.request('/coach'.replace('/coach', '/api/coach'), auth);
    expect(denied.status).toBe(402);
    await expect(denied.json()).resolves.toMatchObject({
      error: { code: 'PAYMENT_REQUIRED' },
      entitlement: 'premium',
    });

    await client.modules.billing.grant({ userId: 'test-user', entitlement: 'premium' });
    expect((await app.request('/api/coach', auth)).status).toBe(200);
  });

  it('can read and write through the shared client', async () => {
    const writer = defineRouter({
      name: 'writer',
      build(app, { client }) {
        app.post('/notes', async (c) => {
          await client(c).modules.notifications.notify({
            userId: 'test-user',
            title: 'hi',
            body: '',
            channels: ['in_app'],
          });
          return c.json({ ok: true }, 201);
        });
      },
    });
    const { app, store } = makeApp(writer);
    await app.request('/api/notes', { method: 'POST' });
    expect(store.rows('notifications__messages')).toHaveLength(1);
  });
});

describe('OpenAPI', () => {
  it('merges custom paths and tags into the spec', () => {
    // A route missing from the spec is invisible to everything that reads
    // it, including the platform's own app preview.
    const spec = buildOpenApi({
      modules: ['cms'],
      custom: [
        { name: 'speeches', paths: { '/speeches/mine': { get: { summary: 'Mine' } } } },
      ],
    }) as unknown as {
      paths: Record<string, unknown>;
      tags: Array<{ name: string }>;
    };

    expect(Object.keys(spec.paths)).toContain('/api/speeches/mine');
    expect(spec.tags.map((tag) => tag.name)).toContain('speeches');
  });

  it('is unchanged when no custom routers are given', () => {
    const spec = buildOpenApi({ modules: ['cms'] }) as unknown as { tags: Array<{ name: string }> };
    expect(spec.tags.map((t) => t.name)).toEqual(['health', 'cms']);
  });
});
