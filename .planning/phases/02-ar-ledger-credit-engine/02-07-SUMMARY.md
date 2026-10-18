---
phase: 02-ar-ledger-credit-engine
plan: 07
subsystem: ledger
tags: [backfill, company-driven, attribution, bulk-operations-removal, ssrf-retired, state-freeze, d-06]

# Dependency graph
requires:
  - phase: 02-ar-ledger-credit-engine
    plan: 03
    provides: "SyncCursor claim machine (D10/D14 semantics), BackfillState shape, startBackfill/pollBackfillIfStale contracts"
  - phase: 02-ar-ledger-credit-engine
    plan: 06
    provides: "graphqlJson/LedgerGraphqlError (in ledger.server.ts), CompanyOrdersForLedger + forEachCompanyOrder pager, attributionStatus column, source-guard suite with the 02-07 it.fails marker"
provides:
  - "runCompanyBackfill: synchronous company-driven install backfill — enumerate → upsert heads → per-company ingest → recompute → cursor seed → completed state"
  - "enumerateCompanies(shop): paged CompaniesForLedger (now selecting ordersCount{count}) over graphqlJson — exported for 02-08's reconciliation invariant"
  - "ingestCompanyOrders(shop, companyGid): forEachCompanyOrder-driven full-edge ingest with kind \"company\" attribution — exported for 02-08"
  - "syncCompanies keeps its name/contract (upsert heads + recompute each) and now RETURNS the enumeration"
  - "webhooks.bulk-operations.tsx: authenticate → dedupe → log ignored → 200 no-op; topic stays registered, route never throws"
  - "BackfillState frozen and test-locked: exactly nine keys, status first, operationGid always null (scripts/prod-ledger-state.mjs contract)"
affects: [02-08-reconciliation-and-deployed-proof, phase-03-metafield-publishing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Definitional attribution in the backfill: an order is ATTRIBUTED because it appeared on its company's authenticated orders edge — the ingest and the evidence are the same read"
    - "Unconditional per-company pull (D-06): no age window, no financial-status filter — settled orders land at zero contribution so local counts reconcile against Company.ordersCount"
    - "Synchronous claimed run: the whole backfill executes inside the tracked promise; the stale-poll self-heal is simply an idempotent re-run"

key-files:
  created: []
  modified:
    - app/services/backfill.server.ts
    - app/routes/webhooks.bulk-operations.tsx
    - tests/backfill.test.ts
    - tests/graphql-error-surfacing.test.ts
    - .planning/WINDOWS.md
  deleted:
    - tests/fixtures/bulk-orders.jsonl
    - tests/fixtures/bulk-orders-shuffled.jsonl

key-decisions:
  - "Paginated per-company queries, NOT a nested bulk operation (pre-made decision 1): the paginated company(id){orders} shape was VERIFIED WORKING live under CF-1 scopes (02-05), while a three-level nested bulk document exceeds the documented two-level bulk limit and was never probed. Nested-bulk remains an unprobed future optimization — deliberately NOT probed in this plan; negligible quota at SMB scale makes it moot for now"
  - "Empty-shop reconciliation cursor anchors on the run's injected now (minus the 5-minute overlap) instead of the wall clock — identical in production where startBackfill's default now IS the wall clock, deterministic in tests"
  - "pollBackfillIfStale stamps polledAt BEFORE the re-run, so transient failures retry once per staleness window instead of hammering every load"
  - "runCompanyBackfill's companyCount = enumerated companies (not just order-bearing ones): the number the AR dashboard and prod-ledger-state should agree on"

patterns-established:
  - "Module-document source-guard: extract every #graphql template from the module source and assert each trapped-selection-free — robust to comments, catches reintroduction anywhere in the file"

requirements-completed: []
requirements-progressed: [LEDG-01]

# Metrics
duration: 30min
completed: 2026-08-19

actuals:
  tokens: 27300
  tasks: 3
  commits: 5

status: complete
---

# Phase 02 Plan 07: Company-Driven Backfill Rework Summary

**One-liner:** The install backfill now enumerates companies and ingests each company's orders over the authenticated `company(id){orders}` edge — attribution definitional, no filter, no age window (D-06) — with the entire bulk-operation machinery (and its SSRF-relevant JSONL fetch) deleted and the finish route reduced to a safe, tested no-op.

## What was built

### Task 1 — Tracer: startBackfill → enumerate → per-company ingest → exact exposures → completed state
- **`enumerateCompanies(shop)`** pages `CompaniesForLedger` — now selecting `ordersCount { count }` (codegen-validated against 2026-07) — over `graphqlJson` with the `MAX_COMPANY_PAGES` guard. Returns `{ companyGid, name, ordersCount }[]`; exported for 02-08.
- **`syncCompanies(shop, now)`** keeps its contract (upsert heads + recompute each — a company with no orders exists at 0.0000 with a real `recomputedAt`) but is built on the enumeration and returns it.
- **`ingestCompanyOrders(shop, companyGid)`** drives 02-06's `forEachCompanyOrder` pager, upserting every node via `upsertOrderFromSource` with `{ kind: "company" }` — companyGid from the walk, company name from the CompanyOrdersForLedger response, location null (the company edge names none). Returns `{ orders, schedules, maxSourceUpdatedAt }`; exported for 02-08. Recompute stays the caller's job (one recompute path, test-locked).
- **`runCompanyBackfill(shop, now)`**: syncCompanies → per-company ingest → `recomputeCompany(shop, gid, now)` per order-bearing company → `setReconciliationCursor(max updatedAt − 5min)` → completed state with true counts. `now` threads into every recompute (D-04 wall-clock-free overdue).
- **Claim machine survives untouched**: `claimBackfill`'s unique-constraint INSERT + failed-run conditional UPDATE, `failBackfill`, the inFlight/track/awaitBackfillIdle drain hook, `startBackfill`'s flow. `BackfillOutcome.reason` "submit-failed" → "run-failed" (there is no submission anymore); the unused `operationGid` field dropped.
- Tracer green: Acme 1650.7500 (settled #1003 ingested, contributing zero), Borealis 75.0000, Cygnus 0.0000; every row ATTRIBUTED; Acme `overdue: true` with `now` strictly past FIXTURE-anchored dueAt (must-have 2); cursor `2026-08-10T03:55:00.000Z`; completed state `operationGid: null`; repeat start → already-completed with **zero** admin calls; local `count(companyId=Acme) == 3 == ordersCount`.

### Task 2 — Edges: every 02-03 resilience property re-proven at the new shape
- **Empty shop** completes cleanly (counts 0, cursor at now−overlap — the one honest RED of this task, fixed by anchoring on injected `now`).
- **Replay determinism + partial-run convergence** via full ledger snapshots (attribution columns included).
- **Mid-run ACCESS_DENIED on company 2 of 3** → run failed with the error naming `CompanyOrdersForLedger`, `ACCESS_DENIED`, `read_customers access scope` (graphqlJson's loud-failure contract end-to-end); company 1's partial truth persists; the **next startBackfill re-claims and completes without duplicating rows** (D10 equivalent).
- **Stale-poll self-heal** re-runs `runCompanyBackfill` to completion (D14 equivalent, no webhook involved); fresh runs left alone; transient poll failure leaves `running` with `polledAt` stamped.
- **Concurrent starts** race on the unique constraint — exactly one claims, one enumeration total.
- **Both pagers throw past their caps** (companies > MAX_COMPANY_PAGES, per-company orders > MAX_ATTRIBUTION_PAGES) → failed run, never a spin.
- **State-shape freeze**: exactly the nine documented keys, `Object.keys()[0] === "status"`, `operationGid` null — the contract `scripts/prod-ledger-state.mjs § parseBackfill` and the re-claim substring depend on; failed states assert `value.startsWith('{"status":"failed"')`.

### Task 3 — Bulk machinery deleted, route neutered, debt flipped
- **Deleted from backfill.server.ts**: `BACKFILL_ORDERS_DOCUMENT`, `bulkOrdersQuery`, `START_BACKFILL_MUTATION` (Task 1), `BULK_OPERATION_STATUS_QUERY`, `submitBulkQuery` (Task 1), `advanceFromOperation`, `processBulkResults`, `streamJsonlLines`, `handleBulkOperationFinish`, `noLines`, `IN_PROGRESS_STATUSES`, `BulkOrderLine`/`BulkScheduleLine`/`BulkIngestResult`, `legacyAttributionOf` + `LegacyPurchasingEntityCarrier` (02-06's transitional shim), and the `node:readline`/`node:stream`/`getAdminContext` imports. **The module's only outbound `fetch` went with the downloader — T-02-13 retired by removal** (`fetch(` grep == 0).
- **§ Production dependency footer rewritten**: `read_all_orders` is granted and STILL required — without it the company orders edge silently windows to 60 days in production, same D-06 stake.
- **webhooks.bulk-operations.tsx**: authenticate.webhook-first → receipt dedupe → log "ignored — backfill is company-driven since 02-06/07" → 200. Topic stays in the live registration (TOML untouched, prohibition honored); forged HMAC still 401; route never throws (T-02-29). `extractOperationGid` deleted (no test uses it). New test locks the neuter: a signed delivery during a running run makes **zero** admin calls and touches nothing.
- **Source-guard flip (WINDOWS #6)**: the 02-07 `it.fails` debt marker replaced with a hard-green module scan — every `#graphql` template in backfill.server.ts extracted from source; exactly one document remains (CompaniesForLedger) and it is trapped-selection-free. Stronger than the original marker: catches reintroduction anywhere in the module.
- **JSONL fixtures deleted** with the positional-reassembly tests they served (A7's `__parentId` question was RESOLVED live in the 02-05 addendum).

## Verification

| Gate | Result |
|------|--------|
| Full suite | **13 files, 227 passed + 1 expected fail (228)** — baseline 225+2; the remaining expected-fail is 02-08's ORDERS_UPDATED_SINCE marker |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |
| `npm run graphql-codegen` | exit 0 (`ordersCount { count }` validates against pinned 2026-07) |
| `grep -v '^\s*//' backfill.server.ts \| grep -c 'created_at'` | 0 (D-06 gate) |
| `grep -v '^\s*//' backfill.server.ts \| grep -c 'fetch('` | 0 (SSRF surface gone) |
| Refs to deleted exports across app/tests/scripts | 0 (only reconciliation.server.ts's own local `legacyAttributionOf` remains — 02-08's tracked debt, WINDOWS #7) |
| 15-topic registration source-guard (b2b-events) | green — neutered route file still exists for its uri |
| `grep -c 'api_version = "2026-07"' shopify.app.toml` | 1; TOML absent from all five plan commits, clean in the worktree |
| BackfillState serialise | status first key, nine keys exactly, test-frozen |

## Mutation-test evidence (RED structurally unavailable for tracer-implemented behaviors)

| Mutant | Change | Killed by | Restored |
|--------|--------|-----------|----------|
| 1 | Drop the per-company recompute loop in runCompanyBackfill | **7 tests** (tracer exposures/overdue/paging, replay, partial-run convergence, re-claim-completes, stale self-heal) | cmp byte-identical |
| 2 | Serialise `status` last instead of first | **2 tests** (nine-key freeze, failed-state startsWith lock) | cmp byte-identical |
| 3 | Skip the failed-run re-claim UPDATE (claim always loses after unique violation) | **1 test** (re-claims a failed run and completes without dup rows) | cmp byte-identical |

Note on mutant 2: the failed-run re-claim's `contains: '"status":"failed"'` matches regardless of key position — the status-FIRST guarantee is held by the freeze tests (and matters for greppability/`startsWith` diagnostics), which is exactly what they killed.

## Deviations from Plan

**1. [Minor] `ingestCompanyOrders` takes no `now` parameter.** The plan's artifact spec named `ingestCompanyOrders(shop, companyGid, now?)`, but the function performs no time-dependent work — recompute (the only consumer of `now`) is explicitly the caller's job per the plan's own one-recompute-path design. An unused parameter would trip lint; 02-08 passes `now` to `recomputeCompany` directly, as `runCompanyBackfill` does.

**2. [Minor] `BackfillOutcome` reason literal renamed `submit-failed` → `run-failed` and the `operationGid?` field dropped.** The plan said KEEP BackfillOutcome with "minor wiring edits"; there is no submission anymore, so the literal was a lie and the field dead. No caller inspects either (app.tsx voids the promise); the frozen contract is BackfillState, which is byte-compatible.

**3. [Minor] `START_BACKFILL_MUTATION`/`submitBulkQuery` deleted in Task 1's feat commit rather than Task 3.** Rewiring `runStartBackfill` orphaned them immediately; carrying an unused module-private mutation through two commits served nothing. All remaining deletions landed in Task 3 as planned.

**4. [Tooling] `gsd-tools windows fixed 6` failed on a pre-existing ledger inconsistency** (entry 2's JSON carries status `"resolved"`, which the tool rejects as invalid — hand-edited by a prior plan). Entry 6 was marked `fixed` by hand in both the table and JSON block, counts updated (open 6→5, fixed 0→1), matching the ledger's established manual-edit pattern. The entry-2 inconsistency itself was left untouched (out of scope; flagged here for whoever next runs the windows tooling).

## Known Stubs / Tracked Debt

| Item | File | Resolution |
|------|------|------------|
| `it.fails`: ORDERS_UPDATED_SINCE_QUERY still selects purchasingEntity | tests/graphql-error-surfacing.test.ts | 02-08 removes it and flips the guard (WINDOWS #7) |
| `legacyAttributionOf` transitional shim (reconciliation's own copy) | app/services/reconciliation.server.ts | 02-08 moves reconciliation to company-side attribution + graphqlJson |

Backfill's copies of both debts were eliminated by this plan (WINDOWS #6 marked fixed). Neither remaining item blocks this plan's goal; both are 02-08's contract.

## Coverage

- id: D1
  description: "The install backfill enumerates companies and ingests each company's orders over company(id){orders}; every ingested order lands ATTRIBUTED with nonzero exposure straight out of the backfill (D-01/D-06, WINDOWS defect 5 remedy)"
  requirement: LEDG-01
  verification:
    - kind: integration
      ref: "tests/backfill.test.ts#startBackfill — company-driven ingest (8 tracer tests)"
      status: pass
    - kind: mutation
      ref: "mutant 1 (recompute loop dropped) killed by 7 tests"
      status: pass
  human_judgment: false
- id: D2
  description: "A company whose only open net-terms order is past dueAt reads overdue: true and exposure > 0 straight out of the backfill recompute (D-04 strict-past)"
  requirement: LEDG-01
  verification:
    - kind: integration
      ref: "tests/backfill.test.ts#flips overdue strictly past dueAt (D-04)"
      status: pass
  human_judgment: false
- id: D3
  description: "The backfill cannot double-run or strand: claim race, completed short-circuit, failed re-claim, stale-poll self-heal all re-proven at the company shape (02-03 D10/D14 equivalents)"
  requirement: LEDG-01
  verification:
    - kind: integration
      ref: "tests/backfill.test.ts#backfill edges + stale-poll self-heal (10 tests)"
      status: pass
    - kind: mutation
      ref: "mutant 3 (re-claim skipped) killed"
      status: pass
  human_judgment: false
- id: D4
  description: "No order-age window and no status filter anywhere in the backfill (D-06): settled orders land at zero contribution; local per-company counts reconcile against Company.ordersCount"
  requirement: LEDG-01
  verification:
    - kind: integration
      ref: "tests/backfill.test.ts#ingests every company's orders — settled included"
      status: pass
    - kind: gate
      ref: "comment-filtered created_at grep == 0"
      status: pass
  human_judgment: false
- id: D5
  description: "BackfillState JSON byte-compatible with scripts/prod-ledger-state.mjs: nine keys, status first, operationGid always null; bulk machinery zero-referenced and the SSRF fetch path deleted"
  requirement: LEDG-01
  verification:
    - kind: integration
      ref: "tests/backfill.test.ts#BackfillState — the frozen production contract (2 tests)"
      status: pass
    - kind: mutation
      ref: "mutant 2 (status last) killed by 2 tests"
      status: pass
    - kind: gate
      ref: "fetch( grep == 0; deleted-export sweep == 0; full suite 227+1"
      status: pass
  human_judgment: false

## Handoff notes for 02-08 (reconciliation + deployed proof)

- **Exported surface you consume**: `enumerateCompanies(shop)` (with `ordersCount` per company — your reconciliation invariant is `local count(companyId=X) == ordersCount`), `ingestCompanyOrders(shop, companyGid)` (full-edge idempotent ingest; recompute after it yourself with your injected `now`), plus the unchanged `readBackfillState`/`RECONCILIATION_CURSOR_KEY`.
- **Your debts to flip**: ORDERS_UPDATED_SINCE_QUERY's purchasingEntity selection + reconciliation's local `legacyAttributionOf` (WINDOWS #7); the NO_COMPANY exhaustion pass must be an `updateMany` gated on `attributionStatus: "UNRESOLVED"` (upsertOrderFromSource cannot write NO_COMPANY by design).
- **Nested-bulk note (decision 1, recorded as required)**: a single bulk operation over companies → orders → paymentSchedules would nest three connection levels against a documented two-level limit and was deliberately left unprobed — a future optimization to evaluate only if per-company pagination ever pressures quota (it will not at SMB scale; bulk is cost-exempt but per-company paging is negligible).
- **Deployed proof**: dev store has Acme Supply + Northwind Trading, 4 net-terms orders each (2 past-due), production rows currently `companyId: null`. After deploy + backfill re-run (clear the `backfill` SyncCursor key over railway ssh — the frozen state shape is what prod-ledger-state parses) they must read ATTRIBUTED with nonzero exposure. Also confirm the live orders/create payload's company attribute name (02-06 deviation 4).
- **bulk_operations/finish** deliveries may still arrive from the live registration; the route acks and writes nothing. Do not remove the topic without a registration deploy decision.

## Self-Check: PASSED

- app/services/backfill.server.ts — company-driven, zero bulk references, fetch grep 0 — VERIFIED
- app/routes/webhooks.bulk-operations.tsx — no-op route, no fetch, authenticate first — VERIFIED
- tests/fixtures/bulk-orders*.jsonl — ABSENT (deleted in 62ed79b)
- Commits fdf2a95, 9c79055, 1bf5c6f, e2d4756, 62ed79b — FOUND in git log
- Full suite 227 passed + 1 expected fail; typecheck/lint/build/codegen exit 0 — VERIFIED
- shopify.app.toml untouched by all plan commits; api_version "2026-07" ×1 — VERIFIED
