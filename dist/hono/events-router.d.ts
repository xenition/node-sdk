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
 *   POST /events/:slug/rsvps  body {name, email, partySize?}
 *        → 201 {id, status: 'confirmed'|'waitlist'}
 *
 * RSVPs are rate limited per IP (best-effort — see rate-limit.ts).
 */
export declare function eventsRouter(options?: XenitionRouterOptions): Hono;
//# sourceMappingURL=events-router.d.ts.map