"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealtimeClient = void 0;
const socket_io_client_1 = require("socket.io-client");
const constants_1 = require("../constants");
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
class RealtimeClient {
    constructor(http, apiKey) {
        this.http = http;
        this.socket = null;
        this.apiKey = null;
        this.handlers = new Map();
        this.connectPromise = null;
        this.apiKey = apiKey;
    }
    subscribe(channel, handler) {
        const set = this.handlers.get(channel) ?? new Set();
        set.add(handler);
        this.handlers.set(channel, set);
        void this.ensureSubscribed(channel);
        return {
            unsubscribe: () => {
                const current = this.handlers.get(channel);
                if (!current)
                    return;
                current.delete(handler);
                if (current.size === 0) {
                    this.handlers.delete(channel);
                    this.socket?.emit('unsubscribe', { channel });
                }
            },
        };
    }
    async publish(channel, payload) {
        if (this.socket?.connected) {
            await new Promise((resolve, reject) => {
                this.socket.emit('publish', { channel, payload }, (ack) => {
                    if (ack?.ok)
                        resolve();
                    else
                        reject(new Error(ack?.error ?? 'publish failed'));
                });
            });
            return;
        }
        // Fallback to REST publish so server-side code doesn't need an open socket.
        await this.http.post(constants_1.API_ENDPOINTS.REALTIME.PUBLISH, {
            channel,
            payload,
        });
    }
    disconnect() {
        this.socket?.disconnect();
        this.socket = null;
        this.connectPromise = null;
    }
    // ───────── internals ─────────
    async ensureSubscribed(channel) {
        const socket = await this.connect();
        socket.emit('subscribe', { channel });
    }
    connect() {
        if (this.socket?.connected)
            return Promise.resolve(this.socket);
        if (this.connectPromise)
            return this.connectPromise;
        this.connectPromise = new Promise((resolve, reject) => {
            const url = this.deriveWsUrl();
            const socket = (0, socket_io_client_1.io)(`${url}/app-platform/realtime`, {
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
                if (connectedOnce)
                    return;
                this.connectPromise = null;
                socket.disconnect();
                reject(err);
            });
            socket.on('message', (msg) => {
                const handlers = this.handlers.get(msg.channel);
                if (!handlers)
                    return;
                for (const h of handlers) {
                    try {
                        h(msg);
                    }
                    catch {
                        /* handler threw — keep going */
                    }
                }
            });
        });
        return this.connectPromise;
    }
    deriveWsUrl() {
        const base = this.http.baseUrl || constants_1.XENITION_BASE_URL;
        try {
            const u = new URL(base);
            // Strip the trailing versioned API prefix (`/v1` — xenition's base
            // path — or a legacy `/api/v1`) — socket.io server is mounted at
            // the root of the same host.
            const path = u.pathname
                .replace(/\/(?:api\/)?v1\/?$/, '')
                .replace(/\/+$/, '');
            return u.origin + path;
        }
        catch {
            return base;
        }
    }
}
exports.RealtimeClient = RealtimeClient;
//# sourceMappingURL=realtime-client.js.map