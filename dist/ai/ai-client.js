"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiKeysClient = exports.AiClient = void 0;
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
}
exports.AiClient = AiClient;
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