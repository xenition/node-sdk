import { Hono } from 'hono';
import type { ListAlbumsOptions } from '../modules/media';
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
export function mediaRouter(options: XenitionRouterOptions = {}): Hono {
  const resolve = makeClientResolver('media', options.client);
  const app = new Hono();
  applyCors(app, options.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  app.get('/media/albums', async (c) => {
    const media = resolve(c).modules.media;
    let listOptions: ListAlbumsOptions;
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
    const albums = await media.listAlbums(listOptions);
    return c.json({ albums: normalizeRows(albums) });
  });

  app.get('/media/albums/:slug', async (c) => {
    const media = resolve(c).modules.media;
    const album = await media.getAlbumWithItems(c.req.param('slug'));
    if (!album || !album.published) return jsonNotFound(c);
    const { items, ...rest } = album;
    return c.json({ ...normalizeRow(rest), items: normalizeRows(items) });
  });

  app.get('/media/albums/:slug/items', async (c) => {
    const media = resolve(c).modules.media;
    const album = await media.getAlbum(c.req.param('slug'));
    if (!album || !album.published) return jsonNotFound(c);
    const items = await media.listItems(album.id);
    return c.json({ items: normalizeRows(items) });
  });

  return app;
}
