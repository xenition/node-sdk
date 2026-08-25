import { Migration } from '../../migrations/types';
import { ModuleContext } from '../core';
import { ListNotificationsOptions, ListNotificationsResult, NotificationPreference, NotifyInput, NotifyResult, PreferencePatch, ScheduleInput, ScheduledNotification } from './types';
export declare const NOTIFICATIONS_TABLES: {
    readonly MESSAGES: "notifications__messages";
    readonly PREFERENCES: "notifications__preferences";
    readonly SCHEDULED: "notifications__scheduled";
};
export declare const NOTIFICATIONS_MIGRATIONS: Migration[];
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
export declare class NotificationsClient {
    private readonly ctx;
    constructor(ctx: ModuleContext);
    /**
     * Deliver a notification now, subject to the user's preferences.
     *
     * The in-app row is written even when push is switched off — that is the
     * point of an inbox. Push failure never fails the call: the notification
     * exists, and losing it because a device token went stale would be worse
     * than a silent phone.
     */
    notify(input: NotifyInput): Promise<NotifyResult>;
    /** Queue a notification for later. The cron drains it with `dispatchDue`. */
    schedule(input: ScheduleInput): Promise<ScheduledNotification>;
    /**
     * Deliver everything now due. Call from the scheduled handler.
     *
     * Each row is marked before its send is attempted, so a crash mid-batch
     * cannot resend what already went out — a duplicate push is far more
     * annoying than a missing one.
     */
    dispatchDue(limit?: number): Promise<{
        sent: number;
        failed: number;
    }>;
    /** Cancel a pending scheduled notification. */
    cancelScheduled(id: string): Promise<void>;
    /**
     * One user's feed, newest first, keyset-paginated.
     *
     * `before` rather than an offset: an inbox is written to while it is read,
     * and offset paging in that situation silently skips and duplicates rows.
     */
    list(userId: string, options?: ListNotificationsOptions): Promise<ListNotificationsResult>;
    /** Badge count. */
    unreadCount(userId: string): Promise<number>;
    /** Mark one as read. Scoped by user so an id alone is not enough. */
    markRead(userId: string, id: string): Promise<void>;
    markAllRead(userId: string): Promise<void>;
    /**
     * The user's settings for a category, or the defaults.
     *
     * Absence means "has not chosen", which is opted IN for in-app and push
     * and OUT for email. A row is only written when someone actually changes
     * something, so the defaults stay changeable later.
     */
    getPreference(userId: string, category?: string): Promise<NotificationPreference>;
    listPreferences(userId: string): Promise<NotificationPreference[]>;
    setPreference(userId: string, category: string, patch: PreferencePatch): Promise<NotificationPreference>;
    private insertMessage;
    /**
     * Send to every device the user has registered.
     *
     * Returns null when there is no push client in the context — a local run
     * with no platform credentials should still write the inbox rather than
     * throw. A push failure is swallowed for the same reason: the
     * notification exists, and losing it to a stale device token would be the
     * worse outcome.
     */
    private sendPush;
    private channelEnabled;
    private validChannels;
}
/**
 * When quiet hours end, or null if they are not in effect.
 *
 * The wrap-around window (22:00 → 07:00) is why quiet hours are stored as
 * minutes: `start > end` simply means the window crosses midnight, and both
 * cases are one comparison instead of date arithmetic.
 */
export declare function quietHoursEndAt(preference: Pick<NotificationPreference, 'quiet_start_minute' | 'quiet_end_minute' | 'utc_offset_minutes'>, now: Date): string | null;
export declare const notificationsModule: import("../core").ModuleDefinition<NotificationsClient>;
//# sourceMappingURL=notifications-client.d.ts.map