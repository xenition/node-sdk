import { Hono } from 'hono';
import type { XenitionApiModule } from './types';
import type { CorsOptions } from './router-utils';
/**
 * API docs for generated app backends — an OpenAPI 3.0 document assembled
 * from the SAME module list `createXenitionApi` mounts. OpenAPI only, by
 * decision: no bundled Swagger/redoc UI — consumers point their own tooling
 * at the spec. Mount `openApiRouter()` at the worker root:
 *
 *   app.route('/api', createXenitionApi({ modules: ['cms', 'forms'] }));
 *   app.route('/', openApiRouter({ modules: ['cms', 'forms'], info: { title: 'My App API' } }));
 *
 * and the worker serves the machine-readable spec at /openapi.json — zero
 * bespoke code in the template. The route descriptions below are maintained
 * ALONGSIDE the routers in this directory; when a router's surface changes,
 * update its entry here in the same commit.
 */
/** Options for `buildOpenApi` / `openApiRouter`. */
export interface DocsOptions {
    /** Which modules to document. Must match the `createXenitionApi` list. Defaults to all. */
    modules?: XenitionApiModule[];
    /**
     * The app's own routers. Their declared `paths` are merged in, so a
     * custom route is not invisible to everything that reads the spec.
     */
    custom?: Array<{
        name: string;
        paths?: Record<string, unknown>;
    }>;
    /** Where the API routers are mounted, prefixed onto every path. Defaults to '/api'. */
    basePath?: string;
    /** OpenAPI `info` overrides (title / version / description). */
    info?: {
        title?: string;
        version?: string;
        description?: string;
    };
}
type JsonObject = Record<string, unknown>;
/**
 * Assemble the OpenAPI 3.0 document for the selected modules. Paths are
 * prefixed with `basePath` (default '/api', matching the conventional
 * `app.route('/api', createXenitionApi(...))` mount).
 */
export declare function buildOpenApi(options?: DocsOptions): JsonObject;
/** CORS is the only router option that matters for a GET-only spec route. */
export interface OpenApiRouterOptions extends DocsOptions {
    /**
     * Same contract as every other router — see `XenitionRouterOptions.cors`.
     * Spelled with the shared type rather than a narrower copy, because a
     * second declaration of the same option is a second thing to forget when
     * the first one grows.
     */
    cors?: boolean | string[] | CorsOptions;
}
/**
 * A mountable spec router: GET /openapi.json — the OpenAPI document for the
 * mounted modules. Mount at the worker root so it lives next to /health.
 * OpenAPI only (no bundled docs UI) by decision.
 */
export declare function openApiRouter(options?: OpenApiRouterOptions): Hono;
export {};
//# sourceMappingURL=docs.d.ts.map