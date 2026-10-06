import { HttpClient } from '../core/http-client';
import { PushDevice, RegisterDeviceInput, SendPushInput, SendPushResult } from './types';
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
export declare class PushClient {
    private readonly http;
    constructor(http: HttpClient);
    registerDevice(input: RegisterDeviceInput): Promise<PushDevice>;
    unregisterDevice(token: string): Promise<void>;
    send(input: SendPushInput): Promise<SendPushResult>;
}
//# sourceMappingURL=push-client.d.ts.map