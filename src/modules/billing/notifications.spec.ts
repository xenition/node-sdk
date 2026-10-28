import { makeFakeContext } from '../../testing/fake-store';
import { AppleStore } from './apple';
import { BillingClient, BILLING_TABLES } from './billing-client';
import { GoogleStore } from './google';
import { base64UrlEncodeJson, bytesToBase64Url } from './jws';
import { handleAppleNotification, handleGoogleNotification } from './notifications';

/**
 * The point of these tests is the trust boundary: a notification says WHICH
 * purchase changed, and the store says WHAT it changed to. So the store
 * adapters are stubbed with a recognizable answer, and the tests check that
 * the answer — not the notification body — is what lands in the database.
 */
const IN_A_MONTH = () => new Date(Date.now() + 30 * 86_400_000).toISOString();

const signed = (claims: Record<string, unknown>): string =>
  `${base64UrlEncodeJson({ alg: 'ES256' })}.${base64UrlEncodeJson(claims)}.${bytesToBase64Url(
    new Uint8Array([1]),
  )}`;

const setup = async () => {
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
  return { store, billing };
};

/** A billing store that already knows about user-1's purchase on `platform`. */
const withPurchase = async (platform: 'apple' | 'google', chainId: string) => {
  const { store, billing } = await setup();
  await billing.recordPurchase({
    userId: 'user-1',
    platform,
    productId: 'premium.monthly',
    originalTransactionId: chainId,
    transactionId: 'txn-1',
    expiresAt: IN_A_MONTH(),
  });
  return { store, billing };
};

/** An AppleStore whose verify() reports the subscription as refunded. */
const appleSaying = (status: string) =>
  ({
    verify: jest.fn(async ({ userId }: { userId: string }) => ({
      userId,
      platform: 'apple' as const,
      productId: 'premium.monthly',
      originalTransactionId: 'chain-1',
      transactionId: 'txn-2',
      status,
      expiresAt: IN_A_MONTH(),
    })),
  }) as unknown as AppleStore;

const googleSaying = (status: string) =>
  ({
    verify: jest.fn(async ({ userId }: { userId: string }) => ({
      userId,
      platform: 'google' as const,
      productId: 'premium.monthly',
      originalTransactionId: 'tok-1',
      transactionId: 'GPA.2',
      status,
      expiresAt: IN_A_MONTH(),
    })),
  }) as unknown as GoogleStore;

const appleNotification = (over: Record<string, unknown> = {}) =>
  signed({
    notificationType: 'DID_RENEW',
    notificationUUID: 'uuid-1',
    data: {
      bundleId: 'com.acme.app',
      signedTransactionInfo: signed({
        transactionId: 'txn-2',
        originalTransactionId: 'chain-1',
        productId: 'premium.monthly',
      }),
    },
    ...over,
  });

const googleBody = (over: Record<string, unknown> = {}, messageId = 'msg-1') => ({
  message: {
    messageId,
    data: btoa(
      JSON.stringify({
        packageName: 'com.acme.app',
        subscriptionNotification: {
          notificationType: 2,
          purchaseToken: 'tok-1',
          subscriptionId: 'premium.monthly',
        },
        ...over,
      }),
    ),
  },
});

describe('handleAppleNotification', () => {
  it('re-reads the purchase from Apple rather than trusting the body', async () => {
    // The notification claims a renewal; Apple says it was refunded. Apple wins.
    const { billing } = await withPurchase('apple', 'chain-1');
    const apple = appleSaying('refunded');

    const result = await handleAppleNotification({
      billing,
      apple,
      signedPayload: appleNotification(),
    });

    expect(result.handled).toBe(true);
    expect(apple.verify).toHaveBeenCalledWith({ userId: 'user-1', transactionId: 'txn-2' });
    expect(result.purchase?.status).toBe('refunded');
    expect((await billing.check('user-1', 'premium')).allowed).toBe(false);
  });

  it('applies a renewal to the existing chain', async () => {
    const { store, billing } = await withPurchase('apple', 'chain-1');
    await handleAppleNotification({
      billing,
      apple: appleSaying('active'),
      signedPayload: appleNotification(),
    });
    expect(store.rows(BILLING_TABLES.PURCHASES)).toHaveLength(1);
    expect((await billing.check('user-1', 'premium')).allowed).toBe(true);
  });

  it('ignores a redelivery of the same notification', async () => {
    // Apple retries for three days; every notification arrives more than once.
    const { billing } = await withPurchase('apple', 'chain-1');
    const apple = appleSaying('active');
    const payload = appleNotification();

    const first = await handleAppleNotification({ billing, apple, signedPayload: payload });
    const second = await handleAppleNotification({ billing, apple, signedPayload: payload });

    expect(first.handled).toBe(true);
    expect(second).toMatchObject({ handled: false, reason: 'duplicate' });
    expect(apple.verify).toHaveBeenCalledTimes(1);
  });

  it('treats a different notification uuid as a new event', async () => {
    const { billing } = await withPurchase('apple', 'chain-1');
    const apple = appleSaying('active');
    await handleAppleNotification({ billing, apple, signedPayload: appleNotification() });
    await handleAppleNotification({
      billing,
      apple,
      signedPayload: appleNotification({ notificationUUID: 'uuid-2' }),
    });
    expect(apple.verify).toHaveBeenCalledTimes(2);
  });

  it('does nothing for a purchase this backend never recorded', async () => {
    // An Apple team can host several apps; a notification for a sibling app's
    // purchase must not invent a user here.
    const { billing } = await setup();
    const apple = appleSaying('active');
    const result = await handleAppleNotification({
      billing,
      apple,
      signedPayload: appleNotification(),
    });
    expect(result).toMatchObject({ handled: true, reason: 'unknown_purchase' });
    expect(apple.verify).not.toHaveBeenCalled();
  });

  it('acknowledges Apple’s TEST notification without touching any purchase', async () => {
    const { billing } = await setup();
    const apple = appleSaying('active');
    const result = await handleAppleNotification({
      billing,
      apple,
      signedPayload: signed({ notificationType: 'TEST', notificationUUID: 'uuid-test' }),
    });
    expect(result).toMatchObject({ handled: true, reason: 'test' });
    expect(apple.verify).not.toHaveBeenCalled();
  });

  it('records the subtype so the audit trail distinguishes the causes', async () => {
    const { store, billing } = await withPurchase('apple', 'chain-1');
    await handleAppleNotification({
      billing,
      apple: appleSaying('on_hold'),
      signedPayload: appleNotification({
        notificationType: 'DID_FAIL_TO_RENEW',
        subtype: 'GRACE_PERIOD',
      }),
    });
    expect(store.rows(BILLING_TABLES.EVENTS)[0]).toMatchObject({
      notification_type: 'DID_FAIL_TO_RENEW.GRACE_PERIOD',
      original_transaction_id: 'chain-1',
    });
  });

  it('rejects an empty payload', async () => {
    const { billing } = await setup();
    await expect(
      handleAppleNotification({ billing, apple: appleSaying('active'), signedPayload: '' }),
    ).rejects.toThrow(/"signedPayload" is required/);
  });
});

describe('handleGoogleNotification', () => {
  it('re-reads the purchase from Play rather than trusting the body', async () => {
    const { billing } = await withPurchase('google', 'tok-1');
    const google = googleSaying('revoked');

    const result = await handleGoogleNotification({ billing, google, body: googleBody() });

    expect(google.verify).toHaveBeenCalledWith({
      userId: 'user-1',
      productId: 'premium.monthly',
      purchaseToken: 'tok-1',
      kind: 'subscription',
    });
    expect(result.purchase?.status).toBe('revoked');
    expect((await billing.check('user-1', 'premium')).allowed).toBe(false);
  });

  it('names the notification type for the audit trail', async () => {
    const { store, billing } = await withPurchase('google', 'tok-1');
    await handleGoogleNotification({
      billing,
      google: googleSaying('active'),
      body: googleBody({
        subscriptionNotification: {
          notificationType: 13,
          purchaseToken: 'tok-1',
          subscriptionId: 'premium.monthly',
        },
      }),
    });
    expect(store.rows(BILLING_TABLES.EVENTS)[0]).toMatchObject({
      notification_type: 'SUBSCRIPTION_EXPIRED',
    });
  });

  it('keeps working when Play adds a notification type we do not know', async () => {
    // The name is cosmetic — the state always comes from re-reading.
    const { billing } = await withPurchase('google', 'tok-1');
    const google = googleSaying('active');
    const result = await handleGoogleNotification({
      billing,
      google,
      body: googleBody({
        subscriptionNotification: {
          notificationType: 99,
          purchaseToken: 'tok-1',
          subscriptionId: 'premium.monthly',
        },
      }),
    });
    expect(result.notificationType).toBe('UNKNOWN_99');
    expect(google.verify).toHaveBeenCalled();
  });

  it('ignores a Pub/Sub redelivery of the same messageId', async () => {
    const { billing } = await withPurchase('google', 'tok-1');
    const google = googleSaying('active');
    await handleGoogleNotification({ billing, google, body: googleBody() });
    const second = await handleGoogleNotification({ billing, google, body: googleBody() });
    expect(second).toMatchObject({ handled: false, reason: 'duplicate' });
    expect(google.verify).toHaveBeenCalledTimes(1);
  });

  it('routes a one-time product notification to the product endpoint', async () => {
    const { billing } = await setup();
    await billing.recordPurchase({
      userId: 'user-1',
      platform: 'google',
      productId: 'premium.monthly',
      originalTransactionId: 'tok-1',
    });
    const google = googleSaying('active');
    await handleGoogleNotification({
      billing,
      google,
      body: googleBody({
        subscriptionNotification: undefined,
        oneTimeProductNotification: {
          notificationType: 1,
          purchaseToken: 'tok-1',
          sku: 'premium.monthly',
        },
      }),
    });
    expect(google.verify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'product' }));
  });

  it('acknowledges a test notification without touching any purchase', async () => {
    const { billing } = await setup();
    const google = googleSaying('active');
    const result = await handleGoogleNotification({
      billing,
      google,
      body: googleBody({ subscriptionNotification: undefined, testNotification: { version: '1' } }),
    });
    expect(result).toMatchObject({ handled: true, reason: 'test' });
    expect(google.verify).not.toHaveBeenCalled();
  });

  it('records nothing for a purchase this backend never recorded', async () => {
    // Play is read once (it might be a plan switch whose linkedPurchaseToken
    // someone owns), but with no owner found nothing lands in the database.
    const { store, billing } = await setup();
    const google = googleSaying('active');
    const result = await handleGoogleNotification({ billing, google, body: googleBody() });
    expect(result).toMatchObject({ handled: true, reason: 'unknown_purchase' });
    expect(google.verify).toHaveBeenCalledTimes(1);
    expect(store.rows(BILLING_TABLES.PURCHASES)).toHaveLength(0);
  });

  it('rejects a body with no Pub/Sub message data', async () => {
    const { billing } = await setup();
    await expect(
      handleGoogleNotification({ billing, google: googleSaying('active'), body: {} }),
    ).rejects.toThrow(/body.message.data is required/);
  });
});

describe('replay protection is per platform', () => {
  it('does not let an Apple uuid mask a Google messageId', async () => {
    const { billing } = await setup();
    await billing.recordPurchase({
      userId: 'user-1',
      platform: 'google',
      productId: 'premium.monthly',
      originalTransactionId: 'tok-1',
    });
    await billing.recordEvent({
      platform: 'apple',
      notificationType: 'DID_RENEW',
      eventId: 'shared-id',
    });
    const google = googleSaying('active');
    const result = await handleGoogleNotification({
      billing,
      google,
      body: googleBody({}, 'shared-id'),
    });
    expect(result.handled).toBe(true);
    expect(google.verify).toHaveBeenCalled();
  });
});

describe('owner from the purchase account token (resolveAccount)', () => {
  const appleWithToken = (appAccountToken: string, uuid = 'uuid-tok') =>
    appleNotification({
      notificationUUID: uuid,
      data: {
        bundleId: 'com.acme.app',
        signedTransactionInfo: signed({ transactionId: 'txn-2', originalTransactionId: 'chain-1', productId: 'premium.monthly', appAccountToken }),
      },
    });

  it('Apple: a chain nobody verified yet is recorded for the user its appAccountToken names', async () => {
    const { billing } = await setup();
    const apple = appleSaying('active');
    const resolveAccount = jest.fn(async (token: string) => (token === 'user-9' ? 'user-9' : null));
    const result = await handleAppleNotification({ billing, apple, signedPayload: appleWithToken('user-9'), resolveAccount });

    expect(resolveAccount).toHaveBeenCalledWith('user-9', 'apple');
    expect(apple.verify).toHaveBeenCalledWith({ userId: 'user-9', transactionId: 'txn-2' });
    expect(result).toMatchObject({ handled: true, ownerFrom: 'account_token' });
    expect((await billing.check('user-9', 'premium')).allowed).toBe(true);
  });

  it('Apple: a token the resolver does not recognise stays unknown, and nothing is recorded', async () => {
    const { billing } = await setup();
    const apple = appleSaying('active');
    const result = await handleAppleNotification({ billing, apple, signedPayload: appleWithToken('stranger'), resolveAccount: () => null });
    expect(result).toMatchObject({ handled: true, reason: 'unknown_purchase' });
    expect(apple.verify).not.toHaveBeenCalled();
  });

  it('Apple: without a resolver the old behaviour holds', async () => {
    const { billing } = await setup();
    const apple = appleSaying('active');
    const result = await handleAppleNotification({ billing, apple, signedPayload: appleWithToken('user-9') });
    expect(result).toMatchObject({ reason: 'unknown_purchase' });
  });

  it('Apple: an already-owned chain keeps its owner whatever the token says', async () => {
    const { billing } = await withPurchase('apple', 'chain-1');
    const apple = appleSaying('active');
    const resolveAccount = jest.fn(() => 'user-9');
    const result = await handleAppleNotification({ billing, apple, signedPayload: appleWithToken('user-9'), resolveAccount });
    expect(resolveAccount).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ownerFrom: 'chain' });
    expect(apple.verify).toHaveBeenCalledWith({ userId: 'user-1', transactionId: 'txn-2' });
  });

  it('Google: reads the purchase from Play, maps obfuscatedExternalAccountId, records it for that user', async () => {
    const { billing } = await setup();
    const google = {
      verify: jest.fn(async ({ userId }: { userId: string }) => ({
        userId,
        platform: 'google' as const,
        productId: 'premium.monthly',
        originalTransactionId: 'tok-1',
        transactionId: 'GPA.1',
        status: 'active' as const,
        expiresAt: IN_A_MONTH(),
        raw: { externalAccountIdentifiers: { obfuscatedExternalAccountId: 'user-7' } },
      })),
    } as unknown as GoogleStore;
    const result = await handleGoogleNotification({ billing, google, body: googleBody({}, 'msg-tok'), resolveAccount: (t) => t });

    expect(result).toMatchObject({ handled: true, ownerFrom: 'account_token' });
    expect(result.purchase?.user_id).toBe('user-7');
    expect((await billing.check('user-7', 'premium')).allowed).toBe(true);
    expect((await billing.findPurchase('google', 'tok-1'))?.user_id).toBe('user-7');
  });

  it('Google: no account id on the purchase → unknown, nothing recorded', async () => {
    const { store, billing } = await setup();
    const google = googleSaying('active');
    const result = await handleGoogleNotification({ billing, google, body: googleBody({}, 'msg-none'), resolveAccount: (t) => t });
    expect(result).toMatchObject({ reason: 'unknown_purchase' });
    expect(store.rows(BILLING_TABLES.PURCHASES)).toHaveLength(0);
  });
});

describe('Google: a new token from a plan switch or resubscribe (linkedPurchaseToken)', () => {
  const googleNewToken = (raw: Record<string, unknown>) =>
    ({
      verify: jest.fn(async ({ userId }: { userId: string }) => ({
        userId,
        platform: 'google' as const,
        productId: 'premium.monthly',
        originalTransactionId: 'tok-1',
        transactionId: 'GPA.9',
        status: 'active' as const,
        expiresAt: IN_A_MONTH(),
        raw,
      })),
    }) as unknown as GoogleStore;

  it('goes to the owner of the chain it replaced, without any resolver', async () => {
    const { billing } = await withPurchase('google', 'tok-old');
    const result = await handleGoogleNotification({ billing, google: googleNewToken({ linkedPurchaseToken: 'tok-old' }), body: googleBody({}, 'msg-link') });
    expect(result).toMatchObject({ handled: true, ownerFrom: 'linked_chain' });
    expect((await billing.findPurchase('google', 'tok-1'))?.user_id).toBe('user-1');
  });

  it('a linked token nobody owns falls through to unknown (no resolver)', async () => {
    const { billing } = await setup();
    const result = await handleGoogleNotification({ billing, google: googleNewToken({ linkedPurchaseToken: 'tok-ghost' }), body: googleBody({}, 'msg-ghost') });
    expect(result).toMatchObject({ reason: 'unknown_purchase' });
    expect(await billing.findPurchase('google', 'tok-1')).toBeNull();
  });
});

describe('Google: voided purchase (refund / chargeback)', () => {
  const voidedBody = (token: string, messageId: string) => ({
    message: {
      messageId,
      data: btoa(JSON.stringify({ packageName: 'com.acme.app', voidedPurchaseNotification: { purchaseToken: token, orderId: 'GPA.1', productType: 1, refundType: 1 } })),
    },
  });

  it('re-reads the recorded purchase from Play and stores the answer — access stops', async () => {
    const { billing } = await withPurchase('google', 'tok-1');
    const google = googleSaying('expired');
    const result = await handleGoogleNotification({ billing, google, body: voidedBody('tok-1', 'msg-void') });

    expect(google.verify).toHaveBeenCalledWith({ userId: 'user-1', productId: 'premium.monthly', purchaseToken: 'tok-1', kind: 'subscription' });
    expect(result).toMatchObject({ handled: true, notificationType: 'VOIDED_PURCHASE' });
    expect((await billing.check('user-1', 'premium')).allowed).toBe(false);
  });

  it('a voided token nobody recorded changes nothing, and a redelivery is a no-op', async () => {
    const { billing } = await setup();
    const google = googleSaying('expired');
    const first = await handleGoogleNotification({ billing, google, body: voidedBody('tok-x', 'msg-void-2') });
    const again = await handleGoogleNotification({ billing, google, body: voidedBody('tok-x', 'msg-void-2') });
    expect(first).toMatchObject({ reason: 'unknown_purchase' });
    expect(again).toMatchObject({ handled: false, reason: 'duplicate' });
    expect(google.verify).not.toHaveBeenCalled();
  });
});

describe('NotificationResult.event', () => {
  it('a store trial that renews into its first charge reports trial_converted', async () => {
    const { billing } = await setup();
    await billing.recordPurchase({
      userId: 'user-1', platform: 'apple', productId: 'premium.monthly', originalTransactionId: 'chain-1',
      transactionId: 'txn-1', expiresAt: IN_A_MONTH(), raw: { offerType: 1, offerDiscountType: 'FREE_TRIAL' },
    });
    const apple = {
      verify: jest.fn(async ({ userId }: { userId: string }) => ({
        userId, platform: 'apple' as const, productId: 'premium.monthly', originalTransactionId: 'chain-1',
        transactionId: 'txn-2', status: 'active' as const, expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
        autoRenewing: true, raw: { type: 'Auto-Renewable Subscription' },
      })),
    } as unknown as AppleStore;
    const result = await handleAppleNotification({ billing, apple, signedPayload: appleNotification({ notificationUUID: 'uuid-conv' }) });
    expect(result.event).toBe('trial_converted');
  });

  it('a refund reads as refunded', async () => {
    const { billing } = await withPurchase('apple', 'chain-1');
    const result = await handleAppleNotification({ billing, apple: appleSaying('refunded'), signedPayload: appleNotification({ notificationUUID: 'uuid-ref' }) });
    expect(result.event).toBe('refunded');
  });
});

import { importEs256PrivateKey, pemToDer, signJwt } from './jws';
import { INTERMEDIATE_PEM, LEAF_KEY_PKCS8, LEAF_PEM, ROOT_PEM } from './x509.fixtures';

describe('handleAppleNotification({ verifySignature })', () => {
  const b64 = (pem: string) => Buffer.from(pemToDer(pem)).toString('base64');
  const rootSha = async () =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pemToDer(ROOT_PEM) as unknown as ArrayBuffer)), (b) => b.toString(16).padStart(2, '0')).join('');
  const realSigned = async (claims: Record<string, unknown>) =>
    signJwt({ alg: 'ES256', x5c: [b64(LEAF_PEM), b64(INTERMEDIATE_PEM), b64(ROOT_PEM)] }, claims, await importEs256PrivateKey(LEAF_KEY_PKCS8));
  const claims = {
    notificationType: 'DID_RENEW',
    notificationUUID: 'uuid-sig',
    data: { signedTransactionInfo: signed({ transactionId: 'txn-2', originalTransactionId: 'chain-1', productId: 'premium.monthly' }) },
  };

  it('a properly signed notification is processed', async () => {
    const { billing } = await withPurchase('apple', 'chain-1');
    const apple = appleSaying('active');
    const result = await handleAppleNotification({ billing, apple, signedPayload: await realSigned(claims), verifySignature: { rootFingerprints: [await rootSha()] } });
    expect(result.handled).toBe(true);
    expect(apple.verify).toHaveBeenCalled();
  });

  it('an unsigned (forged) one is refused and nothing is recorded', async () => {
    const { store, billing } = await withPurchase('apple', 'chain-1');
    const apple = appleSaying('refunded');
    const result = await handleAppleNotification({ billing, apple, signedPayload: signed(claims), verifySignature: true });
    expect(result).toMatchObject({ handled: false, reason: 'invalid_signature', notificationType: 'DID_RENEW' });
    expect(apple.verify).not.toHaveBeenCalled();
    expect(store.rows(BILLING_TABLES.EVENTS)).toHaveLength(0);
  });
});
