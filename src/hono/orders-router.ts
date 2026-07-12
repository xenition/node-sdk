import { Hono } from 'hono';
import type { Context } from 'hono';
import { makeClientResolver } from './client';
import { honoErrorHandler, jsonNotFound } from './errors';
import { normalizeRow, normalizeRows } from './normalize';
import { applyCors } from './router-utils';
import type { XenitionRouterOptions } from './types';
import type { OrderWithItems } from '../modules/orders';

/**
 * Order read routes — the confirmation-page surface.
 *
 *   GET /orders/:id
 *        → the order (camelCased) + its `items`; 404 when unknown.
 *   GET /orders/by-number/:number?email=
 *        → the order + items, but ONLY when `?email=` matches the order's
 *          email (case-insensitive); otherwise a 404 (never reveals whether
 *          the number exists).
 *
 * v0 access model: an order's `id` is a UUID, so the `/orders/:id` route
 * treats that unguessable id AS the access token for the confirmation page —
 * there is no per-user auth here. The by-number route is the shareable,
 * human-typable path and is therefore email-gated. All money fields are
 * integer minor units (cents).
 */
export function ordersRouter(options: XenitionRouterOptions = {}): Hono {
  const resolve = makeClientResolver('orders', options.client);
  const app = new Hono();
  applyCors(app, options.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  app.get('/orders/by-number/:number', async (c) => {
    const orders = resolve(c).modules.orders;
    const email = c.req.query('email');
    const order = await orders.getByNumber(c.req.param('number'));
    // Unknown number OR a mismatched/absent email both 404 — the response is
    // identical, so a caller can't probe which order numbers exist.
    if (!order || !email || email.toLowerCase() !== order.email.toLowerCase()) {
      return jsonNotFound(c);
    }
    return c.json(serializeOrder(c, order));
  });

  app.get('/orders/:id', async (c) => {
    const orders = resolve(c).modules.orders;
    const order = await orders.get(c.req.param('id'));
    if (!order) return jsonNotFound(c);
    return c.json(serializeOrder(c, order));
  });

  return app;
}

/** Camelize an order + its items for the wire. */
export function serializeOrder(_c: Context, order: OrderWithItems): Record<string, unknown> {
  const { items, ...rest } = order;
  return { ...normalizeRow(rest), items: normalizeRows(items) };
}
