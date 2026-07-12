"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkoutRouter = checkoutRouter;
exports.verifyStripeSignature = verifyStripeSignature;
const hono_1 = require("hono");
const client_1 = require("./client");
const errors_1 = require("./errors");
const normalize_1 = require("./normalize");
const rate_limit_1 = require("./rate-limit");
const router_utils_1 = require("./router-utils");
/**
 * Checkout router — Worker-native payments with a SAFE default and a real
 * Stripe path. No `stripe` npm package: the Stripe API is called with raw
 * `fetch` and webhooks are verified with Web Crypto (`crypto.subtle`), so
 * this router runs unchanged on Cloudflare Workers and Node 20+.
 *
 * Worker env (read from the Hono context env with a `process.env` fallback):
 *   - COMMERCE_MODE       'mock' (default) | 'stripe'
 *   - STRIPE_SECRET_KEY   required in stripe mode
 *   - STRIPE_WEBHOOK_SECRET  required to verify webhooks
 *   - APP_URL             public site origin, for redirect URLs
 *
 * Routes:
 *   POST /checkout/:cartToken {email, successPath?, cancelPath?}
 *        → createFromCart (pending), then:
 *          mock   → { orderId, mode:'mock', payUrl:'<APP_URL>/checkout/pay?order=<id>' }
 *          stripe → { orderId, mode:'stripe', payUrl: session.url }
 *   POST /checkout/mock/complete {orderId}   (mock ONLY; 403 in stripe mode)
 *        → simulates the webhook: markPaid(provider:'mock') → the paid order.
 *   POST /checkout/webhook                   (stripe mode)
 *        → verifies the Stripe signature, then on `checkout.session.completed`
 *          markPaid(provider:'stripe'). Idempotent.
 *   GET  /checkout/order/:id                 → the order + items (or 404).
 *
 * MOCK MODE IS THE DEFAULT and needs no Stripe key — zero charge risk. Errors
 * are generic and never leak keys.
 */
function checkoutRouter(options = {}) {
    const resolve = (0, client_1.makeClientResolver)('orders', options.client);
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    // ── static routes registered BEFORE the '/checkout/:cartToken' param route
    // so 'webhook' etc. can never be captured as a cart token. ──
    app.post('/checkout/webhook', async (c) => {
        if (commerceMode(c) !== 'stripe')
            return forbidden(c, 'Webhooks are only handled in stripe mode.');
        const secret = (0, client_1.readEnvVar)(c, 'STRIPE_WEBHOOK_SECRET');
        if (!secret) {
            throw new client_1.XenitionApiConfigError('Stripe webhooks require the STRIPE_WEBHOOK_SECRET secret.');
        }
        const raw = await c.req.text();
        const signature = c.req.header('stripe-signature');
        const ok = await verifyStripeSignature(raw, signature, secret);
        if (!ok) {
            return c.json({ error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed.' } }, 400);
        }
        let event;
        try {
            event = JSON.parse(raw);
        }
        catch {
            return (0, errors_1.badRequest)(c, 'Webhook body is not valid JSON.');
        }
        if (event?.type === 'checkout.session.completed') {
            const session = (event.data?.object ?? {});
            const orderId = session.client_reference_id || session.metadata?.orderId;
            if (orderId) {
                const orders = resolve(c).modules.orders;
                await orders.markPaid(orderId, {
                    provider: 'stripe',
                    ref: session.payment_intent || `stripe_${orderId}`,
                });
            }
        }
        return c.json({ received: true });
    });
    if (options.rateLimit !== false) {
        app.post('/checkout/mock/complete', (0, rate_limit_1.rateLimiter)(options.rateLimit ?? 10));
    }
    app.post('/checkout/mock/complete', async (c) => {
        if (commerceMode(c) === 'stripe') {
            return forbidden(c, 'Mock completion is disabled when COMMERCE_MODE=stripe.');
        }
        const body = await readObjectBody(c);
        if (!body || typeof body.orderId !== 'string' || body.orderId === '') {
            return (0, errors_1.badRequest)(c, 'Request body must be a JSON object {orderId}.');
        }
        const orders = resolve(c).modules.orders;
        const order = await orders.markPaid(body.orderId, { provider: 'mock', ref: `mock_${body.orderId}` });
        return c.json(serializeOrder(order));
    });
    app.get('/checkout/order/:id', async (c) => {
        const orders = resolve(c).modules.orders;
        const order = await orders.get(c.req.param('id'));
        if (!order)
            return (0, errors_1.jsonNotFound)(c);
        return c.json(serializeOrder(order));
    });
    if (options.rateLimit !== false) {
        app.post('/checkout/:cartToken', (0, rate_limit_1.rateLimiter)(options.rateLimit ?? 10));
    }
    app.post('/checkout/:cartToken', async (c) => {
        const orders = resolve(c).modules.orders;
        const body = await readObjectBody(c);
        if (!body) {
            return (0, errors_1.badRequest)(c, 'Request body must be a JSON object {email, successPath?, cancelPath?}.');
        }
        // createFromCart validates the email + cart; a bad/empty/unknown cart
        // surfaces through the shared error handler (400/404).
        const order = await orders.createFromCart(c.req.param('cartToken'), { email: body.email });
        if (commerceMode(c) === 'stripe') {
            const payUrl = await createStripeSession(c, order, body);
            return c.json({ orderId: order.id, mode: 'stripe', payUrl });
        }
        // mock mode (default) — no Stripe key, no charge. The template renders a
        // mock pay page at this URL; POST /checkout/mock/complete finishes it.
        const appUrl = (0, client_1.readEnvVar)(c, 'APP_URL') ?? '';
        return c.json({ orderId: order.id, mode: 'mock', payUrl: `${appUrl}/checkout/pay?order=${order.id}` });
    });
    return app;
}
// ───────── Stripe (raw fetch — no npm package) ─────────
/**
 * Create a Stripe Checkout Session via a raw form-encoded POST to
 * `https://api.stripe.com/v1/checkout/sessions`. Returns the hosted-page URL.
 * Never leaks the key or the raw Stripe error to the caller.
 */
async function createStripeSession(c, order, body) {
    const key = (0, client_1.readEnvVar)(c, 'STRIPE_SECRET_KEY');
    if (!key) {
        throw new client_1.XenitionApiConfigError('COMMERCE_MODE=stripe requires the STRIPE_SECRET_KEY secret.');
    }
    const appUrl = (0, client_1.readEnvVar)(c, 'APP_URL') ?? '';
    const successPath = typeof body.successPath === 'string' ? body.successPath : '/checkout/success';
    const cancelPath = typeof body.cancelPath === 'string' ? body.cancelPath : '/checkout/cancel';
    const currency = (order.currency || 'USD').toLowerCase();
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', `${appUrl}${successPath}?order=${order.id}`);
    params.set('cancel_url', `${appUrl}${cancelPath}?order=${order.id}`);
    params.set('client_reference_id', order.id);
    params.set('metadata[orderId]', order.id);
    order.items.forEach((item, i) => {
        params.set(`line_items[${i}][quantity]`, String(item.quantity));
        params.set(`line_items[${i}][price_data][currency]`, currency);
        params.set(`line_items[${i}][price_data][unit_amount]`, String(item.unit_price_cents));
        params.set(`line_items[${i}][price_data][product_data][name]`, item.title || item.variant_title || 'Item');
    });
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
    });
    if (!res.ok)
        throw new Error('Stripe checkout session creation failed.');
    const session = (await res.json());
    if (!session.url)
        throw new Error('Stripe checkout session returned no URL.');
    return session.url;
}
/**
 * Verify a Stripe webhook signature per Stripe's scheme:
 * `signed_payload = "<t>.<rawBody>"`, `v1 = HMAC_SHA256(secret,
 * signed_payload)` (hex). The `stripe-signature` header is
 * `t=<ts>,v1=<sig>[,v1=<sig2>…]`. Uses Web Crypto only (Worker + Node 20).
 */
async function verifyStripeSignature(payload, header, secret) {
    if (!header)
        return false;
    let timestamp = '';
    const signatures = [];
    for (const part of header.split(',')) {
        const eq = part.indexOf('=');
        if (eq === -1)
            continue;
        const k = part.slice(0, eq).trim();
        const v = part.slice(eq + 1).trim();
        if (k === 't')
            timestamp = v;
        else if (k === 'v1' && v)
            signatures.push(v);
    }
    if (!timestamp || signatures.length === 0)
        return false;
    const expected = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
    return signatures.some((sig) => timingSafeEqual(sig, expected));
}
async function hmacSha256Hex(secret, message) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** Constant-time string compare (length-independent short-circuit only). */
function timingSafeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let result = 0;
    for (let i = 0; i < a.length; i += 1)
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return result === 0;
}
// ───────── shared helpers ─────────
/** 'stripe' when COMMERCE_MODE=stripe, else 'mock' (the safe default). */
function commerceMode(c) {
    return ((0, client_1.readEnvVar)(c, 'COMMERCE_MODE') ?? '').toLowerCase() === 'stripe' ? 'stripe' : 'mock';
}
function forbidden(c, message) {
    return c.json({ error: { code: 'FORBIDDEN', message } }, 403);
}
/** A JSON object body, or undefined for anything else. */
async function readObjectBody(c) {
    const body = await c.req.json().catch(() => undefined);
    if (typeof body !== 'object' || body === null || Array.isArray(body))
        return undefined;
    return body;
}
/** Camelize an order + its items for the wire. */
function serializeOrder(order) {
    const { items, ...rest } = order;
    return { ...(0, normalize_1.normalizeRow)(rest), items: (0, normalize_1.normalizeRows)(items) };
}
//# sourceMappingURL=checkout-router.js.map