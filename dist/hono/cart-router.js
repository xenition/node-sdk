"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cartRouter = cartRouter;
const hono_1 = require("hono");
const client_1 = require("./client");
const errors_1 = require("./errors");
const rate_limit_1 = require("./rate-limit");
const router_utils_1 = require("./router-utils");
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
function cartRouter(options = {}) {
    const resolve = (0, client_1.makeClientResolver)('cart', options.client);
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    // Meter every write route (POST/PATCH/DELETE); the GET stays unmetered.
    if (options.rateLimit !== false) {
        const limit = (0, rate_limit_1.rateLimiter)(options.rateLimit ?? 10);
        app.post('/cart', limit);
        app.post('/cart/:token/items', limit);
        app.patch('/cart/:token/items/:itemId', limit);
        app.delete('/cart/:token/items/:itemId', limit);
    }
    app.post('/cart', async (c) => {
        const cart = resolve(c).modules.cart;
        // Mint the opaque token server-side and persist an empty cart so a
        // subsequent GET resolves immediately.
        const record = await cart.getOrCreate(generateToken());
        return c.json({ token: record.token }, 201);
    });
    app.get('/cart/:token', async (c) => {
        const cart = resolve(c).modules.cart;
        const view = await cart.getCart(c.req.param('token'));
        return c.json(view);
    });
    app.post('/cart/:token/items', async (c) => {
        const cart = resolve(c).modules.cart;
        const body = await readObjectBody(c);
        if (!body) {
            return (0, errors_1.badRequest)(c, 'Request body must be a JSON object {variantId, quantity}.');
        }
        const token = c.req.param('token');
        await cart.addItem(token, body.variantId, body.quantity);
        return c.json(await cart.getCart(token));
    });
    app.patch('/cart/:token/items/:itemId', async (c) => {
        const cart = resolve(c).modules.cart;
        const body = await readObjectBody(c);
        if (!body)
            return (0, errors_1.badRequest)(c, 'Request body must be a JSON object {quantity}.');
        const token = c.req.param('token');
        await cart.updateItem(token, c.req.param('itemId'), body.quantity);
        return c.json(await cart.getCart(token));
    });
    app.delete('/cart/:token/items/:itemId', async (c) => {
        const cart = resolve(c).modules.cart;
        const token = c.req.param('token');
        await cart.removeItem(token, c.req.param('itemId'));
        return c.json(await cart.getCart(token));
    });
    return app;
}
/** A JSON object body, or undefined for anything else (array/scalar/invalid). */
async function readObjectBody(c) {
    const body = await c.req.json().catch(() => undefined);
    if (typeof body !== 'object' || body === null || Array.isArray(body))
        return undefined;
    return body;
}
/** An opaque, unguessable cart token (UUID v4). */
function generateToken() {
    const webCrypto = globalThis.crypto;
    if (webCrypto?.randomUUID)
        return webCrypto.randomUUID();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('crypto').randomUUID();
}
//# sourceMappingURL=cart-router.js.map