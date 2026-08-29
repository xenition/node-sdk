# Production gaps — measured against Firebase, Supabase and Appwrite

What a team gets from the three reference backends that they do not get from
`@xenition/sdk` today, and in what order those gaps should close.

Written 29 August 2026 against SDK `0.2.1`. Sources at the bottom.

The comparison is deliberately unkind. Everything below is a thing one of the
three ships as a named product feature, and a real app would reach for.

---

## Where this SDK is already ahead

Worth stating first, because it changes what is worth copying and what is not.

- **In-app purchase.** Apple and Google receipt verification, entitlements,
  store notifications, trials. Neither Supabase nor Appwrite ships this at
  all; Firebase dropped it years ago. An app charging money on a phone is
  further along here than on any of the three.
- **Fifteen domain modules** — cms, forms, reviews, events, listings, media,
  booking, catalog, inventory, cart, orders, billing, jobs, notifications,
  quotas. The reference backends give you tables and tell you to write this
  yourself. This is the actual differentiator and nothing below should be
  read as a reason to weaken it.
- **AI, vector and hybrid search as first-class clients.** Supabase gets
  there through pgvector plus your own code; Appwrite needs a third party.
- **A typed HTTP layer that generates its own router and OpenAPI page.**

---

## Tier 1 — these block calling anything "production grade"

### 1. There is no authorization model. This is the big one.

All three reference backends make declarative data authorization *the*
central primitive:

| | mechanism |
| --- | --- |
| Firebase | Security Rules, per path, unit-testable in the emulator |
| Supabase | Postgres Row Level Security, policies referencing `auth.uid()` |
| Appwrite | per-row permissions, plus Teams with named roles |

This SDK has none. Every query runs with the app's authority; `WHERE
tenant_id = $1` in module code is a convention, not a boundary. The lab
already recorded the consequence as **S01: one app's service key can read
another app's `users` table.**

Two things make this the first item on the list:

- Supabase's own framing is that RLS exists so a **bug in application code
  cannot leak data**. Right now an app-level mistake is a data breach, and
  the only thing standing between a customer's rows and another customer is
  code review.
- Firebase's most common production failure is shipping default-open rules.
  A platform with no rules at all cannot even have that conversation.

Related and already known: [[tenant is not a customer]] — one engine key
serves every Xenition user, so a `tenant_id` filter is not isolation.

**Shape of the fix:** policies evaluated by the gateway on every `/query`,
keyed to the end-user JWT, with a deny-by-default posture and a way to unit
test them. This is a platform change, not an SDK change, and it is large.
Nothing else on this list matters as much.

### 2. A session cannot be ended or renewed

Already logged as gateway blockers (#010 and `PLATFORM-ENDPOINTS.md` §1):
`logout` answers 204 and the token keeps working; `refresh` 404s, so a user
is signed out for good after an hour; `DELETE /auth/sessions` does not exist,
so a leaked token cannot be revoked.

Every reference backend treats session revocation as basic. This is a
security control, not a convenience.

### 3. No MFA, no second factor of any kind

Supabase ships MFA with enroll/challenge/verify; Appwrite advertises 30+
login methods including MFA. This SDK has password and (once the gateway
lands it) social sign-in. No TOTP, no passkeys/WebAuthn, no recovery codes.

For consumer apps that is survivable. For anything B2B, or anything holding
payment or health data, it is a procurement blocker.

### 4. Nothing stops abuse of the auth endpoints

Firebase's pre-launch checklist puts **enforcing App Check on every service**
at the top — proof the caller is your real app, not a script. Supabase ships
Captcha protection on auth.

Here, `rate limiting is per-isolate memory` (the SDK's own words) — it
vanishes with the isolate and does not coordinate across workers, so it
dampens nothing at scale. There is no captcha hook, no attestation, no
lockout after N failures. `POST /auth/login` is open to credential stuffing
at whatever rate the gateway will serve.

`quotas` is durable and correct, but it is a product primitive for
"five free analyses a month" — it is not wired into auth.

---

## Tier 2 — expected of any modern SDK in 2026

### 5. No offline support, and the round-trip cost makes it worse

Firestore enables offline persistence **by default on iOS and Android**:
reads come from a local cache, writes queue locally and sync on reconnect,
and the UI updates optimistically. An entire ecosystem (PowerSync,
ElectricSQL, Ditto) exists to give Supabase the same thing.

This SDK has no cache, no mutation queue, no optimistic path, and no
conflict policy. On a phone with a weak connection every read is a network
call that can simply fail.

It compounds with the known limitation already in `HANDOVER.md`: **every
module query is one HTTP round trip, so an N+1 in a list view is N network
calls.** Offline-first is not a feature to bolt on later; it constrains the
data layer's shape, which is exactly why the handover flags it as the one
thing that could force a late architecture change.

### 6. Everything is stringly typed

Supabase generates TypeScript types from the schema — every table and column
typed, no manual maintenance. It is the feature its users name first.

Here, `from('lab__items').where('price_cents', '>=', 0)` is three strings and
a value. A renamed column is a runtime error in production, not a red squiggle.
Finding #011 — *"unknown resource"* when an id was passed to a method that
takes a slug — happened **because both are `string`** and nothing at the call
site says which is wanted. That class of bug is generated by the type design.

### 7. Realtime is a bare channel

`subscribe(channel)` / `publish(channel)` and nothing else. Compare:

- Supabase: Postgres changes, Presence, Broadcast, and authorization on both
- Appwrite: unlimited subscriptions, per-document

There is no way to react to a row changing without polling for it. "Show the
order status live" — the thing realtime is for — is not buildable today
without the app publishing to a channel by hand from every write site.

### 8. Storage is upload, download, list

Missing against both Supabase and Appwrite: **image transformations**,
**resumable uploads** (a 200 MB video on hotel wifi cannot be retried today),
**a CDN**, and **encryption at rest as a stated property**. Media
transcode/duration/thumbnails are already on the "not started" list, and
presigned upload is blocked gateway-side (#008), so large files must pass
through the worker.

### 9. There is no emulator, and the test harness proved it can lie

Firebase's launch checklist item one: *test all changes in the Local Emulator
Suite*. Supabase ships a CLI that runs the whole stack locally.

`@xenition/sdk/testing` (FakeStore) is closer than nothing, but it is an
in-memory interpreter of the query IR, not a local gateway — and it has
already produced a false green twice:

- **1220 tests passed while every 400/402/404 an app threw became a 500**,
  because the fake throws the same class the handler imports — the one
  arrangement that cannot reproduce the ESM/CJS `instanceof` bug.
- The billing "expired subscription reads as active" bug survived every unit
  test, because the fake returns exactly what was written to it and the real
  gateway camelCases rows.

Both were found by pointing a real app at a real gateway. That is the
argument for a local gateway, not a better fake.

---

## Tier 3 — operating it once it is live

| Gap | What the others ship |
| --- | --- |
| **No audit log** | Supabase Logs & Analytics, Reports & Metrics, Log Drains; Firebase exports Analytics/Crashlytics/Messaging to BigQuery. Here: `x-request-id` exists and nothing aggregates it. Nothing records who read or changed what. |
| **No outbound webhooks** | Supabase Database Webhooks. Store notifications exist but are **not signature-verified** (by design), and there is no delivery log, retry schedule or replay tool — the three things 2026 webhook guidance says make them reliable. |
| **No environment separation** | Firebase: *use different projects for dev, test and production*. Supabase: Branching. Here, dev vs prod is one URL in `constants.ts` and a branch convention — and that URL has already caused a mis-sync between mirror branches. |
| **No backups or PITR story** | Supabase: database backups, read replicas, PrivateLink. Not documented here at all. |
| **No spend controls** | Firebase: budget alerts and spend caps as a checklist item. `quotas` limits end users, nothing caps what an app costs its owner. |
| **No CLI or management API** | Supabase: CLI, Management API, Terraform provider. Appwrite: CLI. Here: dashboard only, so nothing about a project is reproducible or reviewable. |
| **No RBAC for the team** | Supabase RBAC; Appwrite Teams with named roles. `auth.getTeams()` exists on the client, but there is no role model gating what a team member may do. |

---

## The order I would fix them in

1. **Authorization model (RLS-equivalent).** Everything else is polish next to
   "one key reads another app's data". Platform work, not SDK work.
2. **Session lifecycle** — refresh, a logout that revokes, session listing.
   Already spec'd in `PLATFORM-ENDPOINTS.md`; it is the shortest path from
   "demo" to "shippable".
3. **Abuse controls on auth** — durable distributed rate limit, lockout,
   a captcha hook.
4. **Generated types from the schema.** The cheapest large win, entirely
   SDK-side, and it retires a whole class of runtime bug.
5. **Realtime row changes.** Unlocks the product patterns apps actually ask
   for.
6. **A local gateway to develop against.** Every remaining item is easier to
   build once this exists, and two shipped bugs would have been caught by it.
7. **Offline cache + mutation queue**, if mobile stays the target.
8. Storage transforms and resumable uploads; audit log; MFA.

---

## Appendix — SDK-side only: what can be built without the gateway

Everything above needs platform work. This list does not. It is the client
library measured against how a 2026 client library is expected to behave.

### Already correct, and worth not re-litigating

Typed error codes mapped from status; retries with exponential backoff;
a 30s default timeout; **idempotency keys**, with writes retriable only when
one is present; `x-request-id` stamped across every attempt of a call;
`onRequest`/`onResponse`/`onError` hooks that cannot break a request by
throwing; keyset cursors on the notification inbox. That is most of what the
retry/observability guidance asks for.

### Fixed 29 Aug while auditing this list

- **A reconnected socket was subscribed to nothing.** Subscriptions are held
  per connection and `subscribe` was emitted once. After any blip the app had
  a live socket and went permanently deaf, silently. (`1db085c`)
- **429 was never retried**, and `Retry-After` was never read. The one
  transient failure an app meets in normal operation was the one not covered.
  Backoff now carries full jitter. (`1db085c`)

### Still open, in the order I would build them

| # | Gap | Why it earns its place |
| --- | --- | --- |
| 1 | **Generated types from the schema** | `from('lab__items').where('price_cents', …)` is three strings. A renamed column is a production error. Finding #011 — an id passed where a slug was wanted — exists *because* both are `string`. Supabase users name this feature first. |
| 2 | **Session persistence, background refresh, `onAuthStateChange`** | No storage adapter, no persisted session, no auth-state listener. Every app hand-rolls token storage and expiry. The refresh *endpoint* is gateway-blocked, but none of this machinery is — build it now, light it up when the endpoint lands. |
| 3 | **Batch loading for module queries** | The known limitation is "every module query is one HTTP round trip; an N+1 in a list view is N network calls". A per-tick `whereIn` coalescer turns those N calls into one, with no API change. This is the cheapest available answer to the one problem flagged as able to force a late architecture change. |
| 4 | **`AbortSignal` on every call** | There is a timeout; there is no cancellation. Search-as-you-type cannot cancel the four requests it already has in flight, and a closed screen keeps paying for them. |
| 5 | **Auto-paging iterator** | `limit`/`offset` only. `for await (const row of query.stream())` is the shape generated SDKs are expected to ship, and it is what stops callers writing their own paging loop wrong. |
| 6 | **Upload progress** | No `onProgress`. A progress bar for a video upload is not buildable today. |
| 7 | **Circuit breaker** | With retries on, a gateway that is down makes every call pay the full timeout budget before failing. Failing fast after N consecutive failures is what the 2026 guidance pairs with retries and idempotency. |

Items 1–6 are self-contained and independently shippable. None of them need
anything from the platform team.

---

## Sources

- Supabase, *Features* — https://supabase.com/features
- Firebase, *Launch checklist* — https://firebase.google.com/support/guides/launch-checklist
- Firebase, *Security checklist* — https://firebase.google.com/support/guides/security-checklist
- Firebase, *Test your Security Rules with the emulator* — https://firebase.google.com/docs/rules/unit-tests
- Appwrite — https://appwrite.io/ and *Teams and Roles: managing multi-tenant access* — https://appwrite.io/blog/post/appwrite-teams-roles
- PowerSync, *Bringing offline-first to Supabase* — https://powersync.com/blog/bringing-offline-first-to-supabase
- *Offline-First Done Right: sync patterns for real-world mobile networks* — https://developersvoice.com/blog/mobile/offline-first-sync-patterns/
- *Webhooks in 2026 — building a reliable webhook system* — https://projectsupply.in/blog/reliable-webhook-architecture-2026
- *API rate limiting strategies: 2026 engineering reference* — https://www.digitalapplied.com/blog/api-rate-limiting-strategies-2026-engineering-reference
