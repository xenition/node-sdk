/**
 * Wire contract for `/app-platform/email/*`. Mirrors the xenition backend's
 * `modules/app-platform-email/` types.
 */

export interface SendEmailOptions {
  text?: string;
  replyTo?: string;
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
