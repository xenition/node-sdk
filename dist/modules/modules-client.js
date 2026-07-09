"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModulesClient = void 0;
const errors_1 = require("../core/errors");
const query_client_1 = require("../query/query-client");
const cms_1 = require("./cms");
const forms_1 = require("./forms");
const reviews_1 = require("./reviews");
const listings_1 = require("./listings");
const events_1 = require("./events");
const media_1 = require("./media");
const booking_1 = require("./booking");
const catalog_1 = require("./catalog");
const inventory_1 = require("./inventory");
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
class ModulesClient {
    constructor(http, migrationsClient) {
        this.migrationsClient = migrationsClient;
        this.enabled = new Set();
        this.instances = new Map();
        this.definitions = {
            cms: cms_1.cmsModule,
            forms: forms_1.formsModule,
            reviews: reviews_1.reviewsModule,
            listings: listings_1.listingsModule,
            events: events_1.eventsModule,
            media: media_1.mediaModule,
            booking: booking_1.bookingModule,
            catalog: catalog_1.catalogModule,
            inventory: inventory_1.inventoryModule,
        };
        const query = new query_client_1.QueryClient(http);
        this.ctx = {
            query,
            raw: (sql, params = []) => query.raw(sql, params),
        };
    }
    /**
     * Run the module's migrations (service key) and unlock its accessor.
     * Idempotent — call it on every boot; the ledger skips applied steps.
     */
    async enable(name) {
        const definition = this.definition(name);
        try {
            await this.migrationsClient.apply(definition.migrations);
        }
        catch (err) {
            if (err instanceof errors_1.XenitionError && err.code === 'AUTH_FORBIDDEN') {
                throw new Error(`ModulesClient.enable('${name}'): migrations need a service key ` +
                    '(raw SQL is rejected for anon keys). Enable the module from your ' +
                    `backend/deploy step, then call client.modules.use('${name}') in ` +
                    'anon-key contexts.');
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
    use(name) {
        this.definition(name);
        this.enabled.add(name);
    }
    /** Whether enable()/use() has been called for the module in this client. */
    isEnabled(name) {
        return this.enabled.has(name);
    }
    get cms() {
        return this.access('cms');
    }
    get forms() {
        return this.access('forms');
    }
    get reviews() {
        return this.access('reviews');
    }
    get listings() {
        return this.access('listings');
    }
    get events() {
        return this.access('events');
    }
    get media() {
        return this.access('media');
    }
    get booking() {
        return this.access('booking');
    }
    get catalog() {
        return this.access('catalog');
    }
    get inventory() {
        return this.access('inventory');
    }
    // ───────── internals ─────────
    definition(name) {
        const definition = this.definitions[name];
        if (!definition) {
            throw new Error(`ModulesClient: unknown module "${String(name)}". Available modules: ` +
                `${Object.keys(this.definitions).join(', ')}.`);
        }
        return definition;
    }
    access(name) {
        if (!this.enabled.has(name)) {
            throw new Error(`ModulesClient: module "${name}" is not enabled — its tables may not exist yet. ` +
                `Run \`await client.modules.enable('${name}')\` once at startup (service key; ` +
                `idempotent), or \`client.modules.use('${name}')\` if the tables were already ` +
                'migrated (e.g. anon-key browser contexts).');
        }
        let instance = this.instances.get(name);
        if (instance === undefined) {
            instance = this.definition(name).factory(this.ctx);
            this.instances.set(name, instance);
        }
        return instance;
    }
}
exports.ModulesClient = ModulesClient;
//# sourceMappingURL=modules-client.js.map