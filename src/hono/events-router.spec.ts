import type { XenitionClient } from '../xenition-client';
import { eventsRouter } from './events-router';

const makeClient = () => {
  const events = {
    list: jest.fn(),
    getBySlug: jest.fn(),
    rsvp: jest.fn(),
  };
  const use = jest.fn();
  const client = { modules: { use, events } } as unknown as XenitionClient;
  return { client, events, use };
};

const postJson = (
  app: ReturnType<typeof eventsRouter>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('GET /events', () => {
  it('lists events (normalized) and forwards when/status/limit/offset', async () => {
    const { client, events, use } = makeClient();
    events.list.mockResolvedValue([
      {
        id: 'e1',
        slug: 'mixer',
        title: 'Mixer',
        starts_at: '2030-01-01T18:00:00Z',
        ends_at: null,
        capacity: 10,
        status: 'published',
        created_at: 't0',
      },
    ]);
    const res = await eventsRouter({ client }).request('/events?when=past&status=draft&limit=5&offset=2');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.events).toEqual([
      expect.objectContaining({ id: 'e1', slug: 'mixer', startsAt: '2030-01-01T18:00:00Z', endsAt: null, createdAt: 't0' }),
    ]);
    expect(events.list).toHaveBeenCalledWith({
      when: 'past',
      status: 'draft',
      limit: 5,
      offset: 2,
    });
    expect(use).toHaveBeenCalledWith('events');
  });

  it('defaults when/status to undefined (client applies its own defaults)', async () => {
    const { client, events } = makeClient();
    events.list.mockResolvedValue([]);
    await eventsRouter({ client }).request('/events');
    expect(events.list).toHaveBeenCalledWith({
      when: undefined,
      status: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it('400s a bad limit', async () => {
    const { client, events } = makeClient();
    events.list.mockResolvedValue([]);
    const res = await eventsRouter({ client }).request('/events?limit=-1');
    expect(res.status).toBe(400);
  });

  it("400s the SDK's validation message on a bad when", async () => {
    const { client, events } = makeClient();
    events.list.mockRejectedValue(
      new Error('EventsClient.list: "when" must be one of upcoming, past, all — got "someday"'),
    );
    const res = await eventsRouter({ client }).request('/events?when=someday');
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.message).toContain('"when" must be one of');
  });
});

describe('GET /events/:slug', () => {
  it('returns the event merged with counts, normalized to camelCase', async () => {
    const { client, events } = makeClient();
    events.getBySlug.mockResolvedValue({
      id: 'e1',
      slug: 'mixer',
      title: 'Mixer',
      starts_at: '2030-01-01T18:00:00Z',
      ends_at: null,
      capacity: 10,
      status: 'published',
      created_at: 't0',
      confirmedCount: 3,
      waitlistCount: 1,
      spotsLeft: 7,
    });
    const res = await eventsRouter({ client }).request('/events/mixer');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual(
      expect.objectContaining({
        id: 'e1',
        slug: 'mixer',
        startsAt: '2030-01-01T18:00:00Z',
        confirmedCount: 3,
        waitlistCount: 1,
        spotsLeft: 7,
      }),
    );
    expect(events.getBySlug).toHaveBeenCalledWith('mixer');
  });

  it('404s an unknown event', async () => {
    const { client, events } = makeClient();
    events.getBySlug.mockResolvedValue(null);
    const res = await eventsRouter({ client }).request('/events/ghost');
    expect(res.status).toBe(404);
    expect((await res.json() as any).error.code).toBe('NOT_FOUND');
  });
});

describe('POST /events/:slug/rsvps', () => {
  it('creates an RSVP and returns 201 {id, status}', async () => {
    const { client, events } = makeClient();
    events.rsvp.mockResolvedValue({ id: 'r9', status: 'confirmed' });
    const res = await postJson(eventsRouter({ client }), '/events/mixer/rsvps', {
      name: 'Ada',
      email: 'ada@example.com',
      partySize: 2,
    });
    expect(res.status).toBe(201);
    expect(await res.json() as any).toEqual({ id: 'r9', status: 'confirmed' });
    expect(events.rsvp).toHaveBeenCalledWith('mixer', {
      name: 'Ada',
      email: 'ada@example.com',
      partySize: 2,
    });
  });

  it('surfaces a waitlist assignment in the 201 body', async () => {
    const { client, events } = makeClient();
    events.rsvp.mockResolvedValue({ id: 'r9', status: 'waitlist' });
    const res = await postJson(eventsRouter({ client }), '/events/mixer/rsvps', {
      name: 'Ada',
      email: 'ada@example.com',
    });
    expect(res.status).toBe(201);
    expect((await res.json() as any).status).toBe('waitlist');
  });

  it("400s with the SDK's validation message on a bad email", async () => {
    const { client, events } = makeClient();
    events.rsvp.mockRejectedValue(
      new Error('EventsClient.rsvp: "email" must be a valid email address'),
    );
    const res = await postJson(eventsRouter({ client }), '/events/mixer/rsvps', {
      name: 'Ada',
      email: 'nope',
    });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.message).toContain('"email" must be a valid email address');
  });

  it('404s an RSVP to an unknown event', async () => {
    const { client, events } = makeClient();
    events.rsvp.mockRejectedValue(new Error('EventsClient.rsvp: unknown event "ghost"'));
    const res = await postJson(eventsRouter({ client }), '/events/ghost/rsvps', {
      name: 'Ada',
      email: 'ada@example.com',
    });
    expect(res.status).toBe(404);
    expect((await res.json() as any).error.code).toBe('NOT_FOUND');
  });

  it('400s a non-object body', async () => {
    const { client } = makeClient();
    expect((await postJson(eventsRouter({ client }), '/events/mixer/rsvps', 'hi')).status).toBe(400);
  });

  it('rate limits RSVPs but never the GETs', async () => {
    const { client, events } = makeClient();
    events.rsvp.mockResolvedValue({ id: 'r1', status: 'confirmed' });
    events.list.mockResolvedValue([]);
    events.getBySlug.mockResolvedValue({ id: 'e1', slug: 'mixer', confirmedCount: 0, waitlistCount: 0, spotsLeft: 1 });
    const app = eventsRouter({ client, rateLimit: 1 });
    const ip = { 'cf-connecting-ip': '203.0.113.9' };
    const body = { name: 'A', email: 'a@example.com' };
    expect((await postJson(app, '/events/mixer/rsvps', body, ip)).status).toBe(201);
    expect((await postJson(app, '/events/mixer/rsvps', body, ip)).status).toBe(429);
    expect((await app.request('/events', { headers: ip })).status).toBe(200);
    expect((await app.request('/events/mixer', { headers: ip })).status).toBe(200);
  });
});
