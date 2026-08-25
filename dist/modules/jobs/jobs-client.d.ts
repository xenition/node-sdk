import { Migration } from '../../migrations/types';
import { ModuleContext } from '../core';
import { ClaimOptions, EnqueueOptions, FailOptions, Job, JobHandler, CronRun, ListJobsOptions, WorkSummary } from './types';
export declare const JOBS_TABLE = "jobs__runs";
export declare const CRON_RUNS_TABLE = "jobs__cron_runs";
export declare const JOBS_MIGRATIONS: Migration[];
/**
 * jobs module client — deferred and background work over `jobs__runs`.
 *
 * Why this exists: a request handler is the wrong place for anything slow.
 * Transcribing audio, scoring a speech, sending a thousand pushes and
 * rebuilding a digest all take longer than a mobile client will wait and
 * longer than a Worker's CPU budget allows. Enqueue instead, answer the
 * request immediately with a job id, and let a worker drain the queue.
 *
 *   const job = await jobs.enqueue('speech.analyze', { sessionId });
 *   // → 202 { jobId: job.id }, client polls GET /jobs/:id
 *
 *   // in the scheduled handler:
 *   await jobs.work({ 'speech.analyze': analyzeSpeech });
 *
 * The queue is the app's own Postgres, claimed with `FOR UPDATE SKIP
 * LOCKED`. That is deliberately not a message broker: it needs no extra
 * infrastructure, it is transactional with the data the job is about, and
 * at the scale a generated app operates it is simply not the bottleneck.
 *
 * Delivery is AT LEAST ONCE. A worker can die after finishing the work but
 * before recording success, and the lease will then expire and the job will
 * run again — so handlers must be idempotent. That is a property of every
 * queue worth using, not a shortcut taken here.
 */
export declare class JobsClient {
    private readonly ctx;
    constructor(ctx: ModuleContext);
    /**
     * Queue a job. Returns immediately — nothing runs until a worker claims it.
     *
     * With `idempotencyKey`, a second enqueue returns the FIRST job rather
     * than creating another. That is what makes it safe to enqueue from a
     * route a mobile client will retry on a flaky connection.
     */
    enqueue(type: string, payload?: Record<string, unknown>, options?: EnqueueOptions): Promise<Job>;
    get(id: string): Promise<Job | null>;
    findByIdempotencyKey(key: string): Promise<Job | null>;
    /**
     * Atomically take up to `limit` due jobs.
     *
     * `FOR UPDATE SKIP LOCKED` is what makes this safe with several workers
     * running at once: each transaction locks the rows it is taking and the
     * others step over them instead of blocking or double-claiming. Doing the
     * same with a SELECT followed by an UPDATE would hand the same job to two
     * workers under any real concurrency.
     *
     * A job whose lease has expired is claimable again — that is the recovery
     * path for a worker that died mid-run.
     */
    claim(worker: string, options?: ClaimOptions): Promise<Job[]>;
    /** Mark a claimed job done, storing whatever the handler returned. */
    complete(id: string, result?: Record<string, unknown> | null): Promise<void>;
    /**
     * Record a failure and decide what happens next.
     *
     * With attempts left, the job returns to the queue with exponential
     * backoff (10s, 20s, 40s … capped at 5 minutes) so a struggling upstream
     * is not hammered. Out of attempts — or told not to retry — it goes to
     * `dead` and stays there for someone to look at.
     */
    fail(id: string, error: unknown, options?: FailOptions): Promise<void>;
    /**
     * Claim jobs and run them through the supplied handlers.
     *
     * The whole worker loop in one call — this is what a scheduled handler
     * invokes. A handler that throws fails its own job and never the pass, so
     * one poisonous job cannot stop the queue draining.
     */
    work(handlers: Record<string, JobHandler>, options?: ClaimOptions & {
        worker?: string;
    }): Promise<WorkSummary>;
    /**
     * Open a ledger entry for a scheduled run. Returns its id for `finishCronRun`.
     *
     * Recording the START, not just the outcome, is the point: a run that
     * never finishes leaves an open row, which is the only trace a hung or
     * killed schedule ever leaves behind.
     */
    startCronRun(name: string): Promise<string>;
    /** Close a ledger entry with its outcome. */
    finishCronRun(id: string, outcome: {
        ok: boolean;
        error?: unknown;
        durationMs?: number;
    }): Promise<void>;
    /** The most recent run of a schedule — "did the digest go out?". */
    lastCronRun(name: string): Promise<CronRun | null>;
    listCronRuns(name?: string, limit?: number): Promise<CronRun[]>;
    list(options?: ListJobsOptions): Promise<Job[]>;
    /**
     * Delete finished jobs older than `olderThanDays` (default 30).
     *
     * Only `succeeded` — dead jobs are the ones worth keeping, and a queue
     * table that grows forever eventually slows the claim query down.
     */
    purge(options?: {
        olderThanDays?: number;
    }): Promise<number>;
}
export declare const jobsModule: import("../core").ModuleDefinition<JobsClient>;
//# sourceMappingURL=jobs-client.d.ts.map