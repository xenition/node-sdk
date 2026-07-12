import { Hono } from 'hono';
import { makeClientResolver } from './client';
import { badRequest, honoErrorHandler, jsonNotFound } from './errors';
import { normalizeRows } from './normalize';
import { rateLimiter } from './rate-limit';
import {
  QueryParamError,
  applyCors,
  parseNonNegativeInt,
} from './router-utils';
import type { XenitionRouterOptions } from './types';

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
export function reviewsRouter(options: XenitionRouterOptions = {}): Hono {
  const resolve = makeClientResolver('reviews', options.client);
  const app = new Hono();
  applyCors(app, options.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  app.get('/:targetType/:targetId', async (c) => {
    const reviews = resolve(c).modules.reviews;
    const target = { type: c.req.param('targetType'), id: c.req.param('targetId') };
    let limit: number | undefined;
    let offset: number | undefined;
    try {
      limit = parseNonNegativeInt('limit', c.req.query('limit'));
      offset = parseNonNegativeInt('offset', c.req.query('offset'));
    } catch (err) {
      if (err instanceof QueryParamError) return badRequest(c, err.message);
      throw err;
    }
    const [approved, aggregate] = await Promise.all([
      reviews.listApproved(target, { limit, offset }),
      reviews.aggregate(target),
    ]);
    return c.json({ reviews: normalizeRows(approved), aggregate });
  });

  // Attached to the POST route only — the GET on the same path stays unmetered.
  if (options.rateLimit !== false) {
    app.post('/:targetType/:targetId', rateLimiter(options.rateLimit ?? 10));
  }

  app.post('/:targetType/:targetId', async (c) => {
    const reviews = resolve(c).modules.reviews;
    const body = await c.req.json().catch(() => undefined);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return badRequest(c, 'Request body must be a JSON object {authorName, rating, title?, body?}.');
    }
    const input = body as Record<string, unknown>;
    const review = await reviews.submit({
      target: { type: c.req.param('targetType'), id: c.req.param('targetId') },
      authorName: input.authorName as string,
      rating: input.rating as number,
      title: input.title as string | undefined,
      body: input.body as string | undefined,
    });
    return c.json({ id: review.id, status: review.status }, 201);
  });

  return app;
}
