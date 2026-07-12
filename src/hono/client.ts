import type { Context } from 'hono';
import { XenitionClient } from '../xenition-client';
import type { ModuleName } from '../modules';

/**
 * Configuration failure (missing XENITION_API_KEY). Distinguished from
 * runtime errors so the error handler can answer with a *safe* 500 body
 * that tells the operator what to fix without leaking anything.
 */
export class XenitionApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XenitionApiConfigError';
  }
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
 */
export function readEnvVar(c: Context, name: string): string | undefined {
  const fromCtx = (c.env as Record<string, unknown> | undefined)?.[name];
  if (typeof fromCtx === 'string' && fromCtx !== '') return fromCtx;
  const fromProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[name];
  return typeof fromProcess === 'string' && fromProcess !== '' ? fromProcess : undefined;
}

/** Build a service-key client from injected env vars. */
export function createClientFromEnv(vars: XenitionEnvVars): XenitionClient {
  const apiKey = vars.XENITION_API_KEY;
  if (!apiKey) {
    throw new XenitionApiConfigError(
      'Xenition backend routers need the XENITION_API_KEY secret (injected by the ' +
        'deploy pipeline) or an explicit `client` option.',
    );
  }
  const baseUrl = vars.XENITION_API_URL;
  return new XenitionClient(apiKey, baseUrl ? { baseUrl } : {});
}

/**
 * Per-router client resolver. The provided client (or the one built from
 * env on the first request) is cached for the router's lifetime — env is
 * stable within a Workers isolate / Node process. `modules.use()` (never
 * `enable()` — no DDL at request time) is idempotent, so marking the
 * module usable on every call is free.
 */
export function makeClientResolver(
  module: ModuleName,
  provided?: XenitionClient,
): (c: Context) => XenitionClient {
  let cached: XenitionClient | undefined = provided;
  return (c: Context): XenitionClient => {
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
