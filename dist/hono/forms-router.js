"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formsRouter = formsRouter;
const hono_1 = require("hono");
const client_1 = require("./client");
const errors_1 = require("./errors");
const normalize_1 = require("./normalize");
const rate_limit_1 = require("./rate-limit");
const router_utils_1 = require("./router-utils");
/**
 * Forms routes — the sanctioned write path for form submissions (the
 * platform bans anon-key writes, so browsers can't insert directly).
 *
 *   GET  /:key              → the form's field schema (for rendering)
 *   POST /:key/submissions  → body is the submission `data` object;
 *                             201 {id} on success, 400 with the SDK's
 *                             aggregated validation message on bad input.
 *
 * Submissions are rate limited per IP (best-effort — see rate-limit.ts).
 * The submission `meta` records ip + user-agent for back-office triage.
 */
function formsRouter(options = {}) {
    const resolve = (0, client_1.makeClientResolver)('forms', options.client);
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    app.get('/:key', async (c) => {
        const forms = resolve(c).modules.forms;
        const form = await forms.getForm(c.req.param('key'));
        if (!form)
            return (0, errors_1.jsonNotFound)(c);
        return c.json((0, normalize_1.normalizeRow)(form));
    });
    // Attached to the POST route only — reads stay unmetered.
    if (options.rateLimit !== false) {
        app.post('/:key/submissions', (0, rate_limit_1.rateLimiter)(options.rateLimit ?? 10));
    }
    app.post('/:key/submissions', async (c) => {
        const forms = resolve(c).modules.forms;
        const body = await c.req.json().catch(() => undefined);
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            return (0, errors_1.badRequest)(c, 'Request body must be a JSON object of field values.');
        }
        const submission = await forms.submit(c.req.param('key'), body, {
            ip: (0, rate_limit_1.clientIp)(c),
            userAgent: c.req.header('user-agent') ?? '',
        });
        return c.json({ id: submission.id }, 201);
    });
    return app;
}
//# sourceMappingURL=forms-router.js.map