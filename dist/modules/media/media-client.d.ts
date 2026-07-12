import { Migration } from '../../migrations/types';
import { ModuleContext } from '../core';
import { AddItemInput, CreateAlbumInput, ListAlbumsOptions, ListItemsOptions, MediaAlbum, MediaAlbumWithItems, MediaItem, UpdateAlbumInput, UpdateItemInput } from './types';
export declare const MEDIA_TABLES: {
    readonly ALBUMS: "media__albums";
    readonly ITEMS: "media__items";
};
export declare const MEDIA_MIGRATIONS: Migration[];
/**
 * media module client — galleries/albums with ordered media items over the
 * `media__albums` / `media__items` tables. The files themselves live in
 * platform storage; this module stores records that reference their
 * storage URLs.
 *
 * Writes are validated client-side (v0 trust model — see modules/core.ts);
 * album slugs are auto-generated from the title when absent and deduped
 * with a `-2`, `-3`, … suffix (mirrors the cms module). `created_at` owns a
 * `DEFAULT now()` on both tables and is omitted from inserts (like events).
 * Nullable columns (`cover_url`, `width`, `height`) are omitted when unset
 * so the column takes its NULL. Deletes are hard deletes.
 */
export declare class MediaClient {
    private readonly ctx;
    constructor(ctx: ModuleContext);
    /** Create an album; slug auto-generated (and deduped) from the title. */
    createAlbum(input: CreateAlbumInput): Promise<MediaAlbum>;
    getAlbum(slug: string): Promise<MediaAlbum | null>;
    listAlbums(options?: ListAlbumsOptions): Promise<MediaAlbum[]>;
    updateAlbum(id: string, patch: UpdateAlbumInput): Promise<void>;
    deleteAlbum(id: string): Promise<void>;
    /**
     * Fetch an album by slug together with its ordered items — the common
     * render path for a gallery page. Two client-side queries (album, then
     * its items ordered by `sort`); null when the album is unknown.
     */
    getAlbumWithItems(slug: string): Promise<MediaAlbumWithItems | null>;
    /** Append a media item to an album. `url` is required; `kind` defaults to 'image'. */
    addItem(albumId: string, input: AddItemInput): Promise<MediaItem>;
    /** Items in an album, ordered by `sort` (ASC) by default. */
    listItems(albumId: string, options?: ListItemsOptions): Promise<MediaItem[]>;
    updateItem(id: string, patch: UpdateItemInput): Promise<void>;
    removeItem(id: string): Promise<void>;
    /**
     * Kebab slug, deduped against existing rows: `beach`, `beach-2`,
     * `beach-3`, … One LIKE query fetches the candidate set; the suffix is
     * computed locally (mirrors the cms module).
     */
    private uniqueSlug;
    private validateKind;
    /** Optional pixel dimension: a non-negative integer, or null when absent. */
    private validateDimension;
}
/** The media module definition — wire it up via `client.modules.enable('media')`. */
export declare const mediaModule: import("../core").ModuleDefinition<MediaClient>;
//# sourceMappingURL=media-client.d.ts.map