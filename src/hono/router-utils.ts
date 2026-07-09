import type { Hono } from 'hono';
import { cors } from 'hono/cors';

/**
 * Small shared pieces for the routers: CORS wiring and query-string
 * parsing that reports precise 400 messages instead of coercing garbage.
 */

export function applyCors(app: Hono, option: boolean | string[] | undefined): void {
  if (option === false) return;
  const origin = option === true || option === undefined ? '*' : option;
  app.use(
    '*',
    cors({
      origin,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 600,
    }),
  );
}

/** Thrown by the parse helpers; routers convert it to a 400. */
export class QueryParamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryParamError';
  }
}

/** Non-negative integer query param, or undefined when absent. */
export function parseNonNegativeInt(name: string, value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new QueryParamError(`"${name}" must be a non-negative integer, got "${value}"`);
  }
  return n;
}

/**
 * `published` filter for the public list route. These routers run with the
 * SERVICE key on a public surface, so the safe default is published-only:
 *   - omitted / '1' / 'true'  → true
 *   - '0' / 'false'           → false (drafts — same visibility the anon
 *                                key already has for reads)
 *   - 'all'                   → undefined (no filter)
 */
export function parsePublished(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '' || value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  if (value === 'all') return undefined;
  throw new QueryParamError(`"published" must be one of 1, 0, true, false, all — got "${value}"`);
}

/** Sort direction: case-insensitive ASC/DESC, or undefined when absent. */
export function parseDirection(value: string | undefined): 'ASC' | 'DESC' | undefined {
  if (value === undefined || value === '') return undefined;
  const upper = value.toUpperCase();
  if (upper === 'ASC' || upper === 'DESC') return upper;
  throw new QueryParamError(`"direction" must be ASC or DESC — got "${value}"`);
}
