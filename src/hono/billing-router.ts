import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { XenitionClient } from '../xenition-client';
import {
  AppleStore,
  BillingClient,
  GoogleStore,
  handleAppleNotification,
  handleGoogleNotification,
} from '../modules/billing';
import type { EntitlementCheck } from '../modules/billing';
import { currentUser, requireAuth, requireUser } from './auth';
import { makeClientResolver, readEnvVar, XenitionApiConfigError } from './client';
import { badRequest, honoErrorHandler, jsonNotFound, NotConfiguredError } from './errors';
import { normalizeRow, normalizeRows } from './normalize';
import { rateLimiter } from './rate-limit';
import { applyCors } from './router-utils';
import type { XenitionRouterOptions } from './types';

/**
 * `/billing` — in-app purchases over HTTP, for the mobile client.
 *
 * The flow this router exists to serve:
 *
 *   1. The app shows a paywall built from `GET /billing/products`.
 *   2. StoreKit / Play Billing completes the purchase ON THE DEVICE and
 *      hands the app a transaction id (iOS) or purchase token (Android).
 *   3. The app POSTs it to `/billing/verify` with its access token.
 *   4. This router asks Apple or Google whether that is real, records it,
 *      and answers with the resulting entitlement.
 *   5. Everything afterwards — renewal, cancellation, refund — arrives on
 *      the webhook routes without the app being involved at all.
 *
 * Every purchase route is behind `requireAuth()`: a purchase must attach to
 * an account, and taking the user id from the request body would let anyone
 * move anyone else's subscription onto their own account.
 *
 * The webhook routes are deliberately NOT authenticated — the stores cannot
 * present a user token. They are safe because a notification only ever acts
 * as a trigger to re-read state from the store; see modules/billing/notifications.
 *
 * Configuration comes from worker secrets:
 *
 *   APPLE_KEY_ID, APPLE_ISSUER_ID, APPLE_PRIVATE_KEY, APPLE_BUNDLE_ID
 *   APPLE_ENVIRONMENT           production | sandbox | auto (default auto)
 *   GOOGLE_PACKAGE_NAME, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY
 *   BILLING_TRIAL_DAYS          enables POST /billing/trial when > 0
 *
 * A platform whose secrets are absent answers 501 rather than 500, so an
 * iOS-only app simply never configures Google and gets a clear message if
 * something calls it anyway.
 */

export interface BillingRouterOptions extends XenitionRouterOptions {
  /** Override the store adapters (tests, or credentials from elsewhere). */
  apple?: AppleStore;
  google?: GoogleStore;
  /**
   * Free trial length offered by `POST /billing/trial`. Server-side on
   * purpose: a client-supplied length would let anyone grant themselves a
   * ten-year trial. Falls back to `BILLING_TRIAL_DAYS`; without either, the
   * route is not mounted.
   */
  trialDays?: number;
  /** Entitlement the trial grants. Defaults to `premium`. */
  trialEntitlement?: string;
}

export function billingRouter(options: BillingRouterOptions = {}): Hono {
  const app = new Hono();
  applyCors(app, options.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  const resolveClient = makeClientResolver('billing', options.client);
  const billingOf = (c: Context): BillingClient => resolveClient(c).modules.billing;
  const auth = requireAuth({ client: options.client });

  /* ── catalog (public — a paywall is shown before sign-in) ────────────── */

  app.get('/billing/products', async (c) => {
    const platform = c.req.query('platform');
    if (platform && platform !== 'apple' && platform !== 'google' && platform !== 'stripe') {
      return badRequest(c, '"platform" must be one of apple, google, stripe');
    }
    const products = await billingOf(c).listProducts({
      platform: platform as 'apple' | 'google' | 'stripe' | undefined,
    });
    return c.json({ products: normalizeRows(products) });
  });

  /* ── entitlements ────────────────────────────────────────────────────── */

  app.get('/billing/entitlements', auth, async (c) => {
    const entitlements = await billingOf(c).listEntitlements(requireUser(c).id);
    return c.json({ entitlements });
  });

  app.get('/billing/entitlements/:key', auth, async (c) => {
    const check = await billingOf(c).check(requireUser(c).id, c.req.param('key'));
    return c.json(check);
  });

  /* ── verification ────────────────────────────────────────────────────── */

  // Rate limited like the other write routes: verification costs an upstream
  // round trip to Apple or Google, so it is the most expensive thing here to
  // have hammered.
  if (options.rateLimit !== false) {
    app.post('/billing/verify', rateLimiter(options.rateLimit ?? 10));
    app.post('/billing/restore', rateLimiter(options.rateLimit ?? 10));
  }

  app.post('/billing/verify', auth, async (c) => {
    const body = await readObjectBody(c);
    if (!body) return badRequest(c, 'Body must be a JSON object.');
    const userId = requireUser(c).id;
    const billing = billingOf(c);

    const platform = body.platform;
    if (platform === 'apple') {
      const transactionId = stringField(body, 'transactionId');
      if (!transactionId) return badRequest(c, '"transactionId" is required for apple.');
      const apple = appleFrom(c, options);
      const purchase = await billing.recordPurchase(await apple.verify({ userId, transactionId }));
      return c.json(await verifyResponse(billing, userId, purchase.product_id, 'apple'), 201);
    }

    if (platform === 'google') {
      const productId = stringField(body, 'productId');
      const purchaseToken = stringField(body, 'purchaseToken');
      if (!productId || !purchaseToken) {
        return badRequest(c, '"productId" and "purchaseToken" are required for google.');
      }
      const kind = body.kind === 'product' ? 'product' : 'subscription';
      const google = googleFrom(c, options);
      const verified = await google.verify({ userId, productId, purchaseToken, kind });
      const purchase = await billing.recordPurchase(verified);

      // Play auto-refunds anything unacknowledged after three days, and
      // verifying does not acknowledge. Failing to acknowledge must not fail
      // the request — the purchase IS recorded — but it must not be silent
      // either, so it is reported alongside the entitlement.
      let acknowledged: boolean | undefined;
      if (GoogleStore.needsAcknowledgement(verified.raw ?? {})) {
        try {
          await google.acknowledge({ productId, purchaseToken, kind });
          acknowledged = true;
        } catch {
          acknowledged = false;
        }
      }
      const response = await verifyResponse(billing, userId, purchase.product_id, 'google');
      return c.json(acknowledged === undefined ? response : { ...response, acknowledged }, 201);
    }

    return badRequest(c, '"platform" must be "apple" or "google".');
  });

  /* ── restore ─────────────────────────────────────────────────────────── */

  app.post('/billing/restore', auth, async (c) => {
    const body = await readObjectBody(c);
    if (!body) return badRequest(c, 'Body must be a JSON object.');
    const userId = requireUser(c).id;
    const billing = billingOf(c);

    if (body.platform === 'apple') {
      const chainId = stringField(body, 'originalTransactionId') ?? stringField(body, 'transactionId');
      if (!chainId) {
        return badRequest(c, '"originalTransactionId" is required for apple.');
      }
      const records = await appleFrom(c, options).restore({
        userId,
        originalTransactionId: chainId,
      });
      for (const record of records) await billing.recordPurchase(record);
    } else if (body.platform === 'google') {
      const productId = stringField(body, 'productId');
      const purchaseToken = stringField(body, 'purchaseToken');
      if (!productId || !purchaseToken) {
        return badRequest(c, '"productId" and "purchaseToken" are required for google.');
      }
      const verified = await googleFrom(c, options).verify({
        userId,
        productId,
        purchaseToken,
        kind: body.kind === 'product' ? 'product' : 'subscription',
      });
      await billing.recordPurchase(verified);
    } else {
      return badRequest(c, '"platform" must be "apple" or "google".');
    }

    return c.json({ entitlements: await billing.listEntitlements(userId) });
  });

  /* ── trial ───────────────────────────────────────────────────────────── */

  const trialDays = options.trialDays;
  app.post('/billing/trial', auth, async (c) => {
    const days = trialDays ?? Number(readEnvVar(c, 'BILLING_TRIAL_DAYS') ?? 0);
    if (!Number.isFinite(days) || days <= 0) {
      return c.json(
        {
          error: {
            code: 'NOT_CONFIGURED',
            message: 'Trials are not enabled — set BILLING_TRIAL_DAYS or the trialDays option.',
          },
        },
        501,
      );
    }
    const userId = requireUser(c).id;
    const entitlement = options.trialEntitlement ?? 'premium';
    const billing = billingOf(c);

    // Idempotent from the client's point of view: a second tap returns the
    // current state rather than a 400 the app has to special-case.
    const existing = await billing.check(userId, entitlement);
    if (existing.status !== 'none') return c.json(existing);

    await billing.startTrial({ userId, entitlement, days });
    return c.json(await billing.check(userId, entitlement), 201);
  });

  /* ── store notifications ─────────────────────────────────────────────── */

  app.post('/billing/webhooks/apple', async (c) => {
    const body = await readObjectBody(c);
    const signedPayload = body ? stringField(body, 'signedPayload') : undefined;
    if (!signedPayload) return badRequest(c, '"signedPayload" is required.');
    const result = await handleAppleNotification({
      billing: billingOf(c),
      apple: appleFrom(c, options),
      signedPayload,
    });
    return c.json(notificationBody(result));
  });

  app.post('/billing/webhooks/google', async (c) => {
    const body = await readObjectBody(c);
    if (!body) return badRequest(c, 'Body must be a JSON object.');
    const result = await handleGoogleNotification({
      billing: billingOf(c),
      google: googleFrom(c, options),
      body,
    });
    return c.json(notificationBody(result));
  });

  return app;
}

/* ── entitlement gate ──────────────────────────────────────────────────── */

export interface RequireEntitlementOptions {
  client?: XenitionClient;
  /** Message for the 402 body. Defaults to a generic upgrade prompt. */
  message?: string;
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
export function requireEntitlement(
  entitlement: string,
  options: RequireEntitlementOptions = {},
): MiddlewareHandler {
  if (typeof entitlement !== 'string' || entitlement.trim() === '') {
    throw new Error('requireEntitlement: an entitlement name is required.');
  }
  const resolveClient = makeClientResolver('billing', options.client);

  return async (c, next) => {
    const user = currentUser(c);
    if (!user) {
      throw new XenitionApiConfigError(
        `requireEntitlement("${entitlement}"): no authenticated user on this request. ` +
          'Mount requireAuth() before it.',
      );
    }
    const check = await resolveClient(c).modules.billing.check(user.id, entitlement);
    if (!check.allowed) {
      return c.json(
        {
          error: {
            code: 'ENTITLEMENT_REQUIRED',
            message: options.message ?? `This feature requires "${entitlement}".`,
          },
          entitlement: check,
        },
        402,
      );
    }
    await next();
  };
}

/* ── helpers ───────────────────────────────────────────────────────────── */

/** The entitlement a purchase produced, alongside the purchase itself. */
async function verifyResponse(
  billing: BillingClient,
  userId: string,
  productId: string,
  platform: 'apple' | 'google',
): Promise<Record<string, unknown>> {
  const product = await billing.findProduct(platform, productId);
  const entitlement: EntitlementCheck | null = product
    ? await billing.check(userId, product.entitlement)
    : null;
  return {
    ok: true,
    // Null when the product was never declared via `defineProduct` — the
    // purchase is recorded either way, and saying so beats pretending the
    // user was granted something.
    entitlement,
    product: product ? normalizeRow(product as unknown as Record<string, unknown>) : null,
  };
}

/**
 * Webhook responses stay minimal on purpose: both stores treat any non-2xx
 * as "retry", and neither reads the body. Echoing purchase details would
 * only leak them to whoever can reach the endpoint.
 */
function notificationBody(result: {
  handled: boolean;
  notificationType: string;
  reason?: string;
}): Record<string, unknown> {
  return {
    received: true,
    handled: result.handled,
    type: result.notificationType,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

function appleFrom(c: Context, options: BillingRouterOptions): AppleStore {
  if (options.apple) return options.apple;
  const keyId = readEnvVar(c, 'APPLE_KEY_ID');
  const issuerId = readEnvVar(c, 'APPLE_ISSUER_ID');
  const privateKey = readEnvVar(c, 'APPLE_PRIVATE_KEY');
  const bundleId = readEnvVar(c, 'APPLE_BUNDLE_ID');
  if (!keyId || !issuerId || !privateKey || !bundleId) {
    throw new NotConfiguredError(
      'Apple purchases need the APPLE_KEY_ID, APPLE_ISSUER_ID, APPLE_PRIVATE_KEY and ' +
        'APPLE_BUNDLE_ID secrets.',
    );
  }
  const environment = readEnvVar(c, 'APPLE_ENVIRONMENT');
  return new AppleStore({
    keyId,
    issuerId,
    privateKey,
    bundleId,
    environment:
      environment === 'production' || environment === 'sandbox' ? environment : 'auto',
  });
}

function googleFrom(c: Context, options: BillingRouterOptions): GoogleStore {
  if (options.google) return options.google;
  const packageName = readEnvVar(c, 'GOOGLE_PACKAGE_NAME');
  const clientEmail = readEnvVar(c, 'GOOGLE_CLIENT_EMAIL');
  const privateKey = readEnvVar(c, 'GOOGLE_PRIVATE_KEY');
  if (!packageName || !clientEmail || !privateKey) {
    throw new NotConfiguredError(
      'Google purchases need the GOOGLE_PACKAGE_NAME, GOOGLE_CLIENT_EMAIL and ' +
        'GOOGLE_PRIVATE_KEY secrets.',
    );
  }
  return new GoogleStore({ packageName, clientEmail, privateKey });
}

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

async function readObjectBody(c: Context): Promise<Record<string, unknown> | undefined> {
  const body = await c.req.json().catch(() => undefined);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  return body as Record<string, unknown>;
}
