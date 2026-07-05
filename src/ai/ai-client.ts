import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';
import {
  AiKeyRecord,
  ChatMessage,
  ChatOptions,
  ChatOutput,
  CreateAiKeyInput,
  GenerateEmbeddingsOptions,
  GenerateEmbeddingsOutput,
  GenerateImageOptions,
  GenerateImageOutput,
  GenerateTextOptions,
  GenerateTextOutput,
  GenerateVideoOptions,
  GenerateVideoOutput,
  UpdateAiKeyInput,
} from './types';

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
export class AiClient {
  readonly keys: AiKeysClient;

  constructor(private readonly http: HttpClient) {
    this.keys = new AiKeysClient(http);
  }

  async generateText(
    prompt: string,
    options: GenerateTextOptions = {},
  ): Promise<GenerateTextOutput> {
    return this.http.post<GenerateTextOutput>(API_ENDPOINTS.AI.TEXT, {
      prompt,
      ...options,
    });
  }

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<ChatOutput> {
    return this.http.post<ChatOutput>(API_ENDPOINTS.AI.CHAT, {
      messages,
      ...options,
    });
  }

  async generateImage(
    prompt: string,
    options: GenerateImageOptions = {},
  ): Promise<GenerateImageOutput> {
    return this.http.post<GenerateImageOutput>(API_ENDPOINTS.AI.IMAGE, {
      prompt,
      ...options,
    });
  }

  async generateVideo(
    prompt: string,
    options: GenerateVideoOptions = {},
  ): Promise<GenerateVideoOutput> {
    return this.http.post<GenerateVideoOutput>(API_ENDPOINTS.AI.VIDEO, {
      prompt,
      ...options,
    });
  }

  async generateEmbeddings(
    input: string | string[],
    options: GenerateEmbeddingsOptions = {},
  ): Promise<GenerateEmbeddingsOutput> {
    const body = {
      input: Array.isArray(input) ? input : [input],
      ...options,
    };
    return this.http.post<GenerateEmbeddingsOutput>(
      API_ENDPOINTS.AI.EMBEDDINGS,
      body,
    );
  }
}

/**
 * BYOK key management. All methods require a service key.
 */
export class AiKeysClient {
  constructor(private readonly http: HttpClient) {}

  list(): Promise<AiKeyRecord[]> {
    return this.http.get<AiKeyRecord[]>(API_ENDPOINTS.AI.KEYS);
  }

  create(input: CreateAiKeyInput): Promise<AiKeyRecord> {
    return this.http.post<AiKeyRecord>(API_ENDPOINTS.AI.KEYS, input);
  }

  update(id: string, patch: UpdateAiKeyInput): Promise<AiKeyRecord> {
    return this.http.patch<AiKeyRecord>(API_ENDPOINTS.AI.KEY(id), patch);
  }

  async delete(id: string): Promise<void> {
    await this.http.del<void>(API_ENDPOINTS.AI.KEY(id));
  }
}
