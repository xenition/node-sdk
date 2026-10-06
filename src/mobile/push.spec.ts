import { registerForPush, type NotificationsModule } from './push';

/** A stand-in for `expo-notifications`, recording what was asked of it. */
function fakeNotifications(opts: { granted?: boolean; grantOnAsk?: boolean; canAskAgain?: boolean; token?: string } = {}) {
  const calls: string[] = [];
  let granted = opts.granted ?? false;
  const mod: NotificationsModule = {
    getPermissionsAsync: async () => {
      calls.push('get');
      return { granted, canAskAgain: opts.canAskAgain ?? true };
    },
    requestPermissionsAsync: async () => {
      calls.push('request');
      granted = opts.grantOnAsk ?? true;
      return { granted, canAskAgain: opts.canAskAgain ?? true };
    },
    getExpoPushTokenAsync: async (o) => {
      calls.push(`token:${o?.projectId ?? ''}`);
      return { data: opts.token ?? 'ExponentPushToken[abc]' };
    },
    setNotificationChannelAsync: async (id) => {
      calls.push(`channel:${id}`);
    },
    AndroidImportance: { HIGH: 4 },
  };
  return { mod, calls };
}

describe('registerForPush', () => {
  it('asks, gets the token for the project, creates the Android channel, and registers', async () => {
    const { mod, calls } = fakeNotifications();
    const registered: string[] = [];
    const result = await registerForPush({
      notifications: mod,
      projectId: 'proj-1',
      os: 'android',
      register: async (t) => registered.push(t),
    });
    expect(result).toEqual({ status: 'registered', token: 'ExponentPushToken[abc]' });
    expect(registered).toEqual(['ExponentPushToken[abc]']);
    expect(calls).toEqual(['get', 'request', 'channel:default', 'token:proj-1']);
  });

  it('never shows the prompt when ask is false', async () => {
    const { mod, calls } = fakeNotifications();
    const result = await registerForPush({ notifications: mod, ask: false, register: async () => undefined });
    expect(result.status).toBe('undetermined');
    expect(calls).toEqual(['get']);
  });

  it('reports denied without registering', async () => {
    const { mod } = fakeNotifications({ grantOnAsk: false, canAskAgain: false });
    const register = jest.fn();
    expect((await registerForPush({ notifications: mod, register })).status).toBe('denied');
    expect(register).not.toHaveBeenCalled();
  });

  it('skips the channel on iOS and refuses a token that is not an Expo one', async () => {
    const { mod, calls } = fakeNotifications({ granted: true, token: 'not-an-expo-token' });
    await expect(
      registerForPush({ notifications: mod, os: 'ios', register: async () => undefined }),
    ).rejects.toThrow(/Expo push token/);
    expect(calls).not.toContain('channel:default');
  });
});
