---
phase: 03-credit-controls-metafield-publishing
plan: 04
subsystem: infra
tags: [scheduler, node-cron, prisma, metafields, shopify-admin-api, testing]

# Dependency graph
requires:
  - phase: 03-01
    provides: "publishCompanyCreditState — the non-throwing, hash-skipping credit_v1 publisher this sweep calls"
  - phase: 02
    provides: "forEachActiveShop + the OVERDUE_SWEEP lease/cadence the backstop rides; the T-02-27 document guard it extends"
provides:
  - "Publish backstop inside the hourly overdueSweep: every company of every active shop through publishCompanyCreditState, writes gated by the state hash"
  - "Bounded, automatic retry for swallowed publishes (publishedAt < recomputedAt heals within one cycle)"
  - "Shop-scoped data_complete fan-out — a flag flip republishes exactly the stale companies, then stops"
  - "T-02-27 guard extended to a fourth service, plus a new transport guard asserting graphqlJson is the only way out"
affects: [04-checkout-validation-function, 05-reminders, ship]

actuals:
  tokens: 5642
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Outbox-lite: the dirty marker (publishedAt < recomputedAt) plus an existing lease-guarded sweep replaces a queue/outbox/worker"
    - "Hash-gated fan-out: enumeration is unconditional, WRITES are hash-conditional — the burst is bounded by what actually changed"
    - "Shared test-guard helper (tests/helpers/module-source.ts) so two suites cannot drift on what counts as a comment"

key-files:
  created:
    - tests/helpers/module-source.ts
  modified:
    - app/services/scheduler.server.ts
    - tests/scheduler.test.ts
    - tests/graphql-error-surfacing.test.ts

key-decisions:
  - "Backstop rides the existing OVERDUE_SWEEP lease and cron entry — no new lease name, no new registration, no new infrastructure (locked decision 2)"
  - "Placed AFTER the recompute loop so freshly-recomputed companies hash-skip their second touch in the same pass"
  - "No second try/catch around publishCompanyCreditState — the publisher already swallows and Sentry-tags; wrapping it again would strip that context while adding nothing"
  - "Deterministic enumeration order (companyGid asc) so a container killed mid-sweep resumes over the same sequence"
  - "sourceWithoutComments extracted to a shared helper rather than forked into the second guard suite"

patterns-established:
  - "Sweep-driven correction: any state that is shop-scoped but published per-company is corrected by a hash-driven pass, never by fanning webhooks out"
  - "Transport guard: every service except the transport home must route through graphqlJson — asserted structurally, comments stripped so doc comments naming the forbidden call cannot trip it"

requirements-completed: [CRED-03]

coverage:
  - id: D1
    description: "The hourly sweep republishes any company whose credit payload is stale — a swallowed inline publish heals within one cycle"
    requirement: "CRED-03"
    verification:
      - kind: integration
        ref: "tests/scheduler.test.ts#republishes a company whose inline publish was swallowed (publishedAt < recomputedAt)"
        status: pass
      - kind: integration
        ref: "tests/scheduler.test.ts#publishes a never-recomputed company (recomputedAt null) — fail toward freshness"
        status: pass
    human_judgment: false
  - id: D2
    description: "The fan-out is hash-skip-bounded: a shop-wide data_complete flip republishes every company of that shop and nothing more; unchanged payloads cost ZERO metafieldsSet calls"
    requirement: "CRED-03"
    verification:
      - kind: integration
        ref: "tests/scheduler.test.ts#fans a shop-scoped data_complete flip out to EVERY company of the shop (L-02)"
        status: pass
      - kind: integration
        ref: "tests/scheduler.test.ts#spends ZERO metafieldsSet calls on unchanged companies across repeated sweeps"
        status: pass
      - kind: other
        ref: "mutation test: disabling the hash-skip early-return in metafields.server.ts fails both bound tests; restored via git checkout"
        status: pass
    human_judgment: false
  - id: D3
    description: "A publish failure never aborts the sweep — neither the next company's publish nor the overdue flips"
    requirement: "CRED-03"
    verification:
      - kind: integration
        ref: "tests/scheduler.test.ts#keeps going after one company's publish fails — the failure is isolated"
        status: pass
      - kind: integration
        ref: "tests/scheduler.test.ts#still flips overdue when the publish half of the pass fails outright"
        status: pass
    human_judgment: false
  - id: D4
    description: "The backstop reaches shops only through forEachActiveShop — inactive shops are never enumerated and never published for (CF-3 / T-03-16)"
    requirement: "CRED-03"
    verification:
      - kind: integration
        ref: "tests/scheduler.test.ts#never publishes for an inactive shop — the backstop inherits CF-3 (T-03-16)"
        status: pass
      - kind: unit
        ref: "tests/scheduler.test.ts#scheduler.server.ts reads the Shop table exactly once, inside forEachActiveShop"
        status: pass
    human_judgment: false
  - id: D5
    description: "The existing overdue sweep behaviour is preserved — lease exclusion, strict-past boundary, injected clock, active-only enumeration, no new cron entry"
    requirement: "CRED-03"
    verification:
      - kind: integration
        ref: "npx vitest run tests/scheduler.test.ts (all 20 pre-existing tests green, unmodified)"
        status: pass
      - kind: unit
        ref: "tests/scheduler.test.ts#rides the existing OVERDUE_SWEEP lease — no new cron entry, no new lease"
        status: pass
    human_judgment: false
  - id: D6
    description: "The T-02-27 document guard covers a fourth service, and a transport guard locks graphqlJson as the only route out of every non-transport service"
    requirement: "CRED-03"
    verification:
      - kind: unit
        ref: "tests/graphql-error-surfacing.test.ts#every GraphQL document in metafields.server.ts is free of trapped selections"
        status: pass
      - kind: unit
        ref: "tests/graphql-error-surfacing.test.ts#app/services/metafields.server.ts routes every call through graphqlJson"
        status: pass
      - kind: other
        ref: "mutation test: a purchasingEntity selection and a direct getAdminContext call each fail the new guards; restored via git checkout"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-08-20
status: complete
---

# Phase 3 Plan 4: Hourly Publish Backstop Summary

**The hourly sweep became the retry and fan-out channel for credit_v1: it enumerates every company of every active shop but only spends an API write when the state hash actually changed, so a swallowed publish heals within one cycle and a shop-wide `data_complete` flip republishes exactly the stale companies — no queue, no new lease, no new cron entry.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-19T14:40:00Z
- **Completed:** 2026-08-19T15:05:00Z
- **Tasks:** 2
- **Files modified:** 4 (3 modified, 1 created)

## Accomplishments

- **`overdueSweep` gained `publishBackstop(shop)`**, placed after the recompute loop inside the existing `forEachActiveShop` callback. It rides the current `OVERDUE_SWEEP` lease and cadence — `SWEEP_SCHEDULE` still has exactly two entries and the reconciliation lease is untouched.
- **The fan-out is bounded by the hash, not by the company count.** Enumeration is unconditional; writes are not. A steady-state shop costs one DB read per company and zero `metafieldsSet` calls — proven by a test that sweeps twice and asserts a call count of 0, and mutation-verified by disabling the publisher's hash-skip (both bound tests then fail).
- **Swallowed publishes now heal automatically.** `publishedAt < recomputedAt` is the dirty marker; the pass republishes and the marker clears. A never-recomputed row (`recomputedAt` null) publishes too — 03-01's fail-toward-freshness branch is what keeps a company from staying invisible to Phase 4.
- **Failure isolation is inherent, not bolted on.** No second try/catch was added: `publishCompanyCreditState` already swallows and Sentry-tags. Tests prove one company's `userErrors` failure does not stop the next company, and that a total publish outage still leaves the overdue flip and exposure re-derivation intact.
- **The T-02-27 guard now covers four services**, and a new transport guard asserts the family rule the old guard only implied — `backfill`, `reconciliation` and `metafields` must all route through `graphqlJson` and never touch `getAdminContext`/`.graphql` directly, since `graphqlJson` is the single place `errors[]` is inspected.
- **Suite: 263 → 276 green**, typecheck/lint/build clean.

## Task Commits

1. **Task 1: Publish backstop pass inside the hourly sweep** — `3df4f2c` (feat)
2. **Task 2: Extend the document guard to the publisher module** — `bef8468` (test)

## Files Created/Modified

- `app/services/scheduler.server.ts` — added `publishBackstop(shop)` and one call inside the existing `overdueSweep` callback; imports `publishCompanyCreditState`. The recompute loop and `companiesToReevaluate` are unchanged.
- `tests/scheduler.test.ts` — wired the Phase 2 admin-client mock seam into the suite, added 8 backstop tests, made the seed fixture's `attributionStatus` coherent and overridable.
- `tests/graphql-error-surfacing.test.ts` — fourth-service document scan plus the new transport-guard describe block.
- `tests/helpers/module-source.ts` (new) — `sourceWithoutComments` / `moduleSource`, shared by both guard suites.

## Decisions Made

1. **The backstop is a plain sequential loop, not a batched `metafieldsSet`.** `metafieldsSet` accepts up to 25 metafields per call, but batching would collapse per-company error isolation into one all-or-nothing `userErrors` array and force a second bookkeeping strategy. At ICP scale (≤50 companies/shop, hash-skipped) the sequential loop's cost is a rounding error against the 2000-point bucket (T-03-11, accepted).
2. **Ordered by `companyGid` ascending, not by `id`.** `id` is a cuid — a container killed mid-sweep would resume over a different-looking sequence and the failing-company test would be non-deterministic. Ordering by the natural key makes both the production resume path and the test order predictable.
3. **The publisher's Shop.active re-check was kept as-is** rather than optimized away now that `forEachActiveShop` already gates. Double-gating is the point of T-03-16, and the publisher is also called from webhook paths that have no enumerator above them.
4. **The seed fixture's `attributionStatus` now defaults to `ATTRIBUTED`.** The fixture always sets a `companyId`, and an `UNRESOLVED` row with a `companyId` is incoherent (L-01: unresolved rows are unattributed by construction). It also meant every seeded shop started at `data_complete: false`, which would have made the fan-out test assert a flip that had already happened.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] The guard helper the plan told me to reuse did not exist in the target file**

- **Found during:** Task 2
- **Issue:** The plan's `read_first` described `tests/graphql-error-surfacing.test.ts` lines 211-257 as a "three-service scan — `sourceWithoutComments` + regex assertions" and instructed "reuse the helper, do not fork it". In reality that block matches raw document text and defines no helper; `sourceWithoutComments` lives unexported inside `tests/scheduler.test.ts`. There was also no pre-existing transport-call assertion for any service to copy — plan item (a) described a guard that had never been written.
- **Fix:** Extracted `sourceWithoutComments` (plus a `moduleSource` sibling for the raw-text guards) into `tests/helpers/module-source.ts` and pointed both suites at it, which satisfies "do not fork" literally. Wrote the transport guard fresh and applied it to all three non-transport services rather than only the new one, so it is a family rule instead of a one-off.
- **Files modified:** `tests/helpers/module-source.ts` (new), `tests/scheduler.test.ts`, `tests/graphql-error-surfacing.test.ts`
- **Verification:** `npx vitest run tests/graphql-error-surfacing.test.ts tests/scheduler.test.ts` green; mutation-tested by adding a `purchasingEntity` selection and a direct `getAdminContext` call to the publisher — three new guards failed, then `git checkout --` restored the file.
- **Committed in:** `bef8468`

**2. [Rule 1 - Bug] Non-deterministic company lookup in my own isolation test**

- **Found during:** Task 1
- **Issue:** The error-isolation test used the existing `companyOn(shop)` helper (`findFirstOrThrow` with no `orderBy`) while two companies existed on the shop, so Postgres was free to return either. It passed on the first run and failed on the next with `expected 2026-08-19T16:56:34.388Z to be null`.
- **Fix:** Addressed each company by its own gid via `findUniqueOrThrow({ where: { shop_companyGid } })`.
- **Files modified:** `tests/scheduler.test.ts`
- **Verification:** Three consecutive full runs of `tests/scheduler.test.ts`, 28/28 each time.
- **Committed in:** `3df4f2c`

---

**Total deviations:** 2 auto-fixed (1 × Rule 3 blocker, 1 × Rule 1 bug)
**Impact on plan:** No scope change. The Rule 3 fix delivered a slightly stronger guard than specified (three services under the transport rule instead of one) and no forked helper. No prohibitions were touched: `forEachActiveShop` is still the sole enumerator, no lease/cron/queue was added, and `metafields.server.ts`, the schema, TOML and `package.json` are byte-identical to base.

## Issues Encountered

**The suite's admin seam had to be introduced into `tests/scheduler.test.ts`.** Before this plan the scheduler suite did not mock `admin-client.server`, so the inline publish inside `recomputeCompany` was already firing at a real (unreachable) transport and failing silently into the mocked Sentry. Counting `metafieldsSet` calls — the entire property under test — required the Phase 2 mock seam. Adding it made those previously-silent publishes succeed instead; all 20 pre-existing tests stayed green because none assert publish state (they assert `overdue`, `exposure`, `earliestDueAt`, `recomputedAt`, all of which the publisher never writes).

## Verification Run

| Check | Result |
|---|---|
| `npx vitest run tests/scheduler.test.ts` | 28 passed |
| `npx vitest run tests/metafield-publish.test.ts` | 12 passed |
| `npx vitest run tests/graphql-error-surfacing.test.ts` | 14 passed |
| `npm test` | **276 passed / 16 files** (baseline 263) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | clean |

Scratch database `creditguard_test_0304` was used for all runs and dropped afterwards.

## Known Stubs

None. Every `<verify>` in the plan was run verbatim and passed; no tests were skipped and no placeholder code was left behind.

## Threat Flags

None. The backstop introduces no new trust boundary — it is an additional caller of an existing publisher inside an existing lease, double-gated on `Shop.active` (T-03-16), and its API-burst profile is the one already accepted in T-03-11 and now test-bounded.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

SC3's durability half is met: publishing is eventually consistent within one hour under any single failure, and the `publishedAt < recomputedAt` dirty count is queryable for the 03-05 production script. Phase 4's Function can assume a company's `credit_v1` metafield exists and is at most one hour stale even if every inline publish failed. Nothing here blocks 03-03 (Companies UI) — no shared files were touched.

## Self-Check: PASSED

- `app/services/scheduler.server.ts` — FOUND
- `tests/scheduler.test.ts` — FOUND
- `tests/graphql-error-surfacing.test.ts` — FOUND
- `tests/helpers/module-source.ts` — FOUND
- Commit `3df4f2c` — FOUND
- Commit `bef8468` — FOUND
