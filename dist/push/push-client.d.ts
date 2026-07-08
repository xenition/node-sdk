import { HttpClient } from '../core/http-client';
import { PushDevice, RegisterDeviceInput, SendPushInput, SendPushResult } from './types';
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
export declare class PushClient {
    private readonly http;
    constructor(http: HttpClient);
    registerDevice(input: RegisterDeviceInput): Promise<PushDevice>;
    unregisterDevice(token: string): Promise<void>;
    send(input: SendPushInput): Promise<SendPushResult>;
}
//# sourceMappingURL=push-client.d.ts.map