/**
 * Types for the billing module — mobile in-app purchases and the
 * entitlements they grant.
 *
 * Vocabulary, because the stores disagree with each other:
 *   - PRODUCT      a thing the store sells, addressed by `productId`
 *                  ("com.acme.premium.monthly").
 *   - PURCHASE     one verified transaction chain. Apple identifies it by
 *                  `originalTransactionId`, Google by `purchaseToken`; the
 *                  SDK calls both `originalTransactionId` so a renewal
 *                  updates the row it belongs to instead of creating a new
 *                  one. This is the idempotency key.
 *   - ENTITLEMENT  what the user may DO ("premium"). Products grant it,
 *                  trials grant it, support grants it. The app asks about
 *                  entitlements and never about products.
 */

/** Where a purchase came from. `stripe` is the web/card path. */
export type BillingPlatform = 'apple' | 'google' | 'stripe';

/** What kind of thing was sold — decides whether expiry is meaningful. */
export type ProductKind = 'subscription' | 'non_consumable' | 'consumable';

export interface BillingProduct {
  id: string;
  /** Store identifier, exactly as configured in App Store Connect / Play. */
  product_id: string;
  platform: BillingPlatform;
  /** Entitlement this product grants while its purchase is active. */
  entitlement: string;
  kind: ProductKind;
  /** Informational — 'monthly' / 'yearly' / null. Expiry comes from the store. */
  period: string | null;
  active: boolean;
  created_at: string;
}

export interface DefineProductInput {
  productId: string;
  platform: BillingPlatform;
  entitlement: string;
  kind?: ProductKind;
  period?: string | null;
  active?: boolean;
}

/**
 * Lifecycle of a purchase, normalized across both stores.
 *
 *   active    paid and current
 *   grace     payment failed, store is retrying, access SHOULD continue
 *   on_hold   payment failed, retry window over, access should stop
 *   expired   ran out and was not renewed
 *   refunded  money returned — access must stop
 *   revoked   pulled by the store (family sharing removed, chargeback)
 *   pending   awaiting a deferred payment method
 */
export type PurchaseStatus =
  | 'active'
  | 'grace'
  | 'on_hold'
  | 'expired'
  | 'refunded'
  | 'revoked'
  | 'pending';

export interface Purchase {
  id: string;
  user_id: string;
  platform: BillingPlatform;
  product_id: string;
  /** Most recent transaction in the chain. Changes on every renewal. */
  transaction_id: string;
  /** Stable id for the chain — Apple originalTransactionId, Google purchaseToken. */
  original_transaction_id: string;
  status: PurchaseStatus;
  purchased_at: string | null;
  /** Null for non-expiring products (non-consumable, consumable). */
  expires_at: string | null;
  auto_renewing: boolean;
  /** 'production' | 'sandbox' — sandbox purchases must never unlock production. */
  environment: string;
  /** Verbatim store payload, for support and audit. */
  raw: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Where an entitlement came from. */
export type EntitlementSource = 'purchase' | 'trial' | 'grant';

export type EntitlementStatus = 'active' | 'expired' | 'revoked';

export interface Entitlement {
  id: string;
  user_id: string;
  /** The capability name the app checks, e.g. 'premium'. */
  entitlement: string;
  source: EntitlementSource;
  status: EntitlementStatus;
  /** Null means perpetual (a lifetime unlock or an open-ended grant). */
  expires_at: string | null;
  /** The purchase backing this, when source is 'purchase'. */
  purchase_id: string | null;
  granted_at: string;
  updated_at: string;
}

/**
 * The answer the app actually wants. `allowed` is the ONLY field a paywall
 * should branch on; the rest is for showing "3 days left" and for support.
 */
export interface EntitlementCheck {
  allowed: boolean;
  entitlement: string;
  source: EntitlementSource | null;
  status: EntitlementStatus | 'none';
  expiresAt: string | null;
  /** Whole days remaining, rounded up. Null when perpetual or not allowed. */
  daysRemaining: number | null;
  /** True while this is a free trial rather than a paid purchase. */
  isTrial: boolean;
  /** Machine-readable why-not: 'expired' | 'revoked' | 'none'. */
  reason: string | null;
}

export interface GrantInput {
  userId: string;
  entitlement: string;
  /** ISO timestamp, or null/omitted for a perpetual grant. */
  expiresAt?: string | null;
  source?: EntitlementSource;
  purchaseId?: string | null;
}

export interface StartTrialInput {
  userId: string;
  entitlement: string;
  days: number;
}

export interface ListProductsOptions {
  platform?: BillingPlatform;
  entitlement?: string;
  /** Defaults to true — only sellable products. Pass 'all' for everything. */
  active?: boolean | 'all';
}

export interface ListPurchasesOptions {
  status?: PurchaseStatus;
  platform?: BillingPlatform;
  limit?: number;
  offset?: number;
}

/** A store notification already verified and recorded, for the audit trail. */
export interface BillingEvent {
  id: string;
  platform: BillingPlatform;
  notification_type: string;
  original_transaction_id: string | null;
  /** The store's own notification id — the replay-protection key. */
  event_id: string;
  payload: Record<string, unknown>;
  received_at: string;
}
