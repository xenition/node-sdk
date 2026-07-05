import { HttpClient } from '../core/http-client';
import { AiKeyRecord, ChatMessage, ChatOptions, ChatOutput, CreateAiKeyInput, GenerateEmbeddingsOptions, GenerateEmbeddingsOutput, GenerateImageOptions, GenerateImageOutput, GenerateTextOptions, GenerateTextOutput, GenerateVideoOptions, GenerateVideoOutput, UpdateAiKeyInput } from './types';
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
export declare class AiClient {
    private readonly http;
    readonly keys: AiKeysClient;
    constructor(http: HttpClient);
    generateText(prompt: string, options?: GenerateTextOptions): Promise<GenerateTextOutput>;
    chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatOutput>;
    generateImage(prompt: string, options?: GenerateImageOptions): Promise<GenerateImageOutput>;
    generateVideo(prompt: string, options?: GenerateVideoOptions): Promise<GenerateVideoOutput>;
    generateEmbeddings(input: string | string[], options?: GenerateEmbeddingsOptions): Promise<GenerateEmbeddingsOutput>;
}
/**
 * BYOK key management. All methods require a service key.
 */
export declare class AiKeysClient {
    private readonly http;
    constructor(http: HttpClient);
    list(): Promise<AiKeyRecord[]>;
    create(input: CreateAiKeyInput): Promise<AiKeyRecord>;
    update(id: string, patch: UpdateAiKeyInput): Promise<AiKeyRecord>;
    delete(id: string): Promise<void>;
}
//# sourceMappingURL=ai-client.d.ts.map