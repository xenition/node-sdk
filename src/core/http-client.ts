import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { XENITION_BASE_URL } from '../constants';
import { XenitionError, XenitionErrorCode, isXenitionErrorCode } from './errors';

export interface HttpClientOptions {
  timeout?: number;
  retries?: number;
  headers?: Record<string, string>;
  /**
   * Override the API base URL for this client (e.g. a per-deploy platform
   * URL injected at deploy time). Falls back to XENITION_BASE_URL.
   */
  baseUrl?: string;
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

  constructor(apiKey: string, options: HttpClientOptions = {}) {
    this.retries = options.retries ?? 2;
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

  get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  post<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'POST', url, data: body });
  }

  patch<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'PATCH', url, data: body });
  }

  put<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'PUT', url, data: body });
  }

  del<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'DELETE', url });
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
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const maybeHeaders =
      typeof (form as { getHeaders?: () => Record<string, string> }).getHeaders === 'function'
        ? (form as { getHeaders: () => Record<string, string> }).getHeaders()
        : undefined;
    const merged: AxiosRequestConfig = {
      ...config,
      method: 'POST',
      url,
      data: form,
      headers: {
        ...(maybeHeaders ?? {}),
        ...(config?.headers ?? {}),
        // Override the default application/json so the boundary sticks.
        'Content-Type': maybeHeaders?.['content-type'] ?? 'multipart/form-data',
      },
    };
    return this.request<T>(merged);
  }

  // ────────── Internals ────────────────────────────────────────────────────

  private async request<T>(config: AxiosRequestConfig): Promise<T> {
    const retriable = (config.method ?? 'GET').toUpperCase() === 'GET';
    let lastErr: unknown;
    const maxAttempts = retriable ? 1 + this.retries : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.axios.request(config);
        return this.unwrapEnvelope<T>(response.data);
      } catch (err) {
        lastErr = err;
        const xenitionErr = this.normalizeError(err);
        if (!this.shouldRetry(xenitionErr) || attempt === maxAttempts - 1) {
          throw xenitionErr;
        }
        await this.sleep(Math.min(100 * Math.pow(2, attempt), 2000));
      }
    }
    // Unreachable; TypeScript wants it.
    throw this.normalizeError(lastErr);
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
