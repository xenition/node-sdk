import type { Context } from 'hono';
import { XenitionClient } from '../xenition-client';
import type { ModuleName } from '../modules';
/**
 * Configuration failure (missing XENITION_API_KEY). Distinguished from
 * runtime errors so the error handler can answer with a *safe* 500 body
 * that tells the operator what to fix without leaking anything.
 */
export declare class XenitionApiConfigError extends Error {
    constructor(message: string);
}
/** Env vars the deploy pipeline injects into every generated app worker. */
export interface XenitionEnvVars {
    XENITION_API_KEY?: string;
    XENITION_API_URL?: string;
}
/**
 * Read one env var from the Hono context env (Cloudflare Workers bindings
 * / secrets) with a `process.env` fallback (Node, tests). Checked in that
 * order so Workers secrets always win.
 *
 * Exported because app code outside a router needs it too — a shared client
 * helper, a job handler, a migration script. It used to be internal, and
 * every generated app reimplemented these five lines verbatim.
 */
export declare function readEnvVar(c: Context, name: string): string | undefined;
/** Build a service-key client from injected env vars. */
export declare function createClientFromEnv(vars: XenitionEnvVars): XenitionClient;
/**
 * Per-router client resolver. The provided client (or the one built from
 * env on the first request) is cached for the router's lifetime — env is
 * stable within a Workers isolate / Node process. `modules.use()` (never
 * `enable()` — no DDL at request time) is idempotent, so marking the
 * module usable on every call is free.
 *
 * `module` is `null` for a router that touches NO data module — the auth
 * router talks to `client.auth`, which is not a module and has no accessor
 * to unlock. Passing a made-up name there would be worse than passing
 * nothing: `ModuleName` is the list the module framework migrates and
 * enables, and putting `'auth'` in it would claim a module exists that
 * never will.
 */
export declare function makeClientResolver(module: ModuleName | null, provided?: XenitionClient): (c: Context) => XenitionClient;
//# sourceMappingURL=client.d.ts.map