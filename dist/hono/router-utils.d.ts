import type { Hono } from 'hono';
/**
 * Small shared pieces for the routers: CORS wiring and query-string
 * parsing that reports precise 400 messages instead of coercing garbage.
 */
export declare function applyCors(app: Hono, option: boolean | string[] | undefined): void;
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