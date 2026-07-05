import { AiProvider } from '../ai/types';
/**
 * Wire shapes for `/app-platform/chatbot/*`. Mirror the xenition backend's
 * `modules/app-platform-chatbot/types.ts`.
 */
export interface ChatbotConfig {
    id: string;
    name: string;
    enabled: boolean;
    welcomeMessage: string;
    systemPrompt: string | null;
    suggestedPrompts: string[];
    handoffKeywords: string[];
    theme: Record<string, unknown>;
    model: string;
    provider: AiProvider;
    embeddingModel: string;
    embeddingProvider: AiProvider;
    topK: number;
    createdAt: string;
    updatedAt: string;
}
export type ChatbotConfigPatch = Partial<Omit<ChatbotConfig, 'id' | 'createdAt' | 'updatedAt'>>;
export interface ChatbotDocument {
    id: string;
    title: string;
    sourceType: 'pdf' | 'url' | 'text';
    sourceRef: string | null;
    status: 'pending' | 'processing' | 'ready' | 'failed';
    chunksIndexed: number;
    error: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}
export interface ChatbotMessage {
    id: string;
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata: Record<string, unknown>;
    createdAt: string;
}
export interface SendMessageInput {
    message: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
}
export interface SendMessageResult {
    sessionId: string;
    user: ChatbotMessage;
    reply: ChatbotMessage;
    handoff: boolean;
    sources: Array<{
        documentId: string;
        title: string;
        snippet: string;
        score: number;
    }>;
}
export interface UploadDocumentOptions {
    title?: string;
    mimeType?: string;
}
//# sourceMappingURL=types.d.ts.map