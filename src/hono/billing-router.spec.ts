import { Hono } from 'hono';
import { XenitionClient } from '../xenition-client';
import { AppleStore, BillingClient, GoogleStore } from '../modules/billing';
import { makeFakeContext } from '../testing/fake-store';
import type { User } from '../auth/types';
import { requireAuth } from './auth';
import { billingRouter, requireEntitlement } from './billing-router';
import { honoErrorHandler } from './errors';

/**
 * Exercises the whole path a mobile app takes: sign in, verify a purchase,
 * read the entitlement, get through a gated route. The store adapters and
 * the platform auth call are stubbed; everything between them is real.
 */
const USER: User = {
  id: 'user-1',
  email: 'a@example.com',
  role: 'authenticated',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const IN_A_MONTH = () => new Date(Date.now() + 30 * 86_400_000).toISOString();
const auth = { headers: { Authorization: 'Bearer tok' } };
const json = (body: unknown) => ({
  method: 'POST',
  headers: { ...auth.headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const appleStub = (over: Record<string, unknown> = {}) =>
  ({
    verify: jest.fn(async ({ userId }: { userId: string }) => ({
      userId,
      platform: 'apple' as const,
      productId: 'premium.monthly',
      originalTransactionId: 'chain-1',
      transactionId: 'txn-1',
      status: 'active',
      expiresAt: IN_A_MONTH(),
      ...over,
    })),
    restore: jest.fn(async ({ userId }: { userId: string }) => [
      {
        userId,
        platform: 'apple' as const,
        productId: 'premium.monthly',
        originalTransactionId: 'chain-1',
        transactionId: 'txn-1',
        status: 'active' as const,
        expiresAt: IN_A_MONTH(),
      },
    ]),
  }) as unknown as AppleStore;

const googleStub = (raw: Record<string, unknown> = {}) =>
  ({
    verify: jest.fn(async ({ userId }: { userId: string }) => ({
      userId,
      platform: 'google' as const,
      productId: 'premium.monthly',
      originalTransactionId: 'tok-1',
      transactionId: 'GPA.1',
      status: 'active',
      expiresAt: IN_A_MONTH(),
      raw,
    })),
    acknowledge: jest.fn(async () => undefined),
  }) as unknown as GoogleStore;

/** A worker exposing the billing router, with the catalog already declared. */
const makeApp = async (options: Record<string, unknown> = {}) => {
  const { store, ctx } = makeFakeContext();
  const billing = new BillingClient(ctx);
  await billing.defineProduct({
    productId: 'premium.monthly',
    platform: 'apple',
    entitlement: 'premium',
  });
  await billing.defineProduct({
    productId: 'premium.monthly',
    platform: 'google',
    entitlement: 'premium',
  });

  const verifyToken = jest.fn().mockResolvedValue(USER);
  const client = {
    auth: { verifyToken },
    modules: { use: jest.fn(), billing },
  } as unknown as XenitionClient;

  const app = new Hono();
  app.route('/api', billingRouter({ client, ...options }));
  return { app, billing, store, client, verifyToken };
};

describe('GET /billing/products', () => {
  it('serves the paywall catalog without a token', async () => {
    const { app } = await makeApp();
    const res = await app.request('/api/billing/products');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: Array<Record<string, unknown>> };
    expect(body.products).toHaveLength(2);
    // Rows leave the routers camelCased, like every other module.
    expect(body.products[0]).toHaveProperty('productId');
  });

  it('filters by platform and rejects a bogus one', async () => {
    const { app } = await makeApp();
    const filtered = await app.request('/api/billing/products?platform=apple');
    expect(((await filtered.json()) as { products: unknown[] }).products).toHaveLength(1);
    expect((await app.request('/api/billing/products?platform=paypal')).status).toBe(400);
  });
});

describe('POST /billing/verify', () => {
  it('verifies an Apple purchase and returns the entitlement', async () => {
    const apple = appleStub();
    const { app } = await makeApp({ apple });

    const res = await app.request(
      '/api/billing/verify',
      json({ platform: 'apple', transactionId: 'txn-1' }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      ok: true,
      entitlement: { entitlement: 'premium', allowed: true, source: 'purchase' },
    });
    // The purchase is bound to the AUTHENTICATED caller.
    expect(apple.verify).toHaveBeenCalledWith({ userId: 'user-1', transactionId: 'txn-1' });
  });

  it('ignores a userId in the body — the token decides', async () => {
    // Otherwise anyone could move someone else's subscription to their account.
    const apple = appleStub();
    const { app, billing } = await makeApp({ apple });
    await app.request(
      '/api/billing/verify',
      json({ platform: 'apple', transactionId: 'txn-1', userId: 'someone-else' }),
    );
    expect(apple.verify).toHaveBeenCalledWith({ userId: 'user-1', transactionId: 'txn-1' });
    expect((await billing.check('someone-else', 'premium')).allowed).toBe(false);
  });

  it('401s without a token, before calling the store', async () => {
    const apple = appleStub();
    const { app } = await makeApp({ apple });
    const res = await app.request('/api/billing/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'apple', transactionId: 'txn-1' }),
    });
    expect(res.status).toBe(401);
    expect(apple.verify).not.toHaveBeenCalled();
  });

  it('verifies a Google purchase and acknowledges it', async () => {
    // Play auto-refunds an unacknowledged purchase after three days.
    const google = googleStub({ acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING' });
    const { app } = await makeApp({ google });

    const res = await app.request(
      '/api/billing/verify',
      json({ platform: 'google', productId: 'premium.monthly', purchaseToken: 'tok-1' }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ acknowledged: true });
    expect(google.acknowledge).toHaveBeenCalledWith({
      productId: 'premium.monthly',
      purchaseToken: 'tok-1',
      kind: 'subscription',
    });
  });

  it('does not re-acknowledge an already acknowledged purchase', async () => {
    const google = googleStub({ acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' });
    const { app } = await makeApp({ google });
    const res = await app.request(
      '/api/billing/verify',
      json({ platform: 'google', productId: 'premium.monthly', purchaseToken: 'tok-1' }),
    );
    expect(await res.json()).not.toHaveProperty('acknowledged');
    expect(google.acknowledge).not.toHaveBeenCalled();
  });

  it('still records the purchase when acknowledgement fails, and says so', async () => {
    const google = googleStub({ acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING' });
    (google.acknowledge as unknown as jest.Mock).mockRejectedValue(new Error('play down'));
    const { app, billing } = await makeApp({ google });

    const res = await app.request(
      '/api/billing/verify',
      json({ platform: 'google', productId: 'premium.monthly', purchaseToken: 'tok-1' }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ acknowledged: false });
    expect((await billing.check('user-1', 'premium')).allowed).toBe(true);
  });

  it('rejects a missing platform or missing identifiers', async () => {
    const { app } = await makeApp({ apple: appleStub(), google: googleStub() });
    expect((await app.request('/api/billing/verify', json({}))).status).toBe(400);
    expect(
      (await app.request('/api/billing/verify', json({ platform: 'apple' }))).status,
    ).toBe(400);
    expect(
      (await app.request('/api/billing/verify', json({ platform: 'google', productId: 'p' })))
        .status,
    ).toBe(400);
  });

  it('answers 501 for a store this app never configured', async () => {
    // An iOS-only app is right not to hold Google credentials; that is not a
    // fault, so it must not read as a 500.
    const { app } = await makeApp({ apple: appleStub() });
    const res = await app.request(
      '/api/billing/verify',
      json({ platform: 'google', productId: 'premium.monthly', purchaseToken: 'tok-1' }),
    );
    expect(res.status).toBe(501);
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'NOT_CONFIGURED' } });
  });

  it('reports a null entitlement for a product that was never declared', async () => {
    const apple = appleStub({ productId: 'undeclared.plan' });
    const { app } = await makeApp({ apple });
    const res = await app.request(
      '/api/billing/verify',
      json({ platform: 'apple', transactionId: 'txn-1' }),
    );
    expect(await res.json()).toMatchObject({ ok: true, entitlement: null, product: null });
  });
});

describe('GET /billing/entitlements', () => {
  it('returns the caller’s entitlements', async () => {
    const { app } = await makeApp({ apple: appleStub() });
    await app.request('/api/billing/verify', json({ platform: 'apple', transactionId: 'txn-1' }));

    const res = await app.request('/api/billing/entitlements', auth);
    expect(await res.json()).toMatchObject({
      entitlements: [{ entitlement: 'premium', allowed: true }],
    });
  });

  it('answers a single entitlement check', async () => {
    const { app } = await makeApp();
    const res = await app.request('/api/billing/entitlements/premium', auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ allowed: false, status: 'none' });
  });

  it('401s without a token', async () => {
    const { app } = await makeApp();
    expect((await app.request('/api/billing/entitlements')).status).toBe(401);
  });
});

describe('POST /billing/restore', () => {
  it('re-applies Apple purchases after a reinstall', async () => {
    const apple = appleStub();
    const { app } = await makeApp({ apple });
    const res = await app.request(
      '/api/billing/restore',
      json({ platform: 'apple', originalTransactionId: 'chain-1' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      entitlements: [{ entitlement: 'premium', allowed: true }],
    });
  });

  it('requires the chain identifier', async () => {
    const { app } = await makeApp({ apple: appleStub() });
    expect((await app.request('/api/billing/restore', json({ platform: 'apple' }))).status).toBe(
      400,
    );
  });
});

describe('POST /billing/trial', () => {
  it('starts the trial with the SERVER’s length, not the client’s', async () => {
    const { app } = await makeApp({ trialDays: 7 });
    const res = await app.request('/api/billing/trial', json({ days: 3650 }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ allowed: true, isTrial: true, daysRemaining: 7 });
  });

  it('is idempotent — a second tap returns the current state', async () => {
    const { app } = await makeApp({ trialDays: 7 });
    await app.request('/api/billing/trial', json({}));
    const again = await app.request('/api/billing/trial', json({}));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ isTrial: true });
  });

  it('will not restart a trial that already expired', async () => {
    const { app, billing } = await makeApp({ trialDays: 7 });
    await billing.grant({
      userId: 'user-1',
      entitlement: 'premium',
      source: 'trial',
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const res = await app.request('/api/billing/trial', json({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ allowed: false, status: 'expired' });
  });

  it('answers 501 when trials are not enabled', async () => {
    const { app } = await makeApp();
    const res = await app.request('/api/billing/trial', json({}));
    expect(res.status).toBe(501);
  });
});

describe('webhooks', () => {
  it('accepts an Apple notification without a user token', async () => {
    const { app } = await makeApp({ apple: appleStub() });
    const res = await app.request('/api/billing/webhooks/apple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signedPayload: `${btoa('{"alg":"ES256"}')}.${btoa(
          JSON.stringify({ notificationType: 'TEST', notificationUUID: 'u1' }),
        )}.sig`,
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, type: 'TEST' });
  });

  it('does not echo purchase details back to whoever can reach the endpoint', async () => {
    const { app } = await makeApp({ apple: appleStub() });
    const res = await app.request('/api/billing/webhooks/apple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signedPayload: `${btoa('{"alg":"ES256"}')}.${btoa(
          JSON.stringify({ notificationType: 'TEST', notificationUUID: 'u2' }),
        )}.sig`,
      }),
    });
    const text = await res.text();
    expect(text).not.toContain('user-1');
    expect(text).not.toContain('chain-1');
  });

  it('rejects a body with no signedPayload', async () => {
    const { app } = await makeApp({ apple: appleStub() });
    const res = await app.request('/api/billing/webhooks/apple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });
});

describe('requireEntitlement', () => {
  const gatedApp = async (grant: boolean) => {
    const { store, ctx } = makeFakeContext();
    const billing = new BillingClient(ctx);
    if (grant) await billing.grant({ userId: 'user-1', entitlement: 'premium' });
    const client = {
      auth: { verifyToken: jest.fn().mockResolvedValue(USER) },
      modules: { use: jest.fn(), billing },
    } as unknown as XenitionClient;

    const app = new Hono();
    app.onError(honoErrorHandler);
    app.use('/coach/*', requireAuth({ client }), requireEntitlement('premium', { client }));
    app.get('/coach/session', (c) => c.json({ ok: true }));
    return { app, store };
  };

  it('lets an entitled caller through', async () => {
    const { app } = await gatedApp(true);
    const res = await app.request('/coach/session', auth);
    expect(res.status).toBe(200);
  });

  it('answers 402 with the paywall payload, not 403', async () => {
    // The caller is allowed to ask — they just have not paid. The app should
    // show the paywall, and 403 would read as "you may never do this".
    //
    // The body is the SDK's one payment-required shape, the same one a
    // metered quota refuses with: `PAYMENT_REQUIRED` and a flat entitlement
    // key, so a client renders one paywall without knowing which feature
    // said no. The full check is still here, under `check`, for the apps
    // that distinguish an expired subscription from one that never existed.
    const { app } = await gatedApp(false);
    const res = await app.request('/coach/session', auth);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: { code: 'PAYMENT_REQUIRED' },
      entitlement: 'premium',
      check: { allowed: false, entitlement: 'premium' },
    });
  });

  it('leaves out the quota block when an entitlement is what refused', async () => {
    // `quota` present means "you are out of runs"; absent means "you must
    // upgrade". That distinction is the only thing telling the two 402s
    // apart, so it has to hold on this side too.
    const { app } = await gatedApp(false);
    const body = (await (await app.request('/coach/session', auth)).json()) as {
      quota?: unknown;
    };
    expect(body.quota).toBeUndefined();
  });

  it('401s before checking entitlement when there is no token', async () => {
    const { app } = await gatedApp(true);
    expect((await app.request('/coach/session')).status).toBe(401);
  });

  it('refuses to be constructed without an entitlement name', () => {
    expect(() => requireEntitlement('')).toThrow(/entitlement name is required/);
  });

  it('surfaces a wiring bug when mounted without requireAuth', async () => {
    const { store, ctx } = makeFakeContext();
    void store;
    const client = {
      modules: { use: jest.fn(), billing: new BillingClient(ctx) },
    } as unknown as XenitionClient;
    const app = new Hono();
    app.onError(honoErrorHandler);
    app.get('/x', requireEntitlement('premium', { client }), (c) => c.json({ ok: true }));
    const res = await app.request('/x');
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: { code: 'CONFIG_ERROR' } });
  });
});
