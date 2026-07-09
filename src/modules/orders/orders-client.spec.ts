import { HttpClient } from '../../core/http-client';
import { MigrationsClient, MIGRATIONS_LEDGER_TABLE } from '../../migrations';
import { QueryClient } from '../../query/query-client';
import { QueryPayload } from '../../query/types';
import { CART_TABLES } from '../cart';
import { ModuleContext } from '../core';
import { InventoryClient } from '../inventory';
import { ModulesClient } from '../modules-client';
import { OrdersClient, ORDERS_TABLES } from './orders-client';

const makeOrders = () => {
  const post = jest.fn();
  const query = new QueryClient({ post } as unknown as HttpClient);
  const ctx: ModuleContext = { query, raw: (sql, params = []) => query.raw(sql, params) };
  return { post, orders: new OrdersClient(ctx) };
};

const payloadOf = (post: jest.Mock, call: number): QueryPayload =>
  post.mock.calls[call]![1] as QueryPayload;

const NUMBER_RE = /^XN-[A-Z0-9]{6}$/;

const CART_ROW = { id: 'cart_1', token: 'tok', currency: 'USD', status: 'open', created_at: 't0' };
const CART_ITEMS = [
  { id: 'ci1', variant_id: 'v1', quantity: 2, unit_price_cents: 2500, title: 'Tee', variant_title: 'M' },
  { id: 'ci2', variant_id: 'v2', quantity: 1, unit_price_cents: 1000, title: 'Cap', variant_title: null },
];

describe('createFromCart', () => {
  it('snapshots cart items into a pending order with total = subtotal', async () => {
    const { post, orders } = makeOrders();
    post
      .mockResolvedValueOnce({ data: [CART_ROW] }) // cart lookup
      .mockResolvedValueOnce({ data: CART_ITEMS }) // cart items
      .mockResolvedValueOnce({ data: [] }) // order insert
      .mockResolvedValueOnce({ data: [] }); // items insert
    const order = await orders.createFromCart('tok', { email: 'ada@example.com' });

    expect(order.status).toBe('pending');
    expect(order.number).toMatch(NUMBER_RE);
    expect(order.subtotal_cents).toBe(6000); // 2×2500 + 1000
    expect(order.total_cents).toBe(6000); // v0: no tax/shipping
    expect(order.cart_token).toBe('tok');
    expect(order.items).toHaveLength(2);
    expect(order.items[0]).toEqual(
      expect.objectContaining({ variant_id: 'v1', quantity: 2, unit_price_cents: 2500, title: 'Tee' }),
    );

    const orderInsert = payloadOf(post, 2);
    expect(orderInsert.type).toBe('INSERT');
    expect(orderInsert.table).toBe(ORDERS_TABLES.ORDERS);
    expect(orderInsert.data).not.toHaveProperty('created_at');
    expect(orderInsert.data).not.toHaveProperty('payment_provider');
    expect(orderInsert.data).not.toHaveProperty('payment_ref');
    expect(orderInsert.data).toEqual(
      expect.objectContaining({
        email: 'ada@example.com',
        currency: 'USD',
        subtotal_cents: 6000,
        total_cents: 6000,
        status: 'pending',
        cart_token: 'tok',
      }),
    );

    const itemsInsert = payloadOf(post, 3);
    expect(itemsInsert.type).toBe('INSERT');
    expect(itemsInsert.table).toBe(ORDERS_TABLES.ITEMS);
    const rows = itemsInsert.data as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    // Second line has a null variant_title — that nullable column is omitted.
    expect(rows[1]).not.toHaveProperty('variant_title');
    expect(rows[0]).toEqual(
      expect.objectContaining({ variant_id: 'v1', quantity: 2, unit_price_cents: 2500, title: 'Tee' }),
    );
  });

  it('retries the order number on a UNIQUE(number) conflict', async () => {
    const { post, orders } = makeOrders();
    post
      .mockResolvedValueOnce({ data: [CART_ROW] }) // cart
      .mockResolvedValueOnce({ data: CART_ITEMS }) // items
      .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "orders__orders_number_key"'))
      .mockResolvedValueOnce({ data: [] }) // order insert (2nd number)
      .mockResolvedValueOnce({ data: [] }); // items insert
    const order = await orders.createFromCart('tok', { email: 'ada@example.com' });
    expect(order.number).toMatch(NUMBER_RE);
    // First number attempt (call 2) and the retry (call 3) both target orders.
    expect(payloadOf(post, 2).table).toBe(ORDERS_TABLES.ORDERS);
    expect(payloadOf(post, 3).table).toBe(ORDERS_TABLES.ORDERS);
    const n1 = (payloadOf(post, 2).data as { number: string }).number;
    const n2 = (payloadOf(post, 3).data as { number: string }).number;
    expect(n1).not.toBe(n2); // a fresh number on retry
  });

  it('rejects an unknown cart, an empty cart, and a bad email', async () => {
    const { post, orders } = makeOrders();
    post.mockResolvedValueOnce({ data: [] });
    await expect(orders.createFromCart('ghost', { email: 'a@b.co' })).rejects.toThrow(/unknown cart "ghost"/);

    post.mockResolvedValueOnce({ data: [CART_ROW] }).mockResolvedValueOnce({ data: [] });
    await expect(orders.createFromCart('tok', { email: 'a@b.co' })).rejects.toThrow(/cart "tok" is empty/);

    await expect(orders.createFromCart('tok', { email: 'nope' })).rejects.toThrow(
      /"email" must be a valid email address/,
    );
  });
});

describe('get / getByNumber / list', () => {
  it('get returns the order + items by id', async () => {
    const { post, orders } = makeOrders();
    post
      .mockResolvedValueOnce({ data: [{ id: 'o1', number: 'XN-ABC123', email: 'a@b.co', subtotal_cents: '6000', total_cents: '6000', status: 'pending' }] })
      .mockResolvedValueOnce({ data: [{ id: 'oi1', order_id: 'o1', variant_id: 'v1', quantity: 2, unit_price_cents: 2500 }] });
    const order = await orders.get('o1');
    expect(order).not.toBeNull();
    expect(order!.subtotal_cents).toBe(6000); // string coerced
    expect(order!.items).toHaveLength(1);
    expect(payloadOf(post, 1)).toEqual(
      expect.objectContaining({
        table: ORDERS_TABLES.ITEMS,
        where: [{ column: 'order_id', operator: '=', value: 'o1', type: 'AND' }],
      }),
    );
  });

  it('get resolves null for an unknown id (never queries items)', async () => {
    const { post, orders } = makeOrders();
    post.mockResolvedValueOnce({ data: [] });
    await expect(orders.get('ghost')).resolves.toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('getByNumber selects by number', async () => {
    const { post, orders } = makeOrders();
    post
      .mockResolvedValueOnce({ data: [{ id: 'o1', number: 'XN-ABC123', email: 'a@b.co', status: 'paid' }] })
      .mockResolvedValueOnce({ data: [] });
    await orders.getByNumber('XN-ABC123');
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: ORDERS_TABLES.ORDERS,
        where: [{ column: 'number', operator: '=', value: 'XN-ABC123', type: 'AND' }],
        limit: 1,
      }),
    );
  });

  it('list filters by status, orders newest first, and applies a limit', async () => {
    const { post, orders } = makeOrders();
    post.mockResolvedValueOnce({ data: [] });
    await orders.list({ status: 'paid', limit: 20 });
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: ORDERS_TABLES.ORDERS,
        where: [{ column: 'status', operator: '=', value: 'paid', type: 'AND' }],
        orderBy: [{ column: 'created_at', direction: 'DESC' }],
        limit: 20,
      }),
    );
  });

  it('list rejects a bad status', async () => {
    const { orders } = makeOrders();
    await expect(orders.list({ status: 'weird' as never })).rejects.toThrow(/"status" must be one of/);
  });
});

describe('markPaid', () => {
  const commitSpy = () => jest.spyOn(InventoryClient.prototype, 'commit').mockResolvedValue(undefined);

  afterEach(() => jest.restoreAllMocks());

  it('flips to paid, commits inventory per line, and converts the cart', async () => {
    const commit = commitSpy();
    const { post, orders } = makeOrders();
    post
      .mockResolvedValueOnce({ data: [{ id: 'o1', number: 'XN-A', email: 'a@b.co', status: 'pending', cart_token: 'tok' }] }) // get → order
      .mockResolvedValueOnce({
        data: [
          { id: 'oi1', order_id: 'o1', variant_id: 'v1', quantity: 2, unit_price_cents: 2500 },
          { id: 'oi2', order_id: 'o1', variant_id: 'v2', quantity: 1, unit_price_cents: 1000 },
        ],
      }) // get → items
      .mockResolvedValueOnce({ data: [] }) // update status
      .mockResolvedValueOnce({ data: [] }); // update cart status
    const order = await orders.markPaid('o1', { provider: 'mock', ref: 'mock_o1' });

    expect(order.status).toBe('paid');
    expect(order.payment_provider).toBe('mock');
    expect(order.payment_ref).toBe('mock_o1');

    // Status flip.
    const statusUpdate = payloadOf(post, 2);
    expect(statusUpdate.type).toBe('UPDATE');
    expect(statusUpdate.table).toBe(ORDERS_TABLES.ORDERS);
    expect(statusUpdate.data).toEqual({ status: 'paid', payment_provider: 'mock', payment_ref: 'mock_o1' });

    // Inventory committed once per line, with the right qty.
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledWith('v1', 2);
    expect(commit).toHaveBeenCalledWith('v2', 1);

    // Cart converted.
    const cartUpdate = payloadOf(post, 3);
    expect(cartUpdate.type).toBe('UPDATE');
    expect(cartUpdate.table).toBe(CART_TABLES.CARTS);
    expect(cartUpdate.data).toEqual({ status: 'converted' });
    expect(cartUpdate.where).toEqual([{ column: 'token', operator: '=', value: 'tok', type: 'AND' }]);
  });

  it('is idempotent: a second markPaid on an already-paid order does NOT re-commit', async () => {
    const commit = commitSpy();
    const { post, orders } = makeOrders();
    post
      .mockResolvedValueOnce({ data: [{ id: 'o1', number: 'XN-A', email: 'a@b.co', status: 'paid', cart_token: 'tok' }] })
      .mockResolvedValueOnce({ data: [{ id: 'oi1', order_id: 'o1', variant_id: 'v1', quantity: 2, unit_price_cents: 2500 }] });
    const order = await orders.markPaid('o1', { provider: 'mock', ref: 'mock_o1' });
    expect(order.status).toBe('paid');
    // Only the two read queries ran — no UPDATE, no commit.
    expect(post).toHaveBeenCalledTimes(2);
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects an unknown order and missing provider/ref', async () => {
    const { post, orders } = makeOrders();
    post.mockResolvedValueOnce({ data: [] });
    await expect(orders.markPaid('ghost', { provider: 'mock', ref: 'r' })).rejects.toThrow(/unknown order "ghost"/);
    await expect(orders.markPaid('o1', { provider: '', ref: 'r' })).rejects.toThrow(/"provider"/);
  });
});

describe('updateStatus', () => {
  it('sets a valid status', async () => {
    const { post, orders } = makeOrders();
    post.mockResolvedValueOnce({ data: [] });
    await orders.updateStatus('o1', 'fulfilled');
    expect(payloadOf(post, 0)).toEqual({
      type: 'UPDATE',
      table: ORDERS_TABLES.ORDERS,
      data: { status: 'fulfilled' },
      where: [{ column: 'id', operator: '=', value: 'o1', type: 'AND' }],
    });
  });

  it('rejects an invalid status', async () => {
    const { orders } = makeOrders();
    await expect(orders.updateStatus('o1', 'weird' as never)).rejects.toThrow(/"status" must be one of/);
  });
});

describe('order number uniqueness', () => {
  it('generates distinct XN- numbers across many creates', async () => {
    const { post, orders } = makeOrders();
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      post
        .mockResolvedValueOnce({ data: [CART_ROW] })
        .mockResolvedValueOnce({ data: [CART_ITEMS[0]] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });
      const order = await orders.createFromCart('tok', { email: 'a@b.co' });
      expect(order.number).toMatch(NUMBER_RE);
      seen.add(order.number);
    }
    // Collisions are astronomically unlikely at 30^6; expect all distinct.
    expect(seen.size).toBe(50);
  });
});

describe('orders module lifecycle', () => {
  const makeModules = () => {
    const post = jest.fn(
      (_url: string, _body: { sql?: string; params?: unknown[] }): Promise<{ data: unknown[] }> =>
        Promise.resolve({ data: [] }),
    );
    const http = { post } as unknown as HttpClient;
    return { post, modules: new ModulesClient(http, new MigrationsClient(http)) };
  };

  it("enable('orders') runs the orders + items migrations through the ledger", async () => {
    const { modules, post } = makeModules();
    await modules.enable('orders');
    const sqls = post.mock.calls.map((call) => (call[1] as { sql: string }).sql);
    expect(sqls[0]).toContain(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_LEDGER_TABLE}`);
    expect(sqls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS orders__orders'))).toBe(true);
    expect(sqls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS orders__items'))).toBe(true);
    expect(modules.isEnabled('orders')).toBe(true);
  });

  it('after enable, the accessor returns an OrdersClient', async () => {
    const { modules } = makeModules();
    await modules.enable('orders');
    expect(modules.orders).toBeInstanceOf(OrdersClient);
    expect(modules.orders).toBe(modules.orders); // cached
  });
});
