# Push notifications — configured once, used by every app

Push works like the brokered sign-in lane: **the platform holds the
credentials, the app holds none.** A new app registers a phone's token and
pushes go out. There is no key to add to the app's worker and nothing to set
per app on the server.

## How it works

```
phone                     app worker (Hono + SDK)            Xenition gateway             delivery
─────                     ───────────────────────            ────────────────             ────────
registerForPush()  ──►  POST /notifications/devices   ──►  /push/devices (stores it)
                        (registered to the CALLER)
                        notify(userId, …)             ──►  /push/send (service key) ──►  Expo push service ──► APNs / FCM
```

The gateway picks a lane **per device, from the token**:

| Token | Lane | Server credentials needed |
|---|---|---|
| `ExponentPushToken[…]` | Expo push service | **None.** Optional `APP_PLATFORM_EXPO_ACCESS_TOKEN` only if "enhanced push security" is on for the Expo account |
| Raw FCM token | Firebase HTTP v1 | The platform's Firebase service account (`FCM_SERVICE_ACCOUNT_FILE`, or `APP_PLATFORM_FCM_SERVICE_ACCOUNT_FILE`). Works only for apps registered in **that** Firebase project |
| Raw APNs / Web Push | none yet | Accepted and stored, but a send returns `skipped` with the reason, never `sent` |

**Use Expo tokens.** That is the lane that needs nothing.

## What still has to be done per app, and why no SDK can remove it

Apple and Google only give a push token to a build that carries push
credentials **for its own bundle id**. That is the operating system's rule, so
no SDK can get around it. With EAS it costs about two minutes per app, once:

1. **iOS:** nothing extra. `eas build` creates or reuses your Apple team's push
   key automatically. One key covers every app in the team.
2. **Android:** in the app's EAS project, run `eas credentials` → Android →
   *Google Service Account* → *Push Notifications (FCM V1)* and upload the
   service-account JSON. **You can upload the same JSON for every app:** add each
   app's package name to one shared Firebase project, and put that project's
   `google-services.json` in the app (`android.googleServicesFile` in `app.json`).
3. The app needs an EAS `projectId`. `getExpoPushTokenAsync` needs it in a
   standalone build.

Push does not work in **Expo Go** on Android, or on web. Use a development
build.

## The code

**Worker** (mounts the device routes along with the inbox):

```ts
import { createXenitionApi } from '@xenition/sdk/hono';
app.route('/api', createXenitionApi({ modules: ['notifications'] }));

// anywhere on the server — inbox row + push, honouring preferences and quiet hours
await client.modules.notifications.notify(userId, {
  title: 'Rent is due tomorrow',
  body: 'Unit 4B — $1,200',
  data: { leaseId: 'l_42' },
});

// or a bare push, no inbox row
await client.push.send({
  targets: { userId },
  notification: { title: 'Done', body: 'Your report is ready', channelId: 'default' },
});
```

**Phone**, after sign-in (load `expo-notifications` lazily, not in Expo Go or on web):

```ts
import { registerForPush } from '@xenition/sdk/mobile';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const Notifications = await import('expo-notifications');
await registerForPush({
  notifications: Notifications,
  projectId: Constants.expoConfig?.extra?.eas?.projectId,
  os: Platform.OS,
  ask: false, // on launch; pass true from the screen that explains why
  register: (token) => api.post('/notifications/devices', { token }),
});

// on sign-out
await api.delete(`/notifications/devices/${encodeURIComponent(token)}`);
```

If an app should not import the SDK on the phone, copy `registerForPush` (it
is about 40 lines in `src/mobile/push.ts`). The worker routes are the same
either way.

## Guarantees

- **Sending needs the service key.** The anon key is public, so a send route
  that accepted it would let anyone push to every user of the app.
- **A device is registered to the signed-in caller.** A `userId` in the body is
  ignored unless the caller holds the service key.
- **Dead tokens are pruned.** If Expo says `DeviceNotRegistered`, or FCM
  returns 404, the device row is deleted.
- **Every send is logged** in Manage → Push with its status and error. A send
  that reached no devices is logged as `skipped`.
- **At most 500 devices per `/push/send` call.** Larger campaigns are split
  into pages by the caller.

## Replacing hand-rolled push

Duebox, Keyhaven and Handmade each call Expo from their own worker. To move
one over: post the same token to `/notifications/devices`, swap the worker's
`fetch('https://exp.host/…')` for `client.push.send()` (or `notify()`), and drop
its `EXPO_ACCESS_TOKEN` and device table.
