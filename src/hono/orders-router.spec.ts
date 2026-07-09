import type { XenitionClient } from '../xenition-client';
import { ordersRouter } from './orders-router';

const makeClient = () => {
  const orders = { get: jest.fn(), getByNumber: jest.fn() };
  const use = jest.fn();
  const client = { modules: { use, orders } } as unknown as XenitionClient;
  return { client, orders, use };
};

const ORDER = {
  id: 'o1',
  number: 'XN-ABC123',
  email: 'Ada@Example.com',
  currency: 'USD',
  subtotal_cents: 6000,
  total_cents: 6000,
  status: 'paid',
  payment_provider: 'mock',
  payment_ref: 'mock_o1',
  cart_token: 'tok',
  data: {},
  created_at: 't0',
  items: [{ id: 'oi1', order_id: 'o1', variant_id: 'v1', quantity: 2, unit_price_cents: 2500, title: 'Tee', variant_title: 'M' }],
};

describe('GET /orders/:id', () => {
  it('returns the order + items camelCased (the id is the access token)', async () => {
    const { client, orders, use } = makeClient();
    orders.get.mockResolvedValue(ORDER);
    const res = await ordersRouter({ client }).request('/orders/o1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual(
      expect.objectContaining({ id: 'o1', number: 'XN-ABC123', subtotalCents: 6000, totalCents: 6000, paymentProvider: 'mock', cartToken: 'tok' }),
    );
    expect(body.items).toEqual([
      expect.objectContaining({ orderId: 'o1', variantId: 'v1', unitPriceCents: 2500, variantTitle: 'M' }),
    ]);
    expect(use).toHaveBeenCalledWith('orders');
  });

  it('404s an unknown order', async () => {
    const { client, orders } = makeClient();
    orders.get.mockResolvedValue(null);
    const res = await ordersRouter({ client }).request('/orders/ghost');
    expect(res.status).toBe(404);
    expect((await res.json() as any).error.code).toBe('NOT_FOUND');
  });
});

describe('GET /orders/by-number/:number', () => {
  it('returns the order when the email matches (case-insensitive)', async () => {
    const { client, orders } = makeClient();
    orders.getByNumber.mockResolvedValue(ORDER);
    const res = await ordersRouter({ client }).request('/orders/by-number/XN-ABC123?email=ada@example.com');
    expect(res.status).toBe(200);
    expect((await res.json() as any).number).toBe('XN-ABC123');
    expect(orders.getByNumber).toHaveBeenCalledWith('XN-ABC123');
  });

  it('404s a mismatched email (no leak of existence)', async () => {
    const { client, orders } = makeClient();
    orders.getByNumber.mockResolvedValue(ORDER);
    const res = await ordersRouter({ client }).request('/orders/by-number/XN-ABC123?email=someone@else.com');
    expect(res.status).toBe(404);
  });

  it('404s a missing email', async () => {
    const { client, orders } = makeClient();
    orders.getByNumber.mockResolvedValue(ORDER);
    const res = await ordersRouter({ client }).request('/orders/by-number/XN-ABC123');
    expect(res.status).toBe(404);
  });

  it('404s an unknown number', async () => {
    const { client, orders } = makeClient();
    orders.getByNumber.mockResolvedValue(null);
    const res = await ordersRouter({ client }).request('/orders/by-number/XN-NOPE00?email=ada@example.com');
    expect(res.status).toBe(404);
  });
});
