import { Hono } from 'hono';
import type { XenitionRouterOptions } from './types';
/**
 * Cart routes — the sanctioned public write path for a shopping cart (anon-key
 * writes are banned platform-wide, so the app's own service-key worker owns
 * the cart). A cart is addressed by an opaque, client-generated `token`; that
 * token is the only capability, so it must be kept private by the storefront.
 *
 *   POST   /cart                          → 201 { token }  (mints + persists)
 *   GET    /cart/:token                   → { token, currency, items, subtotalCents }
 *   POST   /cart/:token/items  {variantId, quantity}  → the updated cart view
 *   PATCH  /cart/:token/items/:itemId {quantity}       → the updated cart view
 *   DELETE /cart/:token/items/:itemId                  → the updated cart view
 *
 * Every response is camelCase (the SDK's cart view is already camelCased).
 * All money is integer minor units (cents). The write routes are rate limited
 * per IP; GET is unmetered.
 */
export declare function cartRouter(options?: XenitionRouterOptions): Hono;
//# sourceMappingURL=cart-router.d.ts.map