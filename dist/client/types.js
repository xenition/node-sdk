"use strict";
/**
 * Response + request types for `@xenition/sdk/client`.
 *
 * These are the CAMEL-CASE API shapes — the exact JSON a template receives
 * from its own backend (the `@xenition/sdk/hono` routers normalize every row
 * to camelCase; see ../hono/normalize.ts). They are the single source of
 * truth templates import, so they can never drift from the routers.
 *
 * NOTE: the sibling module row types (`../modules/<name>/types.ts`) are snake_case
 * shapes (the wire contract with the platform engine). The types here are
 * their camelCase API projections — defined explicitly so a column rename in
 * a module type can't silently change the public client contract.
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map