/**
 * Wire contract for `/app-platform/email/*`. Mirrors the xenition backend's
 * `modules/app-platform-email/` types.
 */

export interface SendEmailOptions {
  /** Plain-text alternative for clients that do not render HTML. */
  text?: string;
  /** Where replies go. The From address itself is always the platform's. */
  replyTo?: string;
  /** Sender display name. Defaults to the app's name; an email address here is refused. */
  from?: string;
}

export interface SendEmailResult {
  id: string;           // app_email_logs.id
  status: 'sent' | 'failed';
  messageId: string | null;  // SES message ID on success
  error?: string;
}

export interface SendBulkResult {
  sent: number;
  failed: number;
  results: SendEmailResult[];
}
