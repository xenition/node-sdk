import { Migration } from '../../migrations/types';
import { ModuleContext } from '../core';
import { CatalogCollection, CatalogProduct, CatalogVariant, CreateCollectionInput, CreateProductInput, CreateVariantInput, GetProductOptions, ListProductsOptions, ProductWithVariants, UpdateProductInput, UpdateVariantInput } from './types';
export declare const CATALOG_TABLES: {
    readonly COLLECTIONS: "catalog__collections";
    readonly PRODUCTS: "catalog__products";
    readonly VARIANTS: "catalog__variants";
};
export declare const CATALOG_MIGRATIONS: Migration[];
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
export declare class CatalogClient {
    private readonly ctx;
    constructor(ctx: ModuleContext);
    /** Create a collection; slug auto-generated (deduped) from the title. */
    createCollection(input: CreateCollectionInput): Promise<CatalogCollection>;
    /** Fetch one collection by slug. Null if unknown. */
    getCollection(slug: string): Promise<CatalogCollection | null>;
    /** All collections, ordered by sort then title. */
    listCollections(): Promise<CatalogCollection[]>;
    /**
     * Create a product; slug auto-generated (deduped) from the title. An
     * optional `variants[]` creates the product and its SKUs together and the
     * returned product carries them. Status defaults to 'draft'.
     */
    createProduct(input: CreateProductInput): Promise<ProductWithVariants>;
    /**
     * Fetch one product by slug plus its variants (ordered by sort). Public by
     * default: a non-published product resolves to null. Pass
     * `{ anyStatus: true }` (service-key admin) to read drafts too.
     */
    getProduct(slug: string, options?: GetProductOptions): Promise<ProductWithVariants | null>;
    /**
     * List products (without variants). Filtered to `status` (default
     * 'published'; pass 'all' to skip) and optionally to a collection by SLUG
     * — an unknown collection slug yields an empty list. Ordered by a
     * whitelisted column (default 'sort').
     */
    listProducts(options?: ListProductsOptions): Promise<CatalogProduct[]>;
    /** Patch a product (service key). Only the fields present are updated. */
    updateProduct(id: string, patch: UpdateProductInput): Promise<void>;
    /** Flip a product to 'published' (service key). */
    publish(id: string): Promise<void>;
    /** Add a variant to a product (service key). Returns the stored variant. */
    addVariant(productId: string, input: CreateVariantInput): Promise<CatalogVariant>;
    /** Variants for a product, ordered by sort. */
    listVariants(productId: string): Promise<CatalogVariant[]>;
    /** Fetch one variant by id. Null if unknown. */
    getVariant(id: string): Promise<CatalogVariant | null>;
    /** Patch a variant (service key). Only the fields present are updated. */
    updateVariant(id: string, patch: UpdateVariantInput): Promise<void>;
    /** Validate + assemble a variant (money is integer cents). */
    private buildVariant;
    /** Wire insert for a product: drop created_at + unset nullable columns. */
    private productRow;
    /** Wire insert for a variant: drop created_at + unset nullable columns. */
    private variantRow;
    private validateStatus;
    /** Integer minor units (cents), >= 0. Rejects floats outright. */
    private validateCents;
    private validateCurrency;
    /**
     * Kebab slug, deduped against existing rows: `shirt`, `shirt-2`, … One
     * LIKE query fetches candidates; the suffix is computed locally (mirrors
     * the cms/events modules).
     */
    private uniqueSlug;
}
/** The catalog module definition — wire it up via `client.modules.enable('catalog')`. */
export declare const catalogModule: import("../core").ModuleDefinition<CatalogClient>;
//# sourceMappingURL=catalog-client.d.ts.map