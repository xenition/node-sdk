import { Migration } from '../../migrations/types';
import { defineModule, ModuleContext } from '../core';
import { fail, nowIso, requireNonEmptyString } from '../util';

export const QUOTAS_TABLE = 'quotas__counters';

export const QUOTAS_MIGRATIONS: Migration[] = [
  {
    id: 'quotas/0001_create_quotas__counters',
    sql: `CREATE TABLE IF NOT EXISTS ${QUOTAS_TABLE} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  quota_key text NOT NULL,
  period_start timestamptz NOT NULL,
  period text NOT NULL DEFAULT 'month',
  used integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    // The whole design rests on this index: the counter is upserted with
    // ON CONFLICT, so uniqueness is what makes the increment atomic rather
    // than a read-then-write two workers can both win.
    id: 'quotas/0002_unique_quotas__counters_window',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS quotas__counters_window_idx
  ON ${QUOTAS_TABLE} (subject, quota_key, period_start)`,
  },
];

export type QuotaPeriod = 'day' | 'week' | 'month' | 'total';

export interface ConsumeOptions {
  /** Maximum allowed in the window. Required — there is no sane default. */
  limit: number;
  /** Window length. Default `month`. `total` never resets. */
  period?: QuotaPeriod;
  /** Units to consume. Default 1. */
  amount?: number;
}

export interface QuotaState {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  period: QuotaPeriod;
  /** When the window rolls over. Null for `total`. */
  resetAt: string | null;
}

const PERIODS: QuotaPeriod[] = ['day', 'week', 'month', 'total'];

/**
 * quotas module — durable per-subject usage counters.
 *
 * Distinct from the router's rate limiter, which lives in an isolate's
 * memory and vanishes with it. That is fine for dampening abuse and useless
 * for the thing a freemium app actually needs: "five free analyses a month",
 * counted correctly across every worker, surviving a redeploy, and readable
 * so the UI can say "2 of 5 used".
 *
 *   const quota = await quotas.consume(userId, 'analysis', { limit: 5 });
 *   if (!quota.allowed) return paywall(quota);   // shows "resets on the 1st"
 *
 * `subject` is usually a user id, but any stable string works — an app id,
 * a team, an IP for anonymous limits.
 */
export class QuotasClient {
  constructor(private readonly ctx: ModuleContext) {}

  /**
   * Consume from a quota and report the state after doing so.
   *
   * Atomic: one INSERT … ON CONFLICT DO UPDATE, so concurrent requests
   * cannot both read "4 used" and both write "5". The check happens AFTER
   * the increment — the alternative is a check-then-increment race that
   * lets a burst of parallel requests through the limit, which is precisely
   * the traffic shape a quota exists to stop.
   *
   * A refused call still consumed nothing the caller can use, so `rollback`
   * is unnecessary: when `allowed` is false the increment is undone before
   * returning.
   */
  async consume(
    subject: string,
    key: string,
    options: ConsumeOptions,
  ): Promise<QuotaState> {
    const context = 'QuotasClient.consume';
    requireNonEmptyString(context, 'subject', subject);
    requireNonEmptyString(context, 'key', key);
    const limit = options?.limit;
    if (!Number.isInteger(limit) || limit < 0) {
      fail(context, '"limit" must be a non-negative integer');
    }
    const period = this.requirePeriod(context, options?.period ?? 'month');
    const amount = options?.amount ?? 1;
    if (!Number.isInteger(amount) || amount <= 0) {
      fail(context, '"amount" must be a positive integer');
    }

    const periodStart = periodStartFor(period, new Date());
    const result = await this.ctx.raw<{ used: number }>(
      `INSERT INTO ${QUOTAS_TABLE} (subject, quota_key, period_start, period, used, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (subject, quota_key, period_start)
         DO UPDATE SET used = ${QUOTAS_TABLE}.used + EXCLUDED.used, updated_at = now()
       RETURNING used`,
      [subject, key, periodStart, period, amount],
    );

    const used = Number(result.data?.[0]?.used ?? amount);
    if (used <= limit) {
      return this.state(true, used, limit, period, periodStart);
    }

    // Over the limit: give back what this call took, so a refused request
    // does not inflate the counter and push the window further out of reach.
    await this.ctx.raw(
      `UPDATE ${QUOTAS_TABLE} SET used = GREATEST(0, used - $1), updated_at = now()
        WHERE subject = $2 AND quota_key = $3 AND period_start = $4`,
      [amount, subject, key, periodStart],
    );
    return this.state(false, used - amount, limit, period, periodStart);
  }

  /** Read a quota without consuming — for showing "2 of 5 used". */
  async peek(subject: string, key: string, options: ConsumeOptions): Promise<QuotaState> {
    const context = 'QuotasClient.peek';
    requireNonEmptyString(context, 'subject', subject);
    requireNonEmptyString(context, 'key', key);
    const period = this.requirePeriod(context, options?.period ?? 'month');
    const limit = options?.limit ?? 0;
    const periodStart = periodStartFor(period, new Date());

    const row = await this.ctx.query
      .from(QUOTAS_TABLE)
      .where('subject', subject)
      .where('quota_key', key)
      .where('period_start', periodStart)
      .first<{ used: number }>();

    const used = Number(row?.used ?? 0);
    return this.state(used < limit, used, limit, period, periodStart);
  }

  /** Zero a quota — a support gesture, or a plan upgrade taking effect. */
  async reset(subject: string, key: string, period: QuotaPeriod = 'month'): Promise<void> {
    const context = 'QuotasClient.reset';
    requireNonEmptyString(context, 'subject', subject);
    requireNonEmptyString(context, 'key', key);
    await this.ctx.query
      .from(QUOTAS_TABLE)
      .update({ used: 0, updated_at: nowIso() })
      .where('subject', subject)
      .where('quota_key', key)
      .where('period_start', periodStartFor(this.requirePeriod(context, period), new Date()))
      .execute();
  }

  /**
   * Delete counters for windows that have rolled over. Run from the nightly
   * cron — the table is append-per-window and grows forever otherwise.
   */
  async purge(olderThanDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    const result = await this.ctx.raw<{ id: string }>(
      `DELETE FROM ${QUOTAS_TABLE} WHERE period <> 'total' AND period_start < $1 RETURNING id`,
      [cutoff],
    );
    return (result.data ?? []).length;
  }

  private state(
    allowed: boolean,
    used: number,
    limit: number,
    period: QuotaPeriod,
    periodStart: string,
  ): QuotaState {
    return {
      allowed,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      period,
      resetAt: period === 'total' ? null : periodEndFor(period, periodStart),
    };
  }

  private requirePeriod(context: string, value: unknown): QuotaPeriod {
    if (!PERIODS.includes(value as QuotaPeriod)) {
      fail(context, `"period" must be one of ${PERIODS.join(', ')}`);
    }
    return value as QuotaPeriod;
  }
}

/**
 * Start of the window containing `now`, in UTC.
 *
 * Windows are aligned to calendar boundaries rather than rolling from first
 * use, because "5 a month" has to mean the same thing for every user — a
 * per-user rolling window makes support conversations impossible and lets
 * someone who signed up on the 31st get a shorter month.
 */
export function periodStartFor(period: QuotaPeriod, now: Date): string {
  if (period === 'total') return new Date(0).toISOString();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  if (period === 'day') return d.toISOString();
  if (period === 'week') {
    // ISO weeks start on Monday; getUTCDay() calls Sunday 0.
    const weekday = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - weekday);
    return d.toISOString();
  }
  d.setUTCDate(1);
  return d.toISOString();
}

/** When the window starting at `periodStart` rolls over. */
export function periodEndFor(period: QuotaPeriod, periodStart: string): string | null {
  if (period === 'total') return null;
  const start = new Date(periodStart);
  if (period === 'day') start.setUTCDate(start.getUTCDate() + 1);
  else if (period === 'week') start.setUTCDate(start.getUTCDate() + 7);
  else start.setUTCMonth(start.getUTCMonth() + 1);
  return start.toISOString();
}

export const quotasModule = defineModule<QuotasClient>({
  name: 'quotas',
  migrations: QUOTAS_MIGRATIONS,
  factory: (ctx: ModuleContext) => new QuotasClient(ctx),
});
