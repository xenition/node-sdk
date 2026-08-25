import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { XENITION_BASE_URL } from '../constants';
import { XenitionError, XenitionErrorCode, isXenitionErrorCode } from './errors';

/** Correlates one logical call across the SDK, the gateway and its logs. */
export const REQUEST_ID_HEADER = 'x-request-id';
/** Lets the platform collapse a retried write into one effect. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** What the observability hooks are handed. */
export interface RequestEvent {
  method: string;
  url: string;
  requestId: string;
  /** 0 for the first try. */
  attempt: number;
}

export interface ResponseEvent extends RequestEvent {
  status: number;
  durationMs: number;
}

export interface RequestErrorEvent extends RequestEvent {
  durationMs: number;
  error: XenitionError;
  /** True when another attempt follows — so logs do not read as N failures. */
  willRetry: boolean;
}

export interface HttpClientOptions {
  timeout?: number;
  retries?: number;
  headers?: Record<string, string>;
  /**
   * Override the API base URL for this client (e.g. a per-deploy platform
   * URL injected at deploy time). Falls back to XENITION_BASE_URL.
   */
  baseUrl?: string;
  /**
   * Observability hooks. A worker has no console anyone reads, so without
   * these a misbehaving generated app offers nothing to look at.
   *
   * They are advisory: a hook that throws is swallowed, because adding
   * logging must never become a way to break production.
   */
  onRequest?(event: RequestEvent): void;
  onResponse?(event: ResponseEvent): void;
  onError?(event: RequestErrorEvent): void;
}

/** Request config plus the SDK's own per-request options. */
export interface RequestOptions extends AxiosRequestConfig {
  /**
   * Marks this write as safe to repeat.
   *
   * Two effects: the platform can collapse duplicate deliveries into one,
   * and the SDK will RETRY this request on a transient failure — which it
   * refuses to do for an unkeyed write, because a timeout is exactly the
   * case where the first attempt may already have succeeded.
   *
   * Use a key derived from the operation, not a fresh random one per
   * attempt: `order-${orderId}`, not `crypto.randomUUID()` inside the retry
   * loop.
   */
  idempotencyKey?: string;
}

/**
 * Move `idempotencyKey` out of the SDK's options and into the header the
 * platform reads, so nothing downstream has to know both spellings.
 */
function withIdempotency(config?: RequestOptions): AxiosRequestConfig {
  if (!config) return {};
  const { idempotencyKey, ...rest } = config;
  if (!idempotencyKey) return rest;
  return {
    ...rest,
    headers: { ...(rest.headers as Record<string, string> | undefined), [IDEMPOTENCY_HEADER]: idempotencyKey },
  };
}

/**
 * Thin axios wrapper used by every SDK module.
 *
 *   - Attaches `x-api-key` on every request (the key the client was
 *     constructed with — encodes app_id + key_type server-side).
 *   - Normalizes the server's `{success, data, error: {code, message}}`
 *     envelope into a plain `data` return (throws a typed XenitionError
 *     on `success: false`).
 *   - Retries idempotent requests on transient failures (network /
 *     5xx) with capped exponential backoff.
 *
 * SDK modules never touch axios directly — they use `get/post/patch/del`
 * on this class so error + envelope handling stays in one place.
 */
export class HttpClient {
  private readonly axios: AxiosInstance;
  private readonly retries: number;
  private readonly hooks: Pick<HttpClientOptions, 'onRequest' | 'onResponse' | 'onError'>;

  constructor(apiKey: string, options: HttpClientOptions = {}) {
    this.retries = options.retries ?? 2;
    this.hooks = {
      onRequest: options.onRequest,
      onResponse: options.onResponse,
      onError: options.onError,
    };
    this.axios = axios.create({
      baseURL: options.baseUrl || XENITION_BASE_URL,
      timeout: options.timeout ?? 30_000,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        ...options.headers,
      },
    });
  }

  setHeader(key: string, value: string): void {
    this.axios.defaults.headers.common[key] = value;
  }

  /**
   * The effective API base URL this client was constructed with (the
   * per-deploy override when given, otherwise XENITION_BASE_URL). Used by
   * the realtime module to derive the socket origin.
   */
  get baseUrl(): string {
    return this.axios.defaults.baseURL || XENITION_BASE_URL;
  }

  get<T>(url: string, config?: RequestOptions): Promise<T> {
    return this.request<T>({ ...withIdempotency(config), method: 'GET', url });
  }

  post<T>(url: string, body?: unknown, config?: RequestOptions): Promise<T> {
    return this.request<T>({ ...withIdempotency(config), method: 'POST', url, data: body });
  }

  patch<T>(url: string, body?: unknown, config?: RequestOptions): Promise<T> {
    return this.request<T>({ ...withIdempotency(config), method: 'PATCH', url, data: body });
  }

  put<T>(url: string, body?: unknown, config?: RequestOptions): Promise<T> {
    return this.request<T>({ ...withIdempotency(config), method: 'PUT', url, data: body });
  }

  del<T>(url: string, config?: RequestOptions): Promise<T> {
    return this.request<T>({ ...withIdempotency(config), method: 'DELETE', url });
  }

  /**
   * Multipart form upload. Pass a form-data instance (Node) or a Web
   * FormData — axios handles both. Content-Type (including the boundary)
   * is set automatically; we strip our default JSON header so it isn't
   * sent alongside.
   */
  postForm<T>(
    url: string,
    form: unknown,
    config?: RequestOptions,
  ): Promise<T> {
    const maybeHeaders =
      typeof (form as { getHeaders?: () => Record<string, string> }).getHeaders === 'function'
        ? (form as { getHeaders: () => Record<string, string> }).getHeaders()
        : undefined;
    const lifted = withIdempotency(config);
    const merged: AxiosRequestConfig = {
      ...lifted,
      method: 'POST',
      url,
      data: form,
      headers: {
        ...(maybeHeaders ?? {}),
        ...((lifted.headers ?? {}) as Record<string, string>),
        // Override the default application/json so the boundary sticks.
        'Content-Type': maybeHeaders?.['content-type'] ?? 'multipart/form-data',
      },
    };
    return this.request<T>(merged);
  }

  /**
   * POST and hand back the raw `Response`, body unread.
   *
   * The one call that deliberately bypasses axios and the envelope. Both
   * exist to give callers a finished value, which is exactly wrong for a
   * stream: by the time axios resolves, the body it was supposed to deliver
   * incrementally has already been buffered.
   *
   * The caller owns the body and must consume or cancel it. Errors are still
   * normalized, so a failed stream throws the same `XenitionError` shape as
   * everything else rather than a bare Response.
   */
  async stream(url: string, body?: unknown, config: RequestOptions = {}): Promise<Response> {
    const fetchImpl = globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new XenitionError(
        'NETWORK_ERROR',
        'HttpClient.stream: no global fetch available in this runtime.',
      );
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      [REQUEST_ID_HEADER]: this.newRequestId(),
      ...(this.axios.defaults.headers.common as Record<string, string>),
      ...((config.headers ?? {}) as Record<string, string>),
    };
    const apiKey = this.axios.defaults.headers['x-api-key'];
    if (typeof apiKey === 'string') headers['x-api-key'] = apiKey;

    const response = await fetchImpl(`${this.baseUrl}${url}`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new XenitionError(
        this.classifyStatus(response.status),
        detail ? detail.slice(0, 300) : `Request failed with ${response.status}`,
        { status: response.status },
      );
    }
    return response;
  }

  // ────────── Internals ────────────────────────────────────────────────────

  private async request<T>(config: AxiosRequestConfig): Promise<T> {
    const method = (config.method ?? 'GET').toUpperCase();
    const url = config.url ?? '';
    const headers = (config.headers ?? {}) as Record<string, unknown>;
    const requestId = String(headers[REQUEST_ID_HEADER] ?? this.newRequestId());
    const idempotencyKey = headers[IDEMPOTENCY_HEADER];

    const merged: AxiosRequestConfig = {
      ...config,
      headers: { ...headers, [REQUEST_ID_HEADER]: requestId },
    };

    // A GET is retriable because it changes nothing. A write is retriable
    // ONLY when it carries an idempotency key: without one, a retry after a
    // timeout can apply the same change twice — and a timeout is exactly the
    // case where the first attempt may well have succeeded.
    const retriable = method === 'GET' || typeof idempotencyKey === 'string';
    const maxAttempts = retriable ? 1 + this.retries : 1;
    let lastErr: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const startedAt = Date.now();
      this.observe('onRequest', { method, url, requestId, attempt });
      try {
        const response = await this.axios.request(merged);
        this.observe('onResponse', {
          method,
          url,
          requestId,
          attempt,
          status: response.status,
          durationMs: Date.now() - startedAt,
        });
        return this.unwrapEnvelope<T>(response.data);
      } catch (err) {
        lastErr = err;
        const xenitionErr = this.normalizeError(err);
        const willRetry = this.shouldRetry(xenitionErr) && attempt < maxAttempts - 1;
        this.observe('onError', {
          method,
          url,
          requestId,
          attempt,
          durationMs: Date.now() - startedAt,
          error: xenitionErr,
          willRetry,
        });
        if (!willRetry) throw xenitionErr;
        await this.sleep(Math.min(100 * Math.pow(2, attempt), 2000));
      }
    }
    // Unreachable; TypeScript wants it.
    throw this.normalizeError(lastErr);
  }

  /**
   * Hooks are observability, so a throwing hook must never become the
   * request's failure — that would make adding logging a way to break
   * production.
   */
  private observe<K extends 'onRequest' | 'onResponse' | 'onError'>(
    hook: K,
    event: Parameters<NonNullable<HttpClientOptions[K]>>[0],
  ): void {
    const handler = this.hooks[hook] as ((e: unknown) => void) | undefined;
    if (!handler) return;
    try {
      handler(event);
    } catch {
      /* ignored on purpose */
    }
  }

  private newRequestId(): string {
    const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    return webCrypto?.randomUUID ? webCrypto.randomUUID() : `req_${Date.now().toString(36)}`;
  }

  /**
   * Server returns either a raw JSON object or the envelope:
   *   { success: true,  data: ... }
   *   { success: false, error: { code, message } }
   * Unwrap uniformly.
   */
  private unwrapEnvelope<T>(body: unknown): T {
    if (body && typeof body === 'object' && 'success' in body) {
      const env = body as {
        success: boolean;
        data?: T;
        error?: { code?: string; message?: string };
      };
      if (env.success === false) {
        // No HTTP status here (2xx body with success:false), so unknown
        // server codes fall back to 'UNKNOWN'. The raw code survives in
        // `details` (the whole error object) either way.
        const rawCode = env.error?.code;
        const code: XenitionErrorCode = isXenitionErrorCode(rawCode)
          ? rawCode
          : 'UNKNOWN';
        const message = env.error?.message ?? 'Request failed';
        throw new XenitionError(code, message, { details: env.error });
      }
      return env.data as T;
    }
    return body as T;
  }

  private normalizeError(err: unknown): XenitionError {
    if (err instanceof XenitionError) return err;
    if (axios.isAxiosError(err)) {
      const axErr = err as AxiosError<{
        success?: boolean;
        error?: { code?: string; message?: string };
      }>;
      const status = axErr.response?.status ?? null;
      const envelope = axErr.response?.data;
      const code = this.classifyStatus(status, envelope?.error?.code);
      const message =
        envelope?.error?.message ??
        axErr.message ??
        'Request failed';
      return new XenitionError(code, message, { status, details: envelope });
    }
    if (err instanceof Error) {
      return new XenitionError('UNKNOWN', err.message);
    }
    return new XenitionError('UNKNOWN', 'Unknown error', { details: err });
  }

  private classifyStatus(
    status: number | null,
    serverCode?: string,
  ): XenitionErrorCode {
    // Only accept codes that are actually in the XenitionErrorCode union —
    // unknown server codes fall through to status-based classification.
    // The raw server code is not lost: normalizeError stores the full
    // response envelope (including `error.code`) in the error's `details`.
    if (isXenitionErrorCode(serverCode)) {
      return serverCode;
    }
    if (status === null) return 'NETWORK_ERROR';
    if (status === 400) return 'VALIDATION_ERROR';
    if (status === 401) return 'AUTH_INVALID_TOKEN';
    if (status === 403) return 'AUTH_FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'CONFLICT';
    if (status === 429) return 'RATE_LIMITED';
    if (status >= 500) return 'SERVER_ERROR';
    return 'UNKNOWN';
  }

  private shouldRetry(err: XenitionError): boolean {
    return (
      err.code === 'NETWORK_ERROR' ||
      err.code === 'TIMEOUT' ||
      err.code === 'SERVER_ERROR'
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
