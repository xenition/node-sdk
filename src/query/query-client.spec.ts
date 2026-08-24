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
