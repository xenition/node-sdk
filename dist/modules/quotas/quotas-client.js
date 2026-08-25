"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quotasModule = exports.QuotasClient = exports.QUOTAS_MIGRATIONS = exports.QUOTAS_TABLE = void 0;
exports.periodStartFor = periodStartFor;
exports.periodEndFor = periodEndFor;
const core_1 = require("../core");
const util_1 = require("../util");
exports.QUOTAS_TABLE = 'quotas__counters';
exports.QUOTAS_MIGRATIONS = [
    {
        id: 'quotas/0001_create_quotas__counters',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.QUOTAS_TABLE} (
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
  ON ${exports.QUOTAS_TABLE} (subject, quota_key, period_start)`,
    },
];
const PERIODS = ['day', 'week', 'month', 'total'];
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
class QuotasClient {
    constructor(ctx) {
        this.ctx = ctx;
    }
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
    async consume(subject, key, options) {
        const context = 'QuotasClient.consume';
        (0, util_1.requireNonEmptyString)(context, 'subject', subject);
        (0, util_1.requireNonEmptyString)(context, 'key', key);
        const limit = options?.limit;
        if (!Number.isInteger(limit) || limit < 0) {
            (0, util_1.fail)(context, '"limit" must be a non-negative integer');
        }
        const period = this.requirePeriod(context, options?.period ?? 'month');
        const amount = options?.amount ?? 1;
        if (!Number.isInteger(amount) || amount <= 0) {
            (0, util_1.fail)(context, '"amount" must be a positive integer');
        }
        const periodStart = periodStartFor(period, new Date());
        const result = await this.ctx.raw(`INSERT INTO ${exports.QUOTAS_TABLE} (subject, quota_key, period_start, period, used, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (subject, quota_key, period_start)
         DO UPDATE SET used = ${exports.QUOTAS_TABLE}.used + EXCLUDED.used, updated_at = now()
       RETURNING used`, [subject, key, periodStart, period, amount]);
        const used = Number(result.data?.[0]?.used ?? amount);
        if (used <= limit) {
            return this.state(true, used, limit, period, periodStart);
        }
        // Over the limit: give back what this call took, so a refused request
        // does not inflate the counter and push the window further out of reach.
        await this.ctx.raw(`UPDATE ${exports.QUOTAS_TABLE} SET used = GREATEST(0, used - $1), updated_at = now()
        WHERE subject = $2 AND quota_key = $3 AND period_start = $4`, [amount, subject, key, periodStart]);
        return this.state(false, used - amount, limit, period, periodStart);
    }
    /** Read a quota without consuming — for showing "2 of 5 used". */
    async peek(subject, key, options) {
        const context = 'QuotasClient.peek';
        (0, util_1.requireNonEmptyString)(context, 'subject', subject);
        (0, util_1.requireNonEmptyString)(context, 'key', key);
        const period = this.requirePeriod(context, options?.period ?? 'month');
        const limit = options?.limit ?? 0;
        const periodStart = periodStartFor(period, new Date());
        const row = await this.ctx.query
            .from(exports.QUOTAS_TABLE)
            .where('subject', subject)
            .where('quota_key', key)
            .where('period_start', periodStart)
            .first();
        const used = Number(row?.used ?? 0);
        return this.state(used < limit, used, limit, period, periodStart);
    }
    /** Zero a quota — a support gesture, or a plan upgrade taking effect. */
    async reset(subject, key, period = 'month') {
        const context = 'QuotasClient.reset';
        (0, util_1.requireNonEmptyString)(context, 'subject', subject);
        (0, util_1.requireNonEmptyString)(context, 'key', key);
        await this.ctx.query
            .from(exports.QUOTAS_TABLE)
            .update({ used: 0, updated_at: (0, util_1.nowIso)() })
            .where('subject', subject)
            .where('quota_key', key)
            .where('period_start', periodStartFor(this.requirePeriod(context, period), new Date()))
            .execute();
    }
    /**
     * Delete counters for windows that have rolled over. Run from the nightly
     * cron — the table is append-per-window and grows forever otherwise.
     */
    async purge(olderThanDays = 90) {
        const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
        const result = await this.ctx.raw(`DELETE FROM ${exports.QUOTAS_TABLE} WHERE period <> 'total' AND period_start < $1 RETURNING id`, [cutoff]);
        return (result.data ?? []).length;
    }
    state(allowed, used, limit, period, periodStart) {
        return {
            allowed,
            used,
            limit,
            remaining: Math.max(0, limit - used),
            period,
            resetAt: period === 'total' ? null : periodEndFor(period, periodStart),
        };
    }
    requirePeriod(context, value) {
        if (!PERIODS.includes(value)) {
            (0, util_1.fail)(context, `"period" must be one of ${PERIODS.join(', ')}`);
        }
        return value;
    }
}
exports.QuotasClient = QuotasClient;
/**
 * Start of the window containing `now`, in UTC.
 *
 * Windows are aligned to calendar boundaries rather than rolling from first
 * use, because "5 a month" has to mean the same thing for every user — a
 * per-user rolling window makes support conversations impossible and lets
 * someone who signed up on the 31st get a shorter month.
 */
function periodStartFor(period, now) {
    if (period === 'total')
        return new Date(0).toISOString();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    if (period === 'day')
        return d.toISOString();
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
function periodEndFor(period, periodStart) {
    if (period === 'total')
        return null;
    const start = new Date(periodStart);
    if (period === 'day')
        start.setUTCDate(start.getUTCDate() + 1);
    else if (period === 'week')
        start.setUTCDate(start.getUTCDate() + 7);
    else
        start.setUTCMonth(start.getUTCMonth() + 1);
    return start.toISOString();
}
exports.quotasModule = (0, core_1.defineModule)({
    name: 'quotas',
    migrations: exports.QUOTAS_MIGRATIONS,
    factory: (ctx) => new QuotasClient(ctx),
});
//# sourceMappingURL=quotas-client.js.map