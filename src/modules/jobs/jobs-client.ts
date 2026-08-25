import { Migration } from '../../migrations/types';
import { defineModule, ModuleContext } from '../core';
import { fail, generateId, nowIso, optionalNumber, optionalPlainObject, requireNonEmptyString } from '../util';
import {
  ClaimOptions,
  EnqueueOptions,
  FailOptions,
  Job,
  JobContext,
  JobHandler,
  JobStatus,
  CronRun,
  ListJobsOptions,
  WorkSummary,
} from './types';

export const JOBS_TABLE = 'jobs__runs';
export const CRON_RUNS_TABLE = 'jobs__cron_runs';

export const JOBS_MIGRATIONS: Migration[] = [
  {
    id: 'jobs/0001_create_jobs__runs',
    sql: `CREATE TABLE IF NOT EXISTS ${JOBS_TABLE} (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by text,
  lease_expires_at timestamptz,
  result jsonb,
  error text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    // The claim query's access path: due work, oldest first.
    id: 'jobs/0002_index_jobs__runs_due',
    sql: `CREATE INDEX IF NOT EXISTS jobs__runs_due_idx ON ${JOBS_TABLE} (status, run_at)`,
  },
  {
    // Partial, because most jobs carry no key and NULLs are never equal to
    // each other anyway — a plain unique index would not constrain them.
    id: 'jobs/0003_unique_jobs__runs_idempotency',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS jobs__runs_idempotency_idx
  ON ${JOBS_TABLE} (idempotency_key) WHERE idempotency_key IS NOT NULL`,
  },
  {
    id: 'jobs/0004_index_jobs__runs_type',
    sql: `CREATE INDEX IF NOT EXISTS jobs__runs_type_idx ON ${JOBS_TABLE} (type, status)`,
  },
  {
    // The cron ledger. Without it a schedule that silently stops firing is
    // invisible — nobody notices the absence of a thing that was supposed
    // to happen, which is exactly how a "daily digest" quietly dies.
    id: 'jobs/0005_create_jobs__cron_runs',
    sql: `CREATE TABLE IF NOT EXISTS ${CRON_RUNS_TABLE} (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean,
  error text,
  duration_ms integer
)`,
  },
  {
    id: 'jobs/0006_index_jobs__cron_runs_name',
    sql: `CREATE INDEX IF NOT EXISTS jobs__cron_runs_name_idx
  ON ${CRON_RUNS_TABLE} (name, started_at DESC)`,
  },
];

const JOB_STATUSES: JobStatus[] = ['queued', 'running', 'succeeded', 'failed', 'dead'];

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_LEASE_SECONDS = 300;
/** Backoff ceiling. Beyond ~5 minutes a retry loop is just noise. */
const MAX_BACKOFF_SECONDS = 300;
const BASE_BACKOFF_SECONDS = 10;

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
export class JobsClient {
  constructor(private readonly ctx: ModuleContext) {}

  /**
   * Queue a job. Returns immediately — nothing runs until a worker claims it.
   *
   * With `idempotencyKey`, a second enqueue returns the FIRST job rather
   * than creating another. That is what makes it safe to enqueue from a
   * route a mobile client will retry on a flaky connection.
   */
  async enqueue(
    type: string,
    payload: Record<string, unknown> = {},
    options: EnqueueOptions = {},
  ): Promise<Job> {
    const context = 'JobsClient.enqueue';
    const jobType = requireNonEmptyString(context, 'type', type);
    const body = optionalPlainObject(context, 'payload', payload, {});
    const maxAttempts = optionalNumber(context, 'maxAttempts', options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      fail(context, '"maxAttempts" must be a positive integer');
    }
    const runAt = options.runAt ?? nowIso();
    if (typeof runAt !== 'string' || !Number.isFinite(Date.parse(runAt))) {
      fail(context, '"runAt" must be an ISO timestamp string');
    }
    const idempotencyKey = options.idempotencyKey ?? null;
    if (idempotencyKey !== null && typeof idempotencyKey !== 'string') {
      fail(context, '"idempotencyKey" must be a string');
    }

    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(idempotencyKey);
      if (existing) return existing;
    }

    const job: Job = {
      id: generateId(),
      type: jobType,
      payload: body,
      status: 'queued',
      attempts: 0,
      max_attempts: maxAttempts,
      run_at: runAt,
      claimed_at: null,
      claimed_by: null,
      lease_expires_at: null,
      result: null,
      error: null,
      idempotency_key: idempotencyKey,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    const { created_at: _c, updated_at: _u, ...row } = job;
    await this.ctx.query.from(JOBS_TABLE).insert(row).execute();
    return job;
  }

  async get(id: string): Promise<Job | null> {
    requireNonEmptyString('JobsClient.get', 'id', id);
    const row = await this.ctx.query.from(JOBS_TABLE).where('id', id).first<Job>();
    return row ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<Job | null> {
    const row = await this.ctx.query
      .from(JOBS_TABLE)
      .where('idempotency_key', key)
      .first<Job>();
    return row ?? null;
  }

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
  async claim(worker: string, options: ClaimOptions = {}): Promise<Job[]> {
    const context = 'JobsClient.claim';
    const claimedBy = requireNonEmptyString(context, 'worker', worker);
    const limit = optionalNumber(context, 'limit', options.limit, 1);
    if (!Number.isInteger(limit) || limit < 1) fail(context, '"limit" must be a positive integer');
    const leaseSeconds = optionalNumber(
      context,
      'leaseSeconds',
      options.leaseSeconds,
      DEFAULT_LEASE_SECONDS,
    );
    if (leaseSeconds <= 0) fail(context, '"leaseSeconds" must be positive');

    const params: unknown[] = [claimedBy, leaseSeconds, limit];
    let typeFilter = '';
    if (options.types && options.types.length > 0) {
      if (!Array.isArray(options.types) || options.types.some((t) => typeof t !== 'string')) {
        fail(context, '"types" must be an array of strings');
      }
      params.push(options.types);
      typeFilter = `AND type = ANY($${params.length}::text[])`;
    }

    const sql = `UPDATE ${JOBS_TABLE} SET
        status = 'running',
        attempts = attempts + 1,
        claimed_at = now(),
        claimed_by = $1,
        lease_expires_at = now() + make_interval(secs => $2::double precision),
        updated_at = now()
      WHERE id IN (
        SELECT id FROM ${JOBS_TABLE}
        WHERE (
          (status IN ('queued', 'failed') AND run_at <= now())
          OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now())
        )
        ${typeFilter}
        ORDER BY run_at ASC
        LIMIT $3
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *`;

    const result = await this.ctx.raw<Job>(sql, params);
    return result.data ?? [];
  }

  /** Mark a claimed job done, storing whatever the handler returned. */
  async complete(id: string, result: Record<string, unknown> | null = null): Promise<void> {
    requireNonEmptyString('JobsClient.complete', 'id', id);
    await this.ctx.query
      .from(JOBS_TABLE)
      .update({
        status: 'succeeded',
        result,
        error: null,
        lease_expires_at: null,
        updated_at: nowIso(),
      })
      .where('id', id)
      .execute();
  }

  /**
   * Record a failure and decide what happens next.
   *
   * With attempts left, the job returns to the queue with exponential
   * backoff (10s, 20s, 40s … capped at 5 minutes) so a struggling upstream
   * is not hammered. Out of attempts — or told not to retry — it goes to
   * `dead` and stays there for someone to look at.
   */
  async fail(id: string, error: unknown, options: FailOptions = {}): Promise<void> {
    const context = 'JobsClient.fail';
    requireNonEmptyString(context, 'id', id);
    const job = await this.get(id);
    if (!job) fail(context, `unknown job "${id}"`);

    const message = errorMessage(error);
    const mayRetry = options.retry !== false && job.attempts < job.max_attempts;

    if (!mayRetry) {
      await this.ctx.query
        .from(JOBS_TABLE)
        .update({ status: 'dead', error: message, lease_expires_at: null, updated_at: nowIso() })
        .where('id', id)
        .execute();
      return;
    }

    const delaySeconds = Math.min(
      MAX_BACKOFF_SECONDS,
      BASE_BACKOFF_SECONDS * Math.pow(2, Math.max(0, job.attempts - 1)),
    );
    await this.ctx.query
      .from(JOBS_TABLE)
      .update({
        status: 'failed',
        error: message,
        run_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        claimed_by: null,
        lease_expires_at: null,
        updated_at: nowIso(),
      })
      .where('id', id)
      .execute();
  }

  /**
   * Claim jobs and run them through the supplied handlers.
   *
   * The whole worker loop in one call — this is what a scheduled handler
   * invokes. A handler that throws fails its own job and never the pass, so
   * one poisonous job cannot stop the queue draining.
   */
  async work(
    handlers: Record<string, JobHandler>,
    options: ClaimOptions & { worker?: string; context?: JobContext } = {},
  ): Promise<WorkSummary> {
    const context = 'JobsClient.work';
    if (!handlers || typeof handlers !== 'object') {
      fail(context, '"handlers" must be an object of type → handler');
    }
    const types = options.types ?? Object.keys(handlers);
    if (types.length === 0) return { claimed: 0, succeeded: 0, failed: 0, unhandled: [] };

    // Checked BEFORE claiming. Inside the loop it would be caught by the
    // per-job handler and counted as a job failure, burning an attempt on
    // every job in the batch for what is a wiring bug in the runner.
    const handlerContext = this.handlerContext(options.context);

    const jobs = await this.claim(options.worker ?? `worker-${generateId()}`, {
      ...options,
      types,
    });
    const summary: WorkSummary = { claimed: jobs.length, succeeded: 0, failed: 0, unhandled: [] };

    for (const job of jobs) {
      const handler = handlers[job.type];
      if (!handler) {
        // Claimed but unroutable. Not retryable — the handler will not
        // appear by waiting — so it goes straight to dead rather than
        // cycling through every attempt.
        summary.unhandled.push(job.type);
        summary.failed++;
        await this.fail(job.id, `No handler registered for job type "${job.type}"`, {
          retry: false,
        });
        continue;
      }
      try {
        const result = await handler(job, handlerContext);
        await this.complete(job.id, (result as Record<string, unknown>) ?? null);
        summary.succeeded++;
      } catch (err) {
        summary.failed++;
        await this.fail(job.id, err);
      }
    }
    return summary;
  }

  // ────────── Cron ledger ─────────────────────────────────────────────────

  /**
   * Open a ledger entry for a scheduled run. Returns its id for `finishCronRun`.
   *
   * Recording the START, not just the outcome, is the point: a run that
   * never finishes leaves an open row, which is the only trace a hung or
   * killed schedule ever leaves behind.
   */
  async startCronRun(name: string): Promise<string> {
    const context = 'JobsClient.startCronRun';
    requireNonEmptyString(context, 'name', name);
    const id = generateId();
    await this.ctx.query
      .from(CRON_RUNS_TABLE)
      .insert({ id, name, started_at: nowIso() })
      .execute();
    return id;
  }

  /** Close a ledger entry with its outcome. */
  async finishCronRun(
    id: string,
    outcome: { ok: boolean; error?: unknown; durationMs?: number },
  ): Promise<void> {
    requireNonEmptyString('JobsClient.finishCronRun', 'id', id);
    await this.ctx.query
      .from(CRON_RUNS_TABLE)
      .update({
        finished_at: nowIso(),
        ok: outcome.ok,
        error: outcome.ok ? null : errorMessage(outcome.error),
        duration_ms: outcome.durationMs ?? null,
      })
      .where('id', id)
      .execute();
  }

  /** The most recent run of a schedule — "did the digest go out?". */
  async lastCronRun(name: string): Promise<CronRun | null> {
    requireNonEmptyString('JobsClient.lastCronRun', 'name', name);
    const rows = await this.ctx.query
      .from(CRON_RUNS_TABLE)
      .where('name', name)
      .orderBy('started_at', 'DESC')
      .limit(1)
      .rows<CronRun>();
    return rows[0] ?? null;
  }

  async listCronRuns(name?: string, limit = 50): Promise<CronRun[]> {
    let q = this.ctx.query.from(CRON_RUNS_TABLE);
    if (name) q = q.where('name', name);
    return q.orderBy('started_at', 'DESC').limit(limit).rows<CronRun>();
  }

  // ────────── Inspection ───────────────────────────────────────────────────

  /**
   * The context handed to a handler.
   *
   * Required in practice, optional in the type: `work()` predates it, and a
   * caller that drains the queue without supplying one gets a message
   * naming the fix rather than `undefined.client` three frames deeper.
   */
  private handlerContext(context?: JobContext): JobContext {
    if (!context) {
      throw new Error(
        'JobsClient.work: handlers need a JobContext. Pass `{ context: { client, env } }` — ' +
          '`withScheduled()` does this for you.',
      );
    }
    return context;
  }

  async list(options: ListJobsOptions = {}): Promise<Job[]> {
    const context = 'JobsClient.list';
    let q = this.ctx.query.from(JOBS_TABLE);
    if (options.status) {
      if (!JOB_STATUSES.includes(options.status)) {
        fail(context, `"status" must be one of ${JOB_STATUSES.join(', ')}`);
      }
      q = q.where('status', options.status);
    }
    if (options.type) q = q.where('type', options.type);
    const limit = optionalNumber(context, 'limit', options.limit, 50);
    const offset = optionalNumber(context, 'offset', options.offset, 0);
    return q.orderBy('created_at', 'DESC').limit(limit).offset(offset).rows<Job>();
  }

  /**
   * Delete finished jobs older than `olderThanDays` (default 30).
   *
   * Only `succeeded` — dead jobs are the ones worth keeping, and a queue
   * table that grows forever eventually slows the claim query down.
   */
  async purge(options: { olderThanDays?: number } = {}): Promise<number> {
    const context = 'JobsClient.purge';
    const days = optionalNumber(context, 'olderThanDays', options.olderThanDays, 30);
    if (days <= 0) fail(context, '"olderThanDays" must be positive');
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const result = await this.ctx.raw<{ id: string }>(
      `DELETE FROM ${JOBS_TABLE} WHERE status = 'succeeded' AND updated_at < $1 RETURNING id`,
      [cutoff],
    );
    return (result.data ?? []).length;
  }
}

/** A message safe to store: never an object that stringifies to [object Object]. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

export const jobsModule = defineModule<JobsClient>({
  name: 'jobs',
  migrations: JOBS_MIGRATIONS,
  factory: (ctx: ModuleContext) => new JobsClient(ctx),
});
