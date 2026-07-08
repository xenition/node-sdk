import { HttpClient } from '../core/http-client';
import { XenitionError } from '../core/errors';
import { MigrationsClient, MIGRATIONS_LEDGER_TABLE } from '../migrations';
import { Migration } from '../migrations/types';
import { defineModule, ModuleContext, ModuleDefinition } from './core';
import { ModulesClient, ModuleName } from './modules-client';
import { CmsClient } from './cms';
import { FormsClient } from './forms';
import { ReviewsClient } from './reviews';

const makeHttp = () => {
  // Ledger reads come back empty; everything else succeeds.
  const post = jest.fn(
    (url: string, body: { sql?: string; params?: unknown[] }): Promise<{ data: unknown[] }> =>
      Promise.resolve({ data: [] }),
  );
  return { post, http: { post } as unknown as HttpClient };
};

const makeModules = () => {
  const { post, http } = makeHttp();
  const migrations = new MigrationsClient(http);
  return { post, modules: new ModulesClient(http, migrations) };
};

describe('defineModule', () => {
  const noopFactory = () => ({});

  it('returns a frozen definition with a defensive copy of the migrations array', () => {
    const migrations: Migration[] = [{ id: 'demo/0001', sql: 'SELECT 1' }];
    const def = defineModule({ name: 'demo', migrations, factory: noopFactory });
    expect(Object.isFrozen(def)).toBe(true);
    expect(def.migrations).toEqual(migrations);
    expect(def.migrations).not.toBe(migrations); // caller can't mutate it later
  });

  it('rejects non-kebab-case names', () => {
    for (const name of ['', 'CMS', '1shop', 'my_module', undefined]) {
      expect(() =>
        defineModule({
          name: name as string,
          migrations: [],
          factory: noopFactory,
        }),
      ).toThrow(/kebab-case/);
    }
  });

  it('rejects a missing migrations array', () => {
    expect(() =>
      defineModule({
        name: 'demo',
        migrations: undefined as unknown as Migration[],
        factory: noopFactory,
      }),
    ).toThrow(/needs a migrations array/);
  });

  it('rejects a missing factory', () => {
    expect(() =>
      defineModule({
        name: 'demo',
        migrations: [],
        factory: undefined as unknown as ModuleDefinition<unknown>['factory'],
      }),
    ).toThrow(/needs a factory function/);
  });
});

describe('ModulesClient lifecycle', () => {
  it('accessing a module before enable()/use() throws with the fix in the message', () => {
    const { modules, post } = makeModules();
    expect(() => modules.cms).toThrow(/not enabled/);
    expect(() => modules.cms).toThrow(/enable\('cms'\)/);
    expect(() => modules.cms).toThrow(/use\('cms'\)/);
    expect(post).not.toHaveBeenCalled();
  });

  it("enable('cms') runs the module's migrations through the ledger", async () => {
    const { modules, post } = makeModules();
    await modules.enable('cms');
    const sqls = post.mock.calls.map((call) => (call[1] as { sql: string }).sql);
    expect(sqls[0]).toContain(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_LEDGER_TABLE}`);
    expect(sqls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS cms__pages'))).toBe(true);
    expect(sqls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS cms__collections'))).toBe(true);
    expect(sqls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS cms__items'))).toBe(true);
    expect(modules.isEnabled('cms')).toBe(true);
  });

  it('after enable, accessors return the typed clients', async () => {
    const { modules } = makeModules();
    await modules.enable('cms');
    await modules.enable('forms');
    await modules.enable('reviews');
    expect(modules.cms).toBeInstanceOf(CmsClient);
    expect(modules.forms).toBeInstanceOf(FormsClient);
    expect(modules.reviews).toBeInstanceOf(ReviewsClient);
  });

  it('module clients are cached — the accessor returns the same instance', async () => {
    const { modules } = makeModules();
    await modules.enable('cms');
    expect(modules.cms).toBe(modules.cms);
  });

  it('enable() is idempotent — the ledger skips applied migrations on the second run', async () => {
    const { post, http } = makeHttp();
    const applied = new Map<string, string>();
    post.mockImplementation((url: string, body: { sql?: string; params?: unknown[] }) => {
      if (body.sql?.startsWith('SELECT id, checksum')) {
        return Promise.resolve({
          data: [...applied].map(([id, checksum]) => ({ id, checksum })),
        });
      }
      if (body.sql?.startsWith(`INSERT INTO ${MIGRATIONS_LEDGER_TABLE}`)) {
        const [id, checksum] = body.params as [string, string];
        applied.set(id, checksum);
      }
      return Promise.resolve({ data: [] });
    });
    const modules = new ModulesClient(http, new MigrationsClient(http));

    await modules.enable('reviews');
    const callsAfterFirst = post.mock.calls.length;
    await modules.enable('reviews');
    // Second enable: only ensure-ledger + ledger select, no DDL re-runs.
    expect(post.mock.calls.length).toBe(callsAfterFirst + 2);
  });

  it('use() unlocks the accessor without touching the network (anon-key path)', () => {
    const { modules, post } = makeModules();
    modules.use('forms');
    expect(modules.forms).toBeInstanceOf(FormsClient);
    expect(post).not.toHaveBeenCalled();
  });

  it('isEnabled() reflects enable/use state per module', () => {
    const { modules } = makeModules();
    expect(modules.isEnabled('cms')).toBe(false);
    modules.use('cms');
    expect(modules.isEnabled('cms')).toBe(true);
    expect(modules.isEnabled('forms')).toBe(false);
  });

  it('enable() with an anon key rethrows AUTH_FORBIDDEN with a service-key hint', async () => {
    const { http, post } = makeHttp();
    post.mockRejectedValue(new XenitionError('AUTH_FORBIDDEN', 'Raw SQL requires a service key'));
    const modules = new ModulesClient(http, new MigrationsClient(http));
    await expect(modules.enable('forms')).rejects.toThrow(/migrations need a service key/);
    await expect(modules.enable('forms')).rejects.toThrow(/use\('forms'\)/);
    expect(modules.isEnabled('forms')).toBe(false);
  });

  it('other migration failures propagate untouched', async () => {
    const { http, post } = makeHttp();
    post.mockRejectedValue(new XenitionError('SERVER_ERROR', 'boom'));
    const modules = new ModulesClient(http, new MigrationsClient(http));
    await expect(modules.enable('cms')).rejects.toThrow('boom');
  });

  it('unknown module names throw a helpful error listing the available modules', async () => {
    const { modules } = makeModules();
    await expect(modules.enable('shop' as ModuleName)).rejects.toThrow(
      /unknown module "shop".*cms, forms, reviews/,
    );
    expect(() => modules.use('shop' as ModuleName)).toThrow(/unknown module/);
  });

  it('module factories receive a context wired to the shared query layer', async () => {
    const { post, http } = makeHttp();
    const modules = new ModulesClient(http, new MigrationsClient(http));
    modules.use('reviews');
    await modules.reviews.aggregate({ type: 'product', id: 'p_1' });
    // The aggregate ran through the standard query endpoint of the shared http mock.
    expect(post).toHaveBeenCalledWith(
      '/app-platform/query',
      expect.objectContaining({ table: 'reviews__reviews' }),
    );
  });
});

describe('defineModule factory pass-through', () => {
  it('preserves the factory and defers all work until it is called', () => {
    const factory = jest.fn((ctx: ModuleContext) => ({ ctx }));
    const def = defineModule({ name: 'custom', migrations: [], factory });
    expect(factory).not.toHaveBeenCalled(); // declarative — nothing runs yet
    const ctx = { query: {}, raw: async () => ({ data: [] }) } as unknown as ModuleContext;
    expect(def.factory(ctx)).toEqual({ ctx });
    expect(factory).toHaveBeenCalledWith(ctx);
  });
});
