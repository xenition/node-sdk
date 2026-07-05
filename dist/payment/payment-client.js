"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentClient = void 0;
const constants_1 = require("../constants");
/**
 * Stripe proxy. Per-app Checkout + subscriptions. The backend uses the
 * seller's configured Stripe account if set, else falls back to
 * xenition's platform account.
 *
 *   const session = await client.payment.createCheckoutSession({
 *     priceId: 'price_...',
 *     successUrl: 'https://app.example.com/success',
 *     cancelUrl: 'https://app.example.com/cancel',
 *     mode: 'subscription',
 *   });
 *   // redirect to session.url
 */
class PaymentClient {
    constructor(http) {
        this.http = http;
    }
    createCheckoutSession(input) {
        return this.http.post(constants_1.API_ENDPOINTS.PAYMENT.CHECKOUT, input);
    }
    listInvoices(customerId, limit) {
        const params = new URLSearchParams();
        if (customerId)
            params.set('customerId', customerId);
        if (limit !== undefined)
            params.set('limit', String(limit));
        const qs = params.toString();
        const url = qs
            ? `${constants_1.API_ENDPOINTS.PAYMENT.INVOICES}?${qs}`
            : constants_1.API_ENDPOINTS.PAYMENT.INVOICES;
        return this.http.get(url);
    }
    getInvoice(invoiceId) {
        return this.http.get(constants_1.API_ENDPOINTS.PAYMENT.INVOICE(invoiceId));
    }
    listSubscriptions(customerId, limit) {
        const params = new URLSearchParams();
        if (customerId)
            params.set('customerId', customerId);
        if (limit !== undefined)
            params.set('limit', String(limit));
        const qs = params.toString();
        const url = qs
            ? `${constants_1.API_ENDPOINTS.PAYMENT.SUBSCRIPTIONS}?${qs}`
            : constants_1.API_ENDPOINTS.PAYMENT.SUBSCRIPTIONS;
        return this.http.get(url);
    }
    getSubscription(subscriptionId) {
        return this.http.get(constants_1.API_ENDPOINTS.PAYMENT.SUBSCRIPTION(subscriptionId));
    }
    cancelSubscription(subscriptionId) {
        return this.http.post(constants_1.API_ENDPOINTS.PAYMENT.CANCEL_SUBSCRIPTION(subscriptionId));
    }
    resumeSubscription(subscriptionId) {
        return this.http.post(constants_1.API_ENDPOINTS.PAYMENT.RESUME_SUBSCRIPTION(subscriptionId));
    }
    getConfig() {
        return this.http.get(constants_1.API_ENDPOINTS.PAYMENT.CONFIG);
    }
    async updateConfig(patch) {
        await this.http.patch(constants_1.API_ENDPOINTS.PAYMENT.CONFIG, patch);
    }
}
exports.PaymentClient = PaymentClient;
//# sourceMappingURL=payment-client.js.map