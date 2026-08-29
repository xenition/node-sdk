import { QueryClient } from '../query/query-client';
import { QueryResult } from '../query/types';
import { Migration } from '../migrations/types';
import type { PushClient } from '../push/push-client';
import type { EmailClient } from '../email/email-client';
import type { BatchScope } from './batch';
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
    /**
     * Delivery channels, for modules whose job is to SEND something rather
     * than only to store it.
     *
     * Optional because most modules are pure data and should stay that way —
     * and because tests construct a context by hand. A module that needs a
     * channel must degrade gracefully when it is absent rather than assume
     * it: the notifications module still writes its inbox with no push
     * client, which is the behavior anyone testing it locally wants.
     */
    readonly push?: PushClient;
    readonly email?: EmailClient;
    /**
     * Per-tick query coalescing, present only when the app opted in with
     * `withBatching(ctx)` / `client.modules.enableBatching()`.
     *
     * Optional, and absent by default, because batching changes WHEN a query
     * leaves for the network — a lookup that used to go immediately now waits
     * for the microtask queue to drain. That is invisible to well-written
     * async code and it is exactly what turns "works locally" into "wrong
     * under load" for code that accidentally depends on the old timing. So a
     * module client reads it as a capability rather than a requirement: with
     * a scope present `loadOneBy` coalesces, without one it issues the same
     * single-row query it always has. See batch.ts, which also explains why
     * the scope hangs off the CONTEXT and not off a global registry.
     */
    readonly batch?: BatchScope;
}
export interface ModuleDefinition<TClient> {
    /** Module name — also the table prefix (`<name>__*`). Kebab-case. */
    name: string;
    /** The module's schema, expressed as ledger migrations. */
    migrations: Migration[];
    /** Builds the typed client once the module is enabled. */
    factory(ctx: ModuleContext): TClient;
}
/**
 * Declares a module. Purely declarative — nothing runs until
 * `client.modules.enable(name)` executes the migration set.
 */
export declare function defineModule<TClient>(definition: ModuleDefinition<TClient>): ModuleDefinition<TClient>;
//# sourceMappingURL=core.d.ts.map