import { HttpClient } from '../../core/http-client';
import { QueryClient } from '../../query/query-client';
import { QueryPayload } from '../../query/types';
import { ModuleContext } from '../core';
import { EventsClient, EVENTS_TABLES } from './events-client';
import { CreateEventInput } from './types';

const makeEvents = () => {
  const post = jest.fn();
  const query = new QueryClient({ post } as unknown as HttpClient);
  const ctx: ModuleContext = { query, raw: (sql, params = []) => query.raw(sql, params) };
  return { post, events: new EventsClient(ctx) };
};

const payloadOf = (post: jest.Mock, call: number): QueryPayload =>
  post.mock.calls[call]![1] as QueryPayload;

const STARTS = '2030-01-01T18:00:00.000Z';

const createInput = (overrides: Partial<CreateEventInput> = {}): CreateEventInput => ({
  title: 'Launch Mixer',
  startsAt: STARTS,
  ...overrides,
});

// ───────────────────────── create ─────────────────────────

describe('create', () => {
  it('inserts an event with an auto-generated slug and applies defaults', async () => {
    const { post, events } = makeEvents();
    // uniqueSlug LIKE lookup (call 0), then the INSERT (call 1).
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    const event = await events.create(createInput());

    expect(event).toEqual(
      expect.objectContaining({
        slug: 'launch-mixer',
        title: 'Launch Mixer',
        summary: '',
        body: '',
        data: {},
        starts_at: STARTS,
        ends_at: null,
        capacity: 0,
        status: 'published',
      }),
    );
    const payload = payloadOf(post, 1);
    expect(payload.type).toBe('INSERT');
    expect(payload.table).toBe(EVENTS_TABLES.EVENTS);
  });

  it('omits created_at from the wire insert (DB default owns it)', async () => {
    const { post, events } = makeEvents();
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    await events.create(createInput());
    const data = payloadOf(post, 1).data as Record<string, unknown>;
    expect(data).not.toHaveProperty('created_at');
    // starts_at IS sent — a real timestamptz column that accepts ISO strings.
    expect(data.starts_at).toBe(STARTS);
  });

  it('omits ends_at when not provided, includes it (ISO) when given', async () => {
    const { post, events } = makeEvents();
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    await events.create(createInput());
    expect(payloadOf(post, 1).data as Record<string, unknown>).not.toHaveProperty('ends_at');

    const ENDS = '2030-01-01T21:00:00.000Z';
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    const event = await events.create(createInput({ endsAt: ENDS }));
    expect(event.ends_at).toBe(ENDS);
    expect((payloadOf(post, 3).data as Record<string, unknown>).ends_at).toBe(ENDS);
  });

  it('slugifies the title and dedupes against existing slugs', async () => {
    const { post, events } = makeEvents();
    post
      .mockResolvedValueOnce({ data: [{ slug: 'launch-mixer' }, { slug: 'launch-mixer-2' }] })
      .mockResolvedValueOnce({ data: [] });
    const event = await events.create(createInput());
    expect(event.slug).toBe('launch-mixer-3');
    // The dedup lookup is a scoped LIKE on slug.
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: EVENTS_TABLES.EVENTS,
        columns: ['slug'],
        where: [{ column: 'slug', operator: 'LIKE', value: 'launch-mixer%', type: 'AND' }],
      }),
    );
  });

  it('honours an explicit slug without a dedup lookup', async () => {
    const { post, events } = makeEvents();
    post.mockResolvedValueOnce({ data: [] });
    const event = await events.create(createInput({ slug: 'custom-slug' }));
    expect(event.slug).toBe('custom-slug');
    // Only the INSERT — no LIKE lookup.
    expect(post).toHaveBeenCalledTimes(1);
    expect(payloadOf(post, 0).type).toBe('INSERT');
  });

  it('carries summary, body, data, capacity, and status through', async () => {
    const { post, events } = makeEvents();
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    const event = await events.create(
      createInput({
        summary: 'A party',
        body: '<p>Come</p>',
        data: { venue: 'HQ' },
        capacity: 50,
        status: 'draft',
      }),
    );
    expect(event).toEqual(
      expect.objectContaining({
        summary: 'A party',
        body: '<p>Come</p>',
        data: { venue: 'HQ' },
        capacity: 50,
        status: 'draft',
      }),
    );
  });

  it('rejects a missing title', async () => {
    const { events } = makeEvents();
    await expect(
      events.create(createInput({ title: '  ' })),
    ).rejects.toThrow(/"title"/);
  });

  it('rejects a missing / malformed startsAt', async () => {
    const { events } = makeEvents();
    await expect(
      events.create(createInput({ startsAt: undefined as unknown as string })),
    ).rejects.toThrow(/"startsAt"/);
    await expect(
      events.create(createInput({ startsAt: 'not-a-date' })),
    ).rejects.toThrow(/"startsAt" must be an ISO-8601 date string/);
  });

  it('rejects a malformed endsAt', async () => {
    const { events } = makeEvents();
    await expect(
      events.create(createInput({ endsAt: 'nope' })),
    ).rejects.toThrow(/"endsAt" must be an ISO-8601 date string/);
  });

  it.each([
    [-1],
    [2.5],
    ['5' as unknown as number],
  ])('rejects invalid capacity %p', async (capacity) => {
    const { events } = makeEvents();
    await expect(
      events.create(createInput({ capacity: capacity as number })),
    ).rejects.toThrow(/"capacity"/);
  });

  it('rejects an unknown status', async () => {
    const { events } = makeEvents();
    await expect(
      events.create(createInput({ status: 'live' as never })),
    ).rejects.toThrow(/"status" must be one of draft, published, cancelled/);
  });
});

// ───────────────────────── list ─────────────────────────

describe('list', () => {
  it('upcoming (default): status published, starts_at >= now, ordered ASC', async () => {
    const { post, events } = makeEvents();
    post.mockResolvedValue({ data: [{ id: 'e1' }] });
    await expect(events.list()).resolves.toEqual([{ id: 'e1' }]);
    const p = payloadOf(post, 0);
    expect(p.table).toBe(EVENTS_TABLES.EVENTS);
    expect(p.where).toEqual([
      { column: 'status', operator: '=', value: 'published', type: 'AND' },
      { column: 'starts_at', operator: '>=', value: expect.any(String), type: 'AND' },
    ]);
    expect(p.orderBy).toEqual([{ column: 'starts_at', direction: 'ASC' }]);
  });

  it('past: starts_at < now, ordered DESC', async () => {
    const { post, events } = makeEvents();
    post.mockResolvedValue({ data: [] });
    await events.list({ when: 'past' });
    const p = payloadOf(post, 0);
    expect(p.where).toEqual([
      { column: 'status', operator: '=', value: 'published', type: 'AND' },
      { column: 'starts_at', operator: '<', value: expect.any(String), type: 'AND' },
    ]);
    expect(p.orderBy).toEqual([{ column: 'starts_at', direction: 'DESC' }]);
  });

  it('all: no time filter, ordered ASC', async () => {
    const { post, events } = makeEvents();
    post.mockResolvedValue({ data: [] });
    await events.list({ when: 'all' });
    const p = payloadOf(post, 0);
    expect(p.where).toEqual([
      { column: 'status', operator: '=', value: 'published', type: 'AND' },
    ]);
    expect(p.orderBy).toEqual([{ column: 'starts_at', direction: 'ASC' }]);
  });

  it("status 'all' skips the status filter (still time-filtered)", async () => {
    const { post, events } = makeEvents();
    post.mockResolvedValue({ data: [] });
    await events.list({ when: 'upcoming', status: 'all' });
    const p = payloadOf(post, 0);
    expect(p.where).toEqual([
      { column: 'starts_at', operator: '>=', value: expect.any(String), type: 'AND' },
    ]);
  });

  it('forwards a specific status and limit/offset', async () => {
    const { post, events } = makeEvents();
    post.mockResolvedValue({ data: [] });
    await events.list({ when: 'all', status: 'draft', limit: 5, offset: 10 });
    const p = payloadOf(post, 0);
    expect(p.where).toEqual([{ column: 'status', operator: '=', value: 'draft', type: 'AND' }]);
    expect(p.limit).toBe(5);
    expect(p.offset).toBe(10);
  });

  it('rejects an unknown when / status', async () => {
    const { events } = makeEvents();
    await expect(events.list({ when: 'someday' as never })).rejects.toThrow(/"when" must be one of/);
    await expect(events.list({ status: 'live' as never })).rejects.toThrow(/"status" must be one of/);
  });
});

// ───────────────────────── getBySlug ─────────────────────────

describe('getBySlug', () => {
  it('returns null when the event does not exist (no count queries)', async () => {
    const { post, events } = makeEvents();
    post.mockResolvedValueOnce({ data: [] });
    await expect(events.getBySlug('missing')).resolves.toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('merges seat sums (Σ party_size) and computes spotsLeft', async () => {
    const { post, events } = makeEvents();
    post
      .mockResolvedValueOnce({ data: [{ id: 'e1', slug: 'mixer', capacity: 10 }] }) // event
      .mockResolvedValueOnce({ data: [{ party_size: 2 }, { party_size: '3' }] }) // confirmed → 5
      .mockResolvedValueOnce({ data: [{ party_size: 4 }] }); // waitlist → 4
    const event = await events.getBySlug('mixer');
    expect(event).toEqual(
      expect.objectContaining({
        id: 'e1',
        confirmedCount: 5,
        waitlistCount: 4,
        spotsLeft: 5, // 10 - 5
      }),
    );
    // confirmed seat-sum query: scoped by event + status, selecting party_size.
    expect(payloadOf(post, 1)).toEqual(
      expect.objectContaining({
        table: EVENTS_TABLES.RSVPS,
        columns: ['party_size'],
        where: [
          { column: 'event_id', operator: '=', value: 'e1', type: 'AND' },
          { column: 'status', operator: '=', value: 'confirmed', type: 'AND' },
        ],
      }),
    );
  });

  it('sums party_size whether the runtime returns snake_case or camelCase keys', async () => {
    const { post, events } = makeEvents();
    post
      .mockResolvedValueOnce({ data: [{ id: 'e1', slug: 'mixer', capacity: 10 }] })
      // gateway runtime camelCases the column name → partySize
      .mockResolvedValueOnce({ data: [{ partySize: 2 }, { partySize: 3 }] })
      .mockResolvedValueOnce({ data: [{ partySize: 1 }] });
    const event = await events.getBySlug('mixer');
    expect(event?.confirmedCount).toBe(5);
    expect(event?.waitlistCount).toBe(1);
    expect(event?.spotsLeft).toBe(5);
  });

  it('reports spotsLeft null for unlimited (capacity 0) events', async () => {
    const { post, events } = makeEvents();
    post
      .mockResolvedValueOnce({ data: [{ id: 'e1', slug: 'mixer', capacity: 0 }] })
      .mockResolvedValueOnce({ data: [{ party_size: 3 }] })
      .mockResolvedValueOnce({ data: [] });
    const event = await events.getBySlug('mixer');
    expect(event?.spotsLeft).toBeNull();
    expect(event?.confirmedCount).toBe(3);
    expect(event?.waitlistCount).toBe(0);
  });

  it('never reports negative spotsLeft (oversold clamps to 0)', async () => {
    const { post, events } = makeEvents();
    post
      .mockResolvedValueOnce({ data: [{ id: 'e1', slug: 'mixer', capacity: 2 }] })
      .mockResolvedValueOnce({ data: [{ party_size: 5 }] })
      .mockResolvedValueOnce({ data: [] });
    const event = await events.getBySlug('mixer');
    expect(event?.spotsLeft).toBe(0);
  });

  it('rejects an empty slug', async () => {
    const { events } = makeEvents();
    await expect(events.getBySlug('')).rejects.toThrow(/"slug"/);
  });
});

// ───────────────────────── rsvp ─────────────────────────

describe('rsvp', () => {
  const foundEvent = (overrides: Record<string, unknown> = {}) => ({
    data: [{ id: 'e1', slug: 'mixer', status: 'published', capacity: 2, ...overrides }],
  });

  it('confirms immediately when capacity is unlimited (0) — no seat query', async () => {
    const { post, events } = makeEvents();
    post
      .mockResolvedValueOnce(foundEvent({ capacity: 0 })) // resolve event
      .mockResolvedValueOnce({ data: [] }); // insert
    const rsvp = await events.rsvp('mixer', { name: 'Ada', email: 'ada@example.com' });
    expect(rsvp.status).toBe('confirmed');
    expect(rsvp.party_size).toBe(1);
    // event lookup + insert only (no seat-sum read).
    expect(post).toHaveBeenCalledTimes(2);
    expect(payloadOf(post, 1).type).toBe('INSERT');
  });

  it('confirms when the party still fits exactly (confirmed + party == capacity)', async () => {
    const { post, events } = makeEvents();
    post
      .mockResolvedValueOnce(foundEvent({ capacity: 2 }))
      .mockResolvedValueOnce({ data: [{ party_size: 1 }] }) // 1 confirmed seat
      .mockResolvedValueOnce({ data: [] });
    const rsvp = await events.rsvp('mixer', { name: 'Ada', email: 'ada@example.com' });
    expect(rsvp.status).toBe('confirmed'); // 1 + 1 == 2
  });

  it('waitlists when the event is exactly full', async () => {
    const { post, events } = makeEvents();
    post
      .mockResolvedValueOnce(foundEvent({ capacity: 2 }))
      .mockResolvedValueOnce({ data: [{ party_size: 2 }] }) // already full
      .mockResolvedValueOnce({ data: [] });
    const rsvp = await events.rsvp('mixer', { name: 'Bo', email: 'bo@example.com' });
    expect(rsvp.status).toBe('waitlist'); // 2 + 1 > 2
  });

  it('waitlists a party that overflows the remaining seats', async () => {
    const { post, events } = makeEvents();
    post
      .mockResolvedValueOnce(foundEvent({ capacity: 5 }))
      .mockResolvedValueOnce({ data: [{ party_size: 3 }] }) // 3 taken, 2 left
      .mockResolvedValueOnce({ data: [] });
    const rsvp = await events.rsvp('mixer', {
      name: 'Cy',
      email: 'cy@example.com',
      partySize: 3,
    }); // 3 + 3 > 5
    expect(rsvp.status).toBe('waitlist');
  });

  it('omits created_at from the rsvp insert and stores party_size + event_id', async () => {
    const { post, events } = makeEvents();
    post
      .mockResolvedValueOnce(foundEvent({ capacity: 0 }))
      .mockResolvedValueOnce({ data: [] });
    await events.rsvp('mixer', { name: 'Ada', email: 'ada@example.com', partySize: 2 });
    const data = payloadOf(post, 1).data as Record<string, unknown>;
    expect(data).not.toHaveProperty('created_at');
    expect(data).toEqual(
      expect.objectContaining({
        event_id: 'e1',
        name: 'Ada',
        email: 'ada@example.com',
        party_size: 2,
        status: 'confirmed',
      }),
    );
  });

  it('resolves by id (UUID) when no slug matches', async () => {
    const { post, events } = makeEvents();
    const id = '11111111-1111-4111-8111-111111111111';
    post
      .mockResolvedValueOnce({ data: [] }) // slug lookup misses
      .mockResolvedValueOnce({ data: [{ id, slug: 'mixer', status: 'published', capacity: 0 }] }) // id lookup
      .mockResolvedValueOnce({ data: [] }); // insert
    const rsvp = await events.rsvp(id, { name: 'Ada', email: 'ada@example.com' });
    expect(rsvp.event_id).toBe(id);
    expect(payloadOf(post, 0).where).toEqual([
      { column: 'slug', operator: '=', value: id, type: 'AND' },
    ]);
    expect(payloadOf(post, 1).where).toEqual([
      { column: 'id', operator: '=', value: id, type: 'AND' },
    ]);
  });

  it('rejects an unknown event', async () => {
    const { post, events } = makeEvents();
    post.mockResolvedValue({ data: [] });
    await expect(
      events.rsvp('ghost', { name: 'Ada', email: 'ada@example.com' }),
    ).rejects.toThrow(/unknown event "ghost"/);
  });

  it('refuses to RSVP to a cancelled event', async () => {
    const { post, events } = makeEvents();
    post.mockResolvedValueOnce(foundEvent({ status: 'cancelled' }));
    await expect(
      events.rsvp('mixer', { name: 'Ada', email: 'ada@example.com' }),
    ).rejects.toThrow(/cancelled/);
  });

  it('validates name, email, and partySize', async () => {
    const { events } = makeEvents();
    await expect(
      events.rsvp('mixer', { name: '', email: 'ada@example.com' }),
    ).rejects.toThrow(/"name"/);
    await expect(
      events.rsvp('mixer', { name: 'Ada', email: 'not-an-email' }),
    ).rejects.toThrow(/"email" must be a valid email address/);
    await expect(
      events.rsvp('mixer', { name: 'Ada', email: 'ada@example.com', partySize: 0 }),
    ).rejects.toThrow(/"partySize" must be an integer between 1 and 20/);
    await expect(
      events.rsvp('mixer', { name: 'Ada', email: 'ada@example.com', partySize: 21 }),
    ).rejects.toThrow(/"partySize" must be an integer between 1 and 20/);
    await expect(
      events.rsvp('mixer', { name: 'Ada', email: 'ada@example.com', partySize: 1.5 }),
    ).rejects.toThrow(/"partySize" must be an integer/);
  });
});

// ───────────────────────── listRsvps / cancelRsvp ─────────────────────────

describe('listRsvps', () => {
  it('scopes to the event, newest first', async () => {
    const { post, events } = makeEvents();
    post.mockResolvedValue({ data: [{ id: 'r1' }] });
    await expect(events.listRsvps('e1')).resolves.toEqual([{ id: 'r1' }]);
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: EVENTS_TABLES.RSVPS,
        where: [{ column: 'event_id', operator: '=', value: 'e1', type: 'AND' }],
        orderBy: [{ column: 'created_at', direction: 'DESC' }],
      }),
    );
  });

  it('filters by status when given', async () => {
    const { post, events } = makeEvents();
    post.mockResolvedValue({ data: [] });
    await events.listRsvps('e1', { status: 'waitlist' });
    expect(payloadOf(post, 0).where).toEqual([
      { column: 'event_id', operator: '=', value: 'e1', type: 'AND' },
      { column: 'status', operator: '=', value: 'waitlist', type: 'AND' },
    ]);
  });

  it('rejects an unknown status and an empty eventId', async () => {
    const { events } = makeEvents();
    await expect(events.listRsvps('e1', { status: 'nope' as never })).rejects.toThrow(
      /"status" must be one of confirmed, waitlist, cancelled/,
    );
    await expect(events.listRsvps('')).rejects.toThrow(/"eventId"/);
  });
});

describe('cancelRsvp', () => {
  it('flips the status to cancelled by id', async () => {
    const { post, events } = makeEvents();
    post.mockResolvedValue({ data: [] });
    await events.cancelRsvp('r1');
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        type: 'UPDATE',
        table: EVENTS_TABLES.RSVPS,
        data: { status: 'cancelled' },
        where: [{ column: 'id', operator: '=', value: 'r1', type: 'AND' }],
      }),
    );
  });

  it('rejects an empty id', async () => {
    const { events } = makeEvents();
    await expect(events.cancelRsvp('')).rejects.toThrow(/"id"/);
  });
});
