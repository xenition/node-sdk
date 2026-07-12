"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clientIp = clientIp;
exports.rateLimiter = rateLimiter;
const MAX_BUCKETS = 10000;
/** Client IP: Cloudflare header first, then XFF, then a shared fallback. */
function clientIp(c) {
    const cf = c.req.header('cf-connecting-ip');
    if (cf)
        return cf;
    const xff = c.req.header('x-forwarded-for');
    const first = xff?.split(',')[0]?.trim();
    return first || 'unknown';
}
/**
 * `limitPerMinute` requests per minute per client IP; capacity equals the
 * limit so short bursts up to the full budget are allowed.
 */
function rateLimiter(limitPerMinute) {
    if (!Number.isFinite(limitPerMinute) || limitPerMinute <= 0) {
        throw new Error(`rateLimiter: limit must be a positive number, got ${limitPerMinute}`);
    }
    const buckets = new Map();
    const capacity = limitPerMinute;
    const refillPerMs = limitPerMinute / 60000;
    return async (c, next) => {
        const now = Date.now();
        const key = clientIp(c);
        let bucket = buckets.get(key);
        if (!bucket) {
            // Bound memory: drop the stalest half when the map grows too large.
            if (buckets.size >= MAX_BUCKETS) {
                const keys = [...buckets.keys()].slice(0, MAX_BUCKETS / 2);
                for (const k of keys)
                    buckets.delete(k);
            }
            bucket = { tokens: capacity, last: now };
            buckets.set(key, bucket);
        }
        bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.last) * refillPerMs);
        bucket.last = now;
        if (bucket.tokens < 1) {
            return c.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests — try again shortly.' } }, 429, { 'Retry-After': String(Math.ceil((1 - bucket.tokens) / refillPerMs / 1000)) });
        }
        bucket.tokens -= 1;
        await next();
    };
}
//# sourceMappingURL=rate-limit.js.map