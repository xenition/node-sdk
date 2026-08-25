import { Migration } from '../../migrations/types';
import { ModuleContext } from '../core';
export declare const QUOTAS_TABLE = "quotas__counters";
export declare const QUOTAS_MIGRATIONS: Migration[];
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
export declare class QuotasClient {
    private readonly ctx;
    constructor(ctx: ModuleContext);
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
    consume(subject: string, key: string, options: ConsumeOptions): Promise<QuotaState>;
    /** Read a quota without consuming — for showing "2 of 5 used". */
    peek(subject: string, key: string, options: ConsumeOptions): Promise<QuotaState>;
    /** Zero a quota — a support gesture, or a plan upgrade taking effect. */
    reset(subject: string, key: string, period?: QuotaPeriod): Promise<void>;
    /**
     * Delete counters for windows that have rolled over. Run from the nightly
     * cron — the table is append-per-window and grows forever otherwise.
     */
    purge(olderThanDays?: number): Promise<number>;
    private state;
    private requirePeriod;
}
/**
 * Start of the window containing `now`, in UTC.
 *
 * Windows are aligned to calendar boundaries rather than rolling from first
 * use, because "5 a month" has to mean the same thing for every user — a
 * per-user rolling window makes support conversations impossible and lets
 * someone who signed up on the 31st get a shorter month.
 */
export declare function periodStartFor(period: QuotaPeriod, now: Date): string;
/** When the window starting at `periodStart` rolls over. */
export declare function periodEndFor(period: QuotaPeriod, periodStart: string): string | null;
export declare const quotasModule: import("../core").ModuleDefinition<QuotasClient>;
//# sourceMappingURL=quotas-client.d.ts.map