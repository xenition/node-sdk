"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadChatbot = loadChatbot;
const constants_1 = require("../constants");
const WIDGET_ROOT_ID = 'xenition-chatbot-widget-root';
/**
 * Mounts a minimal floating chatbot bubble backed by the xenition
 * chatbot API. Intentionally dependency-free — no React, no axios — so
 * it drops into any site via:
 *
 *   <script type="module">
 *     import { loadChatbot } from '@xenition/sdk/browser';
 *     loadChatbot('xen_anon_...', { primaryColor: '#5b21b6' });
 *   </script>
 *
 * This is the reference minimal UI; sellers who want deeper integration
 * (custom components, theming, avatars) can build their own against the
 * same POST /app-platform/chatbot/send endpoint.
 */
function loadChatbot(anonKey, options = {}) {
    if (typeof document === 'undefined') {
        throw new Error('loadChatbot must run in the browser');
    }
    if (!anonKey || !anonKey.startsWith('xen_anon_')) {
        // Allow service keys too (dev tooling), but log a warning.
        // eslint-disable-next-line no-console
        console.warn('[xenition-chatbot] Prefer xen_anon_ keys in the browser. xen_service_ keys expose full privileges.');
    }
    if (document.getElementById(WIDGET_ROOT_ID))
        return;
    const baseUrl = options.baseUrl ?? constants_1.XENITION_BASE_URL;
    const position = options.position ?? 'bottom-right';
    const primaryColor = options.primaryColor ?? '#4f46e5';
    const container = document.createElement('div');
    container.id = WIDGET_ROOT_ID;
    Object.assign(container.style, {
        position: 'fixed',
        zIndex: '2147483647',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        ...positionStyles(position),
    });
    document.body.appendChild(container);
    const state = {
        sessionId: null,
        open: false,
        config: null,
    };
    const bubble = buildBubble(primaryColor);
    const panel = buildPanel(primaryColor, options);
    container.appendChild(bubble);
    container.appendChild(panel.root);
    panel.root.style.display = 'none';
    bubble.addEventListener('click', () => {
        state.open = !state.open;
        panel.root.style.display = state.open ? 'flex' : 'none';
        if (state.open && !state.config) {
            void fetchConfig();
        }
    });
    panel.form.addEventListener('submit', (evt) => {
        evt.preventDefault();
        const text = panel.input.value.trim();
        if (!text)
            return;
        panel.input.value = '';
        appendMessage(panel.messages, 'user', text, primaryColor);
        const pending = appendMessage(panel.messages, 'assistant', '…', primaryColor);
        void send(text)
            .then((reply) => {
            pending.textContent = reply;
        })
            .catch((err) => {
            pending.textContent = `Error: ${err.message}`;
        });
    });
    async function fetchConfig() {
        try {
            const res = await fetch(`${baseUrl}/app-platform/chatbot/config`, {
                headers: { 'x-api-key': anonKey },
            });
            if (!res.ok)
                return;
            const env = (await res.json());
            const cfg = ('data' in env ? env.data : env) ?? null;
            if (cfg) {
                state.config = cfg;
                const welcome = options.greeting ?? cfg.welcomeMessage ?? 'Hi! How can I help?';
                appendMessage(panel.messages, 'assistant', welcome, primaryColor);
            }
        }
        catch {
            /* noop — leave panel blank */
        }
    }
    async function send(message) {
        const res = await fetch(`${baseUrl}/app-platform/chatbot/send`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': anonKey,
            },
            body: JSON.stringify({ message, sessionId: state.sessionId }),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`${res.status} ${text.slice(0, 200)}`);
        }
        const env = (await res.json());
        const data = ('data' in env ? env.data : env);
        if (!data)
            throw new Error('Empty response');
        state.sessionId = data.sessionId;
        return data.reply?.content ?? '';
    }
}
function positionStyles(pos) {
    const base = {};
    if (pos === 'bottom-right') {
        base.bottom = '24px';
        base.right = '24px';
    }
    else if (pos === 'bottom-left') {
        base.bottom = '24px';
        base.left = '24px';
    }
    else if (pos === 'top-right') {
        base.top = '24px';
        base.right = '24px';
    }
    else {
        base.top = '24px';
        base.left = '24px';
    }
    return base;
}
function buildBubble(primary) {
    const el = document.createElement('button');
    el.type = 'button';
    el.setAttribute('aria-label', 'Open chat');
    Object.assign(el.style, {
        width: '56px',
        height: '56px',
        borderRadius: '28px',
        border: 'none',
        boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
        background: primary,
        color: 'white',
        cursor: 'pointer',
        fontSize: '24px',
    });
    el.innerHTML = '💬';
    return el;
}
function buildPanel(primary, options) {
    const root = document.createElement('div');
    Object.assign(root.style, {
        width: '360px',
        height: '520px',
        marginBottom: '12px',
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 20px 48px rgba(0,0,0,0.18)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
    });
    const header = document.createElement('div');
    Object.assign(header.style, {
        padding: '12px 16px',
        background: primary,
        color: 'white',
        fontWeight: '600',
    });
    header.textContent = 'Support';
    root.appendChild(header);
    const messages = document.createElement('div');
    Object.assign(messages.style, {
        flex: '1',
        overflowY: 'auto',
        padding: '12px 16px',
        background: '#f9fafb',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
    });
    root.appendChild(messages);
    const form = document.createElement('form');
    Object.assign(form.style, {
        display: 'flex',
        padding: '12px',
        background: 'white',
        borderTop: '1px solid #e5e7eb',
        gap: '8px',
    });
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = options.placeholder ?? 'Type a message…';
    Object.assign(input.style, {
        flex: '1',
        padding: '10px 12px',
        border: '1px solid #d1d5db',
        borderRadius: '8px',
        fontSize: '14px',
    });
    const send = document.createElement('button');
    send.type = 'submit';
    send.textContent = 'Send';
    Object.assign(send.style, {
        padding: '10px 14px',
        background: primary,
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        cursor: 'pointer',
    });
    form.appendChild(input);
    form.appendChild(send);
    root.appendChild(form);
    return { root, messages, form, input };
}
function appendMessage(container, role, content, primary) {
    const bubble = document.createElement('div');
    Object.assign(bubble.style, {
        alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        padding: '8px 12px',
        borderRadius: '12px',
        fontSize: '14px',
        lineHeight: '1.4',
        background: role === 'user' ? primary : 'white',
        color: role === 'user' ? 'white' : '#111827',
        border: role === 'user' ? 'none' : '1px solid #e5e7eb',
        whiteSpace: 'pre-wrap',
    });
    bubble.textContent = content;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    return bubble;
}
//# sourceMappingURL=chatbot-loader.js.map