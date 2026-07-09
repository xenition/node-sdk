"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map