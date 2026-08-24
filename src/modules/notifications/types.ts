/**
 * Types for the notifications module — the in-app inbox, per-user
 * preferences, and scheduled delivery.
 */

/** Where a notification can land. */
export type NotificationChannel = 'in_app' | 'push' | 'email';

export interface NotificationRecord {
  id: string;
  user_id: string;
  /**
   * What KIND of notification this is — 'reminder', 'social', 'billing'.
   * Preferences and quiet hours are per category, because "stop nagging me
   * about streaks" must not also silence "your payment failed".
   */
  category: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  /** Past this, the inbox hides it. Null for permanent. */
  expires_at: string | null;
}

export interface NotifyInput {
  userId: string;
  category?: string;
  title: string;
  body: string;
  /** Delivered to the device as push `data` and stored on the inbox row. */
  data?: Record<string, unknown>;
  /** Defaults to in_app + push. Email is opt-in per call. */
  channels?: NotificationChannel[];
  expiresAt?: string | null;
  /** Skip the quiet-hours check. Only for genuinely urgent categories. */
  ignoreQuietHours?: boolean;
}

export interface NotifyResult {
  /** The inbox row, when in_app was among the channels. */
  notification: NotificationRecord | null;
  /** Channels actually used, after preferences and quiet hours. */
  delivered: NotificationChannel[];
  /** Channels the user has switched off, or that quiet hours deferred. */
  suppressed: NotificationChannel[];
  /** Set when push was attempted. */
  push?: { sent: number; failed: number };
  /** When quiet hours deferred the push, the scheduled row that will retry. */
  deferredUntil?: string | null;
}

export interface NotificationPreference {
  id: string;
  user_id: string;
  category: string;
  in_app: boolean;
  push: boolean;
  email: boolean;
  /**
   * Local quiet window as minutes past midnight, or null for none. Stored
   * as minutes rather than a time so the wrap-around case (22:00 → 07:00)
   * is plain arithmetic instead of date handling.
   */
  quiet_start_minute: number | null;
  quiet_end_minute: number | null;
  /** Minutes to ADD to UTC to get the user's local time. */
  utc_offset_minutes: number;
  updated_at: string;
}

export interface PreferencePatch {
  in_app?: boolean;
  push?: boolean;
  email?: boolean;
  quietStartMinute?: number | null;
  quietEndMinute?: number | null;
  utcOffsetMinutes?: number;
}

export type ScheduledStatus = 'pending' | 'sent' | 'cancelled' | 'failed';

export interface ScheduledNotification {
  id: string;
  user_id: string;
  category: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  channels: NotificationChannel[];
  send_at: string;
  status: ScheduledStatus;
  sent_at: string | null;
  error: string | null;
  /** Caller-supplied dedupe key, so a re-run does not schedule twice. */
  idempotency_key: string | null;
  created_at: string;
}

export interface ScheduleInput extends NotifyInput {
  /** ISO timestamp to deliver at. */
  sendAt: string;
  idempotencyKey?: string;
}

export interface ListNotificationsOptions {
  unreadOnly?: boolean;
  category?: string;
  limit?: number;
  /**
   * Keyset cursor — the `created_at` of the last row you saw. Offsets skip
   * and duplicate rows in a feed that is being written to while it is read.
   */
  before?: string;
}

export interface ListNotificationsResult {
  notifications: NotificationRecord[];
  /** Pass back as `before` for the next page. Null when the feed is done. */
  nextCursor: string | null;
}
