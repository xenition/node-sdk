"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PushClient = void 0;
const constants_1 = require("../constants");
/**
 * Push notifications to an app's end-users.
 *
 *   await client.push.registerDevice({ userId, token, platform: 'expo' })
 *   await client.push.send({
 *     targets: { userId: 'user_123' },
 *     notification: { title: 'Task assigned', body: 'Do the dishes' },
 *     data: { taskId: 't_42' },
 *   })
 *
 * Push is configured ONCE, on the platform, not per app. An Expo push token
 * (`getExpoPushTokenAsync()` on the phone) is delivered through Expo's push
 * service with no credentials in the app, its worker, or its config. A raw
 * FCM token works when the app sits in the platform's Firebase project.
 * Anything the platform cannot reach comes back `skipped` with a reason —
 * never counted as sent. See docs/PUSH.md.
 *
 * `send()` needs the service key. Most apps never call it directly:
 * `modules.notifications.notify()` writes the inbox row AND pushes, honouring
 * the user's preferences and quiet hours.
 */
class PushClient {
    constructor(http) {
        this.http = http;
    }
    async registerDevice(input) {
        return this.http.post(constants_1.API_ENDPOINTS.PUSH.DEVICES, input);
    }
    async unregisterDevice(token) {
        await this.http.del(constants_1.API_ENDPOINTS.PUSH.DEVICE(token));
    }
    async send(input) {
        return this.http.post(constants_1.API_ENDPOINTS.PUSH.SEND, input);
    }
}
exports.PushClient = PushClient;
//# sourceMappingURL=push-client.js.map