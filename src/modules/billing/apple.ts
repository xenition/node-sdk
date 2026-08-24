import { RecordPurchaseInput } from './billing-client';
import { decodeJwsPayloadUnverified, importEs256PrivateKey, signJwt } from './jws';
import { PurchaseStatus } from './types';

/**
 * Apple App Store Server API adapter.
 *
 * What it is for: turning something the DEVICE claims ("I bought premium")
 * into something the SERVER knows. StoreKit hands the app a transaction id;
 * that id is worthless on its own, because anyone can post one. This
 * adapter asks Apple directly, over TLS, with a JWT signed by a key only
 * the server holds — and Apple's answer is what gets recorded.
 *
 *   const apple = new AppleStore({ keyId, issuerId, privateKey, bundleId });
 *   const purchase = await apple.verify({ userId, transactionId });
 *   await billing.recordPurchase(purchase);
 *
 * Because the response comes from Apple over TLS, the signed payloads it
 * contains are decoded rather than signature-checked: the transport already
 * established who sent them. Server notifications are the opposite case —
 * they arrive unsolicited and MUST be verified. See `verifyAppleNotification`.
 */

const PRODUCTION_HOST = 'https://api.storekit.itunes.apple.com';
const SANDBOX_HOST = 'https://api.storekit-sandbox.itunes.apple.com';
const AUDIENCE = 'appstoreconnect-v1';
/** Apple rejects tokens valid for more than an hour. Stay well inside it. */
const TOKEN_TTL_SECONDS = 1800;

export interface AppleConfig {
  /** Key ID of the App Store Connect API key (the `.p8` filename stem). */
  keyId: string;
  /** Issuer ID from App Store Connect → Users and Access → Integrations. */
  issuerId: string;
  /** Contents of the `.p8` file. PEM armor optional. */
  privateKey: string;
  /** Your app's bundle id, e.g. `com.acme.app`. */
  bundleId: string;
  /**
   * Which Apple environment to query.
   *
   * Default `auto`: try production, and fall back to sandbox when Apple
   * says it has never heard of the transaction. TestFlight and simulator
   * purchases only exist in sandbox, so without the fallback every internal
   * tester looks like a fraudster — and hardcoding sandbox would let a real
   * user unlock premium with a sandbox receipt.
   */
  environment?: 'production' | 'sandbox' | 'auto';
  /** Override for tests. */
  fetchImpl?: typeof fetch;
}

/** Apple's decoded transaction payload, as far as billing cares. */
export interface AppleTransaction {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  bundleId?: string;
  /** Milliseconds since epoch. */
  purchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  revocationReason?: number;
  type?: string;
  environment?: string;
  inAppOwnershipType?: string;
  [key: string]: unknown;
}

/**
 * Apple's subscription status codes.
 *
 * The mapping that matters is 3 vs 4. Both mean a payment failed, but in
 * a grace period (4) the user still has access while Apple retries, and in
 * plain billing retry (3) they do not. Collapsing them would either cut off
 * paying customers or keep serving people whose payment never recovered.
 */
const STATUS_BY_CODE: Record<number, PurchaseStatus> = {
  1: 'active',
  2: 'expired',
  3: 'on_hold',
  4: 'grace',
  5: 'revoked',
};

export class AppleStore {
  private readonly fetchImpl: typeof fetch;
  private tokenCache?: { token: string; expiresAt: number };

  constructor(private readonly config: AppleConfig) {
    for (const field of ['keyId', 'issuerId', 'privateKey', 'bundleId'] as const) {
      if (!config?.[field]) {
        throw new Error(`AppleStore: "${field}" is required.`);
      }
    }
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('AppleStore: no global fetch available — pass `fetchImpl`.');
    }
  }

  /**
   * Verify one transaction id and produce the record for
   * `billing.recordPurchase()`.
   *
   * For an auto-renewable subscription this also reads the CURRENT
   * subscription status, so a transaction id captured at purchase time
   * still yields the right answer months later — the device's copy of a
   * receipt cannot tell you whether the sub was since cancelled or refunded.
   */
  async verify(input: { userId: string; transactionId: string }): Promise<RecordPurchaseInput> {
    const userId = requireField('verify', 'userId', input?.userId);
    const transactionId = requireField('verify', 'transactionId', input?.transactionId);

    const { transaction, host } = await this.lookupTransaction(transactionId);
    this.assertBundle(transaction);

    const isSubscription = transaction.type === 'Auto-Renewable Subscription';
    let status: PurchaseStatus = 'active';
    let autoRenewing = false;
    // The looked-up id may be months old — a subscription's CURRENT state
    // lives on the latest transaction in the chain, so prefer that when the
    // status endpoint supplies it.
    let effective = transaction;

    if (isSubscription) {
      const current = await this.subscriptionStatus(transaction.originalTransactionId, host);
      status = current.status;
      autoRenewing = current.autoRenewing;
      if (current.transaction) effective = current.transaction;
    }
    // A revocation beats any status: the money went back. Checked on both
    // payloads and in the deny direction — whichever one reports it, access
    // stops.
    if (isRevoked(transaction) || isRevoked(effective)) status = 'refunded';

    return toRecordInput(userId, effective, status, autoRenewing, environmentOf(host));
  }

  /**
   * Every transaction Apple knows for this customer — the "Restore
   * Purchases" path, and the only correct answer after a reinstall.
   */
  async restore(input: {
    userId: string;
    originalTransactionId: string;
  }): Promise<RecordPurchaseInput[]> {
    const userId = requireField('restore', 'userId', input?.userId);
    const chainId = requireField('restore', 'originalTransactionId', input?.originalTransactionId);

    const { body, host } = await this.request(
      `/inApps/v1/subscriptions/${encodeURIComponent(chainId)}`,
    );
    const groups = Array.isArray(body?.data) ? body.data : [];
    const records: RecordPurchaseInput[] = [];

    for (const group of groups as Array<Record<string, unknown>>) {
      const lastTransactions = Array.isArray(group?.lastTransactions)
        ? (group.lastTransactions as Array<Record<string, unknown>>)
        : [];
      for (const entry of lastTransactions) {
        const signed = entry?.signedTransactionInfo;
        if (typeof signed !== 'string') continue;
        const transaction = decodeJwsPayloadUnverified<AppleTransaction>(signed);
        const status =
          typeof transaction.revocationDate === 'number'
            ? 'refunded'
            : (STATUS_BY_CODE[Number(entry.status)] ?? 'expired');
        const renewal = readRenewalInfo(entry);
        records.push(
          toRecordInput(userId, transaction, status, renewal.autoRenewing, environmentOf(host)),
        );
      }
    }
    return records;
  }

  /** Fetch and decode one transaction, remembering which host answered. */
  private async lookupTransaction(
    transactionId: string,
  ): Promise<{ transaction: AppleTransaction; host: string }> {
    const { body, host } = await this.request(
      `/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
    );
    const signed = body?.signedTransactionInfo;
    if (typeof signed !== 'string') {
      throw new Error('AppleStore.verify: Apple returned no signedTransactionInfo.');
    }
    return { transaction: decodeJwsPayloadUnverified<AppleTransaction>(signed), host };
  }

  /** Current status of a subscription chain. */
  private async subscriptionStatus(
    originalTransactionId: string,
    host: string,
  ): Promise<{ status: PurchaseStatus; autoRenewing: boolean; transaction?: AppleTransaction }> {
    const { body } = await this.request(
      `/inApps/v1/subscriptions/${encodeURIComponent(originalTransactionId)}`,
      host,
    );
    const groups = Array.isArray(body?.data) ? (body.data as Array<Record<string, unknown>>) : [];
    for (const group of groups) {
      const entries = Array.isArray(group?.lastTransactions)
        ? (group.lastTransactions as Array<Record<string, unknown>>)
        : [];
      const entry = entries.find(
        (candidate) => candidate?.originalTransactionId === originalTransactionId,
      );
      if (!entry) continue;
      const signed = entry.signedTransactionInfo;
      return {
        status: STATUS_BY_CODE[Number(entry.status)] ?? 'expired',
        autoRenewing: readRenewalInfo(entry).autoRenewing,
        transaction:
          typeof signed === 'string'
            ? decodeJwsPayloadUnverified<AppleTransaction>(signed)
            : undefined,
      };
    }
    // Apple knows the transaction but reports no subscription group for it:
    // treat as expired rather than assuming access.
    return { status: 'expired', autoRenewing: false };
  }

  /**
   * GET an App Store Server API path, handling the production/sandbox
   * split. When `host` is given the environment is already settled (a
   * follow-up call in the same flow) and no fallback is attempted.
   */
  private async request(
    path: string,
    host?: string,
  ): Promise<{ body: Record<string, unknown>; host: string }> {
    const hosts = host ? [host] : this.candidateHosts();
    let lastNotFound: string | undefined;

    for (const candidate of hosts) {
      const response = await this.fetchImpl(`${candidate}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${await this.bearerToken()}`,
          Accept: 'application/json',
        },
      });
      if (response.status === 404) {
        // Not in this environment — try the other one before giving up.
        lastNotFound = candidate;
        continue;
      }
      if (!response.ok) {
        const detail = await safeText(response);
        throw new Error(
          `AppleStore: App Store Server API returned ${response.status}${
            detail ? ` — ${detail}` : ''
          }`,
        );
      }
      return { body: (await response.json()) as Record<string, unknown>, host: candidate };
    }

    throw new Error(
      `AppleStore: transaction not found in ${
        lastNotFound && hosts.length > 1 ? 'production or sandbox' : 'the configured environment'
      }.`,
    );
  }

  private candidateHosts(): string[] {
    switch (this.config.environment) {
      case 'production':
        return [PRODUCTION_HOST];
      case 'sandbox':
        return [SANDBOX_HOST];
      default:
        return [PRODUCTION_HOST, SANDBOX_HOST];
    }
  }

  /**
   * The ES256 JWT Apple wants, cached until shortly before it expires.
   * Signing is cheap but not free, and this runs on every verification.
   */
  private async bearerToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.tokenCache && this.tokenCache.expiresAt - 60 > now) return this.tokenCache.token;

    const key = await importEs256PrivateKey(this.config.privateKey);
    const expiresAt = now + TOKEN_TTL_SECONDS;
    const token = await signJwt(
      { alg: 'ES256', kid: this.config.keyId, typ: 'JWT' },
      {
        iss: this.config.issuerId,
        iat: now,
        exp: expiresAt,
        aud: AUDIENCE,
        bid: this.config.bundleId,
      },
      key,
    );
    this.tokenCache = { token, expiresAt };
    return token;
  }

  /**
   * A transaction for a DIFFERENT app is not ours to honour. Apple scopes
   * the API key to a team, not to one bundle, so this is the check that
   * stops a receipt from a sibling app unlocking this one.
   */
  private assertBundle(transaction: AppleTransaction): void {
    if (transaction.bundleId && transaction.bundleId !== this.config.bundleId) {
      throw new Error(
        `AppleStore: transaction belongs to bundle "${transaction.bundleId}", not "${this.config.bundleId}".`,
      );
    }
  }
}

/* ── helpers ───────────────────────────────────────────────────────────── */

function readRenewalInfo(entry: Record<string, unknown>): { autoRenewing: boolean } {
  const signed = entry?.signedRenewalInfo;
  if (typeof signed !== 'string') return { autoRenewing: false };
  try {
    const renewal = decodeJwsPayloadUnverified<Record<string, unknown>>(signed);
    return { autoRenewing: Number(renewal.autoRenewStatus) === 1 };
  } catch {
    // Renewal info is a nice-to-have; never fail a verification over it.
    return { autoRenewing: false };
  }
}

/** Normalize Apple's decoded transaction into the SDK's purchase shape. */
export function toRecordInput(
  userId: string,
  transaction: AppleTransaction,
  status: PurchaseStatus,
  autoRenewing: boolean,
  environment?: string,
): RecordPurchaseInput {
  return {
    userId,
    platform: 'apple',
    productId: transaction.productId,
    originalTransactionId: transaction.originalTransactionId,
    transactionId: transaction.transactionId,
    status,
    purchasedAt: msToIso(transaction.purchaseDate),
    expiresAt: msToIso(transaction.expiresDate),
    autoRenewing,
    environment: environment ?? (transaction.environment ?? 'Production').toLowerCase(),
    raw: transaction as Record<string, unknown>,
  };
}

/** Apple sends epoch milliseconds; the SDK stores ISO strings. */
export function msToIso(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}

/**
 * Which Apple environment a purchase belongs to.
 *
 * Taken from the host that ANSWERED rather than the `environment` field in
 * the payload: the host is what the request actually reached, and it cannot
 * be stale or absent. A sandbox purchase must never unlock production.
 */
export function environmentOf(host: string): string {
  return host === SANDBOX_HOST ? 'sandbox' : 'production';
}

function isRevoked(transaction: AppleTransaction): boolean {
  return typeof transaction.revocationDate === 'number';
}

function requireField(method: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`AppleStore.${method}: "${field}" must be a non-empty string.`);
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
