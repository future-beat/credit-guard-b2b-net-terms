---
phase: 02-ar-ledger-credit-engine
plan: 03
subsystem: backend
tags: [shopify-bulk-operations, jsonl, admin-graphql, webhooks, backfill, ssrf, vitest, b2b, net-terms]

# Dependency graph
requires:
  - phase: 02-ar-ledger-credit-engine
    plan: 01
    provides: "upsertOrderFromSource / recomputeCompany / upsertCompany / recordWebhookReceipt / markWebhookProcessed, getAdminContext seam, createMockAdmin array fixtures, SyncCursor model"
  - phase: 01-foundation-compliance
    provides: "authenticate.webhook 401 pattern, signed-webhook test helper, app layout loader, creditguard_test isolation"
provides:
  - "app/services/backfill.server.ts — startBackfill / processBulkResults / syncCompanies / pollBackfillIfStale / handleBulkOperationFinish / bulkOrdersQuery / readBackfillState / awaitBackfillIdle"
  - "app/routes/webhooks.bulk-operations.tsx — bulk_operations/finish handler + extractOperationGid"
  - "Install trigger wired into the app layout loader (fire-and-forget, idempotent)"
  - "SyncCursor `backfill` status-value schema (documented below for 02-05's prod-state script)"
  - "SyncCursor `reconciliation` cursor seeded with 5-minute overlap for 02-04's sweep"
  - "tests/fixtures/bulk-orders{,-shuffled}.jsonl — 7-order parent/child JSONL fixtures"
affects: [02-04 reconciliation sweep consumes the reconciliation cursor, 02-05 must subscribe bulk_operations/finish and add read_all_orders to scopes, phase-03 dashboard reads the backfilled companies]

actuals:
  tokens: 18200
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Codegen-validated named query stripped to a bare selection set for bulkOperationRunQuery — puts the bulk field list under the schema gate instead of leaving it an opaque string"
    - "Positional JSONL parent/child reassembly (file order), not __parentId value matching"
    - "Unique-constraint-as-lock for run claiming; conditional UPDATE for failed-run re-claim"
    - "Doorbell payload as security boundary: result URL only from BulkOperationStatus over the authenticated client"
    - "Drain hook (awaitBackfillIdle) making a fire-and-forget loader trigger observable"
    - "Injected clock (`now`) threaded through ingest so overdue assertions are wall-clock independent"

key-files:
  created:
    - app/services/backfill.server.ts
    - app/routes/webhooks.bulk-operations.tsx
    - tests/backfill.test.ts
    - tests/fixtures/bulk-orders.jsonl
    - tests/fixtures/bulk-orders-shuffled.jsonl
  modified:
    - app/routes/app.tsx

key-decisions:
  - "The bulk order selection is declared as a real named query (LedgerBackfillOrders) so codegen validates it, then header-stripped at call time — the plan's approach would have left the field list unvalidated"
  - "JSONL children are attached POSITIONALLY, not by matching __parentId, because the docs do not pin down whether Shopify names the Order or the PaymentTerms as parent; the fixture exercises both shapes"
  - "A finish delivery whose operation gid does not match the shop's recorded gid is ignored outright — the poll fallback is the recovery path, so strictness costs nothing"
  - "The finish route acks 200 even when handling throws: Shopify's redelivery would be deduped away by the receipt, so pollBackfillIfStale is the only real retry"
  - "A completed bulk operation with a null url is the empty-shop path, not an error"
  - "processBulkResults and syncCompanies take an optional `now`, mirroring recomputeCompany's injected clock"

requirements-completed: [LEDG-01]

coverage:
  - id: D9
    description: "Bulk JSONL with __parentId child lines reassembles into correct Company/LedgerOrder/LedgerSchedule rows and per-company exposures (Pitfall 5)"
    requirement: LEDG-01
    verification:
      - kind: integration
        ref: "tests/backfill.test.ts#reassembles __parentId children and persists every classification branch"
        status: pass
      - kind: integration
        ref: "tests/backfill.test.ts#attaches schedules whose __parentId names the payment terms, not the order"
        status: pass
    human_judgment: false
  - id: D10
    description: "First authenticated admin load starts a backfill exactly once; repeat loads never restart it"
    requirement: LEDG-01
    verification:
      - kind: integration
        ref: "tests/backfill.test.ts#starts exactly one bulk operation across repeated admin loads"
        status: pass
      - kind: integration
        ref: "tests/backfill.test.ts#does not restart a completed backfill"
        status: pass
    human_judgment: false
  - id: D11
    description: "Empty shop (zero companies, zero orders) completes cleanly recording zero balances"
    requirement: LEDG-01
    verification:
      - kind: integration
        ref: "tests/backfill.test.ts#completes cleanly on a shop with no companies and no orders"
        status: pass
      - kind: integration
        ref: "tests/backfill.test.ts#completes an empty shop through the poll path too"
        status: pass
    human_judgment: false
  - id: D12
    description: "Deterministic under replay and under parent-block shuffling with equal timestamps"
    requirement: LEDG-01
    verification:
      - kind: integration
        ref: "tests/backfill.test.ts#is a no-op on replay: the same JSONL twice yields identical state"
        status: pass
      - kind: integration
        ref: "tests/backfill.test.ts#is order-independent: a block-shuffled JSONL yields identical state"
        status: pass
      - kind: integration
        ref: "tests/backfill.test.ts#recovers from a partially ingested run without duplicating rows"
        status: pass
    human_judgment: false
  - id: D13
    description: "D-06 structurally enforced — no order-age clause in the bulk filter"
    requirement: LEDG-01
    verification:
      - kind: unit
        ref: "tests/backfill.test.ts#filters on financial status only — no order-age window"
        status: pass
      - kind: command
        ref: "grep -v '^\\s*//' app/services/backfill.server.ts | grep -c 'created_at' == 0"
        status: pass
    human_judgment: false
  - id: D14
    description: "bulk_operations/finish completes the flow; poll fallback un-strands a missed delivery"
    requirement: LEDG-01
    verification:
      - kind: integration
        ref: "tests/backfill.test.ts#ingests the operation's results and completes the run"
        status: pass
      - kind: integration
        ref: "tests/backfill.test.ts#completes a run whose finish delivery never arrived"
        status: pass
    human_judgment: false
  - id: D15
    description: "T-02-12/T-02-13 — forged HMAC 401, and the JSONL URL never comes from a payload"
    verification:
      - kind: integration
        ref: "tests/backfill.test.ts#answers 401 to a forged signature and writes nothing (T-02-12)"
        status: pass
      - kind: integration
        ref: "tests/backfill.test.ts#downloads only the URL the Admin API returned, never one from the payload"
        status: pass
      - kind: integration
        ref: "tests/backfill.test.ts#ignores a finish for an operation this shop never started"
        status: pass
    human_judgment: false
  - id: D16
    description: "Backfilled totals match what the merchant sees in Shopify admin on a real B2B store (success criterion 1)"
    verification: []
    human_judgment: true
    rationale: "Fixtures prove the parser and the arithmetic path, but not that `financial_status:pending OR partially_paid` actually selects every open net-terms order on a live store (assumption A7). Deferred to 02-05's dev-store comparison."

duration: 21min
completed: 2026-08-19
status: complete
---

# Phase 02 Plan 03: Install Backfill Summary

**One bulk operation plus one paginated companies query, reassembled from `__parentId` JSONL and pushed through the identical recompute path the webhooks use — proven by a 7-order fixture landing exposures exact to four decimals, and by three killed mutants that the determinism tests would otherwise have let through.**

## Performance

- **Duration:** 21 min
- **Tasks:** 3
- **Files:** 6 (5 created, 1 modified) — exactly the declared `files_modified`, no sibling-owned file touched
- **Tests:** 32 new; full suite 106 passed / 6 files (02-01's 74 intact)

## Task Commits

1. **Task 1 (tracer): backfill spine** — `ee2a809` (feat)
2. **Task 2: finish route** — `3cf20c0` (test, RED — 8 failures) → `217b575` (feat, GREEN)
3. **Task 3: probe edges** — `d6e9bc1` (test)

## Accomplishments

- **The tracer runs end to end on first execution:** fixture JSONL → readline stream → parent/child reassembly → `upsertOrderFromSource` → `recomputeCompany` → Acme `1650.7500`, Borealis `75.0000`, both exact. Cancelled, termless, D2C and fully-settled orders all persist and all contribute zero — the classification gates are the ledger's, not a second copy written here.
- **D-06 is structurally enforced, not just asserted.** The bulk filter is a financial-status clause and nothing else; the grep gate (`created_at` count 0 after comment filtering) and a unit test both hold.
- **The bulk query is under the codegen gate**, which the plan's shape would not have achieved (see Deviation 1). This is the gate that caught `companyLocation` in 02-01, and it now covers the backfill's field list too.
- **SSRF is closed by construction and by test:** the finish payload in the fixture carries `url: http://169.254.169.254/latest/meta-data/`, and the test asserts the app fetched exactly `[RESULT_URL]` — the address the Admin API returned. The route source is asserted to contain no `fetch(` at all.
- **The install cannot strand and cannot double-run:** claiming is a unique-constraint INSERT, so two concurrent loads race on the database; a missed finish webhook is healed by `pollBackfillIfStale` on the next admin open; a failed run is re-claimable by a single conditional UPDATE.

## The two things the plan asked me to record

### 1. JSONL parent/child shape — docs vs. what the parser must actually tolerate

02-RESEARCH.md § Backfill states that "schedule lines carry `__parentId` = order gid". **That is not safe to rely on.** `paymentSchedules` is a connection on `paymentTerms`, not on `orders`, and bulk results flatten connections by naming *the object that contains them*. Since the query selects `paymentTerms { id ... }`, Shopify may legitimately name either the Order or the PaymentTerms object as the child's parent, and the public docs do not settle which.

The parser therefore attributes children **positionally** — the one guarantee both the docs and research state unambiguously ("children follow their parent in file order") — and treats the `__parentId` value as advisory: a value matching neither the order gid nor the payment-terms gid is logged and the child is **still attached**. Dropping it would make a net-terms order look settled, which understates exposure, the exact direction D-06 forbids.

`tests/fixtures/bulk-orders.jsonl` exercises both shapes deliberately: order `#1002`'s schedule is parented to `gid://shopify/PaymentTerms/9002`, every other schedule to its order gid. Mutant A (strict `__parentId === order.id` matching) killed 8 tests, so this tolerance is load-bearing and locked.

Observed line shape (fixture, mirroring documented bulk output):

```
{"id":"gid://shopify/Order/1001", ..., "paymentTerms":{"id":"...","paymentTermsType":"NET"}}
{"id":"gid://shopify/PaymentSchedule/8001","dueAt":"...","completedAt":null,"__parentId":"gid://shopify/Order/1001"}
```

`paymentTerms` stays **inline** on the order line (it is a plain object); only its `paymentSchedules` edges are flattened out. `balanceDue` is deliberately not selected — schedule money is presentment-currency and is never summed (D-01/D-07, Pitfall 4).

**This remains the one shape claim no local fixture can settle.** 02-05's dev-store run should dump the first few JSONL lines and confirm which gid Shopify actually writes.

### 2. `SyncCursor` backfill status-value schema (for 02-05's prod-state script)

Row: `SyncCursor[shop, key="backfill"]`, `value` = JSON string.

```jsonc
{
  "status": "running" | "completed" | "failed",  // serialised FIRST — the failed-run
                                                 // re-claim matches on the substring
                                                 // "status":"failed"
  "operationGid": "gid://shopify/BulkOperation/7001" | null,
  "startedAt":   "2026-08-19T00:00:00.000Z",
  "polledAt":    "…" | null,   // last stale-poll touch; staleness = now - max(startedAt, polledAt) > 10min
  "completedAt": "…" | null,
  "error":       "…" | null,   // populated only on status: failed
  "orderCount":     7,         // rows ingested by the last completed run
  "scheduleCount":  7,
  "companyCount":   2          // companies whose exposure was recomputed
}
```

Exported constants: `BACKFILL_CURSOR_KEY`, `RECONCILIATION_CURSOR_KEY`, `STALE_AFTER_MS`. Read it with `readBackfillState(shop)` rather than parsing by hand — it degrades a corrupt value to `failed` so a bad row cannot wedge an install forever.

Companion row: `SyncCursor[shop, key="reconciliation"]`, `value` = plain ISO string = `max(sourceUpdatedAt) - 5 minutes`, or `now - 5 minutes` when the shop had no orders. **This is 02-04's starting point.**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] The bulk query would not have been codegen-validated**

- **Found during:** Task 1
- **Issue:** The plan specifies the bulk selection as "an inline `#graphql` document copied field-for-field from 02-RESEARCH.md", and lists `npm run graphql-codegen` as the acceptance gate that validates `StartLedgerBackfill`. But the inner query is a *string argument* to `bulkOperationRunQuery` — codegen validates the mutation envelope and never looks inside the string. The field list would have shipped unchecked, which is precisely how 02-01 nearly shipped `companyLocation` (research had the wrong field name; only codegen caught it). Wave-2 instructions explicitly warned me to let codegen validate the query before trusting any RESEARCH.md field name — with the plan's shape, it could not have.
- **Fix:** The selection is declared as a real named query `LedgerBackfillOrders` (so codegen type-checks every field against the July26 schema), and `bulkOrdersQuery()` strips the `#graphql` marker and operation header at call time to produce the bare selection set bulk operations require. One source of truth, one appearance of the filter string.
- **Verification:** `app/types/admin.generated.d.ts` now contains `LedgerBackfillOrdersQuery`; codegen exits 0. Two unit tests assert the stripped form starts with `{`, carries no `first:` argument, and contains `location { id }`.
- **Committed in:** `ee2a809`

**2. [Rule 2 - Missing Critical] Injected clock for the ingest path**

- **Found during:** Task 1
- **Issue:** `processBulkResults` called `recomputeCompany` with no `now`, so `overdue` and `earliestDueAt` depended on the wall clock. The fixture's due dates straddle today, so the overdue assertions would have quietly inverted as real time passed — a test that passes in August and fails in October proves nothing about either.
- **Fix:** `processBulkResults(shop, lines, now = new Date())` and `syncCompanies(shop, now = new Date())`, threaded to `recomputeCompany`. This mirrors the injected clock 02-01 built for exactly this reason.
- **Committed in:** `ee2a809`

**3. [Rule 2 - Missing Critical] A finish-handling failure must not be lost to its own dedupe**

- **Found during:** Task 2
- **Issue:** The route claims the webhook id before doing work (the established pattern). If the work then throws and the route returns non-200, Shopify redelivers — and the redelivery is deduped away by the receipt just claimed. The delivery is then permanently lost.
- **Fix:** The finish route catches, reports, and still acks 200, deliberately leaving the run `running` so `pollBackfillIfStale` — the retry mechanism that actually works here — picks it up on the next admin load. Documented in the route.
- **Note:** the same claim-then-work ordering exists in `app/routes/webhooks.orders.tsx` (02-01, not mine to change). Recorded under Deferred Items below.
- **Committed in:** `217b575`

**4. [Rule 2 - Missing Critical] Pagination guard on `syncCompanies`**

- **Found during:** Task 2
- **Issue:** A `pageInfo` that always reports `hasNextPage: true` (malformed response, or a hostile one) would loop forever inside a fire-and-forget promise — no timeout, no visible failure.
- **Fix:** `MAX_COMPANY_PAGES = 500` (125,000 companies) throws rather than spins.
- **Committed in:** `217b575`

### Process Deviation (not an auto-fix)

**Task 3's RED was not honestly available, so the edges were mutation-tested instead.** The tracer necessarily implements the parser, so all four edge tests passed on first run. Per the TDD gate I investigated rather than accepting it, and the cause is structural, not a mis-written test — the same situation 02-01 recorded for its compute core.

Three mutants were applied to `processBulkResults`, each run, then reverted (`git diff` empty afterwards, confirmed):

| Mutant | Tests failed |
|---|---|
| C — trailing `flush()` removed (drops the last buffered order) | 5 |
| A — strict `__parentId === current.id` matching (drops the PaymentTerms-parented schedule) | 8 |
| B — child buffer not reset between parents (schedules leak forward) | 11 |

Mutants B and C are specifically order-dependence bugs: both are invisible to a single-fixture test and are killed by the shuffled-fixture comparison, which is the evidence that test earns its place.

**Task 2's RED was genuine** — 8 failures against the absent route, committed as `3cf20c0` before `217b575` made them green.

---

**Total deviations:** 4 auto-fixed (all Rule 2) + 1 documented process deviation. No scope creep; no architectural change; no dependency added (`node:readline` and `node:stream` are stdlib).

## Handoffs — things this plan cannot do for itself

**For 02-05 (owns `shopify.app.toml` and scopes) — both are launch-blocking:**

1. **Subscribe `bulk_operations/finish` → `/webhooks/bulk-operations`.** The TOML currently subscribes only `app/uninstalled`, `app/scopes_update` and the three compliance topics. Until this is added the finish webhook never fires and the poll fallback carries the entire load — which works (tested), but delays every install's first balances by up to `STALE_AFTER_MS` (10 min) plus one admin page load. The route, its dedupe and its 401 path are all done and tested; only the subscription line is missing.
2. **`read_all_orders` in `SCOPES` (TOML + Railway).** Still not granted — the Partner Dashboard access request is unfiled (carried forward from 02-01 § User Setup Required). **Dev stores are exempt, so everything above works today**, but in production without it Shopify silently returns only the last 60 days and D-06 is violated invisibly — no error, just an understated number. This is recorded in a `§ Production dependency` block at the foot of `backfill.server.ts`.

**For 02-04 (scheduler):** the reconciliation cursor is seeded at `max(sourceUpdatedAt) - 5min` by every completed backfill (`SyncCursor[shop, "reconciliation"]`, plain ISO string). `awaitBackfillIdle()` is exported and is the drain hook a SIGTERM handler should await before exit.

## Deferred Items

- **Claim-then-work ordering in `webhooks.orders.tsx`** (02-01's file, not in my `files_modified`): a transient failure after the receipt is claimed makes Shopify's redelivery a no-op, silently losing that delivery. Order webhooks have no poll fallback the way the backfill does, so 02-04's daily reconciliation sweep is what would eventually converge it. Worth an explicit look when 02-04 lands.
- **Sentry is called but not initialised in tests.** `reportBackfillError` calls `Sentry.captureException`, which is a documented no-op when the SDK was not installed via `--import ./instrument.server.mjs`; the `console.error` alongside it is the record in that case. Verified the import is safe and cheap (~330ms, one-time) and that `captureException` on an uninitialised SDK does not throw.

## Known Stubs

None. Every export has a working implementation and at least one test. No TODO/FIXME markers, no placeholder returns, no hardcoded empty values in any file this plan created or modified.

## Threat Flags

None. The plan's threat register (T-02-12 … T-02-16) is fully covered by tests; no new network endpoint, auth path or trust boundary was introduced beyond the one webhook route the plan specified. The bulk selection reads company ids, money and dates only — no name, email, phone or address — so the phase stays inside protected-customer-data Level 1 (T-02-15).

## Self-Check: PASSED

- All 5 created files + 1 modified file exist on disk; `git diff --name-only f51e320..HEAD` returns **exactly** the 6 files in `files_modified` — no sibling-owned file (`prisma/`, `package*.json`, `vitest.config.ts`, `shopify.app.toml`, `ledger.server.ts`, shared test helpers) was touched.
- All 4 task commits resolve in `git log`; no deletions in any commit (`git diff --diff-filter=D` empty).
- `npm test -- --run` → **106 passed / 6 files** (02-01's 74 intact, 32 new).
- `npm run typecheck` → exit 0. `npm run lint` → exit 0. `npm run graphql-codegen` → exit 0.
- Acceptance greps: filter string count **1**; comment-filtered `created_at` count **0**; `readline` count **2**; `bulkOperation(` count **2**; route contains no `fetch(` call.
- Base-drift check passed before any work: base `f51e320`, `a909bb1` reachable, plan + `ledger.server.ts` + migration all present.
- `.planning/STATE.md` and `.planning/ROADMAP.md` untouched; nothing pushed.

---
*Phase: 02-ar-ledger-credit-engine*
*Completed: 2026-08-19*
