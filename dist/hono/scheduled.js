"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createScheduledHandler = createScheduledHandler;
exports.withScheduled = withScheduled;
const client_1 = require("./client");
/**
 * Build the `scheduled` handler on its own. Most apps want `withScheduled`.
 */
function createScheduledHandler(options = {}) {
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
        const context = { client, jobs, cron, scheduledAt, env: env ?? {} };
        const summary = { cron, ran: [], failed: [], jobs: null };
        for (const job of crons) {
            // A cron with no schedule runs on every tick; one with a schedule runs
            // only when the platform says that expression fired.
            if (job.schedule && cron && job.schedule !== cron)
                continue;
            // No cron reported (a manual invocation, or a platform that omits it):
            // run everything rather than nothing, so a hand-triggered tick is useful.
            const ledgerId = await safely(() => jobs.startCronRun(job.name), options, job.name);
            const startedAt = Date.now();
            try {
                await job.run(context);
                summary.ran.push(job.name);
                if (ledgerId) {
                    await safely(() => jobs.finishCronRun(ledgerId, { ok: true, durationMs: Date.now() - startedAt }), options, job.name);
                }
            }
            catch (err) {
                // One failing schedule must not stop the others, or a single bad
                // cron takes the whole tick — including the queue drain — with it.
                summary.failed.push(job.name);
                options.onError?.(err, { name: job.name });
                if (ledgerId) {
                    await safely(() => jobs.finishCronRun(ledgerId, {
                        ok: false,
                        error: err,
                        durationMs: Date.now() - startedAt,
                    }), options, job.name);
                }
            }
        }
        if (Object.keys(handlers).length > 0) {
            try {
                summary.jobs = await jobs.work(handlers, {
                    limit: options.jobBatch ?? 25,
                    leaseSeconds: options.leaseSeconds,
                    worker: `cron:${cron ?? 'manual'}`,
                });
            }
            catch (err) {
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
function withScheduled(app, options = {}) {
    return {
        fetch: app.fetch.bind(app),
        scheduled: createScheduledHandler(options),
    };
}
function clientFromEnv(env) {
    const apiKey = typeof env?.XENITION_API_KEY === 'string' ? env.XENITION_API_KEY : undefined;
    const apiUrl = typeof env?.XENITION_API_URL === 'string' ? env.XENITION_API_URL : undefined;
    const fallbackKey = readProcessEnv('XENITION_API_KEY');
    const fallbackUrl = readProcessEnv('XENITION_API_URL');
    if (!apiKey && !fallbackKey) {
        throw new client_1.XenitionApiConfigError('The scheduled handler needs the XENITION_API_KEY secret (injected by the deploy ' +
            'pipeline) or an explicit `client` option.');
    }
    return (0, client_1.createClientFromEnv)({
        XENITION_API_KEY: apiKey ?? fallbackKey,
        XENITION_API_URL: apiUrl ?? fallbackUrl,
    });
}
function readProcessEnv(name) {
    const value = globalThis.process
        ?.env?.[name];
    return typeof value === 'string' && value !== '' ? value : undefined;
}
/**
 * Ledger writes are observability, not the work. A database hiccup while
 * recording a run must not abort the run itself.
 */
async function safely(action, options, name) {
    try {
        return await action();
    }
    catch (err) {
        options.onError?.(err, { name: `${name}:ledger` });
        return undefined;
    }
}
//# sourceMappingURL=scheduled.js.map