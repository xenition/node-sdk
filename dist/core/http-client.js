"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpClient = exports.IDEMPOTENCY_HEADER = exports.REQUEST_ID_HEADER = void 0;
const axios_1 = __importDefault(require("axios"));
const constants_1 = require("../constants");
const errors_1 = require("./errors");
/** Correlates one logical call across the SDK, the gateway and its logs. */
exports.REQUEST_ID_HEADER = 'x-request-id';
/** Lets the platform collapse a retried write into one effect. */
exports.IDEMPOTENCY_HEADER = 'idempotency-key';
/**
 * Move `idempotencyKey` out of the SDK's options and into the header the
 * platform reads, so nothing downstream has to know both spellings.
 */
function withIdempotency(config) {
    if (!config)
        return {};
    const { idempotencyKey, ...rest } = config;
    if (!idempotencyKey)
        return rest;
    return {
        ...rest,
        headers: { ...rest.headers, [exports.IDEMPOTENCY_HEADER]: idempotencyKey },
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
class HttpClient {
    constructor(apiKey, options = {}) {
        this.retries = options.retries ?? 2;
        this.hooks = {
            onRequest: options.onRequest,
            onResponse: options.onResponse,
            onError: options.onError,
        };
        this.axios = axios_1.default.create({
            baseURL: options.baseUrl || constants_1.XENITION_BASE_URL,
            timeout: options.timeout ?? 30000,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                ...options.headers,
            },
        });
    }
    setHeader(key, value) {
        this.axios.defaults.headers.common[key] = value;
    }
    /**
     * The effective API base URL this client was constructed with (the
     * per-deploy override when given, otherwise XENITION_BASE_URL). Used by
     * the realtime module to derive the socket origin.
     */
    get baseUrl() {
        return this.axios.defaults.baseURL || constants_1.XENITION_BASE_URL;
    }
    get(url, config) {
        return this.request({ ...withIdempotency(config), method: 'GET', url });
    }
    post(url, body, config) {
        return this.request({ ...withIdempotency(config), method: 'POST', url, data: body });
    }
    patch(url, body, config) {
        return this.request({ ...withIdempotency(config), method: 'PATCH', url, data: body });
    }
    put(url, body, config) {
        return this.request({ ...withIdempotency(config), method: 'PUT', url, data: body });
    }
    del(url, config) {
        return this.request({ ...withIdempotency(config), method: 'DELETE', url });
    }
    /**
     * Multipart form upload. Pass a form-data instance (Node) or a Web
     * FormData — axios handles both. Content-Type (including the boundary)
     * is set automatically; we strip our default JSON header so it isn't
     * sent alongside.
     */
    postForm(url, form, config) {
        const maybeHeaders = typeof form.getHeaders === 'function'
            ? form.getHeaders()
            : undefined;
        const lifted = withIdempotency(config);
        const merged = {
            ...lifted,
            method: 'POST',
            url,
            data: form,
            headers: {
                ...(maybeHeaders ?? {}),
                ...(lifted.headers ?? {}),
                // Override the default application/json so the boundary sticks.
                'Content-Type': maybeHeaders?.['content-type'] ?? 'multipart/form-data',
            },
        };
        return this.request(merged);
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
    async stream(url, body, config = {}) {
        const fetchImpl = globalThis.fetch;
        if (typeof fetchImpl !== 'function') {
            throw new errors_1.XenitionError('NETWORK_ERROR', 'HttpClient.stream: no global fetch available in this runtime.');
        }
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            [exports.REQUEST_ID_HEADER]: this.newRequestId(),
            ...this.axios.defaults.headers.common,
            ...(config.headers ?? {}),
        };
        const apiKey = this.axios.defaults.headers['x-api-key'];
        if (typeof apiKey === 'string')
            headers['x-api-key'] = apiKey;
        const response = await fetchImpl(`${this.baseUrl}${url}`, {
            method: 'POST',
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new errors_1.XenitionError(this.classifyStatus(response.status), detail ? detail.slice(0, 300) : `Request failed with ${response.status}`, { status: response.status });
        }
        return response;
    }
    // ────────── Internals ────────────────────────────────────────────────────
    async request(config) {
        const method = (config.method ?? 'GET').toUpperCase();
        const url = config.url ?? '';
        const headers = (config.headers ?? {});
        const requestId = String(headers[exports.REQUEST_ID_HEADER] ?? this.newRequestId());
        const idempotencyKey = headers[exports.IDEMPOTENCY_HEADER];
        const merged = {
            ...config,
            headers: { ...headers, [exports.REQUEST_ID_HEADER]: requestId },
        };
        // A GET is retriable because it changes nothing. A write is retriable
        // ONLY when it carries an idempotency key: without one, a retry after a
        // timeout can apply the same change twice — and a timeout is exactly the
        // case where the first attempt may well have succeeded.
        const retriable = method === 'GET' || typeof idempotencyKey === 'string';
        const maxAttempts = retriable ? 1 + this.retries : 1;
        let lastErr;
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
                return this.unwrapEnvelope(response.data);
            }
            catch (err) {
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
                if (!willRetry)
                    throw xenitionErr;
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
    observe(hook, event) {
        const handler = this.hooks[hook];
        if (!handler)
            return;
        try {
            handler(event);
        }
        catch {
            /* ignored on purpose */
        }
    }
    newRequestId() {
        const webCrypto = globalThis.crypto;
        return webCrypto?.randomUUID ? webCrypto.randomUUID() : `req_${Date.now().toString(36)}`;
    }
    /**
     * Server returns either a raw JSON object or the envelope:
     *   { success: true,  data: ... }
     *   { success: false, error: { code, message } }
     * Unwrap uniformly.
     */
    unwrapEnvelope(body) {
        if (body && typeof body === 'object' && 'success' in body) {
            const env = body;
            if (env.success === false) {
                // No HTTP status here (2xx body with success:false), so unknown
                // server codes fall back to 'UNKNOWN'. The raw code survives in
                // `details` (the whole error object) either way.
                const rawCode = env.error?.code;
                const code = (0, errors_1.isXenitionErrorCode)(rawCode)
                    ? rawCode
                    : 'UNKNOWN';
                const message = env.error?.message ?? 'Request failed';
                throw new errors_1.XenitionError(code, message, { details: env.error });
            }
            return env.data;
        }
        return body;
    }
    normalizeError(err) {
        if (err instanceof errors_1.XenitionError)
            return err;
        if (axios_1.default.isAxiosError(err)) {
            const axErr = err;
            const status = axErr.response?.status ?? null;
            const envelope = axErr.response?.data;
            const code = this.classifyStatus(status, envelope?.error?.code);
            const message = envelope?.error?.message ??
                axErr.message ??
                'Request failed';
            return new errors_1.XenitionError(code, message, { status, details: envelope });
        }
        if (err instanceof Error) {
            return new errors_1.XenitionError('UNKNOWN', err.message);
        }
        return new errors_1.XenitionError('UNKNOWN', 'Unknown error', { details: err });
    }
    classifyStatus(status, serverCode) {
        // Only accept codes that are actually in the XenitionErrorCode union —
        // unknown server codes fall through to status-based classification.
        // The raw server code is not lost: normalizeError stores the full
        // response envelope (including `error.code`) in the error's `details`.
        if ((0, errors_1.isXenitionErrorCode)(serverCode)) {
            return serverCode;
        }
        if (status === null)
            return 'NETWORK_ERROR';
        if (status === 400)
            return 'VALIDATION_ERROR';
        if (status === 401)
            return 'AUTH_INVALID_TOKEN';
        if (status === 403)
            return 'AUTH_FORBIDDEN';
        if (status === 404)
            return 'NOT_FOUND';
        if (status === 409)
            return 'CONFLICT';
        if (status === 429)
            return 'RATE_LIMITED';
        if (status >= 500)
            return 'SERVER_ERROR';
        return 'UNKNOWN';
    }
    shouldRetry(err) {
        return (err.code === 'NETWORK_ERROR' ||
            err.code === 'TIMEOUT' ||
            err.code === 'SERVER_ERROR');
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
exports.HttpClient = HttpClient;
//# sourceMappingURL=http-client.js.map