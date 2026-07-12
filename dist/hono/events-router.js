"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventsRouter = eventsRouter;
const hono_1 = require("hono");
const client_1 = require("./client");
const errors_1 = require("./errors");
const normalize_1 = require("./normalize");
const rate_limit_1 = require("./rate-limit");
const router_utils_1 = require("./router-utils");
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
function eventsRouter(options = {}) {
    const resolve = (0, client_1.makeClientResolver)('events', options.client);
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    app.get('/events', async (c) => {
        const events = resolve(c).modules.events;
        let limit;
        let offset;
        try {
            limit = (0, router_utils_1.parseNonNegativeInt)('limit', c.req.query('limit'));
            offset = (0, router_utils_1.parseNonNegativeInt)('offset', c.req.query('offset'));
        }
        catch (err) {
            if (err instanceof router_utils_1.QueryParamError)
                return (0, errors_1.badRequest)(c, err.message);
            throw err;
        }
        const rows = await events.list({
            when: c.req.query('when'),
            status: c.req.query('status'),
            limit,
            offset,
        });
        return c.json({ events: (0, normalize_1.normalizeRows)(rows) });
    });
    app.get('/events/:slug', async (c) => {
        const events = resolve(c).modules.events;
        const event = await events.getBySlug(c.req.param('slug'));
        if (!event)
            return (0, errors_1.jsonNotFound)(c);
        return c.json((0, normalize_1.normalizeRow)(event));
    });
    // Attached to the POST route only — the GETs stay unmetered.
    if (options.rateLimit !== false) {
        app.post('/events/:slug/rsvps', (0, rate_limit_1.rateLimiter)(options.rateLimit ?? 10));
    }
    app.post('/events/:slug/rsvps', async (c) => {
        const events = resolve(c).modules.events;
        const body = await c.req.json().catch(() => undefined);
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            return (0, errors_1.badRequest)(c, 'Request body must be a JSON object {name, email, partySize?}.');
        }
        const input = body;
        const rsvp = await events.rsvp(c.req.param('slug'), {
            name: input.name,
            email: input.email,
            partySize: input.partySize,
        });
        return c.json({ id: rsvp.id, status: rsvp.status }, 201);
    });
    return app;
}
//# sourceMappingURL=events-router.js.map