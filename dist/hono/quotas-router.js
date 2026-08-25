"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quotasRouter = quotasRouter;
const hono_1 = require("hono");
const auth_1 = require("./auth");
const client_1 = require("./client");
const errors_1 = require("./errors");
const router_utils_1 = require("./router-utils");
function quotasRouter(options = {}) {
    const app = new hono_1.Hono();
    (0, router_utils_1.applyCors)(app, options.cors);
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    const resolveClient = (0, client_1.makeClientResolver)('quotas', options.client);
    const quotasOf = (c) => resolveClient(c).modules.quotas;
    const auth = (0, auth_1.requireAuth)({ client: options.client });
    const configured = options.quotas ?? {};
    const keys = Object.keys(configured);
    // No rate limiter: both routes are reads, and the write routes elsewhere
    // are metered because they cost something durable. A peek is one indexed
    // SELECT per key, and the keys are a fixed server-side list.
    app.get('/quotas', auth, async (c) => {
        requireConfigured(keys);
        const requested = c.req.query('keys');
        const wanted = requested
            ? requested
                .split(',')
                .map((key) => key.trim())
                .filter((key) => key !== '')
            : // No `keys` means "everything this app meters" — the natural
                // request for a usage screen that shows the whole plan.
                keys;
        const unknown = wanted.filter((key) => !(key in configured));
        if (unknown.length > 0) {
            return (0, errors_1.badRequest)(c, `Unknown quota${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. ` +
                `This app meters ${keys.join(', ')}.`);
        }
        const subject = (0, auth_1.requireUser)(c).id;
        const quotas = quotasOf(c);
        const states = await Promise.all(wanted.map((key) => peek(quotas, subject, key, configured)));
        return c.json({ quotas: states });
    });
    app.get('/quotas/:key', auth, async (c) => {
        requireConfigured(keys);
        const key = c.req.param('key');
        if (!(key in configured)) {
            // A 404 rather than a 400: the caller asked for a resource this app
            // does not have, and the message names the ones it does so the fix
            // is obvious from the response alone.
            return c.json({
                error: {
                    code: 'NOT_FOUND',
                    message: `Unknown quota "${key}". This app meters ${keys.join(', ')}.`,
                },
            }, 404);
        }
        return c.json(await peek(quotasOf(c), (0, auth_1.requireUser)(c).id, key, configured));
    });
    return app;
}
/* ── helpers ───────────────────────────────────────────────────────────── */
/** `QuotaState` for one key, with the key on it so a list is self-describing. */
async function peek(quotas, subject, key, configured) {
    const definition = configured[key];
    // `peek`, never `consume` — see the note at the top of this file.
    const state = await quotas.peek(subject, key, {
        limit: definition.limit,
        period: definition.period ?? 'month',
    });
    // No `normalizeRow` here: `QuotaState` is built by the client rather than
    // read from a table, so it is already camelCase and normalizing it would
    // only suggest it came from a row.
    //
    // `{ key, ...state }` is deliberately the same shape `paymentRequired()`
    // embeds as its `quota` (see errors.ts), so the meter a screen draws and
    // the 402 that stops it carry identical fields — one renderer, not two.
    return { key, ...state };
}
function requireConfigured(keys) {
    if (keys.length === 0) {
        throw new errors_1.NotConfiguredError('This app declares no quotas — pass them to quotasRouter({ quotas: { … } }) ' +
            '(or createXenitionApi), where the limits stay server-side.');
    }
}
//# sourceMappingURL=quotas-router.js.map