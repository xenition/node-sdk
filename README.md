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

## Status

Phase 1: `client.auth.*` (register, login, logout, me, OAuth, password
reset, email verification, teams).

Phases 2–12 add `client.query.*`, `client.storage.*`, `client.email.*`,
`client.push.*`, `client.ai.*`, `client.chatbot.*`, `client.search.*`,
`client.vector.*`, `client.payment.*`, `client.realtime.*`,
`client.videoConferencing.*`. See the xenition repo's
`APP-SDK-IMPLEMENTATION.md` for the roadmap.

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
