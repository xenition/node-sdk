"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listingsRouter = listingsRouter;
const hono_1 = require("hono");
const client_1 = require("./client");
const errors_1 = require("./errors");
const normalize_1 = require("./normalize");
const rate_limit_1 = require("./rate-limit");
const router_utils_1 = require("./router-utils");
/**
 * Listings routes — public reads + the sanctioned write path (anon-key
 * writes are banned platform-wide, so a browser submits through here).
 *
 *   GET  /?category=&status=published&featured=&orderBy=&limit=&offset=
 *        → { listings: [...published, camelCased] } for a category
 *   GET  /meta/categories        → { categories: [...distinct, published] }
 *   GET  /:slug                  → a single published listing (404 otherwise)
 *   POST /  body {category, title, summary?, body?, data?}
 *        → 201 {id, slug, status: 'pending'} — submissions ALWAYS land
 *          pending (moderation stays a service-key back-office concern) and
 *          can never self-feature.
 *
 * Because the router holds the SERVICE key on a public surface, reads are
 * published-only and submissions are rate limited per IP (best-effort — see
 * rate-limit.ts). Responses are normalized to camelCase (see normalize.ts).
 */
function listingsRouter(options = {}) {
    const resolve = (0, client_1.makeClientResolver)('listings', options.client);
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    app.get('/', async (c) => {
        const listings = resolve(c).modules.listings;
        const category = c.req.query('category');
        if (!category)
            return (0, errors_1.badRequest)(c, '"category" query parameter is required.');
        const status = c.req.query('status');
        let listOptions;
        try {
            listOptions = {
                status: status ? status : undefined,
                featured: (0, router_utils_1.parseBooleanFlag)('featured', c.req.query('featured')),
                orderBy: c.req.query('orderBy') || undefined,
                direction: (0, router_utils_1.parseDirection)(c.req.query('direction')),
                limit: (0, router_utils_1.parseNonNegativeInt)('limit', c.req.query('limit')),
                offset: (0, router_utils_1.parseNonNegativeInt)('offset', c.req.query('offset')),
            };
        }
        catch (err) {
            if (err instanceof router_utils_1.QueryParamError)
                return (0, errors_1.badRequest)(c, err.message);
            throw err;
        }
        const rows = await listings.list(category, listOptions);
        return c.json({ listings: (0, normalize_1.normalizeRows)(rows) });
    });
    // Two-segment meta route registered before the `/:slug` catch-all.
    app.get('/meta/categories', async (c) => {
        const listings = resolve(c).modules.listings;
        return c.json({ categories: await listings.categories() });
    });
    app.get('/:slug', async (c) => {
        const listings = resolve(c).modules.listings;
        const listing = await listings.getBySlug(c.req.param('slug'));
        if (!listing)
            return (0, errors_1.jsonNotFound)(c);
        return c.json((0, normalize_1.normalizeRow)(listing));
    });
    // Attached to the POST route only — reads stay unmetered.
    if (options.rateLimit !== false) {
        app.post('/', (0, rate_limit_1.rateLimiter)(options.rateLimit ?? 10));
    }
    app.post('/', async (c) => {
        const listings = resolve(c).modules.listings;
        const body = await c.req.json().catch(() => undefined);
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            return (0, errors_1.badRequest)(c, 'Request body must be a JSON object {category, title, summary?, body?, data?}.');
        }
        const input = body;
        // Public submissions ALWAYS land pending and can never self-feature:
        // only the whitelisted content fields are forwarded, status is forced.
        const listing = await listings.create({
            category: input.category,
            title: input.title,
            summary: input.summary,
            body: input.body,
            data: input.data,
            status: 'pending',
        });
        return c.json({ id: listing.id, slug: listing.slug, status: listing.status }, 201);
    });
    return app;
}
//# sourceMappingURL=listings-router.js.map