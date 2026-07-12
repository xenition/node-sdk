import type { XenitionClient } from '../xenition-client';
import { inventoryRouter } from './inventory-router';

const makeClient = () => {
  const inventory = { getStock: jest.fn() };
  const use = jest.fn();
  const client = { modules: { use, inventory } } as unknown as XenitionClient;
  return { client, inventory, use };
};

describe('GET /inventory/:variantId', () => {
  it('returns the derived stock view camelCased', async () => {
    const { client, inventory, use } = makeClient();
    inventory.getStock.mockResolvedValue({
      variant_id: 'v1',
      quantity: 10,
      reserved: 4,
      available: 6,
      policy: 'deny',
    });
    const res = await inventoryRouter({ client }).request('/inventory/v1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      variantId: 'v1',
      quantity: 10,
      reserved: 4,
      available: 6,
      policy: 'deny',
    });
    expect(inventory.getStock).toHaveBeenCalledWith('v1');
    expect(use).toHaveBeenCalledWith('inventory');
  });

  it('returns a 200 zeroed view for a variant with no stock row (out of stock, not 404)', async () => {
    const { client, inventory } = makeClient();
    inventory.getStock.mockResolvedValue({
      variant_id: 'ghost',
      quantity: 0,
      reserved: 0,
      available: 0,
      policy: 'deny',
    });
    const res = await inventoryRouter({ client }).request('/inventory/ghost');
    expect(res.status).toBe(200);
    expect((await res.json() as any).available).toBe(0);
  });
});
