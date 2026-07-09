"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.XenitionApiConfigError = exports.createClientFromEnv = exports.normalizeRows = exports.normalizeRow = exports.camelizeKey = exports.mediaRouter = exports.eventsRouter = exports.listingsRouter = exports.reviewsRouter = exports.formsRouter = exports.cmsRouter = void 0;
exports.createXenitionApi = createXenitionApi;
const hono_1 = require("hono");
const cms_router_1 = require("./cms-router");
const forms_router_1 = require("./forms-router");
const errors_1 = require("./errors");
const events_router_1 = require("./events-router");
const listings_router_1 = require("./listings-router");
const media_router_1 = require("./media-router");
const reviews_router_1 = require("./reviews-router");
const router_utils_1 = require("./router-utils");
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
    const selected = modules ?? ['cms', 'forms', 'reviews', 'listings', 'events', 'media'];
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
var normalize_1 = require("./normalize");
Object.defineProperty(exports, "camelizeKey", { enumerable: true, get: function () { return normalize_1.camelizeKey; } });
Object.defineProperty(exports, "normalizeRow", { enumerable: true, get: function () { return normalize_1.normalizeRow; } });
Object.defineProperty(exports, "normalizeRows", { enumerable: true, get: function () { return normalize_1.normalizeRows; } });
var client_1 = require("./client");
Object.defineProperty(exports, "createClientFromEnv", { enumerable: true, get: function () { return client_1.createClientFromEnv; } });
Object.defineProperty(exports, "XenitionApiConfigError", { enumerable: true, get: function () { return client_1.XenitionApiConfigError; } });
//# sourceMappingURL=index.js.map