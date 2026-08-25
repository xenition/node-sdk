import { makeFakeContext } from './fake-store';

/**
 * Both of these were found by building a real app against the SDK, not by
 * reading it: a row cap answered 500 under test because `.count()` had no
 * endpoint to talk to, and an inserted row came back with `id: undefined`
 * because the store applied no column defaults. Everything here goes through
 * `ctx.query` — a real `QueryBuilder` over the real `QueryClient` — so the
 * test breaks if either the endpoint the builder posts to or the response
 * shape it expects ever drifts from what the store answers.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('FakeStore: count and exists', () => {
  it('count() returns the number of rows, not a 500', async () => {
    const { store, ctx } = makeFakeContext();
    store.seed('pantry', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

    await expect(ctx.query.from('pantry').count()).resolves.toBe(3);
  });

  it('count() honours the where conditions, so a per-user cap is countable', async () => {
    const { store, ctx } = makeFakeContext();
    store.seed('pantry', [
      { id: 'a', user_id: 'u1' },
      { id: 'b', user_id: 'u1' },
      { id: 'c', user_id: 'u2' },
    ]);

    await expect(ctx.query.from('pantry').where('user_id', 'u1').count()).resolves.toBe(2);
  });

  it('count() on an empty table is 0', async () => {
    const { ctx } = makeFakeContext();
    await expect(ctx.query.from('pantry').count()).resolves.toBe(0);
  });

  it('count(column) skips nulls the way COUNT(col) does', async () => {
    const { store, ctx } = makeFakeContext();
    store.seed('pantry', [{ note: 'x' }, { note: null }, {}]);

    await expect(ctx.query.from('pantry').count('note')).resolves.toBe(1);
    await expect(ctx.query.from('pantry').count()).resolves.toBe(3);
  });

  it('exists() reports true only when a matching row is there', async () => {
    const { store, ctx } = makeFakeContext();
    store.seed('pantry', [{ id: 'a', user_id: 'u1' }]);

    await expect(ctx.query.from('pantry').where('user_id', 'u1').exists()).resolves.toBe(true);
    await expect(ctx.query.from('pantry').where('user_id', 'u2').exists()).resolves.toBe(false);
    await expect(ctx.query.from('empty').exists()).resolves.toBe(false);
  });

  it('records the count/exists bodies without disturbing payloads', async () => {
    const { store, ctx } = makeFakeContext();
    await ctx.query.from('pantry').where('user_id', 'u1').count();

    expect(store.aggregates).toEqual([
      {
        table: 'pantry',
        column: '*',
        where: [{ column: 'user_id', operator: '=', value: 'u1', type: 'AND' }],
      },
    ]);
    expect(store.payloads).toEqual([]);
  });
});

describe('FakeStore: column defaults', () => {
  it('an inserted row comes back with an id a follow-up where() can find', async () => {
    const { ctx } = makeFakeContext();

    const [created] = await ctx.query
      .from('pantry')
      .insert({ name: 'oats' })
      .returning('*')
      .rows<{ id: string }>();

    expect(created!.id).toEqual(expect.stringMatching(UUID));

    const found = await ctx.query.from('pantry').where('id', created!.id).first();
    expect(found).toMatchObject({ name: 'oats', id: created!.id });
  });

  it('fills created_at and updated_at with an ISO timestamp', async () => {
    const { ctx } = makeFakeContext();

    const [created] = await ctx.query
      .from('pantry')
      .insert({ name: 'oats' })
      .returning('*')
      .rows<{ created_at: string; updated_at: string }>();

    expect(Number.isNaN(Date.parse(created!.created_at))).toBe(false);
    expect(created!.updated_at).toBe(created!.created_at);
  });

  it('an explicitly supplied value always wins', async () => {
    const { ctx } = makeFakeContext();

    const [created] = await ctx.query
      .from('pantry')
      .insert({ id: 'chosen', created_at: '2020-01-01T00:00:00.000Z', note: null })
      .returning('*')
      .rows<{ id: string; created_at: string; note: unknown }>();

    expect(created!.id).toBe('chosen');
    expect(created!.created_at).toBe('2020-01-01T00:00:00.000Z');
    // An explicit NULL beats a column default in Postgres; it must here too.
    expect(created!.note).toBeNull();
  });

  it('gives every row of a bulk insert its own id', async () => {
    const { ctx } = makeFakeContext();

    const rows = await ctx.query
      .from('pantry')
      .insert([{ name: 'oats' }, { name: 'rice' }])
      .returning('*')
      .rows<{ id: string }>();

    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).not.toBe(rows[1]!.id);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });

  it('leaves updated_at alone on UPDATE, as the column default does', async () => {
    const { ctx } = makeFakeContext();

    const [created] = await ctx.query
      .from('pantry')
      .insert({ name: 'oats' })
      .returning('*')
      .rows<{ id: string; updated_at: string }>();

    const [patched] = await ctx.query
      .from('pantry')
      .update({ name: 'rolled oats' })
      .where('id', created!.id)
      .returning('*')
      .rows<{ name: string; updated_at: string }>();

    expect(patched!.name).toBe('rolled oats');
    expect(patched!.updated_at).toBe(created!.updated_at);
  });

  it('counts rows written through the builder, ids and all', async () => {
    const { ctx } = makeFakeContext();
    await ctx.query.from('pantry').insert({ user_id: 'u1' }).returning('*').rows();
    await ctx.query.from('pantry').insert({ user_id: 'u1' }).returning('*').rows();
    await ctx.query.from('pantry').insert({ user_id: 'u2' }).returning('*').rows();

    await expect(ctx.query.from('pantry').where('user_id', 'u1').count()).resolves.toBe(2);
    await expect(ctx.query.from('pantry').count('id')).resolves.toBe(3);
  });
});
