import { Migration } from '../../migrations/types';
import { defineModule, ModuleContext } from '../core';
import {
  fail,
  generateId,
  isPlainObject,
  nowIso,
  optionalBoolean,
  optionalNumber,
  optionalPlainObject,
  optionalString,
  requireNonEmptyString,
  slugify,
} from '../util';
import {
  CmsCollection,
  CmsItem,
  CmsListOptions,
  CmsPage,
  CreateItemInput,
  CreatePageInput,
  UpdateItemInput,
  UpdatePageInput,
} from './types';

export const CMS_TABLES = {
  PAGES: 'cms__pages',
  COLLECTIONS: 'cms__collections',
  ITEMS: 'cms__items',
} as const;

export const CMS_MIGRATIONS: Migration[] = [
  {
    id: 'cms/0001_create_cms__pages',
    sql: `CREATE TABLE IF NOT EXISTS ${CMS_TABLES.PAGES} (
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
    sql: `CREATE TABLE IF NOT EXISTS ${CMS_TABLES.COLLECTIONS} (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    id: 'cms/0003_create_cms__items',
    sql: `CREATE TABLE IF NOT EXISTS ${CMS_TABLES.ITEMS} (
  id uuid PRIMARY KEY,
  collection_id uuid NOT NULL REFERENCES ${CMS_TABLES.COLLECTIONS}(id) ON DELETE CASCADE,
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
    sql: `CREATE INDEX IF NOT EXISTS cms__items_collection_idx ON ${CMS_TABLES.ITEMS} (collection_id, published, sort)`,
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
export class CmsClient {
  constructor(private readonly ctx: ModuleContext) {}

  // ───────── pages ─────────

  async createPage(input: CreatePageInput): Promise<CmsPage> {
    const context = 'CmsClient.createPage';
    // Validate everything before the slug lookup so bad input never
    // costs a network round-trip.
    const title = requireNonEmptyString(context, 'title', input.title);
    const bodyHtml = optionalString(context, 'body_html', input.body_html, '');
    const seo = optionalPlainObject(context, 'seo', input.seo, {});
    const published = optionalBoolean(context, 'published', input.published, false);
    const sort = optionalNumber(context, 'sort', input.sort, 0);
    const slug =
      input.slug !== undefined
        ? requireNonEmptyString(context, 'slug', input.slug)
        : await this.uniqueSlug(CMS_TABLES.PAGES, slugify(title));
    const now = nowIso();
    const page: CmsPage = {
      id: generateId(),
      slug,
      title,
      body_html: bodyHtml,
      seo,
      published,
      sort,
      created_at: now,
      updated_at: now,
    };
    await this.ctx.query.from(CMS_TABLES.PAGES).insert({ ...page }).execute();
    return page;
  }

  async getPage(id: string): Promise<CmsPage | null> {
    requireNonEmptyString('CmsClient.getPage', 'id', id);
    return this.ctx.query.from(CMS_TABLES.PAGES).where('id', id).first<CmsPage>();
  }

  async getPageBySlug(slug: string): Promise<CmsPage | null> {
    requireNonEmptyString('CmsClient.getPageBySlug', 'slug', slug);
    return this.ctx.query.from(CMS_TABLES.PAGES).where('slug', slug).first<CmsPage>();
  }

  async listPages(options: CmsListOptions = {}): Promise<CmsPage[]> {
    return this.list<CmsPage>('CmsClient.listPages', CMS_TABLES.PAGES, PAGE_ORDER_COLUMNS, options);
  }

  async updatePage(id: string, patch: UpdatePageInput): Promise<void> {
    const context = 'CmsClient.updatePage';
    requireNonEmptyString(context, 'id', id);
    const data = this.buildContentPatch(context, patch, 'seo');
    await this.ctx.query.from(CMS_TABLES.PAGES).update(data).where('id', id).execute();
  }

  async deletePage(id: string): Promise<void> {
    requireNonEmptyString('CmsClient.deletePage', 'id', id);
    await this.ctx.query.from(CMS_TABLES.PAGES).delete().where('id', id).execute();
  }

  // ───────── collections ─────────

  /** Get-or-create a collection by key. Idempotent. */
  async ensureCollection(key: string, name?: string): Promise<CmsCollection> {
    const context = 'CmsClient.ensureCollection';
    requireNonEmptyString(context, 'key', key);
    const existing = await this.getCollection(key);
    if (existing) return existing;
    const collection: CmsCollection = {
      id: generateId(),
      key,
      name: optionalString(context, 'name', name, key),
    };
    await this.ctx.query.from(CMS_TABLES.COLLECTIONS).insert({ ...collection }).execute();
    return collection;
  }

  async getCollection(key: string): Promise<CmsCollection | null> {
    requireNonEmptyString('CmsClient.getCollection', 'key', key);
    return this.ctx.query
      .from(CMS_TABLES.COLLECTIONS)
      .where('key', key)
      .first<CmsCollection>();
  }

  // ───────── items ─────────

  async createItem(collectionKey: string, input: CreateItemInput): Promise<CmsItem> {
    const context = 'CmsClient.createItem';
    // Validate before any lookups (same reasoning as createPage).
    const title = requireNonEmptyString(context, 'title', input.title);
    const data = optionalPlainObject(context, 'data', input.data, {});
    const published = optionalBoolean(context, 'published', input.published, false);
    const sort = optionalNumber(context, 'sort', input.sort, 0);
    const collection = await this.requireCollection(context, collectionKey);
    const slug =
      input.slug !== undefined
        ? requireNonEmptyString(context, 'slug', input.slug)
        : await this.uniqueSlug(CMS_TABLES.ITEMS, slugify(title), {
            column: 'collection_id',
            value: collection.id,
          });
    const now = nowIso();
    const item: CmsItem = {
      id: generateId(),
      collection_id: collection.id,
      slug,
      title,
      data,
      published,
      sort,
      created_at: now,
      updated_at: now,
    };
    await this.ctx.query.from(CMS_TABLES.ITEMS).insert({ ...item }).execute();
    return item;
  }

  async getItemBySlug(collectionKey: string, slug: string): Promise<CmsItem | null> {
    const context = 'CmsClient.getItemBySlug';
    requireNonEmptyString(context, 'slug', slug);
    const collection = await this.requireCollection(context, collectionKey);
    return this.ctx.query
      .from(CMS_TABLES.ITEMS)
      .where('collection_id', collection.id)
      .where('slug', slug)
      .first<CmsItem>();
  }

  async listItems(collectionKey: string, options: CmsListOptions = {}): Promise<CmsItem[]> {
    const context = 'CmsClient.listItems';
    const collection = await this.requireCollection(context, collectionKey);
    return this.list<CmsItem>(context, CMS_TABLES.ITEMS, ITEM_ORDER_COLUMNS, options, {
      column: 'collection_id',
      value: collection.id,
    });
  }

  async updateItem(id: string, patch: UpdateItemInput): Promise<void> {
    const context = 'CmsClient.updateItem';
    requireNonEmptyString(context, 'id', id);
    const data = this.buildContentPatch(context, patch, 'data');
    await this.ctx.query.from(CMS_TABLES.ITEMS).update(data).where('id', id).execute();
  }

  async deleteItem(id: string): Promise<void> {
    requireNonEmptyString('CmsClient.deleteItem', 'id', id);
    await this.ctx.query.from(CMS_TABLES.ITEMS).delete().where('id', id).execute();
  }

  // ───────── internals ─────────

  private async requireCollection(context: string, key: string): Promise<CmsCollection> {
    requireNonEmptyString(context, 'collectionKey', key);
    const collection = await this.getCollection(key);
    if (!collection) {
      fail(context, `unknown collection "${key}" — call ensureCollection("${key}") first`);
    }
    return collection;
  }

  private async list<T>(
    context: string,
    table: string,
    orderColumns: string[],
    options: CmsListOptions,
    scope?: { column: string; value: unknown },
  ): Promise<T[]> {
    const orderBy = options.orderBy ?? 'sort';
    if (!orderColumns.includes(orderBy)) {
      fail(context, `"orderBy" must be one of ${orderColumns.join(', ')} — got "${orderBy}"`);
    }
    let qb = this.ctx.query.from(table);
    if (scope) qb = qb.where(scope.column, scope.value);
    if (options.published !== undefined) {
      qb = qb.where('published', optionalBoolean(context, 'published', options.published, false));
    }
    qb = qb.orderBy(orderBy, options.direction ?? 'ASC');
    if (options.limit !== undefined) qb = qb.limit(optionalNumber(context, 'limit', options.limit, 0));
    if (options.offset !== undefined) qb = qb.offset(optionalNumber(context, 'offset', options.offset, 0));
    return qb.rows<T>();
  }

  /**
   * Kebab slug, deduped against existing rows: `about`, `about-2`,
   * `about-3`, … One LIKE query fetches the candidate set; the suffix is
   * computed locally.
   */
  private async uniqueSlug(
    table: string,
    base: string,
    scope?: { column: string; value: unknown },
  ): Promise<string> {
    let qb = this.ctx.query.from(table).select('slug').whereLike('slug', `${base}%`);
    if (scope) qb = qb.where(scope.column, scope.value);
    const rows = await qb.rows<{ slug: string }>();
    const taken = new Set(rows.map((row) => row.slug));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }

  /** Validated UPDATE payload for pages/items; always bumps updated_at. */
  private buildContentPatch(
    context: string,
    patch: UpdatePageInput | UpdateItemInput,
    jsonField: 'seo' | 'data',
  ): Record<string, unknown> {
    if (!isPlainObject(patch)) fail(context, 'patch must be a plain object');
    const data: Record<string, unknown> = {};
    if (patch.title !== undefined) data.title = requireNonEmptyString(context, 'title', patch.title);
    if (patch.slug !== undefined) data.slug = requireNonEmptyString(context, 'slug', patch.slug);
    const bodyHtml = (patch as UpdatePageInput).body_html;
    if (jsonField === 'seo' && bodyHtml !== undefined) {
      data.body_html = optionalString(context, 'body_html', bodyHtml, '');
    }
    const json = (patch as Record<string, unknown>)[jsonField];
    if (json !== undefined) data[jsonField] = optionalPlainObject(context, jsonField, json, {});
    if (patch.published !== undefined) {
      data.published = optionalBoolean(context, 'published', patch.published, false);
    }
    if (patch.sort !== undefined) data.sort = optionalNumber(context, 'sort', patch.sort, 0);
    if (Object.keys(data).length === 0) fail(context, 'patch must set at least one field');
    data.updated_at = nowIso();
    return data;
  }
}

/** The cms module definition — wire it up via `client.modules.enable('cms')`. */
export const cmsModule = defineModule({
  name: 'cms',
  migrations: CMS_MIGRATIONS,
  factory: (ctx: ModuleContext) => new CmsClient(ctx),
});
