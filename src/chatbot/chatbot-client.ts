import FormData from 'form-data';
import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';
import {
  ChatbotConfig,
  ChatbotConfigPatch,
  ChatbotDocument,
  ChatbotMessage,
  SendMessageInput,
  SendMessageResult,
  UploadDocumentOptions,
} from './types';

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
export class ChatbotClient {
  constructor(private readonly http: HttpClient) {}

  // ───────── send + history ─────────

  send(input: SendMessageInput): Promise<SendMessageResult> {
    return this.http.post<SendMessageResult>(
      API_ENDPOINTS.CHATBOT.SEND,
      input,
    );
  }

  getHistory(sessionId: string, limit: number = 50): Promise<ChatbotMessage[]> {
    return this.http.get<ChatbotMessage[]>(
      `${API_ENDPOINTS.CHATBOT.HISTORY(sessionId)}?limit=${limit}`,
    );
  }

  // ───────── config ─────────

  getConfig(): Promise<ChatbotConfig> {
    return this.http.get<ChatbotConfig>(API_ENDPOINTS.CHATBOT.CONFIG);
  }

  updateConfig(patch: ChatbotConfigPatch): Promise<ChatbotConfig> {
    return this.http.patch<ChatbotConfig>(API_ENDPOINTS.CHATBOT.CONFIG, patch);
  }

  // ───────── documents ─────────

  listDocuments(): Promise<ChatbotDocument[]> {
    return this.http.get<ChatbotDocument[]>(API_ENDPOINTS.CHATBOT.DOCUMENTS);
  }

  /**
   * Upload a PDF by bytes. For URL / text ingestion, use the dedicated
   * methods below.
   */
  async uploadDocument(
    pdfBuffer: Buffer,
    options: UploadDocumentOptions = {},
  ): Promise<ChatbotDocument> {
    if (!Buffer.isBuffer(pdfBuffer)) {
      throw new TypeError('ChatbotClient.uploadDocument: expected a Buffer');
    }
    const form = new FormData();
    form.append('file', pdfBuffer, {
      filename: options.title ? `${options.title}.pdf` : 'document.pdf',
      contentType: options.mimeType || 'application/pdf',
    });
    if (options.title) form.append('title', options.title);
    return this.http.postForm<ChatbotDocument>(
      API_ENDPOINTS.CHATBOT.DOCUMENTS,
      form,
    );
  }

  uploadDocumentFromUrl(title: string, url: string): Promise<ChatbotDocument> {
    return this.http.post<ChatbotDocument>(
      API_ENDPOINTS.CHATBOT.DOCUMENT_URL,
      { title, url },
    );
  }

  uploadDocumentFromText(title: string, content: string): Promise<ChatbotDocument> {
    return this.http.post<ChatbotDocument>(
      API_ENDPOINTS.CHATBOT.DOCUMENT_TEXT,
      { title, content },
    );
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.http.del<void>(API_ENDPOINTS.CHATBOT.DOCUMENT(documentId));
  }
}
