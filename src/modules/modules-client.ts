import { HttpClient } from '../core/http-client';
import { XenitionError } from '../core/errors';
import { QueryClient } from '../query/query-client';
import { MigrationsClient } from '../migrations/migrations-client';
import { ModuleContext, ModuleDefinition } from './core';
import { CmsClient, cmsModule } from './cms';
import { FormsClient, formsModule } from './forms';
import { ReviewsClient, reviewsModule } from './reviews';
import { ListingsClient, listingsModule } from './listings';
import { EventsClient, eventsModule } from './events';

export type ModuleName = 'cms' | 'forms' | 'reviews' | 'listings' | 'events';

/**
 * `client.modules` — the module framework entry point.
 *
 * Lifecycle (explicit on purpose):
 *
 *   // service key — runs the module's migrations through the ledger
 *   // (idempotent; re-running is a no-op), then unlocks the accessor:
 *   await client.modules.enable('cms');
 *   const page = await client.modules.cms.getPageBySlug('about');
 *
 *   // anon key (browser) — migrations already ran on a service-key
 *   // deploy; just mark the module usable, no DDL:
 *   client.modules.use('forms');
 *   await client.modules.forms.submit('contact', { email: '...' });
 *
 * Accessing `client.modules.<name>` before enable()/use() throws with the
 * fix in the message — nothing is lazily migrated behind your back.
 */
export class ModulesClient {
  private readonly ctx: ModuleContext;
  private readonly enabled = new Set<ModuleName>();
  private readonly instances = new Map<ModuleName, unknown>();
  private readonly definitions: Record<ModuleName, ModuleDefinition<unknown>> = {
    cms: cmsModule,
    forms: formsModule,
    reviews: reviewsModule,
    listings: listingsModule,
    events: eventsModule,
  };

  constructor(
    http: HttpClient,
    private readonly migrationsClient: MigrationsClient,
  ) {
    const query = new QueryClient(http);
    this.ctx = {
      query,
      raw: (sql, params = []) => query.raw(sql, params),
    };
  }

  /**
   * Run the module's migrations (service key) and unlock its accessor.
   * Idempotent — call it on every boot; the ledger skips applied steps.
   */
  async enable(name: ModuleName): Promise<void> {
    const definition = this.definition(name);
    try {
      await this.migrationsClient.apply(definition.migrations);
    } catch (err) {
      if (err instanceof XenitionError && err.code === 'AUTH_FORBIDDEN') {
        throw new Error(
          `ModulesClient.enable('${name}'): migrations need a service key ` +
            '(raw SQL is rejected for anon keys). Enable the module from your ' +
            `backend/deploy step, then call client.modules.use('${name}') in ` +
            'anon-key contexts.',
        );
      }
      throw err;
    }
    this.enabled.add(name);
  }

  /**
   * Unlock the accessor *without* running migrations — for anon-key
   * contexts where a service-key process already enabled the module.
   * If the tables don't actually exist, queries fail server-side
   * (QUERY_TABLE_NOT_FOUND).
   */
  use(name: ModuleName): void {
    this.definition(name);
    this.enabled.add(name);
  }

  /** Whether enable()/use() has been called for the module in this client. */
  isEnabled(name: ModuleName): boolean {
    return this.enabled.has(name);
  }

  get cms(): CmsClient {
    return this.access<CmsClient>('cms');
  }

  get forms(): FormsClient {
    return this.access<FormsClient>('forms');
  }

  get reviews(): ReviewsClient {
    return this.access<ReviewsClient>('reviews');
  }

  get listings(): ListingsClient {
    return this.access<ListingsClient>('listings');
  }

  get events(): EventsClient {
    return this.access<EventsClient>('events');
  }

  // ───────── internals ─────────

  private definition(name: ModuleName): ModuleDefinition<unknown> {
    const definition = this.definitions[name];
    if (!definition) {
      throw new Error(
        `ModulesClient: unknown module "${String(name)}". Available modules: ` +
          `${Object.keys(this.definitions).join(', ')}.`,
      );
    }
    return definition;
  }

  private access<T>(name: ModuleName): T {
    if (!this.enabled.has(name)) {
      throw new Error(
        `ModulesClient: module "${name}" is not enabled — its tables may not exist yet. ` +
          `Run \`await client.modules.enable('${name}')\` once at startup (service key; ` +
          `idempotent), or \`client.modules.use('${name}')\` if the tables were already ` +
          'migrated (e.g. anon-key browser contexts).',
      );
    }
    let instance = this.instances.get(name);
    if (instance === undefined) {
      instance = this.definition(name).factory(this.ctx);
      this.instances.set(name, instance);
    }
    return instance as T;
  }
}
