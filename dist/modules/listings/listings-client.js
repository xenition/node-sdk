"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listingsModule = exports.ListingsClient = exports.LISTINGS_MIGRATIONS = exports.LISTINGS_TABLE = void 0;
const core_1 = require("../core");
const util_1 = require("../util");
exports.LISTINGS_TABLE = 'listings__listings';
exports.LISTINGS_MIGRATIONS = [
    {
        id: 'listings/0001_create_listings__listings',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.LISTINGS_TABLE} (
  id uuid PRIMARY KEY,
  category text NOT NULL,
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  summary text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'published', 'expired', 'archived')),
  featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  expires_at timestamptz
)`,
    },
    {
        id: 'listings/0002_index_listings__listings_category',
        sql: `CREATE INDEX IF NOT EXISTS listings__listings_category_idx ON ${exports.LISTINGS_TABLE} (category, status, featured)`,
    },
];
/** Every valid status — moderation may flip a listing to any of these. */
const LISTING_STATUSES = [
    'draft',
    'pending',
    'published',
    'expired',
    'archived',
];
/** Statuses a caller may set at create time (end states are moderation-only). */
const CREATE_STATUSES = ['draft', 'pending', 'published'];
/** Sort columns the public list route is allowed to order by. */
const LISTING_ORDER_COLUMNS = [
    'created_at',
    'published_at',
    'expires_at',
    'title',
    'featured',
];
/**
 * listings module client — a directory / classified / real-estate /
 * job-board core over `listings__listings`.
 *
 * `create()` is the write primitive (validated client-side per the v0 trust
 * model in modules/core.ts): it auto-slugs from the title with `-2`, `-3`, …
 * dedupe (same as cms) and defaults to status `pending`, so a public submit
 * lands in moderation. `publish()` / `moderate()` are the service-key
 * back-office calls; public reads (`list`, `getBySlug`, `search`,
 * `categories`) only ever see published rows unless a service-key caller
 * opts out.
 */
class ListingsClient {
    constructor(ctx) {
        this.ctx = ctx;
    }
    /**
     * Insert a listing. Validates everything before the slug lookup so bad
     * input never costs a network round-trip; the slug is generated from the
     * title (deduped) when not supplied. Status defaults to `pending`.
     */
    async create(input) {
        const context = 'ListingsClient.create';
        const category = (0, util_1.requireNonEmptyString)(context, 'category', input.category);
        const title = (0, util_1.requireNonEmptyString)(context, 'title', input.title);
        const summary = (0, util_1.optionalString)(context, 'summary', input.summary, '');
        const body = (0, util_1.optionalString)(context, 'body', input.body, '');
        const data = (0, util_1.optionalPlainObject)(context, 'data', input.data, {});
        const featured = (0, util_1.optionalBoolean)(context, 'featured', input.featured, false);
        const status = this.validateCreateStatus(context, input.status);
        const slug = input.slug !== undefined
            ? (0, util_1.requireNonEmptyString)(context, 'slug', input.slug)
            : await this.uniqueSlug((0, util_1.slugify)(title));
        const listing = {
            id: (0, util_1.generateId)(),
            category,
            title,
            slug,
            summary,
            body,
            data,
            status,
            featured,
            created_at: (0, util_1.nowIso)(),
            published_at: null,
            expires_at: null,
        };
        // The three timestamptz columns are OWNED by the DB: created_at has a
        // now() default, and published_at/expires_at have no default (NULL until
        // publish()/moderation set them server-side). The engine runtime binds
        // parameters natively and rejects ISO *strings* for timestamptz, so the
        // wire insert omits all three — same fix as reviews-client c06a7e4. The
        // returned object carries the client clock's nowIso() as a close
        // approximation of what the DB stamped for created_at.
        const { created_at: _c, published_at: _p, expires_at: _e, ...row } = listing;
        await this.ctx.query.from(exports.LISTINGS_TABLE).insert(row).execute();
        return listing;
    }
    /**
     * Take a listing live: status → 'published' and published_at → now().
     * Service key. Uses raw SQL with the server-side now() so the timestamptz
     * is stamped by the DB (never bound as an ISO string from the client).
     */
    async publish(id) {
        const context = 'ListingsClient.publish';
        (0, util_1.requireNonEmptyString)(context, 'id', id);
        await this.ctx.raw(`UPDATE ${exports.LISTINGS_TABLE} SET status = 'published', published_at = now() WHERE id = $1`, [id]);
    }
    /** Flip a listing's moderation status (service key). */
    async moderate(id, status) {
        const context = 'ListingsClient.moderate';
        (0, util_1.requireNonEmptyString)(context, 'id', id);
        if (!LISTING_STATUSES.includes(status)) {
            (0, util_1.fail)(context, `"status" must be one of ${LISTING_STATUSES.join(', ')} — got "${String(status)}"`);
        }
        await this.ctx.query.from(exports.LISTINGS_TABLE).update({ status }).where('id', id).execute();
    }
    /**
     * Listings in a category, filtered by status (default 'published') and
     * optionally by featured, ordered by a whitelisted column (default
     * created_at DESC).
     */
    async list(category, options = {}) {
        const context = 'ListingsClient.list';
        (0, util_1.requireNonEmptyString)(context, 'category', category);
        const status = this.validateStatus(context, options.status ?? 'published');
        const orderBy = options.orderBy ?? 'created_at';
        if (!LISTING_ORDER_COLUMNS.includes(orderBy)) {
            (0, util_1.fail)(context, `"orderBy" must be one of ${LISTING_ORDER_COLUMNS.join(', ')} — got "${orderBy}"`);
        }
        let qb = this.ctx.query
            .from(exports.LISTINGS_TABLE)
            .where('category', category)
            .where('status', status);
        if (options.featured !== undefined) {
            qb = qb.where('featured', (0, util_1.optionalBoolean)(context, 'featured', options.featured, false));
        }
        qb = qb.orderBy(orderBy, options.direction ?? 'DESC');
        if (options.limit !== undefined)
            qb = qb.limit((0, util_1.optionalNumber)(context, 'limit', options.limit, 0));
        if (options.offset !== undefined)
            qb = qb.offset((0, util_1.optionalNumber)(context, 'offset', options.offset, 0));
        return qb.rows();
    }
    /**
     * A single listing by slug. Public reads (the default) see published rows
     * only; pass `{ anyStatus: true }` from a service-key/back-office context
     * to fetch a listing in any status.
     */
    async getBySlug(slug, options = {}) {
        const context = 'ListingsClient.getBySlug';
        (0, util_1.requireNonEmptyString)(context, 'slug', slug);
        let qb = this.ctx.query.from(exports.LISTINGS_TABLE).where('slug', slug);
        if (!options.anyStatus)
            qb = qb.where('status', 'published');
        return qb.first();
    }
    /**
     * Full-text-ish search over published listings — title OR summary matched
     * case-insensitively (ILIKE), optionally scoped to a category.
     */
    async search(category, term, options = {}) {
        const context = 'ListingsClient.search';
        const needle = (0, util_1.requireNonEmptyString)(context, 'term', term);
        const pattern = `%${needle}%`;
        let qb = this.ctx.query.from(exports.LISTINGS_TABLE).where('status', 'published');
        if (category !== undefined) {
            qb = qb.where('category', (0, util_1.requireNonEmptyString)(context, 'category', category));
        }
        qb = qb.whereILike('title', pattern).orIlike('summary', pattern);
        if (options.limit !== undefined)
            qb = qb.limit((0, util_1.optionalNumber)(context, 'limit', options.limit, 0));
        return qb.rows();
    }
    /**
     * Distinct categories among published listings, sorted. Uses a DISTINCT
     * select on the category column and dedupes/sorts client-side as a belt
     * against a runtime that ignores the flag (same defensive stance as
     * reviews' client-side averaging).
     */
    async categories() {
        const rows = await this.ctx.query
            .from(exports.LISTINGS_TABLE)
            .select('category')
            .distinct()
            .where('status', 'published')
            .rows();
        const set = new Set();
        for (const row of rows) {
            if (typeof row?.category === 'string' && row.category !== '')
                set.add(row.category);
        }
        return [...set].sort();
    }
    // ───────── internals ─────────
    validateStatus(context, status) {
        if (!LISTING_STATUSES.includes(status)) {
            (0, util_1.fail)(context, `"status" must be one of ${LISTING_STATUSES.join(', ')} — got "${String(status)}"`);
        }
        return status;
    }
    validateCreateStatus(context, status) {
        if (status === undefined)
            return 'pending';
        if (!CREATE_STATUSES.includes(status)) {
            (0, util_1.fail)(context, `"status" must be one of ${CREATE_STATUSES.join(', ')} at create time — got "${String(status)}"`);
        }
        return status;
    }
    /**
     * Kebab slug, deduped against existing rows: `honda-civic`,
     * `honda-civic-2`, … One LIKE query fetches the candidate set; the suffix
     * is computed locally (same approach as cms).
     */
    async uniqueSlug(base) {
        const rows = await this.ctx.query
            .from(exports.LISTINGS_TABLE)
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
}
exports.ListingsClient = ListingsClient;
/** The listings module definition — wire it up via `client.modules.enable('listings')`. */
exports.listingsModule = (0, core_1.defineModule)({
    name: 'listings',
    migrations: exports.LISTINGS_MIGRATIONS,
    factory: (ctx) => new ListingsClient(ctx),
});
//# sourceMappingURL=listings-client.js.map