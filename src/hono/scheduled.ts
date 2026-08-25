import type { Hono } from 'hono';
import { XenitionClient } from '../xenition-client';
import type { JobHandler, JobsClient, WorkSummary } from '../modules/jobs';
import { createClientFromEnv, XenitionApiConfigError } from './client';

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
  onError?(error: unknown, context: { name: string }): void;
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

export type ScheduledHandler = (
  event: ScheduledEvent,
  env: Record<string, unknown>,
  ctx?: ExecutionContextLike,
) => Promise<ScheduledSummary>;

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
export function createScheduledHandler(options: ScheduledOptions = {}): ScheduledHandler {
  const crons = options.crons ?? [];
  const handlers = options.handlers ?? {};

  return async function scheduled(event, env, _ctx) {
    const client = options.client ?? clientFromEnv(env);
    const jobs = client.modules.jobs;
    // `use`, never `enable`: DDL belongs in the deploy step, and a cron tick
    // is the worst possible moment to discover a migration is pending.
    client.modules.use('jobs');

    const cron = event?.cron ?? null;
    const scheduledAt = new Date(event?.scheduledTime ?? Date.now());
    const context: ScheduledContext = { client, jobs, cron, scheduledAt, env: env ?? {} };

    const summary: ScheduledSummary = { cron, ran: [], failed: [], jobs: null };

    for (const job of crons) {
      // A cron with no schedule runs on every tick; one with a schedule runs
      // only when the platform says that expression fired.
      if (job.schedule && cron && job.schedule !== cron) continue;
      // No cron reported (a manual invocation, or a platform that omits it):
      // run everything rather than nothing, so a hand-triggered tick is useful.
      const ledgerId = await safely(() => jobs.startCronRun(job.name), options, job.name);
      const startedAt = Date.now();
      try {
        await job.run(context);
        summary.ran.push(job.name);
        if (ledgerId) {
          await safely(
            () => jobs.finishCronRun(ledgerId, { ok: true, durationMs: Date.now() - startedAt }),
            options,
            job.name,
          );
        }
      } catch (err) {
        // One failing schedule must not stop the others, or a single bad
        // cron takes the whole tick — including the queue drain — with it.
        summary.failed.push(job.name);
        options.onError?.(err, { name: job.name });
        if (ledgerId) {
          await safely(
            () =>
              jobs.finishCronRun(ledgerId, {
                ok: false,
                error: err,
                durationMs: Date.now() - startedAt,
              }),
            options,
            job.name,
          );
        }
      }
    }

    if (Object.keys(handlers).length > 0) {
      try {
        summary.jobs = await jobs.work(handlers, {
          limit: options.jobBatch ?? 25,
          leaseSeconds: options.leaseSeconds,
          worker: `cron:${cron ?? 'manual'}`,
          // The whole reason handlers can reach the platform at all: a
          // scheduled run has no request to build a client from, and in a
          // Worker the secrets are on `env`, not `process.env`.
          context: { client, env: env ?? {} },
        });
      } catch (err) {
        summary.failed.push('jobs.work');
        options.onError?.(err, { name: 'jobs.work' });
      }
    }

    return summary;
  };
}

/**
 * Wrap a Hono app into the `{ fetch, scheduled }` export a worker needs.
 *
 * The app keeps serving requests exactly as before; this only adds the
 * second entry point.
 */
export function withScheduled(
  app: Hono,
  options: ScheduledOptions = {},
): { fetch: Hono['fetch']; scheduled: ScheduledHandler } {
  return {
    fetch: app.fetch.bind(app) as Hono['fetch'],
    scheduled: createScheduledHandler(options),
  };
}

function clientFromEnv(env: Record<string, unknown>): XenitionClient {
  const apiKey = typeof env?.XENITION_API_KEY === 'string' ? env.XENITION_API_KEY : undefined;
  const apiUrl = typeof env?.XENITION_API_URL === 'string' ? env.XENITION_API_URL : undefined;
  const fallbackKey = readProcessEnv('XENITION_API_KEY');
  const fallbackUrl = readProcessEnv('XENITION_API_URL');
  if (!apiKey && !fallbackKey) {
    throw new XenitionApiConfigError(
      'The scheduled handler needs the XENITION_API_KEY secret (injected by the deploy ' +
        'pipeline) or an explicit `client` option.',
    );
  }
  return createClientFromEnv({
    XENITION_API_KEY: apiKey ?? fallbackKey,
    XENITION_API_URL: apiUrl ?? fallbackUrl,
  });
}

function readProcessEnv(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Ledger writes are observability, not the work. A database hiccup while
 * recording a run must not abort the run itself.
 */
async function safely<T>(
  action: () => Promise<T>,
  options: ScheduledOptions,
  name: string,
): Promise<T | undefined> {
  try {
    return await action();
  } catch (err) {
    options.onError?.(err, { name: `${name}:ledger` });
    return undefined;
  }
}
