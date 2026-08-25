import type { XenitionClient } from '../../xenition-client';
/**
 * Types for the jobs module — deferred and background work.
 */
/**
 * Lifecycle of one job run.
 *
 *   queued     waiting for `run_at` to arrive and a worker to claim it
 *   running    claimed, with a lease that expires if the worker dies
 *   succeeded  handler returned
 *   failed     handler threw, and there are attempts left — back to queued
 *              after a backoff, so this is a transient resting state
 *   dead       attempts exhausted, or failed with retry disabled. Never
 *              retried again; kept for inspection
 */
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead';
export interface Job {
    id: string;
    /** Handler key, e.g. `speech.analyze`. */
    type: string;
    payload: Record<string, unknown>;
    status: JobStatus;
    attempts: number;
    max_attempts: number;
    /** Not eligible to run before this. Carries both scheduling and backoff. */
    run_at: string;
    claimed_at: string | null;
    claimed_by: string | null;
    /** When a claim goes stale, so a crashed worker's job is not lost forever. */
    lease_expires_at: string | null;
    result: Record<string, unknown> | null;
    error: string | null;
    idempotency_key: string | null;
    created_at: string;
    updated_at: string;
}
export interface EnqueueOptions {
    /**
     * Do not run before this ISO timestamp. This is how "remind me tomorrow"
     * and exponential backoff are both expressed.
     */
    runAt?: string;
    /** Total attempts before the job is declared dead. Default 3. */
    maxAttempts?: number;
    /**
     * Caller-supplied dedupe key. Enqueuing twice with the same key returns
     * the EXISTING job instead of creating a second one — the guard against a
     * retried HTTP request queueing the same expensive work twice.
     */
    idempotencyKey?: string;
}
export interface ClaimOptions {
    /** Only claim these types. Omit to claim anything due. */
    types?: string[];
    /** Maximum jobs to claim. Default 1. */
    limit?: number;
    /**
     * How long the claim is held before another worker may take the job.
     * Default 300. Set it above the handler's worst-case runtime, or two
     * workers will run the same job concurrently.
     */
    leaseSeconds?: number;
}
export interface FailOptions {
    /**
     * Whether the job may be retried. Default true. Pass false for a failure
     * that will never succeed — bad input, a deleted record — so it goes
     * straight to `dead` instead of burning every attempt first.
     */
    retry?: boolean;
}
export interface ListJobsOptions {
    status?: JobStatus;
    type?: string;
    limit?: number;
    offset?: number;
}
/** A handler for one job type. Its return value is stored as the result. */
/**
 * What a handler is given besides the job.
 *
 * A handler runs on a scheduled tick, not a request, so there is no Hono
 * context to build a client from — and in a Worker, secrets live on `env`,
 * not `process.env`. Without this a handler literally could not reach the
 * platform: it could not transcribe, notify, or read a row it did not
 * already have.
 */
export interface JobContext {
    /** Service-key client, supplied by whatever is draining the queue. */
    client: XenitionClient;
    /** Worker env bindings / secrets. Empty object outside a Worker. */
    env: Record<string, unknown>;
}
export type JobHandler = (job: Job, context: JobContext) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
/** What one `work()` pass did. */
export interface WorkSummary {
    claimed: number;
    succeeded: number;
    failed: number;
    /** Types that were claimed but had no registered handler. */
    unhandled: string[];
}
/** One recorded execution of a named schedule. */
export interface CronRun {
    id: string;
    name: string;
    started_at: string;
    /** Null while running — or forever, if the run was killed mid-flight. */
    finished_at: string | null;
    ok: boolean | null;
    error: string | null;
    duration_ms: number | null;
}
//# sourceMappingURL=types.d.ts.map