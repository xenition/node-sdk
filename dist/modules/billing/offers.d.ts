import type { BillingPlatform } from './types';
/**
 * What kind of period a store purchase is in RIGHT NOW, read from the store's
 * own payload (`Purchase.raw`).
 *
 * The SDK's `startTrial()` is a server-side trial; the stores have their own —
 * an introductory offer configured in App Store Connect / Play Console, where
 * the customer gives a payment method up front and is charged when it ends.
 * To the entitlement that is an ordinary purchase, so without this a paywall
 * cannot say "trial ends Friday", and analytics cannot tell a trial that
 * converted from a sale.
 *
 *   Apple   the latest transaction of the chain carries `offerType` 1
 *           (introductory) and `offerDiscountType` FREE_TRIAL; the renewal
 *           after the trial is a new transaction without them. Older payloads
 *           omit `offerDiscountType` — an introductory offer then counts as a
 *           free trial only when it has no price.
 *   Google  subscriptionsv2 `lineItems[].offerPhase.freeTrial` (Play Developer
 *           API, 2024+). When the phase is absent: bought through an offer and
 *           the latest order is still the first one — Play numbers every
 *           renewal order `<first order id>..N`.
 */
export type OfferPeriod = 'free_trial' | 'intro_price' | 'promotional' | 'base';
export interface StoreOffer {
    /** In the store's free intro period right now. */
    isStoreTrial: boolean;
    period: OfferPeriod;
    /** Apple offerIdentifier / Play offerId, when the purchase came through one. */
    offerId: string | null;
    /** Will it renew (or, in a trial, convert) at the end of this period? Null when the payload does not say. */
    willRenew: boolean | null;
}
export declare function storeOffer(purchase: {
    platform: BillingPlatform;
    raw?: Record<string, unknown> | null;
    auto_renewing?: boolean;
}): StoreOffer;
/**
 * What a store notification changed, from the purchase BEFORE and AFTER it
 * was re-read from the store. The stores' own notification types are
 * vocabulary that differs per store and per API version; this is the same
 * answer for both, derived from state, so a paywall or an analytics hook can
 * act on "the trial converted" without knowing that Apple calls it DID_RENEW
 * and Play SUBSCRIPTION_RENEWED.
 */
export type PurchaseEvent = 'trial_started' | 'started' | 'trial_converted' | 'renewed' | 'cancelled' | 'reactivated' | 'grace' | 'billing_retry' | 'recovered' | 'expired' | 'refunded' | 'revoked' | 'unchanged';
type Snapshot = {
    platform: BillingPlatform;
    status: string;
    expires_at?: string | null;
    transaction_id?: string;
    auto_renewing?: boolean;
    raw?: Record<string, unknown> | null;
};
export declare function classifyPurchaseChange(before: Snapshot | null, after: Snapshot): PurchaseEvent;
export {};
//# sourceMappingURL=offers.d.ts.map