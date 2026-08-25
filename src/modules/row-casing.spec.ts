import { HttpClient } from '../core/http-client';
import { QueryClient } from '../query/query-client';
import { snakeCaseQueryClient, snakeKey, snakeRow, snakeRows } from './row-casing';

/**
 * The bug this prevents, stated plainly: the gateway camelCases rows, the
 * engine does not, and every module client reads snake_case. Against the
 * gateway `row.expires_at` was `undefined`, `isExpired(undefined)` is
 * `false` because a null expiry means perpetual, and an EXPIRED
 * subscription therefore read as `allowed: true`.
 *
 * Every unit test passed the whole time, because the fake store returns
 * what was written to it. Only a real gateway showed it.
 */
describe('snakeKey', () => {
  it('converts camelCase and leaves snake_case alone', () => {
    expect(snakeKey('expiresAt')).toBe('expires_at');
    expect(snakeKey('originalTransactionId')).toBe('original_transaction_id');
    expect(snakeKey('expires_at')).toBe('expires_at');
    expect(snakeKey('id')).toBe('id');
  });

  it('handles digits without splitting them off', () => {
    expect(snakeKey('address1Line')).toBe('address1_line');
  });
});

describe('snakeRow', () => {
  it('normalizes the gateway shape to what module clients read', () => {
    expect(snakeRow({ expiresAt: 'x', userId: 'u', status: 'active' })).toEqual({
      expires_at: 'x',
      user_id: 'u',
      status: 'active',
    });
  });

  it('is a no-op on an engine row', () => {
    const row = { expires_at: 'x', user_id: 'u' };
    expect(snakeRow(row)).toEqual(row);
  });

  it('does not let a camel duplicate overwrite the snake original', () => {
    // A runtime that sent both must not have its authoritative snake value
    // clobbered by whichever key Object.entries happened to reach last.
    expect(snakeRow({ expires_at: 'real', expiresAt: 'dupe' })).toEqual({ expires_at: 'real' });
  });

  it('leaves jsonb payloads untouched', () => {
    // `data`, `payload`, `feedback` and `raw` carry the APP's keys, not the
    // database's — rewriting them would corrupt what a module stored.
    const row = { id: '1', payload: { sessionId: 's1', userId: 'u1' } };
    expect(snakeRow(row).payload).toEqual({ sessionId: 's1', userId: 'u1' });
  });
});

describe('snakeCaseQueryClient', () => {
  const make = (data: unknown) => {
    const post = jest.fn().mockResolvedValue({ data });
    const query = new QueryClient({ post } as unknown as HttpClient);
    return { post, query: snakeCaseQueryClient(query) };
  };

  it('normalizes rows()', async () => {
    const { query } = make([{ expiresAt: 'x', userId: 'u' }]);
    await expect(query.from('t').rows()).resolves.toEqual([{ expires_at: 'x', user_id: 'u' }]);
  });

  it('normalizes first()', async () => {
    const { query } = make([{ expiresAt: 'x' }]);
    await expect(query.from('t').first()).resolves.toEqual({ expires_at: 'x' });
  });

  it('normalizes execute() inside the envelope', async () => {
    const { query } = make([{ userId: 'u' }]);
    const result = await query.from('t').execute();
    expect(result.data).toEqual([{ user_id: 'u' }]);
  });

  it('survives a chain — the wrapper is not lost on .where().orderBy()', async () => {
    const { query } = make([{ expiresAt: 'x' }]);
    const rows = await query
      .from('t')
      .where('user_id', 'u')
      .orderBy('created_at', 'DESC')
      .limit(5)
      .rows();
    expect(rows).toEqual([{ expires_at: 'x' }]);
  });

  it('leaves the outgoing payload alone — only responses are touched', async () => {
    const { post, query } = make([]);
    await query.from('t').where('user_id', 'u').rows();
    expect(post.mock.calls[0][1]).toMatchObject({
      table: 't',
      where: [expect.objectContaining({ column: 'user_id' })],
    });
  });

  it('passes non-row verbs straight through', async () => {
    const post = jest.fn().mockResolvedValue({ count: 3 });
    const query = snakeCaseQueryClient(new QueryClient({ post } as unknown as HttpClient));
    await expect(query.from('t').count()).resolves.toBe(3);
  });

  it('returns null from first() when nothing matched', async () => {
    const { query } = make([]);
    await expect(query.from('t').first()).resolves.toBeNull();
  });
});
