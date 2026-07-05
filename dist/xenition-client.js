"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.XenitionClient = void 0;
const http_client_1 = require("./core/http-client");
const auth_client_1 = require("./auth/auth-client");
const query_client_1 = require("./query/query-client");
const storage_client_1 = require("./storage/storage-client");
const email_client_1 = require("./email/email-client");
const push_client_1 = require("./push/push-client");
const ai_client_1 = require("./ai/ai-client");
const chatbot_client_1 = require("./chatbot/chatbot-client");
const vector_client_1 = require("./vector/vector-client");
const search_client_1 = require("./search/search-client");
const payment_client_1 = require("./payment/payment-client");
const video_client_1 = require("./video/video-client");
const realtime_client_1 = require("./realtime/realtime-client");
/**
 * Entry point for the Xenition SDK.
 *
 *   import { XenitionClient } from '@xenition/sdk';
 *   const client = new XenitionClient(process.env.XENITION_API_KEY);
 *   const { user, token } = await client.auth.login({ email, password });
 *
 * The SDK's only identity is the API key passed to the constructor:
 *
 *   - `xen_service_<hex>` — full-privilege server-side key. Keep on the
 *     backend; never ship to browsers.
 *   - `xen_anon_<hex>` — read-only / auth-only key. Safe to bundle into
 *     client code.
 *
 * The server resolves `app_id`, `key_type`, and the permission list
 * from the key. Never pass `organizationId` / `projectId` / `appId`
 * — those do not exist on xenition.
 *
 * Modules are lazily instantiated, sharing the single HttpClient. Add
 * new capabilities by adding a property to this class + a module file
 * under `src/<feature>/`.
 */
class XenitionClient {
    constructor(apiKey, options = {}) {
        if (!apiKey) {
            throw new Error('XenitionClient: API key is required. Get one from the xenition seller dashboard.');
        }
        if (!apiKey.startsWith('xen_service_') && !apiKey.startsWith('xen_anon_')) {
            // Permissive — just warn. The server will still reject unknown keys.
            // eslint-disable-next-line no-console
            console.warn('XenitionClient: API key should start with "xen_service_" or "xen_anon_".');
        }
        this.http = new http_client_1.HttpClient(apiKey, options);
        this.auth = new auth_client_1.AuthClient(this.http);
        this.query = new query_client_1.QueryClient(this.http);
        this.storage = new storage_client_1.StorageClient(this.http);
        this.email = new email_client_1.EmailClient(this.http);
        this.push = new push_client_1.PushClient(this.http);
        this.ai = new ai_client_1.AiClient(this.http);
        this.chatbot = new chatbot_client_1.ChatbotClient(this.http);
        this.vector = new vector_client_1.VectorClient(this.http);
        this.search = new search_client_1.SearchClient(this.http);
        this.payment = new payment_client_1.PaymentClient(this.http);
        this.videoConferencing = new video_client_1.VideoConferencingClient(this.http);
        this.realtime = new realtime_client_1.RealtimeClient(this.http, apiKey);
    }
    /**
     * Direct parameterized SQL against the per-app DB. Service-key only —
     * the server returns 403 for anon keys.
     */
    raw(sql, params = []) {
        return this.query.raw(sql, params);
    }
    /**
     * Escape hatch for adding custom headers (e.g. session token on a
     * subsequent request). Use sparingly — most flows should not need it.
     */
    setHeader(key, value) {
        this.http.setHeader(key, value);
    }
}
exports.XenitionClient = XenitionClient;
//# sourceMappingURL=xenition-client.js.map