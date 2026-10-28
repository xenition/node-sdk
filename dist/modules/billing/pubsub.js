"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyPubSubToken = verifyPubSubToken;
const jws_1 = require("./jws");
/**
 * Verify the OIDC token Google Cloud Pub/Sub attaches to an authenticated
 * push (`Authorization: Bearer <jwt>`) — the Play RTDN counterpart of Apple's
 * signed notifications.
 *
 * Turn it on in the push subscription ("Enable authentication", pick a service
 * account, optionally set an audience), then pass the same values here. The
 * token is an RS256 JWT signed by Google: its key comes from Google's JWKS,
 * the issuer must be accounts.google.com, it must be in date, and — when
 * configured — the audience and the service account's email must match.
 *
 * A second layer, like the Apple chain check: the handlers already re-read
 * state from Play, so a forged push cannot grant anything.
 */
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
/** Google rotates these keys over days; an hour of caching is plenty fresh. */
const JWKS_TTL_MS = 60 * 60 * 1000;
let cache = null;
async function jwks(options, refresh) {
    const url = options.jwksUrl ?? GOOGLE_JWKS;
    if (!refresh && cache && cache.url === url && Date.now() - cache.at < JWKS_TTL_MS)
        return cache.keys;
    const res = await (options.fetchImpl ?? globalThis.fetch)(url);
    if (!res.ok)
        throw new Error(`pubsub: could not fetch Google's signing keys (${res.status})`);
    const body = (await res.json());
    cache = { url, at: Date.now(), keys: Array.isArray(body.keys) ? body.keys : [] };
    return cache.keys;
}
/** Verify a push's `Authorization` header (or the bare token). Returns the token's claims; throws with a reason. */
async function verifyPubSubToken(authorization, options = {}) {
    const token = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token)
        throw new Error('pubsub: no bearer token on the push');
    const parts = (0, jws_1.parseJws)(token);
    const header = parts.header;
    if (header.alg !== 'RS256')
        throw new Error('pubsub: expected an RS256 token');
    let key = (await jwks(options, false)).find((k) => k.kid === header.kid);
    // A key Google rotated in since the cache was filled.
    if (!key)
        key = (await jwks(options, true)).find((k) => k.kid === header.kid);
    if (!key)
        throw new Error('pubsub: the token is signed by an unknown key');
    const jwk = { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', ext: true };
    // `never`: the jwk overload's JsonWebKey type is DOM-only; the shape is right.
    const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, (0, jws_1.toArrayBuffer)(parts.signature), (0, jws_1.toArrayBuffer)(parts.signingInput));
    if (!ok)
        throw new Error('pubsub: the token signature does not verify');
    const claims = parts.payload;
    const now = Math.floor((options.now ?? Date.now()) / 1000);
    if (!ISSUERS.has(String(claims.iss)))
        throw new Error('pubsub: the token is not from Google');
    if (typeof claims.exp !== 'number' || claims.exp < now)
        throw new Error('pubsub: the token has expired');
    if (options.audience !== undefined && claims.aud !== options.audience)
        throw new Error('pubsub: the token is for another audience');
    if (options.serviceAccountEmail !== undefined && (claims.email !== options.serviceAccountEmail || claims.email_verified !== true)) {
        throw new Error('pubsub: the token is from another service account');
    }
    return claims;
}
//# sourceMappingURL=pubsub.js.map