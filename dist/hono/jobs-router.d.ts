import { Hono } from 'hono';
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
export declare function jobsRouter(options?: JobsRouterOptions): Hono;
//# sourceMappingURL=jobs-router.d.ts.map