# @xenition/sdk

Official Node.js SDK for Xenition. Gives apps created via xenition's seller
dashboard an auth / query / storage / chatbot / payments / push / email /
AI / search surface over HTTPS.

## Install

```bash
# Development builds (hits api-dev.xenition.com)
npm install "github:xenition/node-sdk#develop"

# Production builds (hits api.xenition.com)
npm install "github:xenition/node-sdk"
```

npm publishing will follow in `1.0.0`. For now, `github:` install is the
only supported path — matches the xenition deploy pipeline's expectations.

## Quick start

```ts
import { XenitionClient } from '@xenition/sdk';

const client = new XenitionClient(process.env.XENITION_API_KEY!);

// Sign up an end user
const { user, token } = await client.auth.register({
  email: 'user@example.com',
  password: 'hunter2',
  name: 'Jane Doe',
});

// Sign in
const session = await client.auth.login({
  email: 'user@example.com',
  password: 'hunter2',
});

// Fetch the current user (requires session token)
client.setHeader('Authorization', `Bearer ${session.token}`);
const me = await client.auth.me();
```

## Content modules (v0)

The SDK ships a small **module framework**: content-domain features (CMS
pages, forms, reviews) implemented *client-side* on top of the existing
`/app-platform/query` and `/app-platform/raw` endpoints. Each module is
just a migration set plus a typed client — no new server surface.

```ts
// service key (backend / deploy step) — runs the module's migrations
// through the ledger, idempotent, then unlocks the accessor:
await client.modules.enable('cms');

const about = await client.modules.cms.createPage({
  title: 'About Us',            // slug auto-generated: 'about-us'
  body_html: '<h1>Hi</h1>',
  published: true,
});
const page = await client.modules.cms.getPageBySlug('about-us');

// anon key (browser) — tables were migrated by the backend already;
// mark the module usable without running DDL:
client.modules.use('forms');
await client.modules.forms.submit('contact', {
  name: 'Ada',
  email: 'ada@example.com',     // validated against the stored field schema
});
```

**Modules**

| Module    | Tables                                | Client surface |
|-----------|---------------------------------------|----------------|
| `cms`     | `cms__pages`, `cms__collections`, `cms__items` | pages CRUD + `getPageBySlug`; `ensureCollection`/`getCollection`; items CRUD + `listItems(collection, {published, orderBy})` + `getItemBySlug`. Slugs auto-kebab from titles, deduped `-2`, `-3`, … |
| `forms`   | `forms__forms`, `forms__submissions`  | `ensureForm(key, fields)` (declarative field schema); `submit(key, data)` — validates required/type/email/maxLength/select client-side, works with the **anon key** (schema read + one insert); `listSubmissions`/`setStatus` are service-key back-office calls |
| `reviews` | `reviews__reviews`                    | `submit` (rating rounded + clamped 1–5, always status `pending`); `listApproved(target)`; `aggregate(target)` → `{count, average}` computed in the DB; `moderate(id, status)` service-key |

**Conventions**

- Every module's tables are prefixed `<module>__` — they live in your
  app's own database next to your tables; query them directly whenever
  the typed client is too narrow.
- Schema is managed by `client.migrations`, a **content-addressed
  migration ledger**: `apply([{id, sql}])` records each applied id with
  the sha-256 of its SQL in `_sdk_migrations`. Re-apply is a no-op;
  editing an applied migration's SQL throws (write a new migration
  instead — never silently re-run). Migrations use raw SQL, so they are
  **service-key only**. You can use the ledger for your own app tables
  too:

  ```ts
  await client.migrations.apply([
    { id: 'app/0001_create_widgets', sql: 'CREATE TABLE IF NOT EXISTS widgets (...)' },
  ]);
  ```

- Custom modules: `defineModule({name, migrations, factory})` gives your
  own domain the same shape (migrations + typed client over
  `ctx.query`/`ctx.raw`).

**v0 scope — read this**

Validation runs in the SDK, so it protects well-behaved apps from bad
data — it does not protect the database from clients that bypass the SDK.
Server-side hardening (per-table policies, module-aware endpoints) comes
later per the platform master plan. For the same reason, **money-path
domains (cart, booking, payments) are deliberately NOT v0 client-side
modules**: they need server-side invariants (stock, double-booking,
idempotent charging) that a client-side layer cannot honestly provide.
They arrive as server-backed modules in a later phase.

## Backend routers (@xenition/sdk/hono)

Prebuilt, mountable [Hono](https://hono.dev) routers that turn a generated
app's backend into composition instead of hand-written code. They run
inside the app's own Cloudflare Worker with the **service key** the deploy
pipeline injects (`XENITION_API_KEY` + `XENITION_API_URL`), so the
React/Expo frontend talks to *its own* backend and never holds a platform
key — and since the platform bans anon-key writes, these routers are the
sanctioned write path for forms and reviews.

```ts
import { Hono } from 'hono';
import { createXenitionApi } from '@xenition/sdk/hono';

const app = new Hono();
app.route('/api', createXenitionApi()); // /api/cms, /api/forms, /api/reviews
export default app;
```

**Routes**

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/cms/pages/:slug` | Published page (404 for drafts/missing) |
| GET | `/cms/collections/:key/items` | Items; `?published=1&orderBy=&direction=&limit=&offset=` (published-only by default, `published=all` opts out) |
| GET | `/cms/collections/:key/items/:slug` | Published item |
| GET | `/forms/:key` | The form's field schema (for rendering) |
| POST | `/forms/:key/submissions` | Body = the `data` object → SDK-validated insert; `201 {id}` or `400` with the aggregated validation message |
| GET | `/reviews/:targetType/:targetId` | `{reviews, aggregate: {count, average}}` (approved only) in one payload |
| POST | `/reviews/:targetType/:targetId` | `{authorName, rating, title?, body?}` → `201 {id, status: 'pending'}` (always lands pending) |


## In-app purchases (mobile)

The `billing` module turns a store purchase into an answer to one question:
*may this user do this?* Apple and Google disagree about product ids,
transaction identifiers, renewal semantics and notification formats — your
app only ever reads an entitlement.

```ts
// deploy step (service key)
await client.modules.enable('billing');
await client.modules.billing.defineProduct({
  productId: 'com.acme.premium.monthly', platform: 'apple',
  entitlement: 'premium', kind: 'subscription', period: 'monthly',
});

// anywhere
const { allowed, daysRemaining, isTrial } = await billing.check(userId, 'premium');
```

Mount the router and the app gets the whole flow over HTTP:

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/billing/products` | Catalog for the paywall (public — shown before sign-in) |
| GET | `/billing/entitlements` | Every entitlement for the caller |
| GET | `/billing/entitlements/:key` | `{ allowed, source, expiresAt, daysRemaining, isTrial }` |
| POST | `/billing/verify` | `{platform:'apple', transactionId}` or `{platform:'google', productId, purchaseToken}` → verified against the store, recorded, entitlement returned |
| POST | `/billing/restore` | Re-apply purchases after a reinstall |
| POST | `/billing/trial` | Start the free trial (length is **server**-side) |
| POST | `/billing/webhooks/apple` | App Store Server Notifications v2 |
| POST | `/billing/webhooks/google` | Play Real-time Developer Notifications |

Gate a feature in one line:

```ts
app.use('/coach/*', requireAuth(), requireEntitlement('premium'));
```

It answers **402 Payment Required**, not 403, and the body carries the same
`EntitlementCheck` the client reads from `/billing/entitlements/:key` — so
one code path in the app renders the paywall from either.

**Secrets** — `APPLE_KEY_ID`, `APPLE_ISSUER_ID`, `APPLE_PRIVATE_KEY`,
`APPLE_BUNDLE_ID`, `APPLE_ENVIRONMENT` (`production`/`sandbox`/`auto`,
default `auto`); `GOOGLE_PACKAGE_NAME`, `GOOGLE_CLIENT_EMAIL`,
`GOOGLE_PRIVATE_KEY`; `BILLING_TRIAL_DAYS`. A platform you never configure
answers **501**, not 500 — an iOS-only app is right to hold no Google
credentials.

**Things that will bite you, handled here:**

- **Play auto-refunds** any purchase not acknowledged within three days, and
  verifying does not acknowledge. `/billing/verify` acknowledges, and reports
  `acknowledged: false` rather than failing silently if Play is down.
- **Play's `CANCELED` does not mean access ended** — auto-renew is off but the
  user paid through the period. It resolves by expiry.
- **Billing-retry grace keeps access.** The card failed and the store is
  retrying; cutting the user off there is a top cause of involuntary churn.
- **Sandbox never unlocks production.** The environment comes from the host
  that answered, not from a field in the payload.
- **A transaction chain belongs to whoever redeemed it first**, so replaying
  someone else's receipt on another account is refused.
- **Store notifications are triggers, not truth.** The body says *which*
  purchase changed; the new state is always re-read from the store. A forged
  notification cannot grant anything.

## Your own routes

`createXenitionApi()` mounts the built-in modules; `defineRouter` is how the
app's own routes join them and inherit the same conventions — shared error
mapping, auth, the entitlement gate, the rate limiter, and a place in the
generated OpenAPI.

```ts
import { defineRouter, createXenitionApi, currentUserId } from '@xenition/sdk/hono';

const speeches = defineRouter({
  name: 'speeches',
  build(app, { client, requireAuth, requireEntitlement }) {
    app.get('/speeches', requireAuth, async (c) =>
      c.json(await client(c).query.from('speeches').where('user_id', currentUserId(c)).rows()));
    app.post('/speeches/:id/analyze', requireAuth, requireEntitlement('premium'), analyze);
  },
  paths: { '/speeches': { get: { tags: ['speeches'], summary: 'The caller’s speeches' } } },
});

app.route('/api', createXenitionApi({ custom: [speeches] }));
```

**One caveat, and it applies to the built-ins too:** Hono does not carry a
sub-app's `notFound` across a prefixed mount, so an app doing
`app.route('/api', createXenitionApi(...))` answers Hono's text/plain 404 for
unmatched paths under `/api`. Install the JSON one on the root app:

```ts
import { jsonNotFound } from '@xenition/sdk/hono';
app.notFound(jsonNotFound);
```

## Background work and cron

```ts
import { withScheduled } from '@xenition/sdk/hono';

const job = await client.modules.jobs.enqueue('speech.analyze', { userId, sessionId });
// → 202 { jobId: job.id }; the client polls GET /jobs/:id

export default withScheduled(app, {
  handlers: { 'speech.analyze': analyzeSpeech },   // drains the queue each tick
  crons: [
    { name: 'daily-reminders', schedule: '0 9 * * *', run: sendReminders },
    { name: 'nightly-purge',   schedule: '0 3 * * *', run: ({ jobs }) => jobs.purge() },
  ],
});
```

with matching `[triggers] crons = [...]` in `wrangler.toml`. Include a
frequent catch-all trigger — that is what makes `enqueue()` actually run.

Delivery is **at least once**: a worker can die after doing the work but
before recording success, so handlers must be idempotent. `enqueue` takes an
`idempotencyKey` for the same reason on the producing side.

## Testing without a network

```ts
import { createTestClient } from '@xenition/sdk/testing';

const { client, store, user } = createTestClient();
const app = new Hono();
app.route('/api', createXenitionApi({ client }));

await app.request('/api/billing/entitlements', {
  headers: { Authorization: 'Bearer test' },
});
expect(store.rows('billing__entitlements')).toHaveLength(1);
```

The store is a real in-memory interpreter of the query IR, so rows written by
one call are read back by the next — what is under test is the module's
behavior, not a stub's.

## End-user auth

Routers hold the **service key**, so without this every route is public and
every row belongs to everyone.

```ts
import { requireAuth, currentUser, currentUserId } from '@xenition/sdk/hono';

app.use('/me/*', requireAuth());          // 401 when absent/invalid
app.get('/me/profile', (c) => c.json(currentUser(c)));
```

`xenitionAuth()` is the permissive variant: it populates the caller when a
token is present and serves guests otherwise. Verification is cached per
isolate for 60s. A token the platform rejects is a **401**; a platform
outage stays a **502**, so apps do not fall into a re-login loop over a
fault the user cannot fix.


**Options** — `createXenitionApi({ modules?, cors?, client?, rateLimit? })`:
`modules` picks which routers to mount (default all three; individual
`cmsRouter()` / `formsRouter()` / `reviewsRouter()` are also exported for
selective mounting), `cors` is `true` (permissive, default), an origin
allowlist array, or `false`, `client` overrides the env-built
`XenitionClient`, and `rateLimit` is submissions-per-minute-per-IP for the
write routes (default 10, `false` disables — best-effort: the token bucket
is per Workers isolate, so it dampens abuse rather than enforcing a hard
quota).

**One stable response shape.** The two platform runtimes disagree on row
casing (the gateway camelCases, the engine returns snake_case verbatim);
every row leaving these routers is normalized to camelCase
(`body_html` → `bodyHtml`). jsonb payloads (`data`, `seo`, `meta`) keep
their inner keys untouched — that casing is your app's contract.

Errors map to proper HTTP statuses (400 validation, 404 missing, 429 rate
limited, 502/504 upstream) and never leak keys or upstream URLs. `hono`
is an **optional peer dependency** — the SDK core never imports it, and
the `./hono` subpath is Worker/Node-only (excluded from the browser
build). Routers only ever call `modules.use()` — never `enable()`/DDL at
request time; migrations belong in the deploy step.

## Status

Phase 1: `client.auth.*` (register, login, logout, me, OAuth, password
reset, email verification, teams).

Phases 2–12 add `client.query.*`, `client.storage.*`, `client.email.*`,
`client.push.*`, `client.ai.*`, `client.chatbot.*`, `client.search.*`,
`client.vector.*`, `client.payment.*`, `client.realtime.*`,
`client.videoConferencing.*`. See the xenition repo's
`APP-SDK-IMPLEMENTATION.md` for the roadmap.

Mobile: end-user auth middleware (`requireAuth`), in-app purchases and
entitlements (`client.modules.billing`, `AppleStore`, `GoogleStore`, the
`/billing` router, `requireEntitlement`).

## Development

Source of truth lives in the private repo `xenition/node-sdk-private`.
The public `xenition/node-sdk` repo is synced by CI on every push to
`develop` or `main`. The `main` sync runs `scripts/patch-urls-for-public.sh`
to rewrite the base URL to `api.xenition.com`.

```bash
npm install
npm run build
npm test
```

## License

MIT © Xenition
