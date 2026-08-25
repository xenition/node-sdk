import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { XenitionClient } from '../xenition-client';
import type { XenitionRouterOptions } from './types';
/**
 * Custom routes that inherit everything the built-in routers get.
 *
 * `createXenitionApi()` mounted a fixed list of twelve content and commerce
 * routers and offered no way in. Every real app is mostly its OWN routes,
 * and those were landing outside every convention this directory
 * establishes: no shared error mapping, no camelCase normalization, no rate
 * limiter, no auth middleware, and absent from the generated OpenAPI.
 *
 *   const speeches = defineRouter({
 *     name: 'speeches',
 *     build(app, { client, requireAuth, requireEntitlement }) {
 *       app.get('/speeches', requireAuth, async (c) => {
 *         const rows = await client(c).query.from('speeches')
 *           .where('user_id', currentUserId(c)).rows();
 *         return c.json({ speeches: normalizeRows(rows) });
 *       });
 *       app.post('/speeches/:id/analyze', requireAuth, requireEntitlement('premium'), analyze);
 *     },
 *     paths: { '/speeches': { get: { summary: 'The caller’s speeches' } } },
 *   });
 *
 *   app.route('/api', createXenitionApi({ custom: [speeches] }));
 *
 * Built with the same shared `onError` and `notFound` every built-in router
 * installs, so a custom route cannot accidentally leak a stack trace or an
 * upstream URL that the built-ins would have scrubbed.
 *
 * One caveat that applies to the whole API, not just custom routers: Hono
 * does not carry a sub-app's `notFound` when it is mounted under a prefix.
 * An app doing `app.route('/api', createXenitionApi(...))` therefore answers
 * Hono's default text/plain 404 for unmatched paths under `/api`. Install it
 * on the root app to get the JSON shape everywhere:
 *
 *   import { jsonNotFound } from '@xenition/sdk/hono';
 *   app.notFound(jsonNotFound);
 */
/** What a custom router is handed. */
export interface RouterToolkit {
    /** The service-key client for this request. */
    client(c: Context): XenitionClient;
    /** Read a worker secret, with a `process.env` fallback. */
    env(c: Context, name: string): string | undefined;
    /** 401 when the caller has no valid end-user token. */
    requireAuth: MiddlewareHandler;
    /** Populate the caller when present; serve guests otherwise. */
    optionalAuth: MiddlewareHandler;
    /** 402 when the caller lacks the entitlement. */
    requireEntitlement(entitlement: string, message?: string): MiddlewareHandler;
    /** Per-IP token bucket, same best-effort caveats as the built-ins. */
    rateLimit(perMinute?: number): MiddlewareHandler;
}
export interface RouterDefinition {
    /** Identifier, used as the OpenAPI tag. Kebab-case. */
    name: string;
    /** Register routes on `app`. Paths are relative to the API mount point. */
    build(app: Hono, toolkit: RouterToolkit): void;
    /**
     * OpenAPI path items for these routes, merged into the generated spec.
     *
     * Optional, but a route missing from the spec is invisible to every
     * consumer that reads it — including the platform's own app preview.
     */
    paths?: Record<string, unknown>;
}
/**
 * Declare a custom router. Purely declarative — nothing is built until
 * `createXenitionApi` mounts it, matching how `defineModule` behaves.
 */
export declare function defineRouter(definition: RouterDefinition): RouterDefinition;
/** Build one custom router into a mountable Hono app. */
export declare function buildCustomRouter(definition: RouterDefinition, options: XenitionRouterOptions): Hono;
//# sourceMappingURL=define-router.d.ts.map