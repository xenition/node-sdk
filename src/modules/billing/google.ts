import { RecordPurchaseInput } from './billing-client';
import { importRs256PrivateKey, signJwt } from './jws';
import { PurchaseStatus } from './types';

/**
 * Google Play Developer API adapter.
 *
 * Same job as the Apple adapter: the device says "I bought premium" and
 * hands over a `purchaseToken`; only Google can say whether that is true.
 * The server exchanges a service-account JWT for an OAuth token and asks.
 *
 *   const google = new GoogleStore({ packageName, clientEmail, privateKey });
 *   await billing.recordPurchase(await google.verify({ userId, productId, purchaseToken }));
 *
 * The credentials come straight out of the service-account JSON you
 * download from Google Cloud — `client_email` and `private_key` — for a
 * service account granted access in Play Console under
 * Users and permissions → "View financial data".
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_ROOT = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const TOKEN_TTL_SECONDS = 3600;

export interface GoogleConfig {
  /** Android application id, e.g. `com.acme.app`. */
  packageName: string;
  /** Service account `client_email` from the downloaded JSON. */
  clientEmail: string;
  /** Service account `private_key` from the downloaded JSON (PEM). */
  privateKey: string;
  /** Override the OAuth token endpoint (the JSON's `token_uri`). */
  tokenUrl?: string;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Play's subscription states, mapped onto access.
 *
 * CANCELED is the one that catches people out: it means auto-renew was
 * turned off, NOT that access ended. The user paid for the current period
 * and keeps it until `expiryTime` — cutting them off the moment they cancel
 * would be taking money for a period already sold. So CANCELED resolves by
 * expiry rather than by name.
 *
 * PAUSED is a Play-specific state with no Apple equivalent: the user
 * deliberately suspended the subscription and should not have access while
 * it is suspended, so it lands on `on_hold` alongside failed billing.
 */
const STATE_BY_NAME: Record<string, PurchaseStatus | 'by_expiry'> = {
  SUBSCRIPTION_STATE_ACTIVE: 'active',
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'grace',
  SUBSCRIPTION_STATE_ON_HOLD: 'on_hold',
  SUBSCRIPTION_STATE_PAUSED: 'on_hold',
  SUBSCRIPTION_STATE_EXPIRED: 'expired',
  SUBSCRIPTION_STATE_PENDING: 'pending',
  SUBSCRIPTION_STATE_CANCELED: 'by_expiry',
};

/** One-time product purchase states. */
const PRODUCT_STATE: Record<number, PurchaseStatus> = {
  0: 'active', // Purchased
  1: 'refunded', // Cancelled
  2: 'pending', // Pending (deferred payment)
};

export class GoogleStore {
  private readonly fetchImpl: typeof fetch;
  private readonly tokenUrl: string;
  private tokenCache?: { token: string; expiresAt: number };

  constructor(private readonly config: GoogleConfig) {
    for (const field of ['packageName', 'clientEmail', 'privateKey'] as const) {
      if (!config?.[field]) {
        throw new Error(`GoogleStore: "${field}" is required.`);
      }
    }
    this.tokenUrl = config.tokenUrl ?? TOKEN_URL;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('GoogleStore: no global fetch available — pass `fetchImpl`.');
    }
  }

  /**
   * Verify a purchase and produce the record for `billing.recordPurchase()`.
   *
   * `kind` decides which Play endpoint answers. Subscriptions and one-time
   * products live behind different URLs with different response shapes, and
   * Play returns 404 rather than redirecting if you ask the wrong one.
   */
  async verify(input: {
    userId: string;
    productId: string;
    purchaseToken: string;
    kind?: 'subscription' | 'product';
  }): Promise<RecordPurchaseInput> {
    const userId = requireField('verify', 'userId', input?.userId);
    const productId = requireField('verify', 'productId', input?.productId);
    const purchaseToken = requireField('verify', 'purchaseToken', input?.purchaseToken);

    return input?.kind === 'product'
      ? this.verifyProduct(userId, productId, purchaseToken)
      : this.verifySubscription(userId, productId, purchaseToken);
  }

  private async verifySubscription(
    userId: string,
    productId: string,
    purchaseToken: string,
  ): Promise<RecordPurchaseInput> {
    const body = await this.get(
      `/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
    );

    const lineItems = Array.isArray(body.lineItems)
      ? (body.lineItems as Array<Record<string, unknown>>)
      : [];
    // Play can return several line items on a multi-product subscription;
    // prefer the one the client claimed, and fall back to the first so a
    // renamed base plan still verifies rather than silently returning null.
    const line = lineItems.find((item) => item.productId === productId) ?? lineItems[0];
    const expiresAt = asIso(line?.expiryTime);
    const state = String(body.subscriptionState ?? '');

    const mapped = STATE_BY_NAME[state];
    const status: PurchaseStatus =
      mapped === 'by_expiry'
        ? isFuture(expiresAt)
          ? 'active'
          : 'expired'
        : (mapped ?? 'expired');

    return {
      userId,
      platform: 'google',
      productId: String(line?.productId ?? productId),
      // The purchase token IS the chain: renewals keep it, so it plays the
      // same role as Apple's originalTransactionId.
      originalTransactionId: purchaseToken,
      transactionId: String(body.latestOrderId ?? purchaseToken),
      status,
      purchasedAt: asIso(body.startTime),
      expiresAt,
      autoRenewing: Boolean(
        (line?.autoRenewingPlan as Record<string, unknown> | undefined)?.autoRenewEnabled,
      ),
      // `testPurchase` is present only for licence-tester purchases. Same
      // rule as Apple: a test purchase must never read as production.
      environment: body.testPurchase ? 'sandbox' : 'production',
      raw: body,
    };
  }

  private async verifyProduct(
    userId: string,
    productId: string,
    purchaseToken: string,
  ): Promise<RecordPurchaseInput> {
    const body = await this.get(
      `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(
        purchaseToken,
      )}`,
    );
    return {
      userId,
      platform: 'google',
      productId,
      originalTransactionId: purchaseToken,
      transactionId: String(body.orderId ?? purchaseToken),
      status: PRODUCT_STATE[Number(body.purchaseState)] ?? 'expired',
      purchasedAt: msToIso(body.purchaseTimeMillis),
      // One-time products do not expire; leaving this null keeps the
      // entitlement perpetual.
      expiresAt: null,
      autoRenewing: false,
      // purchaseType 0 means a licence-tester purchase; absent means real.
      environment: body.purchaseType === 0 ? 'sandbox' : 'production',
      raw: body,
    };
  }

  /**
   * Acknowledge a purchase.
   *
   * Play AUTOMATICALLY REFUNDS any purchase not acknowledged within three
   * days. Verification alone does not acknowledge, so an app that only
   * verifies quietly refunds every sale three days later — call this once
   * verification succeeds. It is idempotent on Play's side.
   */
  async acknowledge(input: {
    productId: string;
    purchaseToken: string;
    kind?: 'subscription' | 'product';
  }): Promise<void> {
    const productId = requireField('acknowledge', 'productId', input?.productId);
    const purchaseToken = requireField('acknowledge', 'purchaseToken', input?.purchaseToken);
    const path =
      input?.kind === 'product'
        ? `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(
            purchaseToken,
          )}:acknowledge`
        : `/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(
            purchaseToken,
          )}:acknowledge`;
    await this.post(path);
  }

  /** True when the purchase still needs acknowledging. */
  static needsAcknowledgement(raw: Record<string, unknown>): boolean {
    if (raw.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') return true;
    // The one-time product endpoint reports it as 0 (pending) / 1 (done).
    return raw.acknowledgementState === 0;
  }

  /* ── transport ─────────────────────────────────────────────────────────── */

  private async get(path: string): Promise<Record<string, unknown>> {
    return this.call(path, 'GET');
  }

  private async post(path: string): Promise<Record<string, unknown>> {
    return this.call(path, 'POST');
  }

  private async call(path: string, method: string): Promise<Record<string, unknown>> {
    const url = `${API_ROOT}/${encodeURIComponent(this.config.packageName)}${path}`;
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });

    if (response.status === 404) {
      throw new Error('GoogleStore: Play does not recognize this purchase token.');
    }
    if (!response.ok) {
      const detail = await safeText(response);
      throw new Error(
        `GoogleStore: Play Developer API returned ${response.status}${
          detail ? ` — ${detail}` : ''
        }`,
      );
    }
    // `:acknowledge` answers 200 with an empty body.
    const text = await response.text();
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  /**
   * OAuth access token from the service-account JWT, cached until shortly
   * before expiry. Every verification would otherwise cost two round trips.
   */
  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.tokenCache && this.tokenCache.expiresAt - 60 > now) return this.tokenCache.token;

    const key = await importRs256PrivateKey(this.config.privateKey);
    const assertion = await signJwt(
      { alg: 'RS256', typ: 'JWT' },
      {
        iss: this.config.clientEmail,
        scope: SCOPE,
        aud: this.tokenUrl,
        iat: now,
        exp: now + TOKEN_TTL_SECONDS,
      },
      key,
    );

    const response = await this.fetchImpl(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: JWT_BEARER, assertion }).toString(),
    });
    if (!response.ok) {
      throw new Error(
        `GoogleStore: OAuth token exchange failed with ${response.status} — check the ` +
          'service account credentials and that it has Play Console access.',
      );
    }
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new Error('GoogleStore: OAuth token exchange returned no access_token.');
    }
    this.tokenCache = {
      token: body.access_token,
      expiresAt: now + (body.expires_in ?? TOKEN_TTL_SECONDS),
    };
    return body.access_token;
  }
}

/* ── helpers ───────────────────────────────────────────────────────────── */

/** Play sends RFC-3339 strings on the v2 endpoints. Normalize to ISO. */
export function asIso(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/** …and epoch-millisecond STRINGS on the older product endpoints. */
export function msToIso(value: unknown): string | null {
  const ms = typeof value === 'string' ? Number(value) : value;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function isFuture(iso: string | null): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  return Number.isFinite(at) && at > Date.now();
}

function requireField(method: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`GoogleStore.${method}: "${field}" must be a non-empty string.`);
  }
  return value;
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return '';
  }
}
