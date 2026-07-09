import { Hono } from 'hono';
import type { XenitionRouterOptions } from './types';
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
export declare function mediaRouter(options?: XenitionRouterOptions): Hono;
//# sourceMappingURL=media-router.d.ts.map