import { io, Socket } from 'socket.io-client';
import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS, XENITION_BASE_URL } from '../constants';
import { RealtimeHandler, RealtimeMessage, Subscription } from './types';

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
export class RealtimeClient {
  private socket: Socket | null = null;
  private apiKey: string | null = null;
  private handlers = new Map<string, Set<RealtimeHandler>>();
  private connectPromise: Promise<Socket> | null = null;

  constructor(private readonly http: HttpClient, apiKey: string) {
    this.apiKey = apiKey;
  }

  subscribe<T = unknown>(channel: string, handler: RealtimeHandler<T>): Subscription {
    const set = this.handlers.get(channel) ?? new Set<RealtimeHandler>();
    set.add(handler as RealtimeHandler);
    this.handlers.set(channel, set);
    void this.ensureSubscribed(channel);
    return {
      unsubscribe: () => {
        const current = this.handlers.get(channel);
        if (!current) return;
        current.delete(handler as RealtimeHandler);
        if (current.size === 0) {
          this.handlers.delete(channel);
          this.socket?.emit('unsubscribe', { channel });
        }
      },
    };
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    if (this.socket?.connected) {
      await new Promise<void>((resolve, reject) => {
        this.socket!.emit(
          'publish',
          { channel, payload },
          (ack: { ok?: boolean; error?: string }) => {
            if (ack?.ok) resolve();
            else reject(new Error(ack?.error ?? 'publish failed'));
          },
        );
      });
      return;
    }
    // Fallback to REST publish so server-side code doesn't need an open socket.
    await this.http.post<{ ok: boolean }>(API_ENDPOINTS.REALTIME.PUBLISH, {
      channel,
      payload,
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connectPromise = null;
  }

  // ───────── internals ─────────

  private async ensureSubscribed(channel: string): Promise<void> {
    const socket = await this.connect();
    socket.emit('subscribe', { channel });
  }

  private connect(): Promise<Socket> {
    if (this.socket?.connected) return Promise.resolve(this.socket);
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<Socket>((resolve, reject) => {
      const url = this.deriveWsUrl();
      const socket = io(`${url}/app-platform/realtime`, {
        auth: { apiKey: this.apiKey },
        transports: ['websocket'],
        reconnection: true,
      });
      // First connect vs every one after it. socket.io reconnects on its own
      // after a network blip, but the server holds subscriptions per
      // CONNECTION — so a reconnected socket is subscribed to nothing. Without
      // the replay below, a phone that loses signal for two seconds comes back
      // with a live socket, a full handler map, and no events ever again.
      // Nothing throws and nothing logs; the screen just stops updating.
      let connectedOnce = false;
      socket.on('connect', () => {
        this.socket = socket;
        if (!connectedOnce) {
          connectedOnce = true;
          // The initial subscribe is `ensureSubscribed`'s job — it emits per
          // channel as each caller subscribes. Replaying here as well would
          // double-subscribe every channel on the very first connect.
          resolve(socket);
          return;
        }
        for (const channel of this.handlers.keys()) {
          socket.emit('subscribe', { channel });
        }
      });
      socket.on('connect_error', (err) => {
        // Once we have been connected, this is socket.io retrying in the
        // background and it will recover on its own. Only the never-connected
        // case is a failure to report — and that socket has to be closed, or
        // it reconnects forever behind a promise nobody holds.
        if (connectedOnce) return;
        this.connectPromise = null;
        socket.disconnect();
        reject(err);
      });
      socket.on('message', (msg: RealtimeMessage) => {
        const handlers = this.handlers.get(msg.channel);
        if (!handlers) return;
        for (const h of handlers) {
          try {
            h(msg);
          } catch {
            /* handler threw — keep going */
          }
        }
      });
    });
    return this.connectPromise;
  }

  private deriveWsUrl(): string {
    const base = this.http.baseUrl || XENITION_BASE_URL;
    try {
      const u = new URL(base);
      // Strip the trailing versioned API prefix (`/v1` — xenition's base
      // path — or a legacy `/api/v1`) — socket.io server is mounted at
      // the root of the same host.
      const path = u.pathname
        .replace(/\/(?:api\/)?v1\/?$/, '')
        .replace(/\/+$/, '');
      return u.origin + path;
    } catch {
      return base;
    }
  }
}
