import { Migration } from '../../migrations/types';
import { ModuleContext } from '../core';
import { CreateOrderInput, ListOrdersOptions, MarkPaidInput, OrderRecord, OrderStatus, OrderWithItems } from './types';
export declare const ORDERS_TABLES: {
    readonly ORDERS: "orders__orders";
    readonly ITEMS: "orders__items";
};
export declare const ORDERS_MIGRATIONS: Migration[];
/**
 * orders module client — placed orders + their line items over
 * `orders__orders` / `orders__items`.
 *
 * `createFromCart` snapshots a cart's items into an immutable pending order
 * (with a unique human-ish `number`, allocated with retry-on-conflict).
 * `markPaid` is the settlement seam wired to the checkout router (mock and
 * Stripe both land here): it flips the order to `paid`, COMMITS inventory for
 * every line (`inventory.commit(variantId, qty)`), and marks the source cart
 * converted — all idempotently: a re-entry on an already-paid order is a
 * no-op, so inventory is never double-committed.
 *
 * Money is ALWAYS integer minor units (cents). v0 has no tax/shipping, so
 * `total_cents === subtotal_cents`.
 *
 * v0 trust model (see modules/core.ts): validation lives in the SDK. Inserts
 * omit `created_at` (a `DEFAULT now()` column) and any unset nullable column.
 */
export declare class OrdersClient {
    private readonly ctx;
    constructor(ctx: ModuleContext);
    /**
     * Snapshot an open cart's items into a new `pending` order. Reads the cart
     * (`cart__carts` / `cart__items`) directly, copies each line's snapshotted
     * price/titles, and sets `total_cents = subtotal_cents` (v0 — no tax or
     * shipping). Fails on an unknown or empty cart. Returns the order + items.
     */
    createFromCart(token: string, input: CreateOrderInput): Promise<OrderWithItems>;
    /** Fetch an order + its items by id. Null if unknown. */
    get(id: string): Promise<OrderWithItems | null>;
    /** Fetch an order + its items by its human-ish `number`. Null if unknown. */
    getByNumber(number: string): Promise<OrderWithItems | null>;
    /** List orders (without items), newest first; optionally by status/limit. */
    list(options?: ListOrdersOptions): Promise<OrderRecord[]>;
    /**
     * Settle an order: flip it to `paid`, COMMIT inventory for every line
     * (`inventory.commit(variantId, qty)`), and mark the source cart converted.
     * IDEMPOTENT: if the order is already paid/fulfilled/refunded this is a
     * no-op and inventory is NOT committed a second time. Returns the order +
     * items in their post-payment state.
     */
    markPaid(id: string, input: MarkPaidInput): Promise<OrderWithItems>;
    /** Set an order's status to any valid state (service key). */
    updateStatus(id: string, status: OrderStatus): Promise<void>;
    /**
     * Insert the order, allocating a unique `number` with retry-on-conflict:
     * on a UNIQUE(number) collision a fresh number is tried, up to
     * `NUMBER_MAX_ATTEMPTS` times.
     */
    private insertWithUniqueNumber;
    private withItems;
    /** Wire insert for an order: drop created_at + unset nullable columns. */
    private orderRow;
    /** Wire insert for a line: drop unset nullable columns (title/variant_title). */
    private itemRow;
    private hydrateOrder;
    private hydrateItem;
    /** `XN-` + a short random suffix (Math.random/crypto are fine at runtime). */
    private generateNumber;
    private optText;
    private isPlainObject;
    private requireEmail;
    private isConflict;
}
/** The orders module definition — wire it up via `client.modules.enable('orders')`. */
export declare const ordersModule: import("../core").ModuleDefinition<OrdersClient>;
//# sourceMappingURL=orders-client.d.ts.map