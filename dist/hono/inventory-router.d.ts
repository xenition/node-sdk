import { Hono } from 'hono';
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
export declare function inventoryRouter(options?: XenitionRouterOptions): Hono;
//# sourceMappingURL=inventory-router.d.ts.map