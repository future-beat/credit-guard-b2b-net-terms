# Phase 2: AR Ledger & Credit Engine - Research

**Researched:** 2026-08-19
**Domain:** Shopify Admin GraphQL 2026-07 — B2B orders, payment terms, webhooks, bulk operations; in-process scheduling on Railway
**Confidence:** MEDIUM-HIGH (every GraphQL field name, webhook topic string, and scope below was checked against live shopify.dev 2026-07 pages this session via WebFetch; remaining unknowns are behavioral edge cases flagged in the Assumptions Log)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Exposure Definition (what counts against the credit limit)
- **D-01:** Exposure = sum of remaining `balanceDue` across a company's UNPAID and PARTIALLY-PAID net-terms payment schedules, net of refunds — from EVERY order source (checkout, draft, admin, POS; consistent with ENFC-06 counting bypassed orders). — **Reversibility:** costly — the semantics propagate into Phase 3 metafields, Phase 4 blocking, and merchant trust; changing them after launch changes what merchants' numbers mean.
- **D-02:** Excluded from exposure: card-paid orders (no credit extended), incomplete draft orders (no obligation yet), processing-state card payments. A partially-paid net-terms order counts at its REMAINING balance.
- **D-03:** Identity: exposure keys to the Company via `Order.purchasingEntity` (→ `PurchasingCompany`), NEVER `Order.customer` (which returns the company contact on B2B orders — documented Shopify attribution trap; see `.planning/research/SUMMARY.md` § Post-Research Findings).

#### Overdue Semantics
- **D-04:** No grace period in v1. A company becomes overdue at the first sweep after any of its payment schedules passes `dueAt`. Rationale: the merchant chose the due date; zero-config is the positioning vs Flow; the per-company bypass (CRED-02) is the escape valve. Merchant-configurable grace period → deferred (v1.x).
- **D-05:** Overdue sweep runs HOURLY (cheap indexed query over due dates). Full source-of-truth reconciliation sweep runs DAILY. Both in the same node-cron in-process scheduler; scheduler must skip shops where `Shop.active = false` (carry-forward CF-3 — make this structural, not a comment).

#### Backfill Scope
- **D-06:** Install backfill ingests ALL open (unpaid/partially-paid) net-terms orders regardless of age — no window. Understating exposure on day one is worse than surfacing stale disputes: observe-only default (CRED-04) plus the guided-setup "review balances" step makes old junk visible and non-blocking until the merchant acts.

#### Multi-Currency
- **D-07:** Single ledger in the store's base currency using `shopMoney` amounts on every money field (Shopify's canonical conversion). Credit limits are denominated in store currency. No per-currency ledgers or limits in v1. Dashboard labels amounts with store currency (note for Phase 6).

### Claude's Discretion
- Everything technical: Prisma schema shape for orders/schedules/company balances, webhook topic set and scope list (CF-1 — decide the minimal scope set from the real query needs of this phase and record it), GraphQL query design, dedupe storage, bulk-query vs paginated backfill, test data design, chaos-test approach for webhook redelivery/reordering.

### Deferred Ideas (OUT OF SCOPE)
- Merchant-configurable overdue grace period (v1.x — weakens zero-config positioning now; bypass toggle covers exceptions)
- Per-currency ledgers/limits (multi-entity suite territory)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LEDG-01 | App backfills all companies, open net-terms orders, and payment schedules on install | Bulk Operations findings (§ Backfill Strategy): single `bulkOperationRunQuery` over `orders(query: "financial_status:pending OR financial_status:partially_paid")` + paginated `companies` query; JSONL `__parentId` reassembly pattern; `read_all_orders` scope requirement + approval timeline (§ Scopes) |
| LEDG-02 | Per-company ledger driven by order/payment webhooks (HMAC-verified, deduped, refetch-and-recompute) | Verified webhook topic set + exact strings (§ Webhook Topics); `X-Shopify-Webhook-Id` dedupe; topic-agnostic refetch query (§ Code Examples); existing `authenticate.webhook` 401 pattern from Phase 1 |
| LEDG-03 | Partial payments, refunds, and order edits handled correctly | `Order.totalOutstandingSet` semantics (§ The Exposure Field); topic coalescing behavior (orders/paid suppressed near orders/updated); refetch-and-recompute makes every mutation path converge on the same number |
| LEDG-04 | Daily reconciliation sweep detects/corrects drift | `orders(query: "updated_at:>=<cursor>", sortKey: UPDATED_AT)` verified filter (§ Reconciliation); cursor-with-overlap pattern |
| LEDG-05 | Hourly sweep flips companies overdue when `dueAt` passes | Indexed local-DB sweep over open schedules; `payment_schedules/due` webhook exists as a bonus signal (never the primary mechanism — D-05 locks the hourly sweep); scheduler leader-lease pattern for Railway deploy overlap (§ Scheduler) |
</phase_requirements>

## Summary

Every load-bearing API fact this phase depends on was verified against live shopify.dev 2026-07 docs this session. The three headline findings:

1. **The exposure amount should come from `Order.totalOutstandingSet.shopMoney`, not from summing `PaymentSchedule` money fields.** `PaymentSchedule.balanceDue`/`totalBalance` exist but are `MoneyV2` (single currency, currency unspecified in docs — almost certainly presentment), while `totalOutstandingSet` is a `MoneyBag!` explicitly documented as "the total amount not yet transacted for the order, **in shop and presentment currencies**" — exactly what D-07 requires. Payment schedules supply `dueAt`/`completedAt` (the due-date and open/closed signal); the Order supplies the money. This satisfies D-01's intent (remaining balance net of partial payments) with Shopify's own canonical number — the same "balance due" the merchant sees in admin, which is the phase's success criterion 1.

2. **The 60-day order window is a real gate on D-06.** `read_orders` alone returns only the last 60 days of orders; the full backfill requires `read_all_orders`, which needs a Partner Dashboard access request (~7 business days review). Development stores work without approval, so Phase 2 builds and tests unblocked — but the request must be filed at the start of this phase or launch slips. Orders are also protected customer data (Level 1 suffices for this phase — no name/email/address fields needed), which is a second dashboard configuration to file now.

3. **The webhook topic set and semantics are nailed down**, including a documented trap: when `orders/updated` and `orders/paid` fire within ~15 seconds of each other, only `orders/updated` may be delivered. The handler must therefore be topic-agnostic — every order-shaped webhook triggers the same refetch-and-recompute path, which the architecture already mandates. `payment_terms/update` and `payment_schedules/due` topics exist (scope `read_payment_terms`) and cover due-date edits the `orders/*` topics may miss.

**Primary recommendation:** Set `scopes = "read_orders,read_all_orders,read_payment_terms,read_companies"`, subscribe to the eleven topics listed in § Webhook Topics, backfill via one bulk operation + one paginated companies query, compute exposure as the sum of `totalOutstandingSet.shopMoney.amount` over non-cancelled orders with open payment schedules keyed by `purchasingEntity`, and run both sweeps through a Postgres lease-guarded node-cron 4.x scheduler that iterates only `Shop.active = true`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Webhook ingestion (HMAC, dedupe, ack) | API/Backend (React Router action routes) | — | Shopify POSTs to the always-on server; `authenticate.webhook` is the only valid verifier |
| Order refetch + ledger recompute | API/Backend (service module) | Database (persisted result) | Recompute-from-source needs Admin GraphQL; result persisted for Phases 3/6 |
| Install backfill | API/Backend (bulk operation orchestration) | Database | Bulk ops are server-initiated; JSONL parsed server-side |
| Overdue flip (time passing) | Backend scheduler → Database | — | No webhook fires for time; indexed local query over `dueAt` |
| Reconciliation | Backend scheduler → Admin GraphQL | Database | Polling backstop for missed webhooks |
| Credit-state publication (metafields) | **OUT OF SCOPE — Phase 3** | — | This phase persists state locally only |
| Checkout blocking | **OUT OF SCOPE — Phase 4** | — | Function reads Phase 3 metafields |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@shopify/shopify-app-react-router` | ^1.1.0 (installed; **stay on 1.x this phase**) | `authenticate.webhook`, `unauthenticated.admin(shop)` GraphQL client for scheduler/backfill contexts | Already wired in Phase 1; v2.0.0 exists on npm `[VERIFIED: npm registry — npm view returned 2.0.0]` but a mid-phase major upgrade is uncontrolled risk; defer, see State of the Art |
| `node-cron` | ^4.6.0 | Hourly overdue sweep + daily reconciliation, in-process | Pre-approved in project stack (listed at ^3.x); registry latest is 4.6.0, published 2026-07-05, 5.2M weekly downloads, repo github.com/node-cron/node-cron, no postinstall script `[VERIFIED: npm registry + package-legitimacy check OK]`. v4 is the maintained line — see Pitfall 8 for the v3→v4 API differences |
| Prisma / `@prisma/client` | ^6.16.3 (installed) | New ledger models + migrations; `Prisma.Decimal` for money | Already the project ORM; `Decimal` avoids float money arithmetic |
| `@shopify/api-codegen-preset` | ^2.0.0 (installed) | Typed, schema-validated GraphQL documents against pinned `ApiVersion.July26` | Already configured in `.graphqlrc.ts` — this is the safety net that catches any field-name mistake in the queries below at typecheck time |
| vitest | ^4.1.10 (installed) | Unit + integration tests against `creditguard_test` | Phase 1 Wave 0 infrastructure; serial files, committed dummy secret |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:readline` (stdlib) | Node 22 built-in | Stream-parse bulk operation JSONL line-by-line | Backfill result processing — no new dependency needed |
| `node:crypto` (stdlib) | Node 22 built-in | Already used by the signed-webhook test helper | Chaos tests reuse `tests/helpers/webhook-hmac.ts` |

**No other new packages.** Queue libraries (BullMQ), retry libraries, and money libraries are all explicitly not needed at this scale (see Don't Hand-Roll).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node-cron ^4.6.0 | Pin node-cron ^3.x (as stack table says) | 3.x is the previous major; 4.x is the maintained TS rewrite with built-in `noOverlap`. Cost: small API differences (Pitfall 8). Recommendation: 4.x |
| Bulk operation backfill | Paginated `orders(first: 250)` loop | Pagination burns rate-limit points and needs cursor bookkeeping; bulk ops are explicitly exempt from query cost limits `[CITED: shopify.dev/docs/api/usage/limits]`. Pagination acceptable as a fallback for the tiny-store case if the bulk op errors |
| Postgres lease row for scheduler mutual exclusion | `pg_try_advisory_lock` via `$queryRaw` | Advisory locks are connection-scoped; Prisma's pool can acquire and release on different connections. A lease row (atomic `UPDATE ... WHERE lockedUntil < now()`) has no pool hazard. Advisory xact-locks work but force the sweep inside a long transaction — bad with external API calls |

**Installation:**
```bash
npm install node-cron@^4.6.0
npm install -D @types/node-cron   # only if needed — node-cron 4.x ships its own types; check before adding
```

**Version verification (performed this session):**
```bash
npm view node-cron version                      # → 4.6.0 (2026-07-05)
npm view @shopify/shopify-app-react-router version  # → 2.0.0 (repo stays on ^1.1.0 this phase)
```

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| node-cron | npm | mature (latest 4.6.0 pub 2026-07-05) | 5,200,496/wk | github.com/node-cron/node-cron | OK | Approved — no postinstall script, not deprecated `[VERIFIED: npm registry + gsd package-legitimacy check]` |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## The Exposure Field (Question 1 — RESOLVED)

Verified 2026-07 shapes, quoted from live docs:

**`PaymentSchedule`** `[CITED: shopify.dev/docs/api/admin-graphql/2026-07/objects/PaymentSchedule]`:
- `dueAt: DateTime` — "Date and time when the payment schedule is due."
- `completedAt: DateTime` — "Date and time when the payment schedule is paid or fulfilled." → **`completedAt == null` is the open-schedule signal**
- `due: Boolean!`, `issuedAt: DateTime`
- `balanceDue: MoneyV2!` — "Remaining balance to be captured for this payment schedule."
- `totalBalance: MoneyV2!` — "Remaining balance to be paid or authorized by the customer for this payment schedule."
- `amount: MoneyV2!` — **deprecated**
- `paymentTerms: PaymentTerms!`
- Implements `Node` (bulk-op compatible)

**`PaymentTerms`** `[CITED: shopify.dev/docs/api/admin-graphql/2026-07/objects/PaymentTerms]`:
- `paymentTermsType: PaymentTermsType!` — enum values `RECEIPT`, `NET`, `FIXED`, `FULFILLMENT`, `UNKNOWN` `[CITED: .../enums/PaymentTermsType]`
- `paymentTermsName: String!`, `dueInDays: Int`, `due: Boolean!`, `overdue: Boolean!` ("Whether the payment terms have overdue payment schedules"), `paymentSchedules: PaymentScheduleConnection!`, `order: Order`, `draftOrder: DraftOrder`
- Reached via `Order.paymentTerms` (nullable — **null means no terms, i.e., not a net-terms order → D-02 exclusion of card-paid orders falls out naturally**)

**`Order` money/status fields** `[CITED: shopify.dev/docs/api/admin-graphql/2026-07/objects/Order]`:
- `totalOutstandingSet: MoneyBag!` — "The total amount not yet transacted for the order, **in shop and presentment currencies**."
- `totalReceivedSet: MoneyBag!` ("total amount received from the customer before returns"), `totalRefundedSet: MoneyBag!`, `netPaymentSet: MoneyBag!` ("total amount received minus total refunded"), `refunds: [Refund!]!`
- `displayFinancialStatus` enum; filter-syntax values: `paid`, `pending`, `authorized`, `partially_paid`, `partially_refunded`, `refunded`, `voided`, `expired`

**Prescription for D-01 exposure:**

> Order's exposure contribution = `totalOutstandingSet.shopMoney.amount` **iff** `paymentTerms != null` AND `cancelledAt == null` AND at least one `paymentSchedule.completedAt == null`. Company exposure = sum of contributions over that company's orders. Due-date/overdue state comes from the schedules' `dueAt`.

Why this and not summing schedule `balanceDue`/`totalBalance`:
1. **D-07 requires shopMoney.** Schedule money fields are `MoneyV2` — one currency, and the docs don't say which; almost certainly presentment `[ASSUMED — A1]`. `totalOutstandingSet` is the only verified store-currency remaining-balance number.
2. **Partial payments:** "not yet transacted" decreases as payments are received — a partially-paid net-terms order counts at its remaining balance, exactly D-02.
3. **Refunds:** refunds return already-transacted money; the collectible remainder ("not yet transacted") is what the merchant can still expect. Order edits that shrink the total shrink `totalOutstanding`. This is Shopify's own "balance due" figure shown in admin — matching the phase's "must match admin" success criterion. Exact refund-vs-outstanding interaction on a partially-paid order must be confirmed empirically on the dev store during execution `[ASSUMED — A2]`.
4. Net-terms orders (type `NET`) carry a single schedule in practice, so per-order granularity loses nothing `[ASSUMED — A3]`.

Store `balanceDue`/`totalBalance` (and their currencyCode) on the schedule rows anyway — cheap, and useful for the A1/A2 empirical checks and Phase 5 reminders.

## purchasingEntity (Question 2 — RESOLVED)

`PurchasingEntity` union = `Customer | PurchasingCompany`; `PurchasingCompany` has fields `company`, `companyContact`, `location` (**CORRECTED 2026-08-19** — this doc originally said `companyLocation`, which does NOT exist in the 2026-07 schema; verified against generated types during plan 02-01. Always run `npm run graphql-codegen` before trusting a field name from this document.); available on `Order`, `DraftOrder`, `CalculatedDraftOrder` `[CITED: shopify.dev/docs/api/admin-graphql/2026-07/unions/PurchasingEntity]`.

Webhook payloads are REST-shaped JSON (snake_case, numeric IDs) and include `admin_graphql_api_id` for the order `[ASSUMED — A4, standard payload shape]`. Whether the payload embeds company data is irrelevant: **the payload is only a doorbell.** The handler extracts `admin_graphql_api_id` (fallback: construct `gid://shopify/Order/{id}`) and refetches via the query in Code Examples. D-03 is satisfied by never touching `Order.customer` anywhere in ledger code — add a source-guard test in the style of Phase 1's prohibition tests (grep the ledger service source for `customer` reads).

## Webhook Topics (Question 3 — RESOLVED)

Exact topic strings + scopes from the `WebhookSubscriptionTopic` enum `[CITED: shopify.dev/docs/api/admin-graphql/2026-07/enums/WebhookSubscriptionTopic]`:

| Topic string | Fires when | Scope | Subscribe? |
|---|---|---|---|
| `orders/create` | order created (any source: checkout, draft complete, admin, POS) | `read_orders` | **Yes** — exposure increases immediately |
| `orders/updated` | "whenever an order is updated" — payments captured, edits committed, refunds, internal updates | `read_orders` | **Yes** — the workhorse; partial payments arrive here |
| `orders/paid` | "whenever an order is paid" (financial status → paid, incl. mark-as-paid) | `read_orders` | **Yes** — belt-and-braces; see coalescing note |
| `orders/edited` | order edit committed | `read_orders` | **Yes** — payload is an order_edit shape; handler still just refetches the order |
| `orders/cancelled` | order cancelled | `read_orders` | **Yes** — cancelled orders leave exposure |
| `orders/delete` | order deleted | `read_orders` | **Yes** — remove ledger row |
| `refunds/create` | "a new refund is created without errors on an order" | `read_orders` | **Yes** — refetch parent order |
| `payment_terms/update` (also `/create`, `/delete`) | payment terms created/changed/removed on an order (e.g., merchant edits due date) | `read_payment_terms` | **Yes** (all three) — due-date edits may not fire `orders/updated` |
| `payment_schedules/due` | "whenever payment schedules are due" | `read_payment_terms` | **Yes, as bonus signal only** — D-05's hourly sweep remains the mechanism of record; delivery timing/reliability of this topic is unverified `[ASSUMED — A5]` |
| `companies/create`, `companies/update`, `companies/delete` | company lifecycle | `read_customers` **or** `read_companies` | **Yes** — keeps LEDG-01's company list fresh post-backfill |
| `bulk_operations/finish` | "Notifies when a Bulk Operation finishes" | — | **Yes** — completes the backfill flow (with polling fallback) |

Skip: `company_locations/*`, `company_contacts/*`, `company_contact_roles/*` (location granularity is deferred; store `location.id` from orders instead), `orders/fulfilled`/`partially_fulfilled` (fulfillment doesn't move money).

**Critical semantics (community-verified):**
- **Coalescing:** if subscribed to both `orders/updated` and `orders/paid` and multiple events occur within ~15 seconds, you may receive **only** `orders/updated` `[CITED: community.shopify.dev/t/orders-paid-vs-orders-updated/715]`. → Never branch ledger logic on topic name; every `orders/*` + `refunds/create` + `payment_terms/*` delivery funnels into the same `refetchOrderAndRecompute(orderGid)`.
- Split/partial payments fire a webhook **per payment**, and the order can transiently read `partially_paid` mid-creation `[CITED: changelog.shopify.com pos-checkout-update post]`. Recompute-from-source makes this self-healing.
- `orders/updated` is not guaranteed for every state change (community reports of gaps) — that is precisely what LEDG-04's reconciliation backstops `[CITED: community.shopify.dev/t/orders-updated-not-always-fired-when-paid-status-changes/1485]`.

All subscriptions go in `shopify.app.toml` `[[webhooks.subscriptions]]` blocks (config deploys on every `shopify app deploy` — keep TOML pristine, CF-5: re-grep `api_version = "2026-07"` after every CLI command).

**Dedupe:** unique constraint on the `X-Shopify-Webhook-Id` header value (header name confirmed in the Phase 1 HMAC helper, which reproduces real deliveries header-for-header). Store `(webhookId unique, shop, topic, orderGid?, receivedAt, processedAt?)`; insert-or-skip before processing.

## Scopes — CF-1 Decision Input (Question 4 — RESOLVED)

**Recommended scope string for this phase:**

```toml
[access_scopes]
scopes = "read_orders,read_all_orders,read_payment_terms,read_companies"
```

| Scope | Grants | Evidence |
|---|---|---|
| `read_orders` | Orders + order webhooks — **last 60 days only** by default | `[CITED: shopify.dev/docs/api/usage/access-scopes]` "By default, apps access the last 60 days' worth of orders… To access all the orders, you need to request access to the `read_all_orders` scope" |
| `read_all_orders` | Removes the 60-day window — **required by D-06** | Approval via Partner Dashboard → Access requests → "Read all orders" card → describe purpose; review "up to seven business days" `[CITED: shopify.dev/changelog/apps-now-need-shopify-approval-to-read-orders-older-than-60-days + access-scopes page]`. **Development stores work without approval** — build/test proceeds; production launch is gated |
| `read_payment_terms` | `PaymentTerms`, `PaymentSchedule` objects + `payment_terms/*`, `payment_schedules/due` webhooks | `[CITED: access-scopes page: "read_payment_terms, write_payment_terms → PaymentSchedule, PaymentTerms"]` |
| `read_companies` | `Company`, `CompanyLocation` + `companies/*` webhooks | Company object: "Requires `read_customers` access scope or `read_companies` access scope" `[CITED: .../objects/Company]`. `read_companies` is the narrower choice — avoids requesting all customer PII (app-review liability, DI-02) |

**Explicitly NOT requested this phase:** `read_customers` (superset — avoid), `write_companies` (Phase 3 metafield writes; `metafieldsSet` on Company owners will need the company write scope `[ASSUMED — A6]`), any `write_*`. Adding a scope later is low-friction: managed installation prompts the merchant on next admin open, and the `webhooks.app.scopes_update.tsx` route from Phase 1 already records grants. Zero install base = zero re-consent pain.

**Protected customer data (must be configured this phase, in parallel):** Orders (and order webhooks) are protected customer data. Two dashboard actions `[CITED: shopify.dev/docs/apps/launch/protected-customer-data]`:
1. Request **Level 1** protected customer data access (customer data *excluding* name, address, phone, email) — sufficient for this phase, which reads only company IDs, money, and dates. "Level 1 development access available immediately"; public-app approval needed before listing.
2. Do **not** request Level 2 fields yet. Phase 5 (reminder emails need contact email) will require Level 2 + data protection review — note for that phase's planning.
Unapproved fields return `null` with an error — a silent-corruption vector in production if skipped, so file both requests (read_all_orders + PCD Level 1) as a Wave-1 human task.

**Runtime env note:** `app/shopify.server.ts` reads `scopes: process.env.SCOPES?.split(",")` — Railway's `SCOPES` variable and the TOML must be updated together, and `vitest.config.ts` pins `SCOPES: ""` in test env (update to match).

## Backfill Strategy (Question 5 — RESOLVED)

**Prescription: one bulk operation for orders, one paginated query for companies.**

Bulk operations facts `[CITED: shopify.dev/docs/api/usage/bulk-operations/queries]`:
- Up to **five concurrent bulk query operations per shop** on API 2026-01+ (2026-07 inherits this; older docs say one — outdated)
- No query-cost or rate limits on bulk operations `[CITED: usage/limits]`
- Results: JSONL file at `url` on the completed operation; monitor via `bulk_operations/finish` webhook or poll `bulkOperation(id:)` (2026-01+ replacement for `currentBulkOperation`)
- Restrictions: max 5 connections total, max 2 nesting levels, connections must implement `Node` (`PaymentSchedule` does), no top-level `node`/`nodes`
- **JSONL gotcha:** nested connection rows (paymentSchedules) arrive as **separate lines** with `__parentId` pointing at the order — the parser must reassemble parent/child, and children follow their parent in file order

**Server-side filter:** orders search syntax supports `financial_status`, `status`, `created_at`, `updated_at` (values incl. `pending`, `partially_paid`) `[CITED: .../queries/orders]`. There is **no `payment_terms` filter** — filter `paymentTerms == null` client-side while streaming. Net-terms unpaid orders carry financial status `pending` (admin: "Payment pending") `[ASSUMED — A7; verify on dev store during execution]`, so:

```
query: "financial_status:pending OR financial_status:partially_paid"
```

No `created_at` clause — D-06 mandates no age window (this is why `read_all_orders` is non-negotiable). Companies: paginated `companies(first: 250)` query (`read_companies`) — merchant company counts are small; a second bulk op is allowed (5 concurrent) but unnecessary `[ASSUMED — A8: companies query max page size]`.

**Rate limits for non-bulk work** `[CITED: shopify.dev/docs/api/usage/limits]`: restore rates — standard 100 pts/s, Advanced 200, Plus 1000; single query hard cap 1000 points; objects cost 1 pt, connections sized by `first`. The per-order refetch below costs roughly a dozen points — webhook-driven refetches will never approach the bucket at MVP scale. The GraphQL client in `@shopify/shopify-app-react-router` surfaces throttling; simple retry-on-throttle with backoff in the reconciliation loop is sufficient (do not build a rate-limit manager).

**Backfill trigger:** on first authenticated admin load for a shop without a completed backfill (idempotent `BackfillRun` row keyed by shop, status), not inside the OAuth callback. Use `unauthenticated.admin(shop)` for the scheduler/webhook-context Admin client `[ASSUMED — A9: exact helper name; verify against installed 1.1.0 API at build time]`.

## Reconciliation Query (Question 6 — RESOLVED)

```
orders(first: 250, query: "updated_at:>=2026-08-18T00:00:00Z", sortKey: UPDATED_AT)
```

`updated_at` range filter and `UPDATED_AT` sortKey are both in the verified orders-query docs `[CITED: .../queries/orders — example "updated_at:>2019-12-01"]`. Pattern:
1. Persist a per-shop cursor (`SyncCursor` row) = max `updatedAt` seen minus a 5-minute overlap (clock-skew tolerance).
2. Daily sweep pages through matches, upserts order rows, recomputes affected companies via the single `recomputeCompany()` path.
3. Drift detection = compare recomputed exposure vs stored exposure; log discrepancies to Sentry as warnings (they indicate missed webhooks) — the ledger self-corrects either way.
4. Also re-verify locally-open schedules: any local order with open schedules **not** returned by an open-status probe gets individually refetched (catches deletes/archives that produce no update).

## Scheduler: node-cron on Railway (Question 7 — RESOLVED)

**Railway deploy overlap is real:** on each deploy the new container goes active while "the previous deployment remains active for a configurable amount of time" (`RAILWAY_DEPLOYMENT_OVERLAP_SECONDS`), then receives SIGTERM with `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` (default 0) to shut down `[CITED: docs.railway.com/deployments/reference + deployment-teardown]`. Two containers → two schedulers → double-fire window.

**Layered mitigation (in priority order):**
1. **Correctness by construction:** both sweeps are recompute-from-source and idempotent — a double-fire produces identical writes, never drift. This is the actual safety property; everything below is efficiency/hygiene.
2. **Postgres lease row:** `SweepLease(name PK, holder, lockedUntil)`; claim with a single atomic `UPDATE ... SET holder, lockedUntil = now() + interval '10 minutes' WHERE name = $1 AND lockedUntil < now()` (affected-rows 1 = leader). No advisory-lock/connection-pool hazard (advisory locks are session-scoped; Prisma's pool can acquire and release on different connections — avoid).
3. **SIGTERM handler:** stop cron tasks and let in-flight sweep iterations finish; a mid-sweep kill is harmless (next run re-derives everything). Missed runs during restart are absorbed by the hourly cadence — D-04's semantics are "at the first sweep after `dueAt`", not "at `dueAt`".
4. Optionally set `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0` on the service (accepts a blip of downtime; not required given 1–2).

**node-cron 4.x notes** `[CITED: nodecron.com/migrating-from-v3 + github.com/node-cron/node-cron]`: v4 is a TypeScript rewrite; `scheduled:` and `runOnInit:` options removed (tasks start on creation; use `createTask` for stopped-at-creation); `noOverlap: true` skips a tick if the previous run is still going (use it on both sweeps); events via `task.on(...)` not EventEmitter inheritance.

**CF-3 made structural:** a single `forEachActiveShop(fn)` helper that queries `Shop.findMany({ where: { active: true } })` is the ONLY way sweeps enumerate shops, plus a source-guard test (Phase 1 style) asserting the scheduler module contains no direct `shop.findMany` without the active filter.

## Recommended Prisma Schema Shape (Claude's discretion — prescription)

```prisma
model Company {            // one per Shopify Company per shop
  id            String   @id @default(cuid())
  shop          String
  companyGid    String   // gid://shopify/Company/...
  name          String
  exposure      Decimal  @default(0) @db.Decimal(19, 4)  // store currency (D-07)
  overdue       Boolean  @default(false)
  earliestDueAt DateTime?
  recomputedAt  DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  orders        LedgerOrder[]
  @@unique([shop, companyGid])
  @@index([shop, overdue])
}

model LedgerOrder {        // cache of ledger-relevant order state, refetched from source
  id                 String    @id @default(cuid())
  shop               String
  orderGid           String
  name               String    // e.g. #1042 — for dashboard + admin cross-check
  companyId          String?   // null = D2C / no purchasing company → excluded from exposure
  companyLocationGid String?
  hasPaymentTerms    Boolean
  paymentTermsType   String?   // NET | RECEIPT | FIXED | FULFILLMENT | UNKNOWN
  financialStatus    String?
  cancelledAt        DateTime?
  outstandingShop    Decimal   @db.Decimal(19, 4)  // totalOutstandingSet.shopMoney.amount
  currencyCode       String    // shop currency; sanity-checked constant per shop
  sourceUpdatedAt    DateTime  // Order.updatedAt — reconciliation cursor support
  refetchedAt        DateTime
  company            Company?  @relation(fields: [companyId], references: [id])
  schedules          LedgerSchedule[]
  @@unique([shop, orderGid])
  @@index([shop, companyId])
}

model LedgerSchedule {
  id           String    @id @default(cuid())
  shop         String
  scheduleGid  String
  orderId      String
  dueAt        DateTime?
  completedAt  DateTime?
  order        LedgerOrder @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@unique([shop, scheduleGid])
  @@index([shop, dueAt])   // the hourly overdue sweep's index (D-05: "cheap indexed query")
}

model WebhookReceipt {     // dedupe (LEDG-02)
  id          String   @id            // X-Shopify-Webhook-Id
  shop        String
  topic       String
  receivedAt  DateTime @default(now())
  processedAt DateTime?
}

model SyncCursor { ... }   // (shop, key) → value: reconciliation updated_at cursor, backfill status
model SweepLease { ... }   // name PK, holder, lockedUntil — scheduler leadership
```

Money: `Decimal(19,4)` everywhere, never Float. Exposure is stored per company but **always derivable** by summing open orders — the reconciliation sweep asserts this invariant.

## Architecture Patterns

### System Architecture Diagram

```
 Shopify (source of truth)
 ├── webhooks: orders/*, refunds/create, payment_terms/*, companies/*, bulk_operations/finish
 │        │  POST (HMAC-signed)
 │        ▼
 │   [Webhook routes]  ──authenticate.webhook (401 bad HMAC)──► [WebhookReceipt dedupe: seen? → ack 200, stop]
 │        │ ack 200 fast
 │        ▼
 │   extract orderGid / companyGid from payload (doorbell only — payload never trusted for amounts)
 │        ▼
 ├──◄ [Refetch: Admin GraphQL OrderForLedger query] ◄─────────────┐
 │        ▼                                                       │
 │   [upsert LedgerOrder + LedgerSchedules]                       │
 │        ▼                                                       │
 │   [recomputeCompany(companyId)] ← single pure code path ◄──────┼───────────┐
 │        ▼                                                       │           │
 │   [Company.exposure / overdue / earliestDueAt persisted]       │           │
 │                                                                │           │
 ├──◄ [Install backfill: bulkOperationRunQuery → JSONL stream] ───┘           │
 │     (bulk_operations/finish webhook or poll bulkOperation(id:))            │
 │                                                                            │
 └──◄ [Scheduler (node-cron, SweepLease-guarded, forEachActiveShop)]          │
        ├── hourly: overdue sweep — local indexed query on                    │
        │           LedgerSchedule(dueAt < now, completedAt null) ────────────┤
        └── daily:  reconciliation — orders(updated_at:>=cursor) refetch ─────┘

 (Phase 3 consumes Company.* → metafields; Phase 4 Function reads metafields; NOT this phase)
```

### Recommended Project Structure

```
app/
├── routes/
│   ├── webhooks.orders.tsx            # one route, topic switch → same ingest path
│   ├── webhooks.payment-terms.tsx     # payment_terms/*, payment_schedules/due
│   ├── webhooks.companies.tsx         # companies/*
│   └── webhooks.bulk-operations.tsx   # bulk_operations/finish → backfill continuation
├── services/
│   ├── ledger.server.ts               # refetchOrderAndRecompute, upsert, recomputeCompany (pure core)
│   ├── backfill.server.ts             # bulk op start/poll/parse (__parentId reassembly)
│   ├── reconciliation.server.ts       # updated_at cursor sweep
│   ├── scheduler.server.ts            # node-cron wiring, SweepLease, forEachActiveShop
│   └── shop-lifecycle.server.ts       # (existing — extend alongside)
└── graphql/                           # .graphql documents or ts template literals → codegen types
```

### Pattern 1: Topic-Agnostic Ingest (dedupe → ack → refetch → recompute)

**What:** every order-adjacent webhook resolves to `refetchOrderAndRecompute(shop, orderGid)`; no topic-specific ledger logic.
**When to use:** all `orders/*`, `refunds/create` (payload carries `order_id`), `payment_terms/*` (refetch the owning order).
**Why:** coalescing (orders/paid suppressed near orders/updated), at-least-once delivery, and out-of-order delivery all become non-events — the refetched order is always current-state.

### Pattern 2: Pure Compute Core, Injected I/O

**What:** `computeCompanyState(orders: LedgerOrderInput[]): { exposure, overdue, earliestDueAt }` is a pure function over plain data; fetching (GraphQL) and persistence (Prisma) live in thin wrappers.
**Why:** LEDG-03's partial/refund/edit matrix and the chaos tests become fast unit tests over fixtures — no GraphQL mocking gymnastics for the correctness core.

### Pattern 3: Bulk JSONL Reassembly

**What:** stream JSONL with `node:readline`; lines without `__parentId` are orders, lines with `__parentId` are payment schedules belonging to the (immediately preceding) parent order; buffer one order + its children, then upsert atomically.

### Anti-Patterns to Avoid

- **`balance += delta` anywhere** — locked out by architecture (recompute-from-source); incremental arithmetic is killer bug #2 in PITFALLS.md.
- **Reading `Order.customer` for identity** — D-03/CF-2; add the source-guard test.
- **Trusting webhook payload amounts** — payloads are REST-shaped, may be stale/reordered; doorbell only.
- **Branching ledger behavior on webhook topic** — coalescing makes topic identity unreliable.
- **Advisory locks through the Prisma pool** — session-affinity hazard; use the lease row.
- **Heavy work before webhook ack** — verify, dedupe-insert, extract IDs, ack 200, then process; keep handler p95 well under Shopify's delivery timeout.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Webhook HMAC verification | manual crypto compare | `authenticate.webhook` (Phase 1 pattern) | Constant-time compare, header validation, 401 semantics already proven |
| Currency conversion | FX math for presentment→shop | `totalOutstandingSet.shopMoney` | Shopify already converts canonically (D-07's stated basis) |
| Money arithmetic | JS floats | `Prisma.Decimal` / `Decimal(19,4)` columns | 0.1 + 0.2 problems in a credit ledger are uninstall material |
| Cron parsing / scheduling | setInterval math | node-cron 4.x `noOverlap` | Pre-approved; handles tick overlap for free |
| Full-history order fetch | paginated crawler with rate-limit governor | Bulk Operations API | Exempt from cost limits; JSONL; 5 concurrent allowed |
| Typed GraphQL | hand-written response interfaces | `@shopify/api-codegen-preset` (already configured) | Validates every query against the pinned 2026-07 schema at build time — catches field typos before runtime |
| Job queue | BullMQ/Redis | in-process async after ack + reconciliation backstop | Stack decision (pre-approved); volume is hundreds of webhooks/day at MVP |

**Key insight:** the reconciliation sweep (LEDG-04) is the universal error-absorber — every "what if a webhook is missed/duplicated/reordered/coalesced" question has the same answer: the daily sweep re-derives truth. Build it early in the phase, not last.

## Common Pitfalls

### Pitfall 1: 60-day order window silently truncates the backfill
**What goes wrong:** with only `read_orders`, the bulk backfill returns 60 days of orders and D-06 is silently violated — day-one exposure understated, exactly the failure mode D-06 exists to prevent.
**Why:** `read_all_orders` gating is enforced by data filtering, not errors.
**How to avoid:** include `read_all_orders` in the scope string now; file the Partner Dashboard request immediately (≈7 business days); dev stores are exempt so testing proceeds.
**Warning signs:** oldest backfilled order exactly ~60 days old; production behaves differently from the dev store.

### Pitfall 2: Protected-customer-data nulls in production
**What goes wrong:** unapproved protected fields return `null` + errors on production stores while working fine on the dev store.
**How to avoid:** request PCD Level 1 in the dashboard this phase; keep this phase's queries free of name/email/phone/address (they are — company id + money + dates); treat unexpected `userErrors`/`extensions` on refetch as alertable, not ignorable.

### Pitfall 3: Topic coalescing eats `orders/paid`
**What goes wrong:** logic keyed to `orders/paid` never runs when `orders/updated` fired within ~15s (the common case for net-terms payments recorded in admin).
**How to avoid:** Pattern 1 (topic-agnostic ingest). Chaos test: deliver `orders/updated` alone for a payment and assert the ledger converges.

### Pitfall 4: Summing `PaymentSchedule` money across currencies
**What goes wrong:** `balanceDue`/`totalBalance` are `MoneyV2` (likely presentment); summing them across a company's multi-currency orders produces a meaningless number and violates D-07.
**How to avoid:** exposure only ever reads `totalOutstandingSet.shopMoney`; assert `currencyCode` equals the shop's currency and alert if not.

### Pitfall 5: Bulk JSONL parsed as if nested
**What goes wrong:** expecting `paymentSchedules` inline on each order line; in bulk results children are separate lines with `__parentId`, so a naive parser sees orders with zero schedules and marks every order termless.
**How to avoid:** reassembly parser (Pattern 3) + a fixture-file test containing parent/child lines.

### Pitfall 6: Two schedulers during Railway deploy overlap
**What goes wrong:** double sweeps burn rate limit and double-send in Phase 5 (emails!).
**How to avoid:** SweepLease claim before each run; sweeps idempotent regardless. Build the lease NOW because Phase 5 reuses this scheduler where double-fire is merchant-visible.

### Pitfall 7: Test orders and non-company orders polluting exposure
**What goes wrong:** dev-store test orders, D2C orders, or draft-derived orders without a purchasing company get attributed or crash the recompute.
**How to avoid:** `purchasingEntity` null or `Customer` → persist order with `companyId = null` (visible for ENFC-06 groundwork, excluded from exposure); consider `Order.test` flag handling `[ASSUMED — A10]`.

### Pitfall 8: node-cron v3 idioms against v4
**What goes wrong:** `cron.schedule(expr, fn, { scheduled: false })` — `scheduled` was removed in v4; tasks start immediately on creation.
**How to avoid:** use `createTask` for start-later semantics, `task.on(...)` for events, `noOverlap: true` on both sweeps; pin `^4.6.0`.

### Pitfall 9: CLI rewrites `api_version` (CF-5)
**How to avoid:** after ANY `shopify` CLI command, `grep 'api_version = "2026-07"' shopify.app.toml` — the CLI has already rewritten it to the 2026-10 RC once. Add this grep to the phase's verification steps.

### Pitfall 10: Sentry scrubber untested on the busiest new path (W-2)
**What goes wrong:** webhook routes become the highest-traffic Sentry-instrumented code; `beforeSend`/`redactUrl` has no regression test, and order payloads contain customer PII.
**How to avoid:** this phase touches webhook paths → add the ~10-line `redactUrl` unit test (Phase 1 verification explicitly requested this) and never log payload bodies.

## Code Examples

Composed from field names verified against 2026-07 docs this session; **not executed against a live shop** — the repo's codegen (`npm run graphql-codegen`) validates all documents against the pinned July26 schema at build time, which is the executor's first gate.

### Order refetch (the single ledger query)

```graphql
# Source fields: [CITED: shopify.dev 2026-07 Order / PaymentTerms / PaymentSchedule / PurchasingEntity pages]
query OrderForLedger($id: ID!) {
  order(id: $id) {
    id
    name
    updatedAt
    cancelledAt
    displayFinancialStatus
    totalOutstandingSet { shopMoney { amount currencyCode } }
    totalReceivedSet    { shopMoney { amount currencyCode } }
    totalRefundedSet    { shopMoney { amount currencyCode } }
    purchasingEntity {
      __typename
      ... on PurchasingCompany {
        company { id name }
        location { id }
      }
      ... on Customer { id }
    }
    paymentTerms {
      id
      paymentTermsType
      paymentTermsName
      dueInDays
      overdue
      paymentSchedules(first: 10) {
        edges { node { id dueAt completedAt } }
      }
    }
  }
}
```

### Backfill bulk operation

```graphql
mutation StartLedgerBackfill {
  bulkOperationRunQuery(query: """
    {
      orders(query: "financial_status:pending OR financial_status:partially_paid") {
        edges {
          node {
            id
            name
            updatedAt
            cancelledAt
            displayFinancialStatus
            totalOutstandingSet { shopMoney { amount currencyCode } }
            purchasingEntity {
              __typename
              ... on PurchasingCompany { company { id name } location { id } }
            }
            paymentTerms {
              id
              paymentTermsType
              paymentSchedules {
                edges { node { id dueAt completedAt } }
              }
            }
          }
        }
      }
    }
  """) {
    bulkOperation { id status }
    userErrors { field message }
  }
}
# 2 connection nesting levels (orders → paymentSchedules): within the documented limit.
# Result JSONL: schedule lines carry __parentId = order gid — reassemble (Pattern 3).
```

### Webhook ingest skeleton (extends Phase 1 route pattern)

```typescript
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, webhookId } = await authenticate.webhook(request); // 401s on bad HMAC pre-handler

  // Dedupe: at-least-once delivery → unique insert or ack-and-stop
  try {
    await db.webhookReceipt.create({ data: { id: webhookId, shop, topic } });
  } catch (e) {
    if (isUniqueViolation(e)) return new Response(); // duplicate delivery
    throw e;
  }

  // Doorbell only — never read amounts from payload
  const orderGid =
    (payload as any).admin_graphql_api_id ??
    `gid://shopify/Order/${(payload as any).id ?? (payload as any).order_id}`;

  await refetchOrderAndRecompute(shop, orderGid); // refetch → upsert → recomputeCompany
  return new Response();
};
```
(`webhookId` availability on the `authenticate.webhook` return should be confirmed against the installed 1.1.0 types; fallback is the `X-Shopify-Webhook-Id` request header, which Phase 1's helper already reproduces `[ASSUMED — A11]`.)

### Scheduler with lease + active-shop gate

```typescript
import cron from "node-cron"; // v4: tasks start on creation; noOverlap skips ticks while running

cron.schedule("0 * * * *", () => runExclusive("overdue-sweep", overdueSweep), { noOverlap: true });
cron.schedule("30 3 * * *", () => runExclusive("reconciliation", reconciliationSweep), { noOverlap: true });

async function runExclusive(name: string, fn: () => Promise<void>) {
  const claimed = await db.$executeRaw`
    UPDATE "SweepLease" SET "holder" = ${INSTANCE_ID}, "lockedUntil" = now() + interval '30 minutes'
    WHERE "name" = ${name} AND "lockedUntil" < now()`;
  if (claimed === 0) return; // another container (deploy overlap) holds the lease
  try { await fn(); }
  finally {
    await db.$executeRaw`UPDATE "SweepLease" SET "lockedUntil" = now() WHERE "name" = ${name} AND "holder" = ${INSTANCE_ID}`;
  }
}

async function overdueSweep() {
  for (const shop of await db.shop.findMany({ where: { active: true } })) { // CF-3: structural gate
    // indexed: LedgerSchedule where shop, dueAt < now(), completedAt IS NULL → flip owning companies
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| One bulk operation per shop at a time | **Five** concurrent bulk query ops per shop | API 2026-01 | Backfill can't be blocked by another app's bulk op misconception; still design for sequential simplicity |
| `currentBulkOperation` polling | `bulkOperation(id:)` by ID | API 2026-01 | Poll the specific operation; no cross-talk |
| node-cron 3.x (`scheduled`, `runOnInit`) | node-cron 4.x (`createTask`, `noOverlap`, `task.on`) | 2025 (v4), latest 4.6.0 Jul 2026 | Stack table's "^3.x" is stale; use ^4.6.0 |
| `@shopify/shopify-app-react-router` 1.x | 2.0.0 published | ~Aug 2026 `[VERIFIED: npm registry]` | **Do not upgrade mid-phase.** Repo is on ^1.1.0 and Phase 1 verification pinned against it. Log as a candidate chore for a quiet window; check the changelog for `authenticate.webhook` signature changes first |
| REST Admin API order payloads as data source | GraphQL refetch; webhook payload as doorbell | project decision + REST legacy status | Payload shape drift is irrelevant to correctness |

**Deprecated/outdated:**
- `PaymentSchedule.amount` — deprecated in 2026-07; use `balanceDue`/`totalBalance` (and for exposure, neither — use the Order-level `totalOutstandingSet`).
- `currentBulkOperation` — superseded by `bulkOperation(id:)`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `PaymentSchedule.balanceDue`/`totalBalance` are presentment-currency | Exposure Field | None if prescription followed (schedule money is stored but never summed for exposure) |
| A2 | `totalOutstandingSet` behaves as "collectible remainder" through the partial-payment → refund sequence (matches admin balance due) | Exposure Field | Exposure could over/understate after refunds on partially-paid orders. **Mitigation: mandatory dev-store empirical test during execution (order → partial pay → refund → compare admin vs API)** |
| A3 | NET-type payment terms carry exactly one payment schedule | Exposure Field | None structurally — schema stores N schedules; only `earliestDueAt` selection matters |
| A4 | Order webhook payloads include `admin_graphql_api_id` | purchasingEntity | Fallback GID construction from numeric `id` covers it |
| A5 | `payment_schedules/due` delivery timing is reliable enough to be useful | Webhook Topics | None — it's a bonus signal; D-05's hourly sweep is the mechanism of record |
| A6 | Phase 3 `metafieldsSet` on Company owners requires `write_companies` (or `write_customers`) | Scopes | Phase 3 scope addition adjusts; managed installation handles escalation |
| A7 | Unpaid net-terms orders match `financial_status:pending` in search syntax | Backfill | Backfill misses orders → caught by success criterion 1 (compare against admin); widen filter or drop it and filter client-side |
| A8 | `companies` query supports `first: 250` pagination | Backfill | Lower page size = more pages; trivial |
| A9 | `unauthenticated.admin(shop)` is the correct 1.1.0 API for background Admin clients | Backfill/Scheduler | Alternate: build client from stored offline session; check installed types at build time |
| A10 | `Order.test` flag exists for excluding test orders | Pitfall 7 | Dev-store noise only; verify field at codegen time |
| A11 | `authenticate.webhook` returns `webhookId` in installed v1.1.0 | Code Examples | Read `X-Shopify-Webhook-Id` header directly (name verified in Phase 1 helper) |
| A12 | Including `read_all_orders` in TOML pre-approval doesn't break dev-store installs | Scopes | Temporarily deploy without it for dev; add on approval |

## Open Questions (RESOLVED)

1. **Does a refund on a partially-paid net-terms order change `totalOutstandingSet`?** — *RESOLVED by prescription; residual (totalOutstandingSet behavior through partial-pay→refund) delegated to 02-05 T3 mandatory A2 dev-store check by prescription: use `totalOutstandingSet` as the canonical number either way (it is what admin shows, which is the success criterion). Residual: empirical confirmation of the exact sequence is a mandatory execution-time dev-store test (A2).*
2. **Exact field to sum for exposure** — **RESOLVED:** `Order.totalOutstandingSet.shopMoney.amount`, gated on `paymentTerms != null`, open schedule, not cancelled.
3. **`orders/paid` sufficiency for partial payments** — **RESOLVED:** insufficient alone (coalescing + fires only on fully-paid); `orders/updated` is the workhorse; subscribe to both; reconciliation backstops gaps.
4. **Scope set (CF-1)** — **RESOLVED:** `read_orders,read_all_orders,read_payment_terms,read_companies`; PCD Level 1 request in parallel; `write_companies` deferred to Phase 3.
5. **Bulk vs paginated backfill** — **RESOLVED:** bulk operation for orders (cost-exempt, 5 concurrent allowed on 2026-07), paginated for companies.
6. **Reconciliation enumeration** — **RESOLVED:** `orders(query: "updated_at:>=<cursor>", sortKey: UPDATED_AT)` with overlap-window cursor.
7. **Scheduler double-fire on Railway** — **RESOLVED:** idempotent sweeps + SweepLease row + SIGTERM stop; deploy overlap window confirmed real (`RAILWAY_DEPLOYMENT_OVERLAP_SECONDS`).
8. **RESOLVED by in-plan fallback (02-01 T5 X-Shopify-Webhook-Id header fallback; 02-05 T1 TOML topic source-guard test):** does `webhookId` come back from `authenticate.webhook` in v1.1.0, and does the TOML accept `payment_schedules/due` as a subscription topic string verbatim? Both are five-minute checks at build time with zero design impact (A11 / topic string is from the official enum).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | v22.20.0 | — |
| npm | installs | ✓ | 10.9.3 | — |
| PostgreSQL (local) | tests (`creditguard_test`) | ✓ accepting connections | psql 17.10 (Homebrew) | — |
| vitest / prisma / graphql-codegen | test + schema + typed queries | ✓ in node_modules/.bin | vitest ^4.1.10, prisma ^6.16.3 | — |
| Shopify CLI | deploy, TOML sync, dev-store webhook triggers | ✗ not in node_modules or PATH | — | `npx -y @shopify/cli@latest` (Phase 1 used it — scripts assume `shopify` resolves; confirm invocation used previously) |
| Railway production Postgres | deployed sweeps | ✓ (Phase 1 deployed) | Postgres 16+ managed | — (note CF-4 region question still open from Phase 1) |
| Dev store with B2B + net-terms orders | empirical tests (A2, A7), UAT | ✓ `credit-guard-u0vpjikx.myshopify.com`, B2B confirmed 2026-08-18 | — | — |
| Partner Dashboard approvals | production `read_all_orders` + PCD Level 1 | ✗ not yet requested | — | **No fallback for launch** — dev stores exempt, so phase execution unblocked; file requests in Wave 1 (human task) |

**Missing dependencies with no fallback:** none for phase execution; `read_all_orders`/PCD approvals gate production launch only.
**Missing dependencies with fallback:** Shopify CLI via npx.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.10 (node env, serial files) |
| Config file | `vitest.config.ts` (dedicated; isolates from RR/Sentry build plugins; pins dummy `SHOPIFY_API_SECRET`, `creditguard_test` DB) |
| Quick run command | `npx vitest run tests/<file>.test.ts` |
| Full suite command | `npm test` (pretest runs `prisma migrate deploy` against creditguard_test) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LEDG-01 | Bulk JSONL (incl. `__parentId` children) parses into correct Company/LedgerOrder/LedgerSchedule rows | unit + integration (fixture JSONL file) | `npx vitest run tests/backfill.test.ts` | ❌ Wave 0 |
| LEDG-02 | Signed webhook → dedupe (duplicate `X-Shopify-Webhook-Id` = single processing) → refetch (mocked admin client) → recompute; bad HMAC → 401 | integration | `npx vitest run tests/webhooks.orders.test.ts` | ❌ Wave 0 |
| LEDG-03 | `computeCompanyState` over fixtures: partial payment, refund, edit-down, cancellation, D2C order, termless order, multi-order company | unit (pure core) | `npx vitest run tests/credit-engine.test.ts` | ❌ Wave 0 |
| LEDG-03 (chaos) | duplicate / replayed / out-of-order / coalesced webhook sequences converge to identical ledger state (CONTEXT: non-negotiable) | integration | `npx vitest run tests/webhooks.chaos.test.ts` | ❌ Wave 0 |
| LEDG-04 | reconciliation upserts changed orders from mocked `updated_at` page, corrects seeded drift, advances cursor with overlap | integration | `npx vitest run tests/reconciliation.test.ts` | ❌ Wave 0 |
| LEDG-05 | overdue sweep flips exactly the companies with `dueAt < now, completedAt null`; skips `Shop.active=false` (CF-3 structural test); SweepLease excludes second claimant | unit + integration (fake timers) | `npx vitest run tests/scheduler.test.ts` | ❌ Wave 0 |
| D-03 guard | ledger service source contains no `\.customer` read (Phase 1 source-guard style) | unit (source read) | part of credit-engine suite | ❌ Wave 0 |
| W-2 | `redactUrl`/`beforeSend` scrubs `id_token` etc. (owed from Phase 1; this phase touches webhook paths) | unit | `npx vitest run tests/sentry-scrub.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/<touched-area>.test.ts` (+ `npm run typecheck` when queries change — codegen validates GraphQL documents)
- **Per wave merge:** `npm test`
- **Phase gate:** full suite green + `npm run typecheck` + dev-store empirical checks (A2, A7) + backfill-vs-admin comparison (success criterion 1) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/credit-engine.test.ts` — LEDG-03 pure-core matrix
- [ ] `tests/webhooks.orders.test.ts` — LEDG-02 (reuses `tests/helpers/webhook-hmac.ts`)
- [ ] `tests/webhooks.chaos.test.ts` — redelivery/reordering/coalescing
- [ ] `tests/backfill.test.ts` + `tests/fixtures/bulk-orders.jsonl` — LEDG-01
- [ ] `tests/reconciliation.test.ts` — LEDG-04
- [ ] `tests/scheduler.test.ts` — LEDG-05 + CF-3 + lease
- [ ] `tests/helpers/admin-client-mock.ts` — injectable fake Admin GraphQL client returning fixture orders
- [ ] `tests/sentry-scrub.test.ts` — W-2 debt
- [ ] Framework install: none (vitest present); `npm install node-cron@^4.6.0` only

## Security Domain

### Applicable ASVS Categories (Level 1, per config)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (machine-to-machine) | `authenticate.webhook` HMAC (never hand-rolled); Shopify session-token auth via library — no custom code |
| V3 Session Management | no new surface | Prisma session storage (Phase 1) unchanged |
| V4 Access Control | yes | Every query/upsert scoped by `shop`; unique constraints composite with `shop`; scheduler iterates only `Shop.active=true` |
| V5 Input Validation | yes | Webhook payloads are untrusted post-HMAC: extract only IDs, coerce types, never persist raw bodies (Phase 1 P4 precedent); GraphQL responses validated by codegen types |
| V6 Cryptography | yes (minimal) | HMAC via library only; no custom crypto |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Spoofed webhook writes to ledger | Spoofing | `authenticate.webhook` 401 pre-handler (proven pattern, keep as first statement) |
| Replayed/duplicated webhook inflates work | Tampering/DoS | `WebhookReceipt` unique-id dedupe + idempotent recompute |
| Webhook flood | DoS | Fast ack; dedupe insert first; heavy work after response |
| PII exfiltration via error tracking | Info disclosure | `sendDefaultPii:false` + `beforeSend` scrubber; **add the W-2 regression test**; never log order payload bodies (they contain customer PII this app doesn't need) |
| Cross-shop data bleed | Elevation | Composite `@@unique([shop, ...])` keys; shop always from `authenticate.webhook`, never from payload body |
| Secret leakage in test tooling | Info disclosure | Committed dummy secret pattern (Phase 1); secrets never in argv |

## Project Constraints (from CLAUDE.md)

- **Shopify AI Toolkit** should be used for Shopify API/platform work if available in the agent host (`npx skills add Shopify/shopify-ai-toolkit --list`); do NOT add it to the repo.
- **Admin GraphQL 2026-07 ONLY** — REST Admin API is forbidden for new work; keep Function/webhook/Admin versions in lockstep.
- **No new packages** beyond the pre-approved stack without registry verification (done here for node-cron).
- **GSD workflow enforcement** — file changes only through GSD commands.
- **What NOT to use** list applies: no custom OAuth/session code, no serverless, no `@shopify/polaris` React package (no UI this phase anyway).
- **Budget**: single small server/DB — no queue infra, no Redis (consistent with node-cron in-process decision).
- **TOML contract** (CONTEXT): `api_version` stays 2026-07; `application_url`/`automatically_update_urls_on_dev` untouched; every deploy publishes config.

## Sources

### Primary (official docs, fetched live this session — cite-grade)
- shopify.dev/docs/api/admin-graphql/2026-07: `objects/PaymentSchedule`, `objects/PaymentTerms`, `objects/Order`, `objects/Company`, `unions/PurchasingEntity`, `enums/PaymentTermsType`, `enums/WebhookSubscriptionTopic`, `queries/orders` — field names, topic strings, scopes
- shopify.dev/docs/api/usage/`access-scopes`, `limits`, `bulk-operations/queries` — 60-day window, read_all_orders, rate limits, bulk mechanics
- shopify.dev/docs/apps/launch/protected-customer-data — PCD levels & process
- docs.railway.com — deployments/reference, deployment-teardown (overlap/draining vars)
- npm registry via `npm view` — node-cron 4.6.0, @shopify/shopify-app-react-router 2.0.0
- Codebase reads: `prisma/schema.prisma`, `app/shopify.server.ts`, `shopify.app.toml`, `vitest.config.ts`, `tests/helpers/webhook-hmac.ts`, `app/routes/webhooks.app.uninstalled.tsx`, `.graphqlrc.ts`, `package.json`

### Secondary (cross-checked community/official-adjacent)
- community.shopify.dev threads: orders/paid vs orders/updated coalescing (~15s), orders/updated gaps, read_all_orders request flow
- changelog.shopify.com: read_all_orders approval requirement; POS split-payment webhook-per-payment behavior
- nodecron.com/migrating-from-v3 + github.com/node-cron/node-cron — v4 API

### Tertiary (noted, low weight)
- shopify.dev/docs/agents/orders/order-webhooks — **agentic-commerce surface only**; its claim that `orders/paid`/`orders/edited` "don't exist" contradicts the authoritative WebhookSubscriptionTopic enum and was discarded for this app's context

## Metadata

**Confidence breakdown:**
- Exposure field + object shapes: MEDIUM-HIGH — every field quoted from live 2026-07 pages; one behavioral edge (refund on partially-paid, A2) needs an execution-time empirical check
- Webhook topics/scopes: MEDIUM-HIGH — exact strings + scopes from the enum page; coalescing behavior community-sourced but architecture is immune to it
- Backfill/bulk mechanics: MEDIUM — docs verified; JSONL parent/child format is documented but fixture-test it
- Scheduler/Railway: MEDIUM — overlap vars from Railway docs; lease pattern is standard; correctness never depends on it (idempotency does the real work)

**Research date:** 2026-08-19
**Valid until:** ~2026-09-18 (2026-07 API is stable for 12 months; re-check only if the CLI drags the project onto 2026-10)
