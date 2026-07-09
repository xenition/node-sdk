import { Hono } from 'hono';
import { makeClientResolver } from './client';
import { badRequest, honoErrorHandler, jsonNotFound } from './errors';
import { normalizeRow, normalizeRows } from './normalize';
import { rateLimiter } from './rate-limit';
import { QueryParamError, applyCors, parseNonNegativeInt } from './router-utils';
import type { XenitionRouterOptions } from './types';
import type { EventWhen } from '../modules/events';

/**
 * Events routes — public read + the sanctioned RSVP write path (anon-key
 * writes are banned platform-wide).
 *
 *   GET  /events?when=upcoming&status=&limit=&offset=
 *        → { events: [...camelCased] }
 *   GET  /events/:slug
 *        → the event (camelCased) merged with {confirmedCount,
 *          waitlistCount, spotsLeft}; 404 when unknown.
 *   POST /events/:slug/rsvps  body {name, email, partySize?}
 *        → 201 {id, status: 'confirmed'|'waitlist'}
 *
 * RSVPs are rate limited per IP (best-effort — see rate-limit.ts).
 */
export function eventsRouter(options: XenitionRouterOptions = {}): Hono {
  const resolve = makeClientResolver('events', options.client);
  const app = new Hono();
  applyCors(app, options.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  app.get('/events', async (c) => {
    const events = resolve(c).modules.events;
    let limit: number | undefined;
    let offset: number | undefined;
    try {
      limit = parseNonNegativeInt('limit', c.req.query('limit'));
      offset = parseNonNegativeInt('offset', c.req.query('offset'));
    } catch (err) {
      if (err instanceof QueryParamError) return badRequest(c, err.message);
      throw err;
    }
    const rows = await events.list({
      when: c.req.query('when') as EventWhen | undefined,
      status: c.req.query('status') as never,
      limit,
      offset,
    });
    return c.json({ events: normalizeRows(rows) });
  });

  app.get('/events/:slug', async (c) => {
    const events = resolve(c).modules.events;
    const event = await events.getBySlug(c.req.param('slug'));
    if (!event) return jsonNotFound(c);
    return c.json(normalizeRow(event));
  });

  // Attached to the POST route only — the GETs stay unmetered.
  if (options.rateLimit !== false) {
    app.post('/events/:slug/rsvps', rateLimiter(options.rateLimit ?? 10));
  }

  app.post('/events/:slug/rsvps', async (c) => {
    const events = resolve(c).modules.events;
    const body = await c.req.json().catch(() => undefined);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return badRequest(c, 'Request body must be a JSON object {name, email, partySize?}.');
    }
    const input = body as Record<string, unknown>;
    const rsvp = await events.rsvp(c.req.param('slug'), {
      name: input.name as string,
      email: input.email as string,
      partySize: input.partySize as number | undefined,
    });
    return c.json({ id: rsvp.id, status: rsvp.status }, 201);
  });

  return app;
}
