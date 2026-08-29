import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';
import { QueryBuilder } from './query-builder';
import { QueryPayload } from './types';

/**
 * The builder's only dependency is `http.post`, so a bare mock stands in
 * for the whole HttpClient. IR assertions go through `toPayload()`;
 * terminal/thenable assertions go through the mock.
 */
const makeHttp = () => {
  const post = jest.fn();
  return { post, http: { post } as unknown as HttpClient };
};

const builder = <T = Record<string, unknown>>(
  http?: HttpClient,
): QueryBuilder<T> =>
  new QueryBuilder<T>(http ?? makeHttp().http);

describe('IR: entry points', () => {
  it('from() produces a SELECT * payload', () => {
    expect(builder().from('users').toPayload()).toEqual({
      type: 'SELECT',
      table: 'users',
      columns: ['*'],
    });
  });

  it('insert() with a single object serializes data as an object', () => {
    const payload = builder().from('users').insert({ name: 'ada' }).toPayload();
    expect(payload.type).toBe('INSERT');
    expect(payload.data).toEqual({ name: 'ada' });
    expect(payload.columns).toBeUndefined(); // SELECT-only field
  });

  it('insert() with an array serializes data as an array', () => {
    const rows = [{ name: 'ada' }, { name: 'grace' }];
    expect(builder().from('users').insert(rows).toPayload().data).toEqual(rows);
  });

  it('update() carries the patch object', () => {
    const payload = builder()
      .from('users')
      .update({ active: false })
      .where('id', 'u_1')
      .toPayload();
    expect(payload.type).toBe('UPDATE');
    expect(payload.data).toEqual({ active: false });
    expect(payload.where).toEqual([
      { column: 'id', operator: '=', value: 'u_1', type: 'AND' },
    ]);
  });

  it('delete() emits a bare DELETE payload', () => {
    const payload = builder().from('users').delete().where('id', 1).toPayload();
    expect(payload).toEqual({
      type: 'DELETE',
      table: 'users',
      where: [{ column: 'id', operator: '=', value: 1, type: 'AND' }],
    });
  });
});

describe('IR: select shape', () => {
  it('select() replaces the column list; empty select restores *', () => {
    expect(builder().from('t').select('a', 'b').toPayload().columns).toEqual(['a', 'b']);
    expect(builder().from('t').select().toPayload().columns).toEqual(['*']);
  });

  it('distinct() sets the flag', () => {
    expect(builder().from('t').distinct().toPayload().distinct).toBe(true);
    expect(builder().from('t').toPayload().distinct).toBeUndefined();
  });
});

describe('IR: where family', () => {
  const wheres = (payload: QueryPayload) => payload.where ?? [];

  it('where(column, value) defaults the operator to =', () => {
    expect(wheres(builder().from('t').where('a', 5).toPayload())).toEqual([
      { column: 'a', operator: '=', value: 5, type: 'AND' },
    ]);
  });

  it('where(column, op, value) uses the explicit operator', () => {
    expect(wheres(builder().from('t').where('a', '>', 5).toPayload())).toEqual([
      { column: 'a', operator: '>', value: 5, type: 'AND' },
    ]);
  });

  it('orWhere marks the condition type OR', () => {
    expect(
      wheres(builder().from('t').where('a', 1).orWhere('b', '<', 2).toPayload()),
    ).toEqual([
      { column: 'a', operator: '=', value: 1, type: 'AND' },
      { column: 'b', operator: '<', value: 2, type: 'OR' },
    ]);
  });

  it('whereIn / whereNotIn carry the value arrays', () => {
    expect(
      wheres(
        builder().from('t').whereIn('id', [1, 2]).whereNotIn('id', [3]).toPayload(),
      ),
    ).toEqual([
      { column: 'id', operator: 'IN', value: [1, 2], type: 'AND' },
      { column: 'id', operator: 'NOT IN', value: [3], type: 'AND' },
    ]);
  });

  it('whereNull / whereNotNull use null values', () => {
    expect(
      wheres(builder().from('t').whereNull('a').whereNotNull('b').toPayload()),
    ).toEqual([
      { column: 'a', operator: 'IS NULL', value: null, type: 'AND' },
      { column: 'b', operator: 'IS NOT NULL', value: null, type: 'AND' },
    ]);
  });

  it('whereBetween packs [min, max]', () => {
    expect(wheres(builder().from('t').whereBetween('n', 1, 9).toPayload())).toEqual([
      { column: 'n', operator: 'BETWEEN', value: [1, 9], type: 'AND' },
    ]);
  });

  it('whereLike / whereILike', () => {
    expect(
      wheres(builder().from('t').whereLike('name', 'a%').whereILike('name', 'B%').toPayload()),
    ).toEqual([
      { column: 'name', operator: 'LIKE', value: 'a%', type: 'AND' },
      { column: 'name', operator: 'ILIKE', value: 'B%', type: 'AND' },
    ]);
  });

  it('whereRaw wraps sql + params with an empty column', () => {
    expect(
      wheres(builder().from('t').whereRaw('a = ?', [1]).toPayload()),
    ).toEqual([
      {
        column: '',
        operator: 'RAW',
        value: { sql: 'a = ?', params: [1] },
        type: 'AND',
      },
    ]);
    expect(
      wheres(builder().from('t').whereRaw('b IS NULL').toPayload()),
    ).toEqual([
      {
        column: '',
        operator: 'RAW',
        value: { sql: 'b IS NULL', params: [] },
        type: 'AND',
      },
    ]);
  });

  it('AND shorthands map to the right operators', () => {
    const payload = builder()
      .from('t')
      .gt('a', 1)
      .gte('b', 2)
      .lt('c', 3)
      .lte('d', 4)
      .ne('e', 5)
      .in('f', [6])
      .notIn('g', [7])
      .like('h', 'x%')
      .ilike('i', 'y%')
      .isNull('j')
      .isNotNull('k')
      .between('l', 8, 9)
      .toPayload();
    expect(wheres(payload)).toEqual([
      { column: 'a', operator: '>', value: 1, type: 'AND' },
      { column: 'b', operator: '>=', value: 2, type: 'AND' },
      { column: 'c', operator: '<', value: 3, type: 'AND' },
      { column: 'd', operator: '<=', value: 4, type: 'AND' },
      { column: 'e', operator: '!=', value: 5, type: 'AND' },
      { column: 'f', operator: 'IN', value: [6], type: 'AND' },
      { column: 'g', operator: 'NOT IN', value: [7], type: 'AND' },
      { column: 'h', operator: 'LIKE', value: 'x%', type: 'AND' },
      { column: 'i', operator: 'ILIKE', value: 'y%', type: 'AND' },
      { column: 'j', operator: 'IS NULL', value: null, type: 'AND' },
      { column: 'k', operator: 'IS NOT NULL', value: null, type: 'AND' },
      { column: 'l', operator: 'BETWEEN', value: [8, 9], type: 'AND' },
    ]);
  });

  it('OR shorthands mark type OR', () => {
    const payload = builder()
      .from('t')
      .orGt('a', 1)
      .orGte('b', 2)
      .orLt('c', 3)
      .orLte('d', 4)
      .orNe('e', 5)
      .orLike('f', 'x%')
      .orIlike('g', 'y%')
      .orIn('h', [6])
      .toPayload();
    expect((payload.where ?? []).every((w) => w.type === 'OR')).toBe(true);
    expect(payload.where).toHaveLength(8);
  });
});

describe('IR: joins', () => {
  it('serializes each join flavor', () => {
    const payload = builder()
      .from('orders')
      .join('users', 'orders.user_id', '=', 'users.id')
      .leftJoin('coupons', 'orders.coupon_id', '=', 'coupons.id')
      .rightJoin('shops', 'orders.shop_id', '=', 'shops.id')
      .fullJoin('audits', 'orders.id', '=', 'audits.order_id')
      .toPayload();
    expect(payload.joins).toEqual([
      { type: 'INNER', table: 'users', firstColumn: 'orders.user_id', operator: '=', secondColumn: 'users.id' },
      { type: 'LEFT', table: 'coupons', firstColumn: 'orders.coupon_id', operator: '=', secondColumn: 'coupons.id' },
      { type: 'RIGHT', table: 'shops', firstColumn: 'orders.shop_id', operator: '=', secondColumn: 'shops.id' },
      { type: 'FULL', table: 'audits', firstColumn: 'orders.id', operator: '=', secondColumn: 'audits.order_id' },
    ]);
  });
});

describe('IR: grouping, ordering, pagination', () => {
  it('groupBy + having (explicit operator and = default)', () => {
    const payload = builder()
      .from('orders')
      .groupBy('status', 'shop_id')
      .having('count', '>', 5)
      .having('status', 'open')
      .toPayload();
    expect(payload.groupBy).toEqual(['status', 'shop_id']);
    expect(payload.having).toEqual([
      { column: 'count', operator: '>', value: 5, type: 'AND' },
      { column: 'status', operator: '=', value: 'open', type: 'AND' },
    ]);
  });

  it('orderBy normalizes direction case and defaults to ASC', () => {
    const payload = builder()
      .from('t')
      .orderBy('a')
      .orderBy('b', 'desc')
      .orderBy('c', 'DESC')
      .orderBy('d', 'asc')
      .toPayload();
    expect(payload.orderBy).toEqual([
      { column: 'a', direction: 'ASC' },
      { column: 'b', direction: 'DESC' },
      { column: 'c', direction: 'DESC' },
      { column: 'd', direction: 'ASC' },
    ]);
  });

  it('limit / offset are only emitted when set', () => {
    expect(builder().from('t').limit(10).offset(5).toPayload()).toEqual(
      expect.objectContaining({ limit: 10, offset: 5 }),
    );
    const bare = builder().from('t').toPayload();
    expect(bare.limit).toBeUndefined();
    expect(bare.offset).toBeUndefined();
  });

  it('paginate translates page/perPage to limit/offset (default perPage 20)', () => {
    expect(builder().from('t').paginate(3, 10).toPayload()).toEqual(
      expect.objectContaining({ limit: 10, offset: 20 }),
    );
    expect(builder().from('t').paginate(1).toPayload()).toEqual(
      expect.objectContaining({ limit: 20, offset: 0 }),
    );
  });

  it('returning() defaults to * and accepts columns', () => {
    expect(
      builder().from('t').insert({ a: 1 }).returning().toPayload().returning,
    ).toEqual(['*']);
    expect(
      builder().from('t').insert({ a: 1 }).returning('id', 'created_at').toPayload()
        .returning,
    ).toEqual(['id', 'created_at']);
  });
});

describe('aggregates', () => {
  it('sum/avg/min/max rewrite the select list', () => {
    expect(builder().from('t').sum('amount').toPayload().columns).toEqual(['SUM(amount) as sum']);
    expect(builder().from('t').avg('amount').toPayload().columns).toEqual(['AVG(amount) as avg']);
    expect(builder().from('t').min('amount').toPayload().columns).toEqual(['MIN(amount) as min']);
    expect(builder().from('t').max('amount').toPayload().columns).toEqual(['MAX(amount) as max']);
  });

  it('count() POSTs table/column/where to the count endpoint', async () => {
    const { post, http } = makeHttp();
    post.mockResolvedValue({ count: 7 });
    const n = await builder(http).from('users').where('active', true).count();
    expect(n).toBe(7);
    expect(post).toHaveBeenCalledWith(API_ENDPOINTS.QUERY.COUNT, {
      table: 'users',
      column: '*',
      where: [{ column: 'active', operator: '=', value: true, type: 'AND' }],
    });
  });

  it('count() defaults to 0 when the server omits the count', async () => {
    const { post, http } = makeHttp();
    post.mockResolvedValue({});
    await expect(builder(http).from('users').count('id')).resolves.toBe(0);
    expect(post).toHaveBeenCalledWith(
      API_ENDPOINTS.QUERY.COUNT,
      expect.objectContaining({ column: 'id' }),
    );
  });

  it('exists() POSTs to the exists endpoint and coerces strictly', async () => {
    const { post, http } = makeHttp();
    post.mockResolvedValue({ exists: true });
    await expect(builder(http).from('t').where('id', 1).exists()).resolves.toBe(true);
    expect(post).toHaveBeenCalledWith(API_ENDPOINTS.QUERY.EXISTS, {
      table: 't',
      where: [{ column: 'id', operator: '=', value: 1, type: 'AND' }],
    });

    post.mockResolvedValue({});
    await expect(builder(http).from('t').exists()).resolves.toBe(false);
  });
});

describe('terminals and thenable behavior', () => {
  it('execute() POSTs the IR to the query endpoint and returns the result envelope', async () => {
    const { post, http } = makeHttp();
    post.mockResolvedValue({ data: [{ id: 1 }], count: 1 });
    const qb = builder(http).from('users').where('id', 1);
    const res = await qb.execute();
    expect(res).toEqual({ data: [{ id: 1 }], count: 1 });
    expect(post).toHaveBeenCalledWith(API_ENDPOINTS.QUERY.EXECUTE, qb.toPayload());
  });

  it('execute() adapts the raw {rows, rowCount} shape', async () => {
    const { post, http } = makeHttp();
    post.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 });
    await expect(builder(http).from('t').execute()).resolves.toEqual({
      data: [{ id: 1 }, { id: 2 }],
      count: 2,
    });
  });

  it('await-ing the builder executes it (thenable)', async () => {
    const { post, http } = makeHttp();
    post.mockResolvedValue({ data: [{ id: 42 }] });
    const qb = builder(http).from('users').where('id', 42);
    const res = await qb;
    expect(res).toEqual({ data: [{ id: 42 }] });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(API_ENDPOINTS.QUERY.EXECUTE, {
      type: 'SELECT',
      table: 'users',
      columns: ['*'],
      where: [{ column: 'id', operator: '=', value: 42, type: 'AND' }],
    });
  });

  it('catch() routes rejections like a promise', async () => {
    const { post, http } = makeHttp();
    post.mockRejectedValue(new Error('boom'));
    const handled = await builder(http)
      .from('t')
      .catch((err) => `caught: ${(err as Error).message}`);
    expect(handled).toBe('caught: boom');
  });

  it('row-terminal aliases resolve to the same execute IR', async () => {
    const { post, http } = makeHttp();
    post.mockResolvedValue({ data: [{ id: 1 }] });
    const qb = builder(http).from('users');
    const expectedPayload = qb.toPayload();

    await expect(qb.rows()).resolves.toEqual([{ id: 1 }]);
    await expect(qb.get()).resolves.toEqual([{ id: 1 }]);
    await expect(qb.all()).resolves.toEqual([{ id: 1 }]);
    await expect(qb.fetch()).resolves.toEqual([{ id: 1 }]);
    await expect(qb.toArray()).resolves.toEqual([{ id: 1 }]);
    await expect(qb.run()).resolves.toEqual({ data: [{ id: 1 }] });
    await expect(qb.exec()).resolves.toEqual({ data: [{ id: 1 }] });

    for (const call of post.mock.calls) {
      expect(call[0]).toBe(API_ENDPOINTS.QUERY.EXECUTE);
      expect(call[1]).toEqual(expectedPayload);
    }
    expect(post).toHaveBeenCalledTimes(7);
  });

  it('first() forces limit 1 and returns the row or null', async () => {
    const { post, http } = makeHttp();
    post.mockResolvedValue({ data: [{ id: 'a' }] });
    await expect(builder(http).from('t').first()).resolves.toEqual({ id: 'a' });
    expect(post).toHaveBeenCalledWith(
      API_ENDPOINTS.QUERY.EXECUTE,
      expect.objectContaining({ limit: 1 }),
    );

    post.mockResolvedValue({ data: [] });
    await expect(builder(http).from('t').first()).resolves.toBeNull();
  });

  it('single-row aliases behave like first()', async () => {
    const { post, http } = makeHttp();
    post.mockResolvedValue({ data: [{ id: 'a' }] });
    const qb = builder(http).from('t');
    await expect(qb.one()).resolves.toEqual({ id: 'a' });
    await expect(qb.find()).resolves.toEqual({ id: 'a' });
    await expect(qb.findFirst()).resolves.toEqual({ id: 'a' });
    await expect(qb.single()).resolves.toEqual({ id: 'a' });
    for (const call of post.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ limit: 1 }));
    }
  });

  it('value() selects the single column and unwraps it', async () => {
    const { post, http } = makeHttp();
    post.mockResolvedValue({ data: [{ email: 'a@b.c' }] });
    await expect(builder(http).from('users').value('email')).resolves.toBe('a@b.c');
    expect(post).toHaveBeenCalledWith(
      API_ENDPOINTS.QUERY.EXECUTE,
      expect.objectContaining({ columns: ['email'], limit: 1 }),
    );

    post.mockResolvedValue({ data: [] });
    await expect(builder(http).from('users').value('email')).resolves.toBeNull();
  });
});

describe('clone immutability on type switch', () => {
  it('insert()/update()/delete()/from() return fresh builders, leaving the source intact', () => {
    const base = builder().from('users').where('active', true).limit(5);
    const inserted = base.insert({ name: 'ada' });
    const updated = base.update({ active: false });
    const deleted = base.delete();
    const refromed = base.from('accounts');

    expect(inserted).not.toBe(base);
    expect(updated).not.toBe(base);
    expect(deleted).not.toBe(base);
    expect(refromed).not.toBe(base);

    // Source unchanged.
    expect(base.toPayload()).toEqual({
      type: 'SELECT',
      table: 'users',
      columns: ['*'],
      where: [{ column: 'active', operator: '=', value: true, type: 'AND' }],
      limit: 5,
    });

    // Derived builders switched type but inherited accumulated state.
    expect(inserted.toPayload().type).toBe('INSERT');
    expect(updated.toPayload().type).toBe('UPDATE');
    expect(deleted.toPayload().type).toBe('DELETE');
    expect(deleted.toPayload().where).toEqual(base.toPayload().where);
    expect(refromed.toPayload().table).toBe('accounts');
  });

  it('mutating a derived builder does not leak back into the source', () => {
    const base = builder().from('users').where('active', true);
    const derived = base.delete();
    derived.where('id', 99).limit(1);

    expect(base.toPayload().where).toHaveLength(1);
    expect(base.toPayload().limit).toBeUndefined();
    expect(derived.toPayload().where).toHaveLength(2);
  });
});

/**
 * `limit` belongs to SELECT alone. Reached by `.update({...}).first()`, which
 * reads like "update and give me the row back" and is the obvious thing to
 * write - it used to attach `limit: 1` to an UPDATE, and Postgres has no
 * `UPDATE ... LIMIT`.
 */
describe('limit is SELECT-only', () => {
  it('sends limit and offset on a SELECT', () => {
    expect(builder().from('t').limit(5).offset(10).toPayload()).toMatchObject({
      type: 'SELECT',
      limit: 5,
      offset: 10,
    });
  });

  it('drops limit and offset on an UPDATE', () => {
    const sent = builder().from('t').where('id', 'x').update({ a: 1 }).limit(1).offset(2).toPayload();
    expect(sent.type).toBe('UPDATE');
    expect(sent).not.toHaveProperty('limit');
    expect(sent).not.toHaveProperty('offset');
  });

  it('drops limit on a DELETE', () => {
    const sent = builder().from('t').where('id', 'x').delete().limit(1).toPayload();
    expect(sent.type).toBe('DELETE');
    expect(sent).not.toHaveProperty('limit');
  });

  it('refuses first() on a write, and names the alternative', async () => {
    await expect(
      builder().from('t').where('id', 'x').update({ a: 1 }).first(),
    ).rejects.toThrow(/cannot be used on UPDATE/);
    await expect(builder().from('t').where('id', 'x').delete().first()).rejects.toThrow(
      /returning/,
    );
  });

  it('still allows first() on a SELECT', () => {
    expect(builder().from('t').where('id', 'x').limit(1).toPayload()).toMatchObject({
      type: 'SELECT',
      limit: 1,
    });
  });
});

describe('QueryBuilder — filter values JSON cannot carry', () => {
  /**
   * Found by running the lab against api-dev: `?minPrice=abc` produced
   * Number('abc') = NaN, which serialised to null and made the query
   * match nothing. An empty list reads as "no results", so the broken
   * filter was invisible.
   */
  const q = () => builder().from('lab__items');

  it('refuses NaN rather than sending null', () => {
    expect(() => q().where('price_cents', '>=', NaN)).toThrow(/cannot be sent as a filter/);
    expect(() => q().where('price_cents', '>=', Number('abc'))).toThrow(/NaN/);
  });

  it('refuses Infinity', () => {
    expect(() => q().where('price_cents', '<', Infinity)).toThrow(/cannot be sent as a filter/);
    expect(() => q().where('price_cents', '>', -Infinity)).toThrow(/Infinity/);
  });

  it('refuses undefined in the two-argument form, which would vanish from the payload', () => {
    expect(() => q().where('price_cents', undefined as never)).toThrow(/undefined is dropped/);
  });

  it('cannot catch undefined as the third argument — the overload hides it', () => {
    // where(col, op, value) and where(col, value) are the same signature.
    // pushWhere decides which one it got by testing `value !== undefined`,
    // so a third argument of undefined is indistinguishable from the
    // two-argument form and '>=' is read as the value. Documented rather
    // than fixed: telling them apart would mean changing the public
    // overload every caller already uses.
    expect(() => q().where('price_cents', '>=', undefined as never)).not.toThrow();
    expect(q().where('price_cents', '>=', undefined as never).toPayload().where).toEqual([
      { column: 'price_cents', operator: '=', value: '>=', type: 'AND' },
    ]);
  });

  it('still allows null — that is a real IS NULL filter', () => {
    expect(() => q().where('deleted_at', null)).not.toThrow();
  });

  it('still allows ordinary values', () => {
    expect(() => q().where('price_cents', '>=', 0)).not.toThrow();
    expect(() => q().where('title', 'Blue widget')).not.toThrow();
    expect(() => q().where('active', true)).not.toThrow();
  });

  it('guards the shorthand helpers too', () => {
    expect(() => q().gte('price_cents', NaN)).toThrow(/cannot be sent as a filter/);
    expect(() => q().lt('price_cents', NaN)).toThrow(/cannot be sent as a filter/);
  });
});

describe('QueryBuilder — paging numbers', () => {
  /**
   * The same NaN hole as above, one clause over, and worse: a limit that
   * serialises to null is not sent, so the query runs unbounded and returns
   * the whole table. Found by curling the lab with `?limit=abc` — 19 rows
   * came back from a route whose default is 10, and nothing errored.
   */
  const q = () => builder().from('lab__items');

  it('refuses a NaN limit rather than running unbounded', () => {
    expect(() => q().limit(Number('abc'))).toThrow(/runs unbounded/);
    expect(() => q().limit(NaN)).toThrow(/QueryBuilder\.limit/);
  });

  it('refuses a NaN offset, and names the symptom offset actually has', () => {
    expect(() => q().offset(Number('abc'))).toThrow(/QueryBuilder\.offset/);
    expect(() => q().offset(NaN)).toThrow(/every page comes back as the first one/);
    expect(() => q().offset(NaN)).not.toThrow(/unbounded/);
  });

  it('refuses negative and fractional counts here, not at the database', () => {
    // The server does refuse these — as `SQLSTATE 2201W` or `invalid query
    // payload`, neither of which names the call at fault.
    expect(() => q().limit(-5)).toThrow(/must not be negative/);
    expect(() => q().offset(-1)).toThrow(/must not be negative/);
    expect(() => q().limit(2.7)).toThrow(/whole number/);
  });

  it('allows the ordinary cases, zero included', () => {
    expect(() => q().limit(10).offset(0)).not.toThrow();
    expect(() => q().limit(0)).not.toThrow(); // LIMIT 0 is a legal "count only" probe
    expect(q().limit(10).offset(20).toPayload()).toMatchObject({ limit: 10, offset: 20 });
  });

  it('guards paginate before it does the arithmetic', () => {
    // (page - 1) * perPage would report a NaN offset — a call the caller
    // never made — so both arguments are checked first.
    expect(() => q().paginate(NaN)).toThrow(/QueryBuilder\.paginate/);
    expect(() => q().paginate(1, Number('abc'))).toThrow(/QueryBuilder\.paginate/);
    expect(() => q().paginate(0)).toThrow(/1-based/);
    expect(q().paginate(3, 20).toPayload()).toMatchObject({ limit: 20, offset: 40 });
  });
});

describe('QueryBuilder — stream() auto-paging', () => {
  /**
   * The loop `stream()` replaces is the one callers kept getting wrong: an
   * offset bumped before the short-page check reads one page past the data,
   * and a loop that stops only on an EMPTY page never stops at all against a
   * server that clamps `limit`. These tests pin the request count, not just
   * the rows, because the whole point is which requests are not made.
   */
  const q = () => builder().from('lab__items');

  /** A server that honours limit/offset against a fixed table of `total` rows. */
  const serve = (post: jest.Mock, total: number) =>
    post.mockImplementation((_url: string, payload: QueryPayload) => {
      const table = Array.from({ length: total }, (_, i) => ({ id: i }));
      const from = payload.offset ?? 0;
      return Promise.resolve({
        data: table.slice(from, from + (payload.limit ?? total)),
      });
    });

  const drain = async <R>(rows: AsyncIterable<R>): Promise<R[]> => {
    const out: R[] = [];
    for await (const row of rows) out.push(row);
    return out;
  };

  /** limit/offset of each request, in order. */
  const pagesRequested = (post: jest.Mock) =>
    post.mock.calls.map(([, payload]) => ({
      limit: (payload as QueryPayload).limit,
      offset: (payload as QueryPayload).offset,
    }));

  it('yields every row across as many pages as it takes', async () => {
    const { post, http } = makeHttp();
    serve(post, 25);
    const rows = await drain(builder(http).from('lab__items').stream({ pageSize: 10 }));
    expect(rows).toHaveLength(25);
    expect(rows[0]).toEqual({ id: 0 });
    expect(rows[24]).toEqual({ id: 24 });
    expect(pagesRequested(post)).toEqual([
      { limit: 10, offset: 0 },
      { limit: 10, offset: 10 },
      { limit: 10, offset: 20 },
    ]);
  });

  it('treats a short page as the end and spends no request to confirm it', async () => {
    const { post, http } = makeHttp();
    serve(post, 3);
    await expect(drain(builder(http).from('t').stream({ pageSize: 10 }))).resolves.toHaveLength(3);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('costs one final empty request only when the last page is exactly full', async () => {
    // 20 rows in pages of 10: the second page is full, and a full page cannot
    // prove it is the last one. The alternative — assuming it is — drops rows.
    const { post, http } = makeHttp();
    serve(post, 20);
    await expect(drain(builder(http).from('t').stream({ pageSize: 10 }))).resolves.toHaveLength(20);
    expect(post).toHaveBeenCalledTimes(3);
    expect(pagesRequested(post)[2]).toEqual({ limit: 10, offset: 20 });
  });

  it('terminates against a server that always returns a full page', async () => {
    // The non-terminating loop: stopping only on an empty page. A server that
    // clamps `limit` to its own maximum never sends one, so the caller's loop
    // runs forever. The caller's limit is what ends this stream.
    const { post, http } = makeHttp();
    post.mockResolvedValue({ data: Array.from({ length: 50 }, (_, i) => ({ id: i })) });
    await expect(
      drain(builder(http).from('t').limit(120).stream({ pageSize: 50 })),
    ).resolves.toHaveLength(120);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('stops at a limit() the caller already set rather than running past it', async () => {
    const { post, http } = makeHttp();
    serve(post, 1000);
    const rows = await drain(builder(http).from('t').limit(25).stream({ pageSize: 10 }));
    expect(rows).toHaveLength(25);
    expect(rows[24]).toEqual({ id: 24 });
    // The last page asks for the 5 rows still owed, not for a full page it
    // would then throw half of away.
    expect(pagesRequested(post)).toEqual([
      { limit: 10, offset: 0 },
      { limit: 10, offset: 10 },
      { limit: 5, offset: 20 },
    ]);
  });

  it('holds the caller limit even when the server returns a longer page than asked', async () => {
    const { post, http } = makeHttp();
    post.mockResolvedValue({ data: Array.from({ length: 50 }, (_, i) => ({ id: i })) });
    const rows = await drain(builder(http).from('t').limit(20).stream({ pageSize: 20 }));
    expect(rows).toHaveLength(20);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('issues no request at all for limit(0)', async () => {
    const { post, http } = makeHttp();
    serve(post, 100);
    await expect(drain(builder(http).from('t').limit(0).stream())).resolves.toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });

  it('starts from an offset() the caller already set', async () => {
    const { post, http } = makeHttp();
    serve(post, 10);
    const rows = await drain(builder(http).from('t').offset(7).stream({ pageSize: 5 }));
    expect(rows).toEqual([{ id: 7 }, { id: 8 }, { id: 9 }]);
    expect(pagesRequested(post)).toEqual([{ limit: 5, offset: 7 }]);
  });

  it('defaults to a page size of 500 and lets the caller override it', async () => {
    const { post, http } = makeHttp();
    serve(post, 1200);
    await expect(drain(builder(http).from('t').stream())).resolves.toHaveLength(1200);
    expect(pagesRequested(post)).toEqual([
      { limit: 500, offset: 0 },
      { limit: 500, offset: 500 },
      { limit: 500, offset: 1000 },
    ]);
  });

  it('carries the rest of the query — columns, where, order — onto every page', async () => {
    const { post, http } = makeHttp();
    serve(post, 12);
    await drain(
      builder(http)
        .from('lab__items')
        .select('id', 'title')
        .where('active', true)
        .orderBy('id')
        .stream({ pageSize: 10 }),
    );
    for (const [url, payload] of post.mock.calls) {
      expect(url).toBe(API_ENDPOINTS.QUERY.EXECUTE);
      expect(payload).toMatchObject({
        type: 'SELECT',
        table: 'lab__items',
        columns: ['id', 'title'],
        where: [{ column: 'active', operator: '=', value: true, type: 'AND' }],
        orderBy: [{ column: 'id', direction: 'ASC' }],
      });
    }
  });

  it('leaves the caller builder untouched, unlike first()', async () => {
    // `first()` sets limit 1 on the live builder, so a reused builder silently
    // keeps it. Streaming pages against private copies instead.
    const { post, http } = makeHttp();
    serve(post, 5);
    const qb = builder(http).from('t').where('a', 1);
    const before = qb.toPayload();
    await drain(qb.stream({ pageSize: 2 }));
    expect(qb.toPayload()).toEqual(before);
    expect(qb.toPayload().limit).toBeUndefined();
    expect(qb.toPayload().offset).toBeUndefined();
  });

  it('snapshots the builder at the stream() call, so later edits do not change the pages', async () => {
    const { post, http } = makeHttp();
    serve(post, 3);
    const qb = builder(http).from('t');
    const rows = qb.stream({ pageSize: 10 });
    qb.where('a', 1).limit(1); // after the call, before the first iteration
    await expect(drain(rows)).resolves.toHaveLength(3);
    expect(post.mock.calls[0]![1]).not.toHaveProperty('where');
  });

  it('refuses to stream anything but a SELECT, at the call site rather than on first iteration', () => {
    expect(() => q().insert({ a: 1 }).stream()).toThrow(/cannot be used on INSERT/);
    expect(() => q().update({ a: 1 }).stream()).toThrow(/cannot be used on UPDATE/);
    expect(() => q().delete().stream()).toThrow(/returning/);
  });

  it('refuses a page size of zero, which would request forever and yield nothing', () => {
    // limit(0) is legal — a count-only probe — so assertRowCount allows it and
    // stream() has to reject it separately.
    expect(() => q().limit(0)).not.toThrow();
    expect(() => q().stream({ pageSize: 0 })).toThrow(/never advances the offset/);
  });

  it('refuses a NaN or negative page size before it reaches the wire', () => {
    expect(() => q().stream({ pageSize: Number('abc') })).toThrow(/QueryBuilder\.stream/);
    expect(() => q().stream({ pageSize: -10 })).toThrow(/must not be negative/);
    expect(() => q().stream({ pageSize: 2.5 })).toThrow(/whole number/);
  });
});
