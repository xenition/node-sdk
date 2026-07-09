import type { Context, MiddlewareHandler } from 'hono';
/** Client IP: Cloudflare header first, then XFF, then a shared fallback. */
export declare function clientIp(c: Context): string;
/**
 * `limitPerMinute` requests per minute per client IP; capacity equals the
 * limit so short bursts up to the full budget are allowed.
 */
export declare function rateLimiter(limitPerMinute: number): MiddlewareHandler;
//# sourceMappingURL=rate-limit.d.ts.map