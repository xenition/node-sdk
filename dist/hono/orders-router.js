"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ordersRouter = ordersRouter;
exports.serializeOrder = serializeOrder;
const hono_1 = require("hono");
const client_1 = require("./client");
const errors_1 = require("./errors");
const normalize_1 = require("./normalize");
const router_utils_1 = require("./router-utils");
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
function ordersRouter(options = {}) {
    const resolve = (0, client_1.makeClientResolver)('orders', options.client);
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    app.get('/orders/by-number/:number', async (c) => {
        const orders = resolve(c).modules.orders;
        const email = c.req.query('email');
        const order = await orders.getByNumber(c.req.param('number'));
        // Unknown number OR a mismatched/absent email both 404 — the response is
        // identical, so a caller can't probe which order numbers exist.
        if (!order || !email || email.toLowerCase() !== order.email.toLowerCase()) {
            return (0, errors_1.jsonNotFound)(c);
        }
        return c.json(serializeOrder(c, order));
    });
    app.get('/orders/:id', async (c) => {
        const orders = resolve(c).modules.orders;
        const order = await orders.get(c.req.param('id'));
        if (!order)
            return (0, errors_1.jsonNotFound)(c);
        return c.json(serializeOrder(c, order));
    });
    return app;
}
/** Camelize an order + its items for the wire. */
function serializeOrder(_c, order) {
    const { items, ...rest } = order;
    return { ...(0, normalize_1.normalizeRow)(rest), items: (0, normalize_1.normalizeRows)(items) };
}
//# sourceMappingURL=orders-router.js.map