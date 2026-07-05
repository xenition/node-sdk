import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';
import {
  CheckoutSessionInput,
  CheckoutSessionResult,
  PaymentConfig,
  PaymentConfigPatch,
  StripeInvoice,
  StripeSubscription,
} from './types';

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
export class PaymentClient {
  constructor(private readonly http: HttpClient) {}

  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    return this.http.post<CheckoutSessionResult>(
      API_ENDPOINTS.PAYMENT.CHECKOUT,
      input,
    );
  }

  listInvoices(customerId?: string, limit?: number): Promise<StripeInvoice[]> {
    const params = new URLSearchParams();
    if (customerId) params.set('customerId', customerId);
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    const url = qs
      ? `${API_ENDPOINTS.PAYMENT.INVOICES}?${qs}`
      : API_ENDPOINTS.PAYMENT.INVOICES;
    return this.http.get<StripeInvoice[]>(url);
  }

  getInvoice(invoiceId: string): Promise<StripeInvoice> {
    return this.http.get<StripeInvoice>(API_ENDPOINTS.PAYMENT.INVOICE(invoiceId));
  }

  listSubscriptions(customerId?: string, limit?: number): Promise<StripeSubscription[]> {
    const params = new URLSearchParams();
    if (customerId) params.set('customerId', customerId);
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    const url = qs
      ? `${API_ENDPOINTS.PAYMENT.SUBSCRIPTIONS}?${qs}`
      : API_ENDPOINTS.PAYMENT.SUBSCRIPTIONS;
    return this.http.get<StripeSubscription[]>(url);
  }

  getSubscription(subscriptionId: string): Promise<StripeSubscription> {
    return this.http.get<StripeSubscription>(
      API_ENDPOINTS.PAYMENT.SUBSCRIPTION(subscriptionId),
    );
  }

  cancelSubscription(subscriptionId: string): Promise<StripeSubscription> {
    return this.http.post<StripeSubscription>(
      API_ENDPOINTS.PAYMENT.CANCEL_SUBSCRIPTION(subscriptionId),
    );
  }

  resumeSubscription(subscriptionId: string): Promise<StripeSubscription> {
    return this.http.post<StripeSubscription>(
      API_ENDPOINTS.PAYMENT.RESUME_SUBSCRIPTION(subscriptionId),
    );
  }

  getConfig(): Promise<PaymentConfig | null> {
    return this.http.get<PaymentConfig | null>(API_ENDPOINTS.PAYMENT.CONFIG);
  }

  async updateConfig(patch: PaymentConfigPatch): Promise<void> {
    await this.http.patch<void>(API_ENDPOINTS.PAYMENT.CONFIG, patch);
  }
}
