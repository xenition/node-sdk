/**
 * orders module types — a placed order and its line items, over the
 * `orders__orders` / `orders__items` tables.
 *
 * Row shapes mirror the tables 1:1 (snake_case column names are the wire
 * contract with `/app-platform/query`); the Hono routers camelCase every row
 * on the way out.
 *
 * MONEY IS ALWAYS INTEGER MINOR UNITS (cents) — `subtotal_cents`,
 * `total_cents`, `unit_price_cents` are whole-number `integer` columns.
 *
 * v0 pricing: `total_cents === subtotal_cents` — there is NO tax or shipping
 * yet. `createFromCart` snapshots the cart's line items so the order is
 * immutable even if the cart or catalog changes afterward.
 */
export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';
/**
 * The stored order row (snake_case, mirrors `orders__orders`).
 *
 * camelCase (router) shape: `{ id, number, cartToken, email, currency,
 * subtotalCents, totalCents, status, paymentProvider, paymentRef, data,
 * createdAt }`. The `id` (a UUID) doubles as the unguessable access token for
 * the confirmation page (see the orders router).
 */
export interface OrderRecord {
    id: string;
    /** Human-ish unique reference, e.g. `XN-7QK4ZP`. */
    number: string;
    /** Token of the cart this order was created from, or null. */
    cart_token: string | null;
    email: string;
    currency: string;
    subtotal_cents: number;
    /** v0: equals `subtotal_cents` (no tax/shipping). */
    total_cents: number;
    status: OrderStatus;
    /** Payment gateway, e.g. 'mock' | 'stripe', or null before payment. */
    payment_provider: string | null;
    /** Gateway reference (payment_intent / mock ref), or null before payment. */
    payment_ref: string | null;
    /** Free-form jsonb payload (notes, shipping address, …). */
    data: Record<string, unknown>;
    created_at: string;
}
/** One order line (snake_case, mirrors `orders__items`). */
export interface OrderItem {
    id: string;
    order_id: string;
    variant_id: string;
    title: string | null;
    variant_title: string | null;
    quantity: number;
    /** Snapshot of the price paid per unit, integer minor units (cents). */
    unit_price_cents: number;
}
/** An order enriched with its line items. */
export type OrderWithItems = OrderRecord & {
    items: OrderItem[];
};
/** Input for `createFromCart`. */
export interface CreateOrderInput {
    /** Buyer email (required — the order's contact + email-gated lookup key). */
    email: string;
    /** Optional free-form payload merged into the order's `data`. */
    data?: Record<string, unknown>;
}
/** Input for `markPaid`. */
export interface MarkPaidInput {
    /** Payment gateway that settled the order, e.g. 'mock' | 'stripe'. */
    provider: string;
    /** Gateway reference (payment_intent id, mock ref, …). */
    ref: string;
}
export interface ListOrdersOptions {
    /** Filter to a single status; omit for all statuses. */
    status?: OrderStatus;
    limit?: number;
}
//# sourceMappingURL=types.d.ts.map