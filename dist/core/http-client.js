"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpClient = void 0;
const axios_1 = __importDefault(require("axios"));
const constants_1 = require("../constants");
const errors_1 = require("./errors");
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
    get(url, config) {
        return this.request({ ...config, method: 'GET', url });
    }
    post(url, body, config) {
        return this.request({ ...config, method: 'POST', url, data: body });
    }
    patch(url, body, config) {
        return this.request({ ...config, method: 'PATCH', url, data: body });
    }
    put(url, body, config) {
        return this.request({ ...config, method: 'PUT', url, data: body });
    }
    del(url, config) {
        return this.request({ ...config, method: 'DELETE', url });
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
        const merged = {
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
        return this.request(merged);
    }
    // ────────── Internals ────────────────────────────────────────────────────
    async request(config) {
        const retriable = (config.method ?? 'GET').toUpperCase() === 'GET';
        let lastErr;
        const maxAttempts = retriable ? 1 + this.retries : 1;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const response = await this.axios.request(config);
                return this.unwrapEnvelope(response.data);
            }
            catch (err) {
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
    unwrapEnvelope(body) {
        if (body && typeof body === 'object' && 'success' in body) {
            const env = body;
            if (env.success === false) {
                const code = env.error?.code ?? 'UNKNOWN';
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
        if (serverCode && this.isValidCode(serverCode)) {
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
    isValidCode(code) {
        // Any string matching the XenitionErrorCode pattern; we accept anything
        // and let type narrowing surface unexpected codes during development.
        return typeof code === 'string' && code.length > 0;
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