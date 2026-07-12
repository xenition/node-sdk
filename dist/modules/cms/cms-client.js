"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmsModule = exports.CmsClient = exports.CMS_MIGRATIONS = exports.CMS_TABLES = void 0;
const core_1 = require("../core");
const util_1 = require("../util");
exports.CMS_TABLES = {
    PAGES: 'cms__pages',
    COLLECTIONS: 'cms__collections',
    ITEMS: 'cms__items',
};
exports.CMS_MIGRATIONS = [
    {
        id: 'cms/0001_create_cms__pages',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.CMS_TABLES.PAGES} (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  body_html text NOT NULL DEFAULT '',
  seo jsonb NOT NULL DEFAULT '{}'::jsonb,
  published boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
    },
    {
        id: 'cms/0002_create_cms__collections',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.CMS_TABLES.COLLECTIONS} (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
    },
    {
        id: 'cms/0003_create_cms__items',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.CMS_TABLES.ITEMS} (
  id uuid PRIMARY KEY,
  collection_id uuid NOT NULL REFERENCES ${exports.CMS_TABLES.COLLECTIONS}(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  published boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_id, slug)
)`,
    },
    {
        id: 'cms/0004_index_cms__items_collection',
        sql: `CREATE INDEX IF NOT EXISTS cms__items_collection_idx ON ${exports.CMS_TABLES.ITEMS} (collection_id, published, sort)`,
    },
];
const PAGE_ORDER_COLUMNS = ['sort', 'title', 'slug', 'created_at', 'updated_at'];
const ITEM_ORDER_COLUMNS = ['sort', 'title', 'slug', 'created_at', 'updated_at'];
/**
 * cms module client — pages, collections, and generic typed items
 * (menu entries, projects, speakers, …) over `cms__*` tables.
 *
 * Writes are validated client-side (v0 trust model — see modules/core.ts);
 * slugs are auto-generated from titles when absent and deduped with a
 * `-2`, `-3`, … suffix. Deletes are hard deletes: published/unpublished
 * already covers the "hide it" case, so v0 keeps no tombstones.
 */
class CmsClient {
    constructor(ctx) {
        this.ctx = ctx;
    }
    // ───────── pages ─────────
    async createPage(input) {
        const context = 'CmsClient.createPage';
        // Validate everything before the slug lookup so bad input never
        // costs a network round-trip.
        const title = (0, util_1.requireNonEmptyString)(context, 'title', input.title);
        const bodyHtml = (0, util_1.optionalString)(context, 'body_html', input.body_html, '');
        const seo = (0, util_1.optionalPlainObject)(context, 'seo', input.seo, {});
        const published = (0, util_1.optionalBoolean)(context, 'published', input.published, false);
        const sort = (0, util_1.optionalNumber)(context, 'sort', input.sort, 0);
        const slug = input.slug !== undefined
            ? (0, util_1.requireNonEmptyString)(context, 'slug', input.slug)
            : await this.uniqueSlug(exports.CMS_TABLES.PAGES, (0, util_1.slugify)(title));
        const now = (0, util_1.nowIso)();
        const page = {
            id: (0, util_1.generateId)(),
            slug,
            title,
            body_html: bodyHtml,
            seo,
            published,
            sort,
            created_at: now,
            updated_at: now,
        };
        await this.ctx.query.from(exports.CMS_TABLES.PAGES).insert({ ...page }).execute();
        return page;
    }
    async getPage(id) {
        (0, util_1.requireNonEmptyString)('CmsClient.getPage', 'id', id);
        return this.ctx.query.from(exports.CMS_TABLES.PAGES).where('id', id).first();
    }
    async getPageBySlug(slug) {
        (0, util_1.requireNonEmptyString)('CmsClient.getPageBySlug', 'slug', slug);
        return this.ctx.query.from(exports.CMS_TABLES.PAGES).where('slug', slug).first();
    }
    async listPages(options = {}) {
        return this.list('CmsClient.listPages', exports.CMS_TABLES.PAGES, PAGE_ORDER_COLUMNS, options);
    }
    async updatePage(id, patch) {
        const context = 'CmsClient.updatePage';
        (0, util_1.requireNonEmptyString)(context, 'id', id);
        const data = this.buildContentPatch(context, patch, 'seo');
        await this.ctx.query.from(exports.CMS_TABLES.PAGES).update(data).where('id', id).execute();
    }
    async deletePage(id) {
        (0, util_1.requireNonEmptyString)('CmsClient.deletePage', 'id', id);
        await this.ctx.query.from(exports.CMS_TABLES.PAGES).delete().where('id', id).execute();
    }
    // ───────── collections ─────────
    /** Get-or-create a collection by key. Idempotent. */
    async ensureCollection(key, name) {
        const context = 'CmsClient.ensureCollection';
        (0, util_1.requireNonEmptyString)(context, 'key', key);
        const existing = await this.getCollection(key);
        if (existing)
            return existing;
        const collection = {
            id: (0, util_1.generateId)(),
            key,
            name: (0, util_1.optionalString)(context, 'name', name, key),
        };
        await this.ctx.query.from(exports.CMS_TABLES.COLLECTIONS).insert({ ...collection }).execute();
        return collection;
    }
    async getCollection(key) {
        (0, util_1.requireNonEmptyString)('CmsClient.getCollection', 'key', key);
        return this.ctx.query
            .from(exports.CMS_TABLES.COLLECTIONS)
            .where('key', key)
            .first();
    }
    // ───────── items ─────────
    async createItem(collectionKey, input) {
        const context = 'CmsClient.createItem';
        // Validate before any lookups (same reasoning as createPage).
        const title = (0, util_1.requireNonEmptyString)(context, 'title', input.title);
        const data = (0, util_1.optionalPlainObject)(context, 'data', input.data, {});
        const published = (0, util_1.optionalBoolean)(context, 'published', input.published, false);
        const sort = (0, util_1.optionalNumber)(context, 'sort', input.sort, 0);
        const collection = await this.requireCollection(context, collectionKey);
        const slug = input.slug !== undefined
            ? (0, util_1.requireNonEmptyString)(context, 'slug', input.slug)
            : await this.uniqueSlug(exports.CMS_TABLES.ITEMS, (0, util_1.slugify)(title), {
                column: 'collection_id',
                value: collection.id,
            });
        const now = (0, util_1.nowIso)();
        const item = {
            id: (0, util_1.generateId)(),
            collection_id: collection.id,
            slug,
            title,
            data,
            published,
            sort,
            created_at: now,
            updated_at: now,
        };
        await this.ctx.query.from(exports.CMS_TABLES.ITEMS).insert({ ...item }).execute();
        return item;
    }
    async getItemBySlug(collectionKey, slug) {
        const context = 'CmsClient.getItemBySlug';
        (0, util_1.requireNonEmptyString)(context, 'slug', slug);
        const collection = await this.requireCollection(context, collectionKey);
        return this.ctx.query
            .from(exports.CMS_TABLES.ITEMS)
            .where('collection_id', collection.id)
            .where('slug', slug)
            .first();
    }
    async listItems(collectionKey, options = {}) {
        const context = 'CmsClient.listItems';
        const collection = await this.requireCollection(context, collectionKey);
        return this.list(context, exports.CMS_TABLES.ITEMS, ITEM_ORDER_COLUMNS, options, {
            column: 'collection_id',
            value: collection.id,
        });
    }
    async updateItem(id, patch) {
        const context = 'CmsClient.updateItem';
        (0, util_1.requireNonEmptyString)(context, 'id', id);
        const data = this.buildContentPatch(context, patch, 'data');
        await this.ctx.query.from(exports.CMS_TABLES.ITEMS).update(data).where('id', id).execute();
    }
    async deleteItem(id) {
        (0, util_1.requireNonEmptyString)('CmsClient.deleteItem', 'id', id);
        await this.ctx.query.from(exports.CMS_TABLES.ITEMS).delete().where('id', id).execute();
    }
    // ───────── internals ─────────
    async requireCollection(context, key) {
        (0, util_1.requireNonEmptyString)(context, 'collectionKey', key);
        const collection = await this.getCollection(key);
        if (!collection) {
            (0, util_1.fail)(context, `unknown collection "${key}" — call ensureCollection("${key}") first`);
        }
        return collection;
    }
    async list(context, table, orderColumns, options, scope) {
        const orderBy = options.orderBy ?? 'sort';
        if (!orderColumns.includes(orderBy)) {
            (0, util_1.fail)(context, `"orderBy" must be one of ${orderColumns.join(', ')} — got "${orderBy}"`);
        }
        let qb = this.ctx.query.from(table);
        if (scope)
            qb = qb.where(scope.column, scope.value);
        if (options.published !== undefined) {
            qb = qb.where('published', (0, util_1.optionalBoolean)(context, 'published', options.published, false));
        }
        qb = qb.orderBy(orderBy, options.direction ?? 'ASC');
        if (options.limit !== undefined)
            qb = qb.limit((0, util_1.optionalNumber)(context, 'limit', options.limit, 0));
        if (options.offset !== undefined)
            qb = qb.offset((0, util_1.optionalNumber)(context, 'offset', options.offset, 0));
        return qb.rows();
    }
    /**
     * Kebab slug, deduped against existing rows: `about`, `about-2`,
     * `about-3`, … One LIKE query fetches the candidate set; the suffix is
     * computed locally.
     */
    async uniqueSlug(table, base, scope) {
        let qb = this.ctx.query.from(table).select('slug').whereLike('slug', `${base}%`);
        if (scope)
            qb = qb.where(scope.column, scope.value);
        const rows = await qb.rows();
        const taken = new Set(rows.map((row) => row.slug));
        if (!taken.has(base))
            return base;
        let n = 2;
        while (taken.has(`${base}-${n}`))
            n += 1;
        return `${base}-${n}`;
    }
    /** Validated UPDATE payload for pages/items; always bumps updated_at. */
    buildContentPatch(context, patch, jsonField) {
        if (!(0, util_1.isPlainObject)(patch))
            (0, util_1.fail)(context, 'patch must be a plain object');
        const data = {};
        if (patch.title !== undefined)
            data.title = (0, util_1.requireNonEmptyString)(context, 'title', patch.title);
        if (patch.slug !== undefined)
            data.slug = (0, util_1.requireNonEmptyString)(context, 'slug', patch.slug);
        const bodyHtml = patch.body_html;
        if (jsonField === 'seo' && bodyHtml !== undefined) {
            data.body_html = (0, util_1.optionalString)(context, 'body_html', bodyHtml, '');
        }
        const json = patch[jsonField];
        if (json !== undefined)
            data[jsonField] = (0, util_1.optionalPlainObject)(context, jsonField, json, {});
        if (patch.published !== undefined) {
            data.published = (0, util_1.optionalBoolean)(context, 'published', patch.published, false);
        }
        if (patch.sort !== undefined)
            data.sort = (0, util_1.optionalNumber)(context, 'sort', patch.sort, 0);
        if (Object.keys(data).length === 0)
            (0, util_1.fail)(context, 'patch must set at least one field');
        data.updated_at = (0, util_1.nowIso)();
        return data;
    }
}
exports.CmsClient = CmsClient;
/** The cms module definition — wire it up via `client.modules.enable('cms')`. */
exports.cmsModule = (0, core_1.defineModule)({
    name: 'cms',
    migrations: exports.CMS_MIGRATIONS,
    factory: (ctx) => new CmsClient(ctx),
});
//# sourceMappingURL=cms-client.js.map