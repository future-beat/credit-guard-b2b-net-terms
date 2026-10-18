---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 6
current_phase_name: Dashboard, Onboarding & Launch
status: listed
last_updated: "2026-09-10T09:55:00.000Z"
last_activity: 2026-09-10
last_activity_desc: hotfix v1.0.1 executed on main (quick 260910-nhm) — session-free GDPR/uninstall webhooks (#31), EnforcementEvent redaction (#32), admin-seam token-health deactivation (#30); WINDOWS 11 -> 8 open; not pushed, not deployed, not tagged
progress:
  total_phases: 6
  completed_phases: 6
  total_plans: 35
  completed_plans: 35
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-14)

**Core value:** A merchant can trust that no B2B customer places a new order when they're over their credit limit or overdue — enforcement Shopify natively lacks.
**Current focus:** Post-launch. v1.0.0 approved and listed on the Shopify App Store 2026-09-04 — https://apps.shopify.com/credit-guard-b2b-net-terms (visibility currently limited). Backlog is the open WINDOWS items (#11, #18, #19, #23, #24, #25, #26, #27, #28); #23 (S4 retake at 1600×900, then swap) is first.

## Current Position

Phase: 6 of 6 (Dashboard, Onboarding & Launch) — COMPLETE; all six phases complete and verified
Plan: 35 of 35 complete
Status: v1.0.0 (build f1032f0, tag v1.0.0) submitted 2026-08-24, approved and listed 2026-09-04 — https://apps.shopify.com/credit-guard-b2b-net-terms
Last activity: 2026-09-04 — developer confirmed approval and the live listing; records updated (quick 260904-dty)

Progress: [██████████] 100% (6 of 6 phases complete)

## Performance Metrics

**Velocity:**

- Total plans completed: 35 across 6 phases
- Milestone v1.0.0: 2026-08-14 (roadmap) → 2026-08-24 (submitted) → 2026-09-04 (approved and listed) — 11 days to submission, 11 days in review
- Suite growth: 0 → 838 tests across 28 files

**By Phase:**

| Phase | Plans | Notes |
|-------|-------|-------|
| 01-foundation-compliance | 4 | walking skeleton, Railway + domain, GDPR webhooks |
| 02-ar-ledger-credit-engine | 8 | 5 executed + 3 gap-closure (purchasingEntity scope trap) |
| 03-credit-controls-metafield-publishing | 5 | credit_v1 contract live-proven on real companies |
| 04-checkout-enforcement | 5 | validation Function; enforcement live on the demo store |
| 05-payment-reminders | 5 | Shopify-sent dunning; exactly-once; two emails human-received |
| 06-dashboard-onboarding-launch | 8 | dashboard, billing, listing; approved and listed 2026-09-04 |

**Recent Trend:**

- Phase 6 closed with 8 plans in 5 waves, the widest parallel wave being 4 executors
- One submission blocker (order-attribution latency) found by user observation and closed same-day

*Updated 2026-09-04 — App Store listing recorded*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Workflow, 2026-08-20]: Phase 4 onward uses branch-and-PR flow — the checkout Function is the riskiest code in the project (a bug blocks paying customers), so its diff gets a reviewable PR before touching main. Phases 2–3 merged worktree branches to main directly; that ends here.
- [Data, 2026-08-20]: Powderbound's deletion on the dev store was accidental (user). No app defect — genuine COMPANIES_DELETE, handled correctly. Recreating a company in the Shopify admin restores an observe-only fixture automatically via companies/create.

- [Roadmap]: Compressed research's 7-phase structure to 6 — scheduler infra (reconciliation + overdue sweep, LEDG-04/05) folded into Phase 2 as ledger correctness; Dashboard + Launch merged into final ship phase
- [Roadmap]: Metafields (Phase 3) split from Function (Phase 4) to de-risk the highest-uncertainty external API — Function is untestable without published state
- [Architecture]: Functions have no network access — backend precomputes credit state into $app Company metafields; Function is a dumb comparator, never in the checkout hot path

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 4]: Function target string, purchasingCompany metafield query shape, and draft-order validation coverage unverified — shopify.dev was unreachable during research; re-verify against live 2026-07 docs at plan time
- [Phase 5]: PaymentSchedule GraphQL fields and pay-now deep-link format need confirmation
- [Phase 6]: Shopify App Pricing capabilities (trials, test charges) <3 months old — confirm before building subscription gating

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Quick Tasks Completed

| Date | Task | Commits | Outcome |
|------|------|---------|---------|
| 2026-08-19 | [20260819-privacy-route](quick/20260819-privacy-route/SUMMARY.md) — public `GET /privacy` | `09b3675`, `4396bb8` | PRIVACY.md served as self-contained HTML from an unauthenticated resource route (build-time `?raw` inline, no new deps). Suite 194 → 210. Unblocks the app listing's privacy policy URL + PCD questionnaire once deployed. |
| 2026-08-22 | [260822-2h1](quick/260822-2h1-fix-module-source-comment-stripper-strip/260822-2h1-SUMMARY.md) — tokenizer-aware `sourceWithoutComments` | `6adc61c` | Fixed phantom block-comment defect (a `/*` inside a `//` comment blanked the file); 9 helper unit tests; sanity anchors at every source-guard call site. No guard flipped — the triggering comment is only on 06-04's branch. Suite 588 → 597. |
| 2026-09-04 | [260904-dty](quick/260904-dty-record-app-store-approval-and-public-lis/260904-dty-SUMMARY.md) — record App Store approval + public listing | `docs(launch): record App Store approval and public listing (2026-09-04)` | STATE → listed, LNCH-03 approved, WINDOWS #23 re-noted (S4 needs a 1600×900 retake before the swap), CHANGELOG/README/CLAUDE.md carry the listing URL. No code changes. |
| 2026-09-04 | [260904-ept](quick/260904-ept-public-unauthenticated-support-page-for-/260904-ept-SUMMARY.md) — public `GET /support` | `b4c7dbe` | Unauthenticated support/FAQ resource route (zero imports, no hostname literal), landing footer link, `tests/support-route.test.ts`; suite 848 → 869 / 30 files. Deployed to app.creditguardhq.com and verified 200; fills the listing's empty Support URL field (06-LISTING §9.5 B1 → B2). |
| 2026-09-10 | [260910-jvi](quick/260910-jvi-support-faq-hold-copy-matches-enforcemen/260910-jvi-SUMMARY.md) — support FAQ hold copy | `bd42b1a` | First FAQ answer now says the hold applies to a company's new orders (not "an order on payment terms"), matching the Function's whole-checkout scope (WINDOWS #29); `marketing/` git-ignored. Deployed and verified live; 869 tests green. |
| 2026-09-10 | [260910-nhm](quick/260910-nhm-hotfix-v1-0-1-compliance-uninstalled-web/260910-nhm-SUMMARY.md) — hotfix v1.0.1 | `d80e362`, `6c25997`, `a82997e`, `d9b6bc9`, `0478234`, `release: v1.0.1` | `shop/redact` + `app/uninstalled` verify HMAC through a validation-only `shopifyApi` instance and load no session, so an unrefreshable offline token can no longer 500 a redact forever (#31); `redactShop` covers `EnforcementEvent` (#32); the admin seam deactivates a shop after three time-gated token-class strikes in separate sweep cycles (#30). WINDOWS 11 → 8 open. 885 tests / 31 files green; codegen+typecheck, lint, build green. **Not pushed, not deployed, not tagged** — post-deploy verification still owed. |

## Session Continuity

Last session: 2026-09-10T09:55:00.000Z
Stopped at: v1.0.1 built and committed on main (quick 260910-nhm), NOT pushed / NOT deployed / NOT tagged; next: deploy to Railway, then work the three post-deploy verifications in 260910-nhm-SUMMARY.md (#31 redact answers 200, #30 deactivation lines for the five dead reviewer stores, #32 zero enforcement events for a redacted shop)
Resume file: .planning/quick/260910-nhm-hotfix-v1-0-1-compliance-uninstalled-web/260910-nhm-SUMMARY.md
