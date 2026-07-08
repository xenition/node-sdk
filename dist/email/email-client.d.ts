import { HttpClient } from '../core/http-client';
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
export declare class EmailClient {
    private readonly http;
    constructor(http: HttpClient);
    send(to: string | string[], subject: string, html: string, options?: SendEmailOptions): Promise<SendEmailResult>;
    sendBulk(recipients: string[], subject: string, html: string, options?: SendEmailOptions): Promise<SendBulkResult>;
}
//# sourceMappingURL=email-client.d.ts.map