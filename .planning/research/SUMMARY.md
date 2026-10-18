# Project Research Summary

**Project:** Credit Guard: B2B Net Terms (Shopify B2B credit-control app)
**Domain:** Shopify embedded app — B2B credit limits, checkout enforcement, AR tracking, reminder emails
**Researched:** 2026-08-14
**Confidence:** MEDIUM (cross-verified web research; shopify.dev direct fetch was blocked — exact GraphQL field names and Function target strings must be re-confirmed at phase-plan time)

## Executive Summary

This is a single-job Shopify app that makes native B2B net terms enforceable: per-company credit limits, hard checkout blocking when over limit or overdue, an AR dashboard, and zero-config reminder emails. The wedge is confirmed: native Shopify B2B (companies, net terms, overdue status — now on ALL paid plans as of April 2026) records credit terms but does nothing to enforce them, and competitors either warn-only (SparkLayer), run parallel ledgers (Net Terms Tracker, NET30), or are very young micro-apps. The recommended positioning is "native-first, no parallel ledger, hard block with per-company bypass" at a flat $25–30/mo.

The load-bearing technical fact: checkout blocking is possible on all plans via the Cart and Checkout Validation Function API (`cart.validations.generate.run`), but Functions are sandboxed WASM with **no network access**. The architecture is therefore fixed: the backend (one always-on Node server — official React Router 7 Shopify template, Prisma + Postgres, Railway hosting ~$10–15/mo) computes each company's credit state from webhooks and a scheduler, and publishes it to `$app`-namespace metafields on the Company resource; the Function is a dumb comparator reading those metafields at checkout. Your server is never in the checkout hot path.

The two make-or-break risks are (1) **balance correctness** — a false block of a paid customer is an instant uninstall, so balances must be recomputed from source on every webhook (never incremented), with dedupe and a reconciliation sweep; and (2) **enforcement honesty** — draft orders and Admin-API orders can bypass the Function, and the app must fail open for D2C/null-company checkouts. Both are handled by making the ledger the deeply-tested core, surfacing bypassed orders on the dashboard, and documenting enforcement scope plainly.

## Key Findings

### Recommended Stack

One repo, one deployable: the official `shopify-app-template-react-router` (Remix's successor — do NOT use the Remix template or the deprecated `@shopify/polaris` React package), plus one Function extension deployed with the app. JS/TS for the Function is fine (trivial comparison, nowhere near the 11M instruction budget); Rust only if profiling ever demands it. Full detail in STACK.md.

**Core technologies:**
- React Router 7 template + `@shopify/shopify-app-react-router` ^1.2 — auth, sessions, webhooks, billing helpers; zero custom OAuth
- Polaris **web components** via App Bridge CDN — the 2026 admin UI standard (Polaris React is deprecated)
- Cart and Checkout Validation Function API, target `cart.validations.generate.run`, API 2026-07 pinned everywhere — the only all-plans server-side blocking mechanism
- PostgreSQL 16 + Prisma 6 — sessions, order/schedule cache, credit settings, email log, webhook dedupe
- Resend + react-email + node-cron — reminder emails ($0 at this scale) and the daily/hourly sweep
- Railway hosting (~$10–15/mo) — always-on process required for webhooks + cron; avoid serverless

### Expected Features

**Must have (table stakes — every competitor has these):**
- Per-company credit limit CRUD on native Company entities
- Webhook-driven outstanding/overdue ledger reading native financial status (incl. `partially_paid`, refunds, edits) — correctness IS the product
- Checkout enforcement over-limit + overdue, clear buyer message, prepay path stays open
- Per-company bypass toggle (the exception valve that makes hard blocking sellable)
- Reminder emails at due−3d / due / overdue with pay-now deep link, stop-on-payment
- AR dashboard (outstanding, overdue companies, upcoming due, utilization)
- Zero-config onboarding: backfill companies + open orders on install (first-session value decides trial conversion)

**Should have (differentiators):**
- Hard block (competitors warn or route to manual review) + logged bypass
- Enforcement event log — "we blocked $X of over-limit orders" ROI feed; also the Reviews API prompt trigger
- Native-first architecture as marketing: no parallel ledger, no drift

**Defer (v1.x/v2+):**
- Statement emails, buyer credit widget, custom reminder cadence, CSV export (v1.x on merchant pull)
- Anti-features to refuse: buyer portal, PDF invoices, credit scores, SMS, payment processing, QuickBooks sync, tag-based wholesale, hold-for-review mode

### Architecture Approach

One web app + one Function + one scheduler loop, no microservices. Backend materializes credit state (`limit`, `exposure`, `has_overdue`, `bypass`) into `$app` Company metafields; the Function reads them via `buyerIdentity.purchasingCompany.company.metafield(...)` and blocks or allows. Webhooks are thin: HMAC-verify, dedupe, ack 200, then refetch the order via GraphQL and recompute-from-scratch per company (never incremental arithmetic). A cron sweep handles overdue flips (no webhook fires when time passes), reminders (idempotent via EmailLog unique key), and reconciliation polling as the webhook backstop.

**Major components:**
1. Credit engine (pure module, `recomputeCompany()`) — single code path called from webhooks, cron, admin actions
2. Webhook ingestion — HMAC, dedupe on webhook id, refetch-and-upsert pattern
3. Metafield publisher — the only server↔Function contract; version namespace/keys carefully
4. Validation Function (`extensions/credit-validation/`) — dumb comparator, fail-open on every anomaly
5. Scheduler — overdue sweep, reminders, reconciliation, install backfill
6. Embedded admin UI — dashboard + per-company settings reading local DB (not live GraphQL)

### Critical Pitfalls

1. **Functions can't call your backend** — design the metafield-sync pattern from day one; make webhook→recompute→metafield-write one fast path.
2. **Balance drift** — never `balance += x`; recompute from source, dedupe webhooks, run reconciliation. Drift = false blocks = uninstalls.
3. **Enforcement bypass paths** — draft orders (`bypassCartValidations`), Admin API, POS orders skip the Function. Count every order against the balance regardless of origin; surface gaps on dashboard; document limits honestly.
4. **Breaking D2C checkout** — Function runs on EVERY checkout. Null `purchasingCompany` → immediate no-op; fail open on missing/malformed metafields. Seven-case test matrix is a hard gate.
5. **GDPR webhooks + review misses** — real redact handlers with 401-on-bad-HMAC, screencast, populated B2B demo store with reviewer credentials; each rejection cycle costs 7–14 days.
6. **Wrong identity model** — key credit to Company (not customer, not contact); store location on orders for future granularity.
7. **Legacy Billing API** — use Shopify App Pricing (Partner Dashboard, default since May 2026); write zero billing code for a flat plan.

## Implications for Roadmap

### Phase 1: App Skeleton & Compliance Foundation
**Rationale:** Template gives auth/sessions/GDPR wiring nearly free; the metafield-sync architecture decision and plan-feature matrix must be pinned before any enforcement code.
**Delivers:** Deployed embedded app (Railway + Postgres), Polaris shell, session-token auth, GDPR + `app/uninstalled` handlers (real, 401-on-bad-HMAC), API version pins.
**Avoids:** Pitfalls 1 (architecture decision), 3 (GDPR), 5 (billing decision: App Pricing), 10 (plan matrix).

### Phase 2: Order/AR Data Layer & Credit Engine
**Rationale:** Everything else (enforcement, dashboard, reminders) is a view over one correct ledger. Deepest-tested phase.
**Delivers:** Webhook ingestion (HMAC/dedupe/refetch/upsert), install backfill, pure unit-tested credit engine (company-keyed, handles partial payments/refunds/edits), reconciliation poll.
**Addresses:** Real-time ledger, zero-config onboarding data.
**Avoids:** Pitfalls 4 (drift — chaos-test duplicates/reordering), 8 (company-level identity).

### Phase 3: Company Credit UI & Metafield Publishing
**Rationale:** Metafields must exist and be verifiable (admin metafield viewer) before the Function is built; also delivers the merchant-facing limit/bypass CRUD.
**Delivers:** Per-company limit + bypass settings, `recomputeCompany()` publishing `$app:credit` metafields on every event.

### Phase 4: Checkout Enforcement (Validation Function)
**Rationale:** Depends entirely on Phase 3 metafields. Highest external-API risk; needs a B2B dev store (start the demo store here — it doubles as the reviewer environment).
**Delivers:** Validation Function blocking over-limit/overdue net-terms checkout with merchant-editable message; enforcement event log; bypassed-order flagging.
**Avoids:** Pitfalls 2 (draft-order matrix), 7 (fail-open, 7-case checkout matrix as verification gate).

### Phase 5: Scheduler & Reminder Emails
**Rationale:** Overdue blocking only activates via the time sweep (no webhook at due date); reminders reuse the same schedule data.
**Delivers:** Overdue sweep + metafield refresh, due−3/due/overdue reminder sequence with EmailLog idempotency, app-owned authenticated sending subdomain (SPF/DKIM/DMARC), bounce handling.
**Avoids:** Pitfall 6 (deliverability/spoofing), anti-pattern 4 (duplicate dunning).

### Phase 6: AR Dashboard & Onboarding Polish
**Rationale:** Reads data assembled in Phases 2/5; first-session value (backfilled balances visible immediately) drives trial conversion.
**Delivers:** Dashboard (outstanding, overdue, upcoming due, utilization, blocked-orders feed, bypass visibility), guided onboarding, observe-only default until limits set.

### Phase 7: Billing, Listing & App Review
**Rationale:** Commercialization gate last; demo store and screencast assets already built during Phase 4.
**Delivers:** App Pricing plan ($25–30/mo, 14-day trial), subscription gating, Reviews API prompt on first block/reminder, listing copy, screencast, reviewer credentials, pre-submission automated checks.
**Avoids:** Pitfalls 5, 9.

### Phase Ordering Rationale

- Ledger-before-everything: enforcement, dashboard, and reminders are all projections of one balance/due-date model (FEATURES dependency graph).
- Metafields before Function: the Function is untestable without published state; splitting them de-risks the highest-uncertainty external API.
- Scheduler before dashboard: overdue state and send logs are dashboard inputs.
- Compliance early (Phase 1) because it's nearly free in the template and review-blocking if deferred.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4 (Validation Function):** exact target string, `purchasingCompany` metafield input-query shape, draft-order validation coverage — shopify.dev was unreachable during research; verify against live 2026-07 docs before building.
- **Phase 5 (Reminders):** confirm PaymentSchedule GraphQL fields (`dueAt`, `balanceDue`, `completedAt`) and pay-now deep-link URL format.
- **Phase 7 (Billing):** Shopify App Pricing is <3 months old; confirm capabilities (trials, test charges) at build time.

Phases with standard patterns (skip research-phase):
- **Phase 1:** official template, extensively documented.
- **Phase 2, 3, 6:** standard webhook/Prisma/Polaris patterns; risks are testing rigor, not unknowns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Official template/npm verified; Function target name and schema fields need doc re-confirmation |
| Features | MEDIUM | Competitor claims from vendor pages cross-checked; native-B2B facts corroborated by official Help/Changelog |
| Architecture | MEDIUM | Metafield-sync pattern is documented Shopify practice; draft-order validation coverage is LOW-MEDIUM |
| Pitfalls | MEDIUM | Cross-verified web research; the seven-case checkout matrix and drift risks are well-grounded |

**Overall confidence:** MEDIUM

### Gaps to Address

- **Exact Function API details** (target string, `$app` metafield query syntax on `purchasingCompany.company`): re-verify from shopify.dev when scaffolding Phase 4 — direct doc fetch was DNS-blocked during research.
- **Draft-order/admin-order validation coverage:** confidence LOW-MEDIUM; verify empirically on a dev store in Phase 4 before finalizing listing copy about enforcement scope.
- **Shopify App Pricing capabilities:** rebranded May 2026; confirm flat-plan + trial config covers the need with zero code before Phase 7.
- **B2B plan-availability matrix:** April 2026 all-plans rollout is HIGH confidence, but Plus-only remainders (deposits, order review) should be re-pinned from help.shopify.com during Phase 1.

## Sources

### Primary (highest confidence in this research)
- Shopify official GitHub repos (`shopify-app-template-react-router`, `example-checkout--validation--preact`) — template and Function target naming
- npm (`@shopify/shopify-app-react-router` v1.2.1) — library currency
- help.shopify.com / changelog.shopify.com pages (via search) — B2B plan availability, Flow reminder action, draft-order Functions support, App Pricing

### Secondary (MEDIUM confidence)
- shopify.dev doc pages surfaced via search (Validation Function API, webhooks best practices, metafields, privacy compliance) — direct fetch blocked; content cross-verified
- Competitor listings/docs: Net Terms Tracker, NET30, netterms.app, SparkLayer, Wholesale Gorilla, BSS, BizCred, Folio, AReceivables

### Tertiary (LOW confidence, needs validation)
- Community threads on draft-order validation behavior and Flow reminder limitations
- Hosting/email pricing comparisons (hostim.dev, courier.com etc.)

---
*Research completed: 2026-08-14*
*Ready for roadmap: yes*

## Post-Research Findings (live dev-store verification)

- **2026-08-18 — B2B confirmed on Basic-plan dev store.** Companies section present in admin on Basic emulation; ICP decision (all-plans native B2B) verified empirically.
- **2026-08-18 — Order attribution requirement (Phase 2 MUST):** Shopify admin warns Basic-plan merchants that "some apps may not attribute B2B orders correctly on your current plan." Root cause per shopify.dev: legacy apps read `Order.customer` (returns the company CONTACT on B2B orders) instead of `Order.purchasingEntity` (resolves to `PurchasingCompany` for B2B, `Customer` for D2C). Credit Guard's ledger MUST read `purchasingEntity` on every order webhook/refetch — never `customer` — or exposure lands on the wrong entity. Already consistent with company-keyed identity (pitfall 6, T-01-02); named here so the Phase 2 planner makes the field explicit in task actions. Source: shopify.dev/docs/apps/build/orders-fulfillment/order-management-apps/attribute-b2b-orders

## Domain / DNS Constraints (verified 2026-08-18)

`creditguardhq.com` was purchased **through Shopify** inside the Credit Guard development store. Consequences for plan 01-02 (custom domain, D-04):

- **Shopify is the registrar.** DNS is administered at store admin → Settings → Domains → DNS settings. There is no "remove domain" option for Shopify-purchased domains (only transfer-out or role change).
- **Transfer-out is blocked ~60 days** from purchase (ICANN lock on new registrations — absolute, no registrar override). Earliest transfer ≈ mid-Oct 2026. Recommended then: move to an independent registrar so a production domain is not administered inside a dev store.
- **Wave 2 approach (no transfer needed):** add a custom `CNAME` record, name `app`, target = Railway's supplied hostname. Shopify-managed domains support custom records pointing subdomains at external servers. Root domain stays pointed at Shopify (A 23.227.38.72) — harmless, unrelated to the app.
- **NEVER use "Reset DNS settings"** — Shopify docs: resetting deletes CNAME records for all subdomains, which would break `app.creditguardhq.com` and take the deployed app offline.
- **Do not delete the Credit Guard dev store** while the domain is administered inside it.

## Dev Store Change (2026-08-19)

Canonical dev/demo store is now **`credit-guard-demo.myshopify.com`** ("Credit Guard Demo"), replacing
`credit-guard-u0vpjikx.myshopify.com`. All Phase 2+ dev-store testing (research A2 sequence, backfill
verification, B2B companies/orders) targets the NEW store. `creditguardhq.com` is being transferred
store-to-store (Shopify-managed domain); custom DNS records (CNAME app → viiq1oza.up.railway.app,
TXT _railway-verify.app) are NOT copied by Shopify and must be re-added in the new store post-transfer.
Old store must not be deleted until transfer + DNS re-add are verified. Scripts taking a store-domain
argument (send-signed-webhook.sh, prod-lifecycle-state.sh) should be invoked with the new domain going
forward; historical Phase 1 records referencing the old domain stay as-is.

## Protected Customer Data: review timing (learned 2026-08-19)

Shopify does **not** review a protected-customer-data (PCD) access request until the
App Store **listing is submitted**. The request is configured and saved as a draft;
approval arrives as part of app review.

Consequences for planning:
- PCD approval is **not** a prerequisite for development. Dev stores are exempt from
  PCD restrictions, so Phases 3–6 build and test normally.
- What DOES gate `shopify app deploy` version creation is having the request
  *configured* plus the `read_all_orders` scope *granted* — both done 2026-08-19,
  verified by probe (`credit-guard-net-terms-4` created, validation clean).
- **Level 1 vs Level 2:** requesting protected customer *data* = Level 1 requirements.
  Additionally requesting protected customer *fields* (name, email, phone, address)
  escalates to Level 2 — heavier obligations, per-field justification. Credit Guard
  requests NO fields and must stay Level 1. Revisit only if Phase 5's reminder emails
  require buyer contact addresses, and re-check the privacy policy at the same time.
