import { Migration } from '../../migrations/types';
import { ModuleContext } from '../core';
import { CmsCollection, CmsItem, CmsListOptions, CmsPage, CreateItemInput, CreatePageInput, UpdateItemInput, UpdatePageInput } from './types';
export declare const CMS_TABLES: {
    readonly PAGES: "cms__pages";
    readonly COLLECTIONS: "cms__collections";
    readonly ITEMS: "cms__items";
};
export declare const CMS_MIGRATIONS: Migration[];
/**
 * cms module client — pages, collections, and generic typed items
 * (menu entries, projects, speakers, …) over `cms__*` tables.
 *
 * Writes are validated client-side (v0 trust model — see modules/core.ts);
 * slugs are auto-generated from titles when absent and deduped with a
 * `-2`, `-3`, … suffix. Deletes are hard deletes: published/unpublished
 * already covers the "hide it" case, so v0 keeps no tombstones.
 */
export declare class CmsClient {
    private readonly ctx;
    constructor(ctx: ModuleContext);
    createPage(input: CreatePageInput): Promise<CmsPage>;
    getPage(id: string): Promise<CmsPage | null>;
    getPageBySlug(slug: string): Promise<CmsPage | null>;
    listPages(options?: CmsListOptions): Promise<CmsPage[]>;
    updatePage(id: string, patch: UpdatePageInput): Promise<void>;
    deletePage(id: string): Promise<void>;
    /** Get-or-create a collection by key. Idempotent. */
    ensureCollection(key: string, name?: string): Promise<CmsCollection>;
    getCollection(key: string): Promise<CmsCollection | null>;
    createItem(collectionKey: string, input: CreateItemInput): Promise<CmsItem>;
    getItemBySlug(collectionKey: string, slug: string): Promise<CmsItem | null>;
    listItems(collectionKey: string, options?: CmsListOptions): Promise<CmsItem[]>;
    updateItem(id: string, patch: UpdateItemInput): Promise<void>;
    deleteItem(id: string): Promise<void>;
    private requireCollection;
    private list;
    /**
     * Kebab slug, deduped against existing rows: `about`, `about-2`,
     * `about-3`, … One LIKE query fetches the candidate set; the suffix is
     * computed locally.
     */
    private uniqueSlug;
    /** Validated UPDATE payload for pages/items; always bumps updated_at. */
    private buildContentPatch;
}
/** The cms module definition — wire it up via `client.modules.enable('cms')`. */
export declare const cmsModule: import("../core").ModuleDefinition<CmsClient>;
//# sourceMappingURL=cms-client.d.ts.map