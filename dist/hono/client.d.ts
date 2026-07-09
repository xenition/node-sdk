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
/** Build a service-key client from injected env vars. */
export declare function createClientFromEnv(vars: XenitionEnvVars): XenitionClient;
/**
 * Per-router client resolver. The provided client (or the one built from
 * env on the first request) is cached for the router's lifetime — env is
 * stable within a Workers isolate / Node process. `modules.use()` (never
 * `enable()` — no DDL at request time) is idempotent, so marking the
 * module usable on every call is free.
 */
export declare function makeClientResolver(module: ModuleName, provided?: XenitionClient): (c: Context) => XenitionClient;
//# sourceMappingURL=client.d.ts.map