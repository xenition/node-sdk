"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingRouter = bookingRouter;
const hono_1 = require("hono");
const client_1 = require("./client");
const errors_1 = require("./errors");
const normalize_1 = require("./normalize");
const rate_limit_1 = require("./rate-limit");
const router_utils_1 = require("./router-utils");
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
function bookingRouter(options = {}) {
    const resolve = (0, client_1.makeClientResolver)('booking', options.client);
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    app.get('/booking/resources', async (c) => {
        const booking = resolve(c).modules.booking;
        const rows = await booking.listResources({
            status: c.req.query('status'),
        });
        return c.json({ resources: (0, normalize_1.normalizeRows)(rows) });
    });
    app.get('/booking/resources/:slug', async (c) => {
        const booking = resolve(c).modules.booking;
        const resource = await booking.getResource(c.req.param('slug'));
        if (!resource)
            return (0, errors_1.jsonNotFound)(c);
        return c.json((0, normalize_1.normalizeRow)(resource));
    });
    app.get('/booking/resources/:slug/slots', async (c) => {
        const booking = resolve(c).modules.booking;
        const from = c.req.query('from');
        const to = c.req.query('to');
        if (!from || !to) {
            return (0, errors_1.badRequest)(c, 'Both "from" and "to" ISO-8601 query params are required.');
        }
        const slots = await booking.searchSlots(c.req.param('slug'), { from, to });
        return c.json({ slots });
    });
    // Attached to the POST route only — the GETs stay unmetered.
    if (options.rateLimit !== false) {
        app.post('/booking/resources/:slug/bookings', (0, rate_limit_1.rateLimiter)(options.rateLimit ?? 10));
    }
    app.post('/booking/resources/:slug/bookings', async (c) => {
        const booking = resolve(c).modules.booking;
        const body = await c.req.json().catch(() => undefined);
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            return (0, errors_1.badRequest)(c, 'Request body must be a JSON object {startsAt, customerName, customerEmail, partySize?, notes?}.');
        }
        const input = body;
        try {
            const result = await booking.book(c.req.param('slug'), {
                startsAt: input.startsAt,
                customerName: input.customerName,
                customerEmail: input.customerEmail,
                partySize: input.partySize,
                notes: input.notes,
            });
            return c.json({ id: result.id, startsAt: result.starts_at, status: result.status }, 201);
        }
        catch (err) {
            // A lost slot (real conflict / gone / at capacity) is a 409, not the
            // 400 the generic handler would give an SDK validation error. Bad
            // input (missing name, invalid email, …) still rethrows to onError.
            if (err instanceof Error && err.message.includes('SLOT_UNAVAILABLE')) {
                return c.json({ error: { code: 'SLOT_UNAVAILABLE', message: (0, errors_1.scrubMessage)(err.message) } }, 409);
            }
            throw err;
        }
    });
    return app;
}
//# sourceMappingURL=booking-router.js.map