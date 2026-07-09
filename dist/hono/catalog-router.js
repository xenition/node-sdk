"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.catalogRouter = catalogRouter;
const hono_1 = require("hono");
const client_1 = require("./client");
const errors_1 = require("./errors");
const normalize_1 = require("./normalize");
const router_utils_1 = require("./router-utils");
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
function catalogRouter(options = {}) {
    const resolve = (0, client_1.makeClientResolver)('catalog', options.client);
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    const parseListOptions = (c) => {
        const statusQ = c.req.query('status');
        return {
            collection: c.req.query('collection') || undefined,
            status: (statusQ === 'all' ? 'all' : statusQ || undefined),
            orderBy: c.req.query('orderBy') || undefined,
            direction: (0, router_utils_1.parseDirection)(c.req.query('direction')),
            limit: (0, router_utils_1.parseNonNegativeInt)('limit', c.req.query('limit')),
            offset: (0, router_utils_1.parseNonNegativeInt)('offset', c.req.query('offset')),
        };
    };
    app.get('/catalog/products', async (c) => {
        const catalog = resolve(c).modules.catalog;
        let listOptions;
        try {
            listOptions = parseListOptions(c);
        }
        catch (err) {
            if (err instanceof router_utils_1.QueryParamError)
                return (0, errors_1.badRequest)(c, err.message);
            throw err;
        }
        const products = await catalog.listProducts(listOptions);
        return c.json({ products: (0, normalize_1.normalizeRows)(products) });
    });
    app.get('/catalog/products/:slug', async (c) => {
        const catalog = resolve(c).modules.catalog;
        const product = await catalog.getProduct(c.req.param('slug'));
        if (!product)
            return (0, errors_1.jsonNotFound)(c);
        const { variants, ...rest } = product;
        return c.json({ ...(0, normalize_1.normalizeRow)(rest), variants: (0, normalize_1.normalizeRows)(variants) });
    });
    app.get('/catalog/collections', async (c) => {
        const catalog = resolve(c).modules.catalog;
        const collections = await catalog.listCollections();
        return c.json({ collections: (0, normalize_1.normalizeRows)(collections) });
    });
    app.get('/catalog/collections/:slug/products', async (c) => {
        const catalog = resolve(c).modules.catalog;
        const slug = c.req.param('slug');
        const collection = await catalog.getCollection(slug);
        if (!collection)
            return (0, errors_1.jsonNotFound)(c);
        let listOptions;
        try {
            listOptions = { ...parseListOptions(c), collection: slug };
        }
        catch (err) {
            if (err instanceof router_utils_1.QueryParamError)
                return (0, errors_1.badRequest)(c, err.message);
            throw err;
        }
        const products = await catalog.listProducts(listOptions);
        return c.json({ collection: (0, normalize_1.normalizeRow)(collection), products: (0, normalize_1.normalizeRows)(products) });
    });
    return app;
}
//# sourceMappingURL=catalog-router.js.map