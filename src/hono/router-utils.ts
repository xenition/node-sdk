import type { Hono } from 'hono';
import { cors } from 'hono/cors';

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

/** Every method the SDK's own routers answer with. */
const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

/**
 * Headers every client already sends. `Authorization` is the load-bearing
 * one — without it no authenticated request survives a preflight.
 */
const DEFAULT_HEADERS = ['Content-Type', 'Authorization'];

const unique = (values: string[]): string[] => [...new Set(values)];

export function applyCors(
  app: Hono,
  option: boolean | string[] | CorsOptions | undefined,
): void {
  if (option === false) return;

  const config: CorsOptions =
    option === true || option === undefined
      ? {}
      : Array.isArray(option)
        ? { origin: option }
        : option;

  // `credentials` and a wildcard origin are mutually exclusive by spec, and a
  // browser rejects the pair silently — which reads as "CORS is broken"
  // rather than "this combination is not allowed".
  if (config.credentials && (config.origin === undefined || config.origin === '*')) {
    throw new Error(
      'cors: `credentials: true` requires an explicit origin allowlist — a browser ' +
        'refuses credentialed requests against `Access-Control-Allow-Origin: *`.',
    );
  }

  app.use(
    '*',
    cors({
      origin: config.origin ?? '*',
      allowMethods: unique([...DEFAULT_METHODS, ...(config.allowMethods ?? [])]),
      allowHeaders: unique([...DEFAULT_HEADERS, ...(config.allowHeaders ?? [])]),
      ...(config.exposeHeaders ? { exposeHeaders: config.exposeHeaders } : {}),
      ...(config.credentials ? { credentials: true } : {}),
      maxAge: config.maxAge ?? 600,
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

/**
 * Optional boolean query flag: `1`/`true` → true, `0`/`false` → false,
 * absent → undefined (no filter). Anything else is a 400.
 */
export function parseBooleanFlag(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  throw new QueryParamError(`"${name}" must be one of 1, 0, true, false — got "${value}"`);
}

/** Sort direction: case-insensitive ASC/DESC, or undefined when absent. */
export function parseDirection(value: string | undefined): 'ASC' | 'DESC' | undefined {
  if (value === undefined || value === '') return undefined;
  const upper = value.toUpperCase();
  if (upper === 'ASC' || upper === 'DESC') return upper;
  throw new QueryParamError(`"direction" must be ASC or DESC — got "${value}"`);
}
