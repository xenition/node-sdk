import { HttpClient } from '../../core/http-client';
import { API_ENDPOINTS } from '../../constants';
import { MigrationsClient, MIGRATIONS_LEDGER_TABLE } from '../../migrations';
import { QueryClient } from '../../query/query-client';
import { QueryPayload } from '../../query/types';
import { ModuleContext } from '../core';
import { ModulesClient } from '../modules-client';
import { InventoryClient, INVENTORY_TABLES } from './inventory-client';

const makeInventory = () => {
  const post = jest.fn();
  const query = new QueryClient({ post } as unknown as HttpClient);
  const ctx: ModuleContext = { query, raw: (sql, params = []) => query.raw(sql, params) };
  return { post, inventory: new InventoryClient(ctx) };
};

/** The raw SQL body a mutating method sent: `{ sql, params }`. */
const rawOf = (post: jest.Mock, call: number): { sql: string; params: unknown[] } =>
  post.mock.calls[call]![1] as { sql: string; params: unknown[] };

const selectOf = (post: jest.Mock, call: number): QueryPayload =>
  post.mock.calls[call]![1] as QueryPayload;

const UUID_RE = /^[0-9a-f-]{36}$/;

describe('setStock (upsert)', () => {
  it('upserts quantity via ON CONFLICT and returns the derived view', async () => {
    const { post, inventory } = makeInventory();
    post.mockResolvedValueOnce({
      data: [{ variant_id: 'v1', quantity: 5, reserved: 0, policy: 'deny' }],
    });
    const view = await inventory.setStock('v1', 5);
    expect(view).toEqual({ variant_id: 'v1', quantity: 5, reserved: 0, available: 5, policy: 'deny' });

    const raw = rawOf(post, 0);
    expect(post).toHaveBeenCalledWith(API_ENDPOINTS.QUERY.RAW, expect.anything());
    expect(raw.sql).toContain(`INSERT INTO ${INVENTORY_TABLES.STOCK}`);
    expect(raw.sql).toContain('ON CONFLICT (variant_id) DO UPDATE');
    // params: [id, variantId, quantity, policy-or-null]
    expect(raw.params[0]).toMatch(UUID_RE);
    expect(raw.params[1]).toBe('v1');
    expect(raw.params[2]).toBe(5);
    expect(raw.params[3]).toBeNull(); // policy omitted → COALESCE default 'deny'
  });

  it('passes an explicit policy through', async () => {
    const { post, inventory } = makeInventory();
    post.mockResolvedValueOnce({
      data: [{ variant_id: 'v1', quantity: 2, reserved: 0, policy: 'continue' }],
    });
    const view = await inventory.setStock('v1', 2, { policy: 'continue' });
    expect(view.policy).toBe('continue');
    expect(rawOf(post, 0).params[3]).toBe('continue');
  });

  it('rejects a negative quantity, a bad policy, and a missing variantId', async () => {
    const { inventory } = makeInventory();
    await expect(inventory.setStock('v1', -1)).rejects.toThrow(/"quantity" must be an integer >= 0/);
    await expect(inventory.setStock('v1', 5, { policy: 'nope' as never })).rejects.toThrow(
      /"policy" must be one of deny, continue/,
    );
    await expect(inventory.setStock('', 5)).rejects.toThrow(/"variantId"/);
  });
});

describe('adjust', () => {
  it('increments quantity via ON CONFLICT and floors a fresh row at 0', async () => {
    const { post, inventory } = makeInventory();
    post.mockResolvedValueOnce({
      data: [{ variant_id: 'v1', quantity: 8, reserved: 0, policy: 'deny' }],
    });
    const view = await inventory.adjust('v1', 3);
    expect(view.quantity).toBe(8);
    const raw = rawOf(post, 0);
    expect(raw.sql).toContain('GREATEST($3, 0)');
    expect(raw.sql).toContain(`${INVENTORY_TABLES.STOCK}.quantity + $3`);
    expect(raw.params[1]).toBe('v1');
    expect(raw.params[2]).toBe(3);
  });

  it('rejects a non-integer delta', async () => {
    const { inventory } = makeInventory();
    await expect(inventory.adjust('v1', 1.5)).rejects.toThrow(/"delta" must be an integer/);
  });
});

describe('getStock / getStockMany', () => {
  it('computes available = quantity - reserved', async () => {
    const { post, inventory } = makeInventory();
    post.mockResolvedValueOnce({ data: [{ variant_id: 'v1', quantity: 10, reserved: 4, policy: 'deny' }] });
    const view = await inventory.getStock('v1');
    expect(view).toEqual({ variant_id: 'v1', quantity: 10, reserved: 4, available: 6, policy: 'deny' });
    expect(selectOf(post, 0)).toEqual(
      expect.objectContaining({
        table: INVENTORY_TABLES.STOCK,
        where: [{ column: 'variant_id', operator: '=', value: 'v1', type: 'AND' }],
        limit: 1,
      }),
    );
  });

  it('returns a zeroed view (never null) for a variant with no stock row', async () => {
    const { post, inventory } = makeInventory();
    post.mockResolvedValueOnce({ data: [] });
    await expect(inventory.getStock('ghost')).resolves.toEqual({
      variant_id: 'ghost',
      quantity: 0,
      reserved: 0,
      available: 0,
      policy: 'deny',
    });
  });

  it('reflects a negative available under an oversell policy', async () => {
    const { post, inventory } = makeInventory();
    post.mockResolvedValueOnce({ data: [{ variant_id: 'v1', quantity: 0, reserved: 3, policy: 'continue' }] });
    const view = await inventory.getStock('v1');
    expect(view.available).toBe(-3);
    expect(view.policy).toBe('continue');
  });

  it('coerces string numerics from the engine', async () => {
    const { post, inventory } = makeInventory();
    post.mockResolvedValueOnce({ data: [{ variant_id: 'v1', quantity: '10', reserved: '2', policy: 'deny' }] });
    const view = await inventory.getStock('v1');
    expect(view).toEqual({ variant_id: 'v1', quantity: 10, reserved: 2, available: 8, policy: 'deny' });
  });

  it('getStockMany keys results by variant id and uses whereIn', async () => {
    const { post, inventory } = makeInventory();
    post.mockResolvedValueOnce({
      data: [
        { variant_id: 'v1', quantity: 5, reserved: 1, policy: 'deny' },
        { variant_id: 'v2', quantity: 0, reserved: 0, policy: 'continue' },
      ],
    });
    const map = await inventory.getStockMany(['v1', 'v2', 'v3']);
    expect(Object.keys(map)).toEqual(['v1', 'v2']); // v3 has no row → absent
    expect(map.v1!.available).toBe(4);
    expect(selectOf(post, 0)).toEqual(
      expect.objectContaining({
        table: INVENTORY_TABLES.STOCK,
        where: [{ column: 'variant_id', operator: 'IN', value: ['v1', 'v2', 'v3'], type: 'AND' }],
      }),
    );
  });

  it('getStockMany short-circuits an empty list without a query', async () => {
    const { post, inventory } = makeInventory();
    await expect(inventory.getStockMany([])).resolves.toEqual({});
    expect(post).not.toHaveBeenCalled();
  });

  it('getStockMany validates its input', async () => {
    const { inventory } = makeInventory();
    await expect(inventory.getStockMany('v1' as never)).rejects.toThrow(/"variantIds" must be an array/);
    await expect(inventory.getStockMany([''])).rejects.toThrow(/"variantIds\[0\]"/);
  });
});

describe('reserve', () => {
  it('returns true when the conditional UPDATE matched a row', async () => {
    const { post, inventory } = makeInventory();
    post.mockResolvedValueOnce({ data: [{ reserved: 3 }] });
    await expect(inventory.reserve('v1', 3)).resolves.toBe(true);
    const raw = rawOf(post, 0);
    // The WHERE is the guard: enough available OR a 'continue' policy.
    expect(raw.sql).toContain('reserved = reserved + $1');
    expect(raw.sql).toContain("policy = 'continue' OR quantity - reserved >= $1");
    expect(raw.params).toEqual([3, 'v1']);
  });

  it('returns false when nothing was reserved (insufficient stock under deny)', async () => {
    const { post, inventory } = makeInventory();
    post.mockResolvedValueOnce({ data: [] });
    await expect(inventory.reserve('v1', 3)).resolves.toBe(false);
  });

  it("a 'continue' policy row still matches even at zero available (server-side guard)", async () => {
    const { post, inventory } = makeInventory();
    // The SQL's `policy = 'continue'` disjunct is what lets this succeed; the
    // mock stands in for the server having matched the oversell row.
    post.mockResolvedValueOnce({ data: [{ reserved: 5 }] });
    await expect(inventory.reserve('oversell-variant', 5)).resolves.toBe(true);
  });

  it('rejects a non-positive qty', async () => {
    const { inventory } = makeInventory();
    await expect(inventory.reserve('v1', 0)).rejects.toThrow(/"qty" must be an integer >= 1/);
    await expect(inventory.reserve('v1', -2)).rejects.toThrow(/"qty" must be an integer >= 1/);
  });
});

describe('release', () => {
  it('decrements reserved with a GREATEST(.., 0) floor', async () => {
    const { post, inventory } = makeInventory();
    post.mockResolvedValueOnce({ data: [] });
    await inventory.release('v1', 2);
    const raw = rawOf(post, 0);
    expect(raw.sql).toContain('reserved = GREATEST(reserved - $1, 0)');
    expect(raw.params).toEqual([2, 'v1']);
  });

  it('rejects a non-positive qty', async () => {
    const { inventory } = makeInventory();
    await expect(inventory.release('v1', 0)).rejects.toThrow(/"qty" must be an integer >= 1/);
  });
});

describe('commit', () => {
  it('subtracts from both quantity and reserved in one statement', async () => {
    const { post, inventory } = makeInventory();
    post.mockResolvedValueOnce({ data: [] });
    await inventory.commit('v1', 2);
    const raw = rawOf(post, 0);
    expect(raw.sql).toContain('quantity = quantity - $1');
    expect(raw.sql).toContain('reserved = GREATEST(reserved - $1, 0)');
    expect(raw.params).toEqual([2, 'v1']);
  });

  it('rejects a non-positive qty', async () => {
    const { inventory } = makeInventory();
    await expect(inventory.commit('v1', -1)).rejects.toThrow(/"qty" must be an integer >= 1/);
  });
});

describe('reserve → getStock lifecycle math', () => {
  it('a successful reserve lowers available on the next read', async () => {
    const { post, inventory } = makeInventory();
    post
      .mockResolvedValueOnce({ data: [{ variant_id: 'v1', quantity: 5, reserved: 0, policy: 'deny' }] }) // setStock
      .mockResolvedValueOnce({ data: [{ reserved: 3 }] }) // reserve → true
      .mockResolvedValueOnce({ data: [{ variant_id: 'v1', quantity: 5, reserved: 3, policy: 'deny' }] }) // getStock
      .mockResolvedValueOnce({ data: [] }); // reserve again → false
    await inventory.setStock('v1', 5);
    await expect(inventory.reserve('v1', 3)).resolves.toBe(true);
    await expect(inventory.getStock('v1')).resolves.toMatchObject({ reserved: 3, available: 2 });
    await expect(inventory.reserve('v1', 3)).resolves.toBe(false);
  });
});

describe('inventory module lifecycle', () => {
  const makeModules = () => {
    const post = jest.fn(
      (_url: string, _body: { sql?: string; params?: unknown[] }): Promise<{ data: unknown[] }> =>
        Promise.resolve({ data: [] }),
    );
    const http = { post } as unknown as HttpClient;
    return { post, modules: new ModulesClient(http, new MigrationsClient(http)) };
  };

  it("enable('inventory') runs the stock table migration through the ledger", async () => {
    const { modules, post } = makeModules();
    await modules.enable('inventory');
    const sqls = post.mock.calls.map((call) => (call[1] as { sql: string }).sql);
    expect(sqls[0]).toContain(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_LEDGER_TABLE}`);
    expect(sqls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS inventory__stock'))).toBe(true);
    expect(modules.isEnabled('inventory')).toBe(true);
  });

  it('after enable, the accessor returns an InventoryClient', async () => {
    const { modules } = makeModules();
    await modules.enable('inventory');
    expect(modules.inventory).toBeInstanceOf(InventoryClient);
    expect(modules.inventory).toBe(modules.inventory); // cached
  });
});
