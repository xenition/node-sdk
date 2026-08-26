import { HttpClient } from '../core/http-client';
import { AiKeyRecord, ChatDelta, ChatMessage, ChatOptions, ChatOutput, CreateAiKeyInput, GenerateEmbeddingsOptions, GenerateEmbeddingsOutput, GenerateImageOptions, GenerateImageOutput, GenerateTextOptions, GenerateTextOutput, GenerateVideoOptions, GenerateVideoOutput, SpeechOptions, SpeechOutput, TranscribeOptions, TranscribeOutput, UpdateAiKeyInput } from './types';
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
     * Chat, but the reply comes back parsed and shape-checked.
     *
     * `responseFormat: { type: 'json_schema' }` asks the provider for JSON —
     * it does not guarantee you get it. Providers still occasionally wrap the
     * object in prose, emit a trailing comma, or truncate at the token limit.
     * So every caller writes the same defensive `JSON.parse` in a try/catch
     * with a fallback, and the two apps built on this SDK each wrote it twice.
     *
     *   const score = await ai.chatJson<Score>(messages, SCORE_SCHEMA);
     *
     * Throws `AI_UNPARSEABLE` rather than returning a half-built object: a
     * score of 0 because the JSON was malformed is worse than an error,
     * because it silently becomes the user's result.
     *
     * The schema is sent to the provider AND used to check the reply has the
     * required keys. This is a shape check, not full JSON Schema validation —
     * enough to catch a truncated or wrapped reply, which is what actually
     * goes wrong.
     */
    chatJson<T = Record<string, unknown>>(messages: ChatMessage[], schema: Record<string, unknown>, options?: Omit<ChatOptions, 'responseFormat'>): Promise<T>;
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
 * Parse a model's JSON reply, tolerating the ways providers wrap it.
 *
 * Fenced code blocks and leading prose are common enough that stripping
 * them is worth doing before giving up — the alternative is failing a job
 * over a markdown fence the model added unasked.
 */
export declare function parseJsonReply<T = Record<string, unknown>>(raw: string, schema?: Record<string, unknown>): T;
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