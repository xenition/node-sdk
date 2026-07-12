import { Hono } from 'hono';
import type { XenitionRouterOptions } from './types';
/**
 * Read-only public catalog routes — thin passthroughs to
 * `client.modules.catalog`, every row normalized to camelCase (see
 * normalize.ts).
 *
 *   GET /catalog/products?collection=&status=published&orderBy=&direction=&limit=&offset=
 *        → { products: [...camelCased] } (no variants)
 *   GET /catalog/products/:slug
 *        → the product (camelCased) + its `variants`; 404 when unknown or
 *          not published.
 *   GET /catalog/collections
 *        → { collections: [...camelCased] }
 *   GET /catalog/collections/:slug/products
 *        → { collection, products: [...] }; 404 when the collection is
 *          unknown.
 *
 * The router holds the SERVICE key, so single-product reads 404 drafts and
 * the list defaults to published-only (`?status=all` opts out — reads are
 * anon-visible anyway, so this is a sane default, not a security boundary).
 * All money fields are integer minor units (cents).
 */
export declare function catalogRouter(options?: XenitionRouterOptions): Hono;
//# sourceMappingURL=catalog-router.d.ts.map