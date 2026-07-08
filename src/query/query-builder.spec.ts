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
