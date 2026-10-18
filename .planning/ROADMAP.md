# Roadmap: Credit Guard: B2B Net Terms

## Overview

Six phases take the app from an empty repo to a listed, billable Shopify app. The order is dictated by one architectural fact: the checkout validation Function has no network access, so everything flows backend-first — a compliant app skeleton (1), then the deeply-tested balance/overdue ledger everything else projects from (2), then per-company credit settings published to `$app` Company metafields (3), then the Function that reads them at checkout (4), then reminder emails riding the same schedule data (5), and finally the AR dashboard, guided onboarding, App Pricing billing, and app-review submission (6). Research suggested seven phases; at standard granularity the scheduler infrastructure (reconciliation + overdue sweep) folds into the ledger phase where it belongs as correctness work, and dashboard + launch merge into a single ship phase.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Compliance** - Deployed embedded app with OAuth, GDPR webhooks, and clean uninstall
- [x] **Phase 2: AR Ledger & Credit Engine** - Webhook-driven per-company balance/overdue ledger with backfill, dedupe, and reconciliation (completed 2026-08-19)
- [x] **Phase 3: Credit Controls & Metafield Publishing** - Per-company limit and bypass settings published to $app Company metafields
- [x] **Phase 4: Checkout Enforcement** - Validation Function blocks over-limit/overdue net-terms checkout; fails open everywhere else
- [x] **Phase 5: Payment Reminders** - Automated due−3/due/overdue reminders through Shopify's authenticated notification infrastructure (merchant's own sender) with Shopify's canonical pay-now link
- [x] **Phase 6: Dashboard, Onboarding & Launch** - AR dashboard, guided first session, App Pricing billing, passed app review

## Phase Details

### Phase 1: Foundation & Compliance

**Goal**: Merchant can install the app into a deployed, review-compliant embedded admin shell
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03
**Success Criteria** (what must be TRUE):

  1. A merchant can install the app on a dev store, complete OAuth, and land in an embedded Polaris admin that loads without errors (React Router 7 template, session-token auth)
  2. All three mandatory GDPR webhooks (customers/data_request, customers/redact, shop/redact) respond correctly, and any request with a bad HMAC gets a 401
  3. Uninstalling the app revokes tokens/data, stops scheduled jobs, and marks the shop inactive; a re-install works cleanly afterward
  4. The app runs deployed (always-on host + Postgres) with the Shopify API version pinned everywhere

**Plans**: 4/4 plans executed

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Walking skeleton: scaffold, register, Postgres migration, embedded Credit Guard shell

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Production deploy: Sentry, Railway + custom domain, registration pointed at prod

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — GDPR compliance webhooks + two-stage uninstall lifecycle (test-proven)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-04-PLAN.md — Deployed compliance sync + end-to-end phase verification

**UI hint**: yes

### Phase 2: AR Ledger & Credit Engine

**Goal**: The app maintains a provably correct per-company outstanding-balance and due-date ledger from install onward
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: LEDG-01, LEDG-02, LEDG-03, LEDG-04, LEDG-05
**Success Criteria** (what must be TRUE):

  1. Within the first session after install, all companies, open net-terms orders, and payment schedules are backfilled and per-company balances match what the merchant sees in Shopify admin
  2. Placing, partially paying, refunding, or editing a net-terms order updates the company's outstanding balance to the correct amount
  3. Duplicated, replayed, or out-of-order webhook deliveries never corrupt balances — every change is a refetch-and-recompute from source, never incremental arithmetic
  4. When a payment schedule passes its due date, the company is flagged overdue without any merchant action (scheduled sweep — no webhook fires for time passing)
  5. Deliberately introduced ledger drift is detected and corrected by the reconciliation sweep within one cycle

**Plans:** 8/8 plans complete (5 executed + 3 gap-closure for WINDOWS.md defect 5)

Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Tracer: ledger schema + credit-engine core + order webhook ingest spine
- [x] 02-02-PLAN.md — Payment-terms/companies routes + chaos convergence proof + W-2 Sentry-scrubber test *(Wave 2)*
- [x] 02-03-PLAN.md — Install backfill: bulk operation + JSONL reassembly + companies sync + idempotent trigger *(Wave 2)*
- [x] 02-04-PLAN.md — Lease-guarded scheduler: hourly overdue sweep + daily reconciliation (CF-3 structural) *(Wave 2)*
- [x] 02-05-PLAN.md — Scopes (CF-1) + 15 webhook subscriptions + deploy + dev-store empirical verification *(Wave 3)*
- [x] 02-06-PLAN.md — Gap closure: company-side attribution core (schema + resolution ladder + GraphQL error surfacing) — purchasingEntity requires read_customers, which CF-1 rightly excludes *(Wave 4)*
- [x] 02-07-PLAN.md — Gap closure: company-driven install backfill replacing the bulk sweep (JSONL cannot surface scope denials) *(Wave 5)*
- [x] 02-08-PLAN.md — Gap closure: scope-clean reconciliation + deploy + prod cursor clear; ends at readiness — one human app-open re-runs the backfill *(Wave 6)*

Note: this phase builds the scheduler loop (reconciliation + overdue sweep) that Phase 5 reuses for reminders. It is the deepest-tested phase — balance correctness IS the product; a false block of a paid customer is an instant uninstall.

### Phase 3: Credit Controls & Metafield Publishing

**Goal**: Merchant can configure per-company credit, and each company's credit state is published where checkout can read it
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: CRED-01, CRED-02, CRED-03, CRED-04
**Success Criteria** (what must be TRUE):

  1. Merchant can set, edit, and remove a credit limit on any B2B company from a settings page in the embedded admin
  2. Merchant can flip a per-company bypass toggle and see its state reflected immediately
  3. Any change to a company's balance, limit, overdue status, or bypass updates its $app credit metafields within seconds (verifiable via GraphQL/metafield inspection)
  4. A fresh install enforces nothing: every company is observe-only until the merchant sets its limit

**Plans:** 5/5 plans executed
**UI hint**: yes

Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Tracer: credit_v1 contract + schema + publisher + recomputeCompany hook (mocked-seam end-to-end)
- [x] 03-02-PLAN.md — Scope registry: write_companies + TOML credit_v1 definition + deploy + three-place lockstep

**Wave 2** *(blocked on Wave 1)*

- [x] 03-03-PLAN.md — Companies page: inline-edit limits (value-echo CAS), bypass toggle, badges, nav (D-01/D-02/D-03)
- [x] 03-04-PLAN.md — Publish backstop in the hourly sweep (hash-skip fan-out) + fourth-service document guard

**Wave 3** *(blocked on Wave 2 + browser-only write_companies re-consent, relayed by orchestrator)*

- [x] 03-05-PLAN.md — Prod release + live credit_v1 read-back on real Company records — the Phase 4 readiness gate

Note: the metafield contract (namespace/keys) defined here is the only server↔Function interface — it must be verifiable on real Company records before Phase 4 starts.

### Phase 4: Checkout Enforcement

**Goal**: Companies over their credit limit or overdue cannot place new net-terms orders, and no other checkout is ever affected
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: ENFC-01, ENFC-02, ENFC-03, ENFC-04, ENFC-05, ENFC-06
**Success Criteria** (what must be TRUE):

  1. A buyer from a company whose new order would exceed remaining credit (exposure + cart total > limit in integer cents; at-limit exactly is allowed — D4-01) cannot complete net-terms checkout and sees the merchant's block message; the merchant can still serve the company via prepay paths (blocking a terms-bearing company's checkout IS the net-terms block — the Function input exposes no payment selection, and terms checkouts collect no payment)
  2. A buyer from a company with an overdue balance is blocked from net-terms checkout the same way — currency-independent, still enforced even when a currency mismatch skips the over-limit rule (D4-02)
  3. D2C shoppers and any checkout with missing or malformed credit metafields proceed untouched — the nine-case fail-open matrix (incl. currency mismatch and throw-proofing) passes in unit tests, and the observe-only / bypass / D2C cases pass live on the B2B dev store
  4. Merchant can edit the message buyers see at a blocked checkout
  5. The enforcement event log records every company block/unblock state transition with its exposure/limit/overdue snapshot, and every leaked order (placed via draft/admin/POS while its company was blocked) is flagged with order/amount/channel while still counting against balances (ENFC-05 re-scoped 2026-08-20 per D4-03 — per-attempt block logging is a platform impossibility: validation runs are not webhooked and 2026-07 has no bypass API trace)

**Plans**: 5 plans

Plans:
**Wave 1**

- [x] 04-01-PLAN.md — Tracer: validation Function extension (2026-07 `cart.validations.generate.run`, pure run(), 9-case matrix from contract bytes, function-runner + wasm gate)
- [x] 04-02-PLAN.md — EnforcementEvent backend: blocked-state transitions in recompute, leaked-order (BYPASSED_ORDER) inference at attribution, bypass audit (D4-03)

**Wave 2** *(blocked on Wave 1)*

- [x] 04-03-PLAN.md — write_validations four-place lockstep + idempotent validationCreate ensure-step (blockOnFailure false) + registry/Railway release from the phase branch; ends at the browser re-consent relay

**Wave 3** *(blocked on Wave 2 + write_validations re-consent, relayed by orchestrator)*

- [x] 04-04-PLAN.md — Settings page: merchant-editable block messages (Validation config_v1) + honest rule status; enforcement feed deferred to Phase 6

**Wave 4** *(blocked on Wave 3)*

- [x] 04-05-PLAN.md — Live proof EC-1..5 on credit-guard-demo (real blocked/allowed checkouts, draft-order leak flagged) + PR to main (branch-and-PR flow — no direct merge)

**Contract-reader decisions — ANSWERED at plan time (04-CONTEXT.md D4-01/D4-02/D4-03 + 04-RESEARCH.md Q5):** currency mismatch → skip the over-limit rule only, keep overdue, never convert (D4-02); `data_complete: false` → enforce normally (understated exposure only under-blocks); comparison is integer cents from the fixed-2dp strings with a float-trap fixture; `computed_at` is informational-only (the deterministic wasm has no clock — age comparison is unrepresentable); bypass precedence is the FIRST check (D-03). All five implemented across plans 04-01..04-05.

**Research flag — RESOLVED 2026-08-20 (04-RESEARCH.md):** target `cart.validations.generate.run` verified against live 2026-07 docs + the official example repo; input-query shape byte-verified against the function schema (namespace omitted → app-reserved namespace); draft orders ARE covered by validations, with a merchant-UI "Ignore all checkout rules" bypass that leaves no API trace — hence D4-03's server-side leak inference. Live fixtures ready on credit-guard-demo (Northwind over-limit, Acme overdue+bypass, Snowdevil observe-only).

### Phase 5: Payment Reminders

**Goal**: Merchants' net-terms customers are automatically chased at the right moments, exactly once per moment, and never after paying
**Mode:** mvp
**Depends on**: Phase 2 (payment-schedule data and scheduler loop)
**Requirements**: REMD-01, REMD-02, REMD-03
**Success Criteria** (what must be TRUE):

  1. For each open payment schedule, reminder emails arrive at due−3 days, on the due date, and once overdue — and each touchpoint sends at most once (idempotent via email log)
  2. Reminders stop as soon as the schedule is paid
  3. Every reminder reaches the buyer through Shopify's authenticated notification infrastructure (merchant's own sender/branding) and carries Shopify's canonical pay-now link — reworded per D5-01; the app itself never handles a customer email address (the former SC-4 "app-owned sending domain" criterion was superseded by this rewording — D5-01, 2026-08-20: Shopify's sender IS the merchant's authenticated identity, and deliverability/branding/replies-to-merchant are satisfied by construction)

**Plans**: 5/5 plans executed

Plans:
**Wave 1**

- [x] 05-01-PLAN.md — Tracer: ReminderLog schema + reminder sweep skeleton (seam-mocked send, own lease) + write_orders four-home lockstep + PRIVACY.md rewrite + registry/Railway release; parks at the browser re-consent relay

**Wave 2** *(blocked on Wave 1 + write_orders re-consent, relayed by orchestrator)*

- [x] 05-02-PLAN.md — E1–E5 empirical proving on credit-guard-demo: executor drives paymentReminderSend below the UI, human verifies inbox content + pay-now click-through + native-reminder default; E2 pre-due refusal escalates as DECISION, never improvised

**Wave 3** *(blocked on Wave 2; two plans run parallel, zero file overlap)*

- [x] 05-03-PLAN.md — Full sweep engine: D5-03/D5-04 touchpoint math, D5-02 suppression watermark, claim-then-send, paid-race live refetch, bounded retries, send cap, ReminderLog in shop/redact
- [x] 05-04-PLAN.md — Settings toggle on the existing app.settings page (default OFF, watermark copy) + D5-05 native-duplicate warning

**Wave 4** *(blocked on Wave 3)*

- [x] 05-05-PLAN.md — Live proof LP-1..LP-5 on real schedules (enable-without-blast, one email exactly once, stop on payment) + PR to main (branch-and-PR flow — no direct merge)

**Research flag — RESOLVED 2026-08-20 (05-RESEARCH.md):** PaymentSchedule fields (`dueAt`, `completedAt`, `balanceDue`) byte-verified against the local 2026-07 schema; there is no app-constructed pay-now deep link — `Order.statusPageUrl` is PCD-Level-2 gated, and the canonical link ships inside Shopify's own Payment reminder template sent by `paymentReminderSend` (D5-01).

### Phase 6: Dashboard, Onboarding & Launch

**Goal**: Merchant sees their full AR position at a glance, new installs reach first value in the first session, and the app is live, billable, and listed
**Mode:** mvp
**Depends on**: Phases 2–5 (dashboard reads ledger, enforcement log, and email log; review submission needs everything working)
**Requirements**: DASH-01, DASH-02, DASH-03, LNCH-01, LNCH-02, LNCH-03
**Success Criteria** (what must be TRUE):

  1. Merchant sees an AR dashboard with total outstanding, overdue companies, upcoming due dates, per-company credit utilization, the credit-hold feed (companies on hold, hold started/ended with exposure/limit snapshots, orders that slipped past a hold with amounts — reworded per D6-02: per-attempt blocks are unobservable, so no "blocked $X" estimate), and bypassed-order alerts
  2. A new install completes a guided setup — review backfilled balances → set first limit → enable enforcement — inside the first session
  3. Installing the app starts a 14-day free trial then charges US$25–30/mo flat via Shopify App Pricing, with zero billing code in the app
  4. After the first blocked order or first reminder sent, the merchant sees an in-admin review prompt via the official Reviews API
  5. The app passes Shopify app review and is publicly listed (Polaris web components, latest App Bridge, populated B2B demo store, screencast, reviewer credentials)

**Plans:** 8 plans
**UI hint**: yes

Plans:
- [x] 06-01-PLAN.md — AR dashboard read model + home route: KPIs, overdue, upcoming, closest-to-limit, credit-hold feed, reminder activity (DASH-01/02, D6-02) [wave 1]
- [x] 06-02-PLAN.md — Gap closure A: reminder engine #20 (outranked retry fence) + #21 (extensions.code narrowing), #12 TOCTOU comment, #22 honest eligibility copy + shared cadence constant [wave 1]
- [x] 06-03-PLAN.md — Gap closure B: #3 SessionNotFoundError acknowledge-and-drop, #8 access-log credential scrub (pre-boot, no deps), #10 reconciliation flip starvation [wave 1]
- [x] 06-04-PLAN.md — App Pricing gate (billing.check, _top redirect, fail-open, after side effects) + Home nav removal + E-1 probe script + CLAUDE.md corrections (LNCH-01) [wave 1]
- [x] 06-05-PLAN.md — Shop migration + guided setup (D6-03 status confirmation) + Reviews API moment with stamp-always bookkeeping (DASH-03, LNCH-02) [wave 2]
- [x] 06-06-PLAN.md — Listing package draft -> [human] Partner Dashboard pricing + E-4 + plan selection -> E-1 probe (mandatory) -> deploy -> smoke -> #10 live [wave 3]
- [x] 06-07-PLAN.md — [human] Live drive on credit-guard-demo: gate, dashboard, E-2, setup guide, #13 overdue-only block, E-5 Bogus Gateway pay-now, mobile; #8 Railway-log check + evidence bundle [wave 4]
- [x] 06-08-PLAN.md — [human] Assets + listing + automated checks -> go/no-go -> submit for review -> PR to main + CHANGELOG + post-submission record (LNCH-03) [wave 5]

**Research flag**: Shopify App Pricing (managed pricing) is <3 months old as of research — confirm flat-plan + trial + test-charge capabilities in the Partner Dashboard before building subscription gating.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Compliance | 4/4 | Complete | 2026-08-18 |
| 2. AR Ledger & Credit Engine | 8/8 | Complete   | 2026-08-19 |
| 3. Credit Controls & Metafield Publishing | 5/5 | Complete | 2026-08-20 |
| 4. Checkout Enforcement | 5/5 | Complete | 2026-08-20 |
| 5. Payment Reminders | 5/5 | Complete | 2026-08-21 |
| 6. Dashboard, Onboarding & Launch | 8/8 | Complete (ACHIEVED_WITH_GAPS — external review pending) | 2026-08-24 |

---
*Roadmap created: 2026-08-14 — 6 phases, 27/27 v1 requirements mapped*
