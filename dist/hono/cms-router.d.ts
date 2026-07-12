import { Hono } from 'hono';
import type { XenitionRouterOptions } from './types';
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
export declare function cmsRouter(options?: XenitionRouterOptions): Hono;
//# sourceMappingURL=cms-router.d.ts.map