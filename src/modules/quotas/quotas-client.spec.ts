import { FakeStore, makeFakeContext } from '../../testing/fake-store';
import {
  periodEndFor,
  periodStartFor,
  QuotasClient,
  QUOTAS_TABLE,
} from './quotas-client';

/**
 * The counter is an `INSERT … ON CONFLICT DO UPDATE`, which the builder
 * cannot express, so the upsert is simulated against the same in-memory
 * rows. Getting that wrong is the whole risk here — a quota that is not
 * atomic is not a quota — so the simulation mirrors the real statement's
 * conflict target rather than stubbing the call away.
 */
const rawHandler = (sql: string, params: unknown[], store: FakeStore) => {
  const rows = store.rows(QUOTAS_TABLE) as Array<Record<string, unknown>>;

  if (sql.startsWith('INSERT')) {
    const [subject, key, periodStart, period, amount] = params as [
      string,
      string,
      string,
      string,
      number,
    ];
    const existing = rows.find(
      (row) =>
        row.subject === subject && row.quota_key === key && row.period_start === periodStart,
    );
    if (existing) {
      existing.used = Number(existing.used) + amount;
      return [{ used: existing.used }];
    }
    rows.push({
      id: `q${rows.length}`,
      subject,
      quota_key: key,
      period_start: periodStart,
      period,
      used: amount,
    });
    return [{ used: amount }];
  }

  if (sql.startsWith('UPDATE')) {
    const [amount, subject, key, periodStart] = params as [number, string, string, string];
    const row = rows.find(
      (r) => r.subject === subject && r.quota_key === key && r.period_start === periodStart,
    );
    if (row) row.used = Math.max(0, Number(row.used) - amount);
    return [];
  }

  if (sql.startsWith('DELETE')) {
    const [cutoff] = params as [string];
    const doomed = rows.filter(
      (row) => row.period !== 'total' && String(row.period_start) < cutoff,
    );
    store.tables.set(
      QUOTAS_TABLE,
      rows.filter((row) => !doomed.includes(row)),
    );
    return doomed.map((row) => ({ id: row.id }));
  }

  throw new Error(`unexpected SQL: ${sql.slice(0, 40)}`);
};

const makeQuotas = () => {
  const { store, ctx } = makeFakeContext({ raw: rawHandler });
  return { store, quotas: new QuotasClient(ctx) };
};

const FIVE = { limit: 5, period: 'month' as const };

describe('consume', () => {
  it('counts up and reports what is left', async () => {
    const { quotas } = makeQuotas();
    expect(await quotas.consume('user-1', 'analysis', FIVE)).toMatchObject({
      allowed: true,
      used: 1,
      limit: 5,
      remaining: 4,
    });
    await quotas.consume('user-1', 'analysis', FIVE);
    expect(await quotas.consume('user-1', 'analysis', FIVE)).toMatchObject({
      used: 3,
      remaining: 2,
    });
  });

  it('allows exactly the limit and refuses the next', async () => {
    const { quotas } = makeQuotas();
    for (let i = 0; i < 5; i++) {
      expect((await quotas.consume('user-1', 'analysis', FIVE)).allowed).toBe(true);
    }
    expect(await quotas.consume('user-1', 'analysis', FIVE)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });

  it('gives back what a refused call took', async () => {
    // Otherwise a client that keeps retrying inflates the counter and the
    // window drifts further out of reach with every attempt.
    const { store, quotas } = makeQuotas();
    for (let i = 0; i < 5; i++) await quotas.consume('user-1', 'analysis', FIVE);
    await quotas.consume('user-1', 'analysis', FIVE);
    await quotas.consume('user-1', 'analysis', FIVE);
    expect(store.rows(QUOTAS_TABLE)[0]!.used).toBe(5);
  });

  it('keeps subjects and keys apart', async () => {
    const { quotas } = makeQuotas();
    await quotas.consume('user-1', 'analysis', FIVE);
    expect((await quotas.consume('user-2', 'analysis', FIVE)).used).toBe(1);
    expect((await quotas.consume('user-1', 'export', FIVE)).used).toBe(1);
  });

  it('consumes more than one unit at a time', async () => {
    const { quotas } = makeQuotas();
    expect(await quotas.consume('user-1', 'minutes', { limit: 60, amount: 25 })).toMatchObject({
      used: 25,
      remaining: 35,
    });
  });

  it('refuses an over-budget batch without partially applying it', async () => {
    const { quotas } = makeQuotas();
    await quotas.consume('user-1', 'minutes', { limit: 60, amount: 50 });
    const result = await quotas.consume('user-1', 'minutes', { limit: 60, amount: 20 });
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(50);
  });

  it('reports when the window rolls over', async () => {
    const { quotas } = makeQuotas();
    const state = await quotas.consume('user-1', 'analysis', FIVE);
    expect(state.resetAt).toBe(periodEndFor('month', periodStartFor('month', new Date())));
  });

  it('never resets a total quota', async () => {
    const { quotas } = makeQuotas();
    expect(await quotas.consume('user-1', 'lifetime', { limit: 3, period: 'total' })).toMatchObject(
      { resetAt: null },
    );
  });

  it('validates its input', async () => {
    const { quotas } = makeQuotas();
    await expect(quotas.consume('', 'k', FIVE)).rejects.toThrow(/"subject"/);
    await expect(quotas.consume('u', 'k', { limit: -1 })).rejects.toThrow(/non-negative integer/);
    await expect(quotas.consume('u', 'k', { limit: 5, amount: 0 })).rejects.toThrow(
      /"amount" must be a positive integer/,
    );
    await expect(
      quotas.consume('u', 'k', { limit: 5, period: 'fortnight' as never }),
    ).rejects.toThrow(/"period" must be one of/);
  });

  it('a zero limit refuses everything', async () => {
    const { quotas } = makeQuotas();
    expect((await quotas.consume('u', 'k', { limit: 0 })).allowed).toBe(false);
  });
});

describe('peek', () => {
  it('reads without consuming', async () => {
    const { quotas } = makeQuotas();
    await quotas.consume('user-1', 'analysis', FIVE);
    expect(await quotas.peek('user-1', 'analysis', FIVE)).toMatchObject({ used: 1, remaining: 4 });
    expect(await quotas.peek('user-1', 'analysis', FIVE)).toMatchObject({ used: 1 });
  });

  it('reports an untouched quota as fully available', async () => {
    const { quotas } = makeQuotas();
    expect(await quotas.peek('nobody', 'analysis', FIVE)).toMatchObject({
      allowed: true,
      used: 0,
      remaining: 5,
    });
  });
});

describe('reset and purge', () => {
  it('zeroes a quota', async () => {
    const { quotas } = makeQuotas();
    await quotas.consume('user-1', 'analysis', FIVE);
    await quotas.reset('user-1', 'analysis');
    expect(await quotas.peek('user-1', 'analysis', FIVE)).toMatchObject({ used: 0 });
  });

  it('purges rolled-over windows but never a total counter', async () => {
    const { store, quotas } = makeQuotas();
    await quotas.consume('user-1', 'analysis', FIVE);
    await quotas.consume('user-1', 'lifetime', { limit: 3, period: 'total' });
    const rows = store.rows(QUOTAS_TABLE);
    rows[0]!.period_start = new Date(Date.now() - 200 * 86_400_000).toISOString();

    expect(await quotas.purge(90)).toBe(1);
    expect(store.rows(QUOTAS_TABLE)).toHaveLength(1);
    expect(store.rows(QUOTAS_TABLE)[0]!.period).toBe('total');
  });
});

describe('window boundaries', () => {
  const at = (iso: string) => new Date(iso);

  it('aligns to calendar boundaries, not to first use', () => {
    // "5 a month" has to mean the same thing for every user; a rolling
    // per-user window makes support conversations impossible.
    expect(periodStartFor('day', at('2026-08-24T13:45:00Z'))).toBe('2026-08-24T00:00:00.000Z');
    expect(periodStartFor('month', at('2026-08-24T13:45:00Z'))).toBe('2026-08-01T00:00:00.000Z');
  });

  it('starts the week on Monday', () => {
    // 2026-08-24 is a Monday; 2026-08-23 is the Sunday before it.
    expect(periodStartFor('week', at('2026-08-24T13:45:00Z'))).toBe('2026-08-24T00:00:00.000Z');
    expect(periodStartFor('week', at('2026-08-23T13:45:00Z'))).toBe('2026-08-17T00:00:00.000Z');
  });

  it('rolls a month over onto the first of the next', () => {
    expect(periodEndFor('month', '2026-08-01T00:00:00.000Z')).toBe('2026-09-01T00:00:00.000Z');
    expect(periodEndFor('month', '2026-12-01T00:00:00.000Z')).toBe('2027-01-01T00:00:00.000Z');
  });

  it('has no end for a total quota', () => {
    expect(periodEndFor('total', '1970-01-01T00:00:00.000Z')).toBeNull();
  });
});
