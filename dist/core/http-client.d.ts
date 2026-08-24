import { AxiosRequestConfig } from 'axios';
import { XenitionError } from './errors';
/** Correlates one logical call across the SDK, the gateway and its logs. */
export declare const REQUEST_ID_HEADER = "x-request-id";
/** Lets the platform collapse a retried write into one effect. */
export declare const IDEMPOTENCY_HEADER = "idempotency-key";
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
    private readonly hooks;
    constructor(apiKey: string, options?: HttpClientOptions);
    setHeader(key: string, value: string): void;
    /**
     * The effective API base URL this client was constructed with (the
     * per-deploy override when given, otherwise XENITION_BASE_URL). Used by
     * the realtime module to derive the socket origin.
     */
    get baseUrl(): string;
    get<T>(url: string, config?: RequestOptions): Promise<T>;
    post<T>(url: string, body?: unknown, config?: RequestOptions): Promise<T>;
    patch<T>(url: string, body?: unknown, config?: RequestOptions): Promise<T>;
    put<T>(url: string, body?: unknown, config?: RequestOptions): Promise<T>;
    del<T>(url: string, config?: RequestOptions): Promise<T>;
    /**
     * Multipart form upload. Pass a form-data instance (Node) or a Web
     * FormData — axios handles both. Content-Type (including the boundary)
     * is set automatically; we strip our default JSON header so it isn't
     * sent alongside.
     */
    postForm<T>(url: string, form: unknown, config?: RequestOptions): Promise<T>;
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
    stream(url: string, body?: unknown, config?: RequestOptions): Promise<Response>;
    private request;
    /**
     * Hooks are observability, so a throwing hook must never become the
     * request's failure — that would make adding logging a way to break
     * production.
     */
    private observe;
    private newRequestId;
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