# Social sign-in

Google, Apple and GitHub, with no configuration to start and a faster path
available when you want it.

---

## The short version

```ts
import * as WebBrowser from 'expo-web-browser';
import { signInWithProvider } from '@xenition/sdk/mobile';

const { session } = await signInWithProvider({
  client: api.auth,
  provider: 'github',
  returnTo: 'myapp://auth',
  webBrowser: WebBrowser,
});
```

That works on a brand new app. Nothing is registered with Google, nothing is
configured in a dashboard, no `.p8` file is downloaded from Apple.

---

## Two lanes

Which one runs is not a preference. It follows from what the app has registered.

| | Native | Brokered |
|---|---|---|
| How | the device's Google/Apple SDK produces an `idToken` | an in-app browser, the gateway does the code exchange |
| Round trips | one | two, plus a browser |
| Credentials | **the app's own, always** | Xenition's by default, the app's if configured |
| Providers | Google, Apple | Google, Apple, **GitHub** |
| Works in Expo Go | no | yes |
| Works in a web build | no | yes |

### Why native cannot use Xenition's credentials

A native id token's `aud` claim **is the app's own identity** — Google binds a
client id to an iOS bundle id or an Android package + SHA1, Apple binds it to
the bundle id. Xenition cannot mint a token whose audience is your app, so
there is nothing to supply on your behalf. This is a property of the providers,
not a gap in the platform.

It would be technically possible to accept tokens carrying *Xenition's*
audience on the native route. The gateway deliberately does not, because a
malicious app could then collect Xenition-audience tokens from its own
signed-in users and replay them into a **different** Xenition app's
`/id-token`, signing in as those users there. The token would be entirely
genuine and every signature check would pass. In the brokered flow the token
never leaves the gateway, so the same attack has nothing to replay.

### The upgrade path

`signInWithProvider()` tries native when you give it a `native` function, and
falls back to brokered if the server says your app has no native credentials.
So this code is correct both before and after you register your own client ids:

```ts
await signInWithProvider({
  client: api.auth,
  provider: 'google',
  returnTo: 'myapp://auth',
  webBrowser: WebBrowser,
  native: async () => {
    // Loaded HERE, not at the top of the file — a static import of a native
    // module blanks the route on web and in Expo Go.
    const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
    const { data } = await GoogleSignin.signIn();
    return { idToken: data.idToken };
  },
});
```

The day you configure Google credentials, the same call starts taking the fast
lane. `result.lane` tells you which one ran.

A native failure that is *not* "this app is unconfigured" is rethrown rather
than retried through the browser — otherwise a broken native setup hides behind
a slower path that happens to work, and nobody finds out until they wonder why
sign-in takes three seconds.

---

## The two redirect URLs

These are different things and conflating them is the usual source of confusion.

**1. The SSO redirect** — fixed, Xenition's, registered once per provider:

```
https://api.xenition.com/v1/app-platform/auth/oauth/{provider}/callback
```

You never touch this. Providers only ever redirect here. It is deliberately not
per-app: a provider matches its registered redirect URI exactly, so a per-app
URL would mean a new registration at Google every time someone deploys an app —
which is the cost this design exists to remove.

**2. Your return URL** — your own deep link, passed as `returnTo`:

```
myapp://auth
```

The gateway redirects here after the exchange, carrying a one-time code.

### What crosses that second hop

Not a session. Tokens in a redirect URL land in browser history, in OS logs,
and in front of any other app registered for the same custom scheme. What
crosses is a code: signed, valid two minutes, bound to your app, and spent on
first use. Your app redeems it over HTTPS for the actual session.

### Which return URLs are accepted

| Your app has | Accepted |
|---|---|
| no registered URLs | any custom-scheme deep link (`myapp://auth`) and localhost. **Not** arbitrary https. |
| one or more registered | **only** those, exactly — custom schemes included |

Registering the first URL makes the list exhaustive. That is the point — it is
how an app locks itself to an https universal link — but it will break a
working sign-in if you forget to add the deep link you were already using.

```ts
await api.auth.listReturnUrls();   // { urls, mode, explanation }
await api.auth.addReturnUrl('https://app.example.com/auth');   // service key
await api.auth.removeReturnUrl('https://app.example.com/auth'); // service key
```

Matching is exact after normalising the scheme and host, which are
case-insensitive per RFC 3986. The path is not normalised, and there is no
prefix matching: registering `https://app.example.com/` as a prefix would also
accept `https://app.example.com/../evil`, which is the usual way a redirect
allowlist is defeated.

A custom scheme is not a strong binding — another app on the device can
register the same one. That is why what crosses is a two-minute single-use code
rather than a session, and why an app that wants the strong binding registers an
https universal link and lets the exhaustive rule lock the custom scheme out.

---

## Using your own OAuth credentials

Two reasons to: your app's name on the consent screen instead of Xenition's,
and access to the fast native lane for Google and Apple.

```ts
await api.auth.configureSocialProvider('google', {
  clientId: '....apps.googleusercontent.com',
  clientSecret: '...',
  redirectUri: 'https://api.xenition.com/v1/app-platform/auth/oauth/google/callback',
  // Google issues a separate client id per platform, and a token minted by
  // your Android app carries the Android audience, not the web one.
  additionalClientIds: ['...android...', '...ios...'],
});
```

Service key only. The anon key ships inside client bundles, and allowing this
behind it would let anyone who unzipped an APK point your sign-in at their own
OAuth client.

To go back to the platform's:

```ts
await api.auth.deleteSocialProviderConfig('google');
```

For Apple, pass `teamId`, `keyId` and `privateKey` (the `.p8` contents) —
Apple has no static client secret, so the gateway signs a short-lived ES256 JWT
per exchange.

---

## What a login screen should render

```ts
const providers = await api.auth.socialProviders();
// [{ provider: 'google', isAvailable: true, usingSSO: true, ssoAvailable: true, ... }]
```

- `isAvailable` — render the button at all
- `usingSSO` — the user will see *Xenition* on the consent screen, not your app.
  Worth knowing if you want to explain that, and the signal that registering
  your own credentials would both rebrand it and unlock the native lane
- `configured` / `enabled` — your app's own credentials

---

## Apple's two traps

**The nonce is hashed one way and compared the other.** Apple takes the
SHA-256 and echoes it inside the token; the server compares against the **raw**
value. `createAppleNonce()` returns both so they cannot be swapped:

```ts
import * as Crypto from 'expo-crypto';

const nonce = await createAppleNonce({
  sha256: (v) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, v),
});
// give nonce.hashed to Apple, send nonce.raw to us
```

**The name arrives once, ever.** Apple returns a display name only on the very
first authorization for an app, and not inside the token. The brokered lane
reads it from the form field beside the code automatically; on the native lane
pass it through as `name` the first time or it is gone for good.

---

## Errors worth handling

| | Means |
|---|---|
| `SignInCancelled` | the user closed the consent screen. A decision, not a failure — no error dialog |
| `412` / `AUTH_PROVIDER_NOT_CONFIGURED` | native was attempted on an app with no credentials. Handled for you by `signInWithProvider` |
| `"...is not a registered return URL"` | the allowlist became exhaustive and this deep link is not on it |
| `"that account did not share an email address"` | Apple's hide-my-email with no relay address. There is no key to match an account on |

Every brokered failure is delivered back to your `returnTo` as `?error=...`
rather than left on a browser page, so a user who cancels lands back in the app
rather than on a blank tab they have to find their own way out of.
