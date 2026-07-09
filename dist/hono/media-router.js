"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mediaRouter = mediaRouter;
const hono_1 = require("hono");
const client_1 = require("./client");
const errors_1 = require("./errors");
const normalize_1 = require("./normalize");
const router_utils_1 = require("./router-utils");
/**
 * Read-only public media routes — thin passthroughs to
 * `client.modules.media` with responses normalized to camelCase (see
 * normalize.ts). Media is curated via the service key, so there is no
 * public write path here.
 *
 *   GET /media/albums?published=1&orderBy=sort&direction=ASC&limit=&offset=
 *        → { albums: [...camelCased] }
 *   GET /media/albums/:slug
 *        → the album (camelCased) merged with { items: [...] }; the common
 *          gallery-render case. 404 when unknown or unpublished.
 *   GET /media/albums/:slug/items
 *        → { items: [...camelCased] }; 404 when the album is unknown/unpublished.
 *
 * Because the router holds the SERVICE key, single-resource routes 404
 * unpublished albums and the list route defaults to published-only
 * (`?published=all` opts out).
 */
function mediaRouter(options = {}) {
    const resolve = (0, client_1.makeClientResolver)('media', options.client);
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    app.get('/media/albums', async (c) => {
        const media = resolve(c).modules.media;
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
        const albums = await media.listAlbums(listOptions);
        return c.json({ albums: (0, normalize_1.normalizeRows)(albums) });
    });
    app.get('/media/albums/:slug', async (c) => {
        const media = resolve(c).modules.media;
        const album = await media.getAlbumWithItems(c.req.param('slug'));
        if (!album || !album.published)
            return (0, errors_1.jsonNotFound)(c);
        const { items, ...rest } = album;
        return c.json({ ...(0, normalize_1.normalizeRow)(rest), items: (0, normalize_1.normalizeRows)(items) });
    });
    app.get('/media/albums/:slug/items', async (c) => {
        const media = resolve(c).modules.media;
        const album = await media.getAlbum(c.req.param('slug'));
        if (!album || !album.published)
            return (0, errors_1.jsonNotFound)(c);
        const items = await media.listItems(album.id);
        return c.json({ items: (0, normalize_1.normalizeRows)(items) });
    });
    return app;
}
//# sourceMappingURL=media-router.js.map