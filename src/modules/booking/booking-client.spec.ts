import { HttpClient } from '../../core/http-client';
import { QueryClient } from '../../query/query-client';
import { QueryPayload } from '../../query/types';
import { MigrationsClient } from '../../migrations/migrations-client';
import { ModulesClient } from '../modules-client';
import { ModuleContext } from '../core';
import { BookingClient, BOOKING_TABLES } from './booking-client';
import { AvailabilityRule, BookingResource } from './types';

const makeBooking = () => {
  const post = jest.fn();
  const query = new QueryClient({ post } as unknown as HttpClient);
  const ctx: ModuleContext = { query, raw: (sql, params = []) => query.raw(sql, params) };
  return { post, booking: new BookingClient(ctx) };
};

const payloadOf = (post: jest.Mock, call: number): QueryPayload =>
  post.mock.calls[call]![1] as QueryPayload;

const MON_9_5: AvailabilityRule[] = [{ weekday: 1, start: '09:00', end: '17:00' }];

/** A DB-shaped resource row (snake_case) as `getResource` would receive it. */
const resourceRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'r1',
  slug: 'barber',
  name: 'Barber',
  type: 'service',
  timezone: 'America/New_York',
  capacity: 1,
  slot_minutes: 30,
  buffer_minutes: 0,
  min_notice_minutes: 0,
  max_advance_days: 100000, // effectively unbounded so future test dates pass
  availability: MON_9_5,
  data: {},
  status: 'active',
  created_at: '2027-01-01T00:00:00.000Z',
  ...overrides,
});

// A Monday well after the 2027 spring-forward transition (pure EDT, -4h).
const MON = { from: '2027-03-15T04:00:00Z', to: '2027-03-16T04:00:00Z' };

// ───────────────────────── createResource ─────────────────────────

describe('createResource', () => {
  it('inserts a resource with an auto-slug and applies every default', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    const resource = await booking.createResource({ name: 'Hair Cut' });

    expect(resource).toEqual(
      expect.objectContaining({
        slug: 'hair-cut',
        name: 'Hair Cut',
        type: 'service',
        timezone: 'UTC',
        capacity: 1,
        slot_minutes: 30,
        buffer_minutes: 0,
        min_notice_minutes: 0,
        max_advance_days: 60,
        availability: [],
        data: {},
        status: 'active',
      }),
    );
    expect(payloadOf(post, 1).type).toBe('INSERT');
    expect(payloadOf(post, 1).table).toBe(BOOKING_TABLES.RESOURCES);
  });

  it('omits created_at from the wire insert and sends availability/data', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    await booking.createResource({ name: 'Room A', availability: MON_9_5 });
    const data = payloadOf(post, 1).data as Record<string, unknown>;
    expect(data).not.toHaveProperty('created_at');
    expect(data.availability).toEqual(MON_9_5);
    expect(data.data).toEqual({});
  });

  it('carries through all custom fields', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    const resource = await booking.createResource({
      name: 'Yoga',
      type: 'class',
      timezone: 'America/New_York',
      capacity: 12,
      slotMinutes: 60,
      bufferMinutes: 15,
      minNoticeMinutes: 120,
      maxAdvanceDays: 30,
      availability: MON_9_5,
      data: { price: 20 },
      status: 'inactive',
    });
    expect(resource).toEqual(
      expect.objectContaining({
        type: 'class',
        timezone: 'America/New_York',
        capacity: 12,
        slot_minutes: 60,
        buffer_minutes: 15,
        min_notice_minutes: 120,
        max_advance_days: 30,
        data: { price: 20 },
        status: 'inactive',
      }),
    );
  });

  it('honours an explicit slug without a dedup lookup', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [] });
    const resource = await booking.createResource({ name: 'Barber', slug: 'custom' });
    expect(resource.slug).toBe('custom');
    expect(post).toHaveBeenCalledTimes(1);
    expect(payloadOf(post, 0).type).toBe('INSERT');
  });

  it('dedupes the slug against existing rows', async () => {
    const { post, booking } = makeBooking();
    post
      .mockResolvedValueOnce({ data: [{ slug: 'barber' }, { slug: 'barber-2' }] })
      .mockResolvedValueOnce({ data: [] });
    const resource = await booking.createResource({ name: 'Barber' });
    expect(resource.slug).toBe('barber-3');
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: BOOKING_TABLES.RESOURCES,
        columns: ['slug'],
        where: [{ column: 'slug', operator: 'LIKE', value: 'barber%', type: 'AND' }],
      }),
    );
  });

  it('rejects a missing name', async () => {
    const { booking } = makeBooking();
    await expect(booking.createResource({ name: '  ' })).rejects.toThrow(/"name"/);
  });

  it('rejects an invalid IANA timezone', async () => {
    const { booking } = makeBooking();
    await expect(
      booking.createResource({ name: 'X', timezone: 'Foo/Bar' }),
    ).rejects.toThrow(/"timezone" must be a valid IANA timezone/);
  });

  it.each([
    ['capacity', { capacity: 0 }],
    ['capacity', { capacity: 2.5 }],
    ['slotMinutes', { slotMinutes: 0 }],
    ['maxAdvanceDays', { maxAdvanceDays: 0 }],
    ['bufferMinutes', { bufferMinutes: -1 }],
  ])('rejects invalid %s', async (_label, patch) => {
    const { booking } = makeBooking();
    await expect(
      booking.createResource({ name: 'X', ...(patch as object) }),
    ).rejects.toThrow(/must be an integer/);
  });

  it('rejects an unknown status', async () => {
    const { booking } = makeBooking();
    await expect(
      booking.createResource({ name: 'X', status: 'paused' as never }),
    ).rejects.toThrow(/"status" must be one of active, inactive/);
  });

  it.each([
    [{ weekday: 7, start: '09:00', end: '17:00' }, /weekday/],
    [{ weekday: 1, start: '25:00', end: '17:00' }, /start/],
    [{ weekday: 1, start: '09:00', end: '08:00' }, /end/],
    [{ weekday: 1, start: '09:00', end: 'noon' }, /end/],
  ])('rejects a malformed availability rule %p', async (rule, re) => {
    const { booking } = makeBooking();
    await expect(
      booking.createResource({ name: 'X', availability: [rule as AvailabilityRule] }),
    ).rejects.toThrow(re);
  });
});

// ───────────────────────── getResource / listResources ─────────────────────────

describe('getResource', () => {
  it('returns a hydrated resource, coercing string numbers and JSON availability', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({
      data: [
        resourceRow({
          capacity: '3',
          slot_minutes: '45',
          availability: JSON.stringify(MON_9_5), // some runtimes stringify jsonb
        }),
      ],
    });
    const resource = await booking.getResource('barber');
    expect(resource).toEqual(
      expect.objectContaining({
        capacity: 3,
        slot_minutes: 45,
        availability: MON_9_5,
      }),
    );
  });

  it('returns null when unknown', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [] });
    await expect(booking.getResource('ghost')).resolves.toBeNull();
  });

  it('rejects an empty slug', async () => {
    const { booking } = makeBooking();
    await expect(booking.getResource('')).rejects.toThrow(/"slug"/);
  });
});

describe('listResources', () => {
  it('defaults to the active filter, ordered by name', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [resourceRow()] });
    await booking.listResources();
    const p = payloadOf(post, 0);
    expect(p.where).toEqual([{ column: 'status', operator: '=', value: 'active', type: 'AND' }]);
    expect(p.orderBy).toEqual([{ column: 'name', direction: 'ASC' }]);
  });

  it("status 'all' skips the filter", async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [] });
    await booking.listResources({ status: 'all' });
    expect(payloadOf(post, 0).where).toBeUndefined();
  });

  it('rejects an unknown status', async () => {
    const { booking } = makeBooking();
    await expect(booking.listResources({ status: 'paused' as never })).rejects.toThrow(
      /"status" must be one of active, inactive, all/,
    );
  });
});

// ───────────────────────── updateResource ─────────────────────────

describe('updateResource', () => {
  it('maps camelCase patch keys to snake_case columns', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [] });
    await booking.updateResource('r1', {
      slotMinutes: 45,
      bufferMinutes: 10,
      minNoticeMinutes: 60,
      maxAdvanceDays: 90,
      status: 'inactive',
    });
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        type: 'UPDATE',
        table: BOOKING_TABLES.RESOURCES,
        data: {
          slot_minutes: 45,
          buffer_minutes: 10,
          min_notice_minutes: 60,
          max_advance_days: 90,
          status: 'inactive',
        },
        where: [{ column: 'id', operator: '=', value: 'r1', type: 'AND' }],
      }),
    );
  });

  it('validates availability in the patch', async () => {
    const { booking } = makeBooking();
    await expect(
      booking.updateResource('r1', {
        availability: [{ weekday: 9, start: '09:00', end: '17:00' } as AvailabilityRule],
      }),
    ).rejects.toThrow(/weekday/);
  });

  it('rejects an empty patch', async () => {
    const { booking } = makeBooking();
    await expect(booking.updateResource('r1', {})).rejects.toThrow(/at least one field/);
  });

  it('rejects an empty id', async () => {
    const { booking } = makeBooking();
    await expect(booking.updateResource('', { status: 'inactive' })).rejects.toThrow(/"id"/);
  });
});

// ───────────────────────── blackouts ─────────────────────────

describe('addBlackout / listBlackouts', () => {
  it('inserts a blackout, omitting created_at and sending ISO bounds', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [] });
    const blackout = await booking.addBlackout('r1', {
      startsAt: '2027-12-25T00:00:00Z',
      endsAt: '2027-12-26T00:00:00Z',
      reason: 'Holiday',
    });
    expect(blackout).toEqual(
      expect.objectContaining({ resource_id: 'r1', reason: 'Holiday' }),
    );
    const data = payloadOf(post, 0).data as Record<string, unknown>;
    expect(data).not.toHaveProperty('created_at');
    expect(data.starts_at).toBe('2027-12-25T00:00:00Z');
    expect(data.ends_at).toBe('2027-12-26T00:00:00Z');
  });

  it('rejects a blackout whose end is not after its start', async () => {
    const { booking } = makeBooking();
    await expect(
      booking.addBlackout('r1', { startsAt: '2027-12-25T00:00:00Z', endsAt: '2027-12-25T00:00:00Z' }),
    ).rejects.toThrow(/"endsAt" must be after "startsAt"/);
  });

  it('rejects a malformed timestamp', async () => {
    const { booking } = makeBooking();
    await expect(
      booking.addBlackout('r1', { startsAt: 'nope', endsAt: '2027-12-26T00:00:00Z' }),
    ).rejects.toThrow(/"startsAt" must be an ISO-8601/);
  });

  it('lists blackouts scoped to the resource, earliest first', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [{ id: 'b1' }] });
    await expect(booking.listBlackouts('r1')).resolves.toEqual([{ id: 'b1' }]);
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: BOOKING_TABLES.BLACKOUTS,
        where: [{ column: 'resource_id', operator: '=', value: 'r1', type: 'AND' }],
        orderBy: [{ column: 'starts_at', direction: 'ASC' }],
      }),
    );
  });
});

// ───────────────────────── searchSlots ─────────────────────────

/** Mock getResource + empty booking/blackout window loads, in call order. */
const primeSearch = (
  post: jest.Mock,
  row: Record<string, unknown>,
  bookings: unknown[] = [],
  blackouts: unknown[] = [],
) => {
  post
    .mockResolvedValueOnce({ data: [row] }) // getResource
    .mockResolvedValueOnce({ data: bookings }) // confirmed bookings
    .mockResolvedValueOnce({ data: blackouts }); // blackouts
};

describe('searchSlots — generation', () => {
  it('expands a weekly rule into slot_minutes-granular slots (UTC, DST-correct offset)', async () => {
    const { post, booking } = makeBooking();
    primeSearch(post, resourceRow());
    const slots = await booking.searchSlots('barber', MON);
    // 09:00–17:00 EDT, 30-min slots → 16 slots; 09:00 EDT = 13:00Z.
    expect(slots).toHaveLength(16);
    expect(slots[0]).toEqual({
      startsAt: '2027-03-15T13:00:00.000Z',
      endsAt: '2027-03-15T13:30:00.000Z',
      spotsLeft: 1,
    });
    expect(slots[slots.length - 1]!.startsAt).toBe('2027-03-15T20:30:00.000Z');
  });

  it('respects a 60-minute slot length', async () => {
    const { post, booking } = makeBooking();
    primeSearch(post, resourceRow({ slot_minutes: 60 }));
    const slots = await booking.searchSlots('barber', MON);
    expect(slots).toHaveLength(8); // 09..16
    expect(slots[1]!.startsAt).toBe('2027-03-15T14:00:00.000Z'); // +60 min
  });

  it('honours buffer_minutes as extra spacing between slots', async () => {
    const { post, booking } = makeBooking();
    primeSearch(post, resourceRow({ slot_minutes: 30, buffer_minutes: 30 }));
    const slots = await booking.searchSlots('barber', MON);
    // step = 60 min, slot = 30 min → starts hourly.
    expect(slots[0]!.startsAt).toBe('2027-03-15T13:00:00.000Z');
    expect(slots[1]!.startsAt).toBe('2027-03-15T14:00:00.000Z');
    expect(slots[0]!.endsAt).toBe('2027-03-15T13:30:00.000Z');
  });

  it('excludes slots entirely in the past (min-notice/now floor)', async () => {
    const { post, booking } = makeBooking();
    primeSearch(post, resourceRow());
    // A Monday in 2020 — every slot is before now.
    const slots = await booking.searchSlots('barber', {
      from: '2020-03-16T04:00:00Z',
      to: '2020-03-17T04:00:00Z',
    });
    expect(slots).toEqual([]);
  });

  it('excludes slots beyond max_advance_days', async () => {
    const { post, booking } = makeBooking();
    primeSearch(post, resourceRow({ max_advance_days: 1 }));
    const slots = await booking.searchSlots('barber', MON); // 2027, far beyond +1 day
    expect(slots).toEqual([]);
  });

  it('subtracts slots overlapping a blackout', async () => {
    const { post, booking } = makeBooking();
    primeSearch(post, resourceRow(), [], [
      { starts_at: '2027-03-15T13:00:00.000Z', ends_at: '2027-03-15T14:00:00.000Z' },
    ]);
    const slots = await booking.searchSlots('barber', MON);
    // 13:00 and 13:30 removed → 14 slots, first now 14:00Z.
    expect(slots).toHaveLength(14);
    expect(slots[0]!.startsAt).toBe('2027-03-15T14:00:00.000Z');
  });

  it('decrements spotsLeft by overlapping confirmed party_size', async () => {
    const { post, booking } = makeBooking();
    primeSearch(post, resourceRow({ capacity: 3 }), [
      { starts_at: '2027-03-15T13:00:00.000Z', ends_at: '2027-03-15T13:30:00.000Z', party_size: 2 },
    ]);
    const slots = await booking.searchSlots('barber', MON);
    expect(slots[0]).toEqual(
      expect.objectContaining({ startsAt: '2027-03-15T13:00:00.000Z', spotsLeft: 1 }),
    );
    expect(slots[1]!.spotsLeft).toBe(3);
  });

  it('excludes a slot once confirmed bookings reach capacity', async () => {
    const { post, booking } = makeBooking();
    primeSearch(post, resourceRow({ capacity: 1 }), [
      { starts_at: '2027-03-15T13:00:00.000Z', ends_at: '2027-03-15T13:30:00.000Z', party_size: 1 },
    ]);
    const slots = await booking.searchSlots('barber', MON);
    expect(slots).toHaveLength(15);
    expect(slots[0]!.startsAt).toBe('2027-03-15T13:30:00.000Z');
  });

  it('sums party_size whether the runtime returns snake_case or camelCase', async () => {
    const { post, booking } = makeBooking();
    primeSearch(post, resourceRow({ capacity: 5 }), [
      { startsAt: '2027-03-15T13:00:00.000Z', endsAt: '2027-03-15T13:30:00.000Z', partySize: 4 },
    ]);
    const slots = await booking.searchSlots('barber', MON);
    expect(slots[0]!.spotsLeft).toBe(1); // 5 - 4
  });

  it('renders UTC-zone resources with no offset', async () => {
    const { post, booking } = makeBooking();
    primeSearch(post, resourceRow({ timezone: 'UTC', availability: [{ weekday: 1, start: '09:00', end: '10:00' }] }));
    const slots = await booking.searchSlots('barber', MON);
    expect(slots.map((s) => s.startsAt)).toEqual([
      '2027-03-15T09:00:00.000Z',
      '2027-03-15T09:30:00.000Z',
    ]);
  });

  it('returns [] for an inactive resource without loading the window', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [resourceRow({ status: 'inactive' })] });
    await expect(booking.searchSlots('barber', MON)).resolves.toEqual([]);
    expect(post).toHaveBeenCalledTimes(1); // only getResource
  });

  it('returns [] when the resource has no availability rules', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [resourceRow({ availability: [] })] });
    await expect(booking.searchSlots('barber', MON)).resolves.toEqual([]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('throws NOT_FOUND-style error for an unknown resource', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [] });
    await expect(booking.searchSlots('ghost', MON)).rejects.toThrow(/unknown resource "ghost"/);
  });

  it('rejects a reversed or missing window', async () => {
    const { booking } = makeBooking();
    await expect(
      booking.searchSlots('barber', { from: MON.to, to: MON.from }),
    ).rejects.toThrow(/"to" must be after "from"/);
    await expect(
      booking.searchSlots('barber', { from: 'x', to: MON.to }),
    ).rejects.toThrow(/"from" must be an ISO-8601/);
  });
});

describe('searchSlots — DST', () => {
  // A resource open 00:00–06:00 on Sundays, straddling the 02:00 transition.
  const overnightSunday = () =>
    resourceRow({ availability: [{ weekday: 0, start: '00:00', end: '06:00' }], slot_minutes: 60 });

  it('spring-forward: drops the non-existent 02:00 hour', async () => {
    const { post, booking } = makeBooking();
    primeSearch(post, overnightSunday());
    const slots = await booking.searchSlots('barber', {
      from: '2027-03-14T00:00:00Z',
      to: '2027-03-15T12:00:00Z',
    });
    // 00:00 EST=05:00Z … 06:00 EDT=10:00Z → 5 slots; local 02:00 is skipped.
    expect(slots.map((s) => s.startsAt)).toEqual([
      '2027-03-14T05:00:00.000Z',
      '2027-03-14T06:00:00.000Z',
      '2027-03-14T07:00:00.000Z',
      '2027-03-14T08:00:00.000Z',
      '2027-03-14T09:00:00.000Z',
    ]);
  });

  it('fall-back: keeps the repeated 01:00 hour', async () => {
    const { post, booking } = makeBooking();
    primeSearch(post, overnightSunday());
    const slots = await booking.searchSlots('barber', {
      from: '2027-11-07T00:00:00Z',
      to: '2027-11-08T12:00:00Z',
    });
    // 00:00 EDT=04:00Z … 06:00 EST=11:00Z → 7 slots (the 01:00 hour occurs twice).
    expect(slots.map((s) => s.startsAt)).toEqual([
      '2027-11-07T04:00:00.000Z',
      '2027-11-07T05:00:00.000Z',
      '2027-11-07T06:00:00.000Z',
      '2027-11-07T07:00:00.000Z',
      '2027-11-07T08:00:00.000Z',
      '2027-11-07T09:00:00.000Z',
      '2027-11-07T10:00:00.000Z',
    ]);
  });
});

// ───────────────────────── book ─────────────────────────

/** Mock getResource + empty window + the insert, in call order. */
const primeBook = (post: jest.Mock, row: Record<string, unknown>, bookings: unknown[] = []) => {
  post
    .mockResolvedValueOnce({ data: [row] }) // getResource
    .mockResolvedValueOnce({ data: bookings }) // confirmed bookings
    .mockResolvedValueOnce({ data: [] }) // blackouts
    .mockResolvedValueOnce({ data: [] }); // insert
};

const AT = '2027-03-15T13:00:00.000Z'; // a real Monday 09:00 EDT slot

describe('book', () => {
  it('books a real open slot: confirmed, ends_at derived, slot_lock set for capacity=1', async () => {
    const { post, booking } = makeBooking();
    primeBook(post, resourceRow());
    const result = await booking.book('barber', {
      startsAt: AT,
      customerName: 'Ada',
      customerEmail: 'ada@example.com',
    });
    expect(result).toEqual(
      expect.objectContaining({
        resource_id: 'r1',
        starts_at: AT,
        ends_at: '2027-03-15T13:30:00.000Z',
        party_size: 1,
        status: 'confirmed',
      }),
    );
    const data = payloadOf(post, 3).data as Record<string, unknown>;
    expect(payloadOf(post, 3).type).toBe('INSERT');
    expect(data).not.toHaveProperty('created_at');
    expect(data.starts_at).toBe(AT);
    expect(data.slot_lock).toBe(AT); // capacity=1 exclusivity lock
  });

  it('omits slot_lock for group (capacity>1) resources and honours remaining capacity', async () => {
    const { post, booking } = makeBooking();
    primeBook(post, resourceRow({ capacity: 3 }), [
      { starts_at: AT, ends_at: '2027-03-15T13:30:00.000Z', party_size: 2 },
    ]);
    const result = await booking.book('barber', {
      startsAt: AT,
      customerName: 'Ada',
      customerEmail: 'ada@example.com',
    });
    expect(result.status).toBe('confirmed');
    expect(payloadOf(post, 3).data).not.toHaveProperty('slot_lock');
  });

  it('SLOT_UNAVAILABLE when the time is not on the availability grid', async () => {
    const { post, booking } = makeBooking();
    primeBook(post, resourceRow());
    await expect(
      booking.book('barber', {
        startsAt: '2027-03-15T13:15:00.000Z', // off the 30-min grid
        customerName: 'Ada',
        customerEmail: 'ada@example.com',
      }),
    ).rejects.toThrow(/SLOT_UNAVAILABLE/);
    expect(post).toHaveBeenCalledTimes(3); // no insert
  });

  it('SLOT_UNAVAILABLE when the slot is already full', async () => {
    const { post, booking } = makeBooking();
    primeBook(post, resourceRow({ capacity: 1 }), [
      { starts_at: AT, ends_at: '2027-03-15T13:30:00.000Z', party_size: 1 },
    ]);
    await expect(
      booking.book('barber', { startsAt: AT, customerName: 'Ada', customerEmail: 'ada@example.com' }),
    ).rejects.toThrow(/SLOT_UNAVAILABLE/);
  });

  it('SLOT_UNAVAILABLE when the party exceeds remaining capacity', async () => {
    const { post, booking } = makeBooking();
    primeBook(post, resourceRow({ capacity: 3 }));
    await expect(
      booking.book('barber', {
        startsAt: AT,
        customerName: 'Ada',
        customerEmail: 'ada@example.com',
        partySize: 4,
      }),
    ).rejects.toThrow(/SLOT_UNAVAILABLE/);
  });

  it('SLOT_UNAVAILABLE when a capacity=1 DB unique guard rejects the insert (race)', async () => {
    const { post, booking } = makeBooking();
    post
      .mockResolvedValueOnce({ data: [resourceRow()] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));
    await expect(
      booking.book('barber', { startsAt: AT, customerName: 'Ada', customerEmail: 'ada@example.com' }),
    ).rejects.toThrow(/SLOT_UNAVAILABLE/);
  });

  it('SLOT_UNAVAILABLE for an inactive resource (no window load)', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [resourceRow({ status: 'inactive' })] });
    await expect(
      booking.book('barber', { startsAt: AT, customerName: 'Ada', customerEmail: 'ada@example.com' }),
    ).rejects.toThrow(/SLOT_UNAVAILABLE/);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('throws NOT_FOUND-style error for an unknown resource', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [] });
    await expect(
      booking.book('ghost', { startsAt: AT, customerName: 'Ada', customerEmail: 'ada@example.com' }),
    ).rejects.toThrow(/unknown resource "ghost"/);
  });

  it('validates name, email, and partySize before any network call', async () => {
    const { booking } = makeBooking();
    await expect(
      booking.book('barber', { startsAt: AT, customerName: '', customerEmail: 'ada@example.com' }),
    ).rejects.toThrow(/"customerName"/);
    await expect(
      booking.book('barber', { startsAt: AT, customerName: 'Ada', customerEmail: 'nope' }),
    ).rejects.toThrow(/"customerEmail" must be a valid email address/);
    await expect(
      booking.book('barber', {
        startsAt: AT,
        customerName: 'Ada',
        customerEmail: 'ada@example.com',
        partySize: 0,
      }),
    ).rejects.toThrow(/"partySize" must be an integer/);
  });

  it('double-booking flow: after a booking the same slot is gone', async () => {
    const { post, booking } = makeBooking();
    // First book succeeds.
    primeBook(post, resourceRow());
    await booking.book('barber', { startsAt: AT, customerName: 'Ada', customerEmail: 'ada@example.com' });
    // Now a second search sees the slot at capacity → excluded.
    post.mockReset();
    primeSearch(post, resourceRow({ capacity: 1 }), [
      { starts_at: AT, ends_at: '2027-03-15T13:30:00.000Z', party_size: 1 },
    ]);
    const slots = await booking.searchSlots('barber', MON);
    expect(slots.find((s) => s.startsAt === AT)).toBeUndefined();
  });
});

// ───────────────────────── cancel / listBookings ─────────────────────────

describe('cancel', () => {
  it('flips a booking to cancelled by id', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [] });
    await booking.cancel('bk1');
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        type: 'UPDATE',
        table: BOOKING_TABLES.BOOKINGS,
        data: { status: 'cancelled' },
        where: [{ column: 'id', operator: '=', value: 'bk1', type: 'AND' }],
      }),
    );
  });

  it('rejects an empty id', async () => {
    const { booking } = makeBooking();
    await expect(booking.cancel('')).rejects.toThrow(/"bookingId"/);
  });
});

describe('listBookings', () => {
  it('scopes to the resource, ordered by starts_at ASC', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [{ id: 'bk1' }] });
    await expect(booking.listBookings('r1')).resolves.toEqual([{ id: 'bk1' }]);
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: BOOKING_TABLES.BOOKINGS,
        where: [{ column: 'resource_id', operator: '=', value: 'r1', type: 'AND' }],
        orderBy: [{ column: 'starts_at', direction: 'ASC' }],
      }),
    );
  });

  it('applies status + from/to filters', async () => {
    const { post, booking } = makeBooking();
    post.mockResolvedValueOnce({ data: [] });
    await booking.listBookings('r1', {
      status: 'confirmed',
      from: '2027-03-01T00:00:00Z',
      to: '2027-04-01T00:00:00Z',
    });
    expect(payloadOf(post, 0).where).toEqual([
      { column: 'resource_id', operator: '=', value: 'r1', type: 'AND' },
      { column: 'status', operator: '=', value: 'confirmed', type: 'AND' },
      { column: 'starts_at', operator: '>=', value: '2027-03-01T00:00:00Z', type: 'AND' },
      { column: 'starts_at', operator: '<', value: '2027-04-01T00:00:00Z', type: 'AND' },
    ]);
  });

  it('rejects an unknown status', async () => {
    const { booking } = makeBooking();
    await expect(booking.listBookings('r1', { status: 'pending' as never })).rejects.toThrow(
      /"status" must be one of confirmed, cancelled/,
    );
  });
});

// ───────────────────────── module lifecycle ─────────────────────────

describe('booking module lifecycle', () => {
  const makeModules = () => {
    const post = jest.fn().mockResolvedValue({ data: [] });
    const http = { post } as unknown as HttpClient;
    return { post, modules: new ModulesClient(http, new MigrationsClient(http)) };
  };

  it('enable("booking") runs the module migrations through the ledger', async () => {
    const { modules, post } = makeModules();
    await modules.enable('booking');
    const sqls = post.mock.calls.map((call) => (call[1] as { sql?: string }).sql ?? '');
    expect(sqls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS booking__resources'))).toBe(true);
    expect(sqls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS booking__blackouts'))).toBe(true);
    expect(sqls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS booking__bookings'))).toBe(true);
    expect(sqls.some((s) => s.includes('booking__bookings_slot_lock_uidx'))).toBe(true);
    expect(modules.isEnabled('booking')).toBe(true);
  });

  it('after enable, the accessor returns a BookingClient', async () => {
    const { modules } = makeModules();
    await modules.enable('booking');
    expect(modules.booking).toBeInstanceOf(BookingClient);
    expect(modules.booking).toBe(modules.booking); // cached
  });

  it('accessing booking before enable throws with the fix in the message', () => {
    const { modules } = makeModules();
    expect(() => modules.booking).toThrow(/not enabled/);
    expect(() => modules.booking).toThrow(/enable\('booking'\)/);
  });
});
