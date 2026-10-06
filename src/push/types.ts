/**
 * Wire shapes for `/app-platform/push/*`. Mirror the xenition backend's
 * `modules/app-platform-push/` types.
 */

/**
 * How a device is reached. `expo` is the one that needs no setup: an
 * `ExponentPushToken[…]` goes through Expo's push service on the platform's
 * behalf, so an app ships push without holding any credentials. `fcm` works
 * for apps inside the platform's Firebase project. `apns` and `web` are
 * accepted and stored, but the platform has no credentials for them yet, so
 * a send to them comes back `skipped` — never `sent`.
 */
export type PushPlatform = 'expo' | 'fcm' | 'apns' | 'web';

export interface RegisterDeviceInput {
  /**
   * Whose device this is. Honoured only with a service key. Called with an
   * end user's session instead, the platform registers the device to that
   * user and ignores this — otherwise anyone holding the public anon key
   * could route another user's notifications to their own phone.
   */
  userId?: string;
  token: string;
  platform: PushPlatform;
  deviceName?: string;
  /** Web Push only — required so the server can encrypt the payload. */
  webSubscription?: {
    keys: {
      p256dh: string;
      auth: string;
    };
  };
}

export interface PushDevice {
  id: string;
  userId: string;
  token: string;
  platform: PushPlatform;
  deviceName: string | null;
  active: boolean;
  createdAt: string;
}

export interface PushNotification {
  title: string;
  body: string;
  /** Optional URL or image — client-side rendering decides what to do. */
  imageUrl?: string;
  /** Click/tap target (FCM: `click_action`, Web: `notificationclick` URL). */
  clickAction?: string;
  /** iOS badge count. */
  badge?: number;
  /** iOS sound name; FCM also supports it. Defaults to `default` on Expo. */
  sound?: string;
  /** Android notification channel — create it on the device first. */
  channelId?: string;
  /** Action buttons registered on the device (`setNotificationCategoryAsync`). */
  categoryId?: string;
}

export type PushTarget =
  | { userId: string }
  | { token: string }
  | { deviceIds: string[] };

export interface SendPushInput {
  targets: PushTarget | PushTarget[];
  notification: PushNotification;
  data?: Record<string, string>;
}

export interface SendPushResult {
  sent: number;
  failed: number;
  skipped: number;
  results: Array<{
    deviceId: string | null;
    platform: PushPlatform;
    status: 'sent' | 'failed' | 'skipped';
    error?: string;
  }>;
}
