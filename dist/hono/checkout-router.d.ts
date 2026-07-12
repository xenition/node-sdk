import { Hono } from 'hono';
import type { XenitionRouterOptions } from './types';
/**
 * Checkout router — Worker-native payments with a SAFE default and a real
 * Stripe path. No `stripe` npm package: the Stripe API is called with raw
 * `fetch` and webhooks are verified with Web Crypto (`crypto.subtle`), so
 * this router runs unchanged on Cloudflare Workers and Node 20+.
 *
 * Worker env (read from the Hono context env with a `process.env` fallback):
 *   - COMMERCE_MODE       'mock' (default) | 'stripe'
 *   - STRIPE_SECRET_KEY   required in stripe mode
 *   - STRIPE_WEBHOOK_SECRET  required to verify webhooks
 *   - APP_URL             public site origin, for redirect URLs
 *
 * Routes:
 *   POST /checkout/:cartToken {email, successPath?, cancelPath?}
 *        → createFromCart (pending), then:
 *          mock   → { orderId, mode:'mock', payUrl:'<APP_URL>/checkout/pay?order=<id>' }
 *          stripe → { orderId, mode:'stripe', payUrl: session.url }
 *   POST /checkout/mock/complete {orderId}   (mock ONLY; 403 in stripe mode)
 *        → simulates the webhook: markPaid(provider:'mock') → the paid order.
 *   POST /checkout/webhook                   (stripe mode)
 *        → verifies the Stripe signature, then on `checkout.session.completed`
 *          markPaid(provider:'stripe'). Idempotent.
 *   GET  /checkout/order/:id                 → the order + items (or 404).
 *
 * MOCK MODE IS THE DEFAULT and needs no Stripe key — zero charge risk. Errors
 * are generic and never leak keys.
 */
export declare function checkoutRouter(options?: XenitionRouterOptions): Hono;
/**
 * Verify a Stripe webhook signature per Stripe's scheme:
 * `signed_payload = "<t>.<rawBody>"`, `v1 = HMAC_SHA256(secret,
 * signed_payload)` (hex). The `stripe-signature` header is
 * `t=<ts>,v1=<sig>[,v1=<sig2>…]`. Uses Web Crypto only (Worker + Node 20).
 */
export declare function verifyStripeSignature(payload: string, header: string | undefined, secret: string): Promise<boolean>;
//# sourceMappingURL=checkout-router.d.ts.map