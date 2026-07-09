"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmsRouter = cmsRouter;
const hono_1 = require("hono");
const client_1 = require("./client");
const errors_1 = require("./errors");
const normalize_1 = require("./normalize");
const router_utils_1 = require("./router-utils");
/**
 * Read-only public CMS routes — thin passthroughs to `client.modules.cms`
 * with responses normalized to camelCase (see normalize.ts).
 *
 *   GET /pages/:slug
 *   GET /collections/:key/items?published=1&orderBy=sort&direction=ASC&limit=&offset=
 *   GET /collections/:key/items/:slug
 *
 * Because the router holds the SERVICE key, single-resource routes 404
 * unpublished rows and the list route defaults to published-only
 * (`?published=all` opts out — reads are anon-visible anyway, so this is
 * a sane default, not a security boundary).
 */
function cmsRouter(options = {}) {
    const resolve = (0, client_1.makeClientResolver)('cms', options.client);
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    app.get('/pages/:slug', async (c) => {
        const cms = resolve(c).modules.cms;
        const page = await cms.getPageBySlug(c.req.param('slug'));
        if (!page || !page.published)
            return (0, errors_1.jsonNotFound)(c);
        return c.json((0, normalize_1.normalizeRow)(page));
    });
    app.get('/collections/:key/items', async (c) => {
        const cms = resolve(c).modules.cms;
        let listOptions;
        try {
            listOptions = {
                published: (0, router_utils_1.parsePublished)(c.req.query('published')),
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
        const items = await cms.listItems(c.req.param('key'), listOptions);
        return c.json({ items: (0, normalize_1.normalizeRows)(items) });
    });
    app.get('/collections/:key/items/:slug', async (c) => {
        const cms = resolve(c).modules.cms;
        const item = await cms.getItemBySlug(c.req.param('key'), c.req.param('slug'));
        if (!item || !item.published)
            return (0, errors_1.jsonNotFound)(c);
        return c.json((0, normalize_1.normalizeRow)(item));
    });
    return app;
}
//# sourceMappingURL=cms-router.js.map