/**
 * Wire shapes for `/app-platform/ai/*`. Mirror the xenition backend's
 * `modules/app-platform-ai/types.ts`.
 */

export type AiProvider =
  | 'openrouter'
  | 'openai'
  | 'runware'
  | 'fal'
  | 'gemini'
  | 'anthropic'
  | 'stability';

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
  images: Array<{ url: string; contentType?: string }>;
  model: string;
  provider: AiProvider;
  usedOwnKey: boolean;
}

export interface GenerateVideoOutput {
  videos: Array<{ url: string; duration?: number }>;
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
