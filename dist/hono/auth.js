"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bearerToken = bearerToken;
exports.xenitionAuth = xenitionAuth;
exports.requireAuth = requireAuth;
exports.currentUser = currentUser;
exports.requireUser = requireUser;
exports.currentUserId = currentUserId;
const errors_1 = require("../core/errors");
const client_1 = require("./client");
const errors_2 = require("./errors");
const CONTEXT_KEY = 'xenitionUser';
const DEFAULT_TTL_SECONDS = 60;
const DEFAULT_MAX_ENTRIES = 1000;
/* ── token extraction ──────────────────────────────────────────────────── */
/**
 * The bearer token from the `Authorization` header, or undefined.
 *
 * Scheme match is case-insensitive ("Bearer", "bearer") because clients
 * disagree, and the value is trimmed because a trailing newline from a
 * shell-built header is a very common and very confusing 401.
 */
function bearerToken(c) {
    const header = c.req.header('Authorization') ?? c.req.header('authorization');
    if (!header)
        return undefined;
    // `\S+` rather than `.+`: bearer tokens carry no internal whitespace, and
    // it lets the trailing `\s*` absorb the stray newline a shell-built header
    // leaves behind. (`.` would not match that newline, and JS `$` anchors at
    // the true end of input — so `.+$` silently fails to match at all.)
    const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
    return match?.[1];
}
/**
 * Cache of verified tokens. Lives in the isolate that handled the request
 * and dies with it — Cloudflare runs many isolates, so this is a latency
 * optimization, never a security boundary. Bounded so a token-spraying
 * caller cannot grow it without limit.
 */
class TokenCache {
    constructor(ttlMs, maxEntries) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        this.entries = new Map();
    }
    get(token, now) {
        if (this.ttlMs <= 0)
            return undefined;
        const hit = this.entries.get(token);
        if (!hit)
            return undefined;
        if (hit.expiresAt <= now) {
            this.entries.delete(token);
            return undefined;
        }
        return hit.user;
    }
    set(token, user, now) {
        if (this.ttlMs <= 0)
            return;
        if (this.entries.size >= this.maxEntries) {
            // Drop the stalest half rather than one entry, so eviction is
            // amortized instead of running on every insert at the ceiling.
            const doomed = [...this.entries.keys()].slice(0, Math.ceil(this.maxEntries / 2));
            for (const key of doomed)
                this.entries.delete(key);
        }
        this.entries.set(token, { user, expiresAt: now + this.ttlMs });
    }
}
/* ── middleware ────────────────────────────────────────────────────────── */
function toAuthUser(record, accessToken) {
    return { id: record.id, email: record.email, role: record.role, record, accessToken };
}
/**
 * Resolve the client once per middleware instance. Env is stable within an
 * isolate, and a config problem should surface as a 500 from the shared
 * error handler rather than a misleading 401.
 */
function makeResolver(provided) {
    let cached = provided;
    return (c) => {
        if (!cached) {
            cached = (0, client_1.createClientFromEnv)({
                XENITION_API_KEY: (0, client_1.readEnvVar)(c, 'XENITION_API_KEY'),
                XENITION_API_URL: (0, client_1.readEnvVar)(c, 'XENITION_API_URL'),
            });
        }
        return cached;
    };
}
function buildVerifier(options) {
    const resolveClient = makeResolver(options.client);
    const cache = new TokenCache((options.cacheTtlSeconds ?? DEFAULT_TTL_SECONDS) * 1000, options.cacheMaxEntries ?? DEFAULT_MAX_ENTRIES);
    return async function resolve(c) {
        const token = bearerToken(c);
        if (!token) {
            return { reason: 'missing', message: 'Missing Authorization: Bearer <token> header.' };
        }
        const now = Date.now();
        const cached = cache.get(token, now);
        if (cached)
            return { user: cached };
        try {
            const record = await resolveClient(c).auth.verifyToken(token);
            const user = toAuthUser(record, token);
            cache.set(token, user, now);
            return { user };
        }
        catch (err) {
            // A rejected END-USER token is a 401 for the caller. Anything else —
            // the platform being down, our own service key being wrong — is not
            // the caller's fault and must not be disguised as one, so it is
            // rethrown for the shared error handler to map (502/500).
            if (err instanceof errors_1.XenitionError && isTokenRejection(err)) {
                return { reason: 'invalid', message: 'Access token is invalid or expired.' };
            }
            throw err;
        }
    };
}
/** Platform verdicts that mean "this token is no good", as opposed to "we are broken". */
function isTokenRejection(err) {
    return (err.code === 'AUTH_INVALID_TOKEN' ||
        err.code === 'AUTH_EXPIRED_TOKEN' ||
        err.code === 'AUTH_FORBIDDEN');
}
/**
 * Populate the caller's identity when they present a valid token, and
 * carry on regardless. Routes read it with `currentUser(c)`, which returns
 * undefined for guests.
 */
function xenitionAuth(options = {}) {
    const resolve = buildVerifier(options);
    return async (c, next) => {
        const { user } = await resolve(c);
        if (user)
            c.set(CONTEXT_KEY, user);
        await next();
    };
}
/**
 * Same, but answer 401 when the caller is not authenticated. Downstream
 * handlers can use `requireUser(c)` and never deal with undefined.
 */
function requireAuth(options = {}) {
    const resolve = buildVerifier(options);
    return async (c, next) => {
        const { user, reason, message } = await resolve(c);
        if (!user) {
            return (0, errors_2.unauthorized)(c, message ?? 'Authentication required.', reason === 'invalid' ? 'AUTH_INVALID_TOKEN' : 'UNAUTHENTICATED');
        }
        c.set(CONTEXT_KEY, user);
        await next();
    };
}
/* ── accessors ─────────────────────────────────────────────────────────── */
/** The authenticated caller, or undefined when the request is a guest. */
function currentUser(c) {
    return c.get(CONTEXT_KEY);
}
/**
 * The authenticated caller, or a thrown error. Only call this behind
 * `requireAuth()` — the throw means the route was mounted without it,
 * which is a wiring bug rather than a request the caller can fix.
 */
function requireUser(c) {
    const user = currentUser(c);
    if (!user) {
        throw new client_1.XenitionApiConfigError('requireUser(): no authenticated user on this request. Mount requireAuth() ' +
            'on this route before reading the current user.');
    }
    return user;
}
/** The caller's id, or undefined for guests — the common case in queries. */
function currentUserId(c) {
    return currentUser(c)?.id;
}
//# sourceMappingURL=auth.js.map