"use strict";
/**
 * Types for the auth module. Mirrors the DB shapes in
 * backend/sql/app-database/0001_auth.sql so the SDK surface matches
 * server persistence 1:1.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BROKERED_PROVIDERS = exports.NO_EMAIL_DOMAIN = void 0;
exports.hasNoEmail = hasNoEmail;
exports.isBrokeredProvider = isBrokeredProvider;
/**
 * Where an account made by a provider with no email is stored (a phone-only
 * Facebook account). A reserved domain: never mailed, never registrable.
 */
exports.NO_EMAIL_DOMAIN = 'no-email.invalid';
/** True for an account with no real email yet — ask for one with `addEmail`. */
function hasNoEmail(user) {
    return typeof user?.email === 'string' && user.email.toLowerCase().endsWith('.invalid');
}
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