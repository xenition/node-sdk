"use strict";
/**
 * Content-addressed per-app migration ledger — wire/IR types.
 *
 * A migration is `{id, sql}`. The ledger table `_sdk_migrations` records
 * each applied id together with the sha-256 checksum of its SQL, so a
 * migration whose SQL was edited after being applied is detected and
 * rejected instead of silently diverging from what actually ran.
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map