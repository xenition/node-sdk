"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map