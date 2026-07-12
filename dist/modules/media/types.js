"use strict";
/**
 * media module types — galleries/albums with ordered media items for
 * photo, portfolio, and product-showcase sites. Row shapes mirror the
 * `media__*` tables 1:1 (snake_case column names are the wire contract
 * with `/app-platform/query`).
 *
 * The actual files live in platform storage; this module only stores
 * records that reference their storage URLs. `created_at` owns a
 * `DEFAULT now()` on both tables, so it is omitted from inserts (mirrors
 * the events module).
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map