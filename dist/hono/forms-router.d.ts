import { Hono } from 'hono';
import type { XenitionRouterOptions } from './types';
/**
 * Forms routes — the sanctioned write path for form submissions (the
 * platform bans anon-key writes, so browsers can't insert directly).
 *
 *   GET  /:key              → the form's field schema (for rendering)
 *   POST /:key/submissions  → body is the submission `data` object;
 *                             201 {id} on success, 400 with the SDK's
 *                             aggregated validation message on bad input.
 *
 * Submissions are rate limited per IP (best-effort — see rate-limit.ts).
 * The submission `meta` records ip + user-agent for back-office triage.
 */
export declare function formsRouter(options?: XenitionRouterOptions): Hono;
//# sourceMappingURL=forms-router.d.ts.map