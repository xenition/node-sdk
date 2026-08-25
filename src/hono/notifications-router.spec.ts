import { Hono } from 'hono';
import { NOTIFICATIONS_TABLES } from '../modules/notifications';
import { createTestClient } from '../testing';
import { createXenitionApi } from './index';
import { notificationsRouter } from './notifications-router';

/**
 * The inbox as the phone sees it: read the feed, mark things read, and get a
 * settings screen that renders on an account that has never touched one.
 *
 * Nothing is stubbed — `createTestClient` runs the real module client over an
 * in-memory store, so what these assert is the module's behaviour reached
 * through HTTP, which is the only thing this router adds.
 */
const auth = { headers: { Authorization: 'Bearer test' } };
const put = (body: unknown) => ({
  method: 'PUT',
  headers: { ...auth.headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const post = { method: 'POST', ...auth };

/** Timestamps are given explicitly: rows written in one millisecond tie. */
const message = (over: Record<string, unknown> = {}) => ({
  id: `n-${Math.random().toString(36).slice(2)}`,
  user_id: 'test-user',
  category: 'general',
  title: 'Practice time',
  body: 'Your streak is at 6 days',
  data: {},
  read_at: null,
  expires_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
  ...over,
});

const makeApp = (options: Record<string, unknown> = {}, unauthenticated = false) => {
  const { client, store, user } = createTestClient({ unauthenticated });
  const app = new Hono();
  app.route('/api', notificationsRouter({ client, ...options }));
  return { app, store, client, user };
};

describe('GET /notifications', () => {
  it('serves the feed newest first, camelCased', async () => {
    const { app, store } = makeApp();
    store.seed(NOTIFICATIONS_TABLES.MESSAGES, [
      message({ id: 'older', created_at: '2026-08-01T00:00:00.000Z' }),
      message({ id: 'newer', created_at: '2026-08-02T00:00:00.000Z' }),
    ]);

    const res = await app.request('/api/notifications', auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { notifications: Array<Record<string, unknown>> };
    expect(body.notifications.map((n) => n.id)).toEqual(['newer', 'older']);
    // Rows leave the routers camelCased, like every other module.
    expect(body.notifications[0]).toHaveProperty('readAt', null);
    expect(body.notifications[0]).not.toHaveProperty('read_at');
  });

  it('serves only the caller — never a user id from the request', async () => {
    // This router runs with the service key, which can read every row in
    // the app; the token is the only thing that decides whose inbox this is.
    const { app, store } = makeApp();
    store.seed(NOTIFICATIONS_TABLES.MESSAGES, [
      message({ id: 'mine' }),
      message({ id: 'theirs', user_id: 'someone-else' }),
    ]);

    const res = await app.request('/api/notifications?userId=someone-else', auth);
    const body = (await res.json()) as { notifications: Array<{ id: string }> };
    expect(body.notifications.map((n) => n.id)).toEqual(['mine']);
  });

  it('401s without a token', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/notifications')).status).toBe(401);
  });

  it('filters unread and by category', async () => {
    const { app, store } = makeApp();
    store.seed(NOTIFICATIONS_TABLES.MESSAGES, [
      message({ id: 'read', read_at: '2026-08-02T00:00:00.000Z' }),
      message({ id: 'unread' }),
      message({ id: 'billing', category: 'billing' }),
    ]);

    const unread = (await (await app.request('/api/notifications?unread=true', auth)).json()) as {
      notifications: Array<{ id: string }>;
    };
    expect(unread.notifications.map((n) => n.id).sort()).toEqual(['billing', 'unread']);

    const billing = (await (
      await app.request('/api/notifications?category=billing', auth)
    ).json()) as { notifications: Array<{ id: string }> };
    expect(billing.notifications.map((n) => n.id)).toEqual(['billing']);
  });

  it('pages with the keyset cursor rather than an offset', async () => {
    const { app, store } = makeApp();
    store.seed(NOTIFICATIONS_TABLES.MESSAGES, [
      message({ id: 'a', created_at: '2026-08-01T00:00:00.000Z' }),
      message({ id: 'b', created_at: '2026-08-02T00:00:00.000Z' }),
      message({ id: 'c', created_at: '2026-08-03T00:00:00.000Z' }),
    ]);

    const first = (await (await app.request('/api/notifications?limit=2', auth)).json()) as {
      notifications: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(first.notifications.map((n) => n.id)).toEqual(['c', 'b']);
    expect(first.nextCursor).toBe('2026-08-02T00:00:00.000Z');

    const next = (await (
      await app.request(`/api/notifications?limit=2&before=${first.nextCursor}`, auth)
    ).json()) as { notifications: Array<{ id: string }>; nextCursor: string | null };
    expect(next.notifications.map((n) => n.id)).toEqual(['a']);
    expect(next.nextCursor).toBeNull();
  });

  it('400s on a query param it cannot use', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/notifications?unread=maybe', auth);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});

describe('unread count and marking read', () => {
  it('counts only the caller’s unread rows', async () => {
    const { app, store } = makeApp();
    store.seed(NOTIFICATIONS_TABLES.MESSAGES, [
      message({ id: 'a' }),
      message({ id: 'b' }),
      message({ id: 'c', read_at: '2026-08-02T00:00:00.000Z' }),
      message({ id: 'd', user_id: 'someone-else' }),
    ]);
    const res = await app.request('/api/notifications/unread-count', auth);
    expect(await res.json()).toEqual({ count: 2 });
  });

  it('marks one read', async () => {
    const { app, store } = makeApp();
    store.seed(NOTIFICATIONS_TABLES.MESSAGES, [message({ id: 'a' })]);

    const res = await app.request('/api/notifications/a/read', post);
    expect(res.status).toBe(200);
    expect(store.rows(NOTIFICATIONS_TABLES.MESSAGES)[0]?.read_at).not.toBeNull();
  });

  it('reports the same success for someone else’s id, and changes nothing', async () => {
    // The UPDATE is scoped by user, so this is a no-op. Answering 404 would
    // confirm which ids exist; answering 200 tells the caller nothing.
    const { app, store } = makeApp();
    store.seed(NOTIFICATIONS_TABLES.MESSAGES, [message({ id: 'theirs', user_id: 'other' })]);

    const res = await app.request('/api/notifications/theirs/read', post);
    expect(res.status).toBe(200);
    expect(store.rows(NOTIFICATIONS_TABLES.MESSAGES)[0]?.read_at).toBeNull();
  });

  it('marks everything read and returns the new badge count', async () => {
    const { app, store } = makeApp();
    store.seed(NOTIFICATIONS_TABLES.MESSAGES, [
      message({ id: 'a' }),
      message({ id: 'b' }),
      message({ id: 'theirs', user_id: 'other' }),
    ]);

    const res = await app.request('/api/notifications/read-all', post);
    expect(await res.json()).toEqual({ read: true, unreadCount: 0 });
    // Not everyone's inbox — the other user's row is untouched.
    const theirs = store
      .rows(NOTIFICATIONS_TABLES.MESSAGES)
      .find((row) => row.id === 'theirs');
    expect(theirs?.read_at).toBeNull();
  });

  it('401s the writes', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/notifications/a/read', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/api/notifications/read-all', { method: 'POST' })).status).toBe(401);
  });
});

describe('preferences', () => {
  it('renders on a fresh account, from the module’s own defaults', async () => {
    // `listPreferences` returns only rows that EXIST and the module writes
    // one only on the first change, so a fresh account would otherwise get
    // `[]` — a settings screen with no switches on it.
    const { app, store } = makeApp({ categories: ['general', 'billing'] });
    const res = await app.request('/api/notifications/preferences', auth);

    const body = (await res.json()) as { preferences: Array<Record<string, unknown>> };
    expect(body.preferences.map((p) => p.category)).toEqual(['billing', 'general']);
    expect(body.preferences[0]).toMatchObject({ inApp: true, push: true, email: false });
    // Reading them did not write them: the defaults stay changeable later.
    expect(store.rows(NOTIFICATIONS_TABLES.PREFERENCES)).toHaveLength(0);
  });

  it('maps the camelCase body onto the module’s mixed-case patch', async () => {
    const { app, store } = makeApp({ categories: ['general'] });
    const res = await app.request(
      '/api/notifications/preferences',
      put({ inApp: false, push: false, quietStartMinute: 1320, quietEndMinute: 420, utcOffsetMinutes: 60 }),
    );

    expect(res.status).toBe(200);
    const row = store.rows(NOTIFICATIONS_TABLES.PREFERENCES)[0];
    expect(row).toMatchObject({
      user_id: 'test-user',
      in_app: false,
      push: false,
      quiet_start_minute: 1320,
      quiet_end_minute: 420,
      utc_offset_minutes: 60,
    });
    // …and reads back in the shape the client sent.
    const body = (await res.json()) as { preferences: Array<Record<string, unknown>> };
    expect(body.preferences[0]).toMatchObject({ inApp: false, quietStartMinute: 1320 });
  });

  it('writes every configured category when none is named', async () => {
    // One quiet-hours control means "quiet everywhere" — otherwise the user
    // silences reminders and is still woken by a billing alert.
    const { app, store } = makeApp({ categories: ['general', 'billing'] });
    await app.request('/api/notifications/preferences', put({ push: false }));

    const rows = store.rows(NOTIFICATIONS_TABLES.PREFERENCES);
    expect(rows.map((row) => row.category).sort()).toEqual(['billing', 'general']);
    expect(rows.every((row) => row.push === false)).toBe(true);
  });

  it('writes one category when it is named', async () => {
    const { app, store } = makeApp({ categories: ['general', 'billing'] });
    await app.request('/api/notifications/preferences', put({ category: 'billing', push: false }));

    const rows = store.rows(NOTIFICATIONS_TABLES.PREFERENCES);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: 'billing', push: false });
  });

  it('leaves omitted fields alone and clears on an explicit null', async () => {
    const { app, store } = makeApp({ categories: ['general'] });
    await app.request('/api/notifications/preferences', put({ quietStartMinute: 1320, quietEndMinute: 420 }));
    await app.request('/api/notifications/preferences', put({ push: false }));
    expect(store.rows(NOTIFICATIONS_TABLES.PREFERENCES)[0]).toMatchObject({
      push: false,
      quiet_start_minute: 1320,
    });

    await app.request('/api/notifications/preferences', put({ quietStartMinute: null }));
    expect(store.rows(NOTIFICATIONS_TABLES.PREFERENCES)[0]).toMatchObject({
      quiet_start_minute: null,
      quiet_end_minute: 420,
    });
  });

  it('400s a quiet minute outside the day, naming the field', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/notifications/preferences', put({ quietStartMinute: 2000 }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('quietStartMinute');
  });

  it('400s a body that is not a JSON object', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/notifications/preferences', put([1, 2, 3]));
    expect(res.status).toBe(400);
  });
});

describe('mounting', () => {
  it('is mounted by createXenitionApi by default', async () => {
    const { client } = createTestClient();
    const api = createXenitionApi({ client });
    expect((await api.request('/notifications/unread-count', auth)).status).toBe(200);
  });

  it('takes its categories from createXenitionApi', async () => {
    const { client } = createTestClient();
    const api = createXenitionApi({ client, notificationCategories: ['general', 'billing'] });
    const body = (await (await api.request('/notifications/preferences', auth)).json()) as {
      preferences: Array<{ category: string }>;
    };
    expect(body.preferences.map((p) => p.category)).toEqual(['billing', 'general']);
  });

  it('is absent when not selected', async () => {
    const { client } = createTestClient();
    const api = createXenitionApi({ client, modules: ['cms'] });
    expect((await api.request('/notifications', auth)).status).toBe(404);
  });
});
