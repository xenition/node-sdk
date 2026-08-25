import { HttpClient } from '../core/http-client';
import { AiKeyRecord, ChatDelta, ChatMessage, ChatOptions, ChatOutput, CreateAiKeyInput, GenerateEmbeddingsOptions, GenerateEmbeddingsOutput, GenerateImageOptions, GenerateImageOutput, GenerateTextOptions, GenerateTextOutput, GenerateVideoOptions, GenerateVideoOutput, SpeechOptions, SpeechOutput, TranscribeOptions, TranscribeOutput, UpdateAiKeyInput } from './types';
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
    transcribe(audioUrl: string, options?: TranscribeOptions): Promise<TranscribeOutput>;
    /** Render text as speech. Returns a URL, not bytes, for the same reason. */
    speech(text: string, options?: SpeechOptions): Promise<SpeechOutput>;
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
    streamChat(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatDelta, void, unknown>;
}
/**
 * Parse a `text/event-stream` body into deltas.
 *
 * The wire format is the OpenAI-shaped convention every provider now
 * follows: `data: {json}` lines, blank line between events, and a literal
 * `data: [DONE]` sentinel at the end.
 */
export declare function parseSseStream(response: Response): AsyncGenerator<ChatDelta, void, unknown>;
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