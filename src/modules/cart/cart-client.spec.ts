import { HttpClient } from '../../core/http-client';
import { MigrationsClient, MIGRATIONS_LEDGER_TABLE } from '../../migrations';
import { QueryClient } from '../../query/query-client';
import { QueryPayload } from '../../query/types';
import { ModuleContext } from '../core';
import { ModulesClient } from '../modules-client';
import { CATALOG_TABLES } from '../catalog';
import { CartClient, CART_TABLES } from './cart-client';

/**
 * Cart runs over a real QueryClient with the http layer mocked (same seam as
 * the catalog/inventory suites), so every assertion is against the actual IR
 * that would hit `/app-platform/query`.
 */
const makeCart = () => {
  const post = jest.fn();
  const query = new QueryClient({ post } as unknown as HttpClient);
  const ctx: ModuleContext = { query, raw: (sql, params = []) => query.raw(sql, params) };
  return { post, cart: new CartClient(ctx) };
};

const payloadOf = (post: jest.Mock, call: number): QueryPayload =>
  post.mock.calls[call]![1] as QueryPayload;

const UUID_RE = /^[0-9a-f-]{36}$/;

const CART_ROW = { id: 'cart_1', token: 'tok', currency: 'USD', status: 'open', created_at: 't0' };
const VARIANT_ROW = {
  id: 'v1',
  product_id: 'p1',
  title: 'Medium',
  price_cents: 2500,
  currency: 'USD',
  image_url: 'https://cdn/x.png',
};

describe('getOrCreate', () => {
  it('returns the existing cart when the token is known (no insert)', async () => {
    const { post, cart } = makeCart();
    post.mockResolvedValueOnce({ data: [CART_ROW] });
    const record = await cart.getOrCreate('tok');
    expect(record).toEqual({ id: 'cart_1', token: 'tok', currency: 'USD', status: 'open', created_at: 't0' });
    expect(post).toHaveBeenCalledTimes(1);
    expect(payloadOf(post, 0)).toEqual(
      expect.objectContaining({
        table: CART_TABLES.CARTS,
        where: [{ column: 'token', operator: '=', value: 'tok', type: 'AND' }],
        limit: 1,
      }),
    );
  });

  it('creates a fresh open cart and omits created_at from the insert', async () => {
    const { post, cart } = makeCart();
    post.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });
    const record = await cart.getOrCreate('tok');
    expect(record.id).toMatch(UUID_RE);
    expect(record.currency).toBe('USD');
    expect(record.status).toBe('open');
    const insert = payloadOf(post, 1);
    expect(insert.type).toBe('INSERT');
    expect(insert.table).toBe(CART_TABLES.CARTS);
    expect(insert.data).not.toHaveProperty('created_at');
    expect(insert.data).toEqual(expect.objectContaining({ token: 'tok', currency: 'USD', status: 'open' }));
  });

  it('re-reads the winner when the UNIQUE(token) insert loses a race', async () => {
    const { post, cart } = makeCart();
    post
      .mockResolvedValueOnce({ data: [] }) // findCart → miss
      .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint')) // insert conflict
      .mockResolvedValueOnce({ data: [CART_ROW] }); // re-read
    const record = await cart.getOrCreate('tok');
    expect(record.id).toBe('cart_1');
  });

  it('validates the token', async () => {
    const { cart } = makeCart();
    await expect(cart.getOrCreate('')).rejects.toThrow(/"token" must be a non-empty string/);
  });
});

describe('addItem', () => {
  it('snapshots price/titles from the variant + product and omits created_at', async () => {
    const { post, cart } = makeCart();
    post
      .mockResolvedValueOnce({ data: [CART_ROW] }) // getOrCreate → findCart
      .mockResolvedValueOnce({ data: [VARIANT_ROW] }) // variant lookup
      .mockResolvedValueOnce({ data: [{ id: 'p1', title: 'Classic Tee' }] }) // product lookup
      .mockResolvedValueOnce({ data: [] }) // existing-line lookup → none
      .mockResolvedValueOnce({ data: [] }); // insert
    const item = await cart.addItem('tok', 'v1', 2);

    expect(item.unit_price_cents).toBe(2500);
    expect(item.quantity).toBe(2);
    expect(item.variant_title).toBe('Medium');
    expect(item.title).toBe('Classic Tee');
    expect(item.image_url).toBe('https://cdn/x.png');

    const insert = payloadOf(post, 4);
    expect(insert.type).toBe('INSERT');
    expect(insert.table).toBe(CART_TABLES.ITEMS);
    expect(insert.data).not.toHaveProperty('created_at');
    expect(insert.data).toEqual(
      expect.objectContaining({
        cart_id: 'cart_1',
        variant_id: 'v1',
        quantity: 2,
        unit_price_cents: 2500,
        title: 'Classic Tee',
        variant_title: 'Medium',
      }),
    );
    // The variant lookup reads catalog__variants by id.
    expect(payloadOf(post, 1)).toEqual(
      expect.objectContaining({
        table: CATALOG_TABLES.VARIANTS,
        where: [{ column: 'id', operator: '=', value: 'v1', type: 'AND' }],
      }),
    );
  });

  it('merges quantity into an existing line and keeps the original price snapshot', async () => {
    const { post, cart } = makeCart();
    post
      .mockResolvedValueOnce({ data: [CART_ROW] }) // getOrCreate
      .mockResolvedValueOnce({ data: [{ ...VARIANT_ROW, price_cents: 9999 }] }) // variant (price changed!)
      .mockResolvedValueOnce({ data: [{ id: 'p1', title: 'Classic Tee' }] }) // product
      .mockResolvedValueOnce({ data: [{ id: 'it1', quantity: 3, unit_price_cents: 2500 }] }) // existing line
      .mockResolvedValueOnce({ data: [] }); // update
    const item = await cart.addItem('tok', 'v1', 2);

    expect(item.quantity).toBe(5); // 3 + 2 merged
    expect(item.unit_price_cents).toBe(2500); // original snapshot, NOT 9999
    const update = payloadOf(post, 4);
    expect(update.type).toBe('UPDATE');
    expect(update.data).toEqual({ quantity: 5 });
    expect(update.where).toEqual([{ column: 'id', operator: '=', value: 'it1', type: 'AND' }]);
  });

  it('rejects an unknown variant', async () => {
    const { post, cart } = makeCart();
    post
      .mockResolvedValueOnce({ data: [CART_ROW] }) // getOrCreate
      .mockResolvedValueOnce({ data: [] }); // variant miss
    await expect(cart.addItem('tok', 'ghost', 1)).rejects.toThrow(/variant "ghost" not found/);
  });

  it('rejects a non-positive or non-integer quantity', async () => {
    const { cart } = makeCart();
    await expect(cart.addItem('tok', 'v1', 0)).rejects.toThrow(/"quantity" must be an integer >= 1/);
    await expect(cart.addItem('tok', 'v1', 1.5)).rejects.toThrow(/"quantity" must be an integer >= 1/);
  });
});

describe('getCart', () => {
  it('computes subtotal = Σ unit_price_cents × qty and camelCases items', async () => {
    const { post, cart } = makeCart();
    post
      .mockResolvedValueOnce({ data: [CART_ROW] }) // findCart
      .mockResolvedValueOnce({
        data: [
          { id: 'it1', variant_id: 'v1', quantity: 2, unit_price_cents: 2500, title: 'Tee', variant_title: 'M' },
          { id: 'it2', variant_id: 'v2', quantity: 1, unit_price_cents: 1000, title: null, variant_title: null },
        ],
      });
    const view = await cart.getCart('tok');
    expect(view.currency).toBe('USD');
    expect(view.subtotalCents).toBe(2 * 2500 + 1000); // 6000
    expect(view.items).toEqual([
      expect.objectContaining({ id: 'it1', variantId: 'v1', quantity: 2, unitPriceCents: 2500, lineTotalCents: 5000 }),
      expect.objectContaining({ id: 'it2', variantId: 'v2', quantity: 1, unitPriceCents: 1000, lineTotalCents: 1000 }),
    ]);
  });

  it('returns an empty (never-null) view for an unknown token', async () => {
    const { post, cart } = makeCart();
    post.mockResolvedValueOnce({ data: [] });
    await expect(cart.getCart('ghost')).resolves.toEqual({
      token: 'ghost',
      currency: 'USD',
      items: [],
      subtotalCents: 0,
    });
  });

  it('coerces string numerics from the engine', async () => {
    const { post, cart } = makeCart();
    post
      .mockResolvedValueOnce({ data: [CART_ROW] })
      .mockResolvedValueOnce({ data: [{ id: 'it1', variant_id: 'v1', quantity: '3', unit_price_cents: '700' }] });
    const view = await cart.getCart('tok');
    expect(view.subtotalCents).toBe(2100);
    expect(view.items[0]!.lineTotalCents).toBe(2100);
  });
});

describe('updateItem / removeItem / clear', () => {
  it('updateItem with qty 0 deletes the line (scoped to the cart)', async () => {
    const { post, cart } = makeCart();
    post
      .mockResolvedValueOnce({ data: [CART_ROW] }) // findCart
      .mockResolvedValueOnce({ data: [] }); // delete
    await cart.updateItem('tok', 'it1', 0);
    const del = payloadOf(post, 1);
    expect(del.type).toBe('DELETE');
    expect(del.table).toBe(CART_TABLES.ITEMS);
    expect(del.where).toEqual([
      { column: 'id', operator: '=', value: 'it1', type: 'AND' },
      { column: 'cart_id', operator: '=', value: 'cart_1', type: 'AND' },
    ]);
  });

  it('updateItem with qty > 0 updates the quantity scoped to the cart', async () => {
    const { post, cart } = makeCart();
    post.mockResolvedValueOnce({ data: [CART_ROW] }).mockResolvedValueOnce({ data: [] });
    await cart.updateItem('tok', 'it1', 4);
    const update = payloadOf(post, 1);
    expect(update.type).toBe('UPDATE');
    expect(update.data).toEqual({ quantity: 4 });
    expect(update.where).toEqual([
      { column: 'id', operator: '=', value: 'it1', type: 'AND' },
      { column: 'cart_id', operator: '=', value: 'cart_1', type: 'AND' },
    ]);
  });

  it('updateItem rejects a negative quantity and an unknown cart', async () => {
    const { post, cart } = makeCart();
    await expect(cart.updateItem('tok', 'it1', -1)).rejects.toThrow(/"quantity" must be an integer >= 0/);
    post.mockResolvedValueOnce({ data: [] });
    await expect(cart.updateItem('ghost', 'it1', 2)).rejects.toThrow(/unknown cart "ghost"/);
  });

  it('removeItem deletes the line scoped to the cart', async () => {
    const { post, cart } = makeCart();
    post.mockResolvedValueOnce({ data: [CART_ROW] }).mockResolvedValueOnce({ data: [] });
    await cart.removeItem('tok', 'it1');
    expect(payloadOf(post, 1).type).toBe('DELETE');
  });

  it('clear deletes all lines for the cart', async () => {
    const { post, cart } = makeCart();
    post.mockResolvedValueOnce({ data: [CART_ROW] }).mockResolvedValueOnce({ data: [] });
    await cart.clear('tok');
    const del = payloadOf(post, 1);
    expect(del.type).toBe('DELETE');
    expect(del.where).toEqual([{ column: 'cart_id', operator: '=', value: 'cart_1', type: 'AND' }]);
  });

  it('markConverted flips the cart status by token', async () => {
    const { post, cart } = makeCart();
    post.mockResolvedValueOnce({ data: [] });
    await cart.markConverted('tok');
    expect(payloadOf(post, 0)).toEqual({
      type: 'UPDATE',
      table: CART_TABLES.CARTS,
      data: { status: 'converted' },
      where: [{ column: 'token', operator: '=', value: 'tok', type: 'AND' }],
    });
  });
});

describe('cart module lifecycle', () => {
  const makeModules = () => {
    const post = jest.fn(
      (_url: string, _body: { sql?: string; params?: unknown[] }): Promise<{ data: unknown[] }> =>
        Promise.resolve({ data: [] }),
    );
    const http = { post } as unknown as HttpClient;
    return { post, modules: new ModulesClient(http, new MigrationsClient(http)) };
  };

  it("enable('cart') runs the carts + items table migrations through the ledger", async () => {
    const { modules, post } = makeModules();
    await modules.enable('cart');
    const sqls = post.mock.calls.map((call) => (call[1] as { sql: string }).sql);
    expect(sqls[0]).toContain(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_LEDGER_TABLE}`);
    expect(sqls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS cart__carts'))).toBe(true);
    expect(sqls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS cart__items'))).toBe(true);
    expect(modules.isEnabled('cart')).toBe(true);
  });

  it('after enable, the accessor returns a CartClient', async () => {
    const { modules } = makeModules();
    await modules.enable('cart');
    expect(modules.cart).toBeInstanceOf(CartClient);
    expect(modules.cart).toBe(modules.cart); // cached
  });
});
