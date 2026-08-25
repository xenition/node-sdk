import type { AppClient, AppClientOptions } from './types';
/**
 * `@xenition/sdk/client` — a framework-agnostic browser/worker data client
 * for a generated app's OWN backend.
 *
 * Templates render as static frontends whose backend mounts the
 * `@xenition/sdk/hono` routers (which hold the platform SERVICE key). This
 * client talks ONLY to that backend over the global `fetch` — it carries NO
 * key, no axios, and no node builtins, so it is safe to bundle into any
 * browser/worker frontend. It mirrors the router contract 1:1 and returns
 * the camelCase shapes declared in ./types.
 *
 *   import { createAppClient } from '@xenition/sdk/client';
 *   const api = createAppClient(`${import.meta.env.VITE_API_URL ?? ''}/api`);
 *   const posts = await api.cms.items('posts', { orderBy: 'created_at', direction: 'DESC' });
 *
 * Signed-in routes (all of `auth`'s account half, `jobs`, `notifications`,
 * and everything under `billing` except its public product list) sit behind
 * the backend's `requireAuth()`. Hand the client the END USER's access
 * token — their own credential from `auth.login()`, never a platform key —
 * and it attaches the `Authorization` header to every request:
 *
 *   const api = createAppClient('/api', { accessToken: () => store.getToken() });
 *   const check = await api.billing.entitlement('premium');
 *
 * Error contract:
 *   - single-get (cms.page/cms.item, listings.get, events.get, events.getRsvp,
 *     booking.getBooking, jobs.get) → 404 is null
 *   - every other non-2xx throws `AppClientError(status, code?, message)`
 *     (POST validation 400s surface the server's message).
 *   - a 402 is a PAYWALL, not a failure of the request: check
 *     `err.isPaymentRequired` and read `err.entitlement` / `err.quota`.
 *     Never branch on the message text.
 */
export declare function createAppClient(baseUrl: string, options?: AppClientOptions): AppClient;
//# sourceMappingURL=app-client.d.ts.map