"use strict";
/**
 * Types for the auth module. Mirrors the DB shapes in
 * backend/sql/app-database/0001_auth.sql so the SDK surface matches
 * server persistence 1:1.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BROKERED_PROVIDERS = void 0;
exports.isBrokeredProvider = isBrokeredProvider;
/**
 * The providers `startSignIn()` can run. `twitter` is in the registry but has
 * no sign-in lane, so asking for it fails before any request is made.
 */
exports.BROKERED_PROVIDERS = ['google', 'github', 'apple', 'facebook'];
/** Whether a provider name can be passed to `startSignIn()`. */
function isBrokeredProvider(provider) {
    return exports.BROKERED_PROVIDERS.includes(provider);
}
//# sourceMappingURL=types.js.map