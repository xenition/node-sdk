import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';
import { QueryClient } from './query-client';

/**
 * `transaction` is the seam that closes the half-apply window the inventory
 * module's reserve/commit protocol was built to work around. These tests pin
 * the wire shape and the guards, since the server half does not exist yet.
 */
const makeQuery = () => {
  const post = jest.fn().mockResolvedValue({ results: [] });
  return { post, query: new QueryClient({ post } as unknown as HttpClient) };
};

const STATEMENTS = [
  { sql: 'UPDATE wallets SET credits = credits - $1 WHERE user_id = $2', params: [1, 'u1'] },
  { sql: 'INSERT INTO uses (user_id) VALUES ($1)', params: ['u1'] },
];

describe('transaction', () => {
  it('sends every statement in one request', async () => {
    const { post, query } = makeQuery();
    await query.transaction(STATEMENTS);
    expect(post).toHaveBeenCalledWith(
      API_ENDPOINTS.QUERY.TRANSACTION,
      { statements: STATEMENTS },
      undefined,
    );
  });

  it('defaults missing params to an empty array', async () => {
    const { post, query } = makeQuery();
    await query.transaction([{ sql: 'SELECT 1' }]);
    expect(post.mock.calls[0][1].statements[0]).toEqual({ sql: 'SELECT 1', params: [] });
  });

  it('returns one result per statement, positionally', async () => {
    const { post, query } = makeQuery();
    post.mockResolvedValue({ results: [{ data: [{ a: 1 }] }, { rows: [{ b: 2 }], rowCount: 1 }] });
    const results = await query.transaction(STATEMENTS);
    expect(results).toEqual([{ data: [{ a: 1 }] }, { data: [{ b: 2 }], count: 1 }]);
  });

  it('accepts a bare array response as well as { results }', async () => {
    const { post, query } = makeQuery();
    post.mockResolvedValue([{ data: [] }]);
    await expect(query.transaction([{ sql: 'SELECT 1' }])).resolves.toEqual([{ data: [] }]);
  });

  it('forwards an idempotency key', async () => {
    // The transaction protects against a PARTIAL apply, not against a whole
    // one happening twice — so a retryable caller needs both.
    const { post, query } = makeQuery();
    await query.transaction(STATEMENTS, { idempotencyKey: 'charge-1' });
    expect(post.mock.calls[0][2]).toEqual({ idempotencyKey: 'charge-1' });
  });

  it('refuses an empty or malformed statement list', async () => {
    const { post, query } = makeQuery();
    await expect(query.transaction([])).rejects.toThrow(/at least one statement/);
    await expect(query.transaction([{ sql: '  ' }])).rejects.toThrow(/statement 0 has no sql/);
    expect(post).not.toHaveBeenCalled();
  });
});

/**
 * `raw` is the second of the three read paths that returned the same row in
 * a different shape. The gateway camelCases what it sends back from `/raw`
 * but returns `.from(...)` rows verbatim, so `item.created_at` was a date
 * when the app listed and `undefined` when it queried — silently, which is
 * how an EXPIRED subscription once read as active. See row-casing.ts.
 */
describe('raw', () => {
  const makeRaw = (response: unknown) => {
    const post = jest.fn().mockResolvedValue(response);
    return { post, query: new QueryClient({ post } as unknown as HttpClient) };
  };

  it('returns rows in the same snake_case shape client.query.from(...) returns', async () => {
    const { query } = makeRaw({ data: [{ id: '1', createdAt: 'now', priceCents: 250 }] });
    const result = await query.raw('SELECT * FROM lab__items');
    expect(result.data).toEqual([{ id: '1', created_at: 'now', price_cents: 250 }]);
  });

  it('normalizes the { rows, rowCount } shape too, and keeps the count', async () => {
    const { query } = makeRaw({ rows: [{ priceCents: 250 }], rowCount: 1 });
    await expect(query.raw('SELECT * FROM lab__items')).resolves.toEqual({
      data: [{ price_cents: 250 }],
      count: 1,
    });
  });

  it('leaves a row that already arrived snake_cased exactly as it was', async () => {
    // The engine answers with the column names verbatim; normalizing an
    // already-snake row must be a no-op, not a damaging second pass.
    const rows = [{ id: '1', created_at: 'now', price_cents: 250 }];
    const { query } = makeRaw({ data: rows });
    await expect(query.raw('SELECT * FROM lab__items')).resolves.toEqual({ data: rows });
  });

  it('does not rewrite the inner keys of a jsonb column', async () => {
    // `data`, `payload` and `metadata` carry the APP's keys. Deepening the
    // normalization would corrupt exactly what the app stored.
    const { query } = makeRaw({ data: [{ createdAt: 'now', payload: { sessionId: 's1' } }] });
    const result = await query.raw('SELECT * FROM lab__events');
    expect(result.data[0]).toEqual({ created_at: 'now', payload: { sessionId: 's1' } });
  });

  it('leaves the envelope alone — only the rows inside it are touched', async () => {
    const { query } = makeRaw({ data: [], count: 0, metadata: { durationMs: 4 } });
    await expect(query.raw('SELECT 1')).resolves.toEqual({
      data: [],
      count: 0,
      metadata: { durationMs: 4 },
    });
  });

  it('sends the sql and its params unchanged', async () => {
    const { post, query } = makeRaw({ data: [] });
    await query.raw('SELECT * FROM lab__items WHERE id = $1', ['1']);
    expect(post).toHaveBeenCalledWith(API_ENDPOINTS.QUERY.RAW, {
      sql: 'SELECT * FROM lab__items WHERE id = $1',
      params: ['1'],
    });
  });
});

describe('transaction', () => {
  const makeTx = (response: unknown) => {
    const post = jest.fn().mockResolvedValue(response);
    return { post, query: new QueryClient({ post } as unknown as HttpClient) };
  };

  it('returns rows in the same snake_case shape every other read path returns', async () => {
    // transaction() posts to the same gateway family as raw(), which
    // camelCases on the way out. Without normalizing here, the primitive
    // that exists to keep two writes consistent was the one read path
    // handing back a different shape.
    const { query } = makeTx({
      results: [{ data: [{ id: '1', createdAt: 'now', priceCents: 250 }] }],
    });
    const results = await query.transaction([{ sql: 'SELECT 1' }]);
    expect(results[0]?.data).toEqual([{ id: '1', created_at: 'now', price_cents: 250 }]);
  });

  it('normalizes the { rows, rowCount } statement shape too, and keeps the count', async () => {
    const { query } = makeTx({ results: [{ rows: [{ priceCents: 250 }], rowCount: 1 }] });
    await expect(query.transaction([{ sql: 'SELECT 1' }])).resolves.toEqual([
      { data: [{ price_cents: 250 }], count: 1 },
    ]);
  });

  it('keeps results positional, one per statement', async () => {
    const { query } = makeTx({
      results: [{ data: [{ aB: 1 }] }, { data: [{ cD: 2 }] }],
    });
    const results = await query.transaction([{ sql: 'SELECT 1' }, { sql: 'SELECT 2' }]);
    expect(results.map((r) => r.data)).toEqual([[{ a_b: 1 }], [{ c_d: 2 }]]);
  });

  it('does not rewrite the inner keys of a jsonb column', async () => {
    const { query } = makeTx({
      results: [{ data: [{ metaData: { camelKey: 1 } }] }],
    });
    const results = await query.transaction([{ sql: 'SELECT 1' }]);
    expect(results[0]?.data).toEqual([{ meta_data: { camelKey: 1 } }]);
  });

  it('refuses an empty statement list with a typed error, not a bare Error', async () => {
    // A bare Error carries no `code`, so a caller branching on err.code —
    // which is what this SDK tells them to do instead of parsing messages —
    // falls through to its generic handler.
    const { query } = makeTx({ results: [] });
    await expect(query.transaction([])).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('names the statement that has no sql', async () => {
    const { query } = makeTx({ results: [] });
    await expect(
      query.transaction([{ sql: 'SELECT 1' }, { sql: '   ' }]),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: /statement 1/ });
  });
});
