import { Migration } from '../../migrations/types';
import { ModuleContext } from '../core';
import { CartItem, CartRecord, CartView } from './types';
export declare const CART_TABLES: {
    readonly CARTS: "cart__carts";
    readonly ITEMS: "cart__items";
};
export declare const CART_MIGRATIONS: Migration[];
/**
 * cart module client — a client-token-keyed shopping cart over
 * `cart__carts` / `cart__items`.
 *
 * A cart is addressed by an opaque, client-generated `token` (kept in the
 * storefront's local storage); there is no auth, so the token itself is the
 * capability. `addItem` snapshots the variant's price + titles from
 * `catalog__variants` (and its product's title from `catalog__products`) at
 * the moment it's added, so a later catalog edit never mutates an open cart,
 * and merges quantity when the same variant is added twice.
 *
 * Money is ALWAYS integer minor units (cents): `unit_price_cents` is a
 * whole-number column, and the subtotal is `Σ unit_price_cents × quantity`.
 *
 * v0 trust model (see modules/core.ts): validation lives in the SDK. Inserts
 * omit `created_at` (a `DEFAULT now()` column) and any unset nullable column.
 */
export declare class CartClient {
    private readonly ctx;
    constructor(ctx: ModuleContext);
    /**
     * Fetch the cart for `token`, creating an empty `open` cart if none exists
     * yet. Idempotent under a race: a concurrent create loses the UNIQUE(token)
     * insert and we re-read the winner's row.
     */
    getOrCreate(token: string): Promise<CartRecord>;
    /**
     * Add `qty` of a variant to the cart (creating the cart if needed). Looks
     * up the variant in `catalog__variants` to snapshot `unit_price_cents`,
     * `variant_title`, `image_url` + the owning product's title, then MERGES
     * into an existing line for the same variant (quantities add; the original
     * price snapshot is kept). Returns the stored/updated line.
     */
    addItem(token: string, variantId: string, qty: number): Promise<CartItem>;
    /**
     * Set a line's quantity. `qty === 0` REMOVES the line. The item is scoped
     * to the cart (`id` + `cart_id`) so a token can only touch its own lines.
     */
    updateItem(token: string, itemId: string, qty: number): Promise<void>;
    /** Remove a line from the cart. Scoped to the cart. */
    removeItem(token: string, itemId: string): Promise<void>;
    /**
     * The computed cart view: `{ token, currency, items, subtotalCents }` with
     * items camelCased and each carrying a `lineTotalCents`. An unknown token
     * reads as an empty `open` cart (never null) — storefront-friendly.
     */
    getCart(token: string): Promise<CartView>;
    /** Empty the cart (delete all its lines). The cart row itself stays. */
    clear(token: string): Promise<void>;
    /** Flip the cart to 'converted' (called once its order is paid). */
    markConverted(token: string): Promise<void>;
    private findCart;
    private deleteItem;
    /** Wire insert for a line: drop created_at + unset nullable columns. */
    private itemRow;
    /** Row → computed view. Reads snake_case OR camelCase keys (runtimes differ). */
    private itemView;
    private hydrateCart;
    private optText;
    /** Integer quantity >= `min` (0 allowed only where a line-remove is valid). */
    private validateQty;
    private isConflict;
}
/** The cart module definition — wire it up via `client.modules.enable('cart')`. */
export declare const cartModule: import("../core").ModuleDefinition<CartClient>;
//# sourceMappingURL=cart-client.d.ts.map