import { Hono } from 'hono';
import type { Context } from 'hono';
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
export declare function ordersRouter(options?: XenitionRouterOptions): Hono;
/** Camelize an order + its items for the wire. */
export declare function serializeOrder(_c: Context, order: OrderWithItems): Record<string, unknown>;
//# sourceMappingURL=orders-router.d.ts.map