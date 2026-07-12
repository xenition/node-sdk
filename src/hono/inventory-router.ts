import { Hono } from 'hono';
import { makeClientResolver } from './client';
import { honoErrorHandler, jsonNotFound } from './errors';
import { normalizeRow } from './normalize';
import { applyCors } from './router-utils';
import type { XenitionRouterOptions } from './types';

/**
 * Read-only public inventory route — a single storefront "in stock?" lookup
 * that returns a variant's derived availability, normalized to camelCase.
 *
 *   GET /inventory/:variantId
 *        → { variantId, quantity, reserved, available, policy }
 *
 * A variant with no stock row reads as all-zero / policy 'deny' (out of
 * stock), never a 404 — the count is always total. Writes (setStock,
 * reserve, commit, …) are service-key only and have no public route; they
 * run from the app's own backend worker.
 */
export function inventoryRouter(options: XenitionRouterOptions = {}): Hono {
  const resolve = makeClientResolver('inventory', options.client);
  const app = new Hono();
  applyCors(app, options.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  app.get('/inventory/:variantId', async (c) => {
    const inventory = resolve(c).modules.inventory;
    const stock = await inventory.getStock(c.req.param('variantId'));
    return c.json(normalizeRow(stock));
  });

  return app;
}
