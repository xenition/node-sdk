import { FakeStore, makeFakeContext } from '../../testing/fake-store';
import { jobsRawHandler } from '../../testing/jobs-raw';
import { JobsClient, JOBS_TABLE } from './jobs-client';
import { Job } from './types';

/**
 * The queue's raw statements are simulated against the same in-memory rows
 * (see testing/jobs-raw), so these tests exercise the real claim rules
 * rather than a stub that always says yes.
 */

const makeJobs = () => {
  const { store, ctx } = makeFakeContext({ raw: jobsRawHandler });
  return { store, jobs: new JobsClient(ctx) };
};

const rowsOf = (store: FakeStore): Job[] => store.rows(JOBS_TABLE) as unknown as Job[];
const YESTERDAY = () => new Date(Date.now() - 86_400_000).toISOString();
const TOMORROW = () => new Date(Date.now() + 86_400_000).toISOString();

describe('enqueue', () => {
  it('queues a job that is immediately due', async () => {
    const { jobs } = makeJobs();
    const job = await jobs.enqueue('speech.analyze', { sessionId: 's1' });
    expect(job).toMatchObject({
      type: 'speech.analyze',
      status: 'queued',
      attempts: 0,
      max_attempts: 3,
      payload: { sessionId: 's1' },
    });
    expect(Date.parse(job.run_at)).toBeLessThanOrEqual(Date.now());
  });

  it('defers a job to runAt', async () => {
    const { jobs } = makeJobs();
    const runAt = TOMORROW();
    const job = await jobs.enqueue('reminder.send', {}, { runAt });
    expect(job.run_at).toBe(runAt);
    expect(await jobs.claim('w1')).toHaveLength(0);
  });

  it('returns the existing job for a repeated idempotency key', async () => {
    // A mobile client retrying a POST must not queue the same expensive work
    // twice.
    const { store, jobs } = makeJobs();
    const first = await jobs.enqueue('speech.analyze', { a: 1 }, { idempotencyKey: 'k1' });
    const second = await jobs.enqueue('speech.analyze', { a: 2 }, { idempotencyKey: 'k1' });
    expect(second.id).toBe(first.id);
    expect(second.payload).toEqual({ a: 1 });
    expect(rowsOf(store)).toHaveLength(1);
  });

  it('keeps jobs without a key independent', async () => {
    const { store, jobs } = makeJobs();
    await jobs.enqueue('x');
    await jobs.enqueue('x');
    expect(rowsOf(store)).toHaveLength(2);
  });

  it('omits the DEFAULT now() columns from the insert', async () => {
    const { store, jobs } = makeJobs();
    await jobs.enqueue('x');
    const insert = store.payloads.find((p) => p.type === 'INSERT');
    expect(insert?.data).not.toHaveProperty('created_at');
    expect(insert?.data).not.toHaveProperty('updated_at');
  });

  it('validates its input', async () => {
    const { jobs } = makeJobs();
    await expect(jobs.enqueue('')).rejects.toThrow(/"type" must be a non-empty string/);
    await expect(jobs.enqueue('x', {}, { maxAttempts: 0 })).rejects.toThrow(
      /"maxAttempts" must be a positive integer/,
    );
    await expect(jobs.enqueue('x', {}, { runAt: 'soon' })).rejects.toThrow(
      /"runAt" must be an ISO timestamp/,
    );
  });
});

describe('claim', () => {
  it('takes a due job and marks it running with an attempt', async () => {
    const { jobs } = makeJobs();
    await jobs.enqueue('x');
    const [claimed] = await jobs.claim('worker-1');
    expect(claimed).toMatchObject({ status: 'running', attempts: 1, claimed_by: 'worker-1' });
    expect(claimed!.lease_expires_at).not.toBeNull();
  });

  it('does not hand the same job to a second worker', async () => {
    const { jobs } = makeJobs();
    await jobs.enqueue('x');
    expect(await jobs.claim('worker-1')).toHaveLength(1);
    expect(await jobs.claim('worker-2')).toHaveLength(0);
  });

  it('reclaims a job whose lease expired', async () => {
    // The recovery path for a worker that died mid-run — otherwise the job
    // is stuck in `running` forever.
    const { store, jobs } = makeJobs();
    await jobs.enqueue('x');
    await jobs.claim('worker-1', { leaseSeconds: 60 });
    rowsOf(store)[0]!.lease_expires_at = YESTERDAY();

    const [reclaimed] = await jobs.claim('worker-2');
    expect(reclaimed).toMatchObject({ claimed_by: 'worker-2', attempts: 2 });
  });

  it('respects the type filter', async () => {
    const { jobs } = makeJobs();
    await jobs.enqueue('a');
    await jobs.enqueue('b');
    const claimed = await jobs.claim('w1', { types: ['b'], limit: 10 });
    expect(claimed.map((job) => job.type)).toEqual(['b']);
  });

  it('honours the limit and takes the oldest first', async () => {
    const { store, jobs } = makeJobs();
    await jobs.enqueue('x', { n: 1 });
    await jobs.enqueue('x', { n: 2 });
    await jobs.enqueue('x', { n: 3 });
    rowsOf(store)[0]!.run_at = new Date(Date.now() - 3000).toISOString();
    rowsOf(store)[1]!.run_at = new Date(Date.now() - 2000).toISOString();
    rowsOf(store)[2]!.run_at = new Date(Date.now() - 1000).toISOString();

    const claimed = await jobs.claim('w1', { limit: 2 });
    expect(claimed.map((job) => job.payload.n)).toEqual([1, 2]);
  });

  it('validates its input', async () => {
    const { jobs } = makeJobs();
    await expect(jobs.claim('')).rejects.toThrow(/"worker" must be a non-empty string/);
    await expect(jobs.claim('w', { limit: 0 })).rejects.toThrow(/"limit" must be a positive/);
    await expect(jobs.claim('w', { leaseSeconds: 0 })).rejects.toThrow(
      /"leaseSeconds" must be positive/,
    );
  });
});

describe('complete and fail', () => {
  it('stores the handler result on success', async () => {
    const { store, jobs } = makeJobs();
    const job = await jobs.enqueue('x');
    await jobs.claim('w1');
    await jobs.complete(job.id, { words: 412 });
    expect(rowsOf(store)[0]).toMatchObject({
      status: 'succeeded',
      result: { words: 412 },
      error: null,
      lease_expires_at: null,
    });
  });

  it('requeues with backoff while attempts remain', async () => {
    const { store, jobs } = makeJobs();
    const job = await jobs.enqueue('x');
    await jobs.claim('w1');
    await jobs.fail(job.id, new Error('upstream 503'));

    const row = rowsOf(store)[0]!;
    expect(row).toMatchObject({ status: 'failed', error: 'upstream 503', claimed_by: null });
    // First retry waits ~10s, so it is not immediately claimable again.
    expect(Date.parse(row.run_at)).toBeGreaterThan(Date.now() + 5_000);
    expect(await jobs.claim('w1')).toHaveLength(0);
  });

  it('backs off further on each attempt', async () => {
    const { store, jobs } = makeJobs();
    const job = await jobs.enqueue('x', {}, { maxAttempts: 5 });
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      rowsOf(store)[0]!.run_at = YESTERDAY();
      rowsOf(store)[0]!.status = 'queued';
      await jobs.claim('w1');
      await jobs.fail(job.id, 'boom');
      delays.push(Date.parse(rowsOf(store)[0]!.run_at) - Date.now());
    }
    expect(delays[1]).toBeGreaterThan(delays[0]!);
    expect(delays[2]).toBeGreaterThan(delays[1]!);
  });

  it('declares a job dead once attempts are exhausted', async () => {
    const { store, jobs } = makeJobs();
    const job = await jobs.enqueue('x', {}, { maxAttempts: 1 });
    await jobs.claim('w1');
    await jobs.fail(job.id, 'boom');
    expect(rowsOf(store)[0]).toMatchObject({ status: 'dead', error: 'boom' });
  });

  it('goes straight to dead when retry is disabled', async () => {
    // Bad input will not fix itself; burning three attempts on it is waste.
    const { store, jobs } = makeJobs();
    const job = await jobs.enqueue('x', {}, { maxAttempts: 5 });
    await jobs.claim('w1');
    await jobs.fail(job.id, 'malformed payload', { retry: false });
    expect(rowsOf(store)[0]).toMatchObject({ status: 'dead' });
  });

  it('stores a readable message for a non-Error failure', async () => {
    const { store, jobs } = makeJobs();
    const job = await jobs.enqueue('x', {}, { maxAttempts: 1 });
    await jobs.claim('w1');
    await jobs.fail(job.id, { code: 500 });
    expect(rowsOf(store)[0]!.error).toBe('{"code":500}');
  });

  it('rejects a failure for a job that does not exist', async () => {
    const { jobs } = makeJobs();
    await expect(jobs.fail('nope', 'x')).rejects.toThrow(/unknown job "nope"/);
  });
});

describe('work', () => {
  it('claims, runs and completes in one pass', async () => {
    const { store, jobs } = makeJobs();
    await jobs.enqueue('speech.analyze', { sessionId: 's1' });
    const handler = jest.fn(async () => ({ words: 10 }));

    const summary = await jobs.work({ 'speech.analyze': handler }, { limit: 10 });

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1, failed: 0 });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ payload: { sessionId: 's1' } }));
    expect(rowsOf(store)[0]).toMatchObject({ status: 'succeeded', result: { words: 10 } });
  });

  it('one failing job does not stop the pass', async () => {
    const { jobs } = makeJobs();
    await jobs.enqueue('a');
    await jobs.enqueue('b');
    const summary = await jobs.work(
      {
        a: async () => {
          throw new Error('boom');
        },
        b: async () => ({ ok: true }),
      },
      { limit: 10 },
    );
    expect(summary).toMatchObject({ claimed: 2, succeeded: 1, failed: 1 });
  });

  it('only claims types it can handle', async () => {
    const { store, jobs } = makeJobs();
    await jobs.enqueue('known');
    await jobs.enqueue('other');
    await jobs.work({ known: async () => undefined }, { limit: 10 });
    const other = rowsOf(store).find((job) => job.type === 'other');
    expect(other).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('kills an unroutable job rather than retrying it forever', async () => {
    const { store, jobs } = makeJobs();
    await jobs.enqueue('ghost');
    const summary = await jobs.work({ ghost: undefined as never }, { types: ['ghost'], limit: 10 });
    expect(summary.unhandled).toEqual(['ghost']);
    expect(rowsOf(store)[0]).toMatchObject({ status: 'dead' });
  });

  it('does nothing when no handlers are registered', async () => {
    const { jobs } = makeJobs();
    await jobs.enqueue('x');
    expect(await jobs.work({})).toMatchObject({ claimed: 0, succeeded: 0, failed: 0 });
  });

  it('treats a void handler as success with no result', async () => {
    const { store, jobs } = makeJobs();
    await jobs.enqueue('x');
    await jobs.work({ x: async () => undefined });
    expect(rowsOf(store)[0]).toMatchObject({ status: 'succeeded', result: null });
  });
});

describe('list and purge', () => {
  it('filters by status and type', async () => {
    const { jobs } = makeJobs();
    await jobs.enqueue('a');
    await jobs.enqueue('b');
    expect(await jobs.list({ type: 'a' })).toHaveLength(1);
    expect(await jobs.list({ status: 'queued' })).toHaveLength(2);
    expect(await jobs.list({ status: 'dead' })).toHaveLength(0);
  });

  it('purges old successes and keeps dead jobs', async () => {
    // Dead jobs are the ones worth keeping — they are the bug reports.
    const { store, jobs } = makeJobs();
    const done = await jobs.enqueue('a');
    const dead = await jobs.enqueue('b', {}, { maxAttempts: 1 });
    await jobs.claim('w1', { limit: 10 });
    await jobs.complete(done.id);
    await jobs.fail(dead.id, 'boom');
    for (const row of rowsOf(store)) row.updated_at = new Date(Date.now() - 60 * 86_400_000).toISOString();

    expect(await jobs.purge({ olderThanDays: 30 })).toBe(1);
    expect(rowsOf(store).map((job) => job.status)).toEqual(['dead']);
  });

  it('keeps recent successes', async () => {
    const { jobs } = makeJobs();
    const job = await jobs.enqueue('a');
    await jobs.claim('w1');
    await jobs.complete(job.id);
    expect(await jobs.purge({ olderThanDays: 30 })).toBe(0);
  });

  it('rejects a non-positive window', async () => {
    const { jobs } = makeJobs();
    await expect(jobs.purge({ olderThanDays: 0 })).rejects.toThrow(/must be positive/);
  });
});
