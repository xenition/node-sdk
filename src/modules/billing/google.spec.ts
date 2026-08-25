import { generateKeyPairSync } from 'crypto';
import { GoogleStore } from './google';
import { parseJws } from './jws';

/**
 * Play's HTTP is stubbed, but the service-account assertion is signed for
 * real against a generated RSA key and verified with node crypto — a
 * malformed assertion would otherwise fail only against Google, in
 * production, on a customer's purchase.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const CONFIG = {
  packageName: 'com.acme.app',
  clientEmail: 'svc@acme.iam.gserviceaccount.com',
  privateKey,
};

const HOUR = 3_600_000;
const future = () => new Date(Date.now() + 30 * 24 * HOUR).toISOString();
const past = () => new Date(Date.now() - HOUR).toISOString();

const subscription = (over: Record<string, unknown> = {}) => ({
  subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
  latestOrderId: 'GPA.1234',
  startTime: '2026-01-01T00:00:00Z',
  lineItems: [
    {
      productId: 'premium.monthly',
      expiryTime: future(),
      autoRenewingPlan: { autoRenewEnabled: true },
    },
  ],
  acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
  ...over,
});

/**
 * Stub for both hops: the OAuth exchange and the Play API. Records every
 * request so tests can assert on the assertion and the URL.
 */
const makeFetch = (
  playResponse: { status?: number; body?: unknown } = { body: subscription() },
) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('oauth2')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'ya29.token', expires_in: 3600 }),
        text: async () => '',
      } as unknown as Response;
    }
    const status = playResponse.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => playResponse.body ?? {},
      text: async () => (playResponse.body ? JSON.stringify(playResponse.body) : ''),
    } as unknown as Response;
  });
  return { impl, calls };
};

const makeStore = (playResponse?: { status?: number; body?: unknown }) => {
  const { impl, calls } = makeFetch(playResponse);
  return {
    calls,
    impl,
    google: new GoogleStore({ ...CONFIG, fetchImpl: impl as unknown as typeof fetch }),
  };
};

const verifyInput = { userId: 'user-1', productId: 'premium.monthly', purchaseToken: 'tok-abc' };

describe('construction', () => {
  it('demands every credential up front', () => {
    for (const field of ['packageName', 'clientEmail', 'privateKey'] as const) {
      expect(() => new GoogleStore({ ...CONFIG, [field]: '' })).toThrow(
        new RegExp(`"${field}" is required`),
      );
    }
  });
});

describe('service-account authentication', () => {
  it('signs an RS256 assertion Google can verify', async () => {
    const { google, calls } = makeStore();
    await google.verify(verifyInput);

    const oauth = calls.find((call) => call.url.includes('oauth2'))!;
    const params = new URLSearchParams(String(oauth.init!.body));
    expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');

    const { header, payload, signingInput, signature } = parseJws(params.get('assertion')!);
    expect(header).toMatchObject({ alg: 'RS256', typ: 'JWT' });
    expect(payload).toMatchObject({
      iss: CONFIG.clientEmail,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
    });

    const { createVerify } = await import('crypto');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(Buffer.from(signingInput));
    expect(verifier.verify(publicKey, Buffer.from(signature))).toBe(true);
  });

  it('caches the access token instead of exchanging on every call', async () => {
    const { google, calls } = makeStore();
    await google.verify(verifyInput);
    await google.verify(verifyInput);
    expect(calls.filter((call) => call.url.includes('oauth2'))).toHaveLength(1);
  });

  it('sends the token as a bearer to the Play API', async () => {
    const { google, calls } = makeStore();
    await google.verify(verifyInput);
    const play = calls.find((call) => call.url.includes('androidpublisher'))!;
    expect((play.init!.headers as Record<string, string>).Authorization).toBe('Bearer ya29.token');
  });

  it('explains a rejected service account rather than leaking a 400', async () => {
    const impl = jest.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);
    const google = new GoogleStore({ ...CONFIG, fetchImpl: impl as unknown as typeof fetch });
    await expect(google.verify(verifyInput)).rejects.toThrow(
      /OAuth token exchange failed with 400 — check the service account/,
    );
  });
});

describe('verify (subscription)', () => {
  it('normalizes an active subscription', async () => {
    const { google } = makeStore();
    const record = await google.verify(verifyInput);
    expect(record).toMatchObject({
      userId: 'user-1',
      platform: 'google',
      productId: 'premium.monthly',
      originalTransactionId: 'tok-abc',
      transactionId: 'GPA.1234',
      status: 'active',
      autoRenewing: true,
      environment: 'production',
    });
    expect(record.expiresAt).not.toBeNull();
  });

  it('queries the v2 subscriptions endpoint for this package', async () => {
    const { google, calls } = makeStore();
    await google.verify(verifyInput);
    const play = calls.find((call) => call.url.includes('androidpublisher'))!;
    expect(play.url).toContain('/applications/com.acme.app/purchases/subscriptionsv2/tokens/tok-abc');
  });

  it('KEEPS access for a cancelled subscription that is still paid up', async () => {
    // CANCELED means auto-renew is off, not that access ended. The user paid
    // for this period; cutting them off now is taking money for nothing.
    const { google } = makeStore({
      body: subscription({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }),
    });
    expect((await google.verify(verifyInput)).status).toBe('active');
  });

  it('expires a cancelled subscription once the period is over', async () => {
    const { google } = makeStore({
      body: subscription({
        subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
        lineItems: [{ productId: 'premium.monthly', expiryTime: past() }],
      }),
    });
    expect((await google.verify(verifyInput)).status).toBe('expired');
  });

  it('maps the remaining Play states onto access', async () => {
    const cases: Array<[string, string]> = [
      ['SUBSCRIPTION_STATE_ACTIVE', 'active'],
      ['SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'grace'],
      ['SUBSCRIPTION_STATE_ON_HOLD', 'on_hold'],
      ['SUBSCRIPTION_STATE_PAUSED', 'on_hold'],
      ['SUBSCRIPTION_STATE_EXPIRED', 'expired'],
      ['SUBSCRIPTION_STATE_PENDING', 'pending'],
    ];
    for (const [state, expected] of cases) {
      const { google } = makeStore({ body: subscription({ subscriptionState: state }) });
      expect((await google.verify(verifyInput)).status).toBe(expected);
    }
  });

  it('denies access for a state Play has not documented yet', async () => {
    const { google } = makeStore({ body: subscription({ subscriptionState: 'WHAT_IS_THIS' }) });
    expect((await google.verify(verifyInput)).status).toBe('expired');
  });

  it('marks a licence-tester purchase as sandbox', async () => {
    const { google } = makeStore({ body: subscription({ testPurchase: {} }) });
    expect((await google.verify(verifyInput)).environment).toBe('sandbox');
  });

  it('picks the line item the client claimed', async () => {
    const { google } = makeStore({
      body: subscription({
        lineItems: [
          { productId: 'other.plan', expiryTime: past() },
          { productId: 'premium.monthly', expiryTime: future() },
        ],
      }),
    });
    const record = await google.verify(verifyInput);
    expect(record.productId).toBe('premium.monthly');
    expect(record.status).toBe('active');
  });

  it('falls back to the first line item when the claimed id is absent', async () => {
    const { google } = makeStore({
      body: subscription({ lineItems: [{ productId: 'renamed.plan', expiryTime: future() }] }),
    });
    expect((await google.verify(verifyInput)).productId).toBe('renamed.plan');
  });

  it('reports an unknown token clearly', async () => {
    const { google } = makeStore({ status: 404 });
    await expect(google.verify(verifyInput)).rejects.toThrow(/does not recognize this purchase token/);
  });

  it('rejects blank input before spending a network call', async () => {
    const { google, impl } = makeStore();
    await expect(google.verify({ ...verifyInput, purchaseToken: '' })).rejects.toThrow(
      /"purchaseToken" must be/,
    );
    expect(impl).not.toHaveBeenCalled();
  });
});

describe('verify (one-time product)', () => {
  const product = { purchaseState: 0, orderId: 'GPA.9', purchaseTimeMillis: '1700000000000' };

  it('normalizes a purchased product as perpetual', async () => {
    const { google, calls } = makeStore({ body: product });
    const record = await google.verify({ ...verifyInput, kind: 'product' });
    expect(record).toMatchObject({
      status: 'active',
      transactionId: 'GPA.9',
      expiresAt: null,
      autoRenewing: false,
    });
    expect(record.purchasedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(calls.find((call) => call.url.includes('androidpublisher'))!.url).toContain(
      '/purchases/products/premium.monthly/tokens/tok-abc',
    );
  });

  it('maps cancelled and pending product states', async () => {
    const cancelled = makeStore({ body: { ...product, purchaseState: 1 } });
    expect((await cancelled.google.verify({ ...verifyInput, kind: 'product' })).status).toBe(
      'refunded',
    );
    const pending = makeStore({ body: { ...product, purchaseState: 2 } });
    expect((await pending.google.verify({ ...verifyInput, kind: 'product' })).status).toBe(
      'pending',
    );
  });

  it('marks a licence-tester product purchase as sandbox', async () => {
    const { google } = makeStore({ body: { ...product, purchaseType: 0 } });
    expect((await google.verify({ ...verifyInput, kind: 'product' })).environment).toBe('sandbox');
  });
});

describe('acknowledge', () => {
  it('POSTs the subscription acknowledge endpoint', async () => {
    const { google, calls } = makeStore({ body: {} });
    await google.acknowledge({ productId: 'premium.monthly', purchaseToken: 'tok-abc' });
    const play = calls.find((call) => call.url.includes('androidpublisher'))!;
    expect(play.init!.method).toBe('POST');
    expect(play.url).toContain('/purchases/subscriptions/premium.monthly/tokens/tok-abc:acknowledge');
  });

  it('POSTs the product acknowledge endpoint for a one-time purchase', async () => {
    const { google, calls } = makeStore({ body: {} });
    await google.acknowledge({
      productId: 'premium.lifetime',
      purchaseToken: 'tok-abc',
      kind: 'product',
    });
    expect(calls.find((call) => call.url.includes('androidpublisher'))!.url).toContain(
      '/purchases/products/premium.lifetime/tokens/tok-abc:acknowledge',
    );
  });

  it('tolerates the empty body Play answers with', async () => {
    const { google } = makeStore({ body: undefined });
    await expect(
      google.acknowledge({ productId: 'p', purchaseToken: 't' }),
    ).resolves.toBeUndefined();
  });

  it('needsAcknowledgement spots both shapes Play uses', () => {
    // Missing this is a silent auto-refund three days later.
    expect(
      GoogleStore.needsAcknowledgement({ acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING' }),
    ).toBe(true);
    expect(GoogleStore.needsAcknowledgement({ acknowledgementState: 0 })).toBe(true);
    expect(
      GoogleStore.needsAcknowledgement({
        acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
      }),
    ).toBe(false);
    expect(GoogleStore.needsAcknowledgement({ acknowledgementState: 1 })).toBe(false);
  });
});
