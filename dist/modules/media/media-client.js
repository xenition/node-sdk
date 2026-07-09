"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mediaModule = exports.MediaClient = exports.MEDIA_MIGRATIONS = exports.MEDIA_TABLES = void 0;
const core_1 = require("../core");
const util_1 = require("../util");
exports.MEDIA_TABLES = {
    ALBUMS: 'media__albums',
    ITEMS: 'media__items',
};
exports.MEDIA_MIGRATIONS = [
    {
        id: 'media/0001_create_media__albums',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.MEDIA_TABLES.ALBUMS} (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  cover_url text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  published boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
    },
    {
        id: 'media/0002_create_media__items',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.MEDIA_TABLES.ITEMS} (
  id uuid PRIMARY KEY,
  album_id uuid NOT NULL,
  url text NOT NULL,
  kind text NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'video')),
  caption text NOT NULL DEFAULT '',
  alt text NOT NULL DEFAULT '',
  width integer,
  height integer,
  sort integer NOT NULL DEFAULT 0,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
    },
    {
        id: 'media/0003_index_media__items_album_sort',
        sql: `CREATE INDEX IF NOT EXISTS media__items_album_sort_idx ON ${exports.MEDIA_TABLES.ITEMS} (album_id, sort)`,
    },
];
const ALBUM_ORDER_COLUMNS = ['sort', 'title', 'slug', 'created_at'];
const ITEM_ORDER_COLUMNS = ['sort', 'kind', 'created_at'];
const MEDIA_KINDS = ['image', 'video'];
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
class MediaClient {
    constructor(ctx) {
        this.ctx = ctx;
    }
    // ───────── albums ─────────
    /** Create an album; slug auto-generated (and deduped) from the title. */
    async createAlbum(input) {
        const context = 'MediaClient.createAlbum';
        // Validate everything before the slug lookup so bad input never costs a
        // network round-trip.
        const title = (0, util_1.requireNonEmptyString)(context, 'title', input.title);
        const description = (0, util_1.optionalString)(context, 'description', input.description, '');
        const coverUrl = input.cover_url === undefined
            ? null
            : (0, util_1.requireNonEmptyString)(context, 'cover_url', input.cover_url);
        const data = (0, util_1.optionalPlainObject)(context, 'data', input.data, {});
        const published = (0, util_1.optionalBoolean)(context, 'published', input.published, true);
        const sort = (0, util_1.optionalNumber)(context, 'sort', input.sort, 0);
        const slug = input.slug !== undefined
            ? (0, util_1.requireNonEmptyString)(context, 'slug', input.slug)
            : await this.uniqueSlug((0, util_1.slugify)(title));
        const album = {
            id: (0, util_1.generateId)(),
            slug,
            title,
            description,
            cover_url: coverUrl,
            data,
            published,
            sort,
            created_at: (0, util_1.nowIso)(),
        };
        // created_at is OWNED by the column default (now()) — omit it from the
        // wire insert. cover_url is omitted when null so the column takes NULL.
        const { created_at: _omitted, cover_url, ...rest } = album;
        const row = { ...rest };
        if (cover_url !== null)
            row.cover_url = cover_url;
        await this.ctx.query.from(exports.MEDIA_TABLES.ALBUMS).insert(row).execute();
        return album;
    }
    async getAlbum(slug) {
        (0, util_1.requireNonEmptyString)('MediaClient.getAlbum', 'slug', slug);
        return this.ctx.query.from(exports.MEDIA_TABLES.ALBUMS).where('slug', slug).first();
    }
    async listAlbums(options = {}) {
        const context = 'MediaClient.listAlbums';
        const orderBy = options.orderBy ?? 'sort';
        if (!ALBUM_ORDER_COLUMNS.includes(orderBy)) {
            (0, util_1.fail)(context, `"orderBy" must be one of ${ALBUM_ORDER_COLUMNS.join(', ')} — got "${orderBy}"`);
        }
        let qb = this.ctx.query.from(exports.MEDIA_TABLES.ALBUMS);
        if (options.published !== undefined) {
            qb = qb.where('published', (0, util_1.optionalBoolean)(context, 'published', options.published, true));
        }
        qb = qb.orderBy(orderBy, options.direction ?? 'ASC');
        if (options.limit !== undefined)
            qb = qb.limit((0, util_1.optionalNumber)(context, 'limit', options.limit, 0));
        if (options.offset !== undefined)
            qb = qb.offset((0, util_1.optionalNumber)(context, 'offset', options.offset, 0));
        return qb.rows();
    }
    async updateAlbum(id, patch) {
        const context = 'MediaClient.updateAlbum';
        (0, util_1.requireNonEmptyString)(context, 'id', id);
        if (!(0, util_1.isPlainObject)(patch))
            (0, util_1.fail)(context, 'patch must be a plain object');
        const data = {};
        if (patch.title !== undefined)
            data.title = (0, util_1.requireNonEmptyString)(context, 'title', patch.title);
        if (patch.slug !== undefined)
            data.slug = (0, util_1.requireNonEmptyString)(context, 'slug', patch.slug);
        if (patch.description !== undefined) {
            data.description = (0, util_1.optionalString)(context, 'description', patch.description, '');
        }
        if (patch.cover_url !== undefined) {
            data.cover_url = (0, util_1.requireNonEmptyString)(context, 'cover_url', patch.cover_url);
        }
        if (patch.data !== undefined)
            data.data = (0, util_1.optionalPlainObject)(context, 'data', patch.data, {});
        if (patch.published !== undefined) {
            data.published = (0, util_1.optionalBoolean)(context, 'published', patch.published, true);
        }
        if (patch.sort !== undefined)
            data.sort = (0, util_1.optionalNumber)(context, 'sort', patch.sort, 0);
        if (Object.keys(data).length === 0)
            (0, util_1.fail)(context, 'patch must set at least one field');
        await this.ctx.query.from(exports.MEDIA_TABLES.ALBUMS).update(data).where('id', id).execute();
    }
    async deleteAlbum(id) {
        (0, util_1.requireNonEmptyString)('MediaClient.deleteAlbum', 'id', id);
        await this.ctx.query.from(exports.MEDIA_TABLES.ALBUMS).delete().where('id', id).execute();
    }
    /**
     * Fetch an album by slug together with its ordered items — the common
     * render path for a gallery page. Two client-side queries (album, then
     * its items ordered by `sort`); null when the album is unknown.
     */
    async getAlbumWithItems(slug) {
        const context = 'MediaClient.getAlbumWithItems';
        (0, util_1.requireNonEmptyString)(context, 'slug', slug);
        const album = await this.getAlbum(slug);
        if (!album)
            return null;
        const items = await this.listItems(album.id);
        return { ...album, items };
    }
    // ───────── items ─────────
    /** Append a media item to an album. `url` is required; `kind` defaults to 'image'. */
    async addItem(albumId, input) {
        const context = 'MediaClient.addItem';
        (0, util_1.requireNonEmptyString)(context, 'albumId', albumId);
        const url = (0, util_1.requireNonEmptyString)(context, 'url', input.url);
        const kind = this.validateKind(context, input.kind, 'image');
        const caption = (0, util_1.optionalString)(context, 'caption', input.caption, '');
        const alt = (0, util_1.optionalString)(context, 'alt', input.alt, '');
        const width = this.validateDimension(context, 'width', input.width);
        const height = this.validateDimension(context, 'height', input.height);
        const sort = (0, util_1.optionalNumber)(context, 'sort', input.sort, 0);
        const data = (0, util_1.optionalPlainObject)(context, 'data', input.data, {});
        const item = {
            id: (0, util_1.generateId)(),
            album_id: albumId,
            url,
            kind,
            caption,
            alt,
            width,
            height,
            sort,
            data,
            created_at: (0, util_1.nowIso)(),
        };
        // created_at owned by the DB default — omit from the wire insert.
        // width/height are omitted when null so the columns take NULL.
        const { created_at: _omitted, width: w, height: h, ...rest } = item;
        const row = { ...rest };
        if (w !== null)
            row.width = w;
        if (h !== null)
            row.height = h;
        await this.ctx.query.from(exports.MEDIA_TABLES.ITEMS).insert(row).execute();
        return item;
    }
    /** Items in an album, ordered by `sort` (ASC) by default. */
    async listItems(albumId, options = {}) {
        const context = 'MediaClient.listItems';
        (0, util_1.requireNonEmptyString)(context, 'albumId', albumId);
        const orderBy = options.orderBy ?? 'sort';
        if (!ITEM_ORDER_COLUMNS.includes(orderBy)) {
            (0, util_1.fail)(context, `"orderBy" must be one of ${ITEM_ORDER_COLUMNS.join(', ')} — got "${orderBy}"`);
        }
        let qb = this.ctx.query.from(exports.MEDIA_TABLES.ITEMS).where('album_id', albumId);
        qb = qb.orderBy(orderBy, options.direction ?? 'ASC');
        if (options.limit !== undefined)
            qb = qb.limit((0, util_1.optionalNumber)(context, 'limit', options.limit, 0));
        if (options.offset !== undefined)
            qb = qb.offset((0, util_1.optionalNumber)(context, 'offset', options.offset, 0));
        return qb.rows();
    }
    async updateItem(id, patch) {
        const context = 'MediaClient.updateItem';
        (0, util_1.requireNonEmptyString)(context, 'id', id);
        if (!(0, util_1.isPlainObject)(patch))
            (0, util_1.fail)(context, 'patch must be a plain object');
        const data = {};
        if (patch.url !== undefined)
            data.url = (0, util_1.requireNonEmptyString)(context, 'url', patch.url);
        if (patch.kind !== undefined)
            data.kind = this.validateKind(context, patch.kind, 'image');
        if (patch.caption !== undefined) {
            data.caption = (0, util_1.optionalString)(context, 'caption', patch.caption, '');
        }
        if (patch.alt !== undefined)
            data.alt = (0, util_1.optionalString)(context, 'alt', patch.alt, '');
        if (patch.width !== undefined)
            data.width = this.validateDimension(context, 'width', patch.width);
        if (patch.height !== undefined)
            data.height = this.validateDimension(context, 'height', patch.height);
        if (patch.sort !== undefined)
            data.sort = (0, util_1.optionalNumber)(context, 'sort', patch.sort, 0);
        if (patch.data !== undefined)
            data.data = (0, util_1.optionalPlainObject)(context, 'data', patch.data, {});
        if (Object.keys(data).length === 0)
            (0, util_1.fail)(context, 'patch must set at least one field');
        await this.ctx.query.from(exports.MEDIA_TABLES.ITEMS).update(data).where('id', id).execute();
    }
    async removeItem(id) {
        (0, util_1.requireNonEmptyString)('MediaClient.removeItem', 'id', id);
        await this.ctx.query.from(exports.MEDIA_TABLES.ITEMS).delete().where('id', id).execute();
    }
    // ───────── internals ─────────
    /**
     * Kebab slug, deduped against existing rows: `beach`, `beach-2`,
     * `beach-3`, … One LIKE query fetches the candidate set; the suffix is
     * computed locally (mirrors the cms module).
     */
    async uniqueSlug(base) {
        const rows = await this.ctx.query
            .from(exports.MEDIA_TABLES.ALBUMS)
            .select('slug')
            .whereLike('slug', `${base}%`)
            .rows();
        const taken = new Set(rows.map((row) => row.slug));
        if (!taken.has(base))
            return base;
        let n = 2;
        while (taken.has(`${base}-${n}`))
            n += 1;
        return `${base}-${n}`;
    }
    validateKind(context, value, fallback) {
        if (value === undefined)
            return fallback;
        if (typeof value !== 'string' || !MEDIA_KINDS.includes(value)) {
            (0, util_1.fail)(context, `"kind" must be one of ${MEDIA_KINDS.join(', ')} — got "${String(value)}"`);
        }
        return value;
    }
    /** Optional pixel dimension: a non-negative integer, or null when absent. */
    validateDimension(context, field, value) {
        if (value === undefined)
            return null;
        const n = (0, util_1.optionalNumber)(context, field, value, 0);
        if (!Number.isInteger(n) || n < 0) {
            (0, util_1.fail)(context, `"${field}" must be a non-negative integer`);
        }
        return n;
    }
}
exports.MediaClient = MediaClient;
/** The media module definition — wire it up via `client.modules.enable('media')`. */
exports.mediaModule = (0, core_1.defineModule)({
    name: 'media',
    migrations: exports.MEDIA_MIGRATIONS,
    factory: (ctx) => new MediaClient(ctx),
});
//# sourceMappingURL=media-client.js.map