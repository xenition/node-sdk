/**
 * media module types — galleries/albums with ordered media items for
 * photo, portfolio, and product-showcase sites. Row shapes mirror the
 * `media__*` tables 1:1 (snake_case column names are the wire contract
 * with `/app-platform/query`).
 *
 * The actual files live in platform storage; this module only stores
 * records that reference their storage URLs. `created_at` owns a
 * `DEFAULT now()` on both tables, so it is omitted from inserts (mirrors
 * the events module).
 */
export type MediaKind = 'image' | 'video';
export interface MediaAlbum {
    id: string;
    slug: string;
    title: string;
    description: string;
    /** Storage URL of the cover image; null when unset. */
    cover_url: string | null;
    /** Free-form jsonb payload: theme, credits, layout hints, … */
    data: Record<string, unknown>;
    published: boolean;
    sort: number;
    created_at: string;
}
export interface CreateAlbumInput {
    title: string;
    /** Omit to auto-generate from the title (kebab-case, `-2` deduping). */
    slug?: string;
    description?: string;
    /** Storage URL of the cover image. */
    cover_url?: string;
    data?: Record<string, unknown>;
    published?: boolean;
    sort?: number;
}
export interface UpdateAlbumInput {
    title?: string;
    slug?: string;
    description?: string;
    cover_url?: string;
    data?: Record<string, unknown>;
    published?: boolean;
    sort?: number;
}
export interface MediaItem {
    id: string;
    album_id: string;
    /** Storage URL of the underlying file — required. */
    url: string;
    kind: MediaKind;
    caption: string;
    alt: string;
    /** Pixel dimensions; null when unknown. */
    width: number | null;
    height: number | null;
    sort: number;
    data: Record<string, unknown>;
    created_at: string;
}
export interface AddItemInput {
    /** Storage URL of the underlying file — required. */
    url: string;
    /** 'image' (default) | 'video'. */
    kind?: MediaKind;
    caption?: string;
    alt?: string;
    width?: number;
    height?: number;
    sort?: number;
    data?: Record<string, unknown>;
}
export interface UpdateItemInput {
    url?: string;
    kind?: MediaKind;
    caption?: string;
    alt?: string;
    width?: number;
    height?: number;
    sort?: number;
    data?: Record<string, unknown>;
}
/** An album together with its ordered items (see `getAlbumWithItems`). */
export type MediaAlbumWithItems = MediaAlbum & {
    items: MediaItem[];
};
export interface ListAlbumsOptions {
    /** Filter on the published flag; omit for all rows. */
    published?: boolean;
    /** Column to order by (whitelisted); defaults to `sort`. */
    orderBy?: string;
    direction?: 'ASC' | 'DESC';
    limit?: number;
    offset?: number;
}
export interface ListItemsOptions {
    /** Column to order by (whitelisted); defaults to `sort`. */
    orderBy?: string;
    direction?: 'ASC' | 'DESC';
    limit?: number;
    offset?: number;
}
//# sourceMappingURL=types.d.ts.map