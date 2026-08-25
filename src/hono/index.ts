import { Hono } from 'hono';
import { authRouter } from './auth-router';
import { cmsRouter } from './cms-router';
import { formsRouter } from './forms-router';
import { honoErrorHandler, jsonNotFound } from './errors';
import { eventsRouter } from './events-router';
import { listingsRouter } from './listings-router';
import { mediaRouter } from './media-router';
import { bookingRouter } from './booking-router';
import { catalogRouter } from './catalog-router';
import { inventoryRouter } from './inventory-router';
import { cartRouter } from './cart-router';
import { ordersRouter } from './orders-router';
import { checkoutRouter } from './checkout-router';
import { billingRouter } from './billing-router';
import { jobsRouter } from './jobs-router';
import { notificationsRouter } from './notifications-router';
import { quotasRouter } from './quotas-router';
import { reviewsRouter } from './reviews-router';
import { applyCors } from './router-utils';
import { openApiRouter } from './docs';
import { buildCustomRouter } from './define-router';
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
  // `quotas` and `notificationCategories` are pulled out rather than spread
  // into every child: they are one router's configuration each, and the
  // quota limits in particular must reach the quotas router unchanged —
  // that map is the paywall.
  const { modules, custom, quotas, notificationCategories, ...routerOptions } = options;
  const selected: XenitionApiModule[] = modules ?? [
    'auth',
    'cms',
    'forms',
    'reviews',
    'listings',
    'events',
    'media',
    'booking',
    'catalog',
    'inventory',
    'cart',
    'orders',
    'checkout',
    'billing',
    'jobs',
    'notifications',
    'quotas',
  ];
  const app = new Hono();
  // CORS lives on the parent so preflights are answered even for
  // unmatched paths; children skip it to avoid double middleware.
  applyCors(app, routerOptions.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  const childOptions: XenitionRouterOptions = { ...routerOptions, cors: false };
  if (selected.includes('auth')) app.route('/', authRouter(childOptions));
  if (selected.includes('cms')) app.route('/cms', cmsRouter(childOptions));
  if (selected.includes('forms')) app.route('/forms', formsRouter(childOptions));
  if (selected.includes('reviews')) app.route('/reviews', reviewsRouter(childOptions));
  if (selected.includes('listings')) app.route('/listings', listingsRouter(childOptions));
  if (selected.includes('events')) app.route('/', eventsRouter(childOptions));
  if (selected.includes('media')) app.route('/', mediaRouter(childOptions));
  if (selected.includes('booking')) app.route('/', bookingRouter(childOptions));
  if (selected.includes('catalog')) app.route('/', catalogRouter(childOptions));
  if (selected.includes('inventory')) app.route('/', inventoryRouter(childOptions));
  if (selected.includes('cart')) app.route('/', cartRouter(childOptions));
  if (selected.includes('orders')) app.route('/', ordersRouter(childOptions));
  if (selected.includes('checkout')) app.route('/', checkoutRouter(childOptions));
  if (selected.includes('billing')) app.route('/', billingRouter(childOptions));
  if (selected.includes('jobs')) app.route('/', jobsRouter(childOptions));
  if (selected.includes('notifications')) {
    app.route('/', notificationsRouter({ ...childOptions, categories: notificationCategories }));
  }
  if (selected.includes('quotas')) app.route('/', quotasRouter({ ...childOptions, quotas }));
  // The app's own routers, mounted on the SAME parent as the built-ins so
  // they inherit the error handler, CORS and JSON 404 above.
  for (const definition of custom ?? []) {
    app.route('/', buildCustomRouter(definition, childOptions));
  }

  // Every generated app exposes its own machine-readable API spec at `<mount>/openapi.json`
  // (built from the SAME module list), so the platform's template/app preview can always show the
  // API without each app hand-writing a route. OpenAPI only, no docs UI — by decision (see docs.ts).
  app.route('/', openApiRouter({ ...childOptions, modules: selected, custom }));
  return app;
}

export { authRouter } from './auth-router';
export type { AuthRouterOptions } from './auth-router';
export { cmsRouter } from './cms-router';
export { formsRouter } from './forms-router';
export { reviewsRouter } from './reviews-router';
export { listingsRouter } from './listings-router';
export { eventsRouter } from './events-router';
export { mediaRouter } from './media-router';
export { bookingRouter } from './booking-router';
export { catalogRouter } from './catalog-router';
export { inventoryRouter } from './inventory-router';
export { cartRouter } from './cart-router';
export { ordersRouter } from './orders-router';
export { checkoutRouter, verifyStripeSignature } from './checkout-router';
export { billingRouter, requireEntitlement } from './billing-router';
export { jobsRouter } from './jobs-router';
export type { JobsRouterOptions } from './jobs-router';
export { notificationsRouter } from './notifications-router';
export type { NotificationsRouterOptions } from './notifications-router';
export { quotasRouter } from './quotas-router';
export type { QuotaDefinition, QuotasRouterOptions } from './quotas-router';
export { createScheduledHandler, withScheduled } from './scheduled';
export type {
  CronJob,
  ExecutionContextLike,
  ScheduledContext,
  ScheduledEvent,
  ScheduledHandler,
  ScheduledOptions,
  ScheduledSummary,
} from './scheduled';
export type { BillingRouterOptions, RequireEntitlementOptions } from './billing-router';
export { buildOpenApi, openApiRouter } from './docs';
export { defineRouter, buildCustomRouter } from './define-router';
export type { RouterDefinition, RouterToolkit } from './define-router';
export type { DocsOptions, OpenApiRouterOptions } from './docs';
export {
  xenitionAuth,
  requireAuth,
  currentUser,
  currentUserId,
  requireUser,
  bearerToken,
} from './auth';
export type { AuthUser, XenitionAuthOptions } from './auth';
export {
  badRequest,
  forbidden,
  unauthorized,
  honoErrorHandler,
  jsonNotFound,
  NotConfiguredError,
  paymentRequired,
  paymentRequiredBody,
} from './errors';
export type {
  PaymentRequiredBody,
  PaymentRequiredOptions,
  PaymentRequiredQuota,
} from './errors';
export { camelizeKey, normalizeRow, normalizeRows } from './normalize';
export { createClientFromEnv, readEnvVar, XenitionApiConfigError } from './client';
export type { XenitionEnvVars } from './client';
export type { XenitionApiModule, XenitionApiOptions, XenitionRouterOptions } from './types';
