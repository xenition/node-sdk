import { createHmac } from 'crypto';
import type { XenitionClient } from '../xenition-client';
import { checkoutRouter, verifyStripeSignature } from './checkout-router';

const makeClient = () => {
  const orders = { createFromCart: jest.fn(), markPaid: jest.fn(), get: jest.fn() };
  const use = jest.fn();
  const client = { modules: { use, orders } } as unknown as XenitionClient;
  return { client, orders, use };
};

const ORDER = {
  id: 'o1',
  number: 'XN-ABC123',
  email: 'ada@example.com',
  currency: 'USD',
  subtotal_cents: 6000,
  total_cents: 6000,
  status: 'pending',
  payment_provider: null,
  payment_ref: null,
  cart_token: 'tok',
  data: {},
  created_at: 't0',
  items: [
    { id: 'oi1', order_id: 'o1', variant_id: 'v1', quantity: 2, unit_price_cents: 2500, title: 'Tee', variant_title: 'M' },
    { id: 'oi2', order_id: 'o1', variant_id: 'v2', quantity: 1, unit_price_cents: 1000, title: 'Cap', variant_title: null },
  ],
};
const PAID_ORDER = { ...ORDER, status: 'paid', payment_provider: 'mock', payment_ref: 'mock_o1' };

const post = (
  app: ReturnType<typeof checkoutRouter>,
  path: string,
  body: unknown,
  env: Record<string, string> = {},
  headers: Record<string, string> = {},
) =>
  app.request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    env,
  );

describe('POST /checkout/:cartToken — mock mode (default, SAFE)', () => {
  it('creates a pending order and returns a mock payUrl (no APP_URL → relative)', async () => {
    const { client, orders, use } = makeClient();
    orders.createFromCart.mockResolvedValue(ORDER);
    const res = await post(checkoutRouter({ client }), '/checkout/tok', { email: 'ada@example.com' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orderId: 'o1', mode: 'mock', payUrl: '/checkout/pay?order=o1' });
    expect(orders.createFromCart).toHaveBeenCalledWith('tok', { email: 'ada@example.com' });
    expect(use).toHaveBeenCalledWith('orders');
  });

  it('prefixes APP_URL when present', async () => {
    const { client, orders } = makeClient();
    orders.createFromCart.mockResolvedValue(ORDER);
    const res = await post(checkoutRouter({ client }), '/checkout/tok', { email: 'ada@example.com' }, {
      APP_URL: 'https://shop.example.com',
    });
    expect((await res.json() as any).payUrl).toBe('https://shop.example.com/checkout/pay?order=o1');
  });

  it('400s a non-object body', async () => {
    const { client } = makeClient();
    const res = await post(checkoutRouter({ client }), '/checkout/tok', 'hi');
    expect(res.status).toBe(400);
  });

  it('404s an unknown cart (SDK not-found message)', async () => {
    const { client, orders } = makeClient();
    orders.createFromCart.mockRejectedValue(new Error('OrdersClient.createFromCart: unknown cart "ghost"'));
    const res = await post(checkoutRouter({ client }), '/checkout/ghost', { email: 'a@b.co' });
    expect(res.status).toBe(404);
  });

  it("400s the SDK's validation message on a bad email", async () => {
    const { client, orders } = makeClient();
    orders.createFromCart.mockRejectedValue(new Error('OrdersClient.createFromCart: "email" must be a valid email address'));
    const res = await post(checkoutRouter({ client }), '/checkout/tok', { email: 'nope' });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.message).toContain('"email"');
  });
});

describe('POST /checkout/mock/complete', () => {
  it('marks the order paid via markPaid and returns the paid order camelCased', async () => {
    const { client, orders } = makeClient();
    orders.markPaid.mockResolvedValue(PAID_ORDER);
    const res = await post(checkoutRouter({ client }), '/checkout/mock/complete', { orderId: 'o1' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual(
      expect.objectContaining({ id: 'o1', status: 'paid', paymentProvider: 'mock', paymentRef: 'mock_o1' }),
    );
    expect(body.items).toHaveLength(2);
    expect(orders.markPaid).toHaveBeenCalledWith('o1', { provider: 'mock', ref: 'mock_o1' });
  });

  it('403s when COMMERCE_MODE=stripe (mock completion disabled)', async () => {
    const { client, orders } = makeClient();
    const res = await post(checkoutRouter({ client }), '/checkout/mock/complete', { orderId: 'o1' }, {
      COMMERCE_MODE: 'stripe',
    });
    expect(res.status).toBe(403);
    expect((await res.json() as any).error.code).toBe('FORBIDDEN');
    expect(orders.markPaid).not.toHaveBeenCalled();
  });

  it('400s a body without an orderId', async () => {
    const { client } = makeClient();
    const res = await post(checkoutRouter({ client }), '/checkout/mock/complete', {});
    expect(res.status).toBe(400);
  });
});

describe('POST /checkout/:cartToken — stripe mode', () => {
  const STRIPE_ENV = {
    COMMERCE_MODE: 'stripe',
    STRIPE_SECRET_KEY: 'sk_test_abc123',
    APP_URL: 'https://shop.example.com',
  };

  afterEach(() => jest.restoreAllMocks());

  it('creates a Stripe Checkout Session via raw fetch and returns session.url', async () => {
    const { client, orders } = makeClient();
    orders.createFromCart.mockResolvedValue(ORDER);
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' }), { status: 200 }),
    );

    const res = await post(checkoutRouter({ client }), '/checkout/tok', { email: 'ada@example.com' }, STRIPE_ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orderId: 'o1',
      mode: 'stripe',
      payUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk_test_abc123');
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const params = new URLSearchParams(init.body as string);
    expect(params.get('mode')).toBe('payment');
    expect(params.get('client_reference_id')).toBe('o1');
    expect(params.get('metadata[orderId]')).toBe('o1');
    expect(params.get('success_url')).toBe('https://shop.example.com/checkout/success?order=o1');
    expect(params.get('cancel_url')).toBe('https://shop.example.com/checkout/cancel?order=o1');
    // line 0
    expect(params.get('line_items[0][quantity]')).toBe('2');
    expect(params.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(params.get('line_items[0][price_data][unit_amount]')).toBe('2500');
    expect(params.get('line_items[0][price_data][product_data][name]')).toBe('Tee');
    // line 1
    expect(params.get('line_items[1][quantity]')).toBe('1');
    expect(params.get('line_items[1][price_data][unit_amount]')).toBe('1000');
  });

  it('honors custom successPath / cancelPath', async () => {
    const { client, orders } = makeClient();
    orders.createFromCart.mockResolvedValue(ORDER);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://checkout.stripe.com/x' }), { status: 200 }),
    );
    await post(checkoutRouter({ client }), '/checkout/tok', { email: 'a@b.co', successPath: '/thanks', cancelPath: '/oops' }, STRIPE_ENV);
    const init = (globalThis.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    const params = new URLSearchParams(init.body as string);
    expect(params.get('success_url')).toBe('https://shop.example.com/thanks?order=o1');
    expect(params.get('cancel_url')).toBe('https://shop.example.com/oops?order=o1');
  });

  it('never leaks the key: a failed Stripe call maps to a generic 500', async () => {
    const { client, orders } = makeClient();
    orders.createFromCart.mockResolvedValue(ORDER);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 402 }));
    const res = await post(checkoutRouter({ client }), '/checkout/tok', { email: 'a@b.co' }, STRIPE_ENV);
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('sk_test_abc123');
  });

  it('500s with a config error (no key leak) when STRIPE_SECRET_KEY is missing', async () => {
    const { client, orders } = makeClient();
    orders.createFromCart.mockResolvedValue(ORDER);
    const res = await post(checkoutRouter({ client }), '/checkout/tok', { email: 'a@b.co' }, { COMMERCE_MODE: 'stripe' });
    expect(res.status).toBe(500);
    expect((await res.json() as any).error.code).toBe('CONFIG_ERROR');
  });
});

describe('verifyStripeSignature', () => {
  const SECRET = 'whsec_testsecret';
  const PAYLOAD = '{"id":"evt_1","type":"checkout.session.completed"}';

  const sign = (payload: string, t: string, secret = SECRET): string => {
    const sig = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
    return `t=${t},v1=${sig}`;
  };

  it('accepts a correctly-signed payload', async () => {
    const header = sign(PAYLOAD, '1700000000');
    await expect(verifyStripeSignature(PAYLOAD, header, SECRET)).resolves.toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const header = sign(PAYLOAD, '1700000000');
    await expect(verifyStripeSignature(`${PAYLOAD} `, header, SECRET)).resolves.toBe(false);
  });

  it('rejects a signature made with the wrong secret', async () => {
    const header = sign(PAYLOAD, '1700000000', 'whsec_wrong');
    await expect(verifyStripeSignature(PAYLOAD, header, SECRET)).resolves.toBe(false);
  });

  it('rejects a missing or malformed header', async () => {
    await expect(verifyStripeSignature(PAYLOAD, undefined, SECRET)).resolves.toBe(false);
    await expect(verifyStripeSignature(PAYLOAD, 'garbage', SECRET)).resolves.toBe(false);
  });
});

describe('POST /checkout/webhook — stripe mode', () => {
  const SECRET = 'whsec_testsecret';
  const ENV = { COMMERCE_MODE: 'stripe', STRIPE_WEBHOOK_SECRET: SECRET };

  const signedPost = (app: ReturnType<typeof checkoutRouter>, payload: string, secret = SECRET) => {
    const t = '1700000000';
    const sig = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
    return post(app, '/checkout/webhook', payload, ENV, { 'stripe-signature': `t=${t},v1=${sig}` });
  };

  it('markPaid(provider:stripe) on a valid checkout.session.completed', async () => {
    const { client, orders } = makeClient();
    orders.markPaid.mockResolvedValue(PAID_ORDER);
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'o1', payment_intent: 'pi_123', metadata: { orderId: 'o1' } } },
    });
    const res = await signedPost(checkoutRouter({ client }), payload);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(orders.markPaid).toHaveBeenCalledWith('o1', { provider: 'stripe', ref: 'pi_123' });
  });

  it('rejects a tampered body with 400 and does NOT mark paid', async () => {
    const { client, orders } = makeClient();
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'o1' } } });
    const t = '1700000000';
    const sig = createHmac('sha256', SECRET).update(`${t}.${payload}`).digest('hex');
    // Send a DIFFERENT body than what was signed.
    const res = await post(checkoutRouter({ client }), '/checkout/webhook', payload + 'X', ENV, {
      'stripe-signature': `t=${t},v1=${sig}`,
    });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.code).toBe('INVALID_SIGNATURE');
    expect(orders.markPaid).not.toHaveBeenCalled();
  });

  it('ignores non-completion events (still 200, no markPaid)', async () => {
    const { client, orders } = makeClient();
    const payload = JSON.stringify({ type: 'payment_intent.created', data: { object: {} } });
    const res = await signedPost(checkoutRouter({ client }), payload);
    expect(res.status).toBe(200);
    expect(orders.markPaid).not.toHaveBeenCalled();
  });

  it('403s a webhook in mock mode', async () => {
    const { client } = makeClient();
    const res = await post(checkoutRouter({ client }), '/checkout/webhook', '{}', {}, { 'stripe-signature': 't=1,v1=x' });
    expect(res.status).toBe(403);
  });
});

describe('GET /checkout/order/:id', () => {
  it('returns the order + items camelCased', async () => {
    const { client, orders } = makeClient();
    orders.get.mockResolvedValue(PAID_ORDER);
    const res = await checkoutRouter({ client }).request('/checkout/order/o1');
    expect(res.status).toBe(200);
    expect((await res.json() as any).status).toBe('paid');
  });

  it('404s an unknown order', async () => {
    const { client, orders } = makeClient();
    orders.get.mockResolvedValue(null);
    const res = await checkoutRouter({ client }).request('/checkout/order/ghost');
    expect(res.status).toBe(404);
  });
});

describe('rate limiting', () => {
  it('rate limits the checkout create route', async () => {
    const { client, orders } = makeClient();
    orders.createFromCart.mockResolvedValue(ORDER);
    const app = checkoutRouter({ client, rateLimit: 1 });
    const ip = { 'cf-connecting-ip': '203.0.113.11' };
    expect((await post(app, '/checkout/tok', { email: 'a@b.co' }, {}, ip)).status).toBe(200);
    expect((await post(app, '/checkout/tok', { email: 'a@b.co' }, {}, ip)).status).toBe(429);
  });
});
