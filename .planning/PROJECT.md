# Credit Guard: B2B Net Terms

## What This Is

A Shopify app that gives B2B merchants credit control over their net-terms customers: per-company credit limits, hard checkout blocking when a company is over its limit or has overdue balances (with a per-company bypass toggle), automated payment reminder emails, and a simple accounts-receivable dashboard. Built for stores using Shopify's native B2B features (companies, payment terms), where Shopify records terms but does nothing to enforce them.

## Core Value

A merchant can trust that no B2B customer places a new order when they're over their credit limit or overdue — enforcement Shopify natively lacks.

## Business Context

- **Customer**: Shopify merchants selling wholesale/B2B with native B2B features and net payment terms (Net 30/60/90)
- **Revenue model**: US$25–30/mo flat subscription via Shopify Billing API, 14-day free trial, no free plan
- **Success metric**: A$900–1,000/mo (~20–25 paying merchants) is the minimum expected revenue — the floor, not the ceiling; growth continues beyond it. Decision gate: ~10 paying merchants by 4–5 months post-launch — below it, reassess strategy (Credit Guard is the sole focus as of 17 Aug 2026; the previously planned parallel productized-service track was discarded)
- **Strategy notes**: Niche chosen from gap research (Aug 2026): Shopify added native payment terms but cannot enforce credit limits, block overdue orders, or send reminders; full B2B suites (SparkLayer $49–499/mo) are priced for bigger merchants; direct competitors (Net Terms Tracker, NET30, netterms.app) are young with few reviews. First 10 customers via cold outbound + Shopify Community B2B/wholesale threads, not app-store search.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Merchant can set a credit limit per B2B company
- [ ] Net-terms checkout is blocked (with a clear message; prepay-by-card path stays open) when a company is over its credit limit
- [ ] Net-terms checkout is blocked when a company has an overdue unpaid balance
- [ ] Merchant can flip a per-company bypass toggle to allow exceptions
- [ ] Automated payment reminder emails at due-3 days, due date, and overdue
- [ ] Merchant sees a simple AR dashboard: outstanding balances, overdue companies, upcoming due dates
- [ ] App passes Shopify app review (GDPR webhooks, Polaris web components/App Bridge, embedded admin)
- [ ] Billing via Shopify App Pricing (managed pricing — Billing API is legacy since May 2026): US$25–30/mo flat, 14-day trial
- [ ] In-admin review prompt via official Reviews API triggered after first success moment (e.g., first blocked order or first reminder sent)

### Out of Scope

- Quoting / price lists / wholesale catalogs — full B2B suites own this; MVP is credit control only
- Wholesale customer portals — same reason; stay single-feature
- SMS reminders — cost structure forces usage-based pricing, which conflicts with flat-fee positioning
- Tag-based wholesale workflows (non-native B2B) — doubles integration surface; revisit after native-B2B MVP validates
- "Hold order for review" enforcement mode — hard block + bypass chosen for MVP simplicity; revisit if merchants ask
- Incentivized review collection — Shopify's July 2026 trust crackdown makes this account-termination territory

## Context

- Solo developer using Claude Code + GSD (open-gsd/gsd-core); target MVP build time 2–4 weeks.
- Income goal: A$900–1,000/mo. Claude Max x20 subscription (A$340/mo) is the main tooling cost.
- Shopify partner economics (verified Aug 2026): 0% revenue share on first US$1M lifetime, US$19 one-time registration, app review typically 7–14 days.
- Native Shopify B2B (companies, payment terms) is the integration surface: the app enforces what Shopify already records. Research (Aug 2026) verified: native B2B is on ALL paid plans since April 2026 (not Plus-only — market is wider than assumed); checkout blocking works on all plans via the Cart and Checkout Validation Function API (`cart.validations.generate.run`); Functions have no network access, so the backend precomputes credit state into `$app` Company metafields and the Function is a dumb comparator. Enforcement honesty: draft/Admin-API/POS orders can bypass the Function — count all orders against balances, surface bypassed orders, document scope plainly. See `.planning/research/SUMMARY.md`.
- Launch mechanics from research: personally onboard every install in months 1–3; time-to-first-value in the first session decides trial conversion (~80% of trials never convert); expect new app-store reviews to be delayed by Shopify's verify-first publishing.
- Competitors are young, not entrenched — speed to a polished, reviewed listing matters.

## Constraints

- **Timeline**: 2–4 week MVP — competitors spotted the same gap ~12 months ago; racing peers, not incumbents
- **Budget**: Solo dev; no paid ads at launch; keep infra cheap (single small server/DB) to preserve flat-fee margins
- **Compliance**: Must satisfy Shopify app review — mandatory GDPR webhooks, latest App Bridge, Polaris admin UI, working demo store
- **Pricing**: Flat US$25–30/mo, no usage tiers — flat pricing is part of the positioning against suite pricing
- **Review collection**: Official Reviews API in-admin prompts only — no incentivized reviews (policy 1.3, July 2026)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Target native-B2B stores first (not tag-based wholesale) | Cleanest integration — enforce what Shopify already records; higher-intent audience | — Pending |
| Hard block at checkout + per-company bypass toggle | Predictable enforcement is the exact missing feature; bypass covers exceptions without a second enforcement path | — Pending |
| "Block" = hold the enforced company's checkout outright | Phase 4 research: a terms-bearing B2B checkout collects no payment, so there is no card path to keep open; buyers settle invoices post-order via Pay now, which clears the hold. Original framing ("keep prepay open") was wrong — see WINDOWS #29 | ✓ Good (corrected 2026-09-05) |
| Shopify App Pricing, not Billing API | Billing API legacy since May 2026; flat plan + trial configured in Partner Dashboard with zero billing code | — Pending |
| Working name "Credit Guard: B2B Net Terms" | Leads with the job; covers "credit" and "net terms" search terms; final listing name at launch | — Pending |
| Flat US$25–30/mo, 14-day trial, no free plan | ~20–25 merchants hits income goal; freemium creates support load without revenue at this scale | — Pending |
| Single-feature MVP (credit control only) | 2–4 week build; suites own the broad feature set; win on focus + price | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-14 after initialization*
