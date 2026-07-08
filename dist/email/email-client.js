"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailClient = void 0;
const constants_1 = require("../constants");
/**
 * Transactional email. Wraps xenition's SES-backed EmailService behind an
 * app-scoped quota + audit log. Rate-limited to 100 sends / hour per app
 * by default (configurable per app via the seller dashboard).
 *
 *   await client.email.send('alice@example.com', 'Welcome!', '<p>Hi</p>')
 *   await client.email.sendBulk(['a@x.com','b@x.com'], subject, html)
 *
 * Bulk is a server-side fan-out: one API call, one row per recipient in
 * `app_email_logs`. Subjects and HTML bodies are identical across the
 * batch — per-recipient personalization is the caller's job (the server
 * does not template).
 */
class EmailClient {
    constructor(http) {
        this.http = http;
    }
    async send(to, subject, html, options = {}) {
        const body = { to, subject, html, ...options };
        return this.http.post(constants_1.API_ENDPOINTS.EMAIL.SEND, body);
    }
    async sendBulk(recipients, subject, html, options = {}) {
        if (!Array.isArray(recipients) || recipients.length === 0) {
            throw new Error('EmailClient.sendBulk: recipients must be a non-empty array');
        }
        const body = { recipients, subject, html, ...options };
        return this.http.post(constants_1.API_ENDPOINTS.EMAIL.SEND_BULK, body);
    }
}
exports.EmailClient = EmailClient;
//# sourceMappingURL=email-client.js.map