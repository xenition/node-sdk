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
