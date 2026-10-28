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

const NONE: StoreOffer = { isStoreTrial: false, period: 'base', offerId: null, willRenew: null };

export function storeOffer(purchase: { platform: BillingPlatform; raw?: Record<string, unknown> | null; auto_renewing?: boolean }): StoreOffer {
  const raw = (purchase.raw ?? {}) as Record<string, unknown>;
  if (purchase.platform === 'apple') return appleOffer(raw, purchase.auto_renewing);
  if (purchase.platform === 'google') return googleOffer(raw);
  return NONE;
}

function appleOffer(raw: Record<string, unknown>, autoRenewing: boolean | undefined): StoreOffer {
  const offerType = Number(raw.offerType);
  const discount = typeof raw.offerDiscountType === 'string' ? raw.offerDiscountType : null;
  const offerId = typeof raw.offerIdentifier === 'string' ? raw.offerIdentifier : null;
  const willRenew = typeof autoRenewing === 'boolean' ? autoRenewing : null;

  let period: OfferPeriod = 'base';
  if (offerType === 1) {
    const free = discount === 'FREE_TRIAL' || (discount === null && (raw.price === 0 || raw.price === undefined));
    period = free ? 'free_trial' : 'intro_price';
  } else if (offerType === 2 || offerType === 3 || offerType === 4) {
    // 2 promotional, 3 offer code, 4 win-back: a free one is still not THE trial.
    period = 'promotional';
  }
  return { isStoreTrial: period === 'free_trial', period, offerId, willRenew };
}

interface PlayLineItem {
  offerDetails?: { offerId?: string; basePlanId?: string; offerTags?: string[] };
  offerPhase?: { freeTrial?: unknown; introductoryPrice?: unknown; basePrice?: unknown; prorationPeriod?: unknown };
  autoRenewingPlan?: { autoRenewEnabled?: boolean };
}

function googleOffer(raw: Record<string, unknown>): StoreOffer {
  const lines = (Array.isArray(raw.lineItems) ? raw.lineItems : []) as PlayLineItem[];
  const line = lines[0];
  if (!line) return NONE;
  const offerId = line.offerDetails?.offerId ?? null;
  const renewing = lines.map((l) => l.autoRenewingPlan?.autoRenewEnabled).filter((v): v is boolean => typeof v === 'boolean');
  const willRenew = renewing.length > 0 ? renewing.some(Boolean) : null;

  let period: OfferPeriod;
  const phase = line.offerPhase;
  if (phase && typeof phase === 'object') {
    period = phase.freeTrial ? 'free_trial' : phase.introductoryPrice ? 'intro_price' : 'base';
  } else {
    // Older responses: an offer, still on its first order.
    const order = typeof raw.latestOrderId === 'string' ? raw.latestOrderId : '';
    period = offerId && order !== '' && !order.includes('..') ? 'free_trial' : 'base';
  }
  return { isStoreTrial: period === 'free_trial', period, offerId, willRenew };
}

/**
 * What a store notification changed, from the purchase BEFORE and AFTER it
 * was re-read from the store. The stores' own notification types are
 * vocabulary that differs per store and per API version; this is the same
 * answer for both, derived from state, so a paywall or an analytics hook can
 * act on "the trial converted" without knowing that Apple calls it DID_RENEW
 * and Play SUBSCRIPTION_RENEWED.
 */
export type PurchaseEvent =
  | 'trial_started'
  | 'started'
  | 'trial_converted'
  | 'renewed'
  | 'cancelled'
  | 'reactivated'
  | 'grace'
  | 'billing_retry'
  | 'recovered'
  | 'expired'
  | 'refunded'
  | 'revoked'
  | 'unchanged';

type Snapshot = {
  platform: BillingPlatform;
  status: string;
  expires_at?: string | null;
  transaction_id?: string;
  auto_renewing?: boolean;
  raw?: Record<string, unknown> | null;
};

export function classifyPurchaseChange(before: Snapshot | null, after: Snapshot): PurchaseEvent {
  const now = storeOffer(after);
  if (!before) return now.isStoreTrial ? 'trial_started' : after.status === 'active' ? 'started' : statusEvent(after.status) ?? 'unchanged';

  const was = storeOffer(before);
  if (after.status !== before.status) {
    if ((before.status === 'grace' || before.status === 'on_hold') && after.status === 'active') return 'recovered';
    const moved = statusEvent(after.status);
    if (moved) return moved;
  }
  if (after.status === 'active' || after.status === 'grace') {
    if (was.isStoreTrial && !now.isStoreTrial) return 'trial_converted';
    const renewedOn = after.transaction_id !== before.transaction_id || laterExpiry(before.expires_at, after.expires_at);
    if (renewedOn && !now.isStoreTrial) return 'renewed';
    const willNow = now.willRenew ?? after.auto_renewing ?? null;
    const willBefore = was.willRenew ?? before.auto_renewing ?? null;
    if (willBefore === true && willNow === false) return 'cancelled';
    if (willBefore === false && willNow === true) return 'reactivated';
  }
  return 'unchanged';
}

function statusEvent(status: string): PurchaseEvent | null {
  switch (status) {
    case 'expired':
      return 'expired';
    case 'refunded':
      return 'refunded';
    case 'revoked':
      return 'revoked';
    case 'grace':
      return 'grace';
    case 'on_hold':
      return 'billing_retry';
    default:
      return null;
  }
}

function laterExpiry(before: string | null | undefined, after: string | null | undefined): boolean {
  if (!before || !after) return false;
  return Date.parse(after) > Date.parse(before);
}
