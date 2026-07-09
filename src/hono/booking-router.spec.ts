import type { XenitionClient } from '../xenition-client';
import { bookingRouter } from './booking-router';

const makeClient = () => {
  const booking = {
    listResources: jest.fn(),
    getResource: jest.fn(),
    searchSlots: jest.fn(),
    book: jest.fn(),
  };
  const use = jest.fn();
  const client = { modules: { use, booking } } as unknown as XenitionClient;
  return { client, booking, use };
};

const postJson = (
  app: ReturnType<typeof bookingRouter>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const AT = '2027-03-15T13:00:00.000Z';

describe('GET /booking/resources', () => {
  it('lists resources normalized to camelCase and forwards status', async () => {
    const { client, booking, use } = makeClient();
    booking.listResources.mockResolvedValue([
      { id: 'r1', slug: 'barber', name: 'Barber', slot_minutes: 30, created_at: 't0' },
    ]);
    const res = await bookingRouter({ client }).request('/booking/resources?status=all');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.resources).toEqual([
      expect.objectContaining({ id: 'r1', slug: 'barber', slotMinutes: 30, createdAt: 't0' }),
    ]);
    expect(booking.listResources).toHaveBeenCalledWith({ status: 'all' });
    expect(use).toHaveBeenCalledWith('booking');
  });
});

describe('GET /booking/resources/:slug', () => {
  it('returns the resource camelCased', async () => {
    const { client, booking } = makeClient();
    booking.getResource.mockResolvedValue({
      id: 'r1',
      slug: 'barber',
      slot_minutes: 30,
      min_notice_minutes: 60,
    });
    const res = await bookingRouter({ client }).request('/booking/resources/barber');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({ id: 'r1', slug: 'barber', slotMinutes: 30, minNoticeMinutes: 60 }),
    );
  });

  it('404s an unknown resource', async () => {
    const { client, booking } = makeClient();
    booking.getResource.mockResolvedValue(null);
    const res = await bookingRouter({ client }).request('/booking/resources/ghost');
    expect(res.status).toBe(404);
    expect((await res.json() as any).error.code).toBe('NOT_FOUND');
  });
});

describe('GET /booking/resources/:slug/slots', () => {
  it('returns slots for a valid window', async () => {
    const { client, booking } = makeClient();
    booking.searchSlots.mockResolvedValue([
      { startsAt: AT, endsAt: '2027-03-15T13:30:00.000Z', spotsLeft: 1 },
    ]);
    const res = await bookingRouter({ client }).request(
      '/booking/resources/barber/slots?from=2027-03-15T04:00:00Z&to=2027-03-16T04:00:00Z',
    );
    expect(res.status).toBe(200);
    expect((await res.json() as any).slots).toEqual([
      { startsAt: AT, endsAt: '2027-03-15T13:30:00.000Z', spotsLeft: 1 },
    ]);
    expect(booking.searchSlots).toHaveBeenCalledWith('barber', {
      from: '2027-03-15T04:00:00Z',
      to: '2027-03-16T04:00:00Z',
    });
  });

  it('400s when from/to are missing', async () => {
    const { client } = makeClient();
    const res = await bookingRouter({ client }).request('/booking/resources/barber/slots?from=2027-03-15T04:00:00Z');
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.message).toContain('"from" and "to"');
  });

  it('404s an unknown resource (SDK not-found message)', async () => {
    const { client, booking } = makeClient();
    booking.searchSlots.mockRejectedValue(
      new Error('BookingClient.searchSlots: unknown resource "ghost"'),
    );
    const res = await bookingRouter({ client }).request(
      '/booking/resources/ghost/slots?from=2027-03-15T04:00:00Z&to=2027-03-16T04:00:00Z',
    );
    expect(res.status).toBe(404);
  });

  it("400s the SDK's validation message on a bad window", async () => {
    const { client, booking } = makeClient();
    booking.searchSlots.mockRejectedValue(
      new Error('BookingClient.searchSlots: "to" must be after "from"'),
    );
    const res = await bookingRouter({ client }).request(
      '/booking/resources/barber/slots?from=2027-03-16T04:00:00Z&to=2027-03-15T04:00:00Z',
    );
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.message).toContain('"to" must be after');
  });
});

describe('POST /booking/resources/:slug/bookings', () => {
  it('creates a booking and returns 201 {id, startsAt, status}', async () => {
    const { client, booking } = makeClient();
    booking.book.mockResolvedValue({ id: 'bk1', starts_at: AT, status: 'confirmed' });
    const res = await postJson(bookingRouter({ client }), '/booking/resources/barber/bookings', {
      startsAt: AT,
      customerName: 'Ada',
      customerEmail: 'ada@example.com',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'bk1', startsAt: AT, status: 'confirmed' });
    expect(booking.book).toHaveBeenCalledWith('barber', {
      startsAt: AT,
      customerName: 'Ada',
      customerEmail: 'ada@example.com',
      partySize: undefined,
      notes: undefined,
    });
  });

  it('409s SLOT_UNAVAILABLE when the slot is gone', async () => {
    const { client, booking } = makeClient();
    booking.book.mockRejectedValue(
      new Error('BookingClient.book: SLOT_UNAVAILABLE — the slot was just taken'),
    );
    const res = await postJson(bookingRouter({ client }), '/booking/resources/barber/bookings', {
      startsAt: AT,
      customerName: 'Ada',
      customerEmail: 'ada@example.com',
    });
    expect(res.status).toBe(409);
    expect((await res.json() as any).error.code).toBe('SLOT_UNAVAILABLE');
  });

  it("400s the SDK's validation message on a bad email", async () => {
    const { client, booking } = makeClient();
    booking.book.mockRejectedValue(
      new Error('BookingClient.book: "customerEmail" must be a valid email address'),
    );
    const res = await postJson(bookingRouter({ client }), '/booking/resources/barber/bookings', {
      startsAt: AT,
      customerName: 'Ada',
      customerEmail: 'nope',
    });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.message).toContain('"customerEmail"');
  });

  it('404s a booking against an unknown resource', async () => {
    const { client, booking } = makeClient();
    booking.book.mockRejectedValue(new Error('BookingClient.book: unknown resource "ghost"'));
    const res = await postJson(bookingRouter({ client }), '/booking/resources/ghost/bookings', {
      startsAt: AT,
      customerName: 'Ada',
      customerEmail: 'ada@example.com',
    });
    expect(res.status).toBe(404);
    expect((await res.json() as any).error.code).toBe('NOT_FOUND');
  });

  it('400s a non-object body', async () => {
    const { client } = makeClient();
    const res = await postJson(bookingRouter({ client }), '/booking/resources/barber/bookings', 'hi');
    expect(res.status).toBe(400);
  });

  it('rate limits bookings but never the GETs', async () => {
    const { client, booking } = makeClient();
    booking.book.mockResolvedValue({ id: 'bk1', starts_at: AT, status: 'confirmed' });
    booking.listResources.mockResolvedValue([]);
    booking.getResource.mockResolvedValue({ id: 'r1', slug: 'barber' });
    const app = bookingRouter({ client, rateLimit: 1 });
    const ip = { 'cf-connecting-ip': '203.0.113.7' };
    const body = { startsAt: AT, customerName: 'A', customerEmail: 'a@example.com' };
    expect((await postJson(app, '/booking/resources/barber/bookings', body, ip)).status).toBe(201);
    expect((await postJson(app, '/booking/resources/barber/bookings', body, ip)).status).toBe(429);
    expect((await app.request('/booking/resources', { headers: ip })).status).toBe(200);
    expect((await app.request('/booking/resources/barber', { headers: ip })).status).toBe(200);
  });
});
