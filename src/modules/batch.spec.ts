import { HttpClient } from '../core/http-client';
import { QueryClient } from '../query/query-client';
import { QueryPayload } from '../query/types';
import { MigrationsClient } from '../migrations';
import { FakeStore } from '../testing/fake-store';
import { ModuleContext } from './core';
import { ModulesClient } from './modules-client';
import {
  BatchKey,
  createBatchLoader,
  loadManyBy,
  loadOneBy,
  withBatching,
} from './batch';

/**
 * The claim under test is a count: N lookups in one tick must become ONE
 * request. So every context here is built over the FakeStore's IR
 * interpreter — real `IN` filtering against real seeded rows — and the
 * assertions read `store.payloads`, which is the number of round trips the
 * gateway would actually have seen. Stubbing the query out would prove the
 * loader calls something once; it would not prove the query it sends
 * returns the right rows for every key in the batch, which is the half
 * that can hand one caller another's row.
 */

const AUTHORS = 'cms__authors';

interface AuthorRow extends Record<string, unknown> {
  id: string;
  name: string;
}

interface FakeContext {
  store: FakeStore;
  ctx: ModuleContext;
  /** SELECTs issued against `table` — one per gateway round trip. */
  selects(table?: string): QueryPayload[];
}

/**
 * A ModuleContext over the FakeStore, with an optional hook that fails a
 * chosen request. `makeFakeContext` in src/testing cannot express "this one
 * request throws", and failure containment is a requirement here, not an
 * edge case.
 */
function makeContext(options: { failWhen?: (payload: QueryPayload) => Error | null } = {}): FakeContext {
  const store = new FakeStore();
  const post = (_url: string, body: QueryPayload) => {
    const failure = options.failWhen?.(body);
    if (failure) {
      // Recorded anyway: a failed request is still a round trip, and the
      // chunking tests count them.
      store.payloads.push(body);
      return Promise.reject(failure);
    }
    return Promise.resolve(store.handle(body));
  };
  const query = new QueryClient({ post } as unknown as HttpClient);
  const ctx: ModuleContext = { query, raw: (sql, params = []) => query.raw(sql, params) };
  return {
    store,
    ctx,
    selects: (table = AUTHORS) =>
      store.payloads.filter((payload) => payload.type === 'SELECT' && payload.table === table),
  };
}

/** The `IN` list a batched SELECT carried, in the order it was sent. */
function inList(payload: QueryPayload): BatchKey[] {
  const condition = (payload.where ?? []).find((where) => where.operator === 'IN');
  return (condition?.value as BatchKey[]) ?? [];
}

function seedAuthors(store: FakeStore, count: number): AuthorRow[] {
  const rows = Array.from({ length: count }, (_, i) => ({ id: `u${i}`, name: `Author ${i}` }));
  store.seed(AUTHORS, rows);
  return rows;
}

const byId = { table: AUTHORS, column: 'id' };

describe('batching is off until the app opts in', () => {
  it('issues one query per lookup on a context with no batch scope', async () => {
    const { ctx, store, selects } = makeContext();
    seedAuthors(store, 3);

    const rows = await Promise.all([
      loadOneBy<AuthorRow>(ctx, byId, 'u0'),
      loadOneBy<AuthorRow>(ctx, byId, 'u1'),
      loadOneBy<AuthorRow>(ctx, byId, 'u2'),
    ]);

    expect(rows.map((row) => row?.name)).toEqual(['Author 0', 'Author 1', 'Author 2']);
    expect(selects()).toHaveLength(3);
  });

  it('sends the same single-row payload the unbatched lookup sends today', async () => {
    const { ctx, store, selects } = makeContext();
    seedAuthors(store, 1);

    await loadOneBy<AuthorRow>(ctx, byId, 'u0');

    expect(selects()[0]).toMatchObject({
      type: 'SELECT',
      table: AUTHORS,
      limit: 1,
      where: [{ column: 'id', operator: '=', value: 'u0' }],
    });
  });

  it('withBatching leaves the original context unbatched, so clients built from it are unchanged', () => {
    const { ctx } = makeContext();
    const batched = withBatching(ctx);
    expect(ctx.batch).toBeUndefined();
    expect(batched.batch).toBeDefined();
    expect(batched.query).toBe(ctx.query);
  });

  it('withBatching is idempotent — re-wrapping keeps the same scope rather than nesting one', () => {
    const { ctx } = makeContext();
    const once = withBatching(ctx);
    expect(withBatching(once)).toBe(once);
  });
});

describe('per-tick coalescing', () => {
  it('collapses fifty lookups issued in one tick into a single whereIn request', async () => {
    const { ctx, store, selects } = makeContext();
    const seeded = seedAuthors(store, 50);
    const batched = withBatching(ctx);

    const rows = await Promise.all(
      seeded.map((author) => loadOneBy<AuthorRow>(batched, byId, author.id)),
    );

    expect(selects()).toHaveLength(1);
    expect(inList(selects()[0]!)).toHaveLength(50);
    expect(rows.map((row) => row?.name)).toEqual(seeded.map((author) => author.name));
  });

  it('coalesces call sites that know nothing about each other, not just one Promise.all', async () => {
    const { ctx, store, selects } = makeContext();
    seedAuthors(store, 3);
    const batched = withBatching(ctx);

    // Three unrelated fragments of a render, each asking for its own row.
    const first = loadOneBy<AuthorRow>(batched, byId, 'u0');
    const second = loadOneBy<AuthorRow>(batched, { table: AUTHORS, column: 'id' }, 'u1');
    const third = loadManyBy<AuthorRow>(batched, byId, ['u2']);

    expect(await first).toMatchObject({ name: 'Author 0' });
    expect(await second).toMatchObject({ name: 'Author 1' });
    expect(await third).toHaveLength(1);
    expect(selects()).toHaveLength(1);
  });

  it('waits for a microtask only — an already-settled tick does not join the next batch', async () => {
    const { ctx, store, selects } = makeContext();
    seedAuthors(store, 2);
    const batched = withBatching(ctx);

    await loadOneBy<AuthorRow>(batched, byId, 'u0');
    await loadOneBy<AuthorRow>(batched, byId, 'u1');

    // Two ticks, two requests. Holding the first open for the second would
    // mean taxing every lookup with a wait for siblings that may never come.
    expect(selects()).toHaveLength(2);
  });

  it('re-reads a key in a later tick instead of answering from the earlier batch', async () => {
    const { ctx, store, selects } = makeContext();
    seedAuthors(store, 1);
    const batched = withBatching(ctx);

    expect(await loadOneBy<AuthorRow>(batched, byId, 'u0')).toMatchObject({ name: 'Author 0' });
    store.rows(AUTHORS)[0]!.name = 'Renamed';
    expect(await loadOneBy<AuthorRow>(batched, byId, 'u0')).toMatchObject({ name: 'Renamed' });

    expect(selects()).toHaveLength(2);
  });

  it('sends a key loaded twice in one tick exactly once, and answers both callers', async () => {
    const { ctx, store, selects } = makeContext();
    seedAuthors(store, 2);
    const batched = withBatching(ctx);

    const [first, second, other] = await Promise.all([
      loadOneBy<AuthorRow>(batched, byId, 'u0'),
      loadOneBy<AuthorRow>(batched, byId, 'u0'),
      loadOneBy<AuthorRow>(batched, byId, 'u1'),
    ]);

    expect(inList(selects()[0]!)).toEqual(['u0', 'u1']);
    expect(first).toMatchObject({ name: 'Author 0' });
    expect(second).toMatchObject({ name: 'Author 0' });
    expect(other).toMatchObject({ name: 'Author 1' });
  });
});

describe('per-key results survive the batch', () => {
  it('resolves a key with no row to null rather than throwing or borrowing a neighbour', async () => {
    const { ctx, store } = makeContext();
    seedAuthors(store, 2);
    const batched = withBatching(ctx);

    const rows = await Promise.all([
      loadOneBy<AuthorRow>(batched, byId, 'u0'),
      loadOneBy<AuthorRow>(batched, byId, 'ghost'),
      loadOneBy<AuthorRow>(batched, byId, 'u1'),
    ]);

    expect(rows[0]).toMatchObject({ id: 'u0' });
    expect(rows[1]).toBeNull();
    expect(rows[2]).toMatchObject({ id: 'u1' });
  });

  it('resolves every key to null when the batch matches nothing at all', async () => {
    const { ctx } = makeContext();
    const batched = withBatching(ctx);

    expect(
      await Promise.all([
        loadOneBy<AuthorRow>(batched, byId, 'nobody'),
        loadOneBy<AuthorRow>(batched, byId, 'nobody-either'),
      ]),
    ).toEqual([null, null]);
  });

  it('matches rows by column value, so the order they come back in cannot leak into callers', async () => {
    const { ctx, store } = makeContext();
    // Seeded in the reverse of the load order: a loader that zipped rows to
    // keys by index would hand every caller someone else's row here, and
    // pass a test that seeded them in order.
    store.seed(AUTHORS, [
      { id: 'u2', name: 'Author 2' },
      { id: 'u1', name: 'Author 1' },
      { id: 'u0', name: 'Author 0' },
    ]);
    const batched = withBatching(ctx);

    expect(
      await loadManyBy<AuthorRow>(batched, byId, ['u0', 'u1', 'u2']),
    ).toMatchObject([{ name: 'Author 0' }, { name: 'Author 1' }, { name: 'Author 2' }]);
  });

  it('keeps loadMany positionally aligned with its keys, nulls and duplicates included', async () => {
    const { ctx, store, selects } = makeContext();
    seedAuthors(store, 2);
    const batched = withBatching(ctx);

    expect(await loadManyBy<AuthorRow>(batched, byId, ['u1', 'ghost', 'u0', 'u1'])).toMatchObject([
      { id: 'u1' },
      null,
      { id: 'u0' },
      { id: 'u1' },
    ]);
    expect(inList(selects()[0]!)).toEqual(['u1', 'ghost', 'u0']);
  });

  it('hands each caller its own row object, so annotating one does not mutate another', async () => {
    const { ctx, store } = makeContext();
    seedAuthors(store, 1);
    const batched = withBatching(ctx);

    const [mine, yours] = await Promise.all([
      loadOneBy<AuthorRow>(batched, byId, 'u0'),
      loadOneBy<AuthorRow>(batched, byId, 'u0'),
    ]);

    expect(mine).not.toBe(yours);
    (mine as Record<string, unknown>).name = 'clobbered';
    expect(yours?.name).toBe('Author 0');
  });

  it('reads a numeric key back off a numeric column', async () => {
    const { ctx, store } = makeContext();
    store.seed(AUTHORS, [
      { id: 1, name: 'Author 1' },
      { id: 2, name: 'Author 2' },
    ]);
    const batched = withBatching(ctx);

    expect(await loadManyBy<AuthorRow>(batched, byId, [2, 1])).toMatchObject([
      { name: 'Author 2' },
      { name: 'Author 1' },
    ]);
  });

  it('honours a select list, and keeps two different select lists in separate requests', async () => {
    const { ctx, store, selects } = makeContext();
    seedAuthors(store, 2);
    const batched = withBatching(ctx);

    await Promise.all([
      loadOneBy<AuthorRow>(batched, { ...byId, select: ['id', 'name'] }, 'u0'),
      loadOneBy<AuthorRow>(batched, { ...byId, select: ['id'] }, 'u1'),
    ]);

    expect(selects()).toHaveLength(2);
    expect(selects().map((payload) => payload.columns)).toEqual([['id', 'name'], ['id']]);
  });

  it('refuses a key that JSON would drop, instead of resolving it to a phantom missing row', async () => {
    const { ctx } = makeContext();
    const batched = withBatching(ctx);

    await expect(
      loadOneBy<AuthorRow>(batched, byId, undefined as unknown as BatchKey),
    ).rejects.toThrow(/must be a string or a finite number/);
    await expect(loadOneBy<AuthorRow>(batched, byId, NaN)).rejects.toThrow(/would resolve to null/);
    await expect(
      loadOneBy<AuthorRow>(batched, byId, null as unknown as BatchKey),
    ).rejects.toThrow(/got null/);
  });

  it('rejects a bad key rather than throwing past the caller catch block', async () => {
    const { ctx, store, selects } = makeContext();
    seedAuthors(store, 1);
    const loader = createBatchLoader<AuthorRow>(ctx, byId);

    // Thrown synchronously, this would escape `.catch()` entirely and kill
    // the request handler around it.
    const bad = loader.load(undefined as unknown as BatchKey);
    const good = loader.load('u0');
    await expect(bad).rejects.toThrow(/must be a string or a finite number/);
    expect(await good).toMatchObject({ name: 'Author 0' });
    // The bad key never reached the wire; the good one still batched alone.
    expect(inList(selects()[0]!)).toEqual(['u0']);
  });

  it('rejects a loadMany that was handed something other than an array', async () => {
    const { ctx } = makeContext();
    const batched = withBatching(ctx);
    await expect(
      loadManyBy<AuthorRow>(batched, byId, 'u0' as unknown as BatchKey[]),
    ).rejects.toThrow(/"keys" must be an array/);
  });
});

describe('failure containment', () => {
  it('rejects every caller in a failed batch with that batch error', async () => {
    const { ctx } = makeContext({ failWhen: () => new Error('gateway exploded') });
    const batched = withBatching(ctx);

    const first = loadOneBy<AuthorRow>(batched, byId, 'u0');
    const second = loadOneBy<AuthorRow>(batched, byId, 'u1');

    await expect(first).rejects.toThrow('gateway exploded');
    await expect(second).rejects.toThrow('gateway exploded');
  });

  it('leaves the next tick unpoisoned — a later batch succeeds after an earlier one failed', async () => {
    let broken = true;
    const { ctx, store, selects } = makeContext({
      failWhen: () => (broken ? new Error('transient') : null),
    });
    seedAuthors(store, 2);
    const batched = withBatching(ctx);

    await expect(loadOneBy<AuthorRow>(batched, byId, 'u0')).rejects.toThrow('transient');
    broken = false;
    expect(await loadOneBy<AuthorRow>(batched, byId, 'u0')).toMatchObject({ name: 'Author 0' });
    expect(selects()).toHaveLength(2);
  });

  it('splits a batch past maxBatchSize into separate requests', async () => {
    const { ctx, store, selects } = makeContext();
    seedAuthors(store, 5);
    const batched = withBatching(ctx);
    const options = { ...byId, maxBatchSize: 2 };

    const rows = await loadManyBy<AuthorRow>(batched, options, ['u0', 'u1', 'u2', 'u3', 'u4']);

    expect(rows.map((row) => row?.name)).toEqual([
      'Author 0',
      'Author 1',
      'Author 2',
      'Author 3',
      'Author 4',
    ]);
    expect(selects().map(inList)).toEqual([['u0', 'u1'], ['u2', 'u3'], ['u4']]);
  });

  it('fails only the chunk that failed, since the other chunk was a different request', async () => {
    const { ctx, store } = makeContext({
      failWhen: (payload) => (inList(payload).includes('u3') ? new Error('chunk two died') : null),
    });
    seedAuthors(store, 4);
    const batched = withBatching(ctx);
    const options = { ...byId, maxBatchSize: 2 };

    const results = await Promise.allSettled([
      loadOneBy<AuthorRow>(batched, options, 'u0'),
      loadOneBy<AuthorRow>(batched, options, 'u1'),
      loadOneBy<AuthorRow>(batched, options, 'u2'),
      loadOneBy<AuthorRow>(batched, options, 'u3'),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'rejected',
      'rejected',
    ]);
  });

  it('rejects a maxBatchSize that would make a batch impossible to send', () => {
    const { ctx } = makeContext();
    expect(() => createBatchLoader(ctx, { ...byId, maxBatchSize: 0 })).toThrow(
      /"maxBatchSize" must be a positive integer/,
    );
    expect(() => createBatchLoader(ctx, { table: '', column: 'id' })).toThrow(/"table"/);
    expect(() => createBatchLoader(ctx, { table: AUTHORS, column: '  ' })).toThrow(/"column"/);
  });
});

describe('what is allowed to share a request', () => {
  it('never merges two contexts, so one credential cannot answer another context callers', async () => {
    // The security property, stated as a test: a batch is one request under
    // one context's credential. Two ModuleContexts here hold the same table
    // with different rows, which is what one client per tenant looks like.
    const a = makeContext();
    const b = makeContext();
    a.store.seed(AUTHORS, [{ id: 'u0', name: 'tenant A row' }]);
    b.store.seed(AUTHORS, [{ id: 'u0', name: 'tenant B row' }]);
    const batchedA = withBatching(a.ctx);
    const batchedB = withBatching(b.ctx);

    const [fromA, fromB] = await Promise.all([
      loadOneBy<AuthorRow>(batchedA, byId, 'u0'),
      loadOneBy<AuthorRow>(batchedB, byId, 'u0'),
    ]);

    expect(fromA?.name).toBe('tenant A row');
    expect(fromB?.name).toBe('tenant B row');
    expect(a.selects()).toHaveLength(1);
    expect(b.selects()).toHaveLength(1);
  });

  it('never merges two scope filters — a scoped lookup gets its own request', async () => {
    const { ctx, store, selects } = makeContext();
    store.seed(AUTHORS, [
      { id: 'u0', name: 'in w1', workspace_id: 'w1' },
      { id: 'u0', name: 'in w2', workspace_id: 'w2' },
    ]);
    const batched = withBatching(ctx);

    const [inW1, inW2] = await Promise.all([
      loadOneBy<AuthorRow>(batched, { ...byId, scope: { workspace_id: 'w1' } }, 'u0'),
      loadOneBy<AuthorRow>(batched, { ...byId, scope: { workspace_id: 'w2' } }, 'u0'),
    ]);

    expect(inW1?.name).toBe('in w1');
    expect(inW2?.name).toBe('in w2');
    expect(selects()).toHaveLength(2);
  });

  it('applies scope filters to every batched query, IS NULL included', async () => {
    const { ctx, store, selects } = makeContext();
    store.seed(AUTHORS, [
      { id: 'u0', name: 'live', deleted_at: null },
      { id: 'u1', name: 'gone', deleted_at: '2026-01-01T00:00:00.000Z' },
    ]);
    const batched = withBatching(ctx);
    const live = { ...byId, scope: { deleted_at: null } };

    expect(await loadManyBy<AuthorRow>(batched, live, ['u0', 'u1'])).toMatchObject([
      { name: 'live' },
      null,
    ]);
    expect(selects()[0]!.where).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column: 'deleted_at', operator: 'IS NULL' }),
      ]),
    );
  });

  it('shares one loader between equivalent options written in a different key order', async () => {
    const { ctx, store, selects } = makeContext();
    store.seed(AUTHORS, [
      { id: 'u0', name: 'Author 0', workspace_id: 'w1', role: 'editor' },
      { id: 'u1', name: 'Author 1', workspace_id: 'w1', role: 'editor' },
    ]);
    const batched = withBatching(ctx);

    await Promise.all([
      loadOneBy<AuthorRow>(batched, { ...byId, scope: { workspace_id: 'w1', role: 'editor' } }, 'u0'),
      loadOneBy<AuthorRow>(batched, { ...byId, scope: { role: 'editor', workspace_id: 'w1' } }, 'u1'),
    ]);

    expect(selects()).toHaveLength(1);
  });

  it('keeps a directly created loader out of the context scope it was not registered in', async () => {
    const { ctx, store, selects } = makeContext();
    seedAuthors(store, 2);
    const batched = withBatching(ctx);
    const standalone = createBatchLoader<AuthorRow>(ctx, byId);

    await Promise.all([standalone.load('u0'), loadOneBy<AuthorRow>(batched, byId, 'u1')]);

    // Two loaders, two batches. A loader you hold yourself is yours; the
    // shared scope is the thing call sites coalesce through.
    expect(selects()).toHaveLength(2);
  });
});

describe('ModulesClient.enableBatching', () => {
  const makeModules = () => {
    const post = jest.fn(() => Promise.resolve({ data: [] }));
    const http = { post } as unknown as HttpClient;
    return new ModulesClient(http, new MigrationsClient(http));
  };

  /** The context a module client captured, for asserting on what it got. */
  const ctxOf = (client: unknown) => (client as { ctx: ModuleContext }).ctx;

  it('gives module clients no batch scope unless it is called', () => {
    const modules = makeModules();
    modules.use('cms');
    expect(ctxOf(modules.cms).batch).toBeUndefined();
  });

  it('gives module clients a batch scope when it is called before the first accessor', () => {
    const modules = makeModules();
    modules.enableBatching();
    modules.use('cms');
    expect(ctxOf(modules.cms).batch).toBeDefined();
  });

  it('refuses to switch after a module client was built, rather than batching only some of them', () => {
    const modules = makeModules();
    modules.use('cms');
    expect(modules.cms).toBeDefined();
    expect(() => modules.enableBatching()).toThrow(/already been built \(cms\)/);
    expect(() => modules.enableBatching()).toThrow(/before the first/);
    expect(ctxOf(modules.cms).batch).toBeUndefined();
  });

  it('is a no-op the second time, so a shared bootstrap can call it freely', () => {
    const modules = makeModules();
    modules.enableBatching();
    modules.enableBatching();
    modules.use('cms');
    expect(ctxOf(modules.cms).batch).toBeDefined();
  });

  it('shares one batch scope across every module in the client', () => {
    const modules = makeModules();
    modules.enableBatching();
    modules.use('cms');
    modules.use('forms');
    expect(ctxOf(modules.cms).batch).toBe(ctxOf(modules.forms).batch);
  });
});
