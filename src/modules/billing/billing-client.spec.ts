import { makeFakeContext } from '../../testing/fake-store';
import { BillingClient, BILLING_TABLES, daysUntil, isExpired } from './billing-client';

/**
 * These tests are about MONEY, so they assert on stored state rather than
 * on call sequences: what a user is entitled to after a sequence of store
 * events is the only thing that matters, and it must survive an internal
 * read being added or moved.
 */
const makeBilling = () => {
  const { store, ctx } = makeFakeContext();
  return { store, billing: new BillingClient(ctx) };
};

const IN_A_MONTH = () => new Date(Date.now() + 30 * 86_400_000).toISOString();
const YESTERDAY = () => new Date(Date.now() - 86_400_000).toISOString();

/** A billing client with the standard premium subscription declared. */
const withPremium = async () => {
  const { store, billing } = makeBilling();
  await billing.defineProduct({
    productId: 'com.acme.premium.monthly',
    platform: 'apple',
    entitlement: 'premium',
    kind: 'subscription',
    period: 'monthly',
  });
  return { store, billing };
};

const applePurchase = (over: Record<string, unknown> = {}) => ({
  userId: 'user-1',
  platform: 'apple' as const,
  productId: 'com.acme.premium.monthly',
  originalTransactionId: 'chain-1',
  transactionId: 'txn-1',
  expiresAt: IN_A_MONTH(),
  autoRenewing: true,
  ...over,
});

describe('defineProduct', () => {
  it('registers a product and reads it back', async () => {
    const { billing } = await withPremium();
    const products = await billing.listProducts();
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      product_id: 'com.acme.premium.monthly',
      platform: 'apple',
      entitlement: 'premium',
      kind: 'subscription',
    });
  });

  it('is idempotent — re-declaring updates instead of duplicating', async () => {
    const { store, billing } = await withPremium();
    await billing.defineProduct({
      productId: 'com.acme.premium.monthly',
      platform: 'apple',
      entitlement: 'pro',
      kind: 'subscription',
    });
    const rows = store.rows(BILLING_TABLES.PRODUCTS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entitlement: 'pro' });
  });

  it('keeps the same product id on two stores apart', async () => {
    const { billing } = await withPremium();
    await billing.defineProduct({
      productId: 'com.acme.premium.monthly',
      platform: 'google',
      entitlement: 'premium',
    });
    expect(await billing.listProducts()).toHaveLength(2);
    expect(await billing.listProducts({ platform: 'google' })).toHaveLength(1);
  });

  it('rejects an unknown platform or kind', async () => {
    const { billing } = makeBilling();
    await expect(
      billing.defineProduct({ productId: 'p', platform: 'paypal' as never, entitlement: 'x' }),
    ).rejects.toThrow(/"platform" must be one of/);
    await expect(
      billing.defineProduct({
        productId: 'p',
        platform: 'apple',
        entitlement: 'x',
        kind: 'rental' as never,
      }),
    ).rejects.toThrow(/"kind" must be one of/);
  });

  it('omits the DEFAULT now() column from the insert', async () => {
    const { store } = await withPremium();
    const insert = store.payloads.find((p) => p.type === 'INSERT');
    expect(insert?.data).not.toHaveProperty('created_at');
  });
});

describe('recordPurchase', () => {
  it('stores a purchase and grants the product entitlement', async () => {
    const { billing } = await withPremium();
    await billing.recordPurchase(applePurchase());
    const check = await billing.check('user-1', 'premium');
    expect(check.allowed).toBe(true);
    expect(check.source).toBe('purchase');
    expect(check.isTrial).toBe(false);
    expect(check.daysRemaining).toBe(30);
  });

  it('is idempotent on the transaction chain — a replay makes one row', async () => {
    const { store, billing } = await withPremium();
    await billing.recordPurchase(applePurchase());
    await billing.recordPurchase(applePurchase());
    await billing.recordPurchase(applePurchase());
    expect(store.rows(BILLING_TABLES.PURCHASES)).toHaveLength(1);
    expect(store.rows(BILLING_TABLES.ENTITLEMENTS)).toHaveLength(1);
  });

  it('a renewal extends the same chain rather than adding a subscription', async () => {
    const { store, billing } = await withPremium();
    await billing.recordPurchase(applePurchase());
    const later = new Date(Date.now() + 60 * 86_400_000).toISOString();
    await billing.recordPurchase(
      applePurchase({ transactionId: 'txn-2', expiresAt: later }),
    );

    const rows = store.rows(BILLING_TABLES.PURCHASES);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ transaction_id: 'txn-2', expires_at: later });
    expect((await billing.check('user-1', 'premium')).daysRemaining).toBe(60);
  });

  it('does NOT hand one subscription to a second account', async () => {
    // Same chain id arriving with a different userId means someone is
    // replaying a receipt on another account — the original owner keeps it.
    const { store, billing } = await withPremium();
    await billing.recordPurchase(applePurchase({ userId: 'user-1' }));
    await billing.recordPurchase(applePurchase({ userId: 'attacker' }));

    expect(store.rows(BILLING_TABLES.PURCHASES)).toHaveLength(1);
    expect(store.rows(BILLING_TABLES.PURCHASES)[0]).toMatchObject({ user_id: 'user-1' });
    expect((await billing.check('attacker', 'premium')).allowed).toBe(false);
    expect((await billing.check('user-1', 'premium')).allowed).toBe(true);
  });

  it('records a purchase for an undeclared product without inventing an entitlement', async () => {
    const { store, billing } = makeBilling();
    await billing.recordPurchase(applePurchase());
    expect(store.rows(BILLING_TABLES.PURCHASES)).toHaveLength(1);
    expect(store.rows(BILLING_TABLES.ENTITLEMENTS)).toHaveLength(0);
    expect((await billing.check('user-1', 'premium')).allowed).toBe(false);
  });

  it('defaults transactionId to the chain id', async () => {
    const { billing } = await withPremium();
    const purchase = await billing.recordPurchase({
      userId: 'user-1',
      platform: 'apple',
      productId: 'com.acme.premium.monthly',
      originalTransactionId: 'chain-9',
    });
    expect(purchase.transaction_id).toBe('chain-9');
  });

  it('requires the fields a store adapter must supply', async () => {
    const { billing } = await withPremium();
    await expect(billing.recordPurchase(applePurchase({ userId: '' }))).rejects.toThrow(
      /"userId" must be a non-empty string/,
    );
    await expect(
      billing.recordPurchase(applePurchase({ originalTransactionId: '' })),
    ).rejects.toThrow(/"originalTransactionId" must be a non-empty string/);
  });
});

describe('purchase status → access', () => {
  const statusGrants = async (status: string) => {
    const { billing } = await withPremium();
    await billing.recordPurchase(applePurchase({ status }));
    return (await billing.check('user-1', 'premium')).allowed;
  };

  it('grants access while active', async () => {
    await expect(statusGrants('active')).resolves.toBe(true);
  });

  it('KEEPS access during billing-retry grace', async () => {
    // The store is retrying a failed card. Cutting access here punishes the
    // user for the bank's timing and is a top source of involuntary churn.
    await expect(statusGrants('grace')).resolves.toBe(true);
  });

  it('stops access once retries are exhausted (on_hold)', async () => {
    await expect(statusGrants('on_hold')).resolves.toBe(false);
  });

  it('stops access on expired, refunded and revoked', async () => {
    await expect(statusGrants('expired')).resolves.toBe(false);
    await expect(statusGrants('refunded')).resolves.toBe(false);
    await expect(statusGrants('revoked')).resolves.toBe(false);
  });

  it('marks a refund as revoked rather than merely expired', async () => {
    const { store, billing } = await withPremium();
    await billing.recordPurchase(applePurchase({ status: 'refunded' }));
    expect(store.rows(BILLING_TABLES.ENTITLEMENTS)[0]).toMatchObject({ status: 'revoked' });
  });
});

describe('check', () => {
  it('reports none for a user who never bought anything', async () => {
    const { billing } = await withPremium();
    expect(await billing.check('nobody', 'premium')).toMatchObject({
      allowed: false,
      status: 'none',
      reason: 'none',
      source: null,
    });
  });

  it('treats a stored-active row with a past expiry as expired', async () => {
    // Nothing runs at the moment a subscription lapses, so the stored status
    // is stale by design — expiry has to be evaluated at read time or the
    // user keeps premium until some sweeper happens to run.
    const { billing } = await withPremium();
    await billing.recordPurchase(applePurchase({ expiresAt: YESTERDAY() }));
    expect(await billing.check('user-1', 'premium')).toMatchObject({
      allowed: false,
      status: 'expired',
      reason: 'expired',
      daysRemaining: null,
    });
  });

  it('treats a null expiry as perpetual', async () => {
    const { billing } = await withPremium();
    await billing.defineProduct({
      productId: 'com.acme.lifetime',
      platform: 'apple',
      entitlement: 'premium',
      kind: 'non_consumable',
    });
    await billing.recordPurchase(
      applePurchase({ productId: 'com.acme.lifetime', originalTransactionId: 'chain-life' }),
    );
    expect(await billing.check('user-1', 'premium')).toMatchObject({
      allowed: true,
      expiresAt: null,
      daysRemaining: null,
    });
  });

  it('ignores a subscription expiry on a non-expiring product', async () => {
    const { billing } = await withPremium();
    await billing.defineProduct({
      productId: 'com.acme.lifetime',
      platform: 'apple',
      entitlement: 'lifetime',
      kind: 'non_consumable',
    });
    await billing.recordPurchase(
      applePurchase({
        productId: 'com.acme.lifetime',
        originalTransactionId: 'chain-life',
        expiresAt: YESTERDAY(),
      }),
    );
    expect((await billing.check('user-1', 'lifetime')).allowed).toBe(true);
  });

  it('rejects a blank entitlement name rather than answering about nothing', async () => {
    const { billing } = await withPremium();
    await expect(billing.check('user-1', '')).rejects.toThrow(/"entitlement" must be/);
  });
});

describe('trials', () => {
  it('grants access for the trial window', async () => {
    const { billing } = await withPremium();
    await billing.startTrial({ userId: 'user-1', entitlement: 'premium', days: 7 });
    const check = await billing.check('user-1', 'premium');
    expect(check).toMatchObject({ allowed: true, isTrial: true, source: 'trial' });
    expect(check.daysRemaining).toBe(7);
  });

  it('refuses a second trial for the same entitlement', async () => {
    // Re-granting on every launch is how a 7-day trial becomes free forever.
    const { billing } = await withPremium();
    await billing.startTrial({ userId: 'user-1', entitlement: 'premium', days: 7 });
    await expect(
      billing.startTrial({ userId: 'user-1', entitlement: 'premium', days: 7 }),
    ).rejects.toThrow(/can only be started once/);
  });

  it('refuses a trial after the trial already expired', async () => {
    const { store, billing } = await withPremium();
    await billing.startTrial({ userId: 'user-1', entitlement: 'premium', days: 7 });
    store.rows(BILLING_TABLES.ENTITLEMENTS)[0]!.expires_at = YESTERDAY();
    await expect(
      billing.startTrial({ userId: 'user-1', entitlement: 'premium', days: 7 }),
    ).rejects.toThrow(/can only be started once/);
  });

  it('lets a purchase take over from a trial', async () => {
    const { store, billing } = await withPremium();
    await billing.startTrial({ userId: 'user-1', entitlement: 'premium', days: 7 });
    await billing.recordPurchase(applePurchase());
    expect(store.rows(BILLING_TABLES.ENTITLEMENTS)).toHaveLength(1);
    expect(await billing.check('user-1', 'premium')).toMatchObject({
      allowed: true,
      source: 'purchase',
      isTrial: false,
      daysRemaining: 30,
    });
  });

  it('rejects a non-positive trial length', async () => {
    const { billing } = await withPremium();
    await expect(
      billing.startTrial({ userId: 'u', entitlement: 'premium', days: 0 }),
    ).rejects.toThrow(/"days" must be a positive number/);
  });
});

describe('grants and revocation', () => {
  it('grants perpetual access when no expiry is given', async () => {
    const { billing } = await withPremium();
    await billing.grant({ userId: 'user-1', entitlement: 'premium' });
    expect(await billing.check('user-1', 'premium')).toMatchObject({
      allowed: true,
      source: 'grant',
      expiresAt: null,
    });
  });

  it('an expiring purchase does not stomp a longer support grant', async () => {
    const { billing } = await withPremium();
    await billing.grant({ userId: 'user-1', entitlement: 'premium' });
    await billing.recordPurchase(applePurchase({ status: 'expired' }));
    expect(await billing.check('user-1', 'premium')).toMatchObject({
      allowed: true,
      source: 'grant',
    });
  });

  it('but an ACTIVE purchase does replace the grant', async () => {
    const { billing } = await withPremium();
    await billing.grant({ userId: 'user-1', entitlement: 'premium' });
    await billing.recordPurchase(applePurchase());
    expect((await billing.check('user-1', 'premium')).source).toBe('purchase');
  });

  it('revoke stops access but keeps the row for audit', async () => {
    const { store, billing } = await withPremium();
    await billing.recordPurchase(applePurchase());
    await billing.revoke('user-1', 'premium');
    expect(store.rows(BILLING_TABLES.ENTITLEMENTS)).toHaveLength(1);
    expect(await billing.check('user-1', 'premium')).toMatchObject({
      allowed: false,
      status: 'revoked',
      reason: 'revoked',
    });
  });
});

describe('listEntitlements and listPurchases', () => {
  it('evaluates every entitlement the same way check does', async () => {
    const { billing } = await withPremium();
    await billing.recordPurchase(applePurchase());
    await billing.grant({ userId: 'user-1', entitlement: 'beta', expiresAt: YESTERDAY() });

    const all = await billing.listEntitlements('user-1');
    expect(all).toHaveLength(2);
    expect(all.find((e) => e.entitlement === 'premium')?.allowed).toBe(true);
    expect(all.find((e) => e.entitlement === 'beta')).toMatchObject({
      allowed: false,
      status: 'expired',
    });
  });

  it('lists a user’s purchases, newest first, and scopes to that user', async () => {
    const { billing } = await withPremium();
    await billing.recordPurchase(applePurchase());
    await billing.recordPurchase(applePurchase({ userId: 'user-2', originalTransactionId: 'c2' }));
    const mine = await billing.listPurchases('user-1');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ original_transaction_id: 'chain-1' });
  });
});

describe('expiry helpers', () => {
  it('isExpired treats null as perpetual and garbage as not expired', () => {
    expect(isExpired(null)).toBe(false);
    expect(isExpired(undefined)).toBe(false);
    expect(isExpired('not-a-date')).toBe(false);
    expect(isExpired(YESTERDAY())).toBe(true);
    expect(isExpired(IN_A_MONTH())).toBe(false);
  });

  it('daysUntil rounds up and never goes negative', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil(YESTERDAY())).toBe(0);
    expect(daysUntil(new Date(Date.now() + 1.2 * 86_400_000).toISOString())).toBe(2);
  });
});
