import { Hono } from 'hono';
import type { XenitionRouterOptions } from './types';
/**
 * Events routes — public read + the sanctioned RSVP write path (anon-key
 * writes are banned platform-wide).
 *
 *   GET  /events?when=upcoming&status=&limit=&offset=
 *        → { events: [...camelCased] }
 *   GET  /events/:slug
 *        → the event (camelCased) merged with {confirmedCount,
 *          waitlistCount, spotsLeft}; 404 when unknown.
 *   GET  /events/rsvps/:id
 *        → the RSVP (camelCased); 404 when unknown. v0 access model: the
 *          rsvp's `id` is an unguessable UUID, so it doubles as the
 *          confirmation-page access token (same model as GET /orders/:id).
 *          A literal `rsvps` second segment can never be matched by the
 *          single-segment `/events/:slug` route, so registration order here
 *          doesn't matter — but it's placed with the other GETs regardless.
 *   POST /events/:slug/rsvps  body {name, email, partySize?}
 *        → 201 {id, status: 'confirmed'|'waitlist'}
 *
 * RSVPs are rate limited per IP (best-effort — see rate-limit.ts).
 */
export declare function eventsRouter(options?: XenitionRouterOptions): Hono;
//# sourceMappingURL=events-router.d.ts.map