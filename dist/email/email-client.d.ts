import { HttpClient } from '../core/http-client';
import { SendBulkResult, SendEmailOptions, SendEmailResult } from './types';
/**
 * Transactional email, delivered through the platform's SES sender and
 * logged per recipient under Manage → Email.
 *
 * SERVER-SIDE ONLY: both methods need a service key. An anon key ships in
 * every browser bundle, and a send route behind it would let anyone mail
 * anyone as your app.
 *
 * Limits per app: 50 recipients per request, 100 sends an hour, 1,000 a day.
 * A request that does not fit is refused whole (`RATE_LIMITED`) rather than
 * half-sent. The From address is the platform's; `from` sets only the display
 * name (your app's name by default) and `replyTo` is where answers go.
 *
 * A provider failure is a result, not a throw: `status: 'failed'` with the
 * reason in `error`.
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