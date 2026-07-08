import { HttpClient } from '../core/http-client';
import { RealtimeHandler, Subscription } from './types';
/**
 * WebSocket pub/sub for generated apps. Lazy-connects on first use —
 * generated apps that never call `subscribe/publish` pay zero cost.
 *
 *   const sub = client.realtime.subscribe('tasks', (msg) => {
 *     console.log('task event:', msg.payload);
 *   });
 *   // ...
 *   sub.unsubscribe();
 *
 *   await client.realtime.publish('tasks', { id: 't_42', action: 'created' });
 *
 * Publish works in two modes:
 *   - via the WebSocket connection (realtime client, service key required)
 *   - via `POST /app-platform/realtime/publish` (server-side, any service key)
 *     — used automatically when we're not connected yet.
 */
export declare class RealtimeClient {
    private readonly http;
    private socket;
    private apiKey;
    private handlers;
    private connectPromise;
    constructor(http: HttpClient, apiKey: string);
    subscribe<T = unknown>(channel: string, handler: RealtimeHandler<T>): Subscription;
    publish(channel: string, payload: unknown): Promise<void>;
    disconnect(): void;
    private ensureSubscribed;
    private connect;
    private deriveWsUrl;
}
//# sourceMappingURL=realtime-client.d.ts.map