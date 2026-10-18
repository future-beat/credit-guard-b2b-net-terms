---
phase: 04-checkout-enforcement
plan: 02
subsystem: database
tags: [prisma, postgres, decimal, shopify-admin-graphql, observability, enforcement, react-router]

requires:
  - phase: 02-ledger-ingest
    provides: recomputeCompany as the sole writer of company credit state, upsertOrderFromSource + the rung-1/2/3 attribution ladder, the webhook claim-release dedupe, tests/helpers/admin-client-mock.ts
  - phase: 03-credit-controls
    provides: Company.creditLimit / Company.bypassEnforcement, the credit_v1 publisher and its rule-8 non-throwing posture, the Companies settings route and its intent switch
provides:
  - EnforcementEvent table (shop-keyed, no FK, snapshot companyGid/companyName) plus Company.blockedState, via the strictly-additive add_enforcement_events migration
  - app/services/enforcement.server.ts — isBlockedState (P4-L1) and wouldBlockOrder (P4-L2) as pure Prisma.Decimal predicates, EVENT_KIND (P4-L3), non-throwing recordEnforcementEvent
  - BLOCK_STATE_ENTERED / BLOCK_STATE_EXITED transition events emitted from the single hook inside recomputeCompany
  - BYPASSED_ORDER leak inference at attribution time with amount + channel (Order.sourceName) and [shop, kind, orderGid] dedupe
  - BYPASS_ENABLED / BYPASS_DISABLED audit events from the Companies-page set-bypass intent
  - Order.sourceName in both ledger GraphQL selections
  - The bypass-precedence restatement (rule 10) in the credit_v1 contract header
affects: [04-05 live enforcement proof, 06-dashboard DASH-02 enforcement feed, 05-reminders]

actuals:
  tokens: 34600
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Derived-state single-writer: blockedState is computed inside recomputeCompany's existing UPDATE, never beside it"
    - "Decide-inside-transaction, write-after-commit for observability rows that must not roll back committed ledger work"
    - "Unique index as the dedupe, P2002 treated as success rather than an incident (mirrors WebhookReceipt)"

key-files:
  created:
    - app/services/enforcement.server.ts
    - prisma/migrations/20260820112500_add_enforcement_events/migration.sql
    - tests/enforcement-events.test.ts
  modified:
    - prisma/schema.prisma
    - app/services/ledger.server.ts
    - app/services/metafields.server.ts
    - app/routes/app.companies.tsx

key-decisions:
  - "P4-L1 uses exposure >= limit while the page badge uses > and D4-01 uses exposure + cart > limit — three deliberately different comparisons, all three documented together in isBlockedState's doc comment so no future edit 'harmonises' them"
  - "Leak inference fires on 'the row just became ATTRIBUTED', which makes the pre-order company exposure the natural D4-01 left-hand side and makes redelivery a no-op without any extra bookkeeping"
  - "A P2002 duplicate-key rejection inside recordEnforcementEvent is a SUCCESS (the dedupe working) and is never sent to Sentry — only genuine failures are captured"
  - "Transition events tolerate rare duplicates from concurrent recomputes; only BYPASSED_ORDER carries a database uniqueness guarantee, because a leak counted twice would misstate money"
  - "The set-bypass action writes the audit row but NEVER writes blockedState — the transition it causes arrives through the existing republish → recomputeCompany path, preserving the single-writer invariant"
  - "Migration is strictly additive (one defaulted column + one new table) so main stays deployable against a migrated database for the whole Phase 4 PR window (F-05)"

patterns-established:
  - "Enforcement observability is one-way: nothing written by enforcement.server.ts is ever read back into a recompute, a publish, or the Function's input — which is what makes best-effort writes safe"
  - "Optional additive fields on OrderForLedgerNode (sourceName?) keep every pre-existing Phase 2 fixture valid without touching shared fixture builders"

requirements-completed: [ENFC-05, ENFC-06]

coverage:
  - id: D1
    description: "Blocked-state transitions (P4-L1) are written by recomputeCompany with the exposure/limit/overdue/bypass snapshot, exactly once per line crossing"
    requirement: "ENFC-05"
    verification:
      - kind: integration
        ref: "tests/enforcement-events.test.ts#writes exactly one BLOCK_STATE_ENTERED with the transition snapshot"
        status: pass
      - kind: integration
        ref: "tests/enforcement-events.test.ts#does not re-fire while the state is unchanged"
        status: pass
      - kind: integration
        ref: "tests/enforcement-events.test.ts#writes BLOCK_STATE_EXITED when the balance is settled"
        status: pass
      - kind: integration
        ref: "tests/enforcement-events.test.ts#transitions on an overdue flip alone, under the limit both times"
        status: pass
    human_judgment: false
  - id: D2
    description: "The P4-L1 boundary: exposure == limit is blocked state, one cent below is not; observe-only and bypassed companies are never blocked"
    requirement: "ENFC-05"
    verification:
      - kind: unit
        ref: "tests/enforcement-events.test.ts#treats exposure == limit as blocked and one cent under as not (P4-L1 boundary)"
        status: pass
      - kind: integration
        ref: "tests/enforcement-events.test.ts#enters at exposure == limit and stays quiet one cent below (P4-L1)"
        status: pass
      - kind: integration
        ref: "tests/enforcement-events.test.ts#never blocks an observe-only company, even overdue (CRED-04)"
        status: pass
      - kind: integration
        ref: "tests/enforcement-events.test.ts#never blocks a bypassed company (D-03 precedence)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Leaked net-terms orders are flagged as BYPASSED_ORDER with orderGid, amount and channel, deduped across redeliveries, and never for card-paid, observe-only or bypassed cases"
    requirement: "ENFC-06"
    verification:
      - kind: integration
        ref: "tests/enforcement-events.test.ts#flags an order that arrives while the company is already blocked"
        status: pass
      - kind: integration
        ref: "tests/enforcement-events.test.ts#flags an order whose own total exceeds remaining credit (P4-L2 > P4-L1)"
        status: pass
      - kind: integration
        ref: "tests/enforcement-events.test.ts#never double-flags across a redelivered doorbell"
        status: pass
      - kind: integration
        ref: "tests/enforcement-events.test.ts#holds the dedupe at the database even if the pre-read misses"
        status: pass
      - kind: integration
        ref: "tests/enforcement-events.test.ts#never flags a card-paid order — it was never credit (D-02)"
        status: pass
      - kind: integration
        ref: "tests/enforcement-events.test.ts#flags at attribution time when the order arrived UNRESOLVED first"
        status: pass
    human_judgment: false
  - id: D4
    description: "Flipping the bypass toggle writes a BYPASS_ENABLED/DISABLED audit row from the real route action, and the blocked-state transition it causes arrives via republish → recomputeCompany"
    requirement: "ENFC-05"
    verification:
      - kind: integration
        ref: "tests/enforcement-events.test.ts#writes BYPASS_ENABLED plus the BLOCK_STATE_EXITED it causes"
        status: pass
      - kind: integration
        ref: "tests/enforcement-events.test.ts#writes BYPASS_DISABLED plus the BLOCK_STATE_ENTERED it causes"
        status: pass
      - kind: integration
        ref: "tests/enforcement-events.test.ts#records every flip — audit rows never dedupe each other"
        status: pass
    human_judgment: false
  - id: D5
    description: "No enforcement-event write can fail a webhook or a settings save whose primary work already committed (T-04-07)"
    verification:
      - kind: integration
        ref: "tests/enforcement-events.test.ts#survives an event-store failure without failing the recompute"
        status: pass
      - kind: integration
        ref: "tests/enforcement-events.test.ts#leaves the ledger untouched by an event-store failure (T-04-07)"
        status: pass
      - kind: integration
        ref: "tests/enforcement-events.test.ts#never fails the merchant's save when the event store is down"
        status: pass
    human_judgment: false
  - id: D6
    description: "Leaked orders still count against balances and no Phase 2/3 behaviour moved — the 337-test baseline is intact"
    requirement: "ENFC-06"
    verification:
      - kind: integration
        ref: "npx vitest run (18 files, 370 tests, 0 failures — 337 baseline + 33 new)"
        status: pass
      - kind: unit
        ref: "tests/metafield-contract.test.ts#excludes computed_at: the same state at two instants hashes identically (the sha256 pin, unmoved)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The add_enforcement_events migration is strictly additive, so main stays deployable against a migrated database during the PR window (F-05)"
    verification:
      - kind: other
        ref: "npx prisma migrate diff --from-migrations --to-schema-datamodel (ALTER TABLE ADD COLUMN + CREATE TABLE only; git diff -w on prisma/schema.prisma shows zero removals)"
        status: pass
    human_judgment: true
    rationale: "Additivity is proven mechanically, but 'main still boots against this database' is a deployment judgement the merge/deploy step must confirm — the migration has not been applied to creditguard_dev or any Railway database by this plan."

duration: 27min
completed: 2026-08-20
status: complete
---

# Phase 4 Plan 02: EnforcementEvent Backend Summary

**A shop-keyed EnforcementEvent log fed by three observable moments — P4-L1 blocked-state transitions written inside recomputeCompany, BYPASSED_ORDER leak inference at order-attribution time with channel and amount, and bypass-toggle audit rows from the Companies action — all of it best-effort so nothing in the event path can fail a webhook or a settings save.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-08-20T03:12:00Z
- **Completed:** 2026-08-20T03:38:53Z
- **Tasks:** 3
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments

- **The table and the state column.** `EnforcementEvent` (shop, companyGid + companyName snapshots with no FK, kind, orderGid?, amount?, channel?, exposure, limit?, overdue, bypass, createdAt) with `@@unique([shop, kind, orderGid])` and `@@index([shop, createdAt])`, plus `Company.blockedState`. The migration is strictly additive — one defaulted column and one new table, zero drops/renames/retypes.
- **Two pure predicates, no float money.** `isBlockedState` (P4-L1) and `wouldBlockOrder` (P4-L2) compare `Prisma.Decimal` values only. `isBlockedState`'s doc comment names all three of the codebase's deliberately-different comparisons side by side, so nobody "fixes" one into another later.
- **One hook, one writer.** `recomputeCompany` derives `blockedState` in the same UPDATE that writes exposure/overdue and emits ENTERED/EXITED on a change. No route, sweep or handler writes the column — the invariant that makes a missing transition structurally impossible (T-04-06).
- **Leak inference where the comparison is still recoverable.** `upsertOrderFromSource` pre-reads `attributionStatus`, and when a net-terms row *just became* ATTRIBUTED it evaluates `wouldBlockOrder` against the company's pre-order exposure — the exact left-hand side D4-01 would have used at checkout. One moment later the recompute folds the order in and the comparison is gone forever.
- **The write can never hurt the caller.** The leak decision is made inside the transaction and written after it commits; `recordEnforcementEvent` catches everything, treats P2002 as the dedupe succeeding, and routes the rest to Sentry.
- **Bypass audit from the real action.** `set-bypass` records BYPASS_ENABLED/DISABLED after a successful `updateMany` and before `republish`, so the merchant's act and its consequence read in causal order — and the route still writes no state of its own.
- **Contract header restatement.** credit_v1 rule 10 now states in the contract-home comment that `bypass` is the reader's FIRST check and overrides overdue AND over-limit. Comment-only: the payload bytes, field order and serialization are untouched and the `creditStateHash` sha256 pin still passes unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: EnforcementEvent schema + blocked-state predicate + transition hook** — `26797c5` (test, RED) → `98e31c5` (feat, GREEN)
2. **Task 2: Leaked-order inference with channel + dedupe** — `9535b90` (test, RED) → `b9edfae` (feat, GREEN)
3. **Task 3: Bypass-toggle audit events + full-suite green** — `7db792e` (feat)

_No REFACTOR commits were needed; both GREEN implementations landed clean under typecheck, eslint and build._

## Files Created/Modified

- `prisma/schema.prisma` — `EnforcementEvent` model + `Company.blockedState`, both with doc comments naming their single writer and their locked decisions.
- `prisma/migrations/20260820112500_add_enforcement_events/migration.sql` — the additive migration, with a header explaining why additivity is the F-05 rollback story.
- `app/services/enforcement.server.ts` (new, 227 lines) — `EVENT_KIND`, `isBlockedState`, `wouldBlockOrder`, `recordEnforcementEvent`.
- `app/services/ledger.server.ts` — `sourceName` added to `OrderForLedger` and `CompanyOrdersForLedger`; optional `sourceName` on `OrderForLedgerNode`; the transition hook in `recomputeCompany`; the leak decision + post-commit write in `upsertOrderFromSource`.
- `app/services/metafields.server.ts` — contract-header rule 10 (bypass precedence) and the bypass row's note. Comment-only.
- `app/routes/app.companies.tsx` — the action's company `select` widened to the snapshot columns; the audit-event write in the `set-bypass` intent.
- `tests/enforcement-events.test.ts` (new, 821 lines) — 33 tests against real Postgres.

## Decisions Made

- **Three comparisons stay three comparisons.** The Companies badge (`exposure > limit`), D4-01 (`exposure + cart > limit`) and P4-L1 (`exposure >= limit`) answer three different questions — "has this company borrowed more than you allowed", "can this cart go through", "can ANY new order go through". A company sitting exactly at its limit therefore shows "Within limit" on the page *and* produces a BLOCK_STATE_ENTERED row. The rationale for all three lives in one place, in `isBlockedState`'s doc comment.
- **"Just became ATTRIBUTED" is the leak trigger** rather than a timestamp or a status flag. It is free (one pre-read inside a transaction that already exists), it makes the pre-order exposure available by construction, and it makes redelivery/refetch/preserve-mode all silently correct. The unique index is the backstop for the genuine race, not the primary mechanism.
- **P2002 is not an incident.** Sending every deduped redelivery to Sentry would train the merchant's alerting to ignore this module, so `recordEnforcementEvent` returns quietly on a duplicate key and captures everything else.
- **Transitions may rarely duplicate; leaks may not.** Two concurrent recomputes can both observe one flip. Preventing that needs a lock or CAS on the hot webhook path; tolerating it costs a cosmetic wrinkle in a timeline. A double-counted leak, by contrast, would misstate money — hence the index.
- **The bypass route writes an audit row, never state.** The blocked-state consequence travels through the existing `republish → recomputeCompany` call one line below, which re-reads the row the action just changed. Proven by the paired-event tests, not by inspection.

## Deviations from Plan

### Environment-driven adjustments (Rule 3 — blocking)

**1. [Rule 3 - Blocking] Migration applied to a scratch database only, not `creditguard_dev` / `creditguard_test`**
- **Found during:** Task 1
- **Issue:** The plan's action says "apply to creditguard_dev and (via pretest) creditguard_test", but this executor's environment contract forbids touching either database (parallel-worktree isolation — a peer plan is executing concurrently).
- **Fix:** Created `creditguard_test_0402` (plus a throwaway shadow database for `prisma migrate diff`), applied all six migrations there, ran every test run against it via `TEST_DATABASE_URL`, and dropped both when finished. `npx prisma migrate status` reported "Database schema is up to date!" against the scratch database before teardown.
- **Files modified:** none (operational only)
- **Verification:** 370/370 tests green against the scratch database; both scratch databases dropped.
- **Consequence for the merge:** `creditguard_dev` and any deployed database still need `prisma migrate deploy` after this branch merges. The migration is additive, so applying it early is harmless and applying it late is not blocking.

**2. [Rule 3 - Blocking] `sourceName` fixture support added locally rather than to `tests/fixtures/order-fixtures.ts`**
- **Found during:** Task 2
- **Issue:** The leak tests need `sourceName` on an `OrderForLedgerNode` fixture, but `tests/fixtures/order-fixtures.ts` is shared Phase 2 infrastructure outside this plan's declared file ownership while a peer plan runs in parallel.
- **Fix:** A local `leakedOrderNode()` helper in `tests/enforcement-events.test.ts` spreads `sourceName` onto `makeOrderForLedger()`'s output. Made possible by declaring `sourceName?: string | null` — optional — on `OrderForLedgerNode`, which also means every pre-existing Phase 2 fixture still typechecks untouched.
- **Files modified:** tests/enforcement-events.test.ts (this plan's own file)
- **Verification:** typecheck clean; all 18 test files green.

### Test coverage added beyond the plan's behaviour list

**3. Explicit "order fits inside remaining credit" case**
- **Found during:** Task 2
- **Reason:** P4-L2's strict `>` is the one place an off-by-one would silently over-flag every order a healthy company ever places, so the negative case is asserted directly (`does not flag an order that fits inside remaining credit`) rather than left implicit.
- **Files modified:** tests/enforcement-events.test.ts
- **Committed in:** `9535b90` (RED) / `b9edfae` (GREEN)

---

**Total deviations:** 2 environment-driven (both Rule 3, worktree-isolation constraints), 1 test-coverage addition
**Impact on plan:** No scope change and no behaviour change against what the plan specified. The only carry-forward is that the migration must be applied to `creditguard_dev` and the deployed database on merge.

## Known Stubs

None. Every code path this plan added is wired end to end and exercised against real Postgres rows.

## Threat Flags

None. The plan's `<threat_model>` covers every surface touched: the event rows carry money and state only (T-04-08 — no buyer contact data), attribution still requires the authenticated company→orders edge (T-04-05), the single-writer `blockedState` closes T-04-06, and the non-throwing writer plus post-commit leak write closes T-04-07. No new network endpoint, auth path or trust boundary was introduced; the one new GraphQL field (`Order.sourceName`) is a channel string, not customer data, and was validated against the 2026-07 schema by codegen.

## Issues Encountered

- **Prisma field named `limit`.** A column called `limit` is a Postgres keyword; Prisma quotes all identifiers, so it is safe, and `prisma validate` plus the live scratch-database run confirmed it. Kept as `limit` because the plan's artifact spec names it and it mirrors credit_v1's field name.
- **NULL-distinctness of the unique index.** `@@unique([shop, kind, orderGid])` had to constrain BYPASSED_ORDER without constraining the NULL-`orderGid` transition and audit rows. Postgres treats NULLs as distinct in a unique index, which is exactly the behaviour needed — locked in by the "records every flip — audit rows never dedupe each other" test, which writes two BYPASS_ENABLED rows for one shop.
- **`prisma format` reflowed the schema.** Adding the longer `blockedState` field name realigned the column padding across several existing models. `git diff -w` confirms zero semantic changes outside the additions.

## User Setup Required

None — no external service configuration. One operational note for the merge/deploy step: run `prisma migrate deploy` (the app's `npm run setup` already does this in the release phase) so `add_enforcement_events` lands on `creditguard_dev` and on Railway.

## Next Phase Readiness

- **04-05 (live enforcement proof)** now has real rows to read back: driving an over-limit order through the deployed app should produce a BLOCK_STATE_ENTERED row, and a draft-order bypass should produce a BYPASSED_ORDER with channel `shopify_draft_order`.
- **Phase 6 / DASH-02** has its feed source. `@@index([shop, createdAt])` is the read path; `companyGid` + `companyName` are snapshots, so the feed renders correctly even for companies that have since been deleted.
- **One item for the Phase 4 PR (04-05):** the F-06 REQUIREMENTS.md touch-up. P4-L2 is deliberately broader than ENFC-05's literal "while its company was blocked" wording — the VERIFIER NOTE explaining that extra BYPASSED_ORDER rows are intentional coverage lives in `wouldBlockOrder`'s doc comment, and the matching one-line requirement edit is still outstanding.
- **No blockers.** Wave 1 peer (04-01, `extensions/**`) shares no file with this plan; the diff touches only `prisma/`, `app/services/`, `app/routes/app.companies.tsx` and this plan's own test file.

## Self-Check: PASSED

- All 8 claimed files exist on disk (`app/services/enforcement.server.ts`, `prisma/migrations/20260820112500_add_enforcement_events/migration.sql`, `tests/enforcement-events.test.ts`, `prisma/schema.prisma`, `app/services/ledger.server.ts`, `app/services/metafields.server.ts`, `app/routes/app.companies.tsx`, this summary).
- All 5 claimed commits exist in `git log` on `worktree-agent-a4845b7239bdc18b4`: `26797c5`, `98e31c5`, `9535b90`, `b9edfae`, `7db792e`.
- `git diff --diff-filter=D e35245d..HEAD` is empty — no file was deleted.
- Working tree clean; no untracked files left behind; both scratch databases dropped.

---
*Phase: 04-checkout-enforcement*
*Plan: 02*
*Branch: worktree-agent-a4845b7239bdc18b4*
*Completed: 2026-08-20*
