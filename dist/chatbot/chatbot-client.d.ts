import { HttpClient } from '../core/http-client';
import { ChatbotConfig, ChatbotConfigPatch, ChatbotDocument, ChatbotMessage, SendMessageInput, SendMessageResult, UploadDocumentOptions } from './types';
/**
 * Customer-support chatbot with RAG.
 *
 *   // In the end-user browser (anon key is fine for send + history):
 *   const res = await client.chatbot.send({ message: 'How do I reset my PIN?' })
 *   console.log(res.reply.content)
 *
 *   // Seller-side tooling uses the service key to manage docs + config:
 *   await client.chatbot.updateConfig({ welcomeMessage: 'Hi there!' })
 *   await client.chatbot.uploadDocument(pdfBuffer, { title: 'Help Center' })
 *
 * Uploads accept PDF bytes (Buffer), a URL, or raw text. The server
 * chunks + embeds in the background via BullMQ — document `status`
 * moves `pending → processing → ready`.
 */
export declare class ChatbotClient {
    private readonly http;
    constructor(http: HttpClient);
    send(input: SendMessageInput): Promise<SendMessageResult>;
    getHistory(sessionId: string, limit?: number): Promise<ChatbotMessage[]>;
    getConfig(): Promise<ChatbotConfig>;
    updateConfig(patch: ChatbotConfigPatch): Promise<ChatbotConfig>;
    listDocuments(): Promise<ChatbotDocument[]>;
    /**
     * Upload a PDF by bytes. For URL / text ingestion, use the dedicated
     * methods below.
     */
    uploadDocument(pdfBuffer: Buffer, options?: UploadDocumentOptions): Promise<ChatbotDocument>;
    uploadDocumentFromUrl(title: string, url: string): Promise<ChatbotDocument>;
    uploadDocumentFromText(title: string, content: string): Promise<ChatbotDocument>;
    deleteDocument(documentId: string): Promise<void>;
}
//# sourceMappingURL=chatbot-client.d.ts.map