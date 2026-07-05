"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PushClient = void 0;
const constants_1 = require("../constants");
/**
 * Push notifications to an app's end-users.
 *
 *   await client.push.registerDevice({ userId, token, platform: 'fcm' })
 *   await client.push.send({
 *     targets: { userId: 'user_123' },
 *     notification: { title: 'Task assigned', body: 'Do the dishes' },
 *     data: { taskId: 't_42' },
 *   })
 *
 * Device tokens come from the provider SDK on the end-user's device (FCM
 * for Android, APNs for iOS, Push API + VAPID for web). The xenition
 * backend holds the signing credentials — the app never ships them to
 * the user's device.
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