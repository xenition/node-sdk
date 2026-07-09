import { Hono } from 'hono';
import { makeClientResolver } from './client';
import { badRequest, honoErrorHandler, jsonNotFound } from './errors';
import { normalizeRow } from './normalize';
import { clientIp, rateLimiter } from './rate-limit';
import { applyCors } from './router-utils';
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
export function formsRouter(options: XenitionRouterOptions = {}): Hono {
  const resolve = makeClientResolver('forms', options.client);
  const app = new Hono();
  applyCors(app, options.cors);
  app.onError(honoErrorHandler);
  app.notFound(jsonNotFound);

  app.get('/:key', async (c) => {
    const forms = resolve(c).modules.forms;
    const form = await forms.getForm(c.req.param('key'));
    if (!form) return jsonNotFound(c);
    return c.json(normalizeRow(form));
  });

  // Attached to the POST route only — reads stay unmetered.
  if (options.rateLimit !== false) {
    app.post('/:key/submissions', rateLimiter(options.rateLimit ?? 10));
  }

  app.post('/:key/submissions', async (c) => {
    const forms = resolve(c).modules.forms;
    const body = await c.req.json().catch(() => undefined);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return badRequest(c, 'Request body must be a JSON object of field values.');
    }
    const submission = await forms.submit(c.req.param('key'), body as Record<string, unknown>, {
      ip: clientIp(c),
      userAgent: c.req.header('user-agent') ?? '',
    });
    return c.json({ id: submission.id }, 201);
  });

  return app;
}
