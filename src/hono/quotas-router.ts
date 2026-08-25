import { Hono } from 'hono';
import type { Context } from 'hono';
import type { QuotaPeriod, QuotaState, QuotasClient } from '../modules/quotas';
import { requireAuth, requireUser } from './auth';
import { makeClientResolver } from './client';
import { badRequest, honoErrorHandler, jsonNotFound, NotConfiguredError } from './errors';
import { applyCors } from './router-utils';
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

export function quotasRouter(options: QuotasRouterOptions = {}): Hono {
  const app = new Hono();
  applyCors(app, options.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  const resolveClient = makeClientResolver('quotas', options.client);
  const quotasOf = (c: Context): QuotasClient => resolveClient(c).modules.quotas;
  const auth = requireAuth({ client: options.client });
  const configured = options.quotas ?? {};
  const keys = Object.keys(configured);

  // No rate limiter: both routes are reads, and the write routes elsewhere
  // are metered because they cost something durable. A peek is one indexed
  // SELECT per key, and the keys are a fixed server-side list.

  app.get('/quotas', auth, async (c) => {
    requireConfigured(keys);
    const requested = c.req.query('keys');
    const wanted = requested
      ? requested
          .split(',')
          .map((key) => key.trim())
          .filter((key) => key !== '')
      : // No `keys` means "everything this app meters" — the natural
        // request for a usage screen that shows the whole plan.
        keys;

    const unknown = wanted.filter((key) => !(key in configured));
    if (unknown.length > 0) {
      return badRequest(
        c,
        `Unknown quota${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. ` +
          `This app meters ${keys.join(', ')}.`,
      );
    }

    const subject = requireUser(c).id;
    const quotas = quotasOf(c);
    const states = await Promise.all(wanted.map((key) => peek(quotas, subject, key, configured)));
    return c.json({ quotas: states });
  });

  app.get('/quotas/:key', auth, async (c) => {
    requireConfigured(keys);
    const key = c.req.param('key');
    if (!(key in configured)) {
      // A 404 rather than a 400: the caller asked for a resource this app
      // does not have, and the message names the ones it does so the fix
      // is obvious from the response alone.
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: `Unknown quota "${key}". This app meters ${keys.join(', ')}.`,
          },
        },
        404,
      );
    }
    return c.json(await peek(quotasOf(c), requireUser(c).id, key, configured));
  });

  return app;
}

/* ── helpers ───────────────────────────────────────────────────────────── */

/** `QuotaState` for one key, with the key on it so a list is self-describing. */
async function peek(
  quotas: QuotasClient,
  subject: string,
  key: string,
  configured: Record<string, QuotaDefinition>,
): Promise<QuotaState & { key: string }> {
  const definition = configured[key] as QuotaDefinition;
  // `peek`, never `consume` — see the note at the top of this file.
  const state = await quotas.peek(subject, key, {
    limit: definition.limit,
    period: definition.period ?? 'month',
  });
  // No `normalizeRow` here: `QuotaState` is built by the client rather than
  // read from a table, so it is already camelCase and normalizing it would
  // only suggest it came from a row.
  //
  // `{ key, ...state }` is deliberately the same shape `paymentRequired()`
  // embeds as its `quota` (see errors.ts), so the meter a screen draws and
  // the 402 that stops it carry identical fields — one renderer, not two.
  return { key, ...state };
}

function requireConfigured(keys: string[]): void {
  if (keys.length === 0) {
    throw new NotConfiguredError(
      'This app declares no quotas — pass them to quotasRouter({ quotas: { … } }) ' +
        '(or createXenitionApi), where the limits stay server-side.',
    );
  }
}
