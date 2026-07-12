/**
 * inventory module types — stock levels per catalog variant, over the
 * single `inventory__stock` table (one row per variant, `variant_id`
 * UNIQUE).
 *
 * The stored row tracks `quantity` (on hand) and `reserved` (held by open
 * carts/orders); `available = quantity - reserved` is DERIVED, never stored.
 * `policy` decides oversell: 'deny' (the default) refuses a reservation
 * that would exceed availability; 'continue' always allows it (backorder /
 * made-to-order).
 *
 * Only `updated_at` is a `DEFAULT now()` column; the write paths use raw
 * conditional SQL (see inventory-client.ts) so the reserve check is atomic.
 */
export type StockPolicy = 'deny' | 'continue';
/** The stored stock row (snake_case, mirrors `inventory__stock`). */
export interface StockRow {
    id: string;
    variant_id: string;
    quantity: number;
    reserved: number;
    policy: StockPolicy;
    updated_at: string;
}
/**
 * A computed stock view: `available = quantity - reserved`. This is the
 * shape `getStock` / `getStockMany` return and the router serves.
 *
 * camelCase (router) shape: `{ variantId, quantity, reserved, available,
 * policy }`.
 */
export interface StockView {
    variant_id: string;
    quantity: number;
    reserved: number;
    /** `quantity - reserved` (can be negative under an oversell policy). */
    available: number;
    policy: StockPolicy;
}
export interface SetStockOptions {
    /** Oversell policy; defaults to 'deny' on first write, unchanged on upsert. */
    policy?: StockPolicy;
}
//# sourceMappingURL=types.d.ts.map