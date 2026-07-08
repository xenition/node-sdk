import { AxiosRequestConfig } from 'axios';
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
export declare class HttpClient {
    private readonly axios;
    private readonly retries;
    constructor(apiKey: string, options?: HttpClientOptions);
    setHeader(key: string, value: string): void;
    /**
     * The effective API base URL this client was constructed with (the
     * per-deploy override when given, otherwise XENITION_BASE_URL). Used by
     * the realtime module to derive the socket origin.
     */
    get baseUrl(): string;
    get<T>(url: string, config?: AxiosRequestConfig): Promise<T>;
    post<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T>;
    patch<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T>;
    put<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T>;
    del<T>(url: string, config?: AxiosRequestConfig): Promise<T>;
    /**
     * Multipart form upload. Pass a form-data instance (Node) or a Web
     * FormData — axios handles both. Content-Type (including the boundary)
     * is set automatically; we strip our default JSON header so it isn't
     * sent alongside.
     */
    postForm<T>(url: string, form: unknown, config?: AxiosRequestConfig): Promise<T>;
    private request;
    /**
     * Server returns either a raw JSON object or the envelope:
     *   { success: true,  data: ... }
     *   { success: false, error: { code, message } }
     * Unwrap uniformly.
     */
    private unwrapEnvelope;
    private normalizeError;
    private classifyStatus;
    private shouldRetry;
    private sleep;
}
//# sourceMappingURL=http-client.d.ts.map