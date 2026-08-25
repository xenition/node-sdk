import type { Hono } from 'hono';
/**
 * Small shared pieces for the routers: CORS wiring and query-string
 * parsing that reports precise 400 messages instead of coercing garbage.
 */
/**
 * CORS, spelled out rather than assumed.
 *
 * The old policy allowed `GET, POST, OPTIONS` and the single header
 * `Content-Type`. Both were already wrong for routes the SDK itself ships:
 *
 *   - the cart router answers `PATCH` and `DELETE`, and the notifications
 *     router answers `PUT`, so a browser preflight for any of them was
 *     refused by the very SDK that mounted the route;
 *   - **every authenticated request carries `Authorization`**, and a header
 *     that is not in `allowHeaders` fails the preflight — so from a browser,
 *     every signed-in call to every router failed before it was sent.
 *
 * And because `applyCors` mounts on `'*'`, it answers `OPTIONS` for every
 * path under the mount, including ones it does not serve. No ordering trick
 * upstream can win that race. The documented workaround was `cors: false`
 * plus a hand-rolled policy above the mount — which is a lot of ceremony for
 * "please allow the header I am already sending".
 *
 * So the defaults now cover what the SDK actually serves, and the option
 * takes an object for the rest: a device key, a tenant id, a trace header.
 * `false` still disables it entirely for an app that wants to own the policy.
 */
export interface CorsOptions {
    /** Allowed origins. Omit for `*`. */
    origin?: string | string[];
    /** Extra methods, added to the defaults rather than replacing them. */
    allowMethods?: string[];
    /** Extra request headers, added to the defaults. */
    allowHeaders?: string[];
    /** Response headers a browser may read. */
    exposeHeaders?: string[];
    /** Send `Access-Control-Allow-Credentials`. Never valid with `origin: '*'`. */
    credentials?: boolean;
    /** Preflight cache, seconds. Defaults to 600. */
    maxAge?: number;
}
export declare function applyCors(app: Hono, option: boolean | string[] | CorsOptions | undefined): void;
/** Thrown by the parse helpers; routers convert it to a 400. */
export declare class QueryParamError extends Error {
    constructor(message: string);
}
/** Non-negative integer query param, or undefined when absent. */
export declare function parseNonNegativeInt(name: string, value: string | undefined): number | undefined;
/**
 * `published` filter for the public list route. These routers run with the
 * SERVICE key on a public surface, so the safe default is published-only:
 *   - omitted / '1' / 'true'  → true
 *   - '0' / 'false'           → false (drafts — same visibility the anon
 *                                key already has for reads)
 *   - 'all'                   → undefined (no filter)
 */
export declare function parsePublished(value: string | undefined): boolean | undefined;
/**
 * Optional boolean query flag: `1`/`true` → true, `0`/`false` → false,
 * absent → undefined (no filter). Anything else is a 400.
 */
export declare function parseBooleanFlag(name: string, value: string | undefined): boolean | undefined;
/** Sort direction: case-insensitive ASC/DESC, or undefined when absent. */
export declare function parseDirection(value: string | undefined): 'ASC' | 'DESC' | undefined;
//# sourceMappingURL=router-utils.d.ts.map