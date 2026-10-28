import { storeOffer } from './offers';

describe('storeOffer — Apple', () => {
  it('an introductory FREE_TRIAL transaction is the store trial', () => {
    expect(storeOffer({ platform: 'apple', raw: { offerType: 1, offerDiscountType: 'FREE_TRIAL' }, auto_renewing: true })).toEqual({
      isStoreTrial: true,
      period: 'free_trial',
      offerId: null,
      willRenew: true,
    });
  });

  it('an older payload without a discount type and no price is still the trial', () => {
    expect(storeOffer({ platform: 'apple', raw: { offerType: 1 } }).isStoreTrial).toBe(true);
  });

  it('a paid introductory price is not a free trial', () => {
    expect(storeOffer({ platform: 'apple', raw: { offerType: 1, offerDiscountType: 'PAY_AS_YOU_GO' } })).toMatchObject({
      isStoreTrial: false,
      period: 'intro_price',
    });
  });

  it('a free promotional or offer-code transaction is not the intro trial', () => {
    expect(storeOffer({ platform: 'apple', raw: { offerType: 2, offerDiscountType: 'FREE_TRIAL', offerIdentifier: 'winback' } })).toMatchObject({
      isStoreTrial: false,
      period: 'promotional',
      offerId: 'winback',
    });
  });

  it('the renewal after the trial is a plain transaction', () => {
    expect(storeOffer({ platform: 'apple', raw: { type: 'Auto-Renewable Subscription' }, auto_renewing: false })).toEqual({
      isStoreTrial: false,
      period: 'base',
      offerId: null,
      willRenew: false,
    });
  });
});

describe('storeOffer — Google', () => {
  const line = (over: Record<string, unknown>) => ({ offerDetails: { basePlanId: 'yearly', offerId: 'free-trial' }, ...over });

  it('offerPhase.freeTrial is the store trial', () => {
    const raw = { lineItems: [line({ offerPhase: { freeTrial: {} }, autoRenewingPlan: { autoRenewEnabled: true } })] };
    expect(storeOffer({ platform: 'google', raw })).toEqual({ isStoreTrial: true, period: 'free_trial', offerId: 'free-trial', willRenew: true });
  });

  it('offerPhase.basePrice after the trial is not', () => {
    const raw = { lineItems: [line({ offerPhase: { basePrice: {} } })] };
    expect(storeOffer({ platform: 'google', raw })).toMatchObject({ isStoreTrial: false, period: 'base' });
  });

  it('without offerPhase: bought through an offer and still on the first order → trial', () => {
    const raw = { latestOrderId: 'GPA.3312-1234-5678-90123', lineItems: [line({})] };
    expect(storeOffer({ platform: 'google', raw }).isStoreTrial).toBe(true);
  });

  it('without offerPhase: a renewal order (..0) means it converted', () => {
    const raw = { latestOrderId: 'GPA.3312-1234-5678-90123..0', lineItems: [line({})] };
    expect(storeOffer({ platform: 'google', raw }).isStoreTrial).toBe(false);
  });

  it('a base plan with no offer is never a trial, and willRenew follows the line item', () => {
    const raw = { latestOrderId: 'GPA.1-2-3-4', lineItems: [{ offerDetails: { basePlanId: 'monthly' }, autoRenewingPlan: { autoRenewEnabled: false } }] };
    expect(storeOffer({ platform: 'google', raw })).toEqual({ isStoreTrial: false, period: 'base', offerId: null, willRenew: false });
  });
});

describe('storeOffer — other', () => {
  it('stripe and empty payloads are plain', () => {
    expect(storeOffer({ platform: 'stripe', raw: {} }).isStoreTrial).toBe(false);
    expect(storeOffer({ platform: 'google', raw: null }).isStoreTrial).toBe(false);
  });
});

import { classifyPurchaseChange } from './offers';

describe('classifyPurchaseChange', () => {
  const MONTH = (n: number) => new Date(Date.UTC(2027, n, 1)).toISOString();
  const trial = { platform: 'apple' as const, status: 'active', expires_at: MONTH(0), transaction_id: 't1', auto_renewing: true, raw: { offerType: 1, offerDiscountType: 'FREE_TRIAL' } };
  const paid = (over: Record<string, unknown> = {}) => ({ platform: 'apple' as const, status: 'active', expires_at: MONTH(1), transaction_id: 't2', auto_renewing: true, raw: {}, ...over });

  it('a first sighting: trial_started or started', () => {
    expect(classifyPurchaseChange(null, trial)).toBe('trial_started');
    expect(classifyPurchaseChange(null, paid())).toBe('started');
  });
  it('trial → first charge is trial_converted, not renewed', () => {
    expect(classifyPurchaseChange(trial, paid())).toBe('trial_converted');
  });
  it('a later renewal is renewed', () => {
    expect(classifyPurchaseChange(paid(), paid({ transaction_id: 't3', expires_at: MONTH(2) }))).toBe('renewed');
  });
  it('auto-renew switched off / on', () => {
    expect(classifyPurchaseChange(paid(), paid({ auto_renewing: false }))).toBe('cancelled');
    expect(classifyPurchaseChange(paid({ auto_renewing: false }), paid())).toBe('reactivated');
    expect(classifyPurchaseChange(trial, { ...trial, auto_renewing: false })).toBe('cancelled');
  });
  it('status moves', () => {
    expect(classifyPurchaseChange(paid(), paid({ status: 'grace' }))).toBe('grace');
    expect(classifyPurchaseChange(paid(), paid({ status: 'on_hold' }))).toBe('billing_retry');
    expect(classifyPurchaseChange(paid({ status: 'grace' }), paid({ transaction_id: 't3', expires_at: MONTH(2) }))).toBe('recovered');
    expect(classifyPurchaseChange(paid(), paid({ status: 'expired' }))).toBe('expired');
    expect(classifyPurchaseChange(trial, { ...trial, status: 'expired' })).toBe('expired');
    expect(classifyPurchaseChange(paid(), paid({ status: 'refunded' }))).toBe('refunded');
  });
  it('nothing changed', () => {
    expect(classifyPurchaseChange(paid(), paid())).toBe('unchanged');
  });
});
