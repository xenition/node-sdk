import { Migration } from '../../migrations/types';
import { ModuleContext } from '../core';
import { BillingEvent, BillingPlatform, BillingProduct, DefineProductInput, Entitlement, EntitlementCheck, GrantInput, ListProductsOptions, ListPurchasesOptions, Purchase, PurchaseStatus, StartTrialInput } from './types';
export declare const BILLING_TABLES: {
    readonly PRODUCTS: "billing__products";
    readonly PURCHASES: "billing__purchases";
    readonly ENTITLEMENTS: "billing__entitlements";
    readonly EVENTS: "billing__events";
};
export declare const BILLING_MIGRATIONS: Migration[];
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
export declare class BillingClient {
    private readonly ctx;
    constructor(ctx: ModuleContext);
    /**
     * Register (or update) a store product and the entitlement it grants.
     * Idempotent on `(platform, productId)` so a deploy can re-declare the
     * whole catalog on every boot without accumulating duplicates.
     */
    defineProduct(input: DefineProductInput): Promise<BillingProduct>;
    listProducts(options?: ListProductsOptions): Promise<BillingProduct[]>;
    /** The product record for a store id, or null when it was never declared. */
    findProduct(platform: BillingPlatform, productId: string): Promise<BillingProduct | null>;
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
    recordPurchase(input: RecordPurchaseInput): Promise<Purchase>;
    /** The purchase for a store transaction chain, or null. */
    findPurchase(platform: BillingPlatform, originalTransactionId: string): Promise<Purchase | null>;
    listPurchases(userId: string, options?: ListPurchasesOptions): Promise<Purchase[]>;
    /**
     * May this user do this? The one question a paywall should ask.
     *
     * Expiry is evaluated at READ time rather than trusted from the stored
     * status, because nothing runs at the moment a subscription lapses — a
     * row saying `active` with a past `expires_at` is expired, and treating
     * it otherwise would hand out free access until some sweeper happened to
     * run.
     */
    check(userId: string, entitlement: string): Promise<EntitlementCheck>;
    /** Every entitlement row for a user, evaluated the same way as `check`. */
    listEntitlements(userId: string): Promise<EntitlementCheck[]>;
    /**
     * Grant an entitlement outright — a support gesture, a promo, a bundled
     * plan. `expiresAt` omitted means perpetual.
     */
    grant(input: GrantInput): Promise<Entitlement>;
    /**
     * Start a free trial, N days from now.
     *
     * Refuses when the user already has ANY row for this entitlement — a
     * trial is once per account, and re-granting on every launch is how
     * "7-day trial" quietly becomes "free forever". Call `check()` first and
     * only offer the trial when `status` is `'none'`.
     */
    startTrial(input: StartTrialInput): Promise<Entitlement>;
    /** Revoke access now — refund, chargeback, abuse. Keeps the row for audit. */
    revoke(userId: string, entitlement: string): Promise<void>;
    findEntitlement(userId: string, entitlement: string): Promise<Entitlement | null>;
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
    recordEvent(input: {
        platform: BillingPlatform;
        notificationType: string;
        originalTransactionId?: string | null;
        eventId: string;
        payload?: Record<string, unknown>;
    }): Promise<boolean>;
    /** A previously recorded notification, or null. */
    findEvent(platform: BillingPlatform, eventId: string): Promise<BillingEvent | null>;
    /**
     * Project a purchase onto the entitlement its product grants.
     *
     * Silently does nothing when the product was never declared: the purchase
     * is still recorded (so support can see it and a later `defineProduct` +
     * re-verify fixes it), but the SDK will not invent an entitlement name
     * out of a store id.
     */
    private projectEntitlement;
    private upsertEntitlement;
    private requirePlatform;
    private requireKind;
    private requireStatus;
    private requireSource;
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
export declare function isExpired(expiresAt: string | null | undefined): boolean;
/** Whole days until expiry, rounded up. Null when perpetual. */
export declare function daysUntil(expiresAt: string | null | undefined): number | null;
export declare const billingModule: import("../core").ModuleDefinition<BillingClient>;
//# sourceMappingURL=billing-client.d.ts.map