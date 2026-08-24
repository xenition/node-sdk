import { makeFakeContext } from '../../testing/fake-store';
import { PushClient } from '../../push/push-client';
import {
  NotificationsClient,
  NOTIFICATIONS_TABLES,
  quietHoursEndAt,
} from './notifications-client';
import { NotificationRecord, ScheduledNotification } from './types';

const makeNotifications = (withPush = true) => {
  const { store, ctx } = makeFakeContext();
  const send = jest.fn().mockResolvedValue({ sent: 1, failed: 0, skipped: 0, results: [] });
  const notifications = new NotificationsClient({
    ...ctx,
    push: withPush ? ({ send } as unknown as PushClient) : undefined,
  });
  return { store, send, notifications };
};

const messages = (store: ReturnType<typeof makeFakeContext>['store']) =>
  store.rows(NOTIFICATIONS_TABLES.MESSAGES) as unknown as NotificationRecord[];
const scheduled = (store: ReturnType<typeof makeFakeContext>['store']) =>
  store.rows(NOTIFICATIONS_TABLES.SCHEDULED) as unknown as ScheduledNotification[];

const NOTIFY = { userId: 'user-1', title: 'Practice time', body: 'Streak at 6 days' };

describe('notify', () => {
  it('writes the inbox row and sends a push by default', async () => {
    const { store, send, notifications } = makeNotifications();
    const result = await notifications.notify(NOTIFY);

    expect(result.delivered).toEqual(['in_app', 'push']);
    expect(messages(store)).toHaveLength(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ targets: { userId: 'user-1' } }),
    );
  });

  it('still writes the inbox when push is switched off', async () => {
    // That is the point of an inbox.
    const { store, send, notifications } = makeNotifications();
    await notifications.setPreference('user-1', 'general', { push: false });

    const result = await notifications.notify(NOTIFY);
    expect(result.delivered).toEqual(['in_app']);
    expect(result.suppressed).toContain('push');
    expect(messages(store)).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps categories independent', async () => {
    // "Stop nagging me about streaks" must not silence "your payment failed".
    const { send, notifications } = makeNotifications();
    await notifications.setPreference('user-1', 'reminder', { push: false });

    await notifications.notify({ ...NOTIFY, category: 'reminder' });
    expect(send).not.toHaveBeenCalled();

    await notifications.notify({ ...NOTIFY, category: 'billing' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a push failure never loses the notification', async () => {
    const { store, send, notifications } = makeNotifications();
    (send as jest.Mock).mockRejectedValue(new Error('APNs down'));

    const result = await notifications.notify(NOTIFY);
    expect(messages(store)).toHaveLength(1);
    expect(result.suppressed).toContain('push');
  });

  it('works with no push client at all', async () => {
    // A local run without platform credentials should still write the inbox.
    const { store, notifications } = makeNotifications(false);
    const result = await notifications.notify(NOTIFY);
    expect(messages(store)).toHaveLength(1);
    expect(result.delivered).toEqual(['in_app']);
  });

  it('stringifies push data, which both APNs and FCM require', async () => {
    const { send, notifications } = makeNotifications();
    await notifications.notify({ ...NOTIFY, data: { sessionId: 's1', count: 3 } });
    expect((send as jest.Mock).mock.calls[0][0].data).toEqual({ sessionId: 's1', count: '3' });
  });

  it('validates its input', async () => {
    const { notifications } = makeNotifications();
    await expect(notifications.notify({ ...NOTIFY, userId: '' })).rejects.toThrow(/"userId"/);
    await expect(notifications.notify({ ...NOTIFY, title: '' })).rejects.toThrow(/"title"/);
    await expect(
      notifications.notify({ ...NOTIFY, channels: ['carrier-pigeon' as never] }),
    ).rejects.toThrow(/"channels" must contain only/);
  });
});

describe('quiet hours', () => {
  const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 7, 24, hour, minute));

  it('is inactive when no window is set', () => {
    expect(
      quietHoursEndAt(
        { quiet_start_minute: null, quiet_end_minute: null, utc_offset_minutes: 0 },
        at(3),
      ),
    ).toBeNull();
  });

  it('handles a window that crosses midnight', () => {
    // 22:00 → 07:00 is the normal case and the one naive comparisons break.
    const window = { quiet_start_minute: 22 * 60, quiet_end_minute: 7 * 60, utc_offset_minutes: 0 };
    expect(quietHoursEndAt(window, at(23))).toBe('2026-08-25T07:00:00.000Z');
    expect(quietHoursEndAt(window, at(3))).toBe('2026-08-24T07:00:00.000Z');
    expect(quietHoursEndAt(window, at(12))).toBeNull();
  });

  it('handles a same-day window', () => {
    const window = { quiet_start_minute: 9 * 60, quiet_end_minute: 17 * 60, utc_offset_minutes: 0 };
    expect(quietHoursEndAt(window, at(10))).toBe('2026-08-24T17:00:00.000Z');
    expect(quietHoursEndAt(window, at(20))).toBeNull();
  });

  it('respects the user’s offset', () => {
    // 03:00 UTC is 09:00 in a +360 zone, which is outside a 22:00–07:00 window.
    const window = {
      quiet_start_minute: 22 * 60,
      quiet_end_minute: 7 * 60,
      utc_offset_minutes: 360,
    };
    expect(quietHoursEndAt(window, at(3))).toBeNull();
    expect(quietHoursEndAt(window, at(20))).not.toBeNull();
  });

  it('defers a push instead of dropping it', async () => {
    // The user asked not to be woken, not to be left uninformed.
    const { store, send, notifications } = makeNotifications();
    await notifications.setPreference('user-1', 'general', {
      quietStartMinute: 0,
      quietEndMinute: 1439,
    });

    const result = await notifications.notify(NOTIFY);
    expect(send).not.toHaveBeenCalled();
    expect(result.deferredUntil).toBeTruthy();
    expect(scheduled(store)).toHaveLength(1);
    expect(scheduled(store)[0]).toMatchObject({ channels: ['push'], status: 'pending' });
    // The in-app copy is available immediately regardless.
    expect(messages(store)).toHaveLength(1);
  });

  it('lets an urgent category ignore quiet hours', async () => {
    const { send, notifications } = makeNotifications();
    await notifications.setPreference('user-1', 'general', {
      quietStartMinute: 0,
      quietEndMinute: 1439,
    });
    await notifications.notify({ ...NOTIFY, ignoreQuietHours: true });
    expect(send).toHaveBeenCalled();
  });
});

describe('scheduling', () => {
  const TOMORROW = () => new Date(Date.now() + 86_400_000).toISOString();
  const YESTERDAY = () => new Date(Date.now() - 86_400_000).toISOString();

  it('queues for later without delivering now', async () => {
    const { store, send, notifications } = makeNotifications();
    await notifications.schedule({ ...NOTIFY, sendAt: TOMORROW() });
    expect(send).not.toHaveBeenCalled();
    expect(messages(store)).toHaveLength(0);
    expect(scheduled(store)).toHaveLength(1);
  });

  it('dispatches only what is due', async () => {
    const { send, notifications } = makeNotifications();
    await notifications.schedule({ ...NOTIFY, sendAt: YESTERDAY() });
    await notifications.schedule({ ...NOTIFY, sendAt: TOMORROW() });

    const summary = await notifications.dispatchDue();
    expect(summary).toEqual({ sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('marks a row before sending, so a crash cannot resend it', async () => {
    // A duplicate push is far more annoying than a missing one.
    const { store, notifications } = makeNotifications();
    await notifications.schedule({ ...NOTIFY, sendAt: YESTERDAY() });
    await notifications.dispatchDue();
    expect(scheduled(store)[0]).toMatchObject({ status: 'sent' });

    const second = await notifications.dispatchDue();
    expect(second.sent).toBe(0);
  });

  it('does not re-defer an already deferred push into the next night', async () => {
    const { send, notifications } = makeNotifications();
    await notifications.setPreference('user-1', 'general', {
      quietStartMinute: 0,
      quietEndMinute: 1439,
    });
    await notifications.schedule({ ...NOTIFY, channels: ['push'], sendAt: YESTERDAY() });
    await notifications.dispatchDue();
    expect(send).toHaveBeenCalled();
  });

  it('returns the existing row for a repeated idempotency key', async () => {
    const { store, notifications } = makeNotifications();
    const first = await notifications.schedule({
      ...NOTIFY,
      sendAt: TOMORROW(),
      idempotencyKey: 'daily-2026-08-24',
    });
    const second = await notifications.schedule({
      ...NOTIFY,
      sendAt: TOMORROW(),
      idempotencyKey: 'daily-2026-08-24',
    });
    expect(second.id).toBe(first.id);
    expect(scheduled(store)).toHaveLength(1);
  });

  it('cancels a pending row', async () => {
    const { store, notifications } = makeNotifications();
    const row = await notifications.schedule({ ...NOTIFY, sendAt: YESTERDAY() });
    await notifications.cancelScheduled(row.id);
    expect(await notifications.dispatchDue()).toEqual({ sent: 0, failed: 0 });
    expect(scheduled(store)[0]).toMatchObject({ status: 'cancelled' });
  });

  it('rejects a bad sendAt', async () => {
    const { notifications } = makeNotifications();
    await expect(notifications.schedule({ ...NOTIFY, sendAt: 'tomorrow' })).rejects.toThrow(
      /"sendAt" must be an ISO timestamp/,
    );
  });
});

describe('inbox', () => {
  const seed = async (n: number) => {
    const made = makeNotifications();
    for (let i = 0; i < n; i++) {
      await made.notifications.notify({ ...NOTIFY, title: `n${i}`, channels: ['in_app'] });
      // Distinct created_at values, since the cursor is keyset on them.
      const rows = messages(made.store);
      rows[rows.length - 1]!.created_at = new Date(Date.now() - (n - i) * 1000).toISOString();
    }
    return made;
  };

  it('pages newest first with a keyset cursor', async () => {
    const { notifications } = await seed(5);
    const first = await notifications.list('user-1', { limit: 2 });
    expect(first.notifications.map((n) => n.title)).toEqual(['n4', 'n3']);
    expect(first.nextCursor).toBeTruthy();

    const second = await notifications.list('user-1', { limit: 2, before: first.nextCursor! });
    expect(second.notifications.map((n) => n.title)).toEqual(['n2', 'n1']);
  });

  it('reports no cursor on the last page', async () => {
    const { notifications } = await seed(2);
    expect((await notifications.list('user-1', { limit: 10 })).nextCursor).toBeNull();
  });

  it('counts and clears unread', async () => {
    const { store, notifications } = await seed(3);
    expect(await notifications.unreadCount('user-1')).toBe(3);

    await notifications.markRead('user-1', messages(store)[0]!.id);
    expect(await notifications.unreadCount('user-1')).toBe(2);

    await notifications.markAllRead('user-1');
    expect(await notifications.unreadCount('user-1')).toBe(0);
  });

  it('will not let one user mark another’s notification read', async () => {
    const { store, notifications } = await seed(1);
    await notifications.markRead('someone-else', messages(store)[0]!.id);
    expect(await notifications.unreadCount('user-1')).toBe(1);
  });

  it('filters to unread and by category', async () => {
    const { store, notifications } = makeNotifications();
    await notifications.notify({ ...NOTIFY, category: 'billing', channels: ['in_app'] });
    await notifications.notify({ ...NOTIFY, category: 'reminder', channels: ['in_app'] });
    await notifications.markRead('user-1', messages(store)[0]!.id);

    expect((await notifications.list('user-1', { unreadOnly: true })).notifications).toHaveLength(1);
    expect(
      (await notifications.list('user-1', { category: 'billing' })).notifications,
    ).toHaveLength(1);
  });

  it('hides expired notifications from the feed and the badge', async () => {
    const { store, notifications } = makeNotifications();
    await notifications.notify({
      ...NOTIFY,
      channels: ['in_app'],
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(messages(store)).toHaveLength(1);
    expect((await notifications.list('user-1')).notifications).toHaveLength(0);
    expect(await notifications.unreadCount('user-1')).toBe(0);
  });
});

describe('preferences', () => {
  it('defaults to in-app and push on, email off', async () => {
    // Email defaulting on is how an app earns a spam reputation.
    const { notifications } = makeNotifications();
    expect(await notifications.getPreference('user-1')).toMatchObject({
      in_app: true,
      push: true,
      email: false,
    });
  });

  it('writes no row until something is actually chosen', async () => {
    // So the defaults stay changeable later.
    const { store, notifications } = makeNotifications();
    await notifications.getPreference('user-1');
    expect(store.rows(NOTIFICATIONS_TABLES.PREFERENCES)).toHaveLength(0);
  });

  it('merges a patch and keeps one row per category', async () => {
    const { store, notifications } = makeNotifications();
    await notifications.setPreference('user-1', 'reminder', { push: false });
    await notifications.setPreference('user-1', 'reminder', { email: true });

    expect(store.rows(NOTIFICATIONS_TABLES.PREFERENCES)).toHaveLength(1);
    expect(await notifications.getPreference('user-1', 'reminder')).toMatchObject({
      push: false,
      email: true,
      in_app: true,
    });
  });

  it('lists every category the user has touched', async () => {
    const { notifications } = makeNotifications();
    await notifications.setPreference('user-1', 'reminder', { push: false });
    await notifications.setPreference('user-1', 'billing', { push: true });
    expect(await notifications.listPreferences('user-1')).toHaveLength(2);
  });

  it('rejects an out-of-range quiet minute', async () => {
    const { notifications } = makeNotifications();
    await expect(
      notifications.setPreference('user-1', 'general', { quietStartMinute: 1500 }),
    ).rejects.toThrow(/between 0 and 1439/);
  });
});
