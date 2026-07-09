"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.catalogModule = exports.CatalogClient = exports.CATALOG_MIGRATIONS = exports.CATALOG_TABLES = void 0;
const core_1 = require("../core");
const util_1 = require("../util");
exports.CATALOG_TABLES = {
    COLLECTIONS: 'catalog__collections',
    PRODUCTS: 'catalog__products',
    VARIANTS: 'catalog__variants',
};
exports.CATALOG_MIGRATIONS = [
    {
        id: 'catalog/0001_create_catalog__collections',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.CATALOG_TABLES.COLLECTIONS} (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
    },
    {
        id: 'catalog/0002_create_catalog__products',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.CATALOG_TABLES.PRODUCTS} (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  collection_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  image_url text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
    },
    {
        id: 'catalog/0003_index_catalog__products_collection',
        sql: `CREATE INDEX IF NOT EXISTS catalog__products_collection_idx ON ${exports.CATALOG_TABLES.PRODUCTS} (collection_id, status, sort)`,
    },
    {
        id: 'catalog/0004_create_catalog__variants',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.CATALOG_TABLES.VARIANTS} (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL,
  sku text,
  title text NOT NULL DEFAULT 'Default',
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  compare_at_cents integer,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  image_url text,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
    },
    {
        id: 'catalog/0005_index_catalog__variants_product',
        sql: `CREATE INDEX IF NOT EXISTS catalog__variants_product_idx ON ${exports.CATALOG_TABLES.VARIANTS} (product_id, sort)`,
    },
];
const PRODUCT_STATUSES = ['draft', 'published'];
const PRODUCT_ORDER_COLUMNS = ['sort', 'title', 'slug', 'created_at'];
const VARIANT_ORDER_COLUMNS = ['sort', 'title', 'price_cents', 'created_at'];
/**
 * catalog module client — products, variants, and collections over the
 * `catalog__*` tables.
 *
 * Money is ALWAYS integer minor units (cents): `priceCents` /
 * `compareAtCents` are validated to be non-negative integers, never floats.
 * A product is the browseable entry; its `variants` are the purchasable
 * SKUs, each independently priced. Slugs are auto-generated from titles when
 * absent and deduped with a `-2`, `-3`, … suffix.
 *
 * Writes are validated client-side (v0 trust model — see modules/core.ts).
 * Inserts omit `created_at` (a `DEFAULT now()` column) and any unset nullable
 * column, so those take their SQL defaults / NULL.
 */
class CatalogClient {
    constructor(ctx) {
        this.ctx = ctx;
    }
    // ───────── collections ─────────
    /** Create a collection; slug auto-generated (deduped) from the title. */
    async createCollection(input) {
        const context = 'CatalogClient.createCollection';
        const title = (0, util_1.requireNonEmptyString)(context, 'title', input.title);
        const description = (0, util_1.optionalString)(context, 'description', input.description, '');
        const sort = (0, util_1.optionalNumber)(context, 'sort', input.sort, 0);
        const slug = input.slug !== undefined
            ? (0, util_1.requireNonEmptyString)(context, 'slug', input.slug)
            : await this.uniqueSlug(exports.CATALOG_TABLES.COLLECTIONS, (0, util_1.slugify)(title));
        const collection = {
            id: (0, util_1.generateId)(),
            slug,
            title,
            description,
            sort,
            created_at: (0, util_1.nowIso)(),
        };
        // created_at is OWNED by the column default (now()) — omit it from the
        // wire insert (same as events/reviews/booking).
        const { created_at: _omitted, ...row } = collection;
        await this.ctx.query.from(exports.CATALOG_TABLES.COLLECTIONS).insert(row).execute();
        return collection;
    }
    /** Fetch one collection by slug. Null if unknown. */
    async getCollection(slug) {
        const context = 'CatalogClient.getCollection';
        (0, util_1.requireNonEmptyString)(context, 'slug', slug);
        return this.ctx.query
            .from(exports.CATALOG_TABLES.COLLECTIONS)
            .where('slug', slug)
            .first();
    }
    /** All collections, ordered by sort then title. */
    async listCollections() {
        return this.ctx.query
            .from(exports.CATALOG_TABLES.COLLECTIONS)
            .orderBy('sort', 'ASC')
            .orderBy('title', 'ASC')
            .rows();
    }
    // ───────── products ─────────
    /**
     * Create a product; slug auto-generated (deduped) from the title. An
     * optional `variants[]` creates the product and its SKUs together and the
     * returned product carries them. Status defaults to 'draft'.
     */
    async createProduct(input) {
        const context = 'CatalogClient.createProduct';
        const title = (0, util_1.requireNonEmptyString)(context, 'title', input.title);
        const description = (0, util_1.optionalString)(context, 'description', input.description, '');
        const collectionId = input.collectionId === undefined
            ? null
            : (0, util_1.requireNonEmptyString)(context, 'collectionId', input.collectionId);
        const status = this.validateStatus(context, input.status, 'draft');
        const imageUrl = input.imageUrl === undefined ? null : (0, util_1.requireNonEmptyString)(context, 'imageUrl', input.imageUrl);
        const data = (0, util_1.optionalPlainObject)(context, 'data', input.data, {});
        const sort = (0, util_1.optionalNumber)(context, 'sort', input.sort, 0);
        if (input.variants !== undefined && !Array.isArray(input.variants)) {
            (0, util_1.fail)(context, '"variants" must be an array of variant inputs');
        }
        const slug = input.slug !== undefined
            ? (0, util_1.requireNonEmptyString)(context, 'slug', input.slug)
            : await this.uniqueSlug(exports.CATALOG_TABLES.PRODUCTS, (0, util_1.slugify)(title));
        const productId = (0, util_1.generateId)();
        // Validate + build all variants BEFORE any write, so a bad variant never
        // leaves an orphaned product row behind (fail-fast, no partial write).
        const variants = (input.variants ?? []).map((v, i) => this.buildVariant(`${context} (variants[${i}])`, productId, v));
        const product = {
            id: productId,
            slug,
            title,
            description,
            collection_id: collectionId,
            status,
            image_url: imageUrl,
            data,
            sort,
            created_at: (0, util_1.nowIso)(),
        };
        await this.ctx.query.from(exports.CATALOG_TABLES.PRODUCTS).insert(this.productRow(product)).execute();
        if (variants.length > 0) {
            await this.ctx.query
                .from(exports.CATALOG_TABLES.VARIANTS)
                .insert(variants.map((v) => this.variantRow(v)))
                .execute();
        }
        return { ...product, variants };
    }
    /**
     * Fetch one product by slug plus its variants (ordered by sort). Public by
     * default: a non-published product resolves to null. Pass
     * `{ anyStatus: true }` (service-key admin) to read drafts too.
     */
    async getProduct(slug, options = {}) {
        const context = 'CatalogClient.getProduct';
        (0, util_1.requireNonEmptyString)(context, 'slug', slug);
        const product = await this.ctx.query
            .from(exports.CATALOG_TABLES.PRODUCTS)
            .where('slug', slug)
            .first();
        if (!product)
            return null;
        if (!options.anyStatus && product.status !== 'published')
            return null;
        const variants = await this.listVariants(product.id);
        return { ...product, variants };
    }
    /**
     * List products (without variants). Filtered to `status` (default
     * 'published'; pass 'all' to skip) and optionally to a collection by SLUG
     * — an unknown collection slug yields an empty list. Ordered by a
     * whitelisted column (default 'sort').
     */
    async listProducts(options = {}) {
        const context = 'CatalogClient.listProducts';
        const orderBy = options.orderBy ?? 'sort';
        if (!PRODUCT_ORDER_COLUMNS.includes(orderBy)) {
            (0, util_1.fail)(context, `"orderBy" must be one of ${PRODUCT_ORDER_COLUMNS.join(', ')} — got "${orderBy}"`);
        }
        const status = options.status ?? 'published';
        let collectionId;
        if (options.collection !== undefined) {
            const collection = await this.getCollection((0, util_1.requireNonEmptyString)(context, 'collection', options.collection));
            if (!collection)
                return [];
            collectionId = collection.id;
        }
        let qb = this.ctx.query.from(exports.CATALOG_TABLES.PRODUCTS);
        if (collectionId !== undefined)
            qb = qb.where('collection_id', collectionId);
        if (status !== 'all') {
            if (!PRODUCT_STATUSES.includes(status)) {
                (0, util_1.fail)(context, `"status" must be one of ${PRODUCT_STATUSES.join(', ')}, all — got "${String(status)}"`);
            }
            qb = qb.where('status', status);
        }
        qb = qb.orderBy(orderBy, options.direction ?? 'ASC');
        if (options.limit !== undefined)
            qb = qb.limit((0, util_1.optionalNumber)(context, 'limit', options.limit, 0));
        if (options.offset !== undefined)
            qb = qb.offset((0, util_1.optionalNumber)(context, 'offset', options.offset, 0));
        return qb.rows();
    }
    /** Patch a product (service key). Only the fields present are updated. */
    async updateProduct(id, patch) {
        const context = 'CatalogClient.updateProduct';
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
        if (patch.collectionId !== undefined) {
            data.collection_id =
                patch.collectionId === null
                    ? null
                    : (0, util_1.requireNonEmptyString)(context, 'collectionId', patch.collectionId);
        }
        if (patch.status !== undefined)
            data.status = this.validateStatus(context, patch.status, 'draft');
        if (patch.imageUrl !== undefined) {
            data.image_url =
                patch.imageUrl === null ? null : (0, util_1.requireNonEmptyString)(context, 'imageUrl', patch.imageUrl);
        }
        if (patch.data !== undefined)
            data.data = (0, util_1.optionalPlainObject)(context, 'data', patch.data, {});
        if (patch.sort !== undefined)
            data.sort = (0, util_1.optionalNumber)(context, 'sort', patch.sort, 0);
        if (Object.keys(data).length === 0)
            (0, util_1.fail)(context, 'patch must set at least one field');
        await this.ctx.query.from(exports.CATALOG_TABLES.PRODUCTS).update(data).where('id', id).execute();
    }
    /** Flip a product to 'published' (service key). */
    async publish(id) {
        const context = 'CatalogClient.publish';
        (0, util_1.requireNonEmptyString)(context, 'id', id);
        await this.ctx.query
            .from(exports.CATALOG_TABLES.PRODUCTS)
            .update({ status: 'published' })
            .where('id', id)
            .execute();
    }
    // ───────── variants ─────────
    /** Add a variant to a product (service key). Returns the stored variant. */
    async addVariant(productId, input) {
        const context = 'CatalogClient.addVariant';
        (0, util_1.requireNonEmptyString)(context, 'productId', productId);
        const variant = this.buildVariant(context, productId, input);
        await this.ctx.query.from(exports.CATALOG_TABLES.VARIANTS).insert(this.variantRow(variant)).execute();
        return variant;
    }
    /** Variants for a product, ordered by sort. */
    async listVariants(productId) {
        const context = 'CatalogClient.listVariants';
        (0, util_1.requireNonEmptyString)(context, 'productId', productId);
        return this.ctx.query
            .from(exports.CATALOG_TABLES.VARIANTS)
            .where('product_id', productId)
            .orderBy('sort', 'ASC')
            .rows();
    }
    /** Fetch one variant by id. Null if unknown. */
    async getVariant(id) {
        const context = 'CatalogClient.getVariant';
        (0, util_1.requireNonEmptyString)(context, 'id', id);
        return this.ctx.query.from(exports.CATALOG_TABLES.VARIANTS).where('id', id).first();
    }
    /** Patch a variant (service key). Only the fields present are updated. */
    async updateVariant(id, patch) {
        const context = 'CatalogClient.updateVariant';
        (0, util_1.requireNonEmptyString)(context, 'id', id);
        if (!(0, util_1.isPlainObject)(patch))
            (0, util_1.fail)(context, 'patch must be a plain object');
        const data = {};
        if (patch.sku !== undefined) {
            data.sku = patch.sku === null ? null : (0, util_1.requireNonEmptyString)(context, 'sku', patch.sku);
        }
        if (patch.title !== undefined)
            data.title = (0, util_1.requireNonEmptyString)(context, 'title', patch.title);
        if (patch.priceCents !== undefined) {
            data.price_cents = this.validateCents(context, 'priceCents', patch.priceCents);
        }
        if (patch.currency !== undefined)
            data.currency = this.validateCurrency(context, patch.currency);
        if (patch.compareAtCents !== undefined) {
            data.compare_at_cents =
                patch.compareAtCents === null
                    ? null
                    : this.validateCents(context, 'compareAtCents', patch.compareAtCents);
        }
        if (patch.options !== undefined)
            data.options = (0, util_1.optionalPlainObject)(context, 'options', patch.options, {});
        if (patch.imageUrl !== undefined) {
            data.image_url =
                patch.imageUrl === null ? null : (0, util_1.requireNonEmptyString)(context, 'imageUrl', patch.imageUrl);
        }
        if (patch.sort !== undefined)
            data.sort = (0, util_1.optionalNumber)(context, 'sort', patch.sort, 0);
        if (Object.keys(data).length === 0)
            (0, util_1.fail)(context, 'patch must set at least one field');
        await this.ctx.query.from(exports.CATALOG_TABLES.VARIANTS).update(data).where('id', id).execute();
    }
    // ───────── internals ─────────
    /** Validate + assemble a variant (money is integer cents). */
    buildVariant(context, productId, input) {
        if (!(0, util_1.isPlainObject)(input))
            (0, util_1.fail)(context, 'variant input must be a plain object');
        const sku = input.sku === undefined ? null : (0, util_1.requireNonEmptyString)(context, 'sku', input.sku);
        const title = (0, util_1.optionalString)(context, 'title', input.title, 'Default');
        const priceCents = this.validateCents(context, 'priceCents', input.priceCents);
        const currency = this.validateCurrency(context, input.currency);
        const compareAtCents = input.compareAtCents === undefined
            ? null
            : this.validateCents(context, 'compareAtCents', input.compareAtCents);
        const options = (0, util_1.optionalPlainObject)(context, 'options', input.options, {});
        const imageUrl = input.imageUrl === undefined ? null : (0, util_1.requireNonEmptyString)(context, 'imageUrl', input.imageUrl);
        const sort = (0, util_1.optionalNumber)(context, 'sort', input.sort, 0);
        return {
            id: (0, util_1.generateId)(),
            product_id: productId,
            sku,
            title,
            price_cents: priceCents,
            currency,
            compare_at_cents: compareAtCents,
            options,
            image_url: imageUrl,
            sort,
            created_at: (0, util_1.nowIso)(),
        };
    }
    /** Wire insert for a product: drop created_at + unset nullable columns. */
    productRow(product) {
        const { created_at: _omitted, collection_id, image_url, ...rest } = product;
        const row = { ...rest };
        if (collection_id !== null)
            row.collection_id = collection_id;
        if (image_url !== null)
            row.image_url = image_url;
        return row;
    }
    /** Wire insert for a variant: drop created_at + unset nullable columns. */
    variantRow(variant) {
        const { created_at: _omitted, sku, compare_at_cents, image_url, ...rest } = variant;
        const row = { ...rest };
        if (sku !== null)
            row.sku = sku;
        if (compare_at_cents !== null)
            row.compare_at_cents = compare_at_cents;
        if (image_url !== null)
            row.image_url = image_url;
        return row;
    }
    validateStatus(context, value, fallback) {
        if (value === undefined)
            return fallback;
        if (typeof value !== 'string' || !PRODUCT_STATUSES.includes(value)) {
            (0, util_1.fail)(context, `"status" must be one of ${PRODUCT_STATUSES.join(', ')} — got "${String(value)}"`);
        }
        return value;
    }
    /** Integer minor units (cents), >= 0. Rejects floats outright. */
    validateCents(context, field, value) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
            (0, util_1.fail)(context, `"${field}" must be a non-negative integer (minor units / cents) — got "${String(value)}"`);
        }
        return value;
    }
    validateCurrency(context, value) {
        const currency = (0, util_1.optionalString)(context, 'currency', value, 'USD');
        if (!/^[A-Za-z]{3}$/.test(currency)) {
            (0, util_1.fail)(context, `"currency" must be a 3-letter ISO-4217 code — got "${currency}"`);
        }
        return currency.toUpperCase();
    }
    /**
     * Kebab slug, deduped against existing rows: `shirt`, `shirt-2`, … One
     * LIKE query fetches candidates; the suffix is computed locally (mirrors
     * the cms/events modules).
     */
    async uniqueSlug(table, base) {
        const rows = await this.ctx.query
            .from(table)
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
exports.CatalogClient = CatalogClient;
/** The catalog module definition — wire it up via `client.modules.enable('catalog')`. */
exports.catalogModule = (0, core_1.defineModule)({
    name: 'catalog',
    migrations: exports.CATALOG_MIGRATIONS,
    factory: (ctx) => new CatalogClient(ctx),
});
//# sourceMappingURL=catalog-client.js.map