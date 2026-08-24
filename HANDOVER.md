# Handover — mobile backend work on `@xenition/sdk`

**Read this first if you are picking up this work.**

The goal of this work was to make the SDK able to power a **complete mobile app
backend** — the kind of thing `orate-meld` needed: accounts, in-app purchases,
background AI work, scheduled reminders, notifications.

Before this, the SDK was built for **content and commerce websites** (CMS,
listings, catalog, cart, orders). It could not do accounts, could not take
money on mobile, and could not run anything on a schedule.

| | |
|---|---|
| Branch | `develop` (merged), also on `feature/abir` |
| Commits | 16 |
| Tests | 733 → **1053** (320 new) |
| Typecheck / build | clean |
| Merge commit | `f0ea31e` |

> **Nothing here has run against a real gateway or a real store.** All 1053
> tests pass, but they use stubs. See [Before you trust this](#5-before-you-trust-this-with-real-money).

---

## 1. What was added

### In-app purchases (the biggest piece)

| Feature | Where |
|---|---|
| Apple purchase verification (App Store Server API) | `src/modules/billing/apple.ts` |
| Google purchase verification (Play Developer API) | `src/modules/billing/google.ts` |
| Entitlements — one check: "is this user premium?" | `src/modules/billing/billing-client.ts` |
| Free trials, manual grants, revoke | same file |
| Store notifications (renew / cancel / refund) | `src/modules/billing/notifications.ts` |
| HTTP API for the mobile app | `src/hono/billing-router.ts` |
| Paywall gate — `requireEntitlement('premium')` | same file |
| JWT / crypto helpers (Web Crypto only) | `src/modules/billing/jws.ts` |

```ts
// deploy step
await client.modules.enable('billing');
await client.modules.billing.defineProduct({
  productId: 'com.acme.premium.monthly', platform: 'apple',
  entitlement: 'premium', kind: 'subscription',
});

// anywhere
const { allowed, daysRemaining, isTrial } = await billing.check(userId, 'premium');

// one-line paywall
app.use('/coach/*', requireAuth(), requireEntitlement('premium'));
```

**Routes:** `GET /billing/products`, `GET /billing/entitlements[/:key]`,
`POST /billing/verify`, `POST /billing/restore`, `POST /billing/trial`,
`POST /billing/webhooks/apple`, `POST /billing/webhooks/google`.

### Login / accounts

| Feature | Where |
|---|---|
| `requireAuth()` / `xenitionAuth()` middleware, `currentUser(c)` | `src/hono/auth.ts` |
| `verifyToken()`, per-request end-user tokens | `src/auth/auth-client.ts` |
| `refresh()`, `signInWithIdToken()` (native Google/Apple) | same |
| `deleteAccount()`, `exportData()` | same |
| OTP, `changePassword()`, session list / revoke | same |

### Background work

| Feature | Where |
|---|---|
| Job queue (`FOR UPDATE SKIP LOCKED`, leases, retry, dead-letter) | `src/modules/jobs/jobs-client.ts` |
| Cron + `scheduled` worker export | `src/hono/scheduled.ts` |
| Job status polling for the app | `src/hono/jobs-router.ts` |

```ts
export default withScheduled(app, {
  handlers: { 'speech.analyze': analyzeSpeech },       // drains the queue
  crons: [{ name: 'daily-reminders', schedule: '0 9 * * *', run: sendReminders }],
});
```

### Notifications, quotas, AI, storage

- **Notifications** (`src/modules/notifications/`) — inbox, unread count,
  per-category settings, quiet hours, scheduled sends.
- **Quotas** (`src/modules/quotas/`) — durable counters for free-plan limits.
- **AI** (`src/ai/`) — `transcribe()` (with word timings), `speech()`,
  `streamChat()` (SSE), JSON-schema output.
- **Storage** (`src/storage/`, `src/core/multipart.ts`) — accepts
  Blob/File/ArrayBuffer/Buffer/string, `createUploadUrl()` for big files,
  `form-data` dependency removed.

### Core + developer tools

- Idempotency keys, request IDs, logging hooks (`src/core/http-client.ts`)
- 9 new error codes (`src/core/errors.ts`)
- `transaction()` (`src/query/query-client.ts`)
- `defineRouter()` — your own routes get the same conventions (`src/hono/define-router.ts`)
- `@xenition/sdk/testing` — offline tests (`src/testing/`)

---

## 2. What was fixed

| Problem | Impact |
|---|---|
| One user's login token could leak into another user's request | **Security.** `setHeader()` mutated the shared client; tokens are now per request |
| Every API route was open to everyone | The routers hold the service key and had no idea who was calling |
| Bearer token with a trailing space/newline was rejected | Confusing 401s. JS `$` does not match before a trailing newline |
| Apple environment read from the message body | A sandbox receipt could unlock production. Now taken from the host that answered |
| Node Buffer upload could send unrelated memory | **Data leak.** A Buffer is a window onto a shared pool; bytes are now copied |
| Google purchases were never acknowledged | **Google auto-refunds after 3 days.** Verifying is not acknowledging |
| Duplicate `forbidden()` in checkout-router | Removed, moved to shared errors |
| 404 returned text instead of JSON under a prefix mount | Hono does not carry a sub-app's `notFound`. Documented + `jsonNotFound` exported |

---

## 3. What still needs work

### 🔴 Blockers — the app cannot launch without these

**These need the gateway/backend team, not the SDK.** The SDK side is already
written and calling them; a missing endpoint throws a clear error naming it.

**Full spec with request/response shapes: [`docs/PLATFORM-ENDPOINTS.md`](docs/PLATFORM-ENDPOINTS.md)**

1. **`POST /app-platform/auth/refresh`** — without it, users get logged out
   when their token expires and the app cannot recover.
2. **`DELETE /app-platform/auth/account`** + **`GET .../account/export`** —
   Apple has required in-app account deletion since June 2022. **The app is
   rejected at review without it.**

Also needed, not blocking: native id-token sign-in, OTP, change password,
sessions, `POST /ai/transcribe`, `POST /ai/speech`, streaming chat,
`POST /raw/transaction`, and honouring the `Idempotency-Key` header.

### 🟡 Not started

| Item | Why it matters |
|---|---|
| **Dead push-token pruning** | `SendPushResult` already reports failed tokens and nothing consumes them. Delivery rates decay over time |
| **Media processing** | Duration probe, thumbnails, transcode on upload |
| **Dart / Flutter client** | If Flutter stays the mobile target, `@xenition/sdk/mobile` must be a **Dart package**, not TypeScript. orate-meld's Flutter app hand-writes its whole HTTP layer today |
| **Email channel in notifications** | The module reports `email` as suppressed — it has no address and no template system |
| **Stripe ↔ IAP unification** | Both write entitlements, but Stripe still goes through the old `payment` client |

### 🟠 Known limitations

- **Every module query is one HTTP round trip** to the gateway. An N+1 in a
  list view is N network calls. **Load-test before this carries real
  traffic** — it is the one thing that could force a late architecture change.
- **Rate limiting is per-isolate memory.** Use `quotas` for real limits.
- **Jobs are at-least-once.** A worker can die after doing the work but before
  recording success. **Handlers must be idempotent.**
- **Google upgrade/downgrade** issues a new purchase token with
  `linkedPurchaseToken`. The new chain records correctly and the entitlement is
  right, but the old purchase row is not expired.
- **Store notifications are not signature-verified.** By design — they are
  treated as a *trigger* and the real state is always re-read from the store,
  so a forged one cannot grant anything. Adding chain verification as a second
  layer is still worthwhile.

---

## 4. How to work on this

### Setup

```bash
npm install
npx tsc --noEmit     # typecheck
npx jest             # 1053 tests, ~25s
npm run build        # MUST run before committing — dist/ is committed
```

### ⚠️ Three traps that will bite you

**1. `dist/` is committed.** Generated apps install
`github:xenition/node-sdk`, so the built output must be in the repo. **Always
`npm run build` before you commit.**

**2. The API URL is different per branch — and it is in `dist/` too.**

| Branch | URL |
|---|---|
| `develop` | `https://api-dev.xenition.com/v1` |
| `main` | `https://api.xenition.com/v1` |

After any merge between branches, check `src/constants.ts` **and rebuild**.
Fixing only `src` leaves the built output pointing at the wrong environment.

`develop` and `main` carry **identical `src/` except that one line**. Merge
conflicts between them are history artifacts of two mirror snapshots — there
is nothing real to merge.

**3. This public repo is a one-way mirror** of `xenition/node-sdk-private`.
Every upstream commit reads *"Update SDK from node-sdk-private repository"*.
A sync from private **can overwrite work pushed here**. Getting this into the
private repo is still owed.

### New modules must be enabled at deploy

The four new modules create tables. Run once at startup with a service key
(idempotent — safe on every boot):

```ts
for (const m of ['billing', 'jobs', 'notifications', 'quotas']) {
  await client.modules.enable(m);
}
```

In anon-key contexts use `client.modules.use(m)` instead — it unlocks the
module without running DDL.

### House style

- Modules: `src/modules/<name>/` — tables prefixed `<name>__`, schema as
  migrations in the `_sdk_migrations` ledger. **No platform change needed.**
- Platform wrappers: `src/<feature>/` — wraps `/app-platform/*`. **Needs a
  gateway endpoint.**
- Tests live next to the code as `<file>.spec.ts`.
- Comments explain **why**, not what.
- When a router changes, update `src/hono/docs.ts` in the **same commit** —
  there is a test that fails if a module is undocumented.

### Where to start

Read in this order:

1. `docs/PLATFORM-ENDPOINTS.md` — what the backend team owes
2. `src/modules/billing/billing-client.ts` — the entitlement model
3. `src/hono/auth.ts` — how a request gets a user
4. `src/modules/jobs/jobs-client.ts` — the queue

---

## 5. Before you trust this with real money

**All 1053 tests use stubs.** Both store JWTs are signed and verified for real
against generated keys, but no real purchase has ever gone through.

**Do this before launch — it is worth more than any new feature:**

1. One **sandbox purchase on iPhone** end to end (buy → verify → entitlement).
2. One **licence-tester purchase on Android**, and **confirm it is
   acknowledged** — Google refunds unacknowledged purchases after 3 days.
3. Send a **test notification** from App Store Connect and Play Console; check
   `billing__events` gets a row.
4. **Cancel and refund** a sandbox subscription; check access actually stops.
5. Confirm a **cron trigger** fires in a deployed worker and the queue drains.

### Before pushing `main`

- **Bump the version.** It is still `0.1.5`, which is already on npm. Pushing
  `main` with a changed `package.json` triggers `.github/workflows/npm-publish.yml`,
  and the version guard would **skip** — so npm keeps serving old code while
  GitHub installs get the new. Use `0.2.0` (large additive release, nothing
  breaking).
- Check the URL is `api.xenition.com` in **both** `src/` and `dist/`.
- `main` is what production apps install. Treat the push as a deploy.

---

## Commit history

```
f0ea31e  Merge feature/abir into develop
5e34faa  hono: custom routers, and ship the test harness
03a483e  storage, chatbot: Workers-native uploads, and drop form-data
8c3d64a  query, quotas: transactions and durable usage counters
e1547a8  ai: transcription, speech, streaming chat, and structured output
fa7f59e  notifications: inbox, preferences, quiet hours, scheduled delivery
648f6a4  core: idempotency keys, request correlation, and observability hooks
5409e0c  auth: the mobile surface — refresh, native sign-in, deletion, OTP, sessions
86899fa  hono: cron triggers, a scheduled handler, and job status polling
88ac576  jobs: deferred and background work
76e10f9  hono: expose in-app purchases over HTTP
3479b2d  billing: handle Apple and Google server notifications
758084c  billing: verify purchases against the Play Developer API
5a098d6  billing: verify purchases against the App Store Server API
6dd51a9  billing: entitlement engine and IAP schema
afb8d85  hono: end-user auth middleware for generated backends
7fedee1  auth: carry an end-user access token per request
```

Each commit message explains the reasoning behind its decisions — worth
reading before changing that area.
