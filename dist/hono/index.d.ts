import { Hono } from 'hono';
import type { XenitionApiOptions } from './types';
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
export declare function createXenitionApi(options?: XenitionApiOptions): Hono;
export { cmsRouter } from './cms-router';
export { formsRouter } from './forms-router';
export { reviewsRouter } from './reviews-router';
export { listingsRouter } from './listings-router';
export { eventsRouter } from './events-router';
export { mediaRouter } from './media-router';
export { camelizeKey, normalizeRow, normalizeRows } from './normalize';
export { createClientFromEnv, XenitionApiConfigError } from './client';
export type { XenitionEnvVars } from './client';
export type { XenitionApiModule, XenitionApiOptions, XenitionRouterOptions } from './types';
//# sourceMappingURL=index.d.ts.map