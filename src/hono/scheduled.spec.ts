import { Hono } from 'hono';
import { XenitionClient } from '../xenition-client';
import { JobsClient } from '../modules/jobs';
import { createScheduledHandler, withScheduled } from './scheduled';

/**
 * The scheduled handler's job is dispatch and resilience: fire the right
 * crons, drain the queue, and let neither ruin the other. The jobs client is
 * stubbed so those rules are what is under test.
 */
const makeJobs = () =>
  ({
    startCronRun: jest.fn(async () => 'ledger-1'),
    finishCronRun: jest.fn(async () => undefined),
    work: jest.fn(async () => ({ claimed: 2, succeeded: 2, failed: 0, unhandled: [] })),
    purge: jest.fn(async () => 0),
  }) as unknown as JobsClient;

const makeClient = (jobs = makeJobs()) => {
  const use = jest.fn();
  return {
    jobs,
    use,
    client: { modules: { use, jobs } } as unknown as XenitionClient,
  };
};

const tick = (cron?: string) => ({ cron, scheduledTime: Date.UTC(2026, 7, 24, 9, 0, 0) });

describe('cron dispatch', () => {
  it('runs only the crons whose expression fired', async () => {
    const nine = jest.fn();
    const three = jest.fn();
    const { client } = makeClient();
    const scheduled = createScheduledHandler({
      client,
      crons: [
        { name: 'morning', schedule: '0 9 * * *', run: nine },
        { name: 'nightly', schedule: '0 3 * * *', run: three },
      ],
    });

    const summary = await scheduled(tick('0 9 * * *'), {});

    expect(nine).toHaveBeenCalledTimes(1);
    expect(three).not.toHaveBeenCalled();
    expect(summary.ran).toEqual(['morning']);
  });

  it('runs a cron with no schedule on every tick', async () => {
    const always = jest.fn();
    const { client } = makeClient();
    const scheduled = createScheduledHandler({ client, crons: [{ name: 'always', run: always }] });
    await scheduled(tick('0 9 * * *'), {});
    await scheduled(tick('*/5 * * * *'), {});
    expect(always).toHaveBeenCalledTimes(2);
  });

  it('runs everything when the platform reports no expression', async () => {
    // A manual invocation should be useful, not a no-op.
    const nine = jest.fn();
    const { client } = makeClient();
    const scheduled = createScheduledHandler({
      client,
      crons: [{ name: 'morning', schedule: '0 9 * * *', run: nine }],
    });
    await scheduled({}, {});
    expect(nine).toHaveBeenCalled();
  });

  it('hands the cron everything it needs', async () => {
    const run = jest.fn();
    const { client, jobs } = makeClient();
    const scheduled = createScheduledHandler({ client, crons: [{ name: 'x', run }] });
    await scheduled(tick('0 9 * * *'), { SOME_BINDING: 'v' });

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        client,
        jobs,
        cron: '0 9 * * *',
        scheduledAt: new Date(Date.UTC(2026, 7, 24, 9, 0, 0)),
        env: { SOME_BINDING: 'v' },
      }),
    );
  });
});

describe('resilience', () => {
  it('one failing cron does not stop the others', async () => {
    const good = jest.fn();
    const { client } = makeClient();
    const onError = jest.fn();
    const scheduled = createScheduledHandler({
      client,
      onError,
      crons: [
        {
          name: 'bad',
          run: () => {
            throw new Error('boom');
          },
        },
        { name: 'good', run: good },
      ],
    });

    const summary = await scheduled(tick(), {});

    expect(good).toHaveBeenCalled();
    expect(summary).toMatchObject({ ran: ['good'], failed: ['bad'] });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { name: 'bad' });
  });

  it('a failing cron does not stop the queue draining', async () => {
    // Otherwise one bad schedule silently stalls every background job.
    const { client, jobs } = makeClient();
    const scheduled = createScheduledHandler({
      client,
      crons: [
        {
          name: 'bad',
          run: () => {
            throw new Error('boom');
          },
        },
      ],
      handlers: { 'speech.analyze': jest.fn() },
    });

    const summary = await scheduled(tick(), {});
    expect(jobs.work).toHaveBeenCalled();
    expect(summary.jobs).toMatchObject({ succeeded: 2 });
  });

  it('a ledger write failing does not fail the run', async () => {
    // Recording a run is observability, not the work.
    const jobs = makeJobs();
    (jobs.startCronRun as unknown as jest.Mock).mockRejectedValue(new Error('db blip'));
    const { client } = makeClient(jobs);
    const run = jest.fn();
    const onError = jest.fn();

    const summary = await createScheduledHandler({
      client,
      onError,
      crons: [{ name: 'x', run }],
    })(tick(), {});

    expect(run).toHaveBeenCalled();
    expect(summary.ran).toEqual(['x']);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { name: 'x:ledger' });
  });

  it('reports a queue-drain failure without throwing', async () => {
    const jobs = makeJobs();
    (jobs.work as unknown as jest.Mock).mockRejectedValue(new Error('queue down'));
    const { client } = makeClient(jobs);
    const summary = await createScheduledHandler({
      client,
      handlers: { x: jest.fn() },
    })(tick(), {});
    expect(summary.failed).toEqual(['jobs.work']);
  });
});

describe('queue draining', () => {
  it('drains with the registered handlers on every tick', async () => {
    const handlers = { 'speech.analyze': jest.fn() };
    const { client, jobs } = makeClient();
    await createScheduledHandler({ client, handlers, jobBatch: 5 })(tick('*/5 * * * *'), {});
    expect(jobs.work).toHaveBeenCalledWith(
      handlers,
      expect.objectContaining({ limit: 5, worker: 'cron:*/5 * * * *' }),
    );
  });

  it('skips the drain when no handlers are registered', async () => {
    const { client, jobs } = makeClient();
    const summary = await createScheduledHandler({ client })(tick(), {});
    expect(jobs.work).not.toHaveBeenCalled();
    expect(summary.jobs).toBeNull();
  });

  it('unlocks the module without running DDL on a tick', async () => {
    // Migrations belong to the deploy step; a cron tick is the worst moment
    // to discover one is pending.
    const { client, use } = makeClient();
    await createScheduledHandler({ client })(tick(), {});
    expect(use).toHaveBeenCalledWith('jobs');
  });
});

describe('ledger', () => {
  it('records start and success with a duration', async () => {
    const { client, jobs } = makeClient();
    await createScheduledHandler({ client, crons: [{ name: 'digest', run: jest.fn() }] })(
      tick(),
      {},
    );
    expect(jobs.startCronRun).toHaveBeenCalledWith('digest');
    expect(jobs.finishCronRun).toHaveBeenCalledWith(
      'ledger-1',
      expect.objectContaining({ ok: true, durationMs: expect.any(Number) }),
    );
  });

  it('records a failure with its error', async () => {
    const { client, jobs } = makeClient();
    await createScheduledHandler({
      client,
      crons: [
        {
          name: 'digest',
          run: () => {
            throw new Error('boom');
          },
        },
      ],
    })(tick(), {});
    expect(jobs.finishCronRun).toHaveBeenCalledWith(
      'ledger-1',
      expect.objectContaining({ ok: false, error: expect.any(Error) }),
    );
  });
});

describe('withScheduled', () => {
  it('keeps the app serving requests and adds the scheduled entry point', async () => {
    const app = new Hono();
    app.get('/ping', (c) => c.json({ ok: true }));
    const { client } = makeClient();
    const worker = withScheduled(app, { client, crons: [{ name: 'x', run: jest.fn() }] });

    const res = await app.request('/ping');
    expect(res.status).toBe(200);
    expect(typeof worker.fetch).toBe('function');
    expect((await worker.scheduled(tick(), {})).ran).toEqual(['x']);
  });

  it('explains a missing API key rather than failing obscurely', async () => {
    const worker = withScheduled(new Hono(), { crons: [{ name: 'x', run: jest.fn() }] });
    const previous = process.env.XENITION_API_KEY;
    delete process.env.XENITION_API_KEY;
    try {
      await expect(worker.scheduled(tick(), {})).rejects.toThrow(/XENITION_API_KEY/);
    } finally {
      if (previous !== undefined) process.env.XENITION_API_KEY = previous;
    }
  });
});
