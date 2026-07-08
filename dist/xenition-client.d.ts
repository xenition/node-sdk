import { HttpClientOptions } from './core/http-client';
import { AuthClient } from './auth/auth-client';
import { QueryClient } from './query/query-client';
import { QueryResult } from './query/types';
import { StorageClient } from './storage/storage-client';
import { EmailClient } from './email/email-client';
import { PushClient } from './push/push-client';
import { AiClient } from './ai/ai-client';
import { ChatbotClient } from './chatbot/chatbot-client';
import { VectorClient } from './vector/vector-client';
import { SearchClient } from './search/search-client';
import { PaymentClient } from './payment/payment-client';
import { VideoConferencingClient } from './video/video-client';
import { RealtimeClient } from './realtime/realtime-client';
import { MigrationsClient } from './migrations/migrations-client';
import { ModulesClient } from './modules/modules-client';
export interface XenitionClientOptions extends HttpClientOptions {
}
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
export declare class XenitionClient {
    private readonly http;
    readonly auth: AuthClient;
    readonly query: QueryClient;
    readonly storage: StorageClient;
    readonly email: EmailClient;
    readonly push: PushClient;
    readonly ai: AiClient;
    readonly chatbot: ChatbotClient;
    readonly vector: VectorClient;
    readonly search: SearchClient;
    readonly payment: PaymentClient;
    readonly videoConferencing: VideoConferencingClient;
    readonly realtime: RealtimeClient;
    /** Content-addressed per-app migration ledger (service key). */
    readonly migrations: MigrationsClient;
    /** Content modules v0 (cms / forms / reviews) — see modules/core.ts. */
    readonly modules: ModulesClient;
    constructor(apiKey: string, options?: XenitionClientOptions);
    /**
     * Direct parameterized SQL against the per-app DB. Service-key only —
     * the server returns 403 for anon keys.
     */
    raw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
    /**
     * Escape hatch for adding custom headers (e.g. session token on a
     * subsequent request). Use sparingly — most flows should not need it.
     */
    setHeader(key: string, value: string): void;
}
//# sourceMappingURL=xenition-client.d.ts.map