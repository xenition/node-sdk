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
 *   GET /media/albums/:slug/private?code=
 *        → the album (camelCased) + items — a code-gated "client gallery"
 *          that is NOT listed by GET /media/albums and ignores `published`
 *          entirely. 404 on an unknown slug, a missing/wrong code, or an
 *          album with no code set (never reveals which case fired — same
 *          model as `GET /orders/by-number/:number?email=`).
 *
 * Because the router holds the SERVICE key, single-resource routes 404
 * unpublished albums and the list route defaults to published-only
 * (`?published=all` opts out). `access_code` is a write-only field from the
 * router's perspective — every response below strips it before it reaches
 * `normalizeRow`, so it can never appear (as `access_code` or `accessCode`)
 * in a public/normal response body.
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
    // access_code is a write-only gate column — never let it reach a
    // public/normal response (see the file doc comment above).
    const sanitized = albums.map(({ access_code: _accessCode, ...rest }) => rest);
    return c.json({ albums: normalizeRows(sanitized) });
  });

  app.get('/media/albums/:slug', async (c) => {
    const media = resolve(c).modules.media;
    const album = await media.getAlbumWithItems(c.req.param('slug'));
    if (!album || !album.published) return jsonNotFound(c);
    const { items, access_code: _accessCode, ...rest } = album;
    return c.json({ ...normalizeRow(rest), items: normalizeRows(items) });
  });

  app.get('/media/albums/:slug/items', async (c) => {
    const media = resolve(c).modules.media;
    const album = await media.getAlbum(c.req.param('slug'));
    if (!album || !album.published) return jsonNotFound(c);
    const items = await media.listItems(album.id);
    return c.json({ items: normalizeRows(items) });
  });

  // A literal `/private` suffix on a 3-segment path (media, albums, :slug)
  // is a 4-segment route — it can never be shadowed by /media/albums/:slug
  // or /media/albums/:slug/items (same reasoning as GET /booking/bookings/:id).
  app.get('/media/albums/:slug/private', async (c) => {
    const media = resolve(c).modules.media;
    const code = c.req.query('code');
    // No code at all is the same 404 as a wrong one — never let an absent
    // query param short-circuit into a different response shape.
    if (!code) return jsonNotFound(c);
    const album = await media.getAlbumByCode(c.req.param('slug'), code);
    if (!album) return jsonNotFound(c);
    const { items, access_code: _accessCode, ...rest } = album;
    return c.json({ ...normalizeRow(rest), items: normalizeRows(items) });
  });

  return app;
}
