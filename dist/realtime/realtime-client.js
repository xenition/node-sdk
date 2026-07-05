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
            socket.on('connect', () => {
                this.socket = socket;
                resolve(socket);
            });
            socket.on('connect_error', (err) => {
                this.connectPromise = null;
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
        try {
            const u = new URL(constants_1.XENITION_BASE_URL);
            // Strip trailing `/api/v1` — socket.io server is mounted at the root.
            const path = u.pathname.replace(/\/api\/v1\/?$/, '');
            u.pathname = path;
            return u.origin + (path ? path : '');
        }
        catch {
            return constants_1.XENITION_BASE_URL;
        }
    }
}
exports.RealtimeClient = RealtimeClient;
//# sourceMappingURL=realtime-client.js.map