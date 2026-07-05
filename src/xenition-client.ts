import { HttpClient, HttpClientOptions } from './core/http-client';
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

export interface XenitionClientOptions extends HttpClientOptions {}

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
export class XenitionClient {
  private readonly http: HttpClient;

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

  constructor(apiKey: string, options: XenitionClientOptions = {}) {
    if (!apiKey) {
      throw new Error(
        'XenitionClient: API key is required. Get one from the xenition seller dashboard.',
      );
    }
    if (!apiKey.startsWith('xen_service_') && !apiKey.startsWith('xen_anon_')) {
      // Permissive — just warn. The server will still reject unknown keys.
      // eslint-disable-next-line no-console
      console.warn(
        'XenitionClient: API key should start with "xen_service_" or "xen_anon_".',
      );
    }

    this.http = new HttpClient(apiKey, options);
    this.auth = new AuthClient(this.http);
    this.query = new QueryClient(this.http);
    this.storage = new StorageClient(this.http);
    this.email = new EmailClient(this.http);
    this.push = new PushClient(this.http);
    this.ai = new AiClient(this.http);
    this.chatbot = new ChatbotClient(this.http);
    this.vector = new VectorClient(this.http);
    this.search = new SearchClient(this.http);
    this.payment = new PaymentClient(this.http);
    this.videoConferencing = new VideoConferencingClient(this.http);
    this.realtime = new RealtimeClient(this.http, apiKey);
  }

  /**
   * Direct parameterized SQL against the per-app DB. Service-key only —
   * the server returns 403 for anon keys.
   */
  raw<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.query.raw<T>(sql, params);
  }

  /**
   * Escape hatch for adding custom headers (e.g. session token on a
   * subsequent request). Use sparingly — most flows should not need it.
   */
  setHeader(key: string, value: string): void {
    this.http.setHeader(key, value);
  }
}
