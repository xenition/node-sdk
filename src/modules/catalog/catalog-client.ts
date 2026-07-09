import { Migration } from '../../migrations/types';
import { defineModule, ModuleContext } from '../core';
import {
  fail,
  generateId,
  isPlainObject,
  nowIso,
  optionalNumber,
  optionalPlainObject,
  optionalString,
  requireNonEmptyString,
  slugify,
} from '../util';
import {
  CatalogCollection,
  CatalogProduct,
  CatalogVariant,
  CreateCollectionInput,
  CreateProductInput,
  CreateVariantInput,
  GetProductOptions,
  ListProductsOptions,
  ProductStatus,
  ProductWithVariants,
  UpdateProductInput,
  UpdateVariantInput,
} from './types';

export const CATALOG_TABLES = {
  COLLECTIONS: 'catalog__collections',
  PRODUCTS: 'catalog__products',
  VARIANTS: 'catalog__variants',
} as const;

export const CATALOG_MIGRATIONS: Migration[] = [
  {
    id: 'catalog/0001_create_catalog__collections',
    sql: `CREATE TABLE IF NOT EXISTS ${CATALOG_TABLES.COLLECTIONS} (
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
    sql: `CREATE TABLE IF NOT EXISTS ${CATALOG_TABLES.PRODUCTS} (
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
    sql: `CREATE INDEX IF NOT EXISTS catalog__products_collection_idx ON ${CATALOG_TABLES.PRODUCTS} (collection_id, status, sort)`,
  },
  {
    id: 'catalog/0004_create_catalog__variants',
    sql: `CREATE TABLE IF NOT EXISTS ${CATALOG_TABLES.VARIANTS} (
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
    sql: `CREATE INDEX IF NOT EXISTS catalog__variants_product_idx ON ${CATALOG_TABLES.VARIANTS} (product_id, sort)`,
  },
];

const PRODUCT_STATUSES: ProductStatus[] = ['draft', 'published'];
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
export class CatalogClient {
  constructor(private readonly ctx: ModuleContext) {}

  // ───────── collections ─────────

  /** Create a collection; slug auto-generated (deduped) from the title. */
  async createCollection(input: CreateCollectionInput): Promise<CatalogCollection> {
    const context = 'CatalogClient.createCollection';
    const title = requireNonEmptyString(context, 'title', input.title);
    const description = optionalString(context, 'description', input.description, '');
    const sort = optionalNumber(context, 'sort', input.sort, 0);
    const slug =
      input.slug !== undefined
        ? requireNonEmptyString(context, 'slug', input.slug)
        : await this.uniqueSlug(CATALOG_TABLES.COLLECTIONS, slugify(title));

    const collection: CatalogCollection = {
      id: generateId(),
      slug,
      title,
      description,
      sort,
      created_at: nowIso(),
    };
    // created_at is OWNED by the column default (now()) — omit it from the
    // wire insert (same as events/reviews/booking).
    const { created_at: _omitted, ...row } = collection;
    await this.ctx.query.from(CATALOG_TABLES.COLLECTIONS).insert(row).execute();
    return collection;
  }

  /** Fetch one collection by slug. Null if unknown. */
  async getCollection(slug: string): Promise<CatalogCollection | null> {
    const context = 'CatalogClient.getCollection';
    requireNonEmptyString(context, 'slug', slug);
    return this.ctx.query
      .from(CATALOG_TABLES.COLLECTIONS)
      .where('slug', slug)
      .first<CatalogCollection>();
  }

  /** All collections, ordered by sort then title. */
  async listCollections(): Promise<CatalogCollection[]> {
    return this.ctx.query
      .from(CATALOG_TABLES.COLLECTIONS)
      .orderBy('sort', 'ASC')
      .orderBy('title', 'ASC')
      .rows<CatalogCollection>();
  }

  // ───────── products ─────────

  /**
   * Create a product; slug auto-generated (deduped) from the title. An
   * optional `variants[]` creates the product and its SKUs together and the
   * returned product carries them. Status defaults to 'draft'.
   */
  async createProduct(input: CreateProductInput): Promise<ProductWithVariants> {
    const context = 'CatalogClient.createProduct';
    const title = requireNonEmptyString(context, 'title', input.title);
    const description = optionalString(context, 'description', input.description, '');
    const collectionId =
      input.collectionId === undefined
        ? null
        : requireNonEmptyString(context, 'collectionId', input.collectionId);
    const status = this.validateStatus(context, input.status, 'draft');
    const imageUrl =
      input.imageUrl === undefined ? null : requireNonEmptyString(context, 'imageUrl', input.imageUrl);
    const data = optionalPlainObject(context, 'data', input.data, {});
    const sort = optionalNumber(context, 'sort', input.sort, 0);
    if (input.variants !== undefined && !Array.isArray(input.variants)) {
      fail(context, '"variants" must be an array of variant inputs');
    }
    const slug =
      input.slug !== undefined
        ? requireNonEmptyString(context, 'slug', input.slug)
        : await this.uniqueSlug(CATALOG_TABLES.PRODUCTS, slugify(title));

    const productId = generateId();
    // Validate + build all variants BEFORE any write, so a bad variant never
    // leaves an orphaned product row behind (fail-fast, no partial write).
    const variants: CatalogVariant[] = (input.variants ?? []).map((v, i) =>
      this.buildVariant(`${context} (variants[${i}])`, productId, v),
    );

    const product: CatalogProduct = {
      id: productId,
      slug,
      title,
      description,
      collection_id: collectionId,
      status,
      image_url: imageUrl,
      data,
      sort,
      created_at: nowIso(),
    };
    await this.ctx.query.from(CATALOG_TABLES.PRODUCTS).insert(this.productRow(product)).execute();

    if (variants.length > 0) {
      await this.ctx.query
        .from(CATALOG_TABLES.VARIANTS)
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
  async getProduct(slug: string, options: GetProductOptions = {}): Promise<ProductWithVariants | null> {
    const context = 'CatalogClient.getProduct';
    requireNonEmptyString(context, 'slug', slug);
    const product = await this.ctx.query
      .from(CATALOG_TABLES.PRODUCTS)
      .where('slug', slug)
      .first<CatalogProduct>();
    if (!product) return null;
    if (!options.anyStatus && product.status !== 'published') return null;
    const variants = await this.listVariants(product.id);
    return { ...product, variants };
  }

  /**
   * List products (without variants). Filtered to `status` (default
   * 'published'; pass 'all' to skip) and optionally to a collection by SLUG
   * — an unknown collection slug yields an empty list. Ordered by a
   * whitelisted column (default 'sort').
   */
  async listProducts(options: ListProductsOptions = {}): Promise<CatalogProduct[]> {
    const context = 'CatalogClient.listProducts';
    const orderBy = options.orderBy ?? 'sort';
    if (!PRODUCT_ORDER_COLUMNS.includes(orderBy)) {
      fail(context, `"orderBy" must be one of ${PRODUCT_ORDER_COLUMNS.join(', ')} — got "${orderBy}"`);
    }
    const status = options.status ?? 'published';

    let collectionId: string | undefined;
    if (options.collection !== undefined) {
      const collection = await this.getCollection(
        requireNonEmptyString(context, 'collection', options.collection),
      );
      if (!collection) return [];
      collectionId = collection.id;
    }

    let qb = this.ctx.query.from(CATALOG_TABLES.PRODUCTS);
    if (collectionId !== undefined) qb = qb.where('collection_id', collectionId);
    if (status !== 'all') {
      if (!PRODUCT_STATUSES.includes(status as ProductStatus)) {
        fail(context, `"status" must be one of ${PRODUCT_STATUSES.join(', ')}, all — got "${String(status)}"`);
      }
      qb = qb.where('status', status);
    }
    qb = qb.orderBy(orderBy, options.direction ?? 'ASC');
    if (options.limit !== undefined) qb = qb.limit(optionalNumber(context, 'limit', options.limit, 0));
    if (options.offset !== undefined) qb = qb.offset(optionalNumber(context, 'offset', options.offset, 0));
    return qb.rows<CatalogProduct>();
  }

  /** Patch a product (service key). Only the fields present are updated. */
  async updateProduct(id: string, patch: UpdateProductInput): Promise<void> {
    const context = 'CatalogClient.updateProduct';
    requireNonEmptyString(context, 'id', id);
    if (!isPlainObject(patch)) fail(context, 'patch must be a plain object');
    const data: Record<string, unknown> = {};
    if (patch.title !== undefined) data.title = requireNonEmptyString(context, 'title', patch.title);
    if (patch.slug !== undefined) data.slug = requireNonEmptyString(context, 'slug', patch.slug);
    if (patch.description !== undefined) {
      data.description = optionalString(context, 'description', patch.description, '');
    }
    if (patch.collectionId !== undefined) {
      data.collection_id =
        patch.collectionId === null
          ? null
          : requireNonEmptyString(context, 'collectionId', patch.collectionId);
    }
    if (patch.status !== undefined) data.status = this.validateStatus(context, patch.status, 'draft');
    if (patch.imageUrl !== undefined) {
      data.image_url =
        patch.imageUrl === null ? null : requireNonEmptyString(context, 'imageUrl', patch.imageUrl);
    }
    if (patch.data !== undefined) data.data = optionalPlainObject(context, 'data', patch.data, {});
    if (patch.sort !== undefined) data.sort = optionalNumber(context, 'sort', patch.sort, 0);
    if (Object.keys(data).length === 0) fail(context, 'patch must set at least one field');
    await this.ctx.query.from(CATALOG_TABLES.PRODUCTS).update(data).where('id', id).execute();
  }

  /** Flip a product to 'published' (service key). */
  async publish(id: string): Promise<void> {
    const context = 'CatalogClient.publish';
    requireNonEmptyString(context, 'id', id);
    await this.ctx.query
      .from(CATALOG_TABLES.PRODUCTS)
      .update({ status: 'published' })
      .where('id', id)
      .execute();
  }

  // ───────── variants ─────────

  /** Add a variant to a product (service key). Returns the stored variant. */
  async addVariant(productId: string, input: CreateVariantInput): Promise<CatalogVariant> {
    const context = 'CatalogClient.addVariant';
    requireNonEmptyString(context, 'productId', productId);
    const variant = this.buildVariant(context, productId, input);
    await this.ctx.query.from(CATALOG_TABLES.VARIANTS).insert(this.variantRow(variant)).execute();
    return variant;
  }

  /** Variants for a product, ordered by sort. */
  async listVariants(productId: string): Promise<CatalogVariant[]> {
    const context = 'CatalogClient.listVariants';
    requireNonEmptyString(context, 'productId', productId);
    return this.ctx.query
      .from(CATALOG_TABLES.VARIANTS)
      .where('product_id', productId)
      .orderBy('sort', 'ASC')
      .rows<CatalogVariant>();
  }

  /** Fetch one variant by id. Null if unknown. */
  async getVariant(id: string): Promise<CatalogVariant | null> {
    const context = 'CatalogClient.getVariant';
    requireNonEmptyString(context, 'id', id);
    return this.ctx.query.from(CATALOG_TABLES.VARIANTS).where('id', id).first<CatalogVariant>();
  }

  /** Patch a variant (service key). Only the fields present are updated. */
  async updateVariant(id: string, patch: UpdateVariantInput): Promise<void> {
    const context = 'CatalogClient.updateVariant';
    requireNonEmptyString(context, 'id', id);
    if (!isPlainObject(patch)) fail(context, 'patch must be a plain object');
    const data: Record<string, unknown> = {};
    if (patch.sku !== undefined) {
      data.sku = patch.sku === null ? null : requireNonEmptyString(context, 'sku', patch.sku);
    }
    if (patch.title !== undefined) data.title = requireNonEmptyString(context, 'title', patch.title);
    if (patch.priceCents !== undefined) {
      data.price_cents = this.validateCents(context, 'priceCents', patch.priceCents);
    }
    if (patch.currency !== undefined) data.currency = this.validateCurrency(context, patch.currency);
    if (patch.compareAtCents !== undefined) {
      data.compare_at_cents =
        patch.compareAtCents === null
          ? null
          : this.validateCents(context, 'compareAtCents', patch.compareAtCents);
    }
    if (patch.options !== undefined) data.options = optionalPlainObject(context, 'options', patch.options, {});
    if (patch.imageUrl !== undefined) {
      data.image_url =
        patch.imageUrl === null ? null : requireNonEmptyString(context, 'imageUrl', patch.imageUrl);
    }
    if (patch.sort !== undefined) data.sort = optionalNumber(context, 'sort', patch.sort, 0);
    if (Object.keys(data).length === 0) fail(context, 'patch must set at least one field');
    await this.ctx.query.from(CATALOG_TABLES.VARIANTS).update(data).where('id', id).execute();
  }

  // ───────── internals ─────────

  /** Validate + assemble a variant (money is integer cents). */
  private buildVariant(
    context: string,
    productId: string,
    input: CreateVariantInput,
  ): CatalogVariant {
    if (!isPlainObject(input)) fail(context, 'variant input must be a plain object');
    const sku = input.sku === undefined ? null : requireNonEmptyString(context, 'sku', input.sku);
    const title = optionalString(context, 'title', input.title, 'Default');
    const priceCents = this.validateCents(context, 'priceCents', input.priceCents);
    const currency = this.validateCurrency(context, input.currency);
    const compareAtCents =
      input.compareAtCents === undefined
        ? null
        : this.validateCents(context, 'compareAtCents', input.compareAtCents);
    const options = optionalPlainObject(context, 'options', input.options, {});
    const imageUrl =
      input.imageUrl === undefined ? null : requireNonEmptyString(context, 'imageUrl', input.imageUrl);
    const sort = optionalNumber(context, 'sort', input.sort, 0);
    return {
      id: generateId(),
      product_id: productId,
      sku,
      title,
      price_cents: priceCents,
      currency,
      compare_at_cents: compareAtCents,
      options,
      image_url: imageUrl,
      sort,
      created_at: nowIso(),
    };
  }

  /** Wire insert for a product: drop created_at + unset nullable columns. */
  private productRow(product: CatalogProduct): Record<string, unknown> {
    const { created_at: _omitted, collection_id, image_url, ...rest } = product;
    const row: Record<string, unknown> = { ...rest };
    if (collection_id !== null) row.collection_id = collection_id;
    if (image_url !== null) row.image_url = image_url;
    return row;
  }

  /** Wire insert for a variant: drop created_at + unset nullable columns. */
  private variantRow(variant: CatalogVariant): Record<string, unknown> {
    const { created_at: _omitted, sku, compare_at_cents, image_url, ...rest } = variant;
    const row: Record<string, unknown> = { ...rest };
    if (sku !== null) row.sku = sku;
    if (compare_at_cents !== null) row.compare_at_cents = compare_at_cents;
    if (image_url !== null) row.image_url = image_url;
    return row;
  }

  private validateStatus(context: string, value: unknown, fallback: ProductStatus): ProductStatus {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !PRODUCT_STATUSES.includes(value as ProductStatus)) {
      fail(context, `"status" must be one of ${PRODUCT_STATUSES.join(', ')} — got "${String(value)}"`);
    }
    return value as ProductStatus;
  }

  /** Integer minor units (cents), >= 0. Rejects floats outright. */
  private validateCents(context: string, field: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      fail(context, `"${field}" must be a non-negative integer (minor units / cents) — got "${String(value)}"`);
    }
    return value;
  }

  private validateCurrency(context: string, value: unknown): string {
    const currency = optionalString(context, 'currency', value, 'USD');
    if (!/^[A-Za-z]{3}$/.test(currency)) {
      fail(context, `"currency" must be a 3-letter ISO-4217 code — got "${currency}"`);
    }
    return currency.toUpperCase();
  }

  /**
   * Kebab slug, deduped against existing rows: `shirt`, `shirt-2`, … One
   * LIKE query fetches candidates; the suffix is computed locally (mirrors
   * the cms/events modules).
   */
  private async uniqueSlug(table: string, base: string): Promise<string> {
    const rows = await this.ctx.query
      .from(table)
      .select('slug')
      .whereLike('slug', `${base}%`)
      .rows<{ slug: string }>();
    const taken = new Set(rows.map((row) => row.slug));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }
}

/** The catalog module definition — wire it up via `client.modules.enable('catalog')`. */
export const catalogModule = defineModule({
  name: 'catalog',
  migrations: CATALOG_MIGRATIONS,
  factory: (ctx: ModuleContext) => new CatalogClient(ctx),
});
