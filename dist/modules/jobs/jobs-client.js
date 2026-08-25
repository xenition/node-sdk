"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobsModule = exports.JobsClient = exports.JOBS_MIGRATIONS = exports.CRON_RUNS_TABLE = exports.JOBS_TABLE = void 0;
const core_1 = require("../core");
const util_1 = require("../util");
exports.JOBS_TABLE = 'jobs__runs';
exports.CRON_RUNS_TABLE = 'jobs__cron_runs';
exports.JOBS_MIGRATIONS = [
    {
        id: 'jobs/0001_create_jobs__runs',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.JOBS_TABLE} (
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
        sql: `CREATE INDEX IF NOT EXISTS jobs__runs_due_idx ON ${exports.JOBS_TABLE} (status, run_at)`,
    },
    {
        // Partial, because most jobs carry no key and NULLs are never equal to
        // each other anyway — a plain unique index would not constrain them.
        id: 'jobs/0003_unique_jobs__runs_idempotency',
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS jobs__runs_idempotency_idx
  ON ${exports.JOBS_TABLE} (idempotency_key) WHERE idempotency_key IS NOT NULL`,
    },
    {
        id: 'jobs/0004_index_jobs__runs_type',
        sql: `CREATE INDEX IF NOT EXISTS jobs__runs_type_idx ON ${exports.JOBS_TABLE} (type, status)`,
    },
    {
        // The cron ledger. Without it a schedule that silently stops firing is
        // invisible — nobody notices the absence of a thing that was supposed
        // to happen, which is exactly how a "daily digest" quietly dies.
        id: 'jobs/0005_create_jobs__cron_runs',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.CRON_RUNS_TABLE} (
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
  ON ${exports.CRON_RUNS_TABLE} (name, started_at DESC)`,
    },
];
const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'dead'];
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
class JobsClient {
    constructor(ctx) {
        this.ctx = ctx;
    }
    /**
     * Queue a job. Returns immediately — nothing runs until a worker claims it.
     *
     * With `idempotencyKey`, a second enqueue returns the FIRST job rather
     * than creating another. That is what makes it safe to enqueue from a
     * route a mobile client will retry on a flaky connection.
     */
    async enqueue(type, payload = {}, options = {}) {
        const context = 'JobsClient.enqueue';
        const jobType = (0, util_1.requireNonEmptyString)(context, 'type', type);
        const body = (0, util_1.optionalPlainObject)(context, 'payload', payload, {});
        const maxAttempts = (0, util_1.optionalNumber)(context, 'maxAttempts', options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
        if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
            (0, util_1.fail)(context, '"maxAttempts" must be a positive integer');
        }
        const runAt = options.runAt ?? (0, util_1.nowIso)();
        if (typeof runAt !== 'string' || !Number.isFinite(Date.parse(runAt))) {
            (0, util_1.fail)(context, '"runAt" must be an ISO timestamp string');
        }
        const idempotencyKey = options.idempotencyKey ?? null;
        if (idempotencyKey !== null && typeof idempotencyKey !== 'string') {
            (0, util_1.fail)(context, '"idempotencyKey" must be a string');
        }
        if (idempotencyKey) {
            const existing = await this.findByIdempotencyKey(idempotencyKey);
            if (existing)
                return existing;
        }
        const job = {
            id: (0, util_1.generateId)(),
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
            created_at: (0, util_1.nowIso)(),
            updated_at: (0, util_1.nowIso)(),
        };
        const { created_at: _c, updated_at: _u, ...row } = job;
        await this.ctx.query.from(exports.JOBS_TABLE).insert(row).execute();
        return job;
    }
    async get(id) {
        (0, util_1.requireNonEmptyString)('JobsClient.get', 'id', id);
        const row = await this.ctx.query.from(exports.JOBS_TABLE).where('id', id).first();
        return row ?? null;
    }
    async findByIdempotencyKey(key) {
        const row = await this.ctx.query
            .from(exports.JOBS_TABLE)
            .where('idempotency_key', key)
            .first();
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
    async claim(worker, options = {}) {
        const context = 'JobsClient.claim';
        const claimedBy = (0, util_1.requireNonEmptyString)(context, 'worker', worker);
        const limit = (0, util_1.optionalNumber)(context, 'limit', options.limit, 1);
        if (!Number.isInteger(limit) || limit < 1)
            (0, util_1.fail)(context, '"limit" must be a positive integer');
        const leaseSeconds = (0, util_1.optionalNumber)(context, 'leaseSeconds', options.leaseSeconds, DEFAULT_LEASE_SECONDS);
        if (leaseSeconds <= 0)
            (0, util_1.fail)(context, '"leaseSeconds" must be positive');
        const params = [claimedBy, leaseSeconds, limit];
        let typeFilter = '';
        if (options.types && options.types.length > 0) {
            if (!Array.isArray(options.types) || options.types.some((t) => typeof t !== 'string')) {
                (0, util_1.fail)(context, '"types" must be an array of strings');
            }
            params.push(options.types);
            typeFilter = `AND type = ANY($${params.length}::text[])`;
        }
        const sql = `UPDATE ${exports.JOBS_TABLE} SET
        status = 'running',
        attempts = attempts + 1,
        claimed_at = now(),
        claimed_by = $1,
        lease_expires_at = now() + make_interval(secs => $2::double precision),
        updated_at = now()
      WHERE id IN (
        SELECT id FROM ${exports.JOBS_TABLE}
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
        const result = await this.ctx.raw(sql, params);
        return result.data ?? [];
    }
    /** Mark a claimed job done, storing whatever the handler returned. */
    async complete(id, result = null) {
        (0, util_1.requireNonEmptyString)('JobsClient.complete', 'id', id);
        await this.ctx.query
            .from(exports.JOBS_TABLE)
            .update({
            status: 'succeeded',
            result,
            error: null,
            lease_expires_at: null,
            updated_at: (0, util_1.nowIso)(),
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
    async fail(id, error, options = {}) {
        const context = 'JobsClient.fail';
        (0, util_1.requireNonEmptyString)(context, 'id', id);
        const job = await this.get(id);
        if (!job)
            (0, util_1.fail)(context, `unknown job "${id}"`);
        const message = errorMessage(error);
        const mayRetry = options.retry !== false && job.attempts < job.max_attempts;
        if (!mayRetry) {
            await this.ctx.query
                .from(exports.JOBS_TABLE)
                .update({ status: 'dead', error: message, lease_expires_at: null, updated_at: (0, util_1.nowIso)() })
                .where('id', id)
                .execute();
            return;
        }
        const delaySeconds = Math.min(MAX_BACKOFF_SECONDS, BASE_BACKOFF_SECONDS * Math.pow(2, Math.max(0, job.attempts - 1)));
        await this.ctx.query
            .from(exports.JOBS_TABLE)
            .update({
            status: 'failed',
            error: message,
            run_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
            claimed_by: null,
            lease_expires_at: null,
            updated_at: (0, util_1.nowIso)(),
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
    async work(handlers, options = {}) {
        const context = 'JobsClient.work';
        if (!handlers || typeof handlers !== 'object') {
            (0, util_1.fail)(context, '"handlers" must be an object of type → handler');
        }
        const types = options.types ?? Object.keys(handlers);
        if (types.length === 0)
            return { claimed: 0, succeeded: 0, failed: 0, unhandled: [] };
        const jobs = await this.claim(options.worker ?? `worker-${(0, util_1.generateId)()}`, {
            ...options,
            types,
        });
        const summary = { claimed: jobs.length, succeeded: 0, failed: 0, unhandled: [] };
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
                const result = await handler(job);
                await this.complete(job.id, result ?? null);
                summary.succeeded++;
            }
            catch (err) {
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
    async startCronRun(name) {
        const context = 'JobsClient.startCronRun';
        (0, util_1.requireNonEmptyString)(context, 'name', name);
        const id = (0, util_1.generateId)();
        await this.ctx.query
            .from(exports.CRON_RUNS_TABLE)
            .insert({ id, name, started_at: (0, util_1.nowIso)() })
            .execute();
        return id;
    }
    /** Close a ledger entry with its outcome. */
    async finishCronRun(id, outcome) {
        (0, util_1.requireNonEmptyString)('JobsClient.finishCronRun', 'id', id);
        await this.ctx.query
            .from(exports.CRON_RUNS_TABLE)
            .update({
            finished_at: (0, util_1.nowIso)(),
            ok: outcome.ok,
            error: outcome.ok ? null : errorMessage(outcome.error),
            duration_ms: outcome.durationMs ?? null,
        })
            .where('id', id)
            .execute();
    }
    /** The most recent run of a schedule — "did the digest go out?". */
    async lastCronRun(name) {
        (0, util_1.requireNonEmptyString)('JobsClient.lastCronRun', 'name', name);
        const rows = await this.ctx.query
            .from(exports.CRON_RUNS_TABLE)
            .where('name', name)
            .orderBy('started_at', 'DESC')
            .limit(1)
            .rows();
        return rows[0] ?? null;
    }
    async listCronRuns(name, limit = 50) {
        let q = this.ctx.query.from(exports.CRON_RUNS_TABLE);
        if (name)
            q = q.where('name', name);
        return q.orderBy('started_at', 'DESC').limit(limit).rows();
    }
    // ────────── Inspection ───────────────────────────────────────────────────
    async list(options = {}) {
        const context = 'JobsClient.list';
        let q = this.ctx.query.from(exports.JOBS_TABLE);
        if (options.status) {
            if (!JOB_STATUSES.includes(options.status)) {
                (0, util_1.fail)(context, `"status" must be one of ${JOB_STATUSES.join(', ')}`);
            }
            q = q.where('status', options.status);
        }
        if (options.type)
            q = q.where('type', options.type);
        const limit = (0, util_1.optionalNumber)(context, 'limit', options.limit, 50);
        const offset = (0, util_1.optionalNumber)(context, 'offset', options.offset, 0);
        return q.orderBy('created_at', 'DESC').limit(limit).offset(offset).rows();
    }
    /**
     * Delete finished jobs older than `olderThanDays` (default 30).
     *
     * Only `succeeded` — dead jobs are the ones worth keeping, and a queue
     * table that grows forever eventually slows the claim query down.
     */
    async purge(options = {}) {
        const context = 'JobsClient.purge';
        const days = (0, util_1.optionalNumber)(context, 'olderThanDays', options.olderThanDays, 30);
        if (days <= 0)
            (0, util_1.fail)(context, '"olderThanDays" must be positive');
        const cutoff = new Date(Date.now() - days * 86400000).toISOString();
        const result = await this.ctx.raw(`DELETE FROM ${exports.JOBS_TABLE} WHERE status = 'succeeded' AND updated_at < $1 RETURNING id`, [cutoff]);
        return (result.data ?? []).length;
    }
}
exports.JobsClient = JobsClient;
/** A message safe to store: never an object that stringifies to [object Object]. */
function errorMessage(error) {
    if (error instanceof Error)
        return error.message || error.name;
    if (typeof error === 'string')
        return error;
    try {
        return JSON.stringify(error) ?? String(error);
    }
    catch {
        return String(error);
    }
}
exports.jobsModule = (0, core_1.defineModule)({
    name: 'jobs',
    migrations: exports.JOBS_MIGRATIONS,
    factory: (ctx) => new JobsClient(ctx),
});
//# sourceMappingURL=jobs-client.js.map