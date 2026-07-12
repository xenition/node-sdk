"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewsRouter = reviewsRouter;
const hono_1 = require("hono");
const client_1 = require("./client");
const errors_1 = require("./errors");
const normalize_1 = require("./normalize");
const rate_limit_1 = require("./rate-limit");
const router_utils_1 = require("./router-utils");
/**
 * Reviews routes — public read + the sanctioned write path (anon-key
 * writes are banned platform-wide).
 *
 *   GET  /:targetType/:targetId?limit=&offset=
 *        → { reviews: [...approved, camelCased], aggregate: {count, average} }
 *          in ONE payload (a review widget needs both).
 *   POST /:targetType/:targetId  body {authorName, rating, title?, body?}
 *        → 201 {id, status: 'pending'} — submissions ALWAYS land pending;
 *          moderation stays a service-key back-office concern.
 *
 * Submissions are rate limited per IP (best-effort — see rate-limit.ts).
 */
function reviewsRouter(options = {}) {
    const resolve = (0, client_1.makeClientResolver)('reviews', options.client);
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    app.get('/:targetType/:targetId', async (c) => {
        const reviews = resolve(c).modules.reviews;
        const target = { type: c.req.param('targetType'), id: c.req.param('targetId') };
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
        const [approved, aggregate] = await Promise.all([
            reviews.listApproved(target, { limit, offset }),
            reviews.aggregate(target),
        ]);
        return c.json({ reviews: (0, normalize_1.normalizeRows)(approved), aggregate });
    });
    // Attached to the POST route only — the GET on the same path stays unmetered.
    if (options.rateLimit !== false) {
        app.post('/:targetType/:targetId', (0, rate_limit_1.rateLimiter)(options.rateLimit ?? 10));
    }
    app.post('/:targetType/:targetId', async (c) => {
        const reviews = resolve(c).modules.reviews;
        const body = await c.req.json().catch(() => undefined);
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            return (0, errors_1.badRequest)(c, 'Request body must be a JSON object {authorName, rating, title?, body?}.');
        }
        const input = body;
        const review = await reviews.submit({
            target: { type: c.req.param('targetType'), id: c.req.param('targetId') },
            authorName: input.authorName,
            rating: input.rating,
            title: input.title,
            body: input.body,
        });
        return c.json({ id: review.id, status: review.status }, 201);
    });
    return app;
}
//# sourceMappingURL=reviews-router.js.map