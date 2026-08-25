import type { XenitionClient } from '../xenition-client';
import type { RouterDefinition } from './define-router';
/** Modules that ship a prebuilt router. */
export type XenitionApiModule = 'cms' | 'forms' | 'reviews' | 'listings' | 'events' | 'media' | 'booking' | 'catalog' | 'inventory' | 'cart' | 'orders' | 'checkout' | 'billing' | 'jobs';
/**
 * Options shared by every router (and `createXenitionApi`, which adds
 * `modules` on top).
 */
export interface XenitionRouterOptions {
    /**
     * CORS behavior:
     *   - `true` (default) — permissive `*`
     *   - `string[]` — allowlist of origins (echoed back when they match)
     *   - `false` — no CORS headers (same-origin only, or handled upstream)
     */
    cors?: boolean | string[];
    /**
     * Use this client instead of building one from the environment. When
     * omitted, the router builds a `XenitionClient` from `XENITION_API_KEY`
     * + `XENITION_API_URL`, read from the Hono context env (Cloudflare
     * Workers secrets) with a `process.env` fallback (Node).
     */
    client?: XenitionClient;
    /**
     * Write-route rate limit: requests per minute per client IP (token
     * bucket). Defaults to 10. Pass `false` to disable. Best-effort: the
     * bucket lives in isolate memory, and Cloudflare runs many isolates —
     * see `rateLimiter()` for the honest scope of this protection.
     */
    rateLimit?: number | false;
}
export interface XenitionApiOptions extends XenitionRouterOptions {
    /** Which module routers to mount. Defaults to every one of them. */
    modules?: XenitionApiModule[];
    /**
     * The app's OWN routers, built with `defineRouter`. Mounted on the same
     * parent as the built-ins, so they inherit the shared error mapping, CORS
     * and 404 handling, and their declared `paths` join the OpenAPI document.
     */
    custom?: RouterDefinition[];
}
//# sourceMappingURL=types.d.ts.map