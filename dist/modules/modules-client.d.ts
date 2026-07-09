import { HttpClient } from '../core/http-client';
import { MigrationsClient } from '../migrations/migrations-client';
import { CmsClient } from './cms';
import { FormsClient } from './forms';
import { ReviewsClient } from './reviews';
import { ListingsClient } from './listings';
import { EventsClient } from './events';
import { MediaClient } from './media';
import { BookingClient } from './booking';
import { CatalogClient } from './catalog';
import { InventoryClient } from './inventory';
export type ModuleName = 'cms' | 'forms' | 'reviews' | 'listings' | 'events' | 'media' | 'booking' | 'catalog' | 'inventory';
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
export declare class ModulesClient {
    private readonly migrationsClient;
    private readonly ctx;
    private readonly enabled;
    private readonly instances;
    private readonly definitions;
    constructor(http: HttpClient, migrationsClient: MigrationsClient);
    /**
     * Run the module's migrations (service key) and unlock its accessor.
     * Idempotent — call it on every boot; the ledger skips applied steps.
     */
    enable(name: ModuleName): Promise<void>;
    /**
     * Unlock the accessor *without* running migrations — for anon-key
     * contexts where a service-key process already enabled the module.
     * If the tables don't actually exist, queries fail server-side
     * (QUERY_TABLE_NOT_FOUND).
     */
    use(name: ModuleName): void;
    /** Whether enable()/use() has been called for the module in this client. */
    isEnabled(name: ModuleName): boolean;
    get cms(): CmsClient;
    get forms(): FormsClient;
    get reviews(): ReviewsClient;
    get listings(): ListingsClient;
    get events(): EventsClient;
    get media(): MediaClient;
    get booking(): BookingClient;
    get catalog(): CatalogClient;
    get inventory(): InventoryClient;
    private definition;
    private access;
}
//# sourceMappingURL=modules-client.d.ts.map