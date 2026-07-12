import { Hono } from 'hono';
import type { Context } from 'hono';
import { makeClientResolver } from './client';
import { badRequest, honoErrorHandler, jsonNotFound } from './errors';
import { normalizeRow, normalizeRows } from './normalize';
import {
  QueryParamError,
  applyCors,
  parseDirection,
  parseNonNegativeInt,
} from './router-utils';
import type { XenitionRouterOptions } from './types';
import type { ListProductsOptions, ProductStatus } from '../modules/catalog';

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
export function catalogRouter(options: XenitionRouterOptions = {}): Hono {
  const resolve = makeClientResolver('catalog', options.client);
  const app = new Hono();
  applyCors(app, options.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  const parseListOptions = (c: Context): ListProductsOptions => {
    const statusQ = c.req.query('status');
    return {
      collection: c.req.query('collection') || undefined,
      status: (statusQ === 'all' ? 'all' : statusQ || undefined) as ProductStatus | 'all' | undefined,
      orderBy: c.req.query('orderBy') || undefined,
      direction: parseDirection(c.req.query('direction')),
      limit: parseNonNegativeInt('limit', c.req.query('limit')),
      offset: parseNonNegativeInt('offset', c.req.query('offset')),
    };
  };

  app.get('/catalog/products', async (c) => {
    const catalog = resolve(c).modules.catalog;
    let listOptions: ListProductsOptions;
    try {
      listOptions = parseListOptions(c);
    } catch (err) {
      if (err instanceof QueryParamError) return badRequest(c, err.message);
      throw err;
    }
    const products = await catalog.listProducts(listOptions);
    return c.json({ products: normalizeRows(products) });
  });

  app.get('/catalog/products/:slug', async (c) => {
    const catalog = resolve(c).modules.catalog;
    const product = await catalog.getProduct(c.req.param('slug'));
    if (!product) return jsonNotFound(c);
    const { variants, ...rest } = product;
    return c.json({ ...normalizeRow(rest), variants: normalizeRows(variants) });
  });

  app.get('/catalog/collections', async (c) => {
    const catalog = resolve(c).modules.catalog;
    const collections = await catalog.listCollections();
    return c.json({ collections: normalizeRows(collections) });
  });

  app.get('/catalog/collections/:slug/products', async (c) => {
    const catalog = resolve(c).modules.catalog;
    const slug = c.req.param('slug');
    const collection = await catalog.getCollection(slug);
    if (!collection) return jsonNotFound(c);
    let listOptions: ListProductsOptions;
    try {
      listOptions = { ...parseListOptions(c), collection: slug };
    } catch (err) {
      if (err instanceof QueryParamError) return badRequest(c, err.message);
      throw err;
    }
    const products = await catalog.listProducts(listOptions);
    return c.json({ collection: normalizeRow(collection), products: normalizeRows(products) });
  });

  return app;
}
