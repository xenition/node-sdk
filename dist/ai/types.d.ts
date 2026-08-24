/**
 * Wire shapes for `/app-platform/ai/*`. Mirror the xenition backend's
 * `modules/app-platform-ai/types.ts`.
 */
export type AiProvider = 'openrouter' | 'openai' | 'runware' | 'fal' | 'gemini' | 'anthropic' | 'stability';
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface AiUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}
export interface GenerateTextOutput {
    text: string;
    model: string;
    provider: AiProvider;
    usage?: AiUsage;
    usedOwnKey: boolean;
}
export interface ChatOutput {
    message: ChatMessage;
    model: string;
    provider: AiProvider;
    usage?: AiUsage;
    usedOwnKey: boolean;
}
export interface GenerateImageOutput {
    images: Array<{
        url: string;
        contentType?: string;
    }>;
    model: string;
    provider: AiProvider;
    usedOwnKey: boolean;
}
export interface GenerateVideoOutput {
    videos: Array<{
        url: string;
        duration?: number;
    }>;
    model: string;
    provider: AiProvider;
    usedOwnKey: boolean;
    jobId?: string;
}
export interface GenerateEmbeddingsOutput {
    embeddings: number[][];
    model: string;
    provider: AiProvider;
    dimension: number;
    usedOwnKey: boolean;
}
export interface AiKeyRecord {
    id: string;
    provider: AiProvider;
    displayName: string;
    maskedKey: string;
    isActive: boolean;
    lastUsedAt: string | null;
    createdAt: string;
}
export interface GenerateTextOptions {
    systemMessage?: string;
    model?: string;
    provider?: AiProvider;
    maxTokens?: number;
    temperature?: number;
}
export interface ChatOptions {
    model?: string;
    provider?: AiProvider;
    maxTokens?: number;
    temperature?: number;
    /**
     * Constrain the reply's shape. See `ResponseFormat` — prompting for
     * "reply in this exact JSON format" is a parse failure waiting to happen.
     */
    responseFormat?: ResponseFormat;
}
export interface GenerateImageOptions {
    model?: string;
    provider?: AiProvider;
    count?: number;
    width?: number;
    height?: number;
    negativePrompt?: string;
}
export interface GenerateVideoOptions {
    model?: string;
    provider?: AiProvider;
    durationSeconds?: number;
    imageUrl?: string;
    options?: Record<string, unknown>;
}
export interface GenerateEmbeddingsOptions {
    model?: string;
    provider?: AiProvider;
}
export interface CreateAiKeyInput {
    displayName: string;
    provider: AiProvider;
    apiKey: string;
}
export interface UpdateAiKeyInput {
    displayName?: string;
    apiKey?: string;
    isActive?: boolean;
}
/** One word with the timing measured from the audio. */
export interface TranscribedWord {
    word: string;
    /** Seconds from the start of the audio. */
    start: number;
    end: number;
    /** 0–1 where the provider reports it. */
    confidence?: number;
}
export interface TranscribeOptions {
    /** BCP-47 hint, e.g. `en`. Omit to let the provider detect. */
    language?: string;
    /**
     * Ask for per-word timings. Worth the extra cost whenever the app shows
     * pace, filler words or pauses — those cannot be derived from plain text.
     */
    wordTimestamps?: boolean;
    /** Label distinct speakers. */
    diarize?: boolean;
    /** Domain words the provider is likely to mishear. */
    prompt?: string;
    model?: string;
    provider?: AiProvider;
}
export interface TranscribeOutput {
    text: string;
    /** Present when `wordTimestamps` was requested and the provider supports it. */
    words?: TranscribedWord[];
    language?: string;
    durationSeconds?: number;
    segments?: Array<{
        start: number;
        end: number;
        text: string;
        speaker?: string;
    }>;
    model: string;
    provider: AiProvider;
    usedOwnKey: boolean;
}
export type SpeechFormat = 'mp3' | 'wav' | 'ogg' | 'aac';
export interface SpeechOptions {
    voice?: string;
    format?: SpeechFormat;
    /** 1.0 is normal. */
    speed?: number;
    model?: string;
    provider?: AiProvider;
}
export interface SpeechOutput {
    /** URL to the rendered audio. */
    url: string;
    format: SpeechFormat;
    durationSeconds?: number;
    model: string;
    provider: AiProvider;
    usedOwnKey: boolean;
}
/** One chunk of a streamed reply. */
export interface ChatDelta {
    /** Text produced since the previous delta. Empty on the final frame. */
    text: string;
    /** True on the last frame; `usage` and `model` arrive with it. */
    done: boolean;
    usage?: AiUsage;
    model?: string;
}
/**
 * Ask for JSON matching a schema instead of hoping the prompt is obeyed.
 *
 * Prompting for "reply in this exact JSON format" works until the day it
 * does not, and then it is a parse failure in production on somebody's
 * recording.
 */
export interface ResponseFormat {
    type: 'text' | 'json' | 'json_schema';
    /** JSON Schema the reply must satisfy. Required for `json_schema`. */
    schema?: Record<string, unknown>;
    /** Name for the schema, which some providers require. */
    name?: string;
}
//# sourceMappingURL=types.d.ts.map