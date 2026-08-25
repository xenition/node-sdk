"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobsRouter = jobsRouter;
const hono_1 = require("hono");
const auth_1 = require("./auth");
const client_1 = require("./client");
const errors_1 = require("./errors");
const router_utils_1 = require("./router-utils");
function jobsRouter(options = {}) {
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    const resolveClient = (0, client_1.makeClientResolver)('jobs', options.client);
    const ownerField = options.ownerField ?? 'userId';
    const auth = (0, auth_1.requireAuth)({ client: options.client });
    app.get('/jobs/:id', auth, async (c) => {
        const id = c.req.param('id');
        const callerId = (0, auth_1.requireUser)(c).id;
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
//# sourceMappingURL=jobs-router.js.map