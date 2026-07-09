import type { XenitionClient } from '../xenition-client';
import { cartRouter } from './cart-router';

const makeClient = () => {
  const cart = {
    getOrCreate: jest.fn(),
    getCart: jest.fn(),
    addItem: jest.fn(),
    updateItem: jest.fn(),
    removeItem: jest.fn(),
  };
  const use = jest.fn();
  const client = { modules: { use, cart } } as unknown as XenitionClient;
  return { client, cart, use };
};

const sendJson = (
  app: ReturnType<typeof cartRouter>,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const EMPTY_VIEW = { token: 'tok', currency: 'USD', items: [], subtotalCents: 0 };
const FILLED_VIEW = {
  token: 'tok',
  currency: 'USD',
  items: [{ id: 'it1', variantId: 'v1', quantity: 2, unitPriceCents: 2500, lineTotalCents: 5000 }],
  subtotalCents: 5000,
};

describe('POST /cart', () => {
  it('mints and persists a cart, returning 201 { token }', async () => {
    const { client, cart, use } = makeClient();
    cart.getOrCreate.mockImplementation((token: string) => Promise.resolve({ token }));
    const res = await sendJson(cartRouter({ client }), 'POST', '/cart', {});
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(10);
    expect(cart.getOrCreate).toHaveBeenCalledWith(body.token);
    expect(use).toHaveBeenCalledWith('cart');
  });
});

describe('GET /cart/:token', () => {
  it('returns the cart view (camelCase) with the subtotal', async () => {
    const { client, cart } = makeClient();
    cart.getCart.mockResolvedValue(FILLED_VIEW);
    const res = await cartRouter({ client }).request('/cart/tok');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FILLED_VIEW);
    expect(cart.getCart).toHaveBeenCalledWith('tok');
  });
});

describe('POST /cart/:token/items', () => {
  it('adds an item then returns the refreshed cart view', async () => {
    const { client, cart } = makeClient();
    cart.addItem.mockResolvedValue({ id: 'it1' });
    cart.getCart.mockResolvedValue(FILLED_VIEW);
    const res = await sendJson(cartRouter({ client }), 'POST', '/cart/tok/items', { variantId: 'v1', quantity: 2 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FILLED_VIEW);
    expect(cart.addItem).toHaveBeenCalledWith('tok', 'v1', 2);
    expect(cart.getCart).toHaveBeenCalledWith('tok');
  });

  it('400s a non-object body', async () => {
    const { client } = makeClient();
    const res = await sendJson(cartRouter({ client }), 'POST', '/cart/tok/items', 'hi');
    expect(res.status).toBe(400);
  });

  it("400s the SDK's validation message on a bad quantity", async () => {
    const { client, cart } = makeClient();
    cart.addItem.mockRejectedValue(new Error('CartClient.addItem: "quantity" must be an integer >= 1 — got "0"'));
    const res = await sendJson(cartRouter({ client }), 'POST', '/cart/tok/items', { variantId: 'v1', quantity: 0 });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.message).toContain('"quantity"');
  });
});

describe('PATCH /cart/:token/items/:itemId', () => {
  it('updates quantity then returns the refreshed cart view', async () => {
    const { client, cart } = makeClient();
    cart.updateItem.mockResolvedValue(undefined);
    cart.getCart.mockResolvedValue(EMPTY_VIEW);
    const res = await sendJson(cartRouter({ client }), 'PATCH', '/cart/tok/items/it1', { quantity: 0 });
    expect(res.status).toBe(200);
    expect(cart.updateItem).toHaveBeenCalledWith('tok', 'it1', 0);
  });

  it('400s a non-object body', async () => {
    const { client } = makeClient();
    const res = await sendJson(cartRouter({ client }), 'PATCH', '/cart/tok/items/it1', 5);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /cart/:token/items/:itemId', () => {
  it('removes the line then returns the refreshed cart view', async () => {
    const { client, cart } = makeClient();
    cart.removeItem.mockResolvedValue(undefined);
    cart.getCart.mockResolvedValue(EMPTY_VIEW);
    const res = await cartRouter({ client }).request('/cart/tok/items/it1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(EMPTY_VIEW);
    expect(cart.removeItem).toHaveBeenCalledWith('tok', 'it1');
  });
});

describe('rate limiting', () => {
  it('rate limits writes but never the GET', async () => {
    const { client, cart } = makeClient();
    cart.getOrCreate.mockImplementation((token: string) => Promise.resolve({ token }));
    cart.getCart.mockResolvedValue(EMPTY_VIEW);
    const app = cartRouter({ client, rateLimit: 1 });
    const ip = { 'cf-connecting-ip': '203.0.113.9' };
    expect((await sendJson(app, 'POST', '/cart', {}, ip)).status).toBe(201);
    expect((await sendJson(app, 'POST', '/cart', {}, ip)).status).toBe(429);
    // GETs stay unmetered.
    expect((await app.request('/cart/tok', { headers: ip })).status).toBe(200);
    expect((await app.request('/cart/tok', { headers: ip })).status).toBe(200);
  });
});
