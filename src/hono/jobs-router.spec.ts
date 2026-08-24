import { Hono } from 'hono';
import { XenitionClient } from '../xenition-client';
import { JobsClient } from '../modules/jobs';
import { makeFakeContext } from '../testing/fake-store';
import { jobsRawHandler } from '../testing/jobs-raw';
import type { User } from '../auth/types';
import { jobsRouter } from './jobs-router';

/**
 * The whole point of this router is that it does NOT hand a job to whoever
 * asks. Most of these tests are about that.
 */
const USER: User = {
  id: 'user-1',
  email: 'a@example.com',
  role: 'authenticated',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const auth = { headers: { Authorization: 'Bearer tok' } };

const makeApp = async (options: Record<string, unknown> = {}) => {
  const { ctx } = makeFakeContext({ raw: jobsRawHandler });
  const jobs = new JobsClient(ctx);
  const client = {
    auth: { verifyToken: jest.fn().mockResolvedValue(USER) },
    modules: { use: jest.fn(), jobs },
  } as unknown as XenitionClient;

  const app = new Hono();
  app.route('/api', jobsRouter({ client, ...options }));
  return { app, jobs };
};

describe('GET /jobs/:id', () => {
  it('reports a queued job the caller owns', async () => {
    const { app, jobs } = await makeApp();
    const job = await jobs.enqueue('speech.analyze', { userId: 'user-1', sessionId: 's1' });

    const res = await app.request(`/api/jobs/${job.id}`, auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: job.id,
      type: 'speech.analyze',
      status: 'queued',
      done: false,
      failed: false,
    });
  });

  it('returns the result once the job succeeded', async () => {
    const { app, jobs } = await makeApp();
    const job = await jobs.enqueue('speech.analyze', { userId: 'user-1' });
    await jobs.complete(job.id, { words: 412 });

    const res = await app.request(`/api/jobs/${job.id}`, auth);
    expect(await res.json()).toMatchObject({
      status: 'succeeded',
      done: true,
      result: { words: 412 },
    });
  });

  it('404s for another user’s job', async () => {
    // Same 404 as "no such job" — distinguishing them would confirm which
    // ids exist, and a job result can contain anything.
    const { app, jobs } = await makeApp();
    const job = await jobs.enqueue('speech.analyze', { userId: 'someone-else', secret: 'shh' });

    const res = await app.request(`/api/jobs/${job.id}`, auth);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('shh');
  });

  it('404s for a job with no owner in its payload', async () => {
    const { app, jobs } = await makeApp();
    const job = await jobs.enqueue('internal.cleanup', {});
    expect((await app.request(`/api/jobs/${job.id}`, auth)).status).toBe(404);
  });

  it('404s for an id that does not exist', async () => {
    const { app } = await makeApp();
    expect((await app.request('/api/jobs/nope', auth)).status).toBe(404);
  });

  it('401s without a token', async () => {
    const { app, jobs } = await makeApp();
    const job = await jobs.enqueue('x', { userId: 'user-1' });
    expect((await app.request(`/api/jobs/${job.id}`)).status).toBe(401);
  });

  it('honours a custom owner field', async () => {
    const { app, jobs } = await makeApp({ ownerField: 'ownerId' });
    const job = await jobs.enqueue('x', { ownerId: 'user-1' });
    expect((await app.request(`/api/jobs/${job.id}`, auth)).status).toBe(200);
  });

  it('never leaks the stored error text to the device', async () => {
    // The message can carry upstream detail — a URL, a provider's response.
    const { app, jobs } = await makeApp();
    const job = await jobs.enqueue('x', { userId: 'user-1' }, { maxAttempts: 1 });
    await jobs.claim('w1');
    await jobs.fail(job.id, 'postgres://user:pw@host timed out');

    const res = await app.request(`/api/jobs/${job.id}`, auth);
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ status: 'dead', done: true, failed: true });
    expect(body).not.toContain('postgres://');
  });

  it('distinguishes a retrying job from a dead one', async () => {
    // `failed` is a rest between retries; the client must keep polling.
    const { app, jobs } = await makeApp();
    const job = await jobs.enqueue('x', { userId: 'user-1' }, { maxAttempts: 3 });
    await jobs.claim('w1');
    await jobs.fail(job.id, 'transient');

    expect(await (await app.request(`/api/jobs/${job.id}`, auth)).json()).toMatchObject({
      status: 'failed',
      done: false,
      failed: false,
    });
  });

  it('exposes no way to enqueue work', async () => {
    // An open enqueue endpoint is a free denial-of-service against the app's
    // own worker.
    const { app } = await makeApp();
    const res = await app.request('/api/jobs', {
      method: 'POST',
      headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'anything' }),
    });
    expect(res.status).toBe(404);
  });
});
