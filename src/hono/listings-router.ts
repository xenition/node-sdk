import { Hono } from 'hono';
import type { ListingStatus, ListListingsOptions } from '../modules/listings';
import { makeClientResolver } from './client';
import { badRequest, honoErrorHandler, jsonNotFound } from './errors';
import { normalizeRow, normalizeRows } from './normalize';
import { rateLimiter } from './rate-limit';
import {
  QueryParamError,
  applyCors,
  parseBooleanFlag,
  parseDirection,
  parseNonNegativeInt,
} from './router-utils';
import type { XenitionRouterOptions } from './types';

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
export function listingsRouter(options: XenitionRouterOptions = {}): Hono {
  const resolve = makeClientResolver('listings', options.client);
  const app = new Hono();
  applyCors(app, options.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  app.get('/', async (c) => {
    const listings = resolve(c).modules.listings;
    const category = c.req.query('category');
    if (!category) return badRequest(c, '"category" query parameter is required.');
    const status = c.req.query('status');
    let listOptions: ListListingsOptions;
    try {
      listOptions = {
        status: status ? (status as ListingStatus) : undefined,
        featured: parseBooleanFlag('featured', c.req.query('featured')),
        orderBy: c.req.query('orderBy') || undefined,
        direction: parseDirection(c.req.query('direction')),
        limit: parseNonNegativeInt('limit', c.req.query('limit')),
        offset: parseNonNegativeInt('offset', c.req.query('offset')),
      };
    } catch (err) {
      if (err instanceof QueryParamError) return badRequest(c, err.message);
      throw err;
    }
    const rows = await listings.list(category, listOptions);
    return c.json({ listings: normalizeRows(rows) });
  });

  // Two-segment meta route registered before the `/:slug` catch-all.
  app.get('/meta/categories', async (c) => {
    const listings = resolve(c).modules.listings;
    return c.json({ categories: await listings.categories() });
  });

  app.get('/:slug', async (c) => {
    const listings = resolve(c).modules.listings;
    const listing = await listings.getBySlug(c.req.param('slug'));
    if (!listing) return jsonNotFound(c);
    return c.json(normalizeRow(listing));
  });

  // Attached to the POST route only — reads stay unmetered.
  if (options.rateLimit !== false) {
    app.post('/', rateLimiter(options.rateLimit ?? 10));
  }

  app.post('/', async (c) => {
    const listings = resolve(c).modules.listings;
    const body = await c.req.json().catch(() => undefined);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return badRequest(c, 'Request body must be a JSON object {category, title, summary?, body?, data?}.');
    }
    const input = body as Record<string, unknown>;
    // Public submissions ALWAYS land pending and can never self-feature:
    // only the whitelisted content fields are forwarded, status is forced.
    const listing = await listings.create({
      category: input.category as string,
      title: input.title as string,
      summary: input.summary as string | undefined,
      body: input.body as string | undefined,
      data: input.data as Record<string, unknown> | undefined,
      status: 'pending',
    });
    return c.json({ id: listing.id, slug: listing.slug, status: listing.status }, 201);
  });

  return app;
}
