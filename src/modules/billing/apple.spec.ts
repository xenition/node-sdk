import { generateKeyPairSync } from 'crypto';
import { AppleStore } from './apple';
import { base64UrlEncodeJson, bytesToBase64Url, parseJws } from './jws';

/**
 * The App Store Server API is stubbed through `fetchImpl`, but the JWT the
 * adapter sends is signed for real against a freshly generated P-256 key
 * and verified with node crypto. A store adapter that builds a
 * syntactically valid but cryptographically wrong token fails only in
 * production, against Apple, on someone's purchase — so the signature is
 * checked here rather than assumed.
 */
const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const CONFIG = {
  keyId: 'KEY123',
  issuerId: 'issuer-uuid',
  privateKey,
  bundleId: 'com.acme.app',
};

const HOUR = 3_600_000;

/** A signed JWS whose payload is `claims`. The signature is not read here. */
const signedPayload = (claims: Record<string, unknown>): string =>
  `${base64UrlEncodeJson({ alg: 'ES256' })}.${base64UrlEncodeJson(claims)}.${bytesToBase64Url(
    new Uint8Array([1, 2, 3]),
  )}`;

const TRANSACTION = {
  transactionId: 'txn-1',
  originalTransactionId: 'chain-1',
  productId: 'com.acme.premium.monthly',
  bundleId: 'com.acme.app',
  type: 'Auto-Renewable Subscription',
  environment: 'Production',
  purchaseDate: 1_700_000_000_000,
  expiresDate: 1_700_000_000_000 + 30 * 24 * HOUR,
};

/** Route stub responses by URL path fragment. */
const makeFetch = (routes: Record<string, { status?: number; body?: unknown }>) =>
  jest.fn(async (url: string, _init?: RequestInit) => {
    const match = Object.keys(routes).find((key) => String(url).includes(key));
    const route = match ? routes[match]! : { status: 404 };
    return {
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      json: async () => route.body ?? {},
      text: async () => JSON.stringify(route.body ?? {}),
    } as unknown as Response;
  });

const subscriptionsBody = (status: number, autoRenewStatus = 1) => ({
  data: [
    {
      lastTransactions: [
        {
          originalTransactionId: 'chain-1',
          status,
          signedTransactionInfo: signedPayload(TRANSACTION),
          signedRenewalInfo: signedPayload({ autoRenewStatus }),
        },
      ],
    },
  ],
});

const okRoutes = (status = 1) => ({
  '/inApps/v1/transactions/': { body: { signedTransactionInfo: signedPayload(TRANSACTION) } },
  '/inApps/v1/subscriptions/': { body: subscriptionsBody(status) },
});

describe('construction', () => {
  it('demands every credential up front', () => {
    for (const field of ['keyId', 'issuerId', 'privateKey', 'bundleId'] as const) {
      expect(() => new AppleStore({ ...CONFIG, [field]: '' })).toThrow(
        new RegExp(`"${field}" is required`),
      );
    }
  });
});

describe('client authentication', () => {
  it('signs a JWT Apple can actually verify', async () => {
    const fetchImpl = makeFetch(okRoutes());
    const apple = new AppleStore({ ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch });
    await apple.verify({ userId: 'user-1', transactionId: 'txn-1' });

    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const token = String((init.headers as Record<string, string>).Authorization).replace(
      'Bearer ',
      '',
    );
    const { header, payload, signingInput, signature } = parseJws(token);

    expect(header).toMatchObject({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
    expect(payload).toMatchObject({
      iss: 'issuer-uuid',
      aud: 'appstoreconnect-v1',
      bid: 'com.acme.app',
    });
    // Apple rejects anything valid for more than an hour.
    expect(Number(payload.exp) - Number(payload.iat)).toBeLessThanOrEqual(3600);

    const { createVerify } = await import('crypto');
    const verifier = createVerify('SHA256');
    verifier.update(Buffer.from(signingInput));
    expect(
      verifier.verify(
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature),
      ),
    ).toBe(true);
  });

  it('reuses the token across calls instead of re-signing per request', async () => {
    const fetchImpl = makeFetch(okRoutes());
    const apple = new AppleStore({ ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch });
    await apple.verify({ userId: 'user-1', transactionId: 'txn-1' });
    await apple.verify({ userId: 'user-1', transactionId: 'txn-1' });

    const tokens = fetchImpl.mock.calls.map(
      (call) => (call[1] as RequestInit).headers as Record<string, string>,
    );
    expect(new Set(tokens.map((h) => h.Authorization)).size).toBe(1);
  });
});

describe('verify', () => {
  it('normalizes an active subscription into a purchase record', async () => {
    const apple = new AppleStore({
      ...CONFIG,
      fetchImpl: makeFetch(okRoutes(1)) as unknown as typeof fetch,
    });
    const record = await apple.verify({ userId: 'user-1', transactionId: 'txn-1' });

    expect(record).toMatchObject({
      userId: 'user-1',
      platform: 'apple',
      productId: 'com.acme.premium.monthly',
      originalTransactionId: 'chain-1',
      transactionId: 'txn-1',
      status: 'active',
      autoRenewing: true,
      environment: 'production',
    });
    expect(record.purchasedAt).toBe(new Date(TRANSACTION.purchaseDate).toISOString());
    expect(record.expiresAt).toBe(new Date(TRANSACTION.expiresDate).toISOString());
  });

  it('maps Apple status codes onto access, keeping grace apart from retry', async () => {
    const cases: Array<[number, string]> = [
      [1, 'active'],
      [2, 'expired'],
      [3, 'on_hold'],
      [4, 'grace'],
      [5, 'revoked'],
    ];
    for (const [code, expected] of cases) {
      const apple = new AppleStore({
        ...CONFIG,
        fetchImpl: makeFetch(okRoutes(code)) as unknown as typeof fetch,
      });
      const record = await apple.verify({ userId: 'user-1', transactionId: 'txn-1' });
      expect(record.status).toBe(expected);
    }
  });

  it('treats a revocation date as a refund whatever the status says', async () => {
    const revoked = { ...TRANSACTION, revocationDate: 1_700_100_000_000, revocationReason: 1 };
    const apple = new AppleStore({
      ...CONFIG,
      fetchImpl: makeFetch({
        '/inApps/v1/transactions/': { body: { signedTransactionInfo: signedPayload(revoked) } },
        '/inApps/v1/subscriptions/': { body: subscriptionsBody(1) },
      }) as unknown as typeof fetch,
    });
    expect((await apple.verify({ userId: 'user-1', transactionId: 'txn-1' })).status).toBe(
      'refunded',
    );
  });

  it('does not call the subscription endpoint for a non-consumable', async () => {
    const fetchImpl = makeFetch({
      '/inApps/v1/transactions/': {
        body: {
          signedTransactionInfo: signedPayload({
            ...TRANSACTION,
            type: 'Non-Consumable',
            expiresDate: undefined,
          }),
        },
      },
    });
    const apple = new AppleStore({ ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch });
    const record = await apple.verify({ userId: 'user-1', transactionId: 'txn-1' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(record.status).toBe('active');
    expect(record.expiresAt).toBeNull();
  });

  it('refuses a transaction belonging to a different app', async () => {
    // The API key is scoped to a team, not a bundle — without this check a
    // receipt from a sibling app would unlock this one.
    const apple = new AppleStore({
      ...CONFIG,
      fetchImpl: makeFetch({
        '/inApps/v1/transactions/': {
          body: { signedTransactionInfo: signedPayload({ ...TRANSACTION, bundleId: 'com.evil.app' }) },
        },
      }) as unknown as typeof fetch,
    });
    await expect(apple.verify({ userId: 'user-1', transactionId: 'txn-1' })).rejects.toThrow(
      /belongs to bundle "com.evil.app"/,
    );
  });

  it('takes the environment from the host that answered, not the payload', async () => {
    // The payload claims Sandbox but production served it. The host is what
    // the request actually reached and cannot be stale or spoofed, so it
    // wins — a payload field must not be able to talk its way across the
    // sandbox/production boundary in either direction.
    const apple = new AppleStore({
      ...CONFIG,
      fetchImpl: makeFetch({
        '/inApps/v1/transactions/': {
          body: {
            signedTransactionInfo: signedPayload({ ...TRANSACTION, environment: 'Sandbox' }),
          },
        },
        '/inApps/v1/subscriptions/': { body: subscriptionsBody(1) },
      }) as unknown as typeof fetch,
    });
    expect((await apple.verify({ userId: 'u', transactionId: 'txn-1' })).environment).toBe(
      'production',
    );
  });

  it('rejects blank input before spending a network call', async () => {
    const fetchImpl = makeFetch(okRoutes());
    const apple = new AppleStore({ ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(apple.verify({ userId: '', transactionId: 'txn-1' })).rejects.toThrow(
      /"userId" must be/,
    );
    await expect(apple.verify({ userId: 'u', transactionId: '' })).rejects.toThrow(
      /"transactionId" must be/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('environment selection', () => {
  const hostsCalled = (fetchImpl: jest.Mock): string[] =>
    fetchImpl.mock.calls.map((call) => new URL(String(call[0])).host);

  it('falls back to sandbox when production has never seen the transaction', async () => {
    // TestFlight and simulator purchases exist only in sandbox; without the
    // fallback every internal tester looks like a fraudster.
    const fetchImpl = jest.fn(async (url: string, _init?: RequestInit) => {
      const sandbox = String(url).includes('sandbox');
      if (!sandbox) return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as unknown as Response;
      return {
        ok: true,
        status: 200,
        json: async () =>
          String(url).includes('/subscriptions/')
            ? subscriptionsBody(1)
            : { signedTransactionInfo: signedPayload({ ...TRANSACTION, environment: 'Sandbox' }) },
        text: async () => '',
      } as unknown as Response;
    });
    const apple = new AppleStore({ ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch });
    const record = await apple.verify({ userId: 'u', transactionId: 'txn-1' });

    expect(record.environment).toBe('sandbox');
    expect(hostsCalled(fetchImpl)[0]).toContain('api.storekit.itunes.apple.com');
    expect(hostsCalled(fetchImpl)[1]).toContain('sandbox');
    // The follow-up subscription call must stay in the environment that
    // answered — re-probing production would 404 on every renewal check.
    expect(hostsCalled(fetchImpl)[2]).toContain('sandbox');
  });

  it('never touches sandbox when pinned to production', async () => {
    const fetchImpl = makeFetch({ nothing: { status: 404 } });
    const apple = new AppleStore({
      ...CONFIG,
      environment: 'production',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(apple.verify({ userId: 'u', transactionId: 'txn-1' })).rejects.toThrow(
      /not found in the configured environment/,
    );
    expect(hostsCalled(fetchImpl).every((host) => !host.includes('sandbox'))).toBe(true);
  });

  it('surfaces a non-404 API failure instead of silently retrying', async () => {
    const fetchImpl = makeFetch({ '/inApps/': { status: 401, body: { errorCode: 401 } } });
    const apple = new AppleStore({ ...CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(apple.verify({ userId: 'u', transactionId: 'txn-1' })).rejects.toThrow(
      /returned 401/,
    );
  });
});

describe('restore', () => {
  it('returns every transaction in the chain for a reinstall', async () => {
    const apple = new AppleStore({
      ...CONFIG,
      fetchImpl: makeFetch({
        '/inApps/v1/subscriptions/': {
          body: {
            data: [
              {
                lastTransactions: [
                  {
                    originalTransactionId: 'chain-1',
                    status: 1,
                    signedTransactionInfo: signedPayload(TRANSACTION),
                    signedRenewalInfo: signedPayload({ autoRenewStatus: 1 }),
                  },
                  {
                    originalTransactionId: 'chain-2',
                    status: 2,
                    signedTransactionInfo: signedPayload({
                      ...TRANSACTION,
                      transactionId: 'txn-2',
                      originalTransactionId: 'chain-2',
                    }),
                  },
                ],
              },
            ],
          },
        },
      }) as unknown as typeof fetch,
    });

    const records = await apple.restore({ userId: 'user-1', originalTransactionId: 'chain-1' });
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ originalTransactionId: 'chain-1', status: 'active' });
    expect(records[1]).toMatchObject({ originalTransactionId: 'chain-2', status: 'expired' });
  });

  it('survives an entry with no renewal info', async () => {
    const apple = new AppleStore({
      ...CONFIG,
      fetchImpl: makeFetch({
        '/inApps/v1/subscriptions/': {
          body: {
            data: [
              {
                lastTransactions: [
                  {
                    originalTransactionId: 'chain-1',
                    status: 1,
                    signedTransactionInfo: signedPayload(TRANSACTION),
                  },
                ],
              },
            ],
          },
        },
      }) as unknown as typeof fetch,
    });
    const records = await apple.restore({ userId: 'u', originalTransactionId: 'chain-1' });
    expect(records[0]).toMatchObject({ autoRenewing: false, status: 'active' });
  });
});
