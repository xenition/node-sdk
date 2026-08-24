import type { Context, MiddlewareHandler } from 'hono';
import { XenitionClient } from '../xenition-client';
import { XenitionError } from '../core/errors';
import type { User } from '../auth/types';
import { createClientFromEnv, readEnvVar, XenitionApiConfigError } from './client';
import { unauthorized } from './errors';

/**
 * End-user authentication for generated app backends.
 *
 * The routers in this directory run inside the app's own worker holding
 * the platform SERVICE key — a key that can read and write EVERYTHING in
 * the app. Without this middleware there is no notion of "who is asking",
 * so every route is effectively public and every row belongs to everyone.
 * That is fine for a brochure site and wrong for any app with accounts.
 *
 *   import { Hono } from 'hono';
 *   import { requireAuth, currentUser } from '@xenition/sdk/hono';
 *
 *   const app = new Hono();
 *   app.use('/me/*', requireAuth());
 *   app.get('/me/profile', (c) => c.json(currentUser(c)));
 *
 * The mobile/web client sends the access token it got from
 * `auth.login()` as `Authorization: Bearer <token>`; the worker asks the
 * platform who that token belongs to and hangs the answer on the request
 * context. The token is carried per request (never `setHeader()`), so one
 * shared client serves concurrent users without cross-talk.
 *
 * Two middlewares, on purpose:
 *   - `xenitionAuth()` — populate the user IF a token is present, never
 *     reject. For routes that serve guests and members differently.
 *   - `requireAuth()`  — the same, but answer 401 when the token is
 *     missing, malformed, or rejected by the platform.
 */

/** The identity of the caller, as resolved from their access token. */
export interface AuthUser {
  id: string;
  email: string;
  role: string;
  /** The full platform user record — metadata, timestamps, flags. */
  record: User;
  /** The token the caller presented, for calls made on their behalf. */
  accessToken: string;
}

export interface XenitionAuthOptions {
  /**
   * Use this client instead of building one from the environment
   * (`XENITION_API_KEY` / `XENITION_API_URL`), matching the routers.
   */
  client?: XenitionClient;
  /**
   * Seconds to reuse a verification result for the same token. Every
   * request would otherwise cost a round trip to the platform just to
   * learn who is calling.
   *
   * Default 60. Pass 0 to verify on every request. The ceiling is
   * deliberately low: this cache is how long a logged-out or banned user
   * can still be served, so it trades a little staleness for a lot of
   * latency, and never more than a minute of it.
   */
  cacheTtlSeconds?: number;
  /** Max tokens held in the isolate-local cache. Default 1000. */
  cacheMaxEntries?: number;
}

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
export function bearerToken(c: Context): string | undefined {
  const header = c.req.header('Authorization') ?? c.req.header('authorization');
  if (!header) return undefined;
  // `\S+` rather than `.+`: bearer tokens carry no internal whitespace, and
  // it lets the trailing `\s*` absorb the stray newline a shell-built header
  // leaves behind. (`.` would not match that newline, and JS `$` anchors at
  // the true end of input — so `.+$` silently fails to match at all.)
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1];
}

/* ── verification cache (isolate-local, TTL-bounded) ───────────────────── */

interface CacheEntry {
  user: AuthUser;
  expiresAt: number;
}

/**
 * Cache of verified tokens. Lives in the isolate that handled the request
 * and dies with it — Cloudflare runs many isolates, so this is a latency
 * optimization, never a security boundary. Bounded so a token-spraying
 * caller cannot grow it without limit.
 */
class TokenCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  get(token: string, now: number): AuthUser | undefined {
    if (this.ttlMs <= 0) return undefined;
    const hit = this.entries.get(token);
    if (!hit) return undefined;
    if (hit.expiresAt <= now) {
      this.entries.delete(token);
      return undefined;
    }
    return hit.user;
  }

  set(token: string, user: AuthUser, now: number): void {
    if (this.ttlMs <= 0) return;
    if (this.entries.size >= this.maxEntries) {
      // Drop the stalest half rather than one entry, so eviction is
      // amortized instead of running on every insert at the ceiling.
      const doomed = [...this.entries.keys()].slice(0, Math.ceil(this.maxEntries / 2));
      for (const key of doomed) this.entries.delete(key);
    }
    this.entries.set(token, { user, expiresAt: now + this.ttlMs });
  }
}

/* ── middleware ────────────────────────────────────────────────────────── */

function toAuthUser(record: User, accessToken: string): AuthUser {
  return { id: record.id, email: record.email, role: record.role, record, accessToken };
}

/**
 * Resolve the client once per middleware instance. Env is stable within an
 * isolate, and a config problem should surface as a 500 from the shared
 * error handler rather than a misleading 401.
 */
function makeResolver(provided?: XenitionClient): (c: Context) => XenitionClient {
  let cached = provided;
  return (c) => {
    if (!cached) {
      cached = createClientFromEnv({
        XENITION_API_KEY: readEnvVar(c, 'XENITION_API_KEY'),
        XENITION_API_URL: readEnvVar(c, 'XENITION_API_URL'),
      });
    }
    return cached;
  };
}

interface Resolution {
  user?: AuthUser;
  /** Why no user — distinguishes "no token" from "bad token" for 401 text. */
  reason?: 'missing' | 'invalid';
  message?: string;
}

function buildVerifier(options: XenitionAuthOptions) {
  const resolveClient = makeResolver(options.client);
  const cache = new TokenCache(
    (options.cacheTtlSeconds ?? DEFAULT_TTL_SECONDS) * 1000,
    options.cacheMaxEntries ?? DEFAULT_MAX_ENTRIES,
  );

  return async function resolve(c: Context): Promise<Resolution> {
    const token = bearerToken(c);
    if (!token) {
      return { reason: 'missing', message: 'Missing Authorization: Bearer <token> header.' };
    }
    const now = Date.now();
    const cached = cache.get(token, now);
    if (cached) return { user: cached };

    try {
      const record = await resolveClient(c).auth.verifyToken(token);
      const user = toAuthUser(record, token);
      cache.set(token, user, now);
      return { user };
    } catch (err) {
      // A rejected END-USER token is a 401 for the caller. Anything else —
      // the platform being down, our own service key being wrong — is not
      // the caller's fault and must not be disguised as one, so it is
      // rethrown for the shared error handler to map (502/500).
      if (err instanceof XenitionError && isTokenRejection(err)) {
        return { reason: 'invalid', message: 'Access token is invalid or expired.' };
      }
      throw err;
    }
  };
}

/** Platform verdicts that mean "this token is no good", as opposed to "we are broken". */
function isTokenRejection(err: XenitionError): boolean {
  return (
    err.code === 'AUTH_INVALID_TOKEN' ||
    err.code === 'AUTH_EXPIRED_TOKEN' ||
    err.code === 'AUTH_FORBIDDEN'
  );
}

/**
 * Populate the caller's identity when they present a valid token, and
 * carry on regardless. Routes read it with `currentUser(c)`, which returns
 * undefined for guests.
 */
export function xenitionAuth(options: XenitionAuthOptions = {}): MiddlewareHandler {
  const resolve = buildVerifier(options);
  return async (c, next) => {
    const { user } = await resolve(c);
    if (user) c.set(CONTEXT_KEY, user);
    await next();
  };
}

/**
 * Same, but answer 401 when the caller is not authenticated. Downstream
 * handlers can use `requireUser(c)` and never deal with undefined.
 */
export function requireAuth(options: XenitionAuthOptions = {}): MiddlewareHandler {
  const resolve = buildVerifier(options);
  return async (c, next) => {
    const { user, reason, message } = await resolve(c);
    if (!user) {
      return unauthorized(
        c,
        message ?? 'Authentication required.',
        reason === 'invalid' ? 'AUTH_INVALID_TOKEN' : 'UNAUTHENTICATED',
      );
    }
    c.set(CONTEXT_KEY, user);
    await next();
  };
}

/* ── accessors ─────────────────────────────────────────────────────────── */

/** The authenticated caller, or undefined when the request is a guest. */
export function currentUser(c: Context): AuthUser | undefined {
  return c.get(CONTEXT_KEY) as AuthUser | undefined;
}

/**
 * The authenticated caller, or a thrown error. Only call this behind
 * `requireAuth()` — the throw means the route was mounted without it,
 * which is a wiring bug rather than a request the caller can fix.
 */
export function requireUser(c: Context): AuthUser {
  const user = currentUser(c);
  if (!user) {
    throw new XenitionApiConfigError(
      'requireUser(): no authenticated user on this request. Mount requireAuth() ' +
        'on this route before reading the current user.',
    );
  }
  return user;
}

/** The caller's id, or undefined for guests — the common case in queries. */
export function currentUserId(c: Context): string | undefined {
  return currentUser(c)?.id;
}
