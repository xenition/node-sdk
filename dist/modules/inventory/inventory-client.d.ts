import { Migration } from '../../migrations/types';
import { ModuleContext } from '../core';
import { SetStockOptions, StockView } from './types';
export declare const INVENTORY_TABLES: {
    readonly STOCK: "inventory__stock";
};
export declare const INVENTORY_MIGRATIONS: Migration[];
/**
 * inventory module client — stock per catalog variant over
 * `inventory__stock` (one row per variant).
 *
 * `available = quantity - reserved` is always derived. The reservation
 * lifecycle is: `reserve` (hold seats for an open cart/order) → `commit`
 * (order paid: consume both quantity and the hold) OR `release` (cart
 * abandoned: give the hold back).
 *
 * v0 race model (see modules/core.ts): the reservation guard is the
 * conditional UPDATE itself — `reserve` increments `reserved` in a single
 * statement whose WHERE only matches when enough is available (or the
 * variant is on a 'continue' oversell policy), so two concurrent reserves
 * can't both take the last unit; the loser's UPDATE matches no row and the
 * method returns false. The mutating methods therefore use raw parameterized
 * SQL (service key) rather than the read-then-write query builder.
 */
export declare class InventoryClient {
    private readonly ctx;
    constructor(ctx: ModuleContext);
    /**
     * Set (upsert) a variant's on-hand quantity. Creates the row if absent.
     * `policy` is applied when provided; when omitted it defaults to 'deny' on
     * first write and is left unchanged on an existing row. `reserved` is
     * never touched here.
     */
    setStock(variantId: string, quantity: number, options?: SetStockOptions): Promise<StockView>;
    /**
     * Increment a variant's on-hand quantity by `delta` (may be negative).
     * Upserts: a missing row starts at `max(delta, 0)` so a negative adjust
     * never creates negative stock; an existing row is adjusted as-is (which
     * can go negative under oversell). `reserved` is untouched.
     */
    adjust(variantId: string, delta: number): Promise<StockView>;
    /**
     * Current stock view for a variant. A variant with no stock row reads as
     * `{ quantity: 0, reserved: 0, available: 0, policy: 'deny' }` (out of
     * stock), never null — so storefront "in stock?" checks are total.
     */
    getStock(variantId: string): Promise<StockView>;
    /**
     * Stock views for many variants at once, keyed by variant id. Only
     * variants that have a stock row appear in the map — callers treat a
     * missing key as out of stock (available 0). An empty input returns `{}`.
     */
    getStockMany(variantIds: string[]): Promise<Record<string, StockView>>;
    /**
     * Reserve `qty` units for an open cart/order. Returns true when the hold
     * was taken (enough available, OR the variant is on a 'continue' oversell
     * policy), false otherwise. The check + increment is a single conditional
     * UPDATE, so it is the concurrency guard: a losing racer matches no row.
     * A variant with no stock row can never be reserved under 'deny'.
     */
    reserve(variantId: string, qty: number): Promise<boolean>;
    /**
     * Release `qty` previously-reserved units (cart abandoned/expired).
     * `reserved` floors at 0, so an over-release can't drive it negative.
     */
    release(variantId: string, qty: number): Promise<void>;
    /**
     * Commit `qty` on an order being paid: consume the on-hand quantity AND
     * clear the matching hold in one statement (`quantity -= qty`,
     * `reserved -= qty` floored at 0).
     */
    commit(variantId: string, qty: number): Promise<void>;
    /** Row → computed view. Reads snake_case OR camelCase keys (runtimes differ). */
    private view;
    private emptyView;
    private validateInt;
    private validatePolicy;
}
/** The inventory module definition — wire it up via `client.modules.enable('inventory')`. */
export declare const inventoryModule: import("../core").ModuleDefinition<InventoryClient>;
//# sourceMappingURL=inventory-client.d.ts.map