import { HttpClient } from '../core/http-client';
import { API_ENDPOINTS } from '../constants';
import {
  PushDevice,
  RegisterDeviceInput,
  SendPushInput,
  SendPushResult,
} from './types';

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
export class PushClient {
  constructor(private readonly http: HttpClient) {}

  async registerDevice(input: RegisterDeviceInput): Promise<PushDevice> {
    return this.http.post<PushDevice>(API_ENDPOINTS.PUSH.DEVICES, input);
  }

  async unregisterDevice(token: string): Promise<void> {
    await this.http.del<void>(API_ENDPOINTS.PUSH.DEVICE(token));
  }

  async send(input: SendPushInput): Promise<SendPushResult> {
    return this.http.post<SendPushResult>(API_ENDPOINTS.PUSH.SEND, input);
  }
}
