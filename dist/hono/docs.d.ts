import { Hono } from 'hono';
import type { XenitionApiModule } from './types';
/**
 * API docs for generated app backends — an OpenAPI 3.0 document assembled
 * from the SAME module list `createXenitionApi` mounts, plus a Swagger UI
 * shell that renders it. Mount `docsRouter()` at the worker root:
 *
 *   app.route('/api', createXenitionApi({ modules: ['cms', 'forms'] }));
 *   app.route('/', docsRouter({ modules: ['cms', 'forms'], info: { title: 'My App API' } }));
 *
 * and the worker serves machine-readable docs at /openapi.json and a
 * browsable UI at /docs — zero bespoke code in the template. The route
 * descriptions below are maintained ALONGSIDE the routers in this
 * directory; when a router's surface changes, update its entry here in the
 * same commit.
 */
/** Options for `buildOpenApi` / `docsRouter`. */
export interface DocsOptions {
    /** Which modules to document. Must match the `createXenitionApi` list. Defaults to all. */
    modules?: XenitionApiModule[];
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
/** CORS is the only router option that matters for two GET-only doc routes. */
export interface DocsRouterOptions extends DocsOptions {
    /** Same contract as every other router: `true` (default) | allowlist | `false`. */
    cors?: boolean | string[];
}
/**
 * A mountable docs router: GET /openapi.json (the spec) + GET /docs
 * (Swagger UI). Mount at the worker root so the docs live next to /health.
 */
export declare function docsRouter(options?: DocsRouterOptions): Hono;
export {};
//# sourceMappingURL=docs.d.ts.map