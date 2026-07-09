"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventoryRouter = inventoryRouter;
const hono_1 = require("hono");
const client_1 = require("./client");
const errors_1 = require("./errors");
const normalize_1 = require("./normalize");
const router_utils_1 = require("./router-utils");
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
function inventoryRouter(options = {}) {
    const resolve = (0, client_1.makeClientResolver)('inventory', options.client);
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    app.get('/inventory/:variantId', async (c) => {
        const inventory = resolve(c).modules.inventory;
        const stock = await inventory.getStock(c.req.param('variantId'));
        return c.json((0, normalize_1.normalizeRow)(stock));
    });
    return app;
}
//# sourceMappingURL=inventory-router.js.map