import type { Context, MiddlewareHandler } from 'hono';

/**
 * In-memory token-bucket rate limiter for the write routes (form / review
 * submissions).
 *
 * Best-effort by design: the buckets live in the process (or Workers
 * isolate) that handled the request. Cloudflare spins up many isolates
 * across POPs, each with its own map, so a determined attacker gets
 * `limit × isolates` per minute — this is abuse *dampening*, not a hard
 * quota. Platform-side limits are the real backstop. For a single Node
 * process it is exact.
 */

interface Bucket {
  tokens: number;
  last: number;
}

const MAX_BUCKETS = 10_000;

/** Client IP: Cloudflare header first, then XFF, then a shared fallback. */
export function clientIp(c: Context): string {
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return cf;
  const xff = c.req.header('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  return first || 'unknown';
}

/**
 * `limitPerMinute` requests per minute per client IP; capacity equals the
 * limit so short bursts up to the full budget are allowed.
 */
export function rateLimiter(limitPerMinute: number): MiddlewareHandler {
  if (!Number.isFinite(limitPerMinute) || limitPerMinute <= 0) {
    throw new Error(`rateLimiter: limit must be a positive number, got ${limitPerMinute}`);
  }
  const buckets = new Map<string, Bucket>();
  const capacity = limitPerMinute;
  const refillPerMs = limitPerMinute / 60_000;

  return async (c, next) => {
    const now = Date.now();
    const key = clientIp(c);
    let bucket = buckets.get(key);
    if (!bucket) {
      // Bound memory: drop the stalest half when the map grows too large.
      if (buckets.size >= MAX_BUCKETS) {
        const keys = [...buckets.keys()].slice(0, MAX_BUCKETS / 2);
        for (const k of keys) buckets.delete(k);
      }
      bucket = { tokens: capacity, last: now };
      buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.last) * refillPerMs);
    bucket.last = now;
    if (bucket.tokens < 1) {
      return c.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests — try again shortly.' } },
        429,
        { 'Retry-After': String(Math.ceil((1 - bucket.tokens) / refillPerMs / 1000)) },
      );
    }
    bucket.tokens -= 1;
    await next();
  };
}
