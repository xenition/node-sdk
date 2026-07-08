import { QueryClient } from '../query/query-client';
import { QueryResult } from '../query/types';
import { Migration } from '../migrations/types';

/**
 * Module framework v0 — content-domain modules implemented *client-side*
 * over the existing `/app-platform/query` + `/app-platform/raw` endpoints.
 *
 * A module is nothing more than:
 *   - a migration set (its tables, all prefixed `<module>__`), and
 *   - a typed client class built by `factory(ctx)`.
 *
 * `client.modules.enable('<name>')` runs the module's migrations through
 * the `_sdk_migrations` ledger (service key; idempotent), after which
 * `client.modules.<name>` returns the typed client. No decorators, no
 * registries-by-side-effect, no magic — modules are plain frozen objects.
 *
 * v0 trust model: validation lives in the SDK, so it protects well-behaved
 * apps from bad data, not the database from hostile clients. Server-side
 * hardening (RLS-style table policies, per-module endpoints) lands later
 * per the platform master plan.
 */

/** Everything a module client gets to talk to the platform with. */
export interface ModuleContext {
  /** Shared query builder entry point (`ctx.query.from('cms__pages')…`). */
  readonly query: QueryClient;
  /** Raw parameterized SQL — service-key only (server 403s anon keys). */
  raw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface ModuleDefinition<TClient> {
  /** Module name — also the table prefix (`<name>__*`). Kebab-case. */
  name: string;
  /** The module's schema, expressed as ledger migrations. */
  migrations: Migration[];
  /** Builds the typed client once the module is enabled. */
  factory(ctx: ModuleContext): TClient;
}

const MODULE_NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Declares a module. Purely declarative — nothing runs until
 * `client.modules.enable(name)` executes the migration set.
 */
export function defineModule<TClient>(
  definition: ModuleDefinition<TClient>,
): ModuleDefinition<TClient> {
  if (typeof definition.name !== 'string' || !MODULE_NAME_RE.test(definition.name)) {
    throw new Error(
      `defineModule: "name" must be kebab-case ([a-z][a-z0-9-]*), got ${JSON.stringify(
        definition.name,
      )}.`,
    );
  }
  if (!Array.isArray(definition.migrations)) {
    throw new Error(`defineModule: module "${definition.name}" needs a migrations array.`);
  }
  if (typeof definition.factory !== 'function') {
    throw new Error(`defineModule: module "${definition.name}" needs a factory function.`);
  }
  return Object.freeze({
    name: definition.name,
    migrations: [...definition.migrations],
    factory: definition.factory,
  });
}
