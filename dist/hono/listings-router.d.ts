import { Hono } from 'hono';
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
export declare function listingsRouter(options?: XenitionRouterOptions): Hono;
//# sourceMappingURL=listings-router.d.ts.map