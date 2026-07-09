"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.XenitionApiConfigError = void 0;
exports.createClientFromEnv = createClientFromEnv;
exports.makeClientResolver = makeClientResolver;
const xenition_client_1 = require("../xenition-client");
/**
 * Configuration failure (missing XENITION_API_KEY). Distinguished from
 * runtime errors so the error handler can answer with a *safe* 500 body
 * that tells the operator what to fix without leaking anything.
 */
class XenitionApiConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'XenitionApiConfigError';
    }
}
exports.XenitionApiConfigError = XenitionApiConfigError;
/**
 * Read one env var from the Hono context env (Cloudflare Workers bindings
 * / secrets) with a `process.env` fallback (Node, tests). Checked in that
 * order so Workers secrets always win.
 */
function readEnvVar(c, name) {
    const fromCtx = c.env?.[name];
    if (typeof fromCtx === 'string' && fromCtx !== '')
        return fromCtx;
    const fromProcess = globalThis
        .process?.env?.[name];
    return typeof fromProcess === 'string' && fromProcess !== '' ? fromProcess : undefined;
}
/** Build a service-key client from injected env vars. */
function createClientFromEnv(vars) {
    const apiKey = vars.XENITION_API_KEY;
    if (!apiKey) {
        throw new XenitionApiConfigError('Xenition backend routers need the XENITION_API_KEY secret (injected by the ' +
            'deploy pipeline) or an explicit `client` option.');
    }
    const baseUrl = vars.XENITION_API_URL;
    return new xenition_client_1.XenitionClient(apiKey, baseUrl ? { baseUrl } : {});
}
/**
 * Per-router client resolver. The provided client (or the one built from
 * env on the first request) is cached for the router's lifetime — env is
 * stable within a Workers isolate / Node process. `modules.use()` (never
 * `enable()` — no DDL at request time) is idempotent, so marking the
 * module usable on every call is free.
 */
function makeClientResolver(module, provided) {
    let cached = provided;
    return (c) => {
        if (!cached) {
            cached = createClientFromEnv({
                XENITION_API_KEY: readEnvVar(c, 'XENITION_API_KEY'),
                XENITION_API_URL: readEnvVar(c, 'XENITION_API_URL'),
            });
        }
        cached.modules.use(module);
        return cached;
    };
}
//# sourceMappingURL=client.js.map