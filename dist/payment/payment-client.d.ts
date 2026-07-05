import { HttpClient } from '../core/http-client';
import { CheckoutSessionInput, CheckoutSessionResult, PaymentConfig, PaymentConfigPatch, StripeInvoice, StripeSubscription } from './types';
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
export declare class PaymentClient {
    private readonly http;
    constructor(http: HttpClient);
    createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
    listInvoices(customerId?: string, limit?: number): Promise<StripeInvoice[]>;
    getInvoice(invoiceId: string): Promise<StripeInvoice>;
    listSubscriptions(customerId?: string, limit?: number): Promise<StripeSubscription[]>;
    getSubscription(subscriptionId: string): Promise<StripeSubscription>;
    cancelSubscription(subscriptionId: string): Promise<StripeSubscription>;
    resumeSubscription(subscriptionId: string): Promise<StripeSubscription>;
    getConfig(): Promise<PaymentConfig | null>;
    updateConfig(patch: PaymentConfigPatch): Promise<void>;
}
//# sourceMappingURL=payment-client.d.ts.map