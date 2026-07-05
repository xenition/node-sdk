export interface CheckoutSessionInput {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  mode?: 'payment' | 'subscription';
  quantity?: number;
  customerEmail?: string;
  metadata?: Record<string, string>;
  trialPeriodDays?: number;
}

export interface CheckoutSessionResult {
  id: string;
  url: string | null;
}

export interface PaymentConfig {
  provider: string;
  enabled: boolean;
  mode: string;
  publishableKey: string | null;
  stripeConnectAccountId: string | null;
}

export interface PaymentConfigPatch {
  publishableKey?: string;
  secretKey?: string;
  webhookSecret?: string;
  stripeConnectAccountId?: string;
  mode?: 'test' | 'live';
  enabled?: boolean;
}

// Stripe types are surfaced as `unknown` shapes to avoid shipping
// @stripe/stripe-js in the SDK. Callers who want strict typing can cast.
export type StripeInvoice = Record<string, unknown>;
export type StripeSubscription = Record<string, unknown>;
