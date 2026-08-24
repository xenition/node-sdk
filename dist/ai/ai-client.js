"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiKeysClient = exports.AiClient = void 0;
exports.parseSseStream = parseSseStream;
const errors_1 = require("../core/errors");
const constants_1 = require("../constants");
/**
 * AI surface for generated apps. One SDK, many providers — xenition routes
 * each call to the right backend (OpenRouter / OpenAI / Runware / fal / …)
 * based on `options.provider` or a sensible default per kind.
 *
 *   // text / chat / embeddings default to OpenRouter
 *   const { text } = await client.ai.generateText('Summarize this post');
 *
 *   // images default to Runware; video → fal
 *   const { images } = await client.ai.generateImage('a red fox in snow');
 *   const { videos } = await client.ai.generateVideo('a red fox running');
 *
 * BYOK: sellers bring their own key via `client.ai.keys.create({ provider,
 * apiKey, displayName })`. If a key is set for a provider, xenition uses
 * it instead of the platform key (and stops billing ai_credits).
 */
class AiClient {
    constructor(http) {
        this.http = http;
        this.keys = new AiKeysClient(http);
    }
    async generateText(prompt, options = {}) {
        return this.http.post(constants_1.API_ENDPOINTS.AI.TEXT, {
            prompt,
            ...options,
        });
    }
    async chat(messages, options = {}) {
        return this.http.post(constants_1.API_ENDPOINTS.AI.CHAT, {
            messages,
            ...options,
        });
    }
    async generateImage(prompt, options = {}) {
        return this.http.post(constants_1.API_ENDPOINTS.AI.IMAGE, {
            prompt,
            ...options,
        });
    }
    async generateVideo(prompt, options = {}) {
        return this.http.post(constants_1.API_ENDPOINTS.AI.VIDEO, {
            prompt,
            ...options,
        });
    }
    async generateEmbeddings(input, options = {}) {
        const body = {
            input: Array.isArray(input) ? input : [input],
            ...options,
        };
        return this.http.post(constants_1.API_ENDPOINTS.AI.EMBEDDINGS, body);
    }
    // ────────── Speech ───────────────────────────────────────────────────────
    /**
     * Transcribe recorded audio.
     *
     * Pass a URL the platform can fetch — typically the one
     * `storage.createSignedUrl()` just produced — rather than the bytes, so a
     * long recording never travels through the app's worker.
     *
     * Ask for `wordTimestamps` whenever the app shows pace, filler words or
     * pauses. Those are measured from the timings; they cannot be recovered
     * from plain text afterwards.
     */
    async transcribe(audioUrl, options = {}) {
        if (typeof audioUrl !== 'string' || audioUrl.trim() === '') {
            throw new errors_1.XenitionError('VALIDATION_ERROR', 'AiClient.transcribe: "audioUrl" must be a non-empty URL the platform can fetch.');
        }
        return this.http.post(constants_1.API_ENDPOINTS.AI.TRANSCRIBE, {
            audioUrl,
            ...options,
        });
    }
    /** Render text as speech. Returns a URL, not bytes, for the same reason. */
    async speech(text, options = {}) {
        if (typeof text !== 'string' || text.trim() === '') {
            throw new errors_1.XenitionError('VALIDATION_ERROR', 'AiClient.speech: "text" must be a non-empty string.');
        }
        return this.http.post(constants_1.API_ENDPOINTS.AI.SPEECH, { text, ...options });
    }
    // ────────── Streaming ────────────────────────────────────────────────────
    /**
     * Stream a chat reply token by token.
     *
     *   for await (const delta of client.ai.streamChat(messages)) {
     *     if (delta.text) process.stdout.write(delta.text);
     *   }
     *
     * Uses `fetch` directly rather than the shared axios client, because the
     * point of streaming is to consume the body as it arrives and axios has
     * already buffered it by the time a caller sees anything.
     *
     * A 20-second wait staring at a spinner is what a non-streaming chat UI
     * feels like, so this is not a nicety.
     */
    async *streamChat(messages, options = {}) {
        const response = await this.http.stream(constants_1.API_ENDPOINTS.AI.CHAT_STREAM, {
            messages,
            ...options,
            stream: true,
        });
        yield* parseSseStream(response);
    }
}
exports.AiClient = AiClient;
/**
 * Parse a `text/event-stream` body into deltas.
 *
 * The wire format is the OpenAI-shaped convention every provider now
 * follows: `data: {json}` lines, blank line between events, and a literal
 * `data: [DONE]` sentinel at the end.
 */
async function* parseSseStream(response) {
    const body = response.body;
    if (!body) {
        throw new errors_1.XenitionError('SERVER_ERROR', 'AiClient.streamChat: response carried no body.');
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            // Events are separated by a blank line. Anything after the last one
            // is a partial event and stays in the buffer for the next chunk —
            // a token boundary landing mid-JSON is the normal case, not an edge one.
            let boundary = buffer.indexOf('\n\n');
            while (boundary !== -1) {
                const event = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const delta = parseSseEvent(event);
                if (delta) {
                    yield delta;
                    if (delta.done)
                        return;
                }
                boundary = buffer.indexOf('\n\n');
            }
        }
        const trailing = parseSseEvent(buffer);
        if (trailing)
            yield trailing;
    }
    finally {
        // Abandoning a stream mid-iteration (a `break`, a thrown error) must
        // not leave the connection open.
        await reader.cancel().catch(() => undefined);
    }
}
function parseSseEvent(event) {
    const dataLines = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());
    if (dataLines.length === 0)
        return null;
    const payload = dataLines.join('\n');
    if (payload === '[DONE]')
        return { text: '', done: true };
    try {
        const parsed = JSON.parse(payload);
        return {
            text: parsed.text ?? parsed.delta ?? '',
            done: parsed.done === true,
            usage: parsed.usage,
            model: parsed.model,
        };
    }
    catch {
        // A malformed frame must not kill a stream that is otherwise fine —
        // the next token is usually right behind it.
        return null;
    }
}
/**
 * BYOK key management. All methods require a service key.
 */
class AiKeysClient {
    constructor(http) {
        this.http = http;
    }
    list() {
        return this.http.get(constants_1.API_ENDPOINTS.AI.KEYS);
    }
    create(input) {
        return this.http.post(constants_1.API_ENDPOINTS.AI.KEYS, input);
    }
    update(id, patch) {
        return this.http.patch(constants_1.API_ENDPOINTS.AI.KEY(id), patch);
    }
    async delete(id) {
        await this.http.del(constants_1.API_ENDPOINTS.AI.KEY(id));
    }
}
exports.AiKeysClient = AiKeysClient;
//# sourceMappingURL=ai-client.js.map