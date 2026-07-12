import { Hono } from 'hono';
import type { CmsListOptions } from '../modules/cms';
import { makeClientResolver } from './client';
import { badRequest, honoErrorHandler, jsonNotFound } from './errors';
import { normalizeRow, normalizeRows } from './normalize';
import {
  QueryParamError,
  applyCors,
  parseDirection,
  parseNonNegativeInt,
  parsePublished,
} from './router-utils';
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
export function cmsRouter(options: XenitionRouterOptions = {}): Hono {
  const resolve = makeClientResolver('cms', options.client);
  const app = new Hono();
  applyCors(app, options.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  app.get('/pages/:slug', async (c) => {
    const cms = resolve(c).modules.cms;
    const page = await cms.getPageBySlug(c.req.param('slug'));
    if (!page || !page.published) return jsonNotFound(c);
    return c.json(normalizeRow(page));
  });

  app.get('/collections/:key/items', async (c) => {
    const cms = resolve(c).modules.cms;
    let listOptions: CmsListOptions;
    try {
      listOptions = {
        published: parsePublished(c.req.query('published')),
        orderBy: c.req.query('orderBy') || undefined,
        direction: parseDirection(c.req.query('direction')),
        limit: parseNonNegativeInt('limit', c.req.query('limit')),
        offset: parseNonNegativeInt('offset', c.req.query('offset')),
      };
    } catch (err) {
      if (err instanceof QueryParamError) return badRequest(c, err.message);
      throw err;
    }
    const items = await cms.listItems(c.req.param('key'), listOptions);
    return c.json({ items: normalizeRows(items) });
  });

  app.get('/collections/:key/items/:slug', async (c) => {
    const cms = resolve(c).modules.cms;
    const item = await cms.getItemBySlug(c.req.param('key'), c.req.param('slug'));
    if (!item || !item.published) return jsonNotFound(c);
    return c.json(normalizeRow(item));
  });

  return app;
}
