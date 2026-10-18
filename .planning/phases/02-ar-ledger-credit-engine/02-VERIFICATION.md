---
phase: 02-ar-ledger-credit-engine
verified: 2026-08-19T22:10:00Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 1
overrides:
  - must_have: "A refund on a partially-paid net-terms order leaves ledger exposure equal to the admin-shown balance due — the A2 empirical sequence executed on the dev store (LEDG-03)"
    reason: "Partial payments are Plus-only; the Basic-emulating dev store cannot produce the sequence. ICP is Basic/Grow/Advanced where the path is unavailable; the engine reads Shopify's financial status rather than tracking payments, and the partially-paid contribution rule is behaviorally test-locked. Accepted in WINDOWS.md #4 with a pre-launch Plus-emulation-store task."
    accepted_by: "user (recorded in WINDOWS.md entry 4)"
    accepted_at: "2026-08-19T09:45:00Z"
gaps: []
warnings:
  - "WINDOWS.md is internally inconsistent: the markdown table shows #2 and #5 as open and omits #8, while the JSON block records #2 'resolved' (an invalid status that breaks gsd-tools), #5 fixed, and #8 open; frontmatter total_count 7 vs 8 JSON entries. Bookkeeping only — both 02-07 and 02-08 SUMMARYs flagged the tooling rejection honestly."
  - "WINDOWS #1 (empirical checks not run) is stale-open: D9 backfill-vs-admin is now closed user-verified, A7/A7b resolved (bulk machinery deleted), and A2 is tracked separately as #4. Should be closed-as-superseded."
  - "ROADMAP.md still shows plans 02-06..08 unchecked; all three are executed, SUMMARYd, and live-proven."
  - "02-06 deviation 4 residual: the exact B2B orders/create payload attribute name for the company hint was never captured from a live payload. Low stakes — a wrong name degrades to the hint-less rung and reconciliation heals within one sweep, and live attribution reached 8-0-0 regardless."
carry_forwards:
  - "Phase 3: metafield publishing must consume recomputeCompany's output (exposure/overdue/earliestDueAt on Company) — recomputeCompany is the ONLY writer of those columns; publish on its write path or a sweep, never a parallel computation."
  - "Phase 3/4: attributionStatus semantics — ATTRIBUTED (proven via company→orders edge), UNRESOLVED (couldn't determine yet; contributes ZERO exposure), NO_COMPANY (proven none; written only by reconciliation's exhaustion flip, never sticky). Enforcement/dashboards must not treat UNRESOLVED as no-company."
  - "Phase 5: reuse the scheduler contract — forEachActiveShop is the sole shop enumerator (CF-3, source-guard-tested), runExclusive SweepLease for cross-instance exclusion, injected `now` threaded through recomputes."
  - "WINDOWS #8 (open, defect): react-router-serve/morgan access log prints full request URLs incl. live id_token JWTs into Railway logs — Sentry scrubbing does not cover this channel. Quick task; same leak class as T-01-07."
  - "WINDOWS #3 (open, deviation): SessionNotFoundError on a post-uninstall webhook delivery returns 500 → Shopify retries ~48h. Needs a named-error acknowledge-and-drop path. Does not corrupt balances (receipts dedupe), but it is log noise and retry load."
  - "WINDOWS #4 (open, accepted): A2 partial-pay→refund live check requires a Plus-emulation dev store — pre-launch task before app review."
  - "read_all_orders Partner approval is granted for the dev store; PRODUCTION stores still gate on the filed access request (~7 business days) — launch dependency, not a Phase 2 gap."
re_verification: null
---

# Phase 2: AR Ledger & Credit Engine — Verification Report

**Phase Goal:** The app maintains a provably correct per-company outstanding-balance and due-date ledger from install onward
**Verified:** 2026-08-19 (initial verification; goal-backward, adversarial)
**Status:** passed (1 override, 4 warnings, 7 carry-forwards)
**Mode note (W-4 recurrence):** ROADMAP marks this phase `Mode: mvp` but the goal is prose, not a User Story. Noted per prior decision; not relitigated. Verification proceeded goal-backward against the five ROADMAP Success Criteria.

## Verification method

SUMMARY claims were treated as hypotheses, not evidence. Every structural claim was re-derived from source (grep/read), every behavior-dependent truth was re-proven by running the named test file in this verifier's own process (Postgres up, creditguard_test), and live-production claims were accepted only where the recorded artifact chain is specific and orchestrator/user-attested (commits `89af875`, `4ce9328`, 02-08 SUMMARY post-tap addendum).

## Goal Achievement — ROADMAP Success Criteria

| # | Success criterion | Verdict | Evidence class | Evidence |
|---|---|---|---|---|
| 1 | First-session backfill; balances match admin | **MET** | **LIVE** (user-verified) | Post-tap run: backfill completed ~1s, 8 orders/7 schedules/4 companies, attribution 8-0-0. Northwind 1874.95 == admin 1,874.95 exact; Acme reconciled to the cent (admin 4,179.90 is lifetime total; outstanding 2629.95+600.00=3229.95; divergence 949.95 = the PAID #1001 + REFUNDED #1003 — the two metrics SHOULD differ and do, by precisely the settled amounts). D9 CLOSED user-verified (`4ce9328`). Zero-order companies (Powderbound, Snowdevil) present at 0. |
| 2 | Placing / paying / refunding / editing updates balances correctly | **MET** (1 override) | **LIVE + fixture** | Live: order placement via 3× `POST /webhooks/orders` 200 converged with concurrent backfill; full-payment→zero-exposure (Acme #1001 PAID, $0 contribution) and refund exclusion (#1003 REFUNDED, excluded) proven on live data. Fixture: partially-paid order counts at REMAINING balance (`tests/credit-engine.test.ts` — re-run by verifier, PASS); due-date edits via payment_terms/* funnel into the same refetch path (b2b-events suite). **Partial-payment leg is NOT live-proven** — Plus-only feature, Basic dev store; carried as accepted override (WINDOWS #4), explicitly *unknown*, not passed. |
| 3 | Duplicate / replayed / out-of-order webhooks never corrupt balances | **MET** | **fixture (behavioral) + structural + live** | `tests/webhooks.chaos.test.ts` re-run by verifier: 7/7 PASS (duplicate, replay-stale, out-of-order, coalescing convergence, deep-equal vs single-clean-recompute baseline). Structural: `Company.exposure/overdue/earliestDueAt` written in exactly one place (`ledger.server.ts:763-771`, inside `recomputeCompany`); no incremental arithmetic anywhere; `WebhookReceipt` natural-key dedupe. Live: concurrent webhook deliveries during backfill converged (8-0-0). |
| 4 | Overdue flips via scheduled sweep without merchant action | **MET** | **fixture (behavioral) + live** | `tests/scheduler.test.ts` re-run: 20/20 PASS (strict-past D-04 adjacency, lease exclusion, active-only enumeration). Live: Acme `overdue: true` with earliest due 2026-08-17 — the past-due flip computed end-to-end on live data through the same `recomputeCompany` path the hourly sweep drives. Scheduler wired at `app/entry.server.tsx:25` (module scope, guarded). Hourly cadence itself is fixture-proven with injected clock. |
| 5 | Seeded drift detected and corrected by reconciliation within one cycle | **MET** | **fixture (behavioral)** | `tests/reconciliation.test.ts -t drift` re-run: 4/4 PASS (drift corrected only by full recompute, Sentry-warned, never silently absorbed; cursor advances to max(updatedAt)−5min). Not live-seeded on prod — the criterion says "deliberately introduced", which the integration tests do against the real DB. |

**Score:** 5/5 (SC2 carries the partial-payment override; all behavior-dependent truths have passing behavioral tests re-run by this verifier — none rest on symbol presence).

## Gap-closure arc (02-06..08) — claims vs source

The WINDOWS #5 defect (purchasingEntity requires read_customers → exposure permanently 0; errors[] swallowed) was the phase's near-miss. Every closure claim was re-derived:

| Claim | Check | Result |
|---|---|---|
| No `purchasingEntity`/`Order.customer` selection in any service GraphQL doc | grep over `app/services/*.ts` — hits only in comments and generated schema types; source-guard regex `\bpurchasingEntity\|\bcustomer\s*[({]` enforced in `tests/graphql-error-surfacing.test.ts:216-258` across all three services | ✓ VERIFIED |
| Source-guard hard-green, zero `it.fails` | Re-run: 9/9 PASS; grep `it.fails` in tests/ → 0 | ✓ VERIFIED |
| `graphqlJson` is the sole transport | Exactly one `.graphql(` call in app/ — `ledger.server.ts:191`, inside `graphqlJson`, which throws `LedgerGraphqlError` on any non-empty `errors[]` | ✓ VERIFIED |
| NO_COMPANY written only by reconciliation exhaustion flip; never sticky (W-2) | Single write site `reconciliation.server.ts:420` (updateMany gated `refetchedAt < sweepStart`); recovery test "recovers a NO_COMPANY row… (W-2 — never sticky)" re-run: PASS | ✓ VERIFIED |
| bulk_operations/finish still subscribed, route a safe no-op | TOML line 87-88 subscribed; route authenticates, dedupes, logs "ignored — backfill is company-driven", returns 200, contains no fetch | ✓ VERIFIED |
| Transitional shims removed | No `legacyAttributionOf` / `LegacyPurchasingEntityCarrier` in app/ | ✓ VERIFIED |
| Claimed commits exist | `3c7ed24`, `32107bc`, `baf9443`, `ee2a809`, `84f92e8` all real commits on main | ✓ VERIFIED |

## Required artifacts (all 3 levels + data flow)

| Artifact | Status | Detail |
|---|---|---|
| `prisma/schema.prisma` — Company, LedgerOrder(+attributionStatus), LedgerSchedule, WebhookReceipt, SyncCursor, SweepLease | ✓ VERIFIED | 4 migrations incl. `20260819113153_add_order_attribution`; applied to prod (release log in 02-08 evidence) |
| `app/services/ledger.server.ts` | ✓ VERIFIED, WIRED | `computeCompanyState` pure core; `recomputeCompany` sole exposure writer; `ingestOrderEvent` ladder consumed by webhooks.orders.tsx:153 |
| `app/services/backfill.server.ts` | ✓ VERIFIED, WIRED, DATA FLOWING | `startBackfill` fired from `app/routes/app.tsx:35` loader; company-driven; live prod run produced real balances |
| `app/services/scheduler.server.ts` + `reconciliation.server.ts` | ✓ VERIFIED, WIRED | `startScheduler()` at entry.server.tsx:25; forEachActiveShop sole enumerator; attribution pass + exhaustion flip present |
| 4 webhook routes + compliance | ✓ VERIFIED, WIRED | All 15 topics in TOML (7 orders + 4 payment-terms + 3 companies + 1 bulk) map to existing routes; api_version 2026-07 pinned |
| `scripts/prod-{ledger-state,clear-backfill}.{sh,mjs}` | ✓ VERIFIED | Exist; clear-backfill carries exactly one deleteMany scoped `[shop, "backfill"]` |

## Prohibitions

| Prohibition | Result |
|---|---|
| No `read_customers` anywhere (TOML, code, config) | ✓ HELD — TOML scopes exactly the CF-1 four; vitest SCOPES in lockstep; mentions in app/ are comments only; live sessionScopes verified as the four (02-08 gate 2) |
| Observe-only stance — no write scopes, no enforcement | ✓ HELD — zero write_* scopes; phase persists credit state locally only |
| No PII in ledger tables | ✓ HELD — Company stores business name only; LedgerOrder stores order number/money/status/dates; WebhookReceipt stores metadata, never bodies; LedgerSchedule money stored-never-summed |
| recomputeCompany sole writer of exposure/overdue/earliestDueAt | ✓ HELD — single `db.company.update` site |
| No topic-branching ledger logic; payload-as-doorbell | ✓ HELD — routes extract identifiers, funnel to refetch |

## Requirements coverage

| Requirement | Status | Evidence |
|---|---|---|
| LEDG-01 (install backfill) | ✓ SATISFIED | SC1 live-proven; backfill suite 33/33 re-run PASS (idempotent claim, empty-shop, determinism, no age window) |
| LEDG-02 (webhook-driven ledger, HMAC/dedupe/refetch-and-recompute) | ✓ SATISFIED | SC3; forged-HMAC 401 on all six deployed surfaces (smoke, 02-08 gate 3); dedupe + claim-release in code and tests |
| LEDG-03 (partial payments, refunds, edits) | ✓ SATISFIED (partial-pay leg fixture-only, override) | SC2 |
| LEDG-04 (reconciliation corrects drift) | ✓ SATISFIED | SC5; attribution heal + NO_COMPANY exhaustion re-proven |
| LEDG-05 (overdue sweep) | ✓ SATISFIED | SC4 |

No orphaned requirements: REQUIREMENTS.md maps exactly LEDG-01..05 to Phase 2; every plan's `requirements` field draws from that set.

## Anti-patterns

Zero TODO/FIXME/HACK/XXX/PLACEHOLDER markers in app/services, app/routes, scripts. Zero `it.skip`/`it.todo`/`it.fails` in tests. No stub returns found; the one deliberately inert route (bulk-operations no-op) is intentional, documented, and registration-mandated.

## Honest accounting — open items NOT claimed fixed (confirmed)

- **WINDOWS #3** (SessionNotFoundError 500 retry loop): still open; no acknowledge-and-drop path exists in `webhooks.orders.tsx` — correctly not claimed fixed anywhere.
- **WINDOWS #8** (access-log id_token leak): open, recorded post-tap; Sentry `redactUrl` (W-2) is real and tested but covers a different channel — no summary claims the access log is scrubbed.
- **WINDOWS #4** (A2 Plus-tier partial payments): open with recorded acceptance; 02-05 and 02-08 both mark it `unknown`, never passed. Honest.
- **WINDOWS #5**: closed with live evidence (8-0-0 attribution, nonzero exposures) — closure is justified, though the markdown table lags the JSON (see warnings).

## Verdict

The phase goal — a provably correct per-company outstanding-balance and due-date ledger from install onward — is achieved and, unusually, proven on live production data end-to-end: install backfill to the cent against admin, webhook ingest converging with a concurrent backfill, past-due flip, full-payment zeroing, refund exclusion. The one unexercisable path (Plus-only partial payments) is honestly quarantined as an accepted, tracked pre-launch task rather than silently absorbed. Chaos-immunity, drift correction, and attribution healing are behaviorally test-locked and were re-executed green by this verifier.

---

_Verified: 2026-08-19T22:10:00Z_
_Verifier: Claude (gsd-verifier)_
