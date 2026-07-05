/**
 * Wire shapes for `/app-platform/push/*`. Mirror the xenition backend's
 * `modules/app-platform-push/` types.
 */

export type PushPlatform = 'fcm' | 'apns' | 'web';

export interface RegisterDeviceInput {
  userId: string;
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
  /** iOS sound name; FCM also supports it. */
  sound?: string;
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
