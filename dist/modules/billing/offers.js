"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.storeOffer = storeOffer;
exports.classifyPurchaseChange = classifyPurchaseChange;
const NONE = { isStoreTrial: false, period: 'base', offerId: null, willRenew: null };
function storeOffer(purchase) {
    const raw = (purchase.raw ?? {});
    if (purchase.platform === 'apple')
        return appleOffer(raw, purchase.auto_renewing);
    if (purchase.platform === 'google')
        return googleOffer(raw);
    return NONE;
}
function appleOffer(raw, autoRenewing) {
    const offerType = Number(raw.offerType);
    const discount = typeof raw.offerDiscountType === 'string' ? raw.offerDiscountType : null;
    const offerId = typeof raw.offerIdentifier === 'string' ? raw.offerIdentifier : null;
    const willRenew = typeof autoRenewing === 'boolean' ? autoRenewing : null;
    let period = 'base';
    if (offerType === 1) {
        const free = discount === 'FREE_TRIAL' || (discount === null && (raw.price === 0 || raw.price === undefined));
        period = free ? 'free_trial' : 'intro_price';
    }
    else if (offerType === 2 || offerType === 3 || offerType === 4) {
        // 2 promotional, 3 offer code, 4 win-back: a free one is still not THE trial.
        period = 'promotional';
    }
    return { isStoreTrial: period === 'free_trial', period, offerId, willRenew };
}
function googleOffer(raw) {
    const lines = (Array.isArray(raw.lineItems) ? raw.lineItems : []);
    const line = lines[0];
    if (!line)
        return NONE;
    const offerId = line.offerDetails?.offerId ?? null;
    const renewing = lines.map((l) => l.autoRenewingPlan?.autoRenewEnabled).filter((v) => typeof v === 'boolean');
    const willRenew = renewing.length > 0 ? renewing.some(Boolean) : null;
    let period;
    const phase = line.offerPhase;
    if (phase && typeof phase === 'object') {
        period = phase.freeTrial ? 'free_trial' : phase.introductoryPrice ? 'intro_price' : 'base';
    }
    else {
        // Older responses: an offer, still on its first order.
        const order = typeof raw.latestOrderId === 'string' ? raw.latestOrderId : '';
        period = offerId && order !== '' && !order.includes('..') ? 'free_trial' : 'base';
    }
    return { isStoreTrial: period === 'free_trial', period, offerId, willRenew };
}
function classifyPurchaseChange(before, after) {
    const now = storeOffer(after);
    if (!before)
        return now.isStoreTrial ? 'trial_started' : after.status === 'active' ? 'started' : statusEvent(after.status) ?? 'unchanged';
    const was = storeOffer(before);
    if (after.status !== before.status) {
        if ((before.status === 'grace' || before.status === 'on_hold') && after.status === 'active')
            return 'recovered';
        const moved = statusEvent(after.status);
        if (moved)
            return moved;
    }
    if (after.status === 'active' || after.status === 'grace') {
        if (was.isStoreTrial && !now.isStoreTrial)
            return 'trial_converted';
        const renewedOn = after.transaction_id !== before.transaction_id || laterExpiry(before.expires_at, after.expires_at);
        if (renewedOn && !now.isStoreTrial)
            return 'renewed';
        const willNow = now.willRenew ?? after.auto_renewing ?? null;
        const willBefore = was.willRenew ?? before.auto_renewing ?? null;
        if (willBefore === true && willNow === false)
            return 'cancelled';
        if (willBefore === false && willNow === true)
            return 'reactivated';
    }
    return 'unchanged';
}
function statusEvent(status) {
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
function laterExpiry(before, after) {
    if (!before || !after)
        return false;
    return Date.parse(after) > Date.parse(before);
}
//# sourceMappingURL=offers.js.map