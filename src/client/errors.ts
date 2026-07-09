/**
 * The one error type the browser client throws. It carries the HTTP status
 * and (when the backend sent one) the router's error `code` + message. The
 * routers already scrub keys/URLs out of 4xx messages and send generic text
 * for 5xx (see ../hono/errors.ts), so nothing internal leaks through here —
 * this class only re-surfaces what the server chose to say.
 */
export class AppClientError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = 'AppClientError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Build an `AppClientError` from a non-2xx `Response`, pulling the router's
 * `{ error: { code, message } }` body when present (POST validation 400s
 * carry the server's aggregated message this way). Never throws — a
 * non-JSON / empty body falls back to a status-only message.
 */
export async function errorFromResponse(res: Response): Promise<AppClientError> {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'error' in body) {
      const err = (body as { error?: unknown }).error;
      if (err && typeof err === 'object') {
        const c = (err as { code?: unknown }).code;
        const m = (err as { message?: unknown }).message;
        if (typeof c === 'string') code = c;
        if (typeof m === 'string') message = m;
      }
    }
  } catch {
    /* non-JSON body — fall back to a status-only message */
  }
  return new AppClientError(res.status, code, message);
}
