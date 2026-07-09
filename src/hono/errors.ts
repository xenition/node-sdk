import type { Context } from 'hono';
import { XenitionError, XenitionErrorCode } from '../core/errors';
import { XenitionApiConfigError } from './client';

/**
 * Error → HTTP response mapping for the routers.
 *
 * Rules:
 *   - XenitionError codes map to proper statuses (below).
 *   - Client-caused 4xx bodies keep the (scrubbed) message — that's the
 *     SDK's aggregated validation text frontends surface to users.
 *   - Upstream/internal 5xx bodies are GENERIC: never the raw message,
 *     never a key, never an upstream URL.
 */

type ErrorStatus = 400 | 404 | 409 | 429 | 500 | 502 | 504;

const GENERIC_UPSTREAM = 'Upstream request failed.';
const GENERIC_INTERNAL = 'Internal error.';

/** Belt-and-braces: strip anything key- or URL-shaped from 4xx messages. */
export function scrubMessage(message: string): string {
  return message
    .replace(/xen_(?:service|anon)_[A-Za-z0-9]+/g, '[redacted]')
    .replace(/https?:\/\/[^\s"')]+/gi, '[redacted]');
}

function statusForCode(code: XenitionErrorCode): ErrorStatus {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 400;
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
      return 409;
    case 'RATE_LIMITED':
      return 429;
    case 'TIMEOUT':
      return 504;
    case 'NETWORK_ERROR':
    case 'SERVER_ERROR':
      return 502;
    default:
      // AUTH_* here means the worker's own service key was rejected —
      // an upstream/config problem, not the browser caller's fault.
      return code.startsWith('AUTH_') ? 502 : 500;
  }
}

/**
 * Plain `Error`s thrown by the module clients' own validation
 * (`fail(context, …)` → "FormsClient.submit: …"). These are client-input
 * problems, not bugs, so they become 400s — except "unknown form/
 * collection", which is a 404.
 */
const SDK_VALIDATION_RE = /^[A-Z][A-Za-z]*Client\.[A-Za-z]+: /;
const SDK_NOT_FOUND_RE = /unknown (form|collection) /;

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

/** Shared `app.onError` handler — see module doc for the mapping rules. */
export function honoErrorHandler(err: Error | unknown, c: Context): Response {
  if (err instanceof XenitionError) {
    const status = statusForCode(err.code);
    const message = status < 500 ? scrubMessage(err.message) : GENERIC_UPSTREAM;
    return c.json(errorBody(err.code, message), status);
  }
  if (err instanceof XenitionApiConfigError) {
    // Operator-facing and contains no secrets by construction.
    return c.json(errorBody('CONFIG_ERROR', err.message), 500);
  }
  if (err instanceof Error && SDK_VALIDATION_RE.test(err.message)) {
    const notFound = SDK_NOT_FOUND_RE.test(err.message);
    return c.json(
      errorBody(notFound ? 'NOT_FOUND' : 'VALIDATION_ERROR', scrubMessage(err.message)),
      notFound ? 404 : 400,
    );
  }
  return c.json(errorBody('INTERNAL', GENERIC_INTERNAL), 500);
}

/** JSON 404 for unmatched routes (hono's default is text/plain). */
export function jsonNotFound(c: Context): Response {
  return c.json(errorBody('NOT_FOUND', 'Route not found.'), 404);
}

/** 400 helper for router-level input validation (query params, body shape). */
export function badRequest(c: Context, message: string): Response {
  return c.json(errorBody('VALIDATION_ERROR', message), 400);
}
