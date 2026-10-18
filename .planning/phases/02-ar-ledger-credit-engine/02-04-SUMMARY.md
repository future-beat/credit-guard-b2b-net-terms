---
phase: 02-ar-ledger-credit-engine
plan: 04
subsystem: scheduler
tags: [node-cron, postgres-lease, reconciliation, drift-detection, admin-graphql, sentry, railway, vitest]

# Dependency graph
requires:
  - phase: 02-ar-ledger-credit-engine
    plan: 01
    provides: "recomputeCompany(shop, gid, now), refetchOrderAndRecompute, upsertOrderFromSource, getAdminContext seam, SweepLease/SyncCursor models, createMockAdmin, order-fixtures"
  - phase: 01-foundation-compliance
    provides: "Shop.active lifecycle (D-06), service-module style, source-guard test convention, creditguard_test isolation"
provides:
  - "app/services/scheduler.server.ts — forEachActiveShop (the sole shop enumerator), runExclusive lease claim, overdueSweep, SWEEP_SCHEDULE registration table, startScheduler/stopScheduler/handleSigterm"
  - "app/services/reconciliation.server.ts — reconcileShop (cursor paging + drift detect/correct + open-order probe), runReconciliationSweep, ORDERS_UPDATED_SINCE_QUERY, OPEN_ORDER_IDS_PROBE_QUERY"
  - "node-cron@^4.6.0 pinned; scheduler started at app/entry.server.tsx module scope"
  - "CF-3 enforced structurally, with a source guard that fails on a second shop enumerator"
affects: [02-05 deploy and scopes, phase-03 metafield publishing sweep, phase-05 reminder-email sweep reusing this loop]

actuals:
  tokens: 18136
  tasks: 3
  commits: 4

tech-stack:
  added:
    - "node-cron ^4.6.0 (v4 API: tasks start on creation, noOverlap, unref, shutdown; ships its own types; no postinstall)"
  patterns:
    - "Sole-enumerator gating: an authorization filter lives in the iteration primitive, not in each caller, so new callers inherit it by construction"
    - "Registration-as-data: SWEEP_SCHEDULE is an inspectable array, so wiring is asserted by value identity rather than by regex"
    - "Injected clock over fake timers: sweeps take `now` and thread it into recomputeCompany, making adjacency boundaries testable to the millisecond"
    - "Lease-as-hygiene, idempotency-as-correctness: the Postgres lease reduces duplicate work; it is never relied on for correctness"
    - "Cursor with deliberate overlap: watermark stored at max(updatedAt) − 5min so clock skew re-reads rather than skips"
    - "Drift is corrected only by full recompute and is always alerted, never silently absorbed"

key-files:
  created:
    - app/services/scheduler.server.ts
    - app/services/reconciliation.server.ts
    - tests/scheduler.test.ts
    - tests/reconciliation.test.ts
  modified:
    - app/entry.server.tsx
    - app/services/shop-lifecycle.server.ts
    - package.json
    - package-lock.json

key-decisions:
  - "Entry point: startScheduler() at app/entry.server.tsx module scope — the server bundle's once-per-process module. instrument.server.mjs loads before the app module graph exists (cannot import Prisma services); a route module is imported per-route and not at all until traffic arrives."
  - "Injected `now` rather than vi.useFakeTimers — the plan allowed either; an explicit clock parameter also survives into production code paths and needs no timer mocking around real Postgres I/O."
  - "node-cron tasks are created with `unref: true` so the cron heartbeat is never the only thing holding the process open; the HTTP server decides process lifetime."
  - "stopScheduler drains via node-cron 4's `shutdown(timeout)`, which stops tasks, waits out in-flight executions, then destroys them."
  - "Lease expiry is computed on the DATABASE clock (`now() + (30 || ' minutes')::interval`), so claim and expiry are compared against the same clock; the app clock is never involved."
  - "INSTANCE_ID reuses Railway's own RAILWAY_DEPLOYMENT_ID (UUID fallback locally) — no new environment variable introduced."
  - "runExclusive takes an optional `holder`, so a second container is simulable in a test without spawning a process."
  - "The reconciliation cursor defaults to epoch when absent: the first sweep after install covers all history, which is exactly D-06's no-age-window requirement, and self-limits from run two onwards."
  - "The cursor is persisted BEFORE the open-order probe so a probe failure does not cost the paging work."
  - "A company with recomputedAt null is a first observation, not drift — no Sentry warning, so install backfill noise cannot bury real missed-webhook alerts."
  - "Forbidden-pattern regexes live inside tests/scheduler.test.ts, never in the service source, so this plan's grep gates stay positive-only and a doc comment can never trip one."

patterns-established:
  - "Structural carry-forward closure: a verification carry-forward is closed by making the rule impossible to bypass (single primitive) plus a source guard, not by writing the rule down"
  - "Mutation-as-RED when the guard under test describes structure that already exists: inject the violation, watch the guard fail, revert byte-identically"

requirements-completed: [LEDG-04, LEDG-05]

coverage:
  - id: D1
    description: "The hourly sweep flips exactly the companies with an open schedule strictly past dueAt, with no merchant action"
    requirement: LEDG-05
    verification:
      - kind: integration
        ref: "tests/scheduler.test.ts#flips a company with an open schedule strictly past dueAt"
        status: pass
      - kind: integration
        ref: "tests/scheduler.test.ts#leaves a company whose schedule is still in the future alone"
        status: pass
      - kind: integration
        ref: "tests/scheduler.test.ts#ignores a completed schedule and a cancelled order"
        status: pass
    human_judgment: false
  - id: D2
    description: "A schedule due exactly at the sweep instant is NOT flipped by that sweep; it flips at the next one (D-04 strict past)"
    requirement: LEDG-05
    verification:
      - kind: integration
        ref: "tests/scheduler.test.ts#does NOT flip a schedule due at exactly the sweep instant (D-04 strict past)"
        status: pass
      - kind: mutation
        ref: "dueAt lt -> lte in companiesToReevaluate — 1 test failed, reverted byte-identically"
        status: pass
    human_judgment: false
  - id: D3
    description: "Sweeps never touch a shop with active=false — enforced structurally by forEachActiveShop being the only enumerator (CF-3, T-02-17)"
    requirement: LEDG-05
    verification:
      - kind: integration
        ref: "tests/scheduler.test.ts#sweeps the active shop and writes nothing for the inactive one"
        status: pass
      - kind: integration
        ref: "tests/scheduler.test.ts#forEachActiveShop yields only active domains"
        status: pass
      - kind: integration
        ref: "tests/reconciliation.test.ts#reconciles the active shop and never touches the inactive one"
        status: pass
      - kind: source-guard
        ref: "tests/scheduler.test.ts#scheduler.server.ts reads the Shop table exactly once, inside forEachActiveShop"
        status: pass
      - kind: source-guard
        ref: "tests/scheduler.test.ts#reconciliation.server.ts never reads the Shop table at all"
        status: pass
      - kind: mutation
        ref: "raw db.shop.findMany injected into overdueSweep (guard failed, 2 reads); active filter dropped (guard + 2 behavioural tests failed); both reverted byte-identically"
        status: pass
    human_judgment: false
  - id: D4
    description: "Two concurrent scheduler instances run each sweep once — the SweepLease atomic claim excludes the second claimant (Pitfall 6, T-02-18)"
    requirement: LEDG-05
    verification:
      - kind: integration
        ref: "tests/scheduler.test.ts#excludes a second claimant while the first holds it, and admits it after release"
        status: pass
      - kind: integration
        ref: "tests/scheduler.test.ts#releases the lease even when the sweep throws"
        status: pass
      - kind: integration
        ref: "tests/scheduler.test.ts#creates the lease row on first use and reuses it afterwards"
        status: pass
      - kind: mutation
        ref: "lockedUntil predicate removed from the claim — exclusion test failed, reverted"
        status: pass
    human_judgment: false
  - id: D5
    description: "Sweeps are idempotent — running one twice writes identical state (the actual correctness property behind deploy overlap)"
    requirement: LEDG-05
    verification:
      - kind: integration
        ref: "tests/scheduler.test.ts#is idempotent — running the sweep twice writes the same state"
        status: pass
    human_judgment: false
  - id: D6
    description: "Deliberately seeded ledger drift is detected, Sentry-warned with shop + company gid + both amounts, and corrected within ONE reconciliation run"
    requirement: LEDG-04
    verification:
      - kind: integration
        ref: "tests/reconciliation.test.ts#corrects a deliberately wrong stored exposure and warns Sentry"
        status: pass
      - kind: integration
        ref: "tests/reconciliation.test.ts#corrects drift by full recompute, never by arithmetic patching"
        status: pass
      - kind: integration
        ref: "tests/reconciliation.test.ts#does not warn when the stored exposure already matches"
        status: pass
      - kind: integration
        ref: "tests/reconciliation.test.ts#does not warn for a company seen for the very first time"
        status: pass
    human_judgment: false
  - id: D7
    description: "The reconciliation cursor advances to max observed sourceUpdatedAt minus a 5-minute overlap; an empty page leaves it unchanged"
    requirement: LEDG-04
    verification:
      - kind: integration
        ref: "tests/reconciliation.test.ts#advances to the newest sourceUpdatedAt minus a five-minute overlap"
        status: pass
      - kind: integration
        ref: "tests/reconciliation.test.ts#leaves the cursor untouched when a page comes back empty"
        status: pass
      - kind: integration
        ref: "tests/reconciliation.test.ts#queries from the stored cursor with an updated_at filter"
        status: pass
    human_judgment: false
  - id: D8
    description: "A locally-open order missing from the open-status probe is individually refetched — deletes/archives that emit no webhook are caught"
    requirement: LEDG-04
    verification:
      - kind: integration
        ref: "tests/reconciliation.test.ts#individually refetches a locally-open order missing from the probe"
        status: pass
      - kind: integration
        ref: "tests/reconciliation.test.ts#does not refetch an order the probe still reports as open"
        status: pass
      - kind: integration
        ref: "tests/reconciliation.test.ts#does not refetch an order whose schedules are all settled"
        status: pass
    human_judgment: false
  - id: D9
    description: "A throttled GraphQL response is retried once with backoff; a persistent failure is surfaced to Sentry and thrown"
    requirement: LEDG-04
    verification:
      - kind: integration
        ref: "tests/reconciliation.test.ts#retries a throttled page once and then succeeds"
        status: pass
      - kind: integration
        ref: "tests/reconciliation.test.ts#surfaces a persistently failing query to Sentry and throws"
        status: pass
    human_judgment: false
  - id: D10
    description: "Both sweeps are registered on distinct leases with noOverlap, and SIGTERM stops every task"
    requirement: LEDG-05
    verification:
      - kind: unit
        ref: "tests/scheduler.test.ts#registers the hourly overdue sweep and the daily reconciliation on distinct leases"
        status: pass
      - kind: source-guard
        ref: "tests/scheduler.test.ts#runs every registered sweep through the lease"
        status: pass
      - kind: integration
        ref: "tests/scheduler.test.ts#registers both tasks when forced, and SIGTERM stops every one of them"
        status: pass
    human_judgment: false
  - id: D11
    description: "The scheduler's cadences behave correctly against a real deployed Railway container across an actual rolling deploy (two live instances)"
    verification: []
    human_judgment: true
    rationale: "The lease exclusion is proven against real Postgres with two simulated holders, but genuine RAILWAY_DEPLOYMENT_OVERLAP_SECONDS behaviour — two containers with different RAILWAY_DEPLOYMENT_IDs racing a real 03:30 tick, and SIGTERM arriving mid-sweep — can only be observed on the deployed service. Belongs with 02-05's deploy verification."

duration: 14min
completed: 2026-08-19
status: complete
---

# Phase 02 Plan 04: Scheduler & Reconciliation Summary

**The phase's time axis: an hourly lease-guarded sweep that flips a company overdue the first tick after `dueAt` passes on active shops only, and a daily reconciliation that re-derives the ledger from Shopify — correcting a deliberately seeded 999-vs-500 drift inside one run with a Sentry trail.**

## Performance

- **Duration:** 14 min
- **Tasks:** 3
- **Files modified:** 8 (4 created, 4 modified)
- **Tests:** 35 added (20 scheduler, 15 reconciliation); full suite 109 green across 7 files

## Accomplishments

- **CF-3 is now structural, not documentary.** `forEachActiveShop` applies `active: true` and is the only shop enumerator either sweep may use. Two behavioural tests (an inactive shop gets zero writes, including `recomputedAt` staying null) plus two source guards enforce it, and all four were proven to bite by injecting a raw `db.shop.findMany` and, separately, by deleting the `active: true` filter.
- **The overdue flip is millisecond-exact at the D-04 boundary.** A schedule due at exactly the sweep instant is not selected by the indexed query, is not recomputed, and does not flip; one millisecond later it does. The strict-past comparison lives in the query itself, matching `computeCompanyState`'s rule rather than merely relying on it.
- **The ledger heals itself in one cycle.** A company stored at 999 with one open 500 order lands on exactly 500 after a single `reconcileShop`, with a warning naming shop, company gid and both amounts. The correction is always a full `recomputeCompany` — a companion test seeds the same drift with a cancelled order and asserts the result is exactly 0.00, which arithmetic patching could not produce.
- **The lease is real and so is the release path.** Instance A holding, instance B excluded, B admitted after release; and a sweep that throws still releases, so a crash cannot wedge the hourly cadence for 30 minutes.
- **The scheduler loop is Phase 5-ready as-is:** lease, active-shop gate, `noOverlap`, SIGTERM drain and a `SWEEP_SCHEDULE` table where Phase 5's reminder sweep appends one entry with its own lease name.

## Task Commits

1. **Task 1 (tracer): scheduler spine — time passing flips a company overdue** — `4f01d71` (feat)
2. **Task 2: reconciliation sweep** — `13d7321` (test, RED: 15/15 failing) → `3c0bccd` (feat, GREEN)
3. **Task 3: structural guards — CF-3 source guard, SIGTERM, sweep wiring** — `88f0946` (test)

## Files Created/Modified

- `app/services/scheduler.server.ts` — `forEachActiveShop`, `runExclusive`, `overdueSweep`, `SWEEP_SCHEDULE`, `startScheduler`/`stopScheduler`/`handleSigterm`; four module rules in the header
- `app/services/reconciliation.server.ts` — `reconcileShop`, `runReconciliationSweep`, `ORDERS_UPDATED_SINCE_QUERY`, `OPEN_ORDER_IDS_PROBE_QUERY`, cursor helpers, single-retry transport
- `app/entry.server.tsx` — `startScheduler()` at module scope, with the entry-point rationale recorded in place
- `app/services/shop-lifecycle.server.ts` — scheduler contract comment now names `forEachActiveShop` and its guard test as the enforcement mechanism (was a promise about a future plan)
- `package.json` / `package-lock.json` — `node-cron@^4.6.0`
- `tests/scheduler.test.ts` (20 tests), `tests/reconciliation.test.ts` (15 tests)

## Contract for Phase 3 / Phase 5

```ts
// app/services/scheduler.server.ts
forEachActiveShop(fn: (shop: string) => Promise<void>): Promise<number>
runExclusive(name: string, fn: () => Promise<void>, holder?: string): Promise<boolean>
overdueSweep(now?: Date): Promise<void>
startScheduler(options?: { force?: boolean }): boolean
stopScheduler(): Promise<void>
scheduledTaskCount(): number
SWEEP_SCHEDULE: { lease, expression, noOverlap, run }[]

// app/services/reconciliation.server.ts
reconcileShop(shop: string, options?: { now?: Date; retryDelayMs?: number }): Promise<ReconcileReport>
runReconciliationSweep(options?: ReconcileOptions): Promise<void>
```

**Lease names in use:** `overdue-sweep` (hourly, `0 * * * *`), `reconciliation` (daily, `30 3 * * *`). A later phase adding a sweep MUST introduce a new lease name — sharing one would let a slow sweep suppress another entirely.

**To add a sweep:** append one entry to `SWEEP_SCHEDULE`. It inherits the active-shop gate, the lease and `noOverlap` by construction; writing your own shop loop will fail the source guard.

## node-cron 4.x notes hit in practice

- `cron.schedule()` starts the task immediately — the v3 `{ scheduled: false }` option is gone. `createTask` is the start-later form (not needed here).
- The package ships its own types (`dist/node-cron.d.ts`); **no `@types/node-cron`** should be added, and it declares no postinstall script.
- `shutdown(timeout)` is exactly the graceful drain the SIGTERM requirement wanted: it stops every task, waits out executions already in flight (bounded), then destroys them.
- `unref: true` unrefs the internal heartbeat timer — without it a force-started scheduler would keep a test process (or a drained server) alive.
- ESLint's `import/no-named-as-default-member` flags `cron.schedule` / `cron.shutdown` on the default import; named imports (`schedule as scheduleCronTask`, `shutdown as shutdownCronTasks`) are the clean form.

## Decisions Made

- **Entry-point wiring (the decision PATTERNS flagged as planning's to make):** `startScheduler()` at `app/entry.server.tsx` module scope. React Router imports that module once when the server boots, before any request — the exact lifecycle a long-lived timer needs. `instrument.server.mjs` is loaded via `NODE_OPTIONS` *before* the app's module graph exists and so cannot import Prisma-backed services; a route module is imported per-route and not at all until traffic arrives. Guarded by `schedulerEnabled()` (no-op under `VITEST` / `NODE_ENV=test`) and a `globalThis` singleton flag copying `db.server.ts`'s pattern, so the module-scope call is safe in every environment the file loads in.
- **Injected clock, not fake timers.** The plan allowed either. `overdueSweep(now)` and `reconcileShop({ now })` thread the instant into `recomputeCompany(shop, gid, now)` — 02-01 added that parameter for exactly this. It keeps real Postgres I/O out of any timer mock and makes the persisted flag reflect the sweep instant rather than a few milliseconds later.
- **Lease timing on the database clock.** `now() + (30 || ' minutes')::interval` in the same statement as the `lockedUntil < now()` test, so claim and expiry are never compared across two machines' clocks. Verified against Postgres before it was written into the service.
- **`runExclusive` returns a boolean and takes an optional `holder`.** Losing the race is a normal outcome during a Railway deploy, not an error, so it is returned rather than thrown or logged; the `holder` parameter is what let a second container be simulated without spawning a process.
- **Cursor persisted before the probe.** The probe is the failure-prone pass (many pages, another throttle surface); losing the paging work to a probe error would mean re-reading the same orders tomorrow.
- **Registration as data.** `SWEEP_SCHEDULE` lets the wiring test assert `entry.run === runReconciliationSweep` by identity instead of grepping for a call. The one thing identity cannot express — that the cron callback is the lease *wrapper* — is the single wiring regex, kept inside the test file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `node_modules` absent in the worktree**
- **Found during:** Task 1, before any code
- **Issue:** The worktree had no `node_modules`, so nothing could be built, typechecked or tested.
- **Fix:** `npm ci` against the committed lockfile (existing dependencies only — not a new package install, so the package-legitimacy exclusion does not apply).
- **Verification:** 847 packages installed; lockfile unchanged by the install.

**2. [Rule 3 - Blocking] Worktree base was 15 commits stale**
- **Found during:** Startup, before reading the plan
- **Issue:** The worktree was created at `818bc70` (the Phase 1 merge). Plan 02-04 and every 02-01 output — `ledger.server.ts`, `admin-client.server.ts`, the ledger migration, the shared test helpers — were absent. Executing against that base would have produced a plan-blind implementation that conflicts on merge.
- **Fix:** `git reset --hard main` (`f51e320`) on the agent branch. The branch had zero commits of its own and a clean tree, so this was a fast-forward in effect; no other branch was touched.
- **Verification:** `app/services/ledger.server.ts` and `.planning/phases/02-ar-ledger-credit-engine/02-04-PLAN.md` present; migration `20260819031730_add_ledger_models` reported up to date against `creditguard_test`.

**3. [Rule 2 - Missing Critical] The hourly sweep could not clear a stale overdue flag**
- **Found during:** Task 1, writing `companiesToReevaluate`
- **Issue:** As specified, the sweep selects only companies with an open schedule strictly past `dueAt` — the flip *to* overdue. Nothing in that set can flip a company *back*. The clear normally arrives on an `orders/paid` webhook, but this phase exists precisely because that delivery is not guaranteed (research: `orders/updated` gaps are community-documented). A company whose payment was recorded but whose webhook was missed would stay flagged overdue — and therefore blocked at checkout — until the next daily reconciliation. A falsely-blocked paying customer is the project's stated worst outcome ("an instant uninstall").
- **Fix:** The sweep also re-evaluates companies currently flagged `overdue: true`. That set is normally tiny and self-clearing, and the schema already carries `Company @@index([shop, overdue])`, which is what the second query uses — the index existing strongly suggests this was the intended shape.
- **Why it does not weaken the plan's must-have:** companies with an open past-due schedule still flip, and the boundary case is unaffected (a company due exactly now is in neither set, so it is not even visited).
- **Files modified:** `app/services/scheduler.server.ts`
- **Verification:** `tests/scheduler.test.ts#clears a stale overdue flag when nothing is past due any more`
- **Committed in:** `4f01d71`

**4. [Rule 2 - Missing Critical] First observation of a company would have alerted as drift**
- **Found during:** Task 2 (GREEN)
- **Issue:** `upsertOrderFromSource` creates the `Company` head row with `exposure` defaulting to 0. A naive stored-vs-recomputed comparison therefore reports 0 → 500 as drift for every company the reconciliation meets for the first time. On the install backfill that is every company at once, which would bury the genuine missed-webhook signal the alert exists to carry.
- **Fix:** Drift is only reported for companies with a non-null `recomputedAt` — i.e. ones that have a previously computed value to disagree with.
- **Files modified:** `app/services/reconciliation.server.ts`
- **Verification:** `tests/reconciliation.test.ts#does not warn for a company seen for the very first time`
- **Committed in:** `3c0bccd`

**5. [Rule 3 - Blocking] Unbounded pagination loop**
- **Found during:** Task 2 (GREEN)
- **Issue:** A `while (hasNextPage)` loop trusts the source to terminate. A page reporting `hasNextPage: true` with a repeating `endCursor` would spin forever inside a daily cron task, holding a 30-minute lease and burning API quota.
- **Fix:** Paging is bounded at 250 pages (62,500 orders — far beyond any MVP merchant) and hitting the ceiling emits a Sentry warning rather than failing silently.
- **Files modified:** `app/services/reconciliation.server.ts`
- **Committed in:** `3c0bccd`

**6. [Rule 1 - Bug] Test fixture shared one payment-schedule gid across two orders**
- **Found during:** Task 2 (GREEN), pagination test
- **Issue:** `LedgerSchedule` is unique on `(shop, scheduleGid)`, and `makeOrderForLedger` numbers schedules from a per-order index, so two orders in the same page both carried `PaymentSchedule/9000` and the second upsert hit a unique violation. A test-only defect — real Shopify schedule gids are never shared — but it would have read as a reconciliation bug.
- **Fix:** The local `orderNode` builder derives the schedule gid from the order gid. `tests/fixtures/order-fixtures.ts` was NOT modified (02-01 owns it; the fix belongs in this plan's own file, per the Wave 2 contract).
- **Files modified:** `tests/reconciliation.test.ts`
- **Committed in:** `3c0bccd`

### Plan-sanctioned scope note

Task 1 created `app/services/reconciliation.server.ts` as a one-function stub, which the plan explicitly permits ("stub-call in this task, implemented in task 2: acceptable stub"). It was named in task 2's `<files>` rather than task 1's; both files are inside this plan's `files_modified` frontmatter, and the stub was fully replaced by task 2's GREEN. No stub survives.

### Process note: RED honesty

- **Task 2's RED is genuine** — 15/15 failing before any implementation existed.
- **Task 1 is a tracer**, so its 13 tests passed on first run by construction. Rather than claim a RED, the three load-bearing guards were mutation-tested: `lt` → `lte` on the strict-past comparison (1 failure), the `active: true` filter removed (2 failures), the `lockedUntil < now()` predicate removed from the claim (1 failure). The implementation was restored byte-identically after each (`cmp` verified).
- **Task 3's guards describe structure task 1 already built**, so the RED was staged the way the plan itself prescribes: a raw `db.shop.findMany` was injected into `overdueSweep`, the guard was written, it failed on two Shop reads, and the mutant was reverted byte-identically. The `active: true` deletion was run as a second mutant against the same guard.

---

**Total deviations:** 6 auto-fixed (1 bug, 2 missing-critical, 3 blocking) + 1 plan-sanctioned scope note
**Impact on plan:** No scope creep. Deviations 3 and 4 both harden the same invariant the phase exists for — never leave a merchant's credit state wrong in the direction that blocks a paying buyer.

## Issues Encountered

- **The worktree arrived on a stale base** (deviation 2). Worth flagging to the orchestrator: sibling agent `a00e42864bc547f13` was also sitting at `818bc70` at spawn time, while `a515b4fe15d345c3e` had the current `f51e320`. If that sibling did not correct its base, its work was written without 02-01's outputs.
- **`npm run graphql-codegen` again earned its place as the first correctness gate.** Both new documents (`OrdersUpdatedSince`, `OpenOrderIdsProbe`) validated against the pinned 2026-07 schema on the first run, and `app/types/admin.generated.d.ts` contains `OrdersUpdatedSinceQuery` and `OpenOrderIdsProbeQuery` — proof the documents were picked up rather than silently skipped.
- No `shopify` CLI command was run, so CF-5 was never at risk; `shopify.app.toml` is untouched by this plan.

## Known Stubs

None. Every export has a working implementation and test coverage; no TODO/FIXME markers, no skipped or todo tests, and every `<automated>` verify in the plan was run verbatim and passed.

## Files NOT touched (parallel-wave discipline)

`prisma/schema.prisma`, `prisma/migrations/` (02-01, complete), `vitest.config.ts`, `shopify.app.toml` (02-05), `app/services/ledger.server.ts`, `app/services/admin-client.server.ts`, `tests/helpers/admin-client-mock.ts`, `tests/fixtures/order-fixtures.ts` (02-01 contract, consumed read-only). The changed-file set is exactly the 8 paths in this plan's `files_modified`, with zero file deletions.

## User Setup Required

None new. `SweepLease` and `SyncCursor` already exist in both databases from 02-01's migration, and no environment variable was introduced — `RAILWAY_DEPLOYMENT_ID` is supplied by the platform and falls back to a local UUID.

Note for 02-05's deploy work: Railway's `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` may be left at its default. The lease plus idempotent recompute already cover the overlap window; setting it to 0 would trade a brief downtime blip for a guarantee we do not need.

## Next Phase Readiness

**Ready.** The scheduler loop is complete and reusable: Phase 3's metafield publishing and Phase 5's reminder emails each append one `SWEEP_SCHEDULE` entry with a new lease name and inherit the active-shop gate, lease, `noOverlap` and SIGTERM drain.

**Open item carried forward (coverage D11):** the lease is proven against real Postgres with two simulated holders, but a genuine Railway rolling deploy — two containers with different `RAILWAY_DEPLOYMENT_ID`s racing a real tick, and SIGTERM arriving mid-sweep — has not been observed on the deployed service. That belongs with 02-05's deploy verification.

## Self-Check: PASSED

- All 8 claimed files exist on disk; `git diff --stat f51e320..HEAD` lists exactly those 8 and nothing else.
- All 4 claimed commits resolve in `git log` (`4f01d71`, `13d7321`, `3c0bccd`, `88f0946`).
- `git diff --diff-filter=D f51e320..HEAD` → empty (no file deletions).
- `npm test -- --run` → 109 passed / 7 files; `npm run typecheck` → exit 0; `npm run lint` → exit 0; `npm run build` → exit 0.
- `npm run graphql-codegen` → exit 0, with both new operations present in the generated types.
- `npm ls node-cron` → `node-cron@4.6.0`; `grep -c noOverlap app/services/scheduler.server.ts` → 4 (≥2); `grep -c runExclusive` → 3 (≥2) across two distinct lease names; `grep -c 'sortKey: UPDATED_AT' app/services/reconciliation.server.ts` → 3 (≥1).
- Both plan `<automated>` verifies run verbatim and green: `npx vitest run tests/scheduler.test.ts && npm run build`, `npx vitest run tests/reconciliation.test.ts && npm run graphql-codegen`, `npm test -- --run`.
- `.planning/STATE.md` and `.planning/ROADMAP.md` untouched by this plan; nothing pushed.

---
*Phase: 02-ar-ledger-credit-engine*
*Completed: 2026-08-19*
