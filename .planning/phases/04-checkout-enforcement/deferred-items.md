# Phase 4 — Deferred Items

Out-of-scope discoveries made during Phase 4 execution. Logged, not fixed: the
scope boundary says a plan auto-fixes only what its own changes caused.

## 1. Reconciliation exhaustion flip starves on the newest unattributable order

**Found:** 04-05, live on credit-guard-demo, 2026-08-20.
**File:** `app/services/reconciliation.server.ts` (`reconcileShop` pass 1 + `healAttribution` flip).
**Ledger:** WINDOWS.md #10 (open).

The daily sweep advances its cursor to `newestUpdatedAt - CURSOR_OVERLAP_MS`
(5 minutes). An order that is BOTH the shop's most recently updated order AND
unattributable is therefore re-paged by pass 1 on every subsequent sweep, which
refreshes its `refetchedAt`. The exhaustion flip is gated on
`refetchedAt < sweepStart` — deliberately, so an in-flight webhook is never
raced — so that order can never flip `UNRESOLVED -> NO_COMPANY` until some
newer order arrives and pushes the cursor past it.

Observed: order **#1012** (the matrix's D2C order — companyless, but carrying
Net 30 terms) stayed `UNRESOLVED` across two consecutive `reconcileShop` runs,
both reporting `flippedNoCompany: 0`, pinning the shop's `data_complete` at
`false`.

**Why this is not a Phase 4 blocker:** the validation Function deliberately does
NOT read `data_complete` (D-04 — "enforcement on data_complete:false would be
strictly worse"), so a stalled flag cannot weaken, strengthen or skip a checkout
decision. Northwind remained blocked throughout with `data_complete: false`
published in its `credit_v1`. The cost is observability: the AR dashboard's
completeness flag reads pessimistically on a quiet store.

On a store with normal order flow this self-heals the moment a newer order
lands, which is why it has not surfaced before.

**Suggested remedy (not implemented):** gate the flip on "not refetched by THIS
sweep's pass 1" rather than on a wall-clock timestamp comparison — e.g. collect
the gids pass 1 actually upserted and exclude those, so a row re-paged purely by
the cursor overlap is still eligible. Belongs with the reconciliation owner
(Phase 2 lineage), ideally with a test that pins the newest-order case.

## 2. EC-1 decimal-format observation not captured

**Found:** 04-05 checkpoint, step 9 (explicitly optional).
**Ledger:** WINDOWS.md #11 (open).

The human did not open a Function run in the Partner Dashboard, so the exact
decimal-place format of `cart.cost.totalAmount.amount` in a real run input
(04-RESEARCH Open Question 2) is still unobserved. EC-1's substance is proven
behaviourally — a real Northwind checkout was blocked, which is impossible
unless the USD currency comparison matched — and `cartCents` normalizes the
format defensively either way. Capture it opportunistically next time a Function
run is open.
