/**
 * cart module types — a client-token-keyed shopping cart and its line items,
 * over the `cart__carts` / `cart__items` tables.
 *
 * Row shapes mirror the tables 1:1 (snake_case column names are the wire
 * contract with `/app-platform/query`). `getCart` returns a computed,
 * already-camelCased view (like booking's slots), so the router serves it
 * verbatim.
 *
 * MONEY IS ALWAYS INTEGER MINOR UNITS (cents) — `unit_price_cents` is a
 * whole-number `integer` column snapshotted from the catalog variant at the
 * moment the item is added, so a later price change never mutates an open
 * cart. A $19.99 line price is `1999`.
 *
 * Only `created_at` (a `DEFAULT now()` timestamptz) is omitted from inserts;
 * nullable columns left unset (`title`, `variant_title`, `image_url`) are
 * omitted too so the column takes SQL NULL.
 */
export type CartStatus = 'open' | 'converted';
/**
 * The stored cart row (snake_case, mirrors `cart__carts`).
 *
 * camelCase (router) shape: `{ id, token, currency, status, createdAt }`.
 * `token` is the CLIENT-generated cart id — an unguessable opaque handle the
 * storefront keeps in local storage; it is how every cart route addresses a
 * cart (there is no auth on a cart).
 */
export interface CartRecord {
    id: string;
    token: string;
    currency: string;
    status: CartStatus;
    created_at: string;
}
/**
 * One line item (snake_case, mirrors `cart__items`). Price + titles are
 * SNAPSHOTTED from the catalog variant at add time so the cart is stable
 * even if the catalog changes underneath it.
 */
export interface CartItem {
    id: string;
    cart_id: string;
    variant_id: string;
    quantity: number;
    /** Snapshot of the variant's price in integer minor units (cents). */
    unit_price_cents: number;
    /** Snapshot of the owning product's title, or null. */
    title: string | null;
    /** Snapshot of the variant's title (e.g. "M / Red"), or null. */
    variant_title: string | null;
    /** Snapshot of the variant/product image, or null. */
    image_url: string | null;
    created_at: string;
}
/**
 * A single item in the computed cart view (camelCase). `lineTotalCents =
 * unitPriceCents × quantity`.
 */
export interface CartItemView {
    id: string;
    variantId: string;
    quantity: number;
    unitPriceCents: number;
    title: string | null;
    variantTitle: string | null;
    imageUrl: string | null;
    /** `unitPriceCents × quantity` (integer cents). */
    lineTotalCents: number;
}
/**
 * The computed cart view `getCart` returns and the router serves.
 * `subtotalCents = Σ (unitPriceCents × quantity)` across items.
 */
export interface CartView {
    token: string;
    currency: string;
    items: CartItemView[];
    /** Σ line totals, integer minor units (cents). No tax/shipping (v0). */
    subtotalCents: number;
}
//# sourceMappingURL=types.d.ts.map