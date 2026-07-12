"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map