"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventoryModule = exports.InventoryClient = exports.INVENTORY_MIGRATIONS = exports.INVENTORY_TABLES = void 0;
const core_1 = require("../core");
const util_1 = require("../util");
exports.INVENTORY_TABLES = {
    STOCK: 'inventory__stock',
};
exports.INVENTORY_MIGRATIONS = [
    {
        id: 'inventory/0001_create_inventory__stock',
        sql: `CREATE TABLE IF NOT EXISTS ${exports.INVENTORY_TABLES.STOCK} (
  id uuid PRIMARY KEY,
  variant_id uuid NOT NULL UNIQUE,
  quantity integer NOT NULL DEFAULT 0,
  reserved integer NOT NULL DEFAULT 0,
  policy text NOT NULL DEFAULT 'deny' CHECK (policy IN ('deny', 'continue')),
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
    },
];
const STOCK_POLICIES = ['deny', 'continue'];
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
class InventoryClient {
    constructor(ctx) {
        this.ctx = ctx;
    }
    /**
     * Set (upsert) a variant's on-hand quantity. Creates the row if absent.
     * `policy` is applied when provided; when omitted it defaults to 'deny' on
     * first write and is left unchanged on an existing row. `reserved` is
     * never touched here.
     */
    async setStock(variantId, quantity, options = {}) {
        const context = 'InventoryClient.setStock';
        (0, util_1.requireNonEmptyString)(context, 'variantId', variantId);
        const qty = this.validateInt(context, 'quantity', quantity, 0);
        const policy = options.policy === undefined ? null : this.validatePolicy(context, options.policy);
        const result = await this.ctx.raw(`INSERT INTO ${exports.INVENTORY_TABLES.STOCK} (id, variant_id, quantity, policy)
VALUES ($1, $2, $3, COALESCE($4, 'deny'))
ON CONFLICT (variant_id) DO UPDATE
  SET quantity = EXCLUDED.quantity,
      policy = COALESCE($4, ${exports.INVENTORY_TABLES.STOCK}.policy),
      updated_at = now()
RETURNING variant_id, quantity, reserved, policy`, [(0, util_1.generateId)(), variantId, qty, policy]);
        const row = result.data[0];
        return row ? this.view(variantId, row) : this.emptyView(variantId, policy ?? 'deny');
    }
    /**
     * Increment a variant's on-hand quantity by `delta` (may be negative).
     * Upserts: a missing row starts at `max(delta, 0)` so a negative adjust
     * never creates negative stock; an existing row is adjusted as-is (which
     * can go negative under oversell). `reserved` is untouched.
     */
    async adjust(variantId, delta) {
        const context = 'InventoryClient.adjust';
        (0, util_1.requireNonEmptyString)(context, 'variantId', variantId);
        if (typeof delta !== 'number' || !Number.isInteger(delta)) {
            (0, util_1.fail)(context, '"delta" must be an integer');
        }
        const result = await this.ctx.raw(`INSERT INTO ${exports.INVENTORY_TABLES.STOCK} (id, variant_id, quantity)
VALUES ($1, $2, GREATEST($3, 0))
ON CONFLICT (variant_id) DO UPDATE
  SET quantity = ${exports.INVENTORY_TABLES.STOCK}.quantity + $3,
      updated_at = now()
RETURNING variant_id, quantity, reserved, policy`, [(0, util_1.generateId)(), variantId, delta]);
        const row = result.data[0];
        return row ? this.view(variantId, row) : this.emptyView(variantId, 'deny');
    }
    /**
     * Current stock view for a variant. A variant with no stock row reads as
     * `{ quantity: 0, reserved: 0, available: 0, policy: 'deny' }` (out of
     * stock), never null — so storefront "in stock?" checks are total.
     */
    async getStock(variantId) {
        const context = 'InventoryClient.getStock';
        (0, util_1.requireNonEmptyString)(context, 'variantId', variantId);
        const row = await this.ctx.query
            .from(exports.INVENTORY_TABLES.STOCK)
            .where('variant_id', variantId)
            .first();
        return row ? this.view(variantId, row) : this.emptyView(variantId, 'deny');
    }
    /**
     * Stock views for many variants at once, keyed by variant id. Only
     * variants that have a stock row appear in the map — callers treat a
     * missing key as out of stock (available 0). An empty input returns `{}`.
     */
    async getStockMany(variantIds) {
        const context = 'InventoryClient.getStockMany';
        if (!Array.isArray(variantIds))
            (0, util_1.fail)(context, '"variantIds" must be an array');
        const ids = variantIds.map((id, i) => (0, util_1.requireNonEmptyString)(context, `variantIds[${i}]`, id));
        if (ids.length === 0)
            return {};
        const rows = await this.ctx.query
            .from(exports.INVENTORY_TABLES.STOCK)
            .whereIn('variant_id', ids)
            .rows();
        const out = {};
        for (const row of rows) {
            const id = String(row.variant_id ?? row.variantId ?? '');
            if (id)
                out[id] = this.view(id, row);
        }
        return out;
    }
    /**
     * Reserve `qty` units for an open cart/order. Returns true when the hold
     * was taken (enough available, OR the variant is on a 'continue' oversell
     * policy), false otherwise. The check + increment is a single conditional
     * UPDATE, so it is the concurrency guard: a losing racer matches no row.
     * A variant with no stock row can never be reserved under 'deny'.
     */
    async reserve(variantId, qty) {
        const context = 'InventoryClient.reserve';
        (0, util_1.requireNonEmptyString)(context, 'variantId', variantId);
        const n = this.validateInt(context, 'qty', qty, 1);
        const result = await this.ctx.raw(`UPDATE ${exports.INVENTORY_TABLES.STOCK}
SET reserved = reserved + $1, updated_at = now()
WHERE variant_id = $2 AND (policy = 'continue' OR quantity - reserved >= $1)
RETURNING reserved`, [n, variantId]);
        return result.data.length > 0;
    }
    /**
     * Release `qty` previously-reserved units (cart abandoned/expired).
     * `reserved` floors at 0, so an over-release can't drive it negative.
     */
    async release(variantId, qty) {
        const context = 'InventoryClient.release';
        (0, util_1.requireNonEmptyString)(context, 'variantId', variantId);
        const n = this.validateInt(context, 'qty', qty, 1);
        await this.ctx.raw(`UPDATE ${exports.INVENTORY_TABLES.STOCK}
SET reserved = GREATEST(reserved - $1, 0), updated_at = now()
WHERE variant_id = $2`, [n, variantId]);
    }
    /**
     * Commit `qty` on an order being paid: consume the on-hand quantity AND
     * clear the matching hold in one statement (`quantity -= qty`,
     * `reserved -= qty` floored at 0).
     */
    async commit(variantId, qty) {
        const context = 'InventoryClient.commit';
        (0, util_1.requireNonEmptyString)(context, 'variantId', variantId);
        const n = this.validateInt(context, 'qty', qty, 1);
        await this.ctx.raw(`UPDATE ${exports.INVENTORY_TABLES.STOCK}
SET quantity = quantity - $1, reserved = GREATEST(reserved - $1, 0), updated_at = now()
WHERE variant_id = $2`, [n, variantId]);
    }
    // ───────── internals ─────────
    /** Row → computed view. Reads snake_case OR camelCase keys (runtimes differ). */
    view(variantId, row) {
        const quantity = (0, util_1.toNumber)(row.quantity) ?? 0;
        const reserved = (0, util_1.toNumber)(row.reserved) ?? 0;
        const policy = row.policy === 'continue' ? 'continue' : 'deny';
        return { variant_id: variantId, quantity, reserved, available: quantity - reserved, policy };
    }
    emptyView(variantId, policy) {
        return { variant_id: variantId, quantity: 0, reserved: 0, available: 0, policy };
    }
    validateInt(context, field, value, min) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
            (0, util_1.fail)(context, `"${field}" must be an integer >= ${min} — got "${String(value)}"`);
        }
        return value;
    }
    validatePolicy(context, value) {
        if (typeof value !== 'string' || !STOCK_POLICIES.includes(value)) {
            (0, util_1.fail)(context, `"policy" must be one of ${STOCK_POLICIES.join(', ')} — got "${String(value)}"`);
        }
        return value;
    }
}
exports.InventoryClient = InventoryClient;
/** The inventory module definition — wire it up via `client.modules.enable('inventory')`. */
exports.inventoryModule = (0, core_1.defineModule)({
    name: 'inventory',
    migrations: exports.INVENTORY_MIGRATIONS,
    factory: (ctx) => new InventoryClient(ctx),
});
//# sourceMappingURL=inventory-client.js.map