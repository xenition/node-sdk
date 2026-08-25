import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireAuth, requireUser } from './auth';
import { makeClientResolver } from './client';
import { honoErrorHandler, jsonNotFound } from './errors';
import { applyCors } from './router-utils';
import type { XenitionRouterOptions } from './types';

/**
 * `/jobs` — how a mobile client follows work it cannot wait for.
 *
 *   POST /speeches/:id/analyze  →  202 { jobId }
 *   GET  /jobs/:jobId           →  { status: 'running' }
 *                               →  { status: 'succeeded', result: {...} }
 *
 * Only the status route is exposed. Enqueuing is NOT a public operation:
 * the app decides what work exists and what it costs, and an endpoint that
 * let a client queue arbitrary job types would be a free denial-of-service
 * against its own worker.
 *
 * OWNERSHIP, because this is the part that is easy to get wrong: job ids
 * are opaque but guessable enough, and a job's result can contain anything.
 * A route that returned any job by id would let any signed-in user read
 * every other user's results. So a job is visible only when its payload
 * names the caller — by default `payload.userId`.
 *
 * The consequence is a convention worth knowing: put `userId` in the
 * payload of any job whose status a client will poll. A job without it is
 * simply invisible to this route, which is the safe direction.
 */

export interface JobsRouterOptions extends XenitionRouterOptions {
  /**
   * Payload field naming the owner. Default `userId`. Set it to match
   * whatever your handlers already store.
   */
  ownerField?: string;
}

export function jobsRouter(options: JobsRouterOptions = {}): Hono {
  const app = new Hono();
  applyCors(app, options.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  const resolveClient = makeClientResolver('jobs', options.client);
  const ownerField = options.ownerField ?? 'userId';
  const auth = requireAuth({ client: options.client });

  app.get('/jobs/:id', auth, async (c: Context) => {
    const id = c.req.param('id');
    const callerId = requireUser(c).id;
    const job = id ? await resolveClient(c).modules.jobs.get(id) : null;

    // Deliberately the same 404 for "no such job" and "not yours": telling
    // the difference would confirm which ids exist.
    if (!job || job.payload?.[ownerField] !== callerId) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Job not found.' } }, 404);
    }

    return c.json({
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      // `dead` is terminal; `failed` is a rest between retries. The client
      // needs that distinction to decide whether to keep polling.
      done: job.status === 'succeeded' || job.status === 'dead',
      result: job.result,
      // The stored error is an internal message — surfaced only as a flag,
      // never as text, so an upstream detail cannot leak to the device.
      failed: job.status === 'dead',
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    });
  });

  return app;
}
