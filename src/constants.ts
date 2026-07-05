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

export const XENITION_BASE_URL = 'https://api.xenition.com/v1';

export const API_ENDPOINTS = {
  AUTH: {
    REGISTER:               '/app-platform/auth/register',
    LOGIN:                  '/app-platform/auth/login',
    LOGOUT:                 '/app-platform/auth/logout',
    ME:                     '/app-platform/auth/me',
    UPDATE_PROFILE:         '/app-platform/auth/profile',
    USER_BY_ID:             (id: string) => `/app-platform/auth/users/${id}`,
    LIST_USERS:             '/app-platform/auth/users',
    SEARCH_USERS:           '/app-platform/auth/users/search',
    PASSWORD_RESET_REQUEST: '/app-platform/auth/password-reset/request',
    PASSWORD_RESET_CONFIRM: '/app-platform/auth/password-reset/confirm',
    VERIFY_EMAIL:           '/app-platform/auth/email/verify',
    OAUTH_URL:              (provider: string) => `/app-platform/auth/oauth/${provider}/url`,
    OAUTH_CALLBACK:         (provider: string) => `/app-platform/auth/oauth/${provider}/callback`,
    OAUTH_PROVIDERS:        '/app-platform/auth/oauth/providers',
    OAUTH_PROVIDER_CONFIG:  (provider: string) => `/app-platform/auth/oauth/${provider}/config`,
    TEAMS:                  '/app-platform/auth/teams',
    TEAM_INVITE:            (teamId: string) => `/app-platform/auth/teams/${teamId}/invite`,
  },
  QUERY: {
    EXECUTE: '/app-platform/query',
    COUNT:   '/app-platform/query/count',
    EXISTS:  '/app-platform/query/exists',
    RAW:     '/app-platform/raw',
  },
  STORAGE: {
    UPLOAD:     '/app-platform/storage/upload',
    LIST:       '/app-platform/storage/list',
    SIGNED_URL: '/app-platform/storage/signed-url',
    OBJECT:     (bucket: string, path: string) =>
                  `/app-platform/storage/${bucket}/${encodeURIComponent(path)}`,
  },
  EMAIL: {
    SEND:      '/app-platform/email/send',
    SEND_BULK: '/app-platform/email/send-bulk',
  },
  PUSH: {
    DEVICES: '/app-platform/push/devices',
    DEVICE:  (token: string) => `/app-platform/push/devices/${encodeURIComponent(token)}`,
    SEND:    '/app-platform/push/send',
  },
  AI: {
    TEXT:       '/app-platform/ai/text',
    CHAT:       '/app-platform/ai/chat',
    IMAGE:      '/app-platform/ai/image',
    VIDEO:      '/app-platform/ai/video',
    EMBEDDINGS: '/app-platform/ai/embeddings',
    KEYS:       '/app-platform/ai/keys',
    KEY:        (id: string) => `/app-platform/ai/keys/${id}`,
  },
  CHATBOT: {
    SEND:           '/app-platform/chatbot/send',
    CONFIG:         '/app-platform/chatbot/config',
    DOCUMENTS:      '/app-platform/chatbot/documents',
    DOCUMENT:       (id: string) => `/app-platform/chatbot/documents/${id}`,
    DOCUMENT_URL:   '/app-platform/chatbot/documents/url',
    DOCUMENT_TEXT:  '/app-platform/chatbot/documents/text',
    HISTORY:        (sessionId: string) =>
                      `/app-platform/chatbot/history/${encodeURIComponent(sessionId)}`,
  },
  VECTOR: {
    COLLECTIONS:   '/app-platform/vector/collections',
    COLLECTION:    (name: string) => `/app-platform/vector/collections/${name}`,
    UPSERT:        (name: string) => `/app-platform/vector/${name}/upsert`,
    SEARCH:        (name: string) => `/app-platform/vector/${name}/search`,
    DELETE_POINTS: (name: string) => `/app-platform/vector/${name}/delete`,
  },
  SEARCH: {
    UNIFIED:     '/app-platform/search',
    CONFIGURE:   '/app-platform/search/configure',
    CONFIGS:     '/app-platform/search/configs',
    INDEX:       '/app-platform/search/index',
    BULK_INDEX:  '/app-platform/search/index/bulk',
  },
  PAYMENT: {
    CHECKOUT:             '/app-platform/payment/checkout',
    INVOICES:             '/app-platform/payment/invoices',
    INVOICE:              (id: string) => `/app-platform/payment/invoices/${id}`,
    SUBSCRIPTIONS:        '/app-platform/payment/subscriptions',
    SUBSCRIPTION:         (id: string) => `/app-platform/payment/subscriptions/${id}`,
    CANCEL_SUBSCRIPTION:  (id: string) => `/app-platform/payment/subscriptions/${id}/cancel`,
    RESUME_SUBSCRIPTION:  (id: string) => `/app-platform/payment/subscriptions/${id}/resume`,
    CONFIG:               '/app-platform/payment/config',
  },
  VIDEO: {
    ROOMS:       '/app-platform/video/rooms',
    ROOM:        (name: string) => `/app-platform/video/rooms/${encodeURIComponent(name)}`,
    ROOM_TOKEN:  (name: string) => `/app-platform/video/rooms/${encodeURIComponent(name)}/token`,
    RECORDING:   (name: string) => `/app-platform/video/rooms/${encodeURIComponent(name)}/recording`,
  },
  REALTIME: {
    PUBLISH: '/app-platform/realtime/publish',
    WS_PATH: '/app-platform/realtime',
  },
} as const;
