import type { XenitionClient } from '../xenition-client';
import type { RouterDefinition } from './define-router';
import type { QuotaDefinition } from './quotas-router';
import type { CorsOptions } from './router-utils';
/**
 * Modules that ship a prebuilt router.
 *
 * This list and `ModuleName` (modules/modules-client.ts) now name the same
 * modules but for two, both mount-only: `checkout` is a payments router
 * over the cart and orders modules, and `auth` is a router over the
 * platform's end-user auth surface (`client.auth`) — neither is a data
 * module of its own, so both appear here and never there. Anything else
 * showing up in one union and not the other means a module has a client no
 * app can reach over HTTP
 * (which is what kept `notifications` and `quotas` hand-written in every
 * app until they got the routers below), or a router with nothing behind
 * it. Keep them in step.
 */
export type XenitionApiModule = 'auth' | 'cms' | 'forms' | 'reviews' | 'listings' | 'events' | 'media' | 'booking' | 'catalog' | 'inventory' | 'cart' | 'orders' | 'checkout' | 'billing' | 'jobs' | 'notifications' | 'quotas';
/**
 * Options shared by every router (and `createXenitionApi`, which adds
 * `modules` on top).
 */
export interface XenitionRouterOptions {
    /**
     * CORS behavior:
     *   - `true` (default) — permissive `*`
     *   - `string[]` — allowlist of origins (echoed back when they match)
     *   - `CorsOptions` — an allowlist plus extra methods/headers, for a
     *     request that carries a header of the app's own (a device key, a
     *     tenant id). `Content-Type` and `Authorization` are already allowed,
     *     as are every method the routers answer.
     *   - `false` — no CORS headers (same-origin only, or handled upstream)
     */
    cors?: boolean | string[] | CorsOptions;
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
    /**
     * Quota limits for the `quotas` router, by key. Server-side on purpose: a
     * client-supplied limit would let anyone grant themselves an unlimited
     * allowance. Without it the quota routes answer 501 rather than metering
     * against a number the caller chose.
     */
    quotas?: Record<string, QuotaDefinition>;
    /**
     * Categories the `notifications` preference routes offer, so a settings
     * screen has switches on it before the user has ever changed anything.
     * Defaults to `['general']` — see `NotificationsRouterOptions.categories`.
     */
    notificationCategories?: string[];
}
//# sourceMappingURL=types.d.ts.map