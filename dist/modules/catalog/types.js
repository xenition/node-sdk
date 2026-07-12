"use strict";
/**
 * catalog module types — products, their purchasable variants, and the
 * collections that group them, over the `catalog__*` tables.
 *
 * Row shapes mirror the tables 1:1 (snake_case column names are the wire
 * contract with `/app-platform/query`). The Hono routers camelCase every
 * row on the way out (see hono/normalize.ts), so the browser/storefront
 * sees the camelCase shapes documented on each interface below.
 *
 * MONEY IS ALWAYS INTEGER MINOR UNITS (cents) — `price_cents` /
 * `compare_at_cents` are whole-number `integer` columns; there are no
 * floats anywhere in this module. A $19.99 price is `1999`.
 *
 * Only `created_at` (a `DEFAULT now()` timestamptz) is omitted from
 * inserts; nullable columns left unset (`collection_id`, `sku`, `image_url`,
 * `compare_at_cents`) are omitted too so the column takes SQL NULL.
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map