/**
 * catalog module types — products, their purchasable variants, and the
 * collections that group them, over the `catalog__*` tables.
 *
 * Row shapes mirror the tables 1:1 (snake_case column names are the wire
 * contract with `/app-platform/query`). The Hono routers camelCase every
 * row on the way out (see hono/normalize.ts), so the browser/storefront
 * sees the camelCase shapes documented on each interface below.
 *
 * MONEY IS ALWAYS INTEGER MINOR UNITS (cents) — `price_cents` /
 * `compare_at_cents` are whole-number `integer` columns; there are no
 * floats anywhere in this module. A $19.99 price is `1999`.
 *
 * Only `created_at` (a `DEFAULT now()` timestamptz) is omitted from
 * inserts; nullable columns left unset (`collection_id`, `sku`, `image_url`,
 * `compare_at_cents`) are omitted too so the column takes SQL NULL.
 */

export type ProductStatus = 'draft' | 'published';

/**
 * A collection groups products (a storefront category / department).
 *
 * camelCase (router) shape: `{ id, slug, title, description, sort,
 * createdAt }`.
 */
export interface CatalogCollection {
  id: string;
  slug: string;
  title: string;
  description: string;
  sort: number;
  created_at: string;
}

export interface CreateCollectionInput {
  title: string;
  /** Auto-generated from `title` (kebab-case, `-2` deduping) when omitted. */
  slug?: string;
  description?: string;
  sort?: number;
}

/**
 * A product is the catalog entry a shopper browses; the purchasable SKUs
 * live in its `variants` (a product always has at least one to be buyable).
 *
 * camelCase (router) shape: `{ id, slug, title, description, collectionId,
 * status, imageUrl, data, sort, createdAt }`. `getProduct` / the product
 * routes add a `variants` array (see `CatalogVariant`).
 */
export interface CatalogProduct {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** Owning collection id, or null when uncategorized. */
  collection_id: string | null;
  status: ProductStatus;
  /** Primary image, or null. */
  image_url: string | null;
  /** Free-form jsonb payload: specs, tags, SEO, … */
  data: Record<string, unknown>;
  sort: number;
  created_at: string;
}

/**
 * One purchasable SKU of a product (a size/color/… combination). Price is
 * carried on the variant, not the product, so each SKU can be priced
 * independently.
 *
 * camelCase (router) shape: `{ id, productId, sku, title, priceCents,
 * currency, compareAtCents, options, imageUrl, sort, createdAt }`.
 */
export interface CatalogVariant {
  id: string;
  product_id: string;
  /** Stock-keeping unit code, or null. */
  sku: string | null;
  title: string;
  /** Price in integer minor units (cents). Never a float. */
  price_cents: number;
  /** ISO-4217 currency code; defaults to 'USD'. */
  currency: string;
  /** Optional "was" price in cents (for a strike-through), or null. */
  compare_at_cents: number | null;
  /** Variant axes, e.g. `{ size: 'M', color: 'Red' }`. */
  options: Record<string, unknown>;
  /** Variant image, or null. */
  image_url: string | null;
  sort: number;
  created_at: string;
}

/** A product enriched with its variants (ordered by sort). */
export type ProductWithVariants = CatalogProduct & { variants: CatalogVariant[] };

export interface CreateVariantInput {
  sku?: string;
  /** Defaults to 'Default'. */
  title?: string;
  /** Required. Integer minor units (cents), >= 0. */
  priceCents: number;
  /** Defaults to 'USD'. */
  currency?: string;
  /** Optional "was" price in cents, >= 0. */
  compareAtCents?: number;
  /** Variant axes, e.g. `{ size: 'M', color: 'Red' }`. */
  options?: Record<string, unknown>;
  imageUrl?: string;
  sort?: number;
}

export interface CreateProductInput {
  title: string;
  /** Auto-generated from `title` (deduped) when omitted. */
  slug?: string;
  description?: string;
  /** Owning collection id (not slug); omit for uncategorized. */
  collectionId?: string;
  /** Defaults to 'draft'. */
  status?: ProductStatus;
  imageUrl?: string;
  data?: Record<string, unknown>;
  sort?: number;
  /** Optional initial variants — created alongside the product. */
  variants?: CreateVariantInput[];
}

/** Every field optional — only the keys present are updated. Service key. */
export interface UpdateProductInput {
  title?: string;
  slug?: string;
  description?: string;
  /** Pass null to uncategorize. */
  collectionId?: string | null;
  status?: ProductStatus;
  /** Pass null to clear. */
  imageUrl?: string | null;
  data?: Record<string, unknown>;
  sort?: number;
}

/** Every field optional — only the keys present are updated. Service key. */
export interface UpdateVariantInput {
  sku?: string | null;
  title?: string;
  priceCents?: number;
  currency?: string;
  compareAtCents?: number | null;
  options?: Record<string, unknown>;
  imageUrl?: string | null;
  sort?: number;
}

export interface ListProductsOptions {
  /** Filter to a collection by SLUG; unknown slug yields an empty list. */
  collection?: string;
  /** A specific status (default 'published'), or 'all' to skip the filter. */
  status?: ProductStatus | 'all';
  /** Whitelisted order column; defaults to 'sort'. */
  orderBy?: string;
  direction?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
}

/** Options for `getProduct`. */
export interface GetProductOptions {
  /**
   * Return the product regardless of status. Off by default, so public
   * reads only ever see published products (a draft resolves to null).
   */
  anyStatus?: boolean;
}
