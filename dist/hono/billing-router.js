"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingRouter = billingRouter;
exports.requireEntitlement = requireEntitlement;
const hono_1 = require("hono");
const billing_1 = require("../modules/billing");
const auth_1 = require("./auth");
const client_1 = require("./client");
const errors_1 = require("./errors");
const normalize_1 = require("./normalize");
const rate_limit_1 = require("./rate-limit");
const router_utils_1 = require("./router-utils");
function billingRouter(options = {}) {
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    const resolveClient = (0, client_1.makeClientResolver)('billing', options.client);
    const billingOf = (c) => resolveClient(c).modules.billing;
    const auth = (0, auth_1.requireAuth)({ client: options.client });
    /* ── catalog (public — a paywall is shown before sign-in) ────────────── */
    app.get('/billing/products', async (c) => {
        const platform = c.req.query('platform');
        if (platform && platform !== 'apple' && platform !== 'google' && platform !== 'stripe') {
            return (0, errors_1.badRequest)(c, '"platform" must be one of apple, google, stripe');
        }
        const products = await billingOf(c).listProducts({
            platform: platform,
        });
        return c.json({ products: (0, normalize_1.normalizeRows)(products) });
    });
    /* ── entitlements ────────────────────────────────────────────────────── */
    app.get('/billing/entitlements', auth, async (c) => {
        const entitlements = await billingOf(c).listEntitlements((0, auth_1.requireUser)(c).id);
        return c.json({ entitlements });
    });
    app.get('/billing/entitlements/:key', auth, async (c) => {
        const check = await billingOf(c).check((0, auth_1.requireUser)(c).id, c.req.param('key'));
        return c.json(check);
    });
    /* ── verification ────────────────────────────────────────────────────── */
    // Rate limited like the other write routes: verification costs an upstream
    // round trip to Apple or Google, so it is the most expensive thing here to
    // have hammered.
    if (options.rateLimit !== false) {
        app.post('/billing/verify', (0, rate_limit_1.rateLimiter)(options.rateLimit ?? 10));
        app.post('/billing/restore', (0, rate_limit_1.rateLimiter)(options.rateLimit ?? 10));
    }
    app.post('/billing/verify', auth, async (c) => {
        const body = await readObjectBody(c);
        if (!body)
            return (0, errors_1.badRequest)(c, 'Body must be a JSON object.');
        const userId = (0, auth_1.requireUser)(c).id;
        const billing = billingOf(c);
        const platform = body.platform;
        if (platform === 'apple') {
            const transactionId = stringField(body, 'transactionId');
            if (!transactionId)
                return (0, errors_1.badRequest)(c, '"transactionId" is required for apple.');
            const apple = appleFrom(c, options);
            const purchase = await billing.recordPurchase(await apple.verify({ userId, transactionId }));
            return c.json(await verifyResponse(billing, userId, purchase.product_id, 'apple'), 201);
        }
        if (platform === 'google') {
            const productId = stringField(body, 'productId');
            const purchaseToken = stringField(body, 'purchaseToken');
            if (!productId || !purchaseToken) {
                return (0, errors_1.badRequest)(c, '"productId" and "purchaseToken" are required for google.');
            }
            const kind = body.kind === 'product' ? 'product' : 'subscription';
            const google = googleFrom(c, options);
            const verified = await google.verify({ userId, productId, purchaseToken, kind });
            const purchase = await billing.recordPurchase(verified);
            // Play auto-refunds anything unacknowledged after three days, and
            // verifying does not acknowledge. Failing to acknowledge must not fail
            // the request — the purchase IS recorded — but it must not be silent
            // either, so it is reported alongside the entitlement.
            let acknowledged;
            if (billing_1.GoogleStore.needsAcknowledgement(verified.raw ?? {})) {
                try {
                    await google.acknowledge({ productId, purchaseToken, kind });
                    acknowledged = true;
                }
                catch {
                    acknowledged = false;
                }
            }
            const response = await verifyResponse(billing, userId, purchase.product_id, 'google');
            return c.json(acknowledged === undefined ? response : { ...response, acknowledged }, 201);
        }
        return (0, errors_1.badRequest)(c, '"platform" must be "apple" or "google".');
    });
    /* ── restore ─────────────────────────────────────────────────────────── */
    app.post('/billing/restore', auth, async (c) => {
        const body = await readObjectBody(c);
        if (!body)
            return (0, errors_1.badRequest)(c, 'Body must be a JSON object.');
        const userId = (0, auth_1.requireUser)(c).id;
        const billing = billingOf(c);
        if (body.platform === 'apple') {
            const chainId = stringField(body, 'originalTransactionId') ?? stringField(body, 'transactionId');
            if (!chainId) {
                return (0, errors_1.badRequest)(c, '"originalTransactionId" is required for apple.');
            }
            const records = await appleFrom(c, options).restore({
                userId,
                originalTransactionId: chainId,
            });
            for (const record of records)
                await billing.recordPurchase(record);
        }
        else if (body.platform === 'google') {
            const productId = stringField(body, 'productId');
            const purchaseToken = stringField(body, 'purchaseToken');
            if (!productId || !purchaseToken) {
                return (0, errors_1.badRequest)(c, '"productId" and "purchaseToken" are required for google.');
            }
            const verified = await googleFrom(c, options).verify({
                userId,
                productId,
                purchaseToken,
                kind: body.kind === 'product' ? 'product' : 'subscription',
            });
            await billing.recordPurchase(verified);
        }
        else {
            return (0, errors_1.badRequest)(c, '"platform" must be "apple" or "google".');
        }
        return c.json({ entitlements: await billing.listEntitlements(userId) });
    });
    /* ── trial ───────────────────────────────────────────────────────────── */
    const trialDays = options.trialDays;
    app.post('/billing/trial', auth, async (c) => {
        const days = trialDays ?? Number((0, client_1.readEnvVar)(c, 'BILLING_TRIAL_DAYS') ?? 0);
        if (!Number.isFinite(days) || days <= 0) {
            return c.json({
                error: {
                    code: 'NOT_CONFIGURED',
                    message: 'Trials are not enabled — set BILLING_TRIAL_DAYS or the trialDays option.',
                },
            }, 501);
        }
        const userId = (0, auth_1.requireUser)(c).id;
        const entitlement = options.trialEntitlement ?? 'premium';
        const billing = billingOf(c);
        // Idempotent from the client's point of view: a second tap returns the
        // current state rather than a 400 the app has to special-case.
        const existing = await billing.check(userId, entitlement);
        if (existing.status !== 'none')
            return c.json(existing);
        await billing.startTrial({ userId, entitlement, days });
        return c.json(await billing.check(userId, entitlement), 201);
    });
    /* ── store notifications ─────────────────────────────────────────────── */
    app.post('/billing/webhooks/apple', async (c) => {
        const body = await readObjectBody(c);
        const signedPayload = body ? stringField(body, 'signedPayload') : undefined;
        if (!signedPayload)
            return (0, errors_1.badRequest)(c, '"signedPayload" is required.');
        const result = await (0, billing_1.handleAppleNotification)({
            billing: billingOf(c),
            apple: appleFrom(c, options),
            signedPayload,
        });
        return c.json(notificationBody(result));
    });
    app.post('/billing/webhooks/google', async (c) => {
        const body = await readObjectBody(c);
        if (!body)
            return (0, errors_1.badRequest)(c, 'Body must be a JSON object.');
        const result = await (0, billing_1.handleGoogleNotification)({
            billing: billingOf(c),
            google: googleFrom(c, options),
            body,
        });
        return c.json(notificationBody(result));
    });
    return app;
}
/**
 * Gate a route on an entitlement — the paywall, as one line per route.
 *
 *   app.use('/coach/*', requireAuth(), requireEntitlement('premium'));
 *
 * Answers 402 Payment Required rather than 403: the caller is perfectly
 * entitled to ask, they just have not paid, and the app should show the
 * paywall instead of an error. The body carries the same `EntitlementCheck`
 * the client gets from `/billing/entitlements/:key`, so one code path in the
 * app can render the paywall from either.
 *
 * Must be mounted AFTER `requireAuth()` — without a caller there is nothing
 * to check, and that is a wiring bug rather than a payment problem.
 */
function requireEntitlement(entitlement, options = {}) {
    if (typeof entitlement !== 'string' || entitlement.trim() === '') {
        throw new Error('requireEntitlement: an entitlement name is required.');
    }
    const resolveClient = (0, client_1.makeClientResolver)('billing', options.client);
    return async (c, next) => {
        const user = (0, auth_1.currentUser)(c);
        if (!user) {
            throw new client_1.XenitionApiConfigError(`requireEntitlement("${entitlement}"): no authenticated user on this request. ` +
                'Mount requireAuth() before it.');
        }
        const check = await resolveClient(c).modules.billing.check(user.id, entitlement);
        if (!check.allowed) {
            return c.json({
                error: {
                    code: 'ENTITLEMENT_REQUIRED',
                    message: options.message ?? `This feature requires "${entitlement}".`,
                },
                entitlement: check,
            }, 402);
        }
        await next();
    };
}
/* ── helpers ───────────────────────────────────────────────────────────── */
/** The entitlement a purchase produced, alongside the purchase itself. */
async function verifyResponse(billing, userId, productId, platform) {
    const product = await billing.findProduct(platform, productId);
    const entitlement = product
        ? await billing.check(userId, product.entitlement)
        : null;
    return {
        ok: true,
        // Null when the product was never declared via `defineProduct` — the
        // purchase is recorded either way, and saying so beats pretending the
        // user was granted something.
        entitlement,
        product: product ? (0, normalize_1.normalizeRow)(product) : null,
    };
}
/**
 * Webhook responses stay minimal on purpose: both stores treat any non-2xx
 * as "retry", and neither reads the body. Echoing purchase details would
 * only leak them to whoever can reach the endpoint.
 */
function notificationBody(result) {
    return {
        received: true,
        handled: result.handled,
        type: result.notificationType,
        ...(result.reason ? { reason: result.reason } : {}),
    };
}
function appleFrom(c, options) {
    if (options.apple)
        return options.apple;
    const keyId = (0, client_1.readEnvVar)(c, 'APPLE_KEY_ID');
    const issuerId = (0, client_1.readEnvVar)(c, 'APPLE_ISSUER_ID');
    const privateKey = (0, client_1.readEnvVar)(c, 'APPLE_PRIVATE_KEY');
    const bundleId = (0, client_1.readEnvVar)(c, 'APPLE_BUNDLE_ID');
    if (!keyId || !issuerId || !privateKey || !bundleId) {
        throw new errors_1.NotConfiguredError('Apple purchases need the APPLE_KEY_ID, APPLE_ISSUER_ID, APPLE_PRIVATE_KEY and ' +
            'APPLE_BUNDLE_ID secrets.');
    }
    const environment = (0, client_1.readEnvVar)(c, 'APPLE_ENVIRONMENT');
    return new billing_1.AppleStore({
        keyId,
        issuerId,
        privateKey,
        bundleId,
        environment: environment === 'production' || environment === 'sandbox' ? environment : 'auto',
    });
}
function googleFrom(c, options) {
    if (options.google)
        return options.google;
    const packageName = (0, client_1.readEnvVar)(c, 'GOOGLE_PACKAGE_NAME');
    const clientEmail = (0, client_1.readEnvVar)(c, 'GOOGLE_CLIENT_EMAIL');
    const privateKey = (0, client_1.readEnvVar)(c, 'GOOGLE_PRIVATE_KEY');
    if (!packageName || !clientEmail || !privateKey) {
        throw new errors_1.NotConfiguredError('Google purchases need the GOOGLE_PACKAGE_NAME, GOOGLE_CLIENT_EMAIL and ' +
            'GOOGLE_PRIVATE_KEY secrets.');
    }
    return new billing_1.GoogleStore({ packageName, clientEmail, privateKey });
}
function stringField(body, key) {
    const value = body[key];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
async function readObjectBody(c) {
    const body = await c.req.json().catch(() => undefined);
    if (typeof body !== 'object' || body === null || Array.isArray(body))
        return undefined;
    return body;
}
//# sourceMappingURL=billing-router.js.map