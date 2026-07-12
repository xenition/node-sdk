import { createHash } from 'crypto';
import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';
import {
  MigrationsClient,
  MIGRATIONS_LEDGER_TABLE,
  sha256Hex,
} from './migrations-client';
import { Migration, MigrationLedgerRow } from './types';

/**
 * The client's only dependency is `http.post` (via QueryClient.raw), so a
 * bare mock stands in for the whole HttpClient — same pattern as the
 * query-builder suite. Every call lands on the RAW endpoint with
 * `{sql, params}`.
 */
const makeHttp = (ledgerRows: MigrationLedgerRow[] = []) => {
  const post = jest.fn((url: string, body: { sql: string; params: unknown[] }) => {
    if (body.sql.startsWith('SELECT id, checksum')) {
      return Promise.resolve({ data: ledgerRows });
    }
    return Promise.resolve({ data: [] });
  });
  return { post, http: { post } as unknown as HttpClient };
};

const sqlOf = (post: jest.Mock): string[] =>
  post.mock.calls.map((call) => (call[1] as { sql: string }).sql);

const checksum = (sql: string): string =>
  createHash('sha256').update(sql, 'utf8').digest('hex');

const M1: Migration = { id: 'demo/0001_a', sql: 'CREATE TABLE IF NOT EXISTS a (id text)' };
const M2: Migration = { id: 'demo/0002_b', sql: 'CREATE TABLE IF NOT EXISTS b (id text)' };

describe('sha256Hex', () => {
  it('matches the sha-256 known vector for the empty string', async () => {
    await expect(sha256Hex('')).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('agrees with node crypto for arbitrary input', async () => {
    await expect(sha256Hex(M1.sql)).resolves.toBe(checksum(M1.sql));
  });
});

describe('input validation', () => {
  it('rejects a non-array', async () => {
    const { http } = makeHttp();
    await expect(
      new MigrationsClient(http).apply(undefined as unknown as Migration[]),
    ).rejects.toThrow(/must be an array/);
  });

  it('rejects a migration without an id', async () => {
    const { http } = makeHttp();
    await expect(
      new MigrationsClient(http).apply([{ id: '', sql: 'SELECT 1' }]),
    ).rejects.toThrow(/non-empty string "id"/);
  });

  it('rejects a migration without sql', async () => {
    const { http } = makeHttp();
    await expect(
      new MigrationsClient(http).apply([{ id: 'x', sql: '  ' }]),
    ).rejects.toThrow(/"x" needs a non-empty string "sql"/);
  });

  it('rejects duplicate ids in the input set', async () => {
    const { http, post } = makeHttp();
    await expect(
      new MigrationsClient(http).apply([M1, { ...M2, id: M1.id }]),
    ).rejects.toThrow(/duplicate migration id "demo\/0001_a"/);
    // Validation happens before anything touches the network.
    expect(post).not.toHaveBeenCalled();
  });
});

describe('ledger bootstrap', () => {
  it('ensures the ledger table (CREATE IF NOT EXISTS) before anything else', async () => {
    const { http, post } = makeHttp();
    await new MigrationsClient(http).apply([]);
    const sqls = sqlOf(post);
    expect(sqls[0]).toContain(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_LEDGER_TABLE}`);
    expect(sqls[1]).toBe(`SELECT id, checksum FROM ${MIGRATIONS_LEDGER_TABLE}`);
    expect(post).toHaveBeenCalledTimes(2);
    for (const call of post.mock.calls) {
      expect(call[0]).toBe(API_ENDPOINTS.QUERY.RAW);
    }
  });

  it('an empty migration set resolves to nothing applied or skipped', async () => {
    const { http } = makeHttp();
    await expect(new MigrationsClient(http).apply([])).resolves.toEqual({
      applied: [],
      skipped: [],
    });
  });
});

describe('applying migrations', () => {
  it('runs unapplied migrations in array order and records id + checksum after each', async () => {
    const { http, post } = makeHttp();
    const result = await new MigrationsClient(http).apply([M1, M2]);

    expect(result).toEqual({ applied: [M1.id, M2.id], skipped: [] });
    // ensure, select, m1, record(m1), m2, record(m2) — strictly interleaved.
    const sqls = sqlOf(post);
    expect(sqls).toHaveLength(6);
    expect(sqls[2]).toBe(M1.sql);
    expect(sqls[3]).toContain(`INSERT INTO ${MIGRATIONS_LEDGER_TABLE}`);
    expect(sqls[4]).toBe(M2.sql);
    expect(sqls[5]).toContain(`INSERT INTO ${MIGRATIONS_LEDGER_TABLE}`);
  });

  it('records the sha-256 checksum of the exact sql as ledger params', async () => {
    const { http, post } = makeHttp();
    await new MigrationsClient(http).apply([M1]);
    const recordCall = post.mock.calls[3]!;
    expect((recordCall[1] as { params: unknown[] }).params).toEqual([
      M1.id,
      checksum(M1.sql),
    ]);
  });

  it('skips already-applied migrations whose checksum matches (idempotent re-apply)', async () => {
    const { http, post } = makeHttp([
      { id: M1.id, checksum: checksum(M1.sql) },
      { id: M2.id, checksum: checksum(M2.sql) },
    ]);
    const result = await new MigrationsClient(http).apply([M1, M2]);
    expect(result).toEqual({ applied: [], skipped: [M1.id, M2.id] });
    // Only the ensure + ledger select — neither migration re-ran.
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('applies only the not-yet-recorded tail of a partially applied set', async () => {
    const { http, post } = makeHttp([{ id: M1.id, checksum: checksum(M1.sql) }]);
    const result = await new MigrationsClient(http).apply([M1, M2]);
    expect(result).toEqual({ applied: [M2.id], skipped: [M1.id] });
    const sqls = sqlOf(post);
    expect(sqls).toContain(M2.sql);
    expect(sqls).not.toContain(M1.sql);
  });

  it('throws a descriptive error when a recorded checksum differs from the current sql', async () => {
    const { http, post } = makeHttp([{ id: M1.id, checksum: 'deadbeef' }]);
    await expect(new MigrationsClient(http).apply([M1])).rejects.toThrow(
      new RegExp(
        `checksum mismatch for migration "${M1.id}".*deadbeef.*${checksum(M1.sql)}`,
      ),
    );
    // Never silently re-runs the edited migration.
    expect(sqlOf(post)).not.toContain(M1.sql);
  });

  it('a mismatch mid-set stops before the offending migration runs', async () => {
    const { http, post } = makeHttp([{ id: M2.id, checksum: 'deadbeef' }]);
    await expect(new MigrationsClient(http).apply([M1, M2])).rejects.toThrow(
      /checksum mismatch/,
    );
    const sqls = sqlOf(post);
    expect(sqls).toContain(M1.sql); // ran fine, in order, before the throw
    expect(sqls).not.toContain(M2.sql);
  });

  it('propagates the server error when a migration statement fails, without recording it', async () => {
    const { http, post } = makeHttp();
    post.mockImplementation((url: string, body: { sql: string }) => {
      if (body.sql.startsWith('SELECT id, checksum')) return Promise.resolve({ data: [] });
      if (body.sql === M1.sql) return Promise.reject(new Error('syntax error'));
      return Promise.resolve({ data: [] });
    });
    await expect(new MigrationsClient(http).apply([M1, M2])).rejects.toThrow('syntax error');
    const sqls = sqlOf(post);
    expect(sqls.filter((s) => s.startsWith('INSERT INTO'))).toHaveLength(0);
    expect(sqls).not.toContain(M2.sql); // sequencing stops at the failure
  });
});
