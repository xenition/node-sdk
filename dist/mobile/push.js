"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerForPush = registerForPush;
const errors_1 = require("../core/errors");
const expo_token_1 = require("../push/expo-token");
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
async function registerForPush(options) {
    const { notifications: N, projectId, os, register, ask = true } = options;
    let permission = await N.getPermissionsAsync();
    if (!permission.granted && ask && permission.canAskAgain !== false) {
        permission = await N.requestPermissionsAsync();
    }
    if (!permission.granted) {
        return { status: permission.canAskAgain === false ? 'denied' : 'undetermined' };
    }
    const channel = options.androidChannel ?? { id: 'default', name: 'Notifications' };
    if (os === 'android' && channel && N.setNotificationChannelAsync) {
        const importance = N.AndroidImportance?.HIGH ?? N.AndroidImportance?.DEFAULT ?? 4;
        await N.setNotificationChannelAsync(channel.id, { name: channel.name, importance });
    }
    const { data: token } = await N.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (!(0, expo_token_1.isExpoPushToken)(token)) {
        throw new errors_1.XenitionError('VALIDATION_ERROR', `registerForPush: expected an Expo push token, got "${token.slice(0, 24)}…".`);
    }
    await register(token);
    return { status: 'registered', token };
}
//# sourceMappingURL=push.js.map