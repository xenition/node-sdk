# Platform endpoints the mobile surface needs

Everything in this document is **already implemented on the SDK side** and
already called by `AuthClient`. What is missing is the gateway half. Until an
endpoint exists, the corresponding SDK method throws a `NOT_FOUND`
`XenitionError` whose message names the endpoint — so a missing one is loud,
not mysterious.

Ordered by what blocks shipping. The first two are hard blockers for any
mobile app; nothing else on this list stops an app from working.

---

## 1. `POST /app-platform/auth/refresh` — blocks every mobile app

**Why it blocks.** Access tokens are short-lived. Without a refresh path, a
user is returned to the login screen the moment theirs expires, and the app
has no way to recover — `AuthResponse` already returns a `refreshToken` and
an `expiresAt` that nothing can act on.

```jsonc
// request
{ "refreshToken": "..." }

// 200 — the same shape as login/register
{
  "user": { /* User */ },
  "session": { /* Session */ },
  "token": "...",
  "refreshToken": "...",   // NEW token when rotation is on
  "expiresAt": 1767225600
}
```

**Errors:** `AUTH_INVALID_TOKEN` (unknown/garbage), `AUTH_EXPIRED_TOKEN`
(past its life), `AUTH_FORBIDDEN` (revoked because the session was signed
out).

**Please rotate.** Issue a new refresh token and invalidate the presented
one. The SDK documents that callers must store what comes back, so rotation
will not break them. Detecting reuse of an already-spent refresh token is the
standard signal that one has been stolen.

---

## 2. `DELETE /app-platform/auth/account` + `GET /app-platform/auth/account/export` — blocks App Store review

**Why it blocks.** Apple has required in-app account deletion since June 2022.
An app that cannot delete an account is **rejected at review** no matter how
complete the rest is. Play and GDPR expect export alongside it. `User` already
carries a `deletedAt` column that nothing currently sets.

```jsonc
// DELETE /app-platform/auth/account
// Authorization: Bearer <end-user token>
{ "password": "optional", "reason": "optional" }

// 200
{ "deleted": true, "purgeAt": "2026-09-23T00:00:00.000Z" }  // purgeAt null when immediate
```

`purgeAt` lets the app say "your account will be removed on the 23rd" instead
of implying the data is already gone. A grace period is the kinder default,
provided the account stops working immediately.

```jsonc
// GET /app-platform/auth/account/export
// Authorization: Bearer <end-user token>
{
  "user": { /* User */ },
  "sessions": [ /* Session[] */ ],
  "data": { "<table>": [ /* rows */ ] },
  "generatedAt": "2026-08-24T12:00:00.000Z"
}
```

Deletion must also cascade — or be documented as not cascading — into the
per-app database. An app-level `user_id` left pointing at a deleted account is
the kind of thing that turns up in a privacy audit rather than in testing.

---

## 3. `POST /app-platform/auth/oauth/:provider/id-token` — native Google/Apple sign-in

The existing `getOAuthUrl` / `handleOAuthCallback` pair is the browser
redirect dance. Mobile does not do that: the platform SDK completes sign-in
on the device and hands the app an `idToken`.

```jsonc
{ "idToken": "...", "nonce": "the nonce the app generated", "name": "optional" }
// → the same AuthResponse as login
```

**Server must verify:** the token's signature against the provider's published
keys (Google's JWKS, Apple's `/auth/keys`), that `aud` is this app's client id,
that `iss` is the expected issuer, that it has not expired, and — for Apple —
that the embedded `nonce` matches the one supplied. The nonce check is what
stops a token captured from another session being replayed.

**`name` exists because Apple only surfaces it on the very first
authorization, ever.** If it is not persisted then, it is gone for good, and
the user shows up as an empty name forever after.

---

## 4. OTP — `POST /app-platform/auth/otp/send` and `/otp/verify`

Link-based email verification assumes a browser can be handed the token. On
mobile the user is looking at a keypad.

```jsonc
// send  { "email": "...", "purpose": "signin" }   (or "phone")
// 200   { "sent": true, "channel": "email", "expiresAt": "...", "retryAfterSeconds": 60 }

// verify { "email": "...", "code": "123456", "purpose": "signin" }
// 200    AuthResponse for purpose "signin"; { "verified": true } otherwise
```

**Server side, please:** scope codes by `purpose` so a sign-in code cannot
reset a password; rate-limit both send and verify per identifier AND per IP;
expire in ~10 minutes; cap verification attempts per code; and compare in
constant time. Throttling cannot be done in a client.

---

## 5. `POST /app-platform/auth/password` — change password while signed in

```jsonc
// Authorization: Bearer <end-user token>
{ "currentPassword": "...", "newPassword": "..." }
// 200 { "changed": true }
```

Distinct from the existing reset flow, which proves identity by email. This
proves it with the current password — otherwise someone holding an unlocked
phone can lock the owner out of their own account. Consider revoking other
sessions on success.

---

## 6. Sessions — `GET`/`DELETE /app-platform/auth/sessions`, `DELETE /app-platform/auth/sessions/:id`

```jsonc
// GET    → Session[]  (the "signed in on these devices" list)
// DELETE /sessions/:id → { "revoked": true }
// DELETE /sessions     → { "revoked": 3 }   // all, including the caller's
```

The last one is what a user reaches for after losing a phone.

---

## Not auth — the rest of the mobile gap

These have no SDK half yet; they are recorded here so the whole gateway ask
is in one place.

| Endpoint | For | Why it matters |
|---|---|---|
| `POST /app-platform/ai/transcribe` | speech-to-text, ideally with word timestamps | any voice, meeting, coaching or note app is built on it |
| `POST /app-platform/ai/speech` | text-to-speech | voiced agents, accessibility |
| streaming on `/app-platform/ai/chat` | SSE rather than a buffered response | a chat UI that waits 20s for a complete answer reads as broken |
| `responseFormat: {type:'json_schema'}` on `/ai/chat` | structured output | apps currently prompt for "exact JSON" and hope; that is a parse failure waiting to happen in production |
| `POST /app-platform/raw/transaction` | a list of statements, one transaction | billing and jobs both have half-apply windows without it |
| `Idempotency-Key` honoured on writes | mobile retries | a retried purchase verification must not double-apply |

---

## One request that is not an endpoint

Every module query is one HTTP round trip to the gateway, so an N+1 in a list
view is N network calls. Before this carries real traffic, either request
batching or a server-side module surface is worth a conversation — it is the
one thing on this page that could force an architecture change late rather
than early.
