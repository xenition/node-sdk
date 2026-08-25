import { Hono } from 'hono';
import type { QuotaPeriod } from '../modules/quotas';
import type { XenitionRouterOptions } from './types';
/**
 * `/quotas` — the usage meter, over HTTP.
 *
 *   GET /quotas/:key          "2 of 5 analyses used, resets on the 1st"
 *   GET /quotas?keys=a,b,c    the same for several, in one round trip
 *
 * The quotas module has had a client since it shipped and no router, so
 * every freemium app that wanted to draw a meter on the phone hand-wrote
 * this. It is a small surface with two rules worth stating out loud.
 *
 * FIRST: READING NEVER CONSUMES. Both routes call `peek`, never `consume`.
 * A screen that shows the meter is often the screen you land on, and a
 * `consume` behind a GET would spend a user's monthly allowance on the act
 * of looking at it — and spend it again on every pull-to-refresh, every
 * back-navigation, and every prefetch a browser or link preview decides to
 * make on its own. Spending belongs on the server, at the moment the work
 * actually happens: `await quotas.consume(userId, 'analysis', { limit })`
 * inside the route that does the expensive thing.
 *
 * SECOND: THE LIMIT IS SERVER-SIDE CONFIGURATION, NOT CLIENT INPUT. The
 * `limit` and `period` come from this router's `quotas` option and from
 * nowhere else. A client-supplied limit would let anyone grant themselves
 * an unlimited allowance simply by asking for `?limit=999999` — the
 * counter is honest, but the verdict `allowed` is computed against
 * whatever limit you compare it to, so handing the client that number is
 * handing them the paywall. The same map should be what the consuming
 * routes pass, so the meter and the gate never disagree.
 *
 *   quotasRouter({ quotas: { analysis: { limit: 5, period: 'month' } } })
 *
 * The subject is always the authenticated caller. An `?subject=` parameter
 * would read (and, in any future write route, spend) somebody else's
 * allowance, so there is not one.
 */
/** One quota's server-side configuration. */
export interface QuotaDefinition {
    /** Maximum allowed in the window. */
    limit: number;
    /** Window length. Default `month`. `total` never resets. */
    period?: QuotaPeriod;
}
export interface QuotasRouterOptions extends XenitionRouterOptions {
    /**
     * The quotas this app enforces, by key. Without it the routes answer 501
     * rather than inventing a limit: a meter reading against a made-up
     * denominator is worse than an honest "this app has no quotas".
     */
    quotas?: Record<string, QuotaDefinition>;
}
export declare function quotasRouter(options?: QuotasRouterOptions): Hono;
//# sourceMappingURL=quotas-router.d.ts.map