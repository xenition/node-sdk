"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.XenitionApiConfigError = exports.createClientFromEnv = exports.normalizeRows = exports.normalizeRow = exports.camelizeKey = exports.openApiRouter = exports.buildOpenApi = exports.verifyStripeSignature = exports.checkoutRouter = exports.ordersRouter = exports.cartRouter = exports.inventoryRouter = exports.catalogRouter = exports.bookingRouter = exports.mediaRouter = exports.eventsRouter = exports.listingsRouter = exports.reviewsRouter = exports.formsRouter = exports.cmsRouter = void 0;
exports.createXenitionApi = createXenitionApi;
const hono_1 = require("hono");
const cms_router_1 = require("./cms-router");
const forms_router_1 = require("./forms-router");
const errors_1 = require("./errors");
const events_router_1 = require("./events-router");
const listings_router_1 = require("./listings-router");
const media_router_1 = require("./media-router");
const booking_router_1 = require("./booking-router");
const catalog_router_1 = require("./catalog-router");
const inventory_router_1 = require("./inventory-router");
const cart_router_1 = require("./cart-router");
const orders_router_1 = require("./orders-router");
const checkout_router_1 = require("./checkout-router");
const reviews_router_1 = require("./reviews-router");
const router_utils_1 = require("./router-utils");
const docs_1 = require("./docs");
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
function createXenitionApi(options = {}) {
    const { modules, ...routerOptions } = options;
    const selected = modules ?? [
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
    ];
    const app = new hono_1.Hono();
    // CORS lives on the parent so preflights are answered even for
    // unmatched paths; children skip it to avoid double middleware.
    (0, router_utils_1.applyCors)(app, routerOptions.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    const childOptions = { ...routerOptions, cors: false };
    if (selected.includes('cms'))
        app.route('/cms', (0, cms_router_1.cmsRouter)(childOptions));
    if (selected.includes('forms'))
        app.route('/forms', (0, forms_router_1.formsRouter)(childOptions));
    if (selected.includes('reviews'))
        app.route('/reviews', (0, reviews_router_1.reviewsRouter)(childOptions));
    if (selected.includes('listings'))
        app.route('/listings', (0, listings_router_1.listingsRouter)(childOptions));
    if (selected.includes('events'))
        app.route('/', (0, events_router_1.eventsRouter)(childOptions));
    if (selected.includes('media'))
        app.route('/', (0, media_router_1.mediaRouter)(childOptions));
    if (selected.includes('booking'))
        app.route('/', (0, booking_router_1.bookingRouter)(childOptions));
    if (selected.includes('catalog'))
        app.route('/', (0, catalog_router_1.catalogRouter)(childOptions));
    if (selected.includes('inventory'))
        app.route('/', (0, inventory_router_1.inventoryRouter)(childOptions));
    if (selected.includes('cart'))
        app.route('/', (0, cart_router_1.cartRouter)(childOptions));
    if (selected.includes('orders'))
        app.route('/', (0, orders_router_1.ordersRouter)(childOptions));
    if (selected.includes('checkout'))
        app.route('/', (0, checkout_router_1.checkoutRouter)(childOptions));
    // Every generated app exposes its own machine-readable API spec at `<mount>/openapi.json`
    // (built from the SAME module list), so the platform's template/app preview can always show the
    // API without each app hand-writing a route. OpenAPI only, no docs UI — by decision (see docs.ts).
    app.route('/', (0, docs_1.openApiRouter)({ ...childOptions, modules: selected }));
    return app;
}
var cms_router_2 = require("./cms-router");
Object.defineProperty(exports, "cmsRouter", { enumerable: true, get: function () { return cms_router_2.cmsRouter; } });
var forms_router_2 = require("./forms-router");
Object.defineProperty(exports, "formsRouter", { enumerable: true, get: function () { return forms_router_2.formsRouter; } });
var reviews_router_2 = require("./reviews-router");
Object.defineProperty(exports, "reviewsRouter", { enumerable: true, get: function () { return reviews_router_2.reviewsRouter; } });
var listings_router_2 = require("./listings-router");
Object.defineProperty(exports, "listingsRouter", { enumerable: true, get: function () { return listings_router_2.listingsRouter; } });
var events_router_2 = require("./events-router");
Object.defineProperty(exports, "eventsRouter", { enumerable: true, get: function () { return events_router_2.eventsRouter; } });
var media_router_2 = require("./media-router");
Object.defineProperty(exports, "mediaRouter", { enumerable: true, get: function () { return media_router_2.mediaRouter; } });
var booking_router_2 = require("./booking-router");
Object.defineProperty(exports, "bookingRouter", { enumerable: true, get: function () { return booking_router_2.bookingRouter; } });
var catalog_router_2 = require("./catalog-router");
Object.defineProperty(exports, "catalogRouter", { enumerable: true, get: function () { return catalog_router_2.catalogRouter; } });
var inventory_router_2 = require("./inventory-router");
Object.defineProperty(exports, "inventoryRouter", { enumerable: true, get: function () { return inventory_router_2.inventoryRouter; } });
var cart_router_2 = require("./cart-router");
Object.defineProperty(exports, "cartRouter", { enumerable: true, get: function () { return cart_router_2.cartRouter; } });
var orders_router_2 = require("./orders-router");
Object.defineProperty(exports, "ordersRouter", { enumerable: true, get: function () { return orders_router_2.ordersRouter; } });
var checkout_router_2 = require("./checkout-router");
Object.defineProperty(exports, "checkoutRouter", { enumerable: true, get: function () { return checkout_router_2.checkoutRouter; } });
Object.defineProperty(exports, "verifyStripeSignature", { enumerable: true, get: function () { return checkout_router_2.verifyStripeSignature; } });
var docs_2 = require("./docs");
Object.defineProperty(exports, "buildOpenApi", { enumerable: true, get: function () { return docs_2.buildOpenApi; } });
Object.defineProperty(exports, "openApiRouter", { enumerable: true, get: function () { return docs_2.openApiRouter; } });
var normalize_1 = require("./normalize");
Object.defineProperty(exports, "camelizeKey", { enumerable: true, get: function () { return normalize_1.camelizeKey; } });
Object.defineProperty(exports, "normalizeRow", { enumerable: true, get: function () { return normalize_1.normalizeRow; } });
Object.defineProperty(exports, "normalizeRows", { enumerable: true, get: function () { return normalize_1.normalizeRows; } });
var client_1 = require("./client");
Object.defineProperty(exports, "createClientFromEnv", { enumerable: true, get: function () { return client_1.createClientFromEnv; } });
Object.defineProperty(exports, "XenitionApiConfigError", { enumerable: true, get: function () { return client_1.XenitionApiConfigError; } });
//# sourceMappingURL=index.js.map