import { Hono } from 'hono';
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
export declare function reviewsRouter(options?: XenitionRouterOptions): Hono;
//# sourceMappingURL=reviews-router.d.ts.map