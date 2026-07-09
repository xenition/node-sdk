import { Hono } from 'hono';
import { makeClientResolver } from './client';
import { badRequest, honoErrorHandler, jsonNotFound, scrubMessage } from './errors';
import { normalizeRow, normalizeRows } from './normalize';
import { rateLimiter } from './rate-limit';
import { applyCors } from './router-utils';
import type { XenitionRouterOptions } from './types';
import type { ResourceStatus } from '../modules/booking';

/**
 * Booking routes — public availability reads + the sanctioned public booking
 * write path (anon-key writes are banned platform-wide, so the app's own
 * service-key worker is where a slot gets taken).
 *
 *   GET  /booking/resources?status=
 *        → { resources: [...camelCased] }
 *   GET  /booking/resources/:slug
 *        → the resource (camelCased); 404 when unknown.
 *   GET  /booking/resources/:slug/slots?from=&to=
 *        → { slots: [{startsAt, endsAt, spotsLeft}] } (public availability)
 *   POST /booking/resources/:slug/bookings  body {startsAt, customerName,
 *        customerEmail, partySize?, notes?}
 *        → 201 {id, startsAt, status:'confirmed'} or 409 SLOT_UNAVAILABLE.
 *
 * The POST is rate limited per IP (best-effort — see rate-limit.ts).
 */
export function bookingRouter(options: XenitionRouterOptions = {}): Hono {
  const resolve = makeClientResolver('booking', options.client);
  const app = new Hono();
  applyCors(app, options.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  app.get('/booking/resources', async (c) => {
    const booking = resolve(c).modules.booking;
    const rows = await booking.listResources({
      status: c.req.query('status') as ResourceStatus | 'all' | undefined,
    });
    return c.json({ resources: normalizeRows(rows) });
  });

  app.get('/booking/resources/:slug', async (c) => {
    const booking = resolve(c).modules.booking;
    const resource = await booking.getResource(c.req.param('slug'));
    if (!resource) return jsonNotFound(c);
    return c.json(normalizeRow(resource));
  });

  app.get('/booking/resources/:slug/slots', async (c) => {
    const booking = resolve(c).modules.booking;
    const from = c.req.query('from');
    const to = c.req.query('to');
    if (!from || !to) {
      return badRequest(c, 'Both "from" and "to" ISO-8601 query params are required.');
    }
    const slots = await booking.searchSlots(c.req.param('slug'), { from, to });
    return c.json({ slots });
  });

  // Attached to the POST route only — the GETs stay unmetered.
  if (options.rateLimit !== false) {
    app.post('/booking/resources/:slug/bookings', rateLimiter(options.rateLimit ?? 10));
  }

  app.post('/booking/resources/:slug/bookings', async (c) => {
    const booking = resolve(c).modules.booking;
    const body = await c.req.json().catch(() => undefined);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return badRequest(
        c,
        'Request body must be a JSON object {startsAt, customerName, customerEmail, partySize?, notes?}.',
      );
    }
    const input = body as Record<string, unknown>;
    try {
      const result = await booking.book(c.req.param('slug'), {
        startsAt: input.startsAt as string,
        customerName: input.customerName as string,
        customerEmail: input.customerEmail as string,
        partySize: input.partySize as number | undefined,
        notes: input.notes as string | undefined,
      });
      return c.json({ id: result.id, startsAt: result.starts_at, status: result.status }, 201);
    } catch (err) {
      // A lost slot (real conflict / gone / at capacity) is a 409, not the
      // 400 the generic handler would give an SDK validation error. Bad
      // input (missing name, invalid email, …) still rethrows to onError.
      if (err instanceof Error && err.message.includes('SLOT_UNAVAILABLE')) {
        return c.json(
          { error: { code: 'SLOT_UNAVAILABLE', message: scrubMessage(err.message) } },
          409,
        );
      }
      throw err;
    }
  });

  return app;
}
