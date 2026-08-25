import type { Hono } from 'hono';
import { XenitionClient } from '../xenition-client';
import type { JobHandler, JobsClient, WorkSummary } from '../modules/jobs';
/**
 * The `scheduled` half of a generated app's worker.
 *
 * `createXenitionApi()` returns a bare Hono — a fetch handler — so until
 * now there was nowhere in the SDK to hang recurring work. A worker with no
 * `scheduled` export cannot run a daily reminder, a weekly digest, a nightly
 * cleanup, or drain the job queue at all.
 *
 *   import { withScheduled, createXenitionApi } from '@xenition/sdk/hono';
 *
 *   const app = new Hono();
 *   app.route('/api', createXenitionApi());
 *
 *   export default withScheduled(app, {
 *     handlers: { 'speech.analyze': analyzeSpeech },   // drains the queue
 *     crons: [
 *       { name: 'daily-reminders', schedule: '0 9 * * *', run: sendReminders },
 *       { name: 'nightly-purge',   schedule: '0 3 * * *', run: ({ jobs }) => jobs.purge() },
 *     ],
 *   });
 *
 * with the matching triggers in `wrangler.toml`:
 *
 *   [triggers]
 *   crons = ["0 9 * * *", "0 3 * * *", "*&#47;5 * * * *"]
 *
 * Two things happen on every tick: the crons whose expression matches run,
 * and the job queue is drained. A tick that matches no cron still drains the
 * queue, which is why a frequent catch-all trigger is worth configuring —
 * that is what makes `jobs.enqueue()` actually execute.
 */
/** What a cron function is handed. */
export interface ScheduledContext {
    /** Service-key client for this app. */
    client: XenitionClient;
    /** The jobs module, already unlocked. */
    jobs: JobsClient;
    /** The cron expression that fired, when the platform reported one. */
    cron: string | null;
    /** Tick time, as reported by the platform. */
    scheduledAt: Date;
    /** The worker's env bindings. */
    env: Record<string, unknown>;
}
export interface CronJob {
    /** Stable name — the key the run ledger is written under. */
    name: string;
    /**
     * The cron expression this job belongs to, matching a `wrangler.toml`
     * trigger. Omit to run on EVERY tick.
     */
    schedule?: string;
    run(context: ScheduledContext): Promise<unknown> | unknown;
}
export interface ScheduledOptions {
    /** Use this client instead of building one from the worker env. */
    client?: XenitionClient;
    /** Recurring work, dispatched by cron expression. */
    crons?: CronJob[];
    /** Job type → handler. The queue is drained with these on every tick. */
    handlers?: Record<string, JobHandler>;
    /** Jobs to drain per tick. Default 25. */
    jobBatch?: number;
    /** Claim lease for drained jobs, in seconds. Default 300. */
    leaseSeconds?: number;
    /**
     * Called for anything that goes wrong. Failures are otherwise only
     * visible in the cron ledger, and a worker has no console anyone reads.
     */
    onError?(error: unknown, context: {
        name: string;
    }): void;
}
/** Minimal shape of the platform's scheduled event. */
export interface ScheduledEvent {
    cron?: string;
    scheduledTime?: number;
}
/** Minimal shape of the platform's execution context. */
export interface ExecutionContextLike {
    waitUntil?(promise: Promise<unknown>): void;
}
export type ScheduledHandler = (event: ScheduledEvent, env: Record<string, unknown>, ctx?: ExecutionContextLike) => Promise<ScheduledSummary>;
/** What one tick did — returned for tests and logging. */
export interface ScheduledSummary {
    cron: string | null;
    ran: string[];
    failed: string[];
    jobs: WorkSummary | null;
}
/**
 * Build the `scheduled` handler on its own. Most apps want `withScheduled`.
 */
export declare function createScheduledHandler(options?: ScheduledOptions): ScheduledHandler;
/**
 * Wrap a Hono app into the `{ fetch, scheduled }` export a worker needs.
 *
 * The app keeps serving requests exactly as before; this only adds the
 * second entry point.
 */
export declare function withScheduled(app: Hono, options?: ScheduledOptions): {
    fetch: Hono['fetch'];
    scheduled: ScheduledHandler;
};
//# sourceMappingURL=scheduled.d.ts.map