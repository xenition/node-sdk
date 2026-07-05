import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';
import { SendBulkResult, SendEmailOptions, SendEmailResult } from './types';

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
export class EmailClient {
  constructor(private readonly http: HttpClient) {}

  async send(
    to: string | string[],
    subject: string,
    html: string,
    options: SendEmailOptions = {},
  ): Promise<SendEmailResult> {
    const body = { to, subject, html, ...options };
    return this.http.post<SendEmailResult>(API_ENDPOINTS.EMAIL.SEND, body);
  }

  async sendBulk(
    recipients: string[],
    subject: string,
    html: string,
    options: SendEmailOptions = {},
  ): Promise<SendBulkResult> {
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new Error(
        'EmailClient.sendBulk: recipients must be a non-empty array',
      );
    }
    const body = { recipients, subject, html, ...options };
    return this.http.post<SendBulkResult>(
      API_ENDPOINTS.EMAIL.SEND_BULK,
      body,
    );
  }
}
