/**
 * Push on the device: permission, an Expo push token, and handing it to the
 * app's backend — in one call.
 *
 * Same rule as sign-in in this folder: `expo-notifications` is passed IN,
 * never imported here. A static import of a native module blanks the screen in
 * Expo Go and on web before any component renders, and a literal dynamic
 * import breaks the bundle of every app that has not installed it. The app
 * loads the module (lazily, if it is careful) and gives it to this function.
 *
 * Why an Expo token and not a raw FCM/APNs one: the platform sends Expo tokens
 * through Expo's push service, which needs no credentials on the server. That
 * is what lets push be configured once for every app. See docs/PUSH.md.
 */
/** The slice of `expo-notifications` this needs. Structural, so the real
 *  module satisfies it and a test can pass a stub. */
export interface NotificationsModule {
    getPermissionsAsync(): Promise<PermissionResult>;
    requestPermissionsAsync(): Promise<PermissionResult>;
    getExpoPushTokenAsync(options?: {
        projectId?: string;
    }): Promise<{
        data: string;
    }>;
    setNotificationChannelAsync?(id: string, channel: {
        name: string;
        importance: number;
    }): Promise<unknown>;
    AndroidImportance?: {
        HIGH?: number;
        DEFAULT?: number;
    };
}
interface PermissionResult {
    granted: boolean;
    canAskAgain?: boolean;
}
export interface RegisterForPushOptions {
    /** `import * as Notifications from 'expo-notifications'`, or a lazy load of it. */
    notifications: NotificationsModule;
    /**
     * The EAS project id (`Constants.expoConfig?.extra?.eas?.projectId`).
     * Required in a standalone build — the token is minted for that project.
     */
    projectId?: string;
    /** `Platform.OS`. Used only to create the Android channel. */
    os?: string;
    /**
     * Send the token to the app's backend — normally
     * `POST /notifications/devices` from `notificationsRouter()`:
     *
     * ```ts
     * register: (token) => api.post('/notifications/devices', { token })
     * ```
     */
    register: (token: string) => Promise<unknown>;
    /**
     * Show the system permission prompt when the user has not decided yet.
     * Default `true`. Pass `false` on launch, so the prompt only ever appears
     * from the screen that explains why — a cold prompt is the one users deny.
     */
    ask?: boolean;
    /**
     * Android channel to create (Android 8+ shows nothing without one). Pass
     * its id as `channelId` when sending. Default `{ id: 'default', name: 'Notifications' }`.
     */
    androidChannel?: {
        id: string;
        name: string;
    } | false;
}
export type PushRegistration = {
    status: 'registered';
    token: string;
} | {
    status: 'denied' | 'undetermined';
    token?: undefined;
};
/**
 * Ask (if allowed), get this phone's Expo push token, and register it.
 *
 * Safe to call on every launch: registration is keyed by token, so a repeat
 * is a no-op and a token the OS rotated is picked up. Call it AFTER sign-in —
 * the backend registers the device to whoever is signed in.
 *
 * ```ts
 * const Notifications = await import('expo-notifications');
 * await registerForPush({
 *   notifications: Notifications,
 *   projectId: Constants.expoConfig?.extra?.eas?.projectId,
 *   os: Platform.OS,
 *   register: (token) => api.post('/notifications/devices', { token }),
 * });
 * ```
 */
export declare function registerForPush(options: RegisterForPushOptions): Promise<PushRegistration>;
export {};
//# sourceMappingURL=push.d.ts.map