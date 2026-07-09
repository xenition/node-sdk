import { Hono } from 'hono';
import { cmsRouter } from './cms-router';
import { formsRouter } from './forms-router';
import { honoErrorHandler, jsonNotFound } from './errors';
import { eventsRouter } from './events-router';
import { listingsRouter } from './listings-router';
import { mediaRouter } from './media-router';
import { bookingRouter } from './booking-router';
import { reviewsRouter } from './reviews-router';
import { applyCors } from './router-utils';
import type { XenitionApiModule, XenitionApiOptions, XenitionRouterOptions } from './types';

/**
 * `@xenition/sdk/hono` — prebuilt, mountable Hono routers for generated
 * app BACKENDS.
 *
 * Generated apps deploy as Hono Cloudflare Workers with the
 * `XENITION_API_KEY` (service) / `XENITION_API_URL` secrets injected by
 * the pipeline. These routers run INSIDE that worker, so the React/Expo
 * frontend talks to ITS OWN backend and never holds a platform key — and
 * because the platform bans anon-key writes, these are the sanctioned
 * write path for forms/reviews.
 *
 *   import { Hono } from 'hono';
 *   import { createXenitionApi } from '@xenition/sdk/hono';
 *
 *   const app = new Hono();
 *   app.route('/api', createXenitionApi());
 *   export default app;
 *
 * Every response row is normalized to camelCase regardless of which
 * platform runtime served it (gateway camelCases, engine returns
 * snake_case verbatim) — frontends see ONE stable shape.
 *
 * This subpath imports `hono` at runtime; `hono` is an optional peer
 * dependency, so the SDK core stays hono-free and this module only loads
 * when explicitly imported.
 */
export function createXenitionApi(options: XenitionApiOptions = {}): Hono {
  const { modules, ...routerOptions } = options;
  const selected: XenitionApiModule[] = modules ?? ['cms', 'forms', 'reviews', 'listings', 'events', 'media', 'booking'];
  const app = new Hono();
  // CORS lives on the parent so preflights are answered even for
  // unmatched paths; children skip it to avoid double middleware.
  applyCors(app, routerOptions.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  const childOptions: XenitionRouterOptions = { ...routerOptions, cors: false };
  if (selected.includes('cms')) app.route('/cms', cmsRouter(childOptions));
  if (selected.includes('forms')) app.route('/forms', formsRouter(childOptions));
  if (selected.includes('reviews')) app.route('/reviews', reviewsRouter(childOptions));
  if (selected.includes('listings')) app.route('/listings', listingsRouter(childOptions));
  if (selected.includes('events')) app.route('/', eventsRouter(childOptions));
  if (selected.includes('media')) app.route('/', mediaRouter(childOptions));
  if (selected.includes('booking')) app.route('/', bookingRouter(childOptions));
  return app;
}

export { cmsRouter } from './cms-router';
export { formsRouter } from './forms-router';
export { reviewsRouter } from './reviews-router';
export { listingsRouter } from './listings-router';
export { eventsRouter } from './events-router';
export { mediaRouter } from './media-router';
export { bookingRouter } from './booking-router';
export { camelizeKey, normalizeRow, normalizeRows } from './normalize';
export { createClientFromEnv, XenitionApiConfigError } from './client';
export type { XenitionEnvVars } from './client';
export type { XenitionApiModule, XenitionApiOptions, XenitionRouterOptions } from './types';
