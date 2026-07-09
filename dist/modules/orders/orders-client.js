"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ordersModule = exports.OrdersClient = exports.ORDERS_MIGRATIONS = exports.ORDERS_TABLES = void 0;
const errors_1 = require("../../core/errors");
const cart_1 = require("../cart");
const core_1 = require("../core");
const inventory_1 = require("../inventory");
const util_1 = require("../util");
exports.ORDERS_TABLES = {
    ORDERS: 'orders__orders',
    ITEMS: 'orders__items',
};
exports.ORDERS_MIGRATIONS = [
    {
        id: 'orders/0001_create_orders__orders',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.ORDERS_TABLES.ORDERS} (
  id uuid PRIMARY KEY,
  number text NOT NULL UNIQUE,
  cart_token text,
  email text NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  subtotal_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded')),
  payment_provider text,
  payment_ref text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
    },
    {
        id: 'orders/0002_index_orders__orders_status',
        sql: `CREATE INDEX IF NOT EXISTS orders__orders_status_idx ON ${exports.ORDERS_TABLES.ORDERS} (status, created_at)`,
    },
    {
        id: 'orders/0003_create_orders__items',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.ORDERS_TABLES.ITEMS} (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  title text,
  variant_title text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL
)`,
    },
    {
        id: 'orders/0004_index_orders__items_order',
        sql: `CREATE INDEX IF NOT EXISTS orders__items_order_idx ON ${exports.ORDERS_TABLES.ITEMS} (order_id)`,
    },
];
const ORDER_STATUSES = ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded'];
/**
 * Statuses that mean the order has ALREADY been through payment — markPaid is
 * a no-op for these, which is the guard against a double inventory commit.
 */
const ALREADY_PROCESSED = ['paid', 'fulfilled', 'refunded'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Human-ish order-number alphabet — no ambiguous 0/O/1/I/L characters. */
const NUMBER_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const NUMBER_LEN = 6;
const NUMBER_MAX_ATTEMPTS = 8;
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
class OrdersClient {
    constructor(ctx) {
        this.ctx = ctx;
    }
    /**
     * Snapshot an open cart's items into a new `pending` order. Reads the cart
     * (`cart__carts` / `cart__items`) directly, copies each line's snapshotted
     * price/titles, and sets `total_cents = subtotal_cents` (v0 — no tax or
     * shipping). Fails on an unknown or empty cart. Returns the order + items.
     */
    async createFromCart(token, input) {
        const context = 'OrdersClient.createFromCart';
        (0, util_1.requireNonEmptyString)(context, 'token', token);
        const email = this.requireEmail(context, input?.email);
        const data = (0, util_1.optionalPlainObject)(context, 'data', input?.data, {});
        const cart = await this.ctx.query
            .from(cart_1.CART_TABLES.CARTS)
            .where('token', token)
            .first();
        if (!cart)
            (0, util_1.fail)(context, `unknown cart "${token}"`);
        const cartId = String(cart.id ?? '');
        const currency = String(cart.currency ?? 'USD');
        const itemRows = await this.ctx.query
            .from(cart_1.CART_TABLES.ITEMS)
            .where('cart_id', cartId)
            .orderBy('created_at', 'ASC')
            .rows();
        if (itemRows.length === 0)
            (0, util_1.fail)(context, `cart "${token}" is empty`);
        const orderId = (0, util_1.generateId)();
        const items = itemRows.map((r) => ({
            id: (0, util_1.generateId)(),
            order_id: orderId,
            variant_id: String(r.variant_id ?? r.variantId ?? ''),
            title: this.optText(r.title),
            variant_title: this.optText(r.variant_title ?? r.variantTitle),
            quantity: (0, util_1.toNumber)(r.quantity) ?? 0,
            unit_price_cents: (0, util_1.toNumber)(r.unit_price_cents ?? r.unitPriceCents) ?? 0,
        }));
        const subtotalCents = items.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);
        const order = await this.insertWithUniqueNumber(context, {
            id: orderId,
            cart_token: token,
            email,
            currency,
            subtotal_cents: subtotalCents,
            total_cents: subtotalCents, // v0: no tax/shipping.
            data,
        });
        await this.ctx.query
            .from(exports.ORDERS_TABLES.ITEMS)
            .insert(items.map((i) => this.itemRow(i)))
            .execute();
        return { ...order, items };
    }
    /** Fetch an order + its items by id. Null if unknown. */
    async get(id) {
        const context = 'OrdersClient.get';
        (0, util_1.requireNonEmptyString)(context, 'id', id);
        const row = await this.ctx.query
            .from(exports.ORDERS_TABLES.ORDERS)
            .where('id', id)
            .first();
        if (!row)
            return null;
        return this.withItems(this.hydrateOrder(row));
    }
    /** Fetch an order + its items by its human-ish `number`. Null if unknown. */
    async getByNumber(number) {
        const context = 'OrdersClient.getByNumber';
        (0, util_1.requireNonEmptyString)(context, 'number', number);
        const row = await this.ctx.query
            .from(exports.ORDERS_TABLES.ORDERS)
            .where('number', number)
            .first();
        if (!row)
            return null;
        return this.withItems(this.hydrateOrder(row));
    }
    /** List orders (without items), newest first; optionally by status/limit. */
    async list(options = {}) {
        const context = 'OrdersClient.list';
        let qb = this.ctx.query.from(exports.ORDERS_TABLES.ORDERS);
        if (options.status !== undefined) {
            if (!ORDER_STATUSES.includes(options.status)) {
                (0, util_1.fail)(context, `"status" must be one of ${ORDER_STATUSES.join(', ')} — got "${String(options.status)}"`);
            }
            qb = qb.where('status', options.status);
        }
        qb = qb.orderBy('created_at', 'DESC');
        if (options.limit !== undefined) {
            if (typeof options.limit !== 'number' || !Number.isInteger(options.limit) || options.limit < 0) {
                (0, util_1.fail)(context, `"limit" must be a non-negative integer — got "${String(options.limit)}"`);
            }
            qb = qb.limit(options.limit);
        }
        const rows = await qb.rows();
        return rows.map((r) => this.hydrateOrder(r));
    }
    /**
     * Settle an order: flip it to `paid`, COMMIT inventory for every line
     * (`inventory.commit(variantId, qty)`), and mark the source cart converted.
     * IDEMPOTENT: if the order is already paid/fulfilled/refunded this is a
     * no-op and inventory is NOT committed a second time. Returns the order +
     * items in their post-payment state.
     */
    async markPaid(id, input) {
        const context = 'OrdersClient.markPaid';
        (0, util_1.requireNonEmptyString)(context, 'id', id);
        const provider = (0, util_1.requireNonEmptyString)(context, 'provider', input?.provider);
        const ref = (0, util_1.requireNonEmptyString)(context, 'ref', input?.ref);
        const current = await this.get(id);
        if (!current)
            (0, util_1.fail)(context, `unknown order "${id}"`);
        // Double-commit guard: already-processed orders short-circuit.
        if (ALREADY_PROCESSED.includes(current.status))
            return current;
        await this.ctx.query
            .from(exports.ORDERS_TABLES.ORDERS)
            .update({ status: 'paid', payment_provider: provider, payment_ref: ref })
            .where('id', id)
            .execute();
        // Consume stock (and clear the reservation) for each purchased line.
        const inventory = new inventory_1.InventoryClient(this.ctx);
        for (const item of current.items) {
            if (item.variant_id && item.quantity > 0) {
                await inventory.commit(item.variant_id, item.quantity);
            }
        }
        // The cart has done its job — convert it so it can't be re-ordered.
        if (current.cart_token) {
            await this.ctx.query
                .from(cart_1.CART_TABLES.CARTS)
                .update({ status: 'converted' })
                .where('token', current.cart_token)
                .execute();
        }
        return { ...current, status: 'paid', payment_provider: provider, payment_ref: ref };
    }
    /** Set an order's status to any valid state (service key). */
    async updateStatus(id, status) {
        const context = 'OrdersClient.updateStatus';
        (0, util_1.requireNonEmptyString)(context, 'id', id);
        if (!ORDER_STATUSES.includes(status)) {
            (0, util_1.fail)(context, `"status" must be one of ${ORDER_STATUSES.join(', ')} — got "${String(status)}"`);
        }
        await this.ctx.query.from(exports.ORDERS_TABLES.ORDERS).update({ status }).where('id', id).execute();
    }
    // ───────── internals ─────────
    /**
     * Insert the order, allocating a unique `number` with retry-on-conflict:
     * on a UNIQUE(number) collision a fresh number is tried, up to
     * `NUMBER_MAX_ATTEMPTS` times.
     */
    async insertWithUniqueNumber(context, base) {
        let lastErr;
        for (let attempt = 0; attempt < NUMBER_MAX_ATTEMPTS; attempt += 1) {
            const order = {
                id: base.id,
                number: this.generateNumber(),
                cart_token: base.cart_token,
                email: base.email,
                currency: base.currency,
                subtotal_cents: base.subtotal_cents,
                total_cents: base.total_cents,
                status: 'pending',
                payment_provider: null,
                payment_ref: null,
                data: base.data,
                created_at: (0, util_1.nowIso)(),
            };
            try {
                await this.ctx.query.from(exports.ORDERS_TABLES.ORDERS).insert(this.orderRow(order)).execute();
                return order;
            }
            catch (err) {
                if (this.isConflict(err)) {
                    lastErr = err;
                    continue;
                }
                throw err;
            }
        }
        throw lastErr ?? new Error(`${context}: could not allocate a unique order number`);
    }
    async withItems(order) {
        const rows = await this.ctx.query
            .from(exports.ORDERS_TABLES.ITEMS)
            .where('order_id', order.id)
            .rows();
        return { ...order, items: rows.map((r) => this.hydrateItem(r)) };
    }
    /** Wire insert for an order: drop created_at + unset nullable columns. */
    orderRow(order) {
        const { created_at: _omitted, cart_token, payment_provider, payment_ref, ...rest } = order;
        const row = { ...rest };
        if (cart_token !== null)
            row.cart_token = cart_token;
        if (payment_provider !== null)
            row.payment_provider = payment_provider;
        if (payment_ref !== null)
            row.payment_ref = payment_ref;
        return row;
    }
    /** Wire insert for a line: drop unset nullable columns (title/variant_title). */
    itemRow(item) {
        const { title, variant_title, ...rest } = item;
        const row = { ...rest };
        if (title !== null)
            row.title = title;
        if (variant_title !== null)
            row.variant_title = variant_title;
        return row;
    }
    hydrateOrder(row) {
        const get = (snake, camel) => row[snake] ?? row[camel];
        return {
            id: String(get('id', 'id') ?? ''),
            number: String(get('number', 'number') ?? ''),
            cart_token: this.optText(get('cart_token', 'cartToken')),
            email: String(get('email', 'email') ?? ''),
            currency: String(get('currency', 'currency') ?? 'USD'),
            subtotal_cents: (0, util_1.toNumber)(get('subtotal_cents', 'subtotalCents')) ?? 0,
            total_cents: (0, util_1.toNumber)(get('total_cents', 'totalCents')) ?? 0,
            status: (ORDER_STATUSES.includes(get('status', 'status'))
                ? get('status', 'status')
                : 'pending'),
            payment_provider: this.optText(get('payment_provider', 'paymentProvider')),
            payment_ref: this.optText(get('payment_ref', 'paymentRef')),
            data: (this.isPlainObject(get('data', 'data')) ? get('data', 'data') : {}),
            created_at: String(get('created_at', 'createdAt') ?? ''),
        };
    }
    hydrateItem(row) {
        return {
            id: String(row.id ?? ''),
            order_id: String(row.order_id ?? row.orderId ?? ''),
            variant_id: String(row.variant_id ?? row.variantId ?? ''),
            title: this.optText(row.title),
            variant_title: this.optText(row.variant_title ?? row.variantTitle),
            quantity: (0, util_1.toNumber)(row.quantity) ?? 0,
            unit_price_cents: (0, util_1.toNumber)(row.unit_price_cents ?? row.unitPriceCents) ?? 0,
        };
    }
    /** `XN-` + a short random suffix (Math.random/crypto are fine at runtime). */
    generateNumber() {
        const cryptoObj = globalThis.crypto;
        let suffix = '';
        if (cryptoObj?.getRandomValues) {
            const buf = cryptoObj.getRandomValues(new Uint8Array(NUMBER_LEN));
            for (let i = 0; i < NUMBER_LEN; i += 1)
                suffix += NUMBER_ALPHABET[buf[i] % NUMBER_ALPHABET.length];
        }
        else {
            for (let i = 0; i < NUMBER_LEN; i += 1) {
                suffix += NUMBER_ALPHABET[Math.floor(Math.random() * NUMBER_ALPHABET.length)];
            }
        }
        return `XN-${suffix}`;
    }
    optText(value) {
        return typeof value === 'string' && value !== '' ? value : null;
    }
    isPlainObject(value) {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
    requireEmail(context, value) {
        const email = (0, util_1.requireNonEmptyString)(context, 'email', value);
        if (!EMAIL_RE.test(email))
            (0, util_1.fail)(context, '"email" must be a valid email address');
        return email;
    }
    isConflict(err) {
        if (err instanceof errors_1.XenitionError && err.code === 'CONFLICT')
            return true;
        return err instanceof Error && /duplicate|unique|conflict/i.test(err.message);
    }
}
exports.OrdersClient = OrdersClient;
/** The orders module definition — wire it up via `client.modules.enable('orders')`. */
exports.ordersModule = (0, core_1.defineModule)({
    name: 'orders',
    migrations: exports.ORDERS_MIGRATIONS,
    factory: (ctx) => new OrdersClient(ctx),
});
//# sourceMappingURL=orders-client.js.map