/**
 * Xenition SDK Constants — single source of truth for SDK configuration.
 *
 * The BASE_URL can be patched per-branch by
 * `scripts/patch-urls-for-public.sh`:
 *   - develop branch: `api-dev.xenition.com/v1`
 *   - main branch: URL rewritten to `api.xenition.com/v1`
 *
 * Generated apps pin the branch they want via package.json:
 *   "@xenition/sdk": "github:xenition/node-sdk#develop"  // dev
 *   "@xenition/sdk": "github:xenition/node-sdk"          // prod (main)
 */
export declare const XENITION_BASE_URL = "https://api.xenition.com/v1";
export declare const API_ENDPOINTS: {
    readonly AUTH: {
        readonly REGISTER: "/app-platform/auth/register";
        readonly LOGIN: "/app-platform/auth/login";
        readonly LOGOUT: "/app-platform/auth/logout";
        readonly ME: "/app-platform/auth/me";
        readonly UPDATE_PROFILE: "/app-platform/auth/profile";
        readonly USER_BY_ID: (id: string) => string;
        readonly LIST_USERS: "/app-platform/auth/users";
        readonly SEARCH_USERS: "/app-platform/auth/users/search";
        readonly PASSWORD_RESET_REQUEST: "/app-platform/auth/password-reset/request";
        readonly PASSWORD_RESET_CONFIRM: "/app-platform/auth/password-reset/confirm";
        readonly VERIFY_EMAIL: "/app-platform/auth/email/verify";
        readonly OAUTH_URL: (provider: string) => string;
        readonly OAUTH_CALLBACK: (provider: string) => string;
        readonly OAUTH_PROVIDERS: "/app-platform/auth/oauth/providers";
        readonly OAUTH_PROVIDER_CONFIG: (provider: string) => string;
        readonly TEAMS: "/app-platform/auth/teams";
        readonly TEAM_INVITE: (teamId: string) => string;
    };
    readonly QUERY: {
        readonly EXECUTE: "/app-platform/query";
        readonly COUNT: "/app-platform/query/count";
        readonly EXISTS: "/app-platform/query/exists";
        readonly RAW: "/app-platform/raw";
    };
    readonly STORAGE: {
        readonly UPLOAD: "/app-platform/storage/upload";
        readonly LIST: "/app-platform/storage/list";
        readonly SIGNED_URL: "/app-platform/storage/signed-url";
        readonly OBJECT: (bucket: string, path: string) => string;
    };
    readonly EMAIL: {
        readonly SEND: "/app-platform/email/send";
        readonly SEND_BULK: "/app-platform/email/send-bulk";
    };
    readonly PUSH: {
        readonly DEVICES: "/app-platform/push/devices";
        readonly DEVICE: (token: string) => string;
        readonly SEND: "/app-platform/push/send";
    };
    readonly AI: {
        readonly TEXT: "/app-platform/ai/text";
        readonly CHAT: "/app-platform/ai/chat";
        readonly IMAGE: "/app-platform/ai/image";
        readonly VIDEO: "/app-platform/ai/video";
        readonly EMBEDDINGS: "/app-platform/ai/embeddings";
        readonly KEYS: "/app-platform/ai/keys";
        readonly KEY: (id: string) => string;
    };
    readonly CHATBOT: {
        readonly SEND: "/app-platform/chatbot/send";
        readonly CONFIG: "/app-platform/chatbot/config";
        readonly DOCUMENTS: "/app-platform/chatbot/documents";
        readonly DOCUMENT: (id: string) => string;
        readonly DOCUMENT_URL: "/app-platform/chatbot/documents/url";
        readonly DOCUMENT_TEXT: "/app-platform/chatbot/documents/text";
        readonly HISTORY: (sessionId: string) => string;
    };
    readonly VECTOR: {
        readonly COLLECTIONS: "/app-platform/vector/collections";
        readonly COLLECTION: (name: string) => string;
        readonly UPSERT: (name: string) => string;
        readonly SEARCH: (name: string) => string;
        readonly DELETE_POINTS: (name: string) => string;
    };
    readonly SEARCH: {
        readonly UNIFIED: "/app-platform/search";
        readonly CONFIGURE: "/app-platform/search/configure";
        readonly CONFIGS: "/app-platform/search/configs";
        readonly INDEX: "/app-platform/search/index";
        readonly BULK_INDEX: "/app-platform/search/index/bulk";
    };
    readonly PAYMENT: {
        readonly CHECKOUT: "/app-platform/payment/checkout";
        readonly INVOICES: "/app-platform/payment/invoices";
        readonly INVOICE: (id: string) => string;
        readonly SUBSCRIPTIONS: "/app-platform/payment/subscriptions";
        readonly SUBSCRIPTION: (id: string) => string;
        readonly CANCEL_SUBSCRIPTION: (id: string) => string;
        readonly RESUME_SUBSCRIPTION: (id: string) => string;
        readonly CONFIG: "/app-platform/payment/config";
    };
    readonly VIDEO: {
        readonly ROOMS: "/app-platform/video/rooms";
        readonly ROOM: (name: string) => string;
        readonly ROOM_TOKEN: (name: string) => string;
        readonly RECORDING: (name: string) => string;
    };
    readonly REALTIME: {
        readonly PUBLISH: "/app-platform/realtime/publish";
        readonly WS_PATH: "/app-platform/realtime";
    };
};
//# sourceMappingURL=constants.d.ts.map