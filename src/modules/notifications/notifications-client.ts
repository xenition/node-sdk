import { Migration } from '../../migrations/types';
import { defineModule, ModuleContext } from '../core';
import {
  fail,
  generateId,
  nowIso,
  optionalNumber,
  optionalPlainObject,
  requireNonEmptyString,
} from '../util';
import {
  ListNotificationsOptions,
  ListNotificationsResult,
  NotificationChannel,
  NotificationPreference,
  NotificationRecord,
  NotifyInput,
  NotifyResult,
  PreferencePatch,
  ScheduleInput,
  ScheduledNotification,
} from './types';

export const NOTIFICATIONS_TABLES = {
  MESSAGES: 'notifications__messages',
  PREFERENCES: 'notifications__preferences',
  SCHEDULED: 'notifications__scheduled',
} as const;

export const NOTIFICATIONS_MIGRATIONS: Migration[] = [
  {
    id: 'notifications/0001_create_notifications__messages',
    sql: `CREATE TABLE IF NOT EXISTS ${NOTIFICATIONS_TABLES.MESSAGES} (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    // The inbox query: one user's feed, newest first.
    id: 'notifications/0002_index_notifications__messages_feed',
    sql: `CREATE INDEX IF NOT EXISTS notifications__messages_feed_idx
  ON ${NOTIFICATIONS_TABLES.MESSAGES} (user_id, created_at DESC)`,
  },
  {
    // Partial: the badge count only ever asks about unread rows, and they
    // are a small minority of a busy inbox.
    id: 'notifications/0003_index_notifications__messages_unread',
    sql: `CREATE INDEX IF NOT EXISTS notifications__messages_unread_idx
  ON ${NOTIFICATIONS_TABLES.MESSAGES} (user_id) WHERE read_at IS NULL`,
  },
  {
    id: 'notifications/0004_create_notifications__preferences',
    sql: `CREATE TABLE IF NOT EXISTS ${NOTIFICATIONS_TABLES.PREFERENCES} (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  in_app boolean NOT NULL DEFAULT true,
  push boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT false,
  quiet_start_minute integer,
  quiet_end_minute integer,
  utc_offset_minutes integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    id: 'notifications/0005_unique_notifications__preferences_user_category',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS notifications__preferences_user_category_idx
  ON ${NOTIFICATIONS_TABLES.PREFERENCES} (user_id, category)`,
  },
  {
    id: 'notifications/0006_create_notifications__scheduled',
    sql: `CREATE TABLE IF NOT EXISTS ${NOTIFICATIONS_TABLES.SCHEDULED} (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  channels jsonb NOT NULL DEFAULT '["in_app","push"]'::jsonb,
  send_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  sent_at timestamptz,
  error text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
)`,
  },
  {
    id: 'notifications/0007_index_notifications__scheduled_due',
    sql: `CREATE INDEX IF NOT EXISTS notifications__scheduled_due_idx
  ON ${NOTIFICATIONS_TABLES.SCHEDULED} (status, send_at)`,
  },
  {
    id: 'notifications/0008_unique_notifications__scheduled_idempotency',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS notifications__scheduled_idempotency_idx
  ON ${NOTIFICATIONS_TABLES.SCHEDULED} (idempotency_key) WHERE idempotency_key IS NOT NULL`,
  },
];

const DEFAULT_CHANNELS: NotificationChannel[] = ['in_app', 'push'];
const ALL_CHANNELS: NotificationChannel[] = ['in_app', 'push', 'email'];
const MINUTES_PER_DAY = 1440;

/**
 * notifications module client — the in-app inbox, preferences, quiet hours
 * and scheduled delivery.
 *
 * `push.send()` is fire-and-forget: it reaches a device, or it does not, and
 * nothing remembers. That is not what an app needs. A user who had their
 * phone off should still see the message; a badge count needs somewhere to
 * count from; "stop nagging me about streaks" must not also silence "your
 * payment failed"; and a 9am reminder has to be decided at 9am, not when the
 * request that wanted it happened to run.
 *
 *   await notifications.notify({
 *     userId, category: 'reminder',
 *     title: 'Practice time', body: 'Your streak is at 6 days',
 *   });
 *
 * Delivery goes through preferences first, then quiet hours, then the
 * channels. A push suppressed by quiet hours is RESCHEDULED rather than
 * dropped — the user asked not to be woken, not to be uninformed.
 */
export class NotificationsClient {
  constructor(private readonly ctx: ModuleContext) {}

  // ────────── Sending ──────────────────────────────────────────────────────

  /**
   * Deliver a notification now, subject to the user's preferences.
   *
   * The in-app row is written even when push is switched off — that is the
   * point of an inbox. Push failure never fails the call: the notification
   * exists, and losing it because a device token went stale would be worse
   * than a silent phone.
   */
  async notify(input: NotifyInput): Promise<NotifyResult> {
    const context = 'NotificationsClient.notify';
    const userId = requireNonEmptyString(context, 'userId', input?.userId);
    const title = requireNonEmptyString(context, 'title', input?.title);
    const body = typeof input?.body === 'string' ? input.body : '';
    const category = input?.category ?? 'general';
    const data = optionalPlainObject(context, 'data', input?.data, {});
    const requested = this.validChannels(context, input?.channels ?? DEFAULT_CHANNELS);

    const preference = await this.getPreference(userId, category);
    const delivered: NotificationChannel[] = [];
    const suppressed: NotificationChannel[] = [];
    const result: NotifyResult = { notification: null, delivered, suppressed };

    for (const channel of requested) {
      if (!this.channelEnabled(preference, channel)) suppressed.push(channel);
    }
    const allowed = requested.filter((channel) => !suppressed.includes(channel));

    if (allowed.includes('in_app')) {
      result.notification = await this.insertMessage({
        userId,
        category,
        title,
        body,
        data,
        expiresAt: input?.expiresAt ?? null,
      });
      delivered.push('in_app');
    }

    if (allowed.includes('push')) {
      const quietUntil = input?.ignoreQuietHours
        ? null
        : quietHoursEndAt(preference, new Date());
      if (quietUntil) {
        // Deferred, not dropped: the user asked not to be woken, not to be
        // left uninformed.
        suppressed.push('push');
        result.deferredUntil = quietUntil;
        await this.schedule({
          userId,
          category,
          title,
          body,
          data,
          channels: ['push'],
          sendAt: quietUntil,
        });
      } else {
        const sent = await this.sendPush(userId, title, body, data);
        if (sent) {
          delivered.push('push');
          result.push = sent;
        } else {
          suppressed.push('push');
        }
      }
    }

    if (allowed.includes('email')) {
      // Email needs an address the module does not hold; a caller wanting it
      // supplies the channel AND the platform's email client through the
      // module context. Absent that, it is reported rather than pretended.
      suppressed.push('email');
    }

    return result;
  }

  /** Queue a notification for later. The cron drains it with `dispatchDue`. */
  async schedule(input: ScheduleInput): Promise<ScheduledNotification> {
    const context = 'NotificationsClient.schedule';
    const userId = requireNonEmptyString(context, 'userId', input?.userId);
    const title = requireNonEmptyString(context, 'title', input?.title);
    const sendAt = input?.sendAt;
    if (typeof sendAt !== 'string' || !Number.isFinite(Date.parse(sendAt))) {
      fail(context, '"sendAt" must be an ISO timestamp string');
    }
    const idempotencyKey = input?.idempotencyKey ?? null;
    if (idempotencyKey) {
      const existing = await this.ctx.query
        .from(NOTIFICATIONS_TABLES.SCHEDULED)
        .where('idempotency_key', idempotencyKey)
        .first<ScheduledNotification>();
      if (existing) return existing;
    }

    const record: ScheduledNotification = {
      id: generateId(),
      user_id: userId,
      category: input?.category ?? 'general',
      title,
      body: typeof input?.body === 'string' ? input.body : '',
      data: optionalPlainObject(context, 'data', input?.data, {}),
      channels: this.validChannels(context, input?.channels ?? DEFAULT_CHANNELS),
      send_at: sendAt,
      status: 'pending',
      sent_at: null,
      error: null,
      idempotency_key: idempotencyKey,
      created_at: nowIso(),
    };
    const { created_at: _omitted, ...row } = record;
    await this.ctx.query.from(NOTIFICATIONS_TABLES.SCHEDULED).insert(row).execute();
    return record;
  }

  /**
   * Deliver everything now due. Call from the scheduled handler.
   *
   * Each row is marked before its send is attempted, so a crash mid-batch
   * cannot resend what already went out — a duplicate push is far more
   * annoying than a missing one.
   */
  async dispatchDue(limit = 100): Promise<{ sent: number; failed: number }> {
    const due = await this.ctx.query
      .from(NOTIFICATIONS_TABLES.SCHEDULED)
      .where('status', 'pending')
      .where('send_at', '<=', nowIso())
      .orderBy('send_at', 'ASC')
      .limit(limit)
      .rows<ScheduledNotification>();

    let sent = 0;
    let failed = 0;
    for (const row of due) {
      await this.ctx.query
        .from(NOTIFICATIONS_TABLES.SCHEDULED)
        .update({ status: 'sent', sent_at: nowIso() })
        .where('id', row.id)
        .execute();
      try {
        await this.notify({
          userId: row.user_id,
          category: row.category,
          title: row.title,
          body: row.body,
          data: row.data,
          channels: normalizeChannels(row.channels),
          // Already deferred once by quiet hours; deferring again would
          // loop it to the next night, and the next.
          ignoreQuietHours: true,
        });
        sent++;
      } catch (err) {
        failed++;
        await this.ctx.query
          .from(NOTIFICATIONS_TABLES.SCHEDULED)
          .update({ status: 'failed', error: String(err) })
          .where('id', row.id)
          .execute();
      }
    }
    return { sent, failed };
  }

  /** Cancel a pending scheduled notification. */
  async cancelScheduled(id: string): Promise<void> {
    requireNonEmptyString('NotificationsClient.cancelScheduled', 'id', id);
    await this.ctx.query
      .from(NOTIFICATIONS_TABLES.SCHEDULED)
      .update({ status: 'cancelled' })
      .where('id', id)
      .where('status', 'pending')
      .execute();
  }

  // ────────── Inbox ────────────────────────────────────────────────────────

  /**
   * One user's feed, newest first, keyset-paginated.
   *
   * `before` rather than an offset: an inbox is written to while it is read,
   * and offset paging in that situation silently skips and duplicates rows.
   */
  async list(
    userId: string,
    options: ListNotificationsOptions = {},
  ): Promise<ListNotificationsResult> {
    const context = 'NotificationsClient.list';
    requireNonEmptyString(context, 'userId', userId);
    const limit = optionalNumber(context, 'limit', options.limit, 25);

    let q = this.ctx.query.from(NOTIFICATIONS_TABLES.MESSAGES).where('user_id', userId);
    if (options.unreadOnly) q = q.whereNull('read_at');
    if (options.category) q = q.where('category', options.category);
    if (options.before) q = q.where('created_at', '<', options.before);

    // One extra row answers "is there another page?" without a count query.
    const rows = await q.orderBy('created_at', 'DESC').limit(limit + 1).rows<NotificationRecord>();
    const page = rows.slice(0, limit).filter((row) => !isExpired(row.expires_at));
    return {
      notifications: page,
      nextCursor: rows.length > limit ? (page[page.length - 1]?.created_at ?? null) : null,
    };
  }

  /** Badge count. */
  async unreadCount(userId: string): Promise<number> {
    requireNonEmptyString('NotificationsClient.unreadCount', 'userId', userId);
    const rows = await this.ctx.query
      .from(NOTIFICATIONS_TABLES.MESSAGES)
      .where('user_id', userId)
      .whereNull('read_at')
      .rows<{ id: string; expires_at: string | null }>();
    return rows.filter((row) => !isExpired(row.expires_at)).length;
  }

  /** Mark one as read. Scoped by user so an id alone is not enough. */
  async markRead(userId: string, id: string): Promise<void> {
    const context = 'NotificationsClient.markRead';
    requireNonEmptyString(context, 'userId', userId);
    requireNonEmptyString(context, 'id', id);
    await this.ctx.query
      .from(NOTIFICATIONS_TABLES.MESSAGES)
      .update({ read_at: nowIso() })
      .where('id', id)
      .where('user_id', userId)
      .execute();
  }

  async markAllRead(userId: string): Promise<void> {
    requireNonEmptyString('NotificationsClient.markAllRead', 'userId', userId);
    await this.ctx.query
      .from(NOTIFICATIONS_TABLES.MESSAGES)
      .update({ read_at: nowIso() })
      .where('user_id', userId)
      .whereNull('read_at')
      .execute();
  }

  // ────────── Preferences ──────────────────────────────────────────────────

  /**
   * The user's settings for a category, or the defaults.
   *
   * Absence means "has not chosen", which is opted IN for in-app and push
   * and OUT for email. A row is only written when someone actually changes
   * something, so the defaults stay changeable later.
   */
  async getPreference(userId: string, category = 'general'): Promise<NotificationPreference> {
    const row = await this.ctx.query
      .from(NOTIFICATIONS_TABLES.PREFERENCES)
      .where('user_id', userId)
      .where('category', category)
      .first<NotificationPreference>();
    return row ?? defaultPreference(userId, category);
  }

  async listPreferences(userId: string): Promise<NotificationPreference[]> {
    requireNonEmptyString('NotificationsClient.listPreferences', 'userId', userId);
    return this.ctx.query
      .from(NOTIFICATIONS_TABLES.PREFERENCES)
      .where('user_id', userId)
      .orderBy('category', 'ASC')
      .rows<NotificationPreference>();
  }

  async setPreference(
    userId: string,
    category: string,
    patch: PreferencePatch,
  ): Promise<NotificationPreference> {
    const context = 'NotificationsClient.setPreference';
    requireNonEmptyString(context, 'userId', userId);
    requireNonEmptyString(context, 'category', category);
    for (const field of ['quietStartMinute', 'quietEndMinute'] as const) {
      const value = patch?.[field];
      if (value !== undefined && value !== null) {
        if (!Number.isInteger(value) || value < 0 || value >= MINUTES_PER_DAY) {
          fail(context, `"${field}" must be an integer between 0 and 1439`);
        }
      }
    }

    const existing = await this.ctx.query
      .from(NOTIFICATIONS_TABLES.PREFERENCES)
      .where('user_id', userId)
      .where('category', category)
      .first<NotificationPreference>();
    const base = existing ?? defaultPreference(userId, category);
    const merged: NotificationPreference = {
      ...base,
      in_app: patch?.in_app ?? base.in_app,
      push: patch?.push ?? base.push,
      email: patch?.email ?? base.email,
      quiet_start_minute:
        patch?.quietStartMinute === undefined ? base.quiet_start_minute : patch.quietStartMinute,
      quiet_end_minute:
        patch?.quietEndMinute === undefined ? base.quiet_end_minute : patch.quietEndMinute,
      utc_offset_minutes: patch?.utcOffsetMinutes ?? base.utc_offset_minutes,
      updated_at: nowIso(),
    };

    if (existing) {
      const { id: _id, user_id: _u, category: _c, ...fields } = merged;
      await this.ctx.query
        .from(NOTIFICATIONS_TABLES.PREFERENCES)
        .update(fields)
        .where('id', existing.id)
        .execute();
    } else {
      const { updated_at: _omitted, ...row } = merged;
      await this.ctx.query.from(NOTIFICATIONS_TABLES.PREFERENCES).insert(row).execute();
    }
    return merged;
  }

  // ────────── Internals ────────────────────────────────────────────────────

  private async insertMessage(input: {
    userId: string;
    category: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
    expiresAt: string | null;
  }): Promise<NotificationRecord> {
    const record: NotificationRecord = {
      id: generateId(),
      user_id: input.userId,
      category: input.category,
      title: input.title,
      body: input.body,
      data: input.data,
      read_at: null,
      expires_at: input.expiresAt,
      created_at: nowIso(),
    };
    const { created_at: _omitted, ...row } = record;
    await this.ctx.query.from(NOTIFICATIONS_TABLES.MESSAGES).insert(row).execute();
    return record;
  }

  /**
   * Send to every device the user has registered.
   *
   * Returns null when there is no push client in the context — a local run
   * with no platform credentials should still write the inbox rather than
   * throw. A push failure is swallowed for the same reason: the
   * notification exists, and losing it to a stale device token would be the
   * worse outcome.
   */
  private async sendPush(
    userId: string,
    title: string,
    body: string,
    data: Record<string, unknown>,
  ): Promise<{ sent: number; failed: number } | null> {
    if (!this.ctx.push) return null;
    try {
      const result = await this.ctx.push.send({
        targets: { userId },
        notification: { title, body },
        data: stringValues(data),
      });
      return { sent: result.sent, failed: result.failed };
    } catch {
      return null;
    }
  }

  private channelEnabled(
    preference: NotificationPreference,
    channel: NotificationChannel,
  ): boolean {
    if (channel === 'in_app') return preference.in_app;
    if (channel === 'push') return preference.push;
    return preference.email;
  }

  private validChannels(context: string, channels: NotificationChannel[]): NotificationChannel[] {
    if (!Array.isArray(channels) || channels.length === 0) {
      fail(context, '"channels" must be a non-empty array');
    }
    for (const channel of channels) {
      if (!ALL_CHANNELS.includes(channel)) {
        fail(context, `"channels" must contain only ${ALL_CHANNELS.join(', ')}`);
      }
    }
    return channels;
  }
}

/* ── helpers ───────────────────────────────────────────────────────────── */

function defaultPreference(userId: string, category: string): NotificationPreference {
  return {
    id: generateId(),
    user_id: userId,
    category,
    in_app: true,
    push: true,
    // Email is opt-in. Defaulting it on is how an app earns a spam
    // reputation before anyone notices.
    email: false,
    quiet_start_minute: null,
    quiet_end_minute: null,
    utc_offset_minutes: 0,
    updated_at: nowIso(),
  };
}

/**
 * When quiet hours end, or null if they are not in effect.
 *
 * The wrap-around window (22:00 → 07:00) is why quiet hours are stored as
 * minutes: `start > end` simply means the window crosses midnight, and both
 * cases are one comparison instead of date arithmetic.
 */
export function quietHoursEndAt(
  preference: Pick<
    NotificationPreference,
    'quiet_start_minute' | 'quiet_end_minute' | 'utc_offset_minutes'
  >,
  now: Date,
): string | null {
  const { quiet_start_minute: start, quiet_end_minute: end } = preference;
  if (start === null || end === null || start === end) return null;

  const offset = preference.utc_offset_minutes ?? 0;
  const localNow = new Date(now.getTime() + offset * 60_000);
  const minute = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();

  const insideWindow = start < end ? minute >= start && minute < end : minute >= start || minute < end;
  if (!insideWindow) return null;

  // The next occurrence of `end` in local time, converted back to UTC.
  const endToday = new Date(localNow);
  endToday.setUTCHours(Math.floor(end / 60), end % 60, 0, 0);
  if (endToday.getTime() <= localNow.getTime()) {
    endToday.setUTCDate(endToday.getUTCDate() + 1);
  }
  return new Date(endToday.getTime() - offset * 60_000).toISOString();
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at <= Date.now();
}

/** Push `data` is string-valued on both APNs and FCM. */
function stringValues(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}

function normalizeChannels(value: unknown): NotificationChannel[] {
  if (!Array.isArray(value)) return DEFAULT_CHANNELS;
  const channels = value.filter((v): v is NotificationChannel =>
    ALL_CHANNELS.includes(v as NotificationChannel),
  );
  return channels.length > 0 ? channels : DEFAULT_CHANNELS;
}

export const notificationsModule = defineModule<NotificationsClient>({
  name: 'notifications',
  migrations: NOTIFICATIONS_MIGRATIONS,
  factory: (ctx: ModuleContext) => new NotificationsClient(ctx),
});
