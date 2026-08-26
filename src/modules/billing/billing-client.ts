import { Migration } from '../../migrations/types';
import { defineModule, ModuleContext } from '../core';
import {
  fail,
  generateId,
  nowIso,
  optionalNumber,
  optionalPlainObject,
  requireNonEmptyString,
} from '../util';
import {
  BillingEvent,
  BillingPlatform,
  BillingProduct,
  DefineProductInput,
  Entitlement,
  EntitlementCheck,
  EntitlementSource,
  EntitlementStatus,
  GrantInput,
  ListProductsOptions,
  ListPurchasesOptions,
  ProductKind,
  Purchase,
  PurchaseStatus,
  StartTrialInput,
} from './types';

export const BILLING_TABLES = {
  PRODUCTS: 'billing__products',
  PURCHASES: 'billing__purchases',
  ENTITLEMENTS: 'billing__entitlements',
  EVENTS: 'billing__events',
} as const;

export const BILLING_MIGRATIONS: Migration[] = [
  {
    id: 'billing/0001_create_billing__products',
    sql: `CREATE TABLE IF NOT EXISTS ${BILLING_TABLES.PRODUCTS} (
  id uuid PRIMARY KEY,
  product_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('apple', 'google', 'stripe')),
  entitlement text NOT NULL,
  kind text NOT NULL DEFAULT 'subscription' CHECK (kind IN ('subscription', 'non_consumable', 'consumable')),
  period text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    // The store product id is only unique WITHIN a store — the same
    // "premium.monthly" string is a different product on Apple and Google.
    id: 'billing/0002_unique_billing__products_platform_product',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS billing__products_platform_product_idx
  ON ${BILLING_TABLES.PRODUCTS} (platform, product_id)`,
  },
  {
    id: 'billing/0003_create_billing__purchases',
    sql: `CREATE TABLE IF NOT EXISTS ${BILLING_TABLES.PURCHASES} (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('apple', 'google', 'stripe')),
  product_id text NOT NULL,
  transaction_id text NOT NULL,
  original_transaction_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'grace', 'on_hold', 'expired', 'refunded', 'revoked', 'pending')),
  purchased_at timestamptz,
  expires_at timestamptz,
  auto_renewing boolean NOT NULL DEFAULT false,
  environment text NOT NULL DEFAULT 'production',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    // THE idempotency guarantee. A renewal, a restore on a new device and a
    // retried webhook all carry the same chain id, so they update one row
    // instead of granting the user a second subscription. Enforced by the
    // database because application-level checks lose the race.
    id: 'billing/0004_unique_billing__purchases_chain',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS billing__purchases_chain_idx
  ON ${BILLING_TABLES.PURCHASES} (platform, original_transaction_id)`,
  },
  {
    id: 'billing/0005_index_billing__purchases_user',
    sql: `CREATE INDEX IF NOT EXISTS billing__purchases_user_idx
  ON ${BILLING_TABLES.PURCHASES} (user_id, status)`,
  },
  {
    id: 'billing/0006_create_billing__entitlements',
    sql: `CREATE TABLE IF NOT EXISTS ${BILLING_TABLES.ENTITLEMENTS} (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  entitlement text NOT NULL,
  source text NOT NULL DEFAULT 'purchase' CHECK (source IN ('purchase', 'trial', 'grant')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  expires_at timestamptz,
  purchase_id uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    // One row per (user, entitlement): the CURRENT answer, not a history.
    // History lives in billing__purchases and billing__events.
    id: 'billing/0007_unique_billing__entitlements_user_key',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS billing__entitlements_user_key_idx
  ON ${BILLING_TABLES.ENTITLEMENTS} (user_id, entitlement)`,
  },
  {
    id: 'billing/0008_create_billing__events',
    sql: `CREATE TABLE IF NOT EXISTS ${BILLING_TABLES.EVENTS} (
  id uuid PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('apple', 'google', 'stripe')),
  notification_type text NOT NULL,
  original_transaction_id text,
  event_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    // Replay protection: the stores retry notifications for days, and both
    // stamp each one with an id. A duplicate must be a no-op.
    id: 'billing/0009_unique_billing__events_event',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS billing__events_event_idx
  ON ${BILLING_TABLES.EVENTS} (platform, event_id)`,
  },
];

const PLATFORMS: BillingPlatform[] = ['apple', 'google', 'stripe'];
const PRODUCT_KINDS: ProductKind[] = ['subscription', 'non_consumable', 'consumable'];
const PURCHASE_STATUSES: PurchaseStatus[] = [
  'active',
  'grace',
  'on_hold',
  'expired',
  'refunded',
  'revoked',
  'pending',
];
const ENTITLEMENT_SOURCES: EntitlementSource[] = ['purchase', 'trial', 'grant'];

/**
 * Purchase statuses that SHOULD still grant access.
 *
 * `grace` is included deliberately: the store is retrying a failed payment
 * and the user has done nothing wrong. Cutting them off during the retry
 * window is the single most common way a subscription app generates angry
 * reviews and needless churn. `on_hold` — retries exhausted — does not.
 */
const ACCESS_GRANTING: PurchaseStatus[] = ['active', 'grace'];

const MS_PER_DAY = 86_400_000;

/**
 * billing module client — in-app purchases and the entitlements they grant.
 *
 * The shape of the problem: Apple and Google each have their own product
 * ids, their own transaction identifiers, their own renewal semantics and
 * their own notification formats — but an app only ever wants to ask one
 * question, "may this user do this?". So verification writes normalized
 * rows into `billing__purchases`, purchases project onto
 * `billing__entitlements`, and the app reads `check()`.
 *
 *   await billing.defineProduct({
 *     productId: 'com.acme.premium.monthly', platform: 'apple',
 *     entitlement: 'premium', kind: 'subscription', period: 'monthly',
 *   });
 *   const { allowed, daysRemaining } = await billing.check(userId, 'premium');
 *
 * Trials and manual grants land in the same table as purchases, so a paywall
 * has exactly one thing to read no matter where access came from.
 *
 * This file is store-agnostic on purpose — no network, no Apple or Google
 * specifics. Those live in `apple.ts` / `google.ts` and hand their results
 * to `recordPurchase()`.
 */
export class BillingClient {
  constructor(private readonly ctx: ModuleContext) {}

  // ────────── Product catalog ──────────────────────────────────────────────

  /**
   * Register (or update) a store product and the entitlement it grants.
   * Idempotent on `(platform, productId)` so a deploy can re-declare the
   * whole catalog on every boot without accumulating duplicates.
   */
  async defineProduct(input: DefineProductInput): Promise<BillingProduct> {
    const context = 'BillingClient.defineProduct';
    const productId = requireNonEmptyString(context, 'productId', input?.productId);
    const platform = this.requirePlatform(context, input?.platform);
    const entitlement = requireNonEmptyString(context, 'entitlement', input?.entitlement);
    const kind = this.requireKind(context, input?.kind ?? 'subscription');
    const period = input?.period ?? null;
    if (period !== null && typeof period !== 'string') {
      fail(context, '"period" must be a string or null');
    }
    const active = input?.active ?? true;
    if (typeof active !== 'boolean') fail(context, '"active" must be a boolean');

    const existing = await this.findProduct(platform, productId);
    if (existing) {
      await this.ctx.query
        .from(BILLING_TABLES.PRODUCTS)
        .update({ entitlement, kind, period, active })
        .where('id', existing.id)
        .execute();
      return { ...existing, entitlement, kind, period, active };
    }

    const product: BillingProduct = {
      id: generateId(),
      product_id: productId,
      platform,
      entitlement,
      kind,
      period,
      active,
      created_at: nowIso(),
    };
    const { created_at: _omitted, ...row } = product;
    await this.ctx.query.from(BILLING_TABLES.PRODUCTS).insert(row).execute();
    return product;
  }

  async listProducts(options: ListProductsOptions = {}): Promise<BillingProduct[]> {
    let q = this.ctx.query.from(BILLING_TABLES.PRODUCTS);
    if (options.platform) q = q.where('platform', options.platform);
    if (options.entitlement) q = q.where('entitlement', options.entitlement);
    if (options.active !== 'all') q = q.where('active', options.active ?? true);
    return q.orderBy('product_id', 'ASC').rows<BillingProduct>();
  }

  /** The product record for a store id, or null when it was never declared. */
  async findProduct(
    platform: BillingPlatform,
    productId: string,
  ): Promise<BillingProduct | null> {
    const row = await this.ctx.query
      .from(BILLING_TABLES.PRODUCTS)
      .where('platform', platform)
      .where('product_id', productId)
      .first<BillingProduct>();
    return row ?? null;
  }

  // ────────── Purchases ────────────────────────────────────────────────────

  /**
   * Upsert a verified purchase and project it onto the user's entitlement.
   *
   * Called by the store adapters after THEY have established the purchase is
   * real. It performs no verification of its own — a caller reaching this
   * with unverified client input would be granting access on the client's
   * say-so, which is the classic IAP fraud.
   *
   * Idempotent on `(platform, originalTransactionId)`: a renewal, a restore
   * from a second device and a redelivered webhook all land on one row.
   */
  async recordPurchase(input: RecordPurchaseInput): Promise<Purchase> {
    const context = 'BillingClient.recordPurchase';
    const userId = requireNonEmptyString(context, 'userId', input?.userId);
    const platform = this.requirePlatform(context, input?.platform);
    const productId = requireNonEmptyString(context, 'productId', input?.productId);
    const originalTransactionId = requireNonEmptyString(
      context,
      'originalTransactionId',
      input?.originalTransactionId,
    );
    const transactionId = requireNonEmptyString(
      context,
      'transactionId',
      input?.transactionId ?? originalTransactionId,
    );
    const status = this.requireStatus(context, input?.status ?? 'active');
    const raw = optionalPlainObject(context, 'raw', input?.raw, {});
    const now = nowIso();

    const existing = await this.findPurchase(platform, originalTransactionId);
    const fields = {
      user_id: userId,
      product_id: productId,
      transaction_id: transactionId,
      status,
      purchased_at: input?.purchasedAt ?? existing?.purchased_at ?? now,
      expires_at: input?.expiresAt ?? null,
      auto_renewing: input?.autoRenewing ?? false,
      environment: input?.environment ?? 'production',
      raw,
      updated_at: now,
    };

    let purchase: Purchase;
    if (existing) {
      // A chain belongs to whoever first redeemed it. Silently reassigning
      // it to a second account is how one subscription gets shared across
      // many users, so the owner is never overwritten here.
      const owner = existing.user_id;
      await this.ctx.query
        .from(BILLING_TABLES.PURCHASES)
        .update({ ...fields, user_id: owner })
        .where('id', existing.id)
        .execute();
      purchase = { ...existing, ...fields, user_id: owner } as Purchase;
    } else {
      purchase = {
        id: generateId(),
        platform,
        original_transaction_id: originalTransactionId,
        created_at: now,
        ...fields,
      } as Purchase;
      const { created_at: _omitted, ...row } = purchase;
      await this.ctx.query.from(BILLING_TABLES.PURCHASES).insert(row).execute();
    }

    await this.projectEntitlement(purchase);
    return purchase;
  }

  /** The purchase for a store transaction chain, or null. */
  async findPurchase(
    platform: BillingPlatform,
    originalTransactionId: string,
  ): Promise<Purchase | null> {
    const row = await this.ctx.query
      .from(BILLING_TABLES.PURCHASES)
      .where('platform', platform)
      .where('original_transaction_id', originalTransactionId)
      .first<Purchase>();
    return row ?? null;
  }

  async listPurchases(userId: string, options: ListPurchasesOptions = {}): Promise<Purchase[]> {
    const context = 'BillingClient.listPurchases';
    requireNonEmptyString(context, 'userId', userId);
    let q = this.ctx.query.from(BILLING_TABLES.PURCHASES).where('user_id', userId);
    if (options.status) q = q.where('status', this.requireStatus(context, options.status));
    if (options.platform) q = q.where('platform', this.requirePlatform(context, options.platform));
    const limit = optionalNumber(context, 'limit', options.limit, 50);
    const offset = optionalNumber(context, 'offset', options.offset, 0);
    return q.orderBy('created_at', 'DESC').limit(limit).offset(offset).rows<Purchase>();
  }

  // ────────── Entitlements ─────────────────────────────────────────────────

  /**
   * May this user do this? The one question a paywall should ask.
   *
   * Expiry is evaluated at READ time rather than trusted from the stored
   * status, because nothing runs at the moment a subscription lapses — a
   * row saying `active` with a past `expires_at` is expired, and treating
   * it otherwise would hand out free access until some sweeper happened to
   * run.
   */
  async check(userId: string, entitlement: string): Promise<EntitlementCheck> {
    const context = 'BillingClient.check';
    requireNonEmptyString(context, 'userId', userId);
    const key = requireNonEmptyString(context, 'entitlement', entitlement);

    const row = await this.findEntitlement(userId, key);
    if (!row) {
      return {
        allowed: false,
        entitlement: key,
        source: null,
        status: 'none',
        expiresAt: null,
        daysRemaining: null,
        isTrial: false,
        reason: 'none',
      };
    }

    const expired = isExpired(row.expires_at);
    const allowed = row.status === 'active' && !expired;
    return {
      allowed,
      entitlement: key,
      source: row.source,
      status: expired && row.status === 'active' ? 'expired' : row.status,
      expiresAt: row.expires_at,
      daysRemaining: allowed ? daysUntil(row.expires_at) : null,
      isTrial: row.source === 'trial',
      reason: allowed ? null : expired ? 'expired' : row.status,
    };
  }

  /** Every entitlement row for a user, evaluated the same way as `check`. */
  async listEntitlements(userId: string): Promise<EntitlementCheck[]> {
    const context = 'BillingClient.listEntitlements';
    requireNonEmptyString(context, 'userId', userId);
    const rows = await this.ctx.query
      .from(BILLING_TABLES.ENTITLEMENTS)
      .where('user_id', userId)
      .orderBy('entitlement', 'ASC')
      .rows<Entitlement>();
    return rows.map((row) => {
      const expired = isExpired(row.expires_at);
      const allowed = row.status === 'active' && !expired;
      return {
        allowed,
        entitlement: row.entitlement,
        source: row.source,
        status: expired && row.status === 'active' ? 'expired' : row.status,
        expiresAt: row.expires_at,
        daysRemaining: allowed ? daysUntil(row.expires_at) : null,
        isTrial: row.source === 'trial',
        reason: allowed ? null : expired ? 'expired' : row.status,
      } as EntitlementCheck;
    });
  }

  /**
   * Grant an entitlement outright — a support gesture, a promo, a bundled
   * plan. `expiresAt` omitted means perpetual.
   */
  async grant(input: GrantInput): Promise<Entitlement> {
    const context = 'BillingClient.grant';
    const userId = requireNonEmptyString(context, 'userId', input?.userId);
    const entitlement = requireNonEmptyString(context, 'entitlement', input?.entitlement);
    const source = this.requireSource(context, input?.source ?? 'grant');
    const expiresAt = input?.expiresAt ?? null;
    if (expiresAt !== null && typeof expiresAt !== 'string') {
      fail(context, '"expiresAt" must be an ISO timestamp string or null');
    }
    return this.upsertEntitlement({
      userId,
      entitlement,
      source,
      status: 'active',
      expiresAt,
      purchaseId: input?.purchaseId ?? null,
    });
  }

  /**
   * Start a free trial, N days from now.
   *
   * Refuses when the user already has ANY row for this entitlement — a
   * trial is once per account, and re-granting on every launch is how
   * "7-day trial" quietly becomes "free forever". Call `check()` first and
   * only offer the trial when `status` is `'none'`.
   */
  async startTrial(input: StartTrialInput): Promise<Entitlement> {
    const context = 'BillingClient.startTrial';
    const userId = requireNonEmptyString(context, 'userId', input?.userId);
    const entitlement = requireNonEmptyString(context, 'entitlement', input?.entitlement);
    const days = optionalNumber(context, 'days', input?.days, 7);
    if (!Number.isFinite(days) || days <= 0) {
      fail(context, '"days" must be a positive number');
    }

    const existing = await this.findEntitlement(userId, entitlement);
    if (existing) {
      fail(
        context,
        `user already has a "${entitlement}" entitlement (source: ${existing.source}) — ` +
          'a trial can only be started once',
        // State, not bad input: the caller sent a valid request that the
        // account's existing entitlement refuses.
        'CONFLICT',
      );
    }

    const expiresAt = new Date(Date.now() + days * MS_PER_DAY).toISOString();
    return this.upsertEntitlement({
      userId,
      entitlement,
      source: 'trial',
      status: 'active',
      expiresAt,
      purchaseId: null,
    });
  }

  /** Revoke access now — refund, chargeback, abuse. Keeps the row for audit. */
  async revoke(userId: string, entitlement: string): Promise<void> {
    const context = 'BillingClient.revoke';
    requireNonEmptyString(context, 'userId', userId);
    requireNonEmptyString(context, 'entitlement', entitlement);
    await this.ctx.query
      .from(BILLING_TABLES.ENTITLEMENTS)
      .update({ status: 'revoked', updated_at: nowIso() })
      .where('user_id', userId)
      .where('entitlement', entitlement)
      .execute();
  }

  async findEntitlement(userId: string, entitlement: string): Promise<Entitlement | null> {
    const row = await this.ctx.query
      .from(BILLING_TABLES.ENTITLEMENTS)
      .where('user_id', userId)
      .where('entitlement', entitlement)
      .first<Entitlement>();
    return row ?? null;
  }

  // ────────── Store notifications ──────────────────────────────────────────

  /**
   * Record a store notification, or report that it has already been seen.
   *
   * Returns false for a replay. Apple retries for three days and Pub/Sub
   * redelivers at least once, so every notification arrives more than once
   * in normal operation — this is the guard that makes handling them safe.
   *
   * Check-then-insert, with the unique index on `(platform, event_id)` as
   * the real backstop: two simultaneous redeliveries can both pass the
   * check, and the second insert then fails at the database instead of
   * double-applying.
   */
  async recordEvent(input: {
    platform: BillingPlatform;
    notificationType: string;
    originalTransactionId?: string | null;
    eventId: string;
    payload?: Record<string, unknown>;
  }): Promise<boolean> {
    const context = 'BillingClient.recordEvent';
    const platform = this.requirePlatform(context, input?.platform);
    const eventId = requireNonEmptyString(context, 'eventId', input?.eventId);
    const notificationType = requireNonEmptyString(
      context,
      'notificationType',
      input?.notificationType,
    );

    if (await this.findEvent(platform, eventId)) return false;

    await this.ctx.query
      .from(BILLING_TABLES.EVENTS)
      .insert({
        id: generateId(),
        platform,
        notification_type: notificationType,
        original_transaction_id: input?.originalTransactionId ?? null,
        event_id: eventId,
        payload: optionalPlainObject(context, 'payload', input?.payload, {}),
      })
      .execute();
    return true;
  }

  /** A previously recorded notification, or null. */
  async findEvent(platform: BillingPlatform, eventId: string): Promise<BillingEvent | null> {
    const row = await this.ctx.query
      .from(BILLING_TABLES.EVENTS)
      .where('platform', platform)
      .where('event_id', eventId)
      .first<BillingEvent>();
    return row ?? null;
  }

  // ────────── Internals ────────────────────────────────────────────────────

  /**
   * Project a purchase onto the entitlement its product grants.
   *
   * Silently does nothing when the product was never declared: the purchase
   * is still recorded (so support can see it and a later `defineProduct` +
   * re-verify fixes it), but the SDK will not invent an entitlement name
   * out of a store id.
   */
  private async projectEntitlement(purchase: Purchase): Promise<void> {
    const product = await this.findProduct(purchase.platform, purchase.product_id);
    if (!product) return;

    const granting = ACCESS_GRANTING.includes(purchase.status);
    const status: EntitlementStatus =
      purchase.status === 'refunded' || purchase.status === 'revoked'
        ? 'revoked'
        : granting
          ? 'active'
          : 'expired';

    // A consumable or non-consumable never expires on its own; only a
    // subscription carries the store's expiry date.
    const expiresAt = product.kind === 'subscription' ? purchase.expires_at : null;

    const current = await this.findEntitlement(purchase.user_id, product.entitlement);
    // Do not let a lapsed purchase stomp a longer-lived grant (support gave
    // the user a year, then their monthly sub expired).
    if (
      current &&
      current.source === 'grant' &&
      current.status === 'active' &&
      !isExpired(current.expires_at) &&
      status !== 'active'
    ) {
      return;
    }

    await this.upsertEntitlement({
      userId: purchase.user_id,
      entitlement: product.entitlement,
      source: 'purchase',
      status,
      expiresAt,
      purchaseId: purchase.id,
    });
  }

  private async upsertEntitlement(input: {
    userId: string;
    entitlement: string;
    source: EntitlementSource;
    status: EntitlementStatus;
    expiresAt: string | null;
    purchaseId: string | null;
  }): Promise<Entitlement> {
    const now = nowIso();
    const existing = await this.findEntitlement(input.userId, input.entitlement);
    const fields = {
      source: input.source,
      status: input.status,
      expires_at: input.expiresAt,
      purchase_id: input.purchaseId,
      updated_at: now,
    };

    if (existing) {
      await this.ctx.query
        .from(BILLING_TABLES.ENTITLEMENTS)
        .update(fields)
        .where('id', existing.id)
        .execute();
      return { ...existing, ...fields } as Entitlement;
    }

    const record: Entitlement = {
      id: generateId(),
      user_id: input.userId,
      entitlement: input.entitlement,
      granted_at: now,
      ...fields,
    } as Entitlement;
    const { granted_at: _omitted, ...row } = record;
    await this.ctx.query.from(BILLING_TABLES.ENTITLEMENTS).insert(row).execute();
    return record;
  }

  private requirePlatform(context: string, value: unknown): BillingPlatform {
    if (!PLATFORMS.includes(value as BillingPlatform)) {
      fail(context, `"platform" must be one of ${PLATFORMS.join(', ')}`);
    }
    return value as BillingPlatform;
  }

  private requireKind(context: string, value: unknown): ProductKind {
    if (!PRODUCT_KINDS.includes(value as ProductKind)) {
      fail(context, `"kind" must be one of ${PRODUCT_KINDS.join(', ')}`);
    }
    return value as ProductKind;
  }

  private requireStatus(context: string, value: unknown): PurchaseStatus {
    if (!PURCHASE_STATUSES.includes(value as PurchaseStatus)) {
      fail(context, `"status" must be one of ${PURCHASE_STATUSES.join(', ')}`);
    }
    return value as PurchaseStatus;
  }

  private requireSource(context: string, value: unknown): EntitlementSource {
    if (!ENTITLEMENT_SOURCES.includes(value as EntitlementSource)) {
      fail(context, `"source" must be one of ${ENTITLEMENT_SOURCES.join(', ')}`);
    }
    return value as EntitlementSource;
  }
}

/** What a store adapter hands to `recordPurchase()` once it has verified. */
export interface RecordPurchaseInput {
  userId: string;
  platform: BillingPlatform;
  productId: string;
  /** Apple originalTransactionId / Google purchaseToken — the chain id. */
  originalTransactionId: string;
  /** Latest transaction in the chain. Defaults to the chain id. */
  transactionId?: string;
  status?: PurchaseStatus;
  purchasedAt?: string | null;
  expiresAt?: string | null;
  autoRenewing?: boolean;
  environment?: string;
  raw?: Record<string, unknown>;
}

/** Past its expiry. A null expiry is perpetual and never expires. */
export function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at <= Date.now();
}

/** Whole days until expiry, rounded up. Null when perpetual. */
export function daysUntil(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - Date.now()) / MS_PER_DAY));
}

export const billingModule = defineModule<BillingClient>({
  name: 'billing',
  migrations: BILLING_MIGRATIONS,
  factory: (ctx: ModuleContext) => new BillingClient(ctx),
});
