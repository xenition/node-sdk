import { Hono } from 'hono';
import type { XenitionRouterOptions } from './types';
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
export declare function bookingRouter(options?: XenitionRouterOptions): Hono;
//# sourceMappingURL=booking-router.d.ts.map