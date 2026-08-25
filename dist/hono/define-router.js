"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defineRouter = defineRouter;
exports.buildCustomRouter = buildCustomRouter;
const hono_1 = require("hono");
const client_1 = require("./client");
const auth_1 = require("./auth");
const billing_router_1 = require("./billing-router");
const errors_1 = require("./errors");
const rate_limit_1 = require("./rate-limit");
const NAME_RE = /^[a-z][a-z0-9-]*$/;
/**
 * Declare a custom router. Purely declarative — nothing is built until
 * `createXenitionApi` mounts it, matching how `defineModule` behaves.
 */
function defineRouter(definition) {
    if (typeof definition?.name !== 'string' || !NAME_RE.test(definition.name)) {
        throw new Error(`defineRouter: "name" must be kebab-case ([a-z][a-z0-9-]*), got ${JSON.stringify(definition?.name)}.`);
    }
    if (typeof definition.build !== 'function') {
        throw new Error(`defineRouter: router "${definition.name}" needs a build function.`);
    }
    return Object.freeze({
        name: definition.name,
        build: definition.build,
        paths: definition.paths ? { ...definition.paths } : undefined,
    });
}
/** Build one custom router into a mountable Hono app. */
function buildCustomRouter(definition, options) {
    const app = new hono_1.Hono();
    // Set on the CHILD, exactly as every built-in router does. A mounted
    // sub-app resolves its own `notFound` first, so relying on the parent's
    // leaves custom routes answering Hono's default text/plain 404 while the
    // built-ins answer JSON — the kind of inconsistency a client only trips
    // over in production.
    app.onError(errors_1.honoErrorHandler);
    app.notFound(errors_1.jsonNotFound);
    definition.build(app, makeToolkit(options));
    return app;
}
function makeToolkit(options) {
    // Resolved once per router, like the built-ins: env is stable within an
    // isolate, and building a client per request would be pure overhead.
    let cached = options.client;
    const client = (c) => {
        if (!cached) {
            cached = (0, client_1.createClientFromEnv)({
                XENITION_API_KEY: (0, client_1.readEnvVar)(c, 'XENITION_API_KEY'),
                XENITION_API_URL: (0, client_1.readEnvVar)(c, 'XENITION_API_URL'),
            });
        }
        return cached;
    };
    return {
        client,
        env: client_1.readEnvVar,
        requireAuth: (0, auth_1.requireAuth)({ client: options.client }),
        optionalAuth: (0, auth_1.xenitionAuth)({ client: options.client }),
        requireEntitlement: (entitlement, message) => (0, billing_router_1.requireEntitlement)(entitlement, { client: options.client, message }),
        rateLimit: (perMinute) => (0, rate_limit_1.rateLimiter)(perMinute ?? (options.rateLimit || 10)),
    };
}
//# sourceMappingURL=define-router.js.map