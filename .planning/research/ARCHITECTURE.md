# Architecture Research

**Domain:** Shopify B2B credit-control app (embedded admin + checkout enforcement + webhook-driven AR tracking + scheduled reminders)
**Researched:** 2026-08-14
**Confidence:** MEDIUM (web-verified against shopify.dev-indexed sources; exact API shapes must be re-verified during phase planning — shopify.dev was unreachable for direct fetch during this session)

## Standard Architecture

### System Overview

The app is **one deployable web app + one deploy-time artifact (the Function) + one always-on scheduler loop**. There is no microservice split at this scale. The single most important architectural fact: **Shopify Functions are sandboxed WASM with no network access and no database access** — the checkout validation Function cannot call your backend or compute a balance at runtime. It can only read a declarative GraphQL input (cart, buyer identity, metafields). Therefore the backend must **precompute each company's credit state and publish it to app-owned metafields on the Company resource**; the Function is a dumb comparator.

```
                        ┌──────────────────────────────────────────────┐
                        │                SHOPIFY PLATFORM              │
                        │                                              │
  Merchant browser      │  ┌────────────┐      ┌─────────────────────┐ │
 ┌─────────────────┐    │  │ Admin      │      │ Storefront Checkout │ │
 │ Embedded Admin  │◄───┼──┤ (iframe    │      │  ┌───────────────┐  │ │
 │ UI (Polaris +   │    │  │  host)     │      │  │ VALIDATION    │  │ │
 │ App Bridge)     │    │  └────────────┘      │  │ FUNCTION      │  │ │
 └──────┬──────────┘    │                      │  │ (WASM, no I/O)│  │ │
        │ session-token │                      │  └──────┬────────┘  │ │
        │ authed HTTPS  │                      │         │ reads     │ │
        ▼               │                      │         ▼           │ │
┌───────────────────────┴───┐    Admin      ┌──────────────────────┐ │ │
│  APP BACKEND (one server) │    GraphQL    │ App-owned metafields │ │ │
│  Remix / React Router     │──writes──────►│ on Company:          │ │ │
│  template                 │               │  credit_limit,       │ │ │
│  ┌─────────────────────┐  │               │  exposure, overdue,  │ │ │
│  │ Admin UI routes     │  │               │  bypass, enforce     │ │ │
│  │ (loaders/actions)   │  │               └──────────────────────┘ │ │
│  ├─────────────────────┤  │                                        │ │
│  │ Webhook handlers    │◄─┼── orders/*, app/uninstalled, GDPR ─────┼─┘
│  │ (HMAC, dedupe, ack) │  │              (at-least-once POSTs)     │
│  ├─────────────────────┤  │                                        │
│  │ Credit engine       │  │◄─ Admin GraphQL reads: orders +        │
│  │ (balance compute +  │  │   paymentTerms.paymentSchedules,       │
│  │  metafield publish) │  │   companies                            │
│  ├─────────────────────┤  │                                        │
│  │ Scheduler (cron)    │  │──► Email provider (Resend/Postmark)    │
│  │ overdue sweep,      │  │                                        │
│  │ reminders, recon    │  │                                        │
│  └─────────────────────┘  │                                        │
└──────────┬────────────────┘                                        │
           ▼                                                         │
   ┌───────────────┐                                                 │
   │ Postgres/     │   sessions, orders cache, payment schedules,    │
   │ SQLite (small)│   company credit settings, email log,           │
   └───────────────┘   processed-webhook ids, sync cursors           │
                       ──────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Embedded Admin UI | Set credit limit / bypass per company; AR dashboard (outstanding, overdue, upcoming due); billing + review prompt | Polaris components inside app routes of the official Shopify Remix/React Router template; App Bridge session-token auth; server loaders call Admin GraphQL |
| App backend | OAuth/session storage, Admin GraphQL client, webhook endpoints, credit engine, metafield publisher | Same Node process as the UI (template's server); Prisma for DB |
| Credit engine (core domain) | Compute per-company outstanding + overdue from cached orders/payment schedules; decide blocked/allowed state; write it to Company metafields | Pure module called from webhook processing, scheduler, and admin actions — single code path for recompute |
| Checkout Validation Function | Read `$app` metafields off `buyerIdentity.purchasingCompany.company` at checkout; return error message to block when over limit/overdue and not bypassed | `extensions/credit-validation/` — Cart & Checkout Validation Function API, Rust or JS→WASM, deployed via Shopify CLI |
| Webhook ingestion | Verify HMAC, dedupe by `X-Shopify-Webhook-Id`, ack 200 fast, enqueue/refetch order, trigger recompute | Template webhook route; thin-payload pattern (treat payload as a signal, refetch truth via GraphQL) |
| Scheduler | Daily/hourly: overdue sweep (time-driven state changes), reminder emails (due−3, due, overdue), reconciliation poll, metafield refresh | In-process `node-cron` on an always-on host, or external cron (GitHub Actions/Upstash) hitting an authed endpoint; email-log table for idempotency |
| Database | Cache of orders + payment schedules per shop/company; app settings; processed webhook ids; email send log; sync cursor | Postgres (Railway/Neon) via Prisma — SQLite only if single-machine host with persistent volume |
| Email provider | Deliver reminder emails | Resend/Postmark/SES; app-domain sender for MVP (merchant-domain sending is a deliverability project — defer) |

## Recommended Project Structure

Matches the official Shopify app template (Remix, now React Router–based) — reviewers and docs assume this shape:

```
credit-guard/
├── shopify.app.toml           # app config: scopes, webhook subscriptions, compliance_topics (GDPR)
├── app/
│   ├── shopify.server.ts      # shopifyApp() setup: auth, session storage, webhook registration
│   ├── db.server.ts           # Prisma client
│   ├── routes/
│   │   ├── app.tsx            # embedded layout (App Bridge + Polaris provider)
│   │   ├── app._index.tsx     # AR dashboard
│   │   ├── app.companies.$id.tsx  # per-company: limit, bypass toggle, balance detail
│   │   ├── app.settings.tsx   # reminder timing, enforcement on/off, billing state
│   │   └── webhooks.tsx       # all webhook topics incl. GDPR (HMAC verified by library)
│   ├── services/
│   │   ├── credit-engine.server.ts    # balance/overdue computation (pure, tested)
│   │   ├── metafields.server.ts       # publish credit state to Company $app metafields
│   │   ├── order-sync.server.ts       # fetch order + paymentTerms via GraphQL, upsert DB
│   │   ├── reconcile.server.ts        # updated_at cursor poll, backfill on install
│   │   └── reminders.server.ts        # due-date selection + email send + email_log
│   └── jobs/
│       └── scheduler.server.ts        # cron wiring: daily overdue sweep, reminders, recon
├── extensions/
│   └── credit-validation/     # Shopify Function (Cart & Checkout Validation API)
│       ├── shopify.extension.toml
│       └── src/
│           ├── run.graphql    # input query: buyerIdentity.purchasingCompany.company.metafield(...)
│           └── run.(rs|js)    # compare exposure+cart total vs limit; check overdue/bypass flags
└── prisma/schema.prisma       # Session, Shop, CompanyCredit, OrderCache, PaymentScheduleCache,
                               # WebhookEvent (dedupe), EmailLog, SyncCursor
```

### Structure Rationale

- **`app/services/`:** The credit engine is the product. Keep it a pure module with one entry point (`recomputeCompany(shopId, companyId)`) called from webhooks, cron, and admin actions — never three divergent computations.
- **`extensions/`:** The Function is versioned and deployed with the app via Shopify CLI but runs on Shopify's infrastructure. Keep it tiny; all intelligence lives server-side.
- **Single process:** UI, webhooks, and cron in one Node server keeps infra at one small box + one DB — required by the flat-fee margin constraint. At <100 shops there is no reason to split.

## Architectural Patterns

### Pattern 1: Materialized Credit State in App-Owned Company Metafields

**What:** The backend maintains per-company state — `credit_limit`, `current_exposure` (outstanding balance), `has_overdue`, `bypass`, `enforcement_enabled` — as `$app`-namespace metafields on the Shopify **Company** resource. The validation Function's input query reads them via `cart.buyerIdentity.purchasingCompany.company.metafield(namespace:..., key:...)` and blocks with an error message when `exposure + cart total > limit` or `has_overdue && !bypass`.
**When to use:** Any time a Function needs merchant- or app-computed data — this is the documented pattern ("your validation's configuration is stored in metafields and made available to the function at runtime"). `$app` namespace means other apps/extensions can't read or tamper with it.
**Trade-offs:** (+) Zero-latency enforcement, works offline from your server — checkout never depends on your uptime. (−) Metafields are **eventually consistent with reality**: state is only as fresh as your last recompute. A company can slip over its limit between order placement and metafield update. Mitigate by recomputing immediately on every order webhook and having the Function add the *current cart total* to stored exposure (catches the same-session case).

**Example:**
```graphql
# extensions/credit-validation/src/run.graphql
query RunInput {
  cart {
    cost { totalAmount { amount } }
    buyerIdentity {
      purchasingCompany {
        company {
          creditLimit: metafield(namespace: "$app:credit", key: "limit") { value }
          exposure:    metafield(namespace: "$app:credit", key: "exposure") { value }
          overdue:     metafield(namespace: "$app:credit", key: "has_overdue") { value }
          bypass:      metafield(namespace: "$app:credit", key: "bypass") { value }
        }
      }
    }
  }
}
```
```rust
// run.rs (sketch): no company => not B2B => allow. bypass => allow.
// overdue => block("Account has overdue invoices").
// exposure + cart_total > limit => block("Order exceeds available credit").
```

### Pattern 2: Thin Webhook → Refetch → Recompute → Publish

**What:** Webhook handlers do four things only: verify HMAC (the template library does this), dedupe on persisted `X-Shopify-Webhook-Id`, return 200 immediately, and schedule processing. Processing refetches the order via Admin GraphQL (`order { paymentTerms { overdue paymentSchedules { dueAt completedAt balanceDue } } purchasingEntity }`), upserts the local cache, runs the credit engine for that company, and writes updated metafields.
**When to use:** All order webhooks. Payloads can be stale or arrive out of order; the GraphQL read is the source of truth, which also makes duplicate deliveries harmless (idempotent upsert).
**Trade-offs:** (+) Correct under at-least-once, out-of-order delivery; one code path shared with reconciliation. (−) One extra API call per webhook — irrelevant at this volume. Keep handler response under ~5s or Shopify retries and, after repeated failures, drops the subscription.

### Pattern 3: Time-Driven State Sweep (cron is a correctness component, not just email)

**What:** A daily (or hourly) job iterates open payment schedules and flips companies to `has_overdue = true` when `dueAt` passes, republishing metafields — because **"becoming overdue" emits no webhook**; it's a pure passage-of-time transition. The same sweep selects reminder candidates (due−3, due date, overdue) and sends emails, gated by an `email_log` unique key `(orderId, scheduleId, reminderType)` so retries never double-send.
**When to use:** Always — without it, overdue blocking silently never activates.
**Trade-offs:** Enforcement granularity equals sweep frequency (an invoice due at midnight blocks after the next run). Hourly sweep is cheap and fine.

### Pattern 4: Reconciliation Poll as Webhook Backstop

**What:** A scheduled job queries `orders(query: "updated_at:>{cursor}")` per shop, upserting through the same order-sync path as webhooks, then advances the cursor. Also used as the **initial backfill on install** (last ~90 days of unpaid B2B orders) so the dashboard has data in the first session — critical given time-to-first-value drives trial conversion.
**When to use:** Hourly-to-daily for a financial-enforcement app; Shopify's own guidance is "don't rely on receiving webhooks."
**Trade-offs:** Cheap insurance; watch API rate limits only if a shop has huge order volume (paginate with cursors).

## Data Flow

### Enforcement Flow (checkout)

```
B2B buyer reaches checkout
    ↓
Shopify runs credit-validation Function (on Shopify infra)
    ↓ input query resolves company $app metafields (pre-published by backend)
Function compares: bypass? overdue? exposure + cart total vs limit
    ↓
errors[] returned → Shopify blocks "Pay/Submit" with message | empty → checkout proceeds
```
Your server is **not in this loop**. Uptime of your backend never gates checkout.

### Balance Flow (webhook-driven)

```
Order placed / edited / paid / cancelled on Shopify
    ↓ webhook (orders/create | orders/updated | orders/paid | orders/cancelled)
Webhook route: HMAC ✓ → dedupe (webhook id) → 200 OK → async process
    ↓
Refetch order via Admin GraphQL (paymentTerms, paymentSchedules, purchasingEntity/company)
    ↓ upsert OrderCache + PaymentScheduleCache
Credit engine: outstanding = Σ balanceDue over incomplete schedules of company's orders
               has_overdue = ∃ schedule: dueAt < now ∧ balanceDue > 0
    ↓
metafieldsSet on Company ($app:credit/exposure, has_overdue) → next checkout sees new state
    ↓
Dashboard loaders read the same DB rows (no extra API calls at render)
```

### Time Flow (scheduler)

```
cron (hourly/daily)
 ├─ overdue sweep: dueAt passed? → recompute + republish metafields
 ├─ reminders: schedules at due−3 / due / overdue → email_log check → send via provider
 └─ reconciliation: orders updated since cursor → same upsert path as webhooks
```

### Key Data Flows

1. **Merchant config:** Admin UI action → DB (CompanyCredit row) → immediate `metafieldsSet` on Company → Function sees it on next checkout. DB is source of truth; metafields are the projection.
2. **Uninstall:** `app/uninstalled` webhook → mark shop inactive, stop jobs, schedule data purge; `shop/redact` (arrives ~48h later) → hard delete.

## Webhook Topics Needed

| Topic | Purpose |
|-------|---------|
| `orders/create` | New B2B order → add to exposure immediately (blocks next order same day) |
| `orders/updated` | Payment status changes, edits, payment-terms changes — the catch-all for AR truth |
| `orders/paid` | Fast path to release credit the moment an invoice is settled |
| `orders/cancelled` | Release exposure |
| `app/uninstalled` | Cleanup, stop reminders/billing state |
| `app_subscriptions/update` | Track billing/trial state changes |
| `customers/data_request`, `customers/redact`, `shop/redact` | **Mandatory GDPR** — declared as `compliance_topics` in `shopify.app.toml`; missing/failing handlers = app-review rejection |

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0–50 shops (MVP target ~25) | Single always-on server + one Postgres. In-process cron. Process webhooks inline after ack (fire-and-forget promise) — no queue infra needed |
| 50–500 shops | Add a real queue (BullMQ + Redis) for webhook processing and email sends; move cron to a worker; per-shop rate-limit awareness on reconciliation |
| 500+ shops | Split worker from web process; partition reconciliation; consider webhook ingestion via managed relay (Hookdeck-style) |

### Scaling Priorities

1. **First bottleneck:** Reconciliation + backfill API calls on shops with large order history — fix with cursor pagination and only syncing orders with payment terms / B2B purchasing entity.
2. **Second bottleneck:** In-process cron on a host that autosleeps (Fly machines suspend without traffic) — jobs silently never run. Fix by choosing an always-on instance or external cron trigger from day one.

## Anti-Patterns

### Anti-Pattern 1: Trying to Call Your Backend from the Function

**What people do:** Assume the validation Function can hit an API to check the live balance.
**Why it's wrong:** Functions are sandboxed WASM — no network, no clock-dependent external state; only the declarative input query (128kB input / 20kB output / 11M instruction limits).
**Do this instead:** Materialized state in `$app` company metafields (Pattern 1). All computation server-side, ahead of time.

### Anti-Pattern 2: Computing Balance from Webhook Payloads Alone

**What people do:** Parse `orders/*` payload JSON and mutate a running balance (`balance += total`).
**Why it's wrong:** At-least-once delivery double-counts on duplicates; out-of-order updates corrupt state; missed webhooks drift forever. For an app that *blocks revenue*, drift means false blocks — merchant-facing disasters.
**Do this instead:** Idempotent refetch-and-upsert (Pattern 2) + recompute-from-scratch per company + reconciliation poll (Pattern 4). Never incremental arithmetic on payloads.

### Anti-Pattern 3: Treating Checkout Blocking as the Only Enforcement Surface

**What people do:** Ship the Function and declare enforcement done.
**Why it's wrong:** B2B merchants heavily use draft orders and the "submit all orders as drafts for review" company setting — orders created/invoiced from admin can bypass storefront checkout validation. (Confidence: LOW–MEDIUM; verify exact validation coverage of admin/draft flows during Function phase.)
**Do this instead:** Function blocks self-serve checkout; dashboard flags any incoming order (webhook path) that pushed a company over limit, so merchants catch draft-order leaks. Message this honestly in the listing.

### Anti-Pattern 4: Reminder Emails Without a Send Log

**What people do:** Cron selects "due in 3 days" rows and sends; a retried/overlapping run re-sends.
**Why it's wrong:** Duplicate dunning emails to a merchant's customers is trust-destroying.
**Do this instead:** `EmailLog` with unique `(scheduleId, reminderType)`; insert-then-send; idempotent by construction.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Shopify Admin GraphQL | Template's authenticated client from loaders/actions/jobs | Scopes: read orders, read companies, write metafields (+ reserved `$app` metafield namespace access requested at install). **Native B2B = Shopify Plus only** — detect plan at install and gate onboarding messaging |
| Shopify Functions runtime | `extensions/` deployed via CLI; merchant activates validation | Function config UI can live in admin app (validation settings link) |
| Email provider (Resend/Postmark) | REST send from reminder job | Send from app domain (SPF/DKIM on your domain) for MVP; merchant-domain sending is a later feature |
| Shopify Billing API | `appSubscriptionCreate` in onboarding gate | 14-day trial; check billing state in app layout loader |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Admin UI ↔ backend | Route loaders/actions (same process), session-token auth | Dashboard reads local DB, not live GraphQL — fast + rate-limit-free |
| Backend ↔ Function | **One-way, via Company metafields** (write side: `metafieldsSet`; read side: Function input query) | The only contract between server and Function; version the namespace/keys carefully |
| Webhooks ↔ credit engine | Handler → order-sync → `recomputeCompany()` | Same entry point used by cron + reconciliation + admin actions |
| Scheduler ↔ everything | Calls services directly (in-process) | Keep jobs re-runnable/idempotent so a missed or doubled tick is harmless |

## Suggested Build Order

Dependencies force this sequence — each phase is independently testable:

1. **App skeleton** — official template, embedded Polaris shell, OAuth/session storage, deploy target chosen (always-on host + Postgres). GDPR + `app/uninstalled` webhook stubs wired now (cheap, review-mandatory).
2. **Order/AR data layer** — webhook ingestion (HMAC/dedupe/refetch/upsert), install-time backfill, credit engine (pure, unit-tested balance + overdue computation). *This is the core domain; everything else consumes it.*
3. **Company credit UI + metafield publishing** — set limit/bypass per company; `recomputeCompany()` publishes `$app` metafields. Verifiable in admin metafield viewer before any Function exists.
4. **Validation Function** — reads metafields, blocks checkout. Depends entirely on 3. Test on a Plus dev-preview/dev store with B2B enabled; verify draft-order behavior here.
5. **Scheduler** — overdue sweep (activates overdue blocking for real), reminder emails with send log, reconciliation poll.
6. **AR dashboard** — reads DB assembled in 2/5; outstanding, overdue companies, upcoming due dates.
7. **Commercialization + review pass** — Billing API + trial gate, review-prompt trigger (first blocked order / first reminder), listing, demo store, app review submission.

## Sources

- [Cart and Checkout Validation Function API — shopify.dev](https://shopify.dev/docs/api/functions/latest/cart-and-checkout-validation)
- [Add configuration to your validation (metafield-based config) — shopify.dev](https://shopify.dev/docs/apps/checkout/validation/create-complex-validation-rules/add-configuration)
- [About metafields / app-owned `$app` namespace — shopify.dev](https://shopify.dev/docs/apps/build/metafields)
- [Company metafield access from functions — Shopify function-examples discussion #381](https://github.com/Shopify/function-examples/discussions/381)
- [PaymentTerms object — Admin GraphQL](https://shopify.dev/docs/api/admin-graphql/latest/objects/paymentterms) and [PaymentSchedule object](https://shopify.dev/docs/api/admin-graphql/latest/objects/paymentschedule)
- [Setting up payment terms in B2B — Shopify Help Center](https://help.shopify.com/en/manual/b2b/checkout-and-orders/payment-terms); [B2B checkout, orders, and draft orders](https://help.shopify.com/en/manual/b2b/checkout-and-orders)
- [Privacy law compliance (mandatory GDPR webhooks) — shopify.dev](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)
- [Webhook best practices (at-least-once, reconciliation) — shopify.dev](https://shopify.dev/docs/apps/build/webhooks/best-practices); [Hookdeck Shopify webhooks guide](https://hookdeck.com/webhooks/platforms/shopify-webhooks-features-and-best-practices-guide)
- [Shopify Functions input limit 128kB — changelog](https://shopify.dev/changelog/shopify-functions-input-size-limit-increased-to-128kb); [instruction-count limit discussion](https://github.com/Shopify/function-examples/discussions/329)
- [Build a Shopify app using Remix (template structure) — shopify.dev](https://shopify.dev/docs/apps/build/build?framework=remix); [shopify-app-template-remix — GitHub](https://github.com/Shopify/shopify-app-template-remix)
- [Cron & scheduled jobs in Remix Shopify apps (Fly autosleep gotcha)](https://www.jeffedmondson.dev/cron-scheduled-jobs-in-remix-shopify-apps/)

---
*Architecture research for: Shopify B2B credit-control app (Credit Guard: B2B Net Terms)*
*Researched: 2026-08-14*
