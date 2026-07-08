"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatbotClient = void 0;
const form_data_1 = __importDefault(require("form-data"));
const constants_1 = require("../constants");
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
class ChatbotClient {
    constructor(http) {
        this.http = http;
    }
    // ───────── send + history ─────────
    send(input) {
        return this.http.post(constants_1.API_ENDPOINTS.CHATBOT.SEND, input);
    }
    getHistory(sessionId, limit = 50) {
        return this.http.get(`${constants_1.API_ENDPOINTS.CHATBOT.HISTORY(sessionId)}?limit=${limit}`);
    }
    // ───────── config ─────────
    getConfig() {
        return this.http.get(constants_1.API_ENDPOINTS.CHATBOT.CONFIG);
    }
    updateConfig(patch) {
        return this.http.patch(constants_1.API_ENDPOINTS.CHATBOT.CONFIG, patch);
    }
    // ───────── documents ─────────
    listDocuments() {
        return this.http.get(constants_1.API_ENDPOINTS.CHATBOT.DOCUMENTS);
    }
    /**
     * Upload a PDF by bytes. For URL / text ingestion, use the dedicated
     * methods below.
     */
    async uploadDocument(pdfBuffer, options = {}) {
        if (!Buffer.isBuffer(pdfBuffer)) {
            throw new TypeError('ChatbotClient.uploadDocument: expected a Buffer');
        }
        const form = new form_data_1.default();
        form.append('file', pdfBuffer, {
            filename: options.title ? `${options.title}.pdf` : 'document.pdf',
            contentType: options.mimeType || 'application/pdf',
        });
        if (options.title)
            form.append('title', options.title);
        return this.http.postForm(constants_1.API_ENDPOINTS.CHATBOT.DOCUMENTS, form);
    }
    uploadDocumentFromUrl(title, url) {
        return this.http.post(constants_1.API_ENDPOINTS.CHATBOT.DOCUMENT_URL, { title, url });
    }
    uploadDocumentFromText(title, content) {
        return this.http.post(constants_1.API_ENDPOINTS.CHATBOT.DOCUMENT_TEXT, { title, content });
    }
    async deleteDocument(documentId) {
        await this.http.del(constants_1.API_ENDPOINTS.CHATBOT.DOCUMENT(documentId));
    }
}
exports.ChatbotClient = ChatbotClient;
//# sourceMappingURL=chatbot-client.js.map