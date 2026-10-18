---
phase: 06-dashboard-onboarding-launch
plan: 02
subsystem: reminders
tags: [reminders, graphql, error-taxonomy, exactly-once, merchant-copy, app-store-4.3]

requires:
  - phase: 05-payment-reminders
    provides: the reminder sweep, the claim primitive, the F-01 failure taxonomy, eligibleSchedules' company-only filter
  - phase: 04-checkout-enforcement
    provides: updateValidationMessages' echo-flags fix (19b5946) and the app/block-messages.ts pure/server split
provides:
  - "WINDOWS #20 closed — a FAILED touchpoint outranked by a SENT/SENT_UNCONFIRMED higher-severity sibling is retired SUPPRESSED_STALE instead of re-sent"
  - "WINDOWS #21 closed — RETRIABLE_GRAPHQL_CODES, a closed, spec-pinned extensions.code set; every other GraphQL error lands SENT_UNCONFIRMED"
  - "WINDOWS #12 closed — the validationUpdate TOCTOU window is acknowledged at the echo site"
  - "WINDOWS #22 closed — Settings + README state the v1 company-only eligibility limit"
  - "app/reminder-copy.ts / REMINDERS_CADENCE — the shared, import-free cadence constant 06-05's R2 empty-state copy must import"
affects: [06-05, 06-dashboard, ship, app-store-submission]

actuals:
  tokens: 68700
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Discriminated retry decision (retry | outranked) so a sweep can WRITE DOWN a refusal instead of re-deciding it every tick"
    - "Closed, spec-pinned code allow-list for a fail-dangerous classification, with the fail-safe direction documented at the definition"
    - "Import-free shared copy module for strings that cross the route/server boundary (extends the app/block-messages.ts split)"

key-files:
  created:
    - app/reminder-copy.ts
  modified:
    - app/services/reminders.server.ts
    - app/routes/app.settings.tsx
    - app/services/enforcement.server.ts
    - tests/reminders.test.ts
    - tests/settings-messages.test.ts
    - README.md

key-decisions:
  - "RETRIABLE_GRAPHQL_CODES ships 9 codes, not the 11 the plan proposed: variableUsagesAreAllowed is a graphql-ruby RULE name rather than an error code (its code, variableMismatch, is already listed), and fieldConflict / selectionMismatch could not be verified against upstream from this sandbox (network egress blocked, graphql-ruby is a Ruby gem absent from node_modules). Dropping is the fail-safe direction: an omitted code costs one dropped reminder, a wrongly-included one mails a buyer twice."
  - "markSuppressedStale is a conditional updateMany (where status = FAILED), not the plain update the plan specified — an unconditional write could stomp a SENT a concurrent on-demand sweep had just recorded, erasing the evidence the per-order guard reads."
  - "The outranked row is retired BEFORE the per-order 24h guard in the sweep loop. Being overtaken is a permanent fact about the schedule, not a 'not right now' like the 24h window, so it must not be re-decided on a later tick."
  - "The severity fence retires one row per sweep (the most severe retriable candidate). Anything below it is outranked by the same sibling, so successive sweeps retire the ladder top-down and converge with zero sends."
  - "UI-SPEC R2's literal 'when it's overdue' is CORRECTED to '3 days after' in REMINDERS_CADENCE — the OVERDUE touchpoint fires at dueAt + 72h (OVERDUE_OFFSET_MS), not at the instant the invoice becomes overdue."

patterns-established:
  - "Fail-safe allow-lists: when a classification decides whether a side effect already happened, membership is a factual claim; omission costs a dropped action, wrong inclusion costs a duplicated one — so unverifiable entries are dropped, not guessed."
  - "Mutation-as-RED: a pinning spec with no natural RED is proven by mutating the artifact it pins and recording the failure."

requirements-completed: [LNCH-03]

coverage:
  - id: D1
    description: "WINDOWS #20 — a FAILED touchpoint outranked by a SENT/SENT_UNCONFIRMED higher-severity sibling on the same schedule is never re-sent; it is retired SUPPRESSED_STALE with attempts untouched"
    requirement: LNCH-03
    verification:
      - kind: integration
        ref: "tests/reminders.test.ts#the severity fence on a late retry (WINDOWS #20) > never retries a FAILED DUE_SOON once DUE is SENT — the lower moment is outranked"
        status: pass
      - kind: integration
        ref: "tests/reminders.test.ts#the severity fence on a late retry (WINDOWS #20) > never retries a FAILED DUE_SOON once DUE is SENT_UNCONFIRMED — the lower moment is outranked"
        status: pass
      - kind: integration
        ref: "tests/reminders.test.ts#the severity fence on a late retry (WINDOWS #20) > never retries a FAILED DUE once OVERDUE has been sent"
        status: pass
      - kind: integration
        ref: "tests/reminders.test.ts#the severity fence on a late retry (WINDOWS #20) > still retries a FAILED DUE_SOON when no higher moment was ever sent"
        status: pass
      - kind: integration
        ref: "tests/reminders.test.ts#the severity fence on a late retry (WINDOWS #20) > still retries a FAILED OVERDUE when only a LOWER moment was sent — the fence is one-directional"
        status: pass
    human_judgment: false
  - id: D2
    description: "WINDOWS #21 — a LedgerGraphqlError is retriable only when every extensions.code is in the closed RETRIABLE_GRAPHQL_CODES set; INTERNAL_SERVER_ERROR, absent codes and unknown strings land SENT_UNCONFIRMED and are never retried"
    requirement: LNCH-03
    verification:
      - kind: integration
        ref: "tests/reminders.test.ts#the send-failure taxonomy … (F-01) > treats extensions.code %s as definitely-not-sent — FAILED and retriable (9 cases)"
        status: pass
      - kind: integration
        ref: "tests/reminders.test.ts#the send-failure taxonomy … (F-01) > lands SENT_UNCONFIRMED on %s — a 200-with-errors may already have mailed the buyer (4 cases)"
        status: pass
      - kind: integration
        ref: "tests/reminders.test.ts#the send-failure taxonomy … (F-01) > never sends again after an ambiguous 200-with-errors, however long it waits"
        status: pass
      - kind: unit
        ref: "tests/reminders.test.ts#the send-failure taxonomy … (F-01) > pins the retriable code set — widening it must be a deliberate change (T-06-07)"
        status: pass
    human_judgment: false
  - id: D3
    description: "WINDOWS #12 — the validationUpdate echo-flags TOCTOU window is acknowledged in a code comment naming the visible-reversion outcome, the absence of CAS, and the low severity"
    verification:
      - kind: other
        ref: "grep -c 'WINDOWS #12' app/services/enforcement.server.ts == 1"
        status: pass
    human_judgment: false
  - id: D4
    description: "WINDOWS #22 — Settings copy and README state that only company-attributed net-terms orders are chased (v1), with the cadence composed byte-for-byte from the shared constant"
    requirement: LNCH-03
    verification:
      - kind: unit
        ref: "tests/settings-messages.test.ts#payment reminders copy (D5-05, N1, N2) > states the company-only eligibility limit plainly (WINDOWS #22)"
        status: pass
      - kind: unit
        ref: "tests/settings-messages.test.ts#payment reminders copy (D5-05, N1, N2) > composes the cadence from the shared constant, byte for byte (UI-SPEC R2)"
        status: pass
      - kind: other
        ref: "grep -c 'attributed to a company' app/routes/app.settings.tsx README.md — both non-zero"
        status: pass
    human_judgment: false
  - id: D5
    description: "app/reminder-copy.ts is transport-free and import-free, so any route can compose from it without the 04-04 build-only import trap"
    verification:
      - kind: unit
        ref: "tests/settings-messages.test.ts#payment reminders copy (D5-05, N1, N2) > keeps app/reminder-copy.ts import-free so any route can compose from it (04-04)"
        status: pass
      - kind: integration
        ref: "npm run build — react-router production build, server bundle 164.01 kB, clean"
        status: pass
    human_judgment: false

duration: 27min
completed: 2026-08-22
status: complete
---

# Phase 6 Plan 02: Gap Closure A — Reminder Engine and Merchant Copy Summary

**Two buyer-visible trust failures closed in the dunning engine — an outranked touchpoint can no longer be chased late, and only GraphQL codes that PROVE the mutation never ran are retriable — plus an honest company-only eligibility clause and the shared cadence constant the dashboard will import.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-08-22T01:11:00Z
- **Completed:** 2026-08-22T01:38:00Z
- **Tasks:** 3
- **Files modified:** 7 (6 modified, 1 created)
- **Suite:** 587/22 → **610/22** (+23 specs), typecheck / lint / build clean

## WINDOWS closure table

The orchestrator marks these fixed; this executor did not touch `.planning/WINDOWS.md`.

| # | File | Change | Regression spec | RED evidence |
|---|------|--------|-----------------|--------------|
| **20** | `app/services/reminders.server.ts` | `retriableRow` returns a discriminated `RetryDecision`; `outrankedBySentSibling` fences on a strictly-higher-severity `SENT`/`SENT_UNCONFIRMED` row; the sweep calls `markSuppressedStale` and continues without consuming a send or touching `chasedOrderGids` | `tests/reminders.test.ts` → *"the severity fence on a late retry (WINDOWS #20)"* — 3 fence specs + 2 controls | **True RED.** Pre-fix run: the 3 fence specs failed with `expected 1 to be +0` on `admin.callCount(SEND)` — the old code issued a REAL send to the outranked touchpoint. Both controls passed pre- and post-fix. |
| **21** | `app/services/reminders.server.ts` | `RETRIABLE_GRAPHQL_CODES` (closed, exported, `as const`) + pure `isDefinitelyNotSent`; `sendReminder`'s catch routes `LedgerGraphqlError` through it — true → `FAILED`/`REFUSED`, false → `SENT_UNCONFIRMED`/`TRANSPORT` | `tests/reminders.test.ts` → 9 retriable-code cases, 4 ambiguous cases, the no-second-send spec, and the exact-set pin (T-06-07) | **True RED.** Pre-fix run: 6 failed — all 4 ambiguous cases returned `'FAILED'` where `'SENT_UNCONFIRMED'` was expected (i.e. the old code would retry an `INTERNAL_SERVER_ERROR` 25h later), the no-second-send spec failed, and the set pin failed because the export did not exist. |
| **12** | `app/services/enforcement.server.ts` | Comment only, no behaviour change, at the `enable: flags.enabled, blockOnFailure: flags.blockOnFailure` echo site — names the read-then-write window, the reverted-toggle outcome, the absence of CAS on `validationUpdate`, the VISIBLE-reversion (not silent-disablement) severity, 04-VERIFICATION W1 and register entry T-06-09 | Grep gate: `grep -c "WINDOWS #12" app/services/enforcement.server.ts` == 1 | N/A — comment-only by design (the plan's `<action>` says "Comment only — no code change"). The gate is the grep. |
| **22** | `app/routes/app.settings.tsx`, `app/reminder-copy.ts` (new), `README.md` | `REMINDERS_MOMENTS_BODY` gains the company-only clause and composes its cadence from the shared `REMINDERS_CADENCE`; README § Payment reminders gains the v1 eligibility paragraph | `tests/settings-messages.test.ts` → 3 specs (clause, byte-for-byte composition, import-free guard) | **True RED** for the clause spec: pre-fix `expected 'reminders are sent by shopify, from y…' to contain 'attributed to a company'`. **Mutation-as-RED** for the other two (see below). |

### Mutation-as-RED evidence (#22's two pinning specs)

Neither had a natural RED — `app/reminder-copy.ts` had to exist before its own guard could run, and the pre-fix copy already contained the cadence literal verbatim. Both were proven by mutating the artifact they pin:

| Spec | Mutation applied | Result |
|------|------------------|--------|
| *"keeps app/reminder-copy.ts import-free … (04-04)"* | appended `import db from "./db.server";` to `app/reminder-copy.ts` | **FAILED** as required, then reverted |
| *"composes the cadence from the shared constant, byte for byte (UI-SPEC R2)"* | changed `REMINDERS_CADENCE` to `"… and 4 days after"` | **FAILED** as required (both the composition and the value assertion), then reverted |

## The final RETRIABLE_GRAPHQL_CODES set

Nine codes. Membership is a factual claim — *"Shopify did not mail the buyer"* — so the list is closed, ordered, and pinned by spec T-06-07; widening it requires editing that spec.

**Group A — execution gates** (the request is rejected before the mutation is reached):

| Code | Justification |
|------|---------------|
| `ACCESS_DENIED` | The scope check. Measured live in 02-06 and again in the post-release `write_orders` re-consent window. This is the case that MUST stay retriable, or every reminder for a shop is silently buried mid-re-consent. |
| `THROTTLED` | The Admin API rate-limit refusal — the request is rejected, not queued and not executed. |
| `MAX_COST_EXCEEDED` | Query-cost rejection at the same stage: cost is computed and refused before any field resolves. |

**Group B — graphql-ruby static validation** (the document fails validation and is never executed; codes are lowerCamelCase, per shopify.dev's GraphQL error reference showing `"code": "undefinedField"`). Each cites its upstream rule file under `lib/graphql/static_validation/rules/`:

| Code | Upstream rule file |
|------|--------------------|
| `undefinedField` | `fields_are_defined_on_type.rb` |
| `argumentNotAccepted` | `arguments_are_defined.rb` |
| `missingRequiredArguments` | `required_arguments_are_present.rb` |
| `argumentLiteralsIncompatible` | `argument_literals_are_compatible.rb` |
| `variableNotDefined` | `variables_are_used_and_defined.rb` |
| `variableMismatch` | `variable_usages_are_allowed.rb` |

**Dropped rather than guessed** (the plan instructed dropping anything unverifiable):

| Candidate | Why dropped |
|-----------|-------------|
| `variableUsagesAreAllowed` | It is the RULE name, not an error code. The code that rule emits is `variableMismatch`, which IS listed. |
| `fieldConflict`, `selectionMismatch` | Could not be checked against upstream from this sandbox — network egress is blocked (`curl` to raw.githubusercontent.com returned HTTP `000`) and graphql-ruby is a Ruby gem, absent from `node_modules`. |

Dropping is the **fail-safe direction**: an omitted code costs at most one dropped reminder (it takes the terminal `SENT_UNCONFIRMED` path), while a wrongly-included one mails a real buyer twice. `INTERNAL_SERVER_ERROR` is deliberately absent.

## For 06-05: the module R2 must import

```ts
import { REMINDERS_CADENCE } from "../reminder-copy";
// "3 days before the due date, on the due date, and 3 days after"
```

`app/reminder-copy.ts` is a plain module — **zero imports**, no `.server` suffix — so it is safe in both the client bundle and any route, the same split `app/block-messages.ts` uses. 06-05 must **replace 06-01's identical literal with this import** to compose:

```ts
`No reminders sent yet. Credit Guard emails a company ${REMINDERS_CADENCE}.`
```

That is how UI-SPEC's ⚑ *"must agree byte-for-byte on cadence"* is satisfied. A spec greps the module for `import` to keep it trap-free (04-04); adding one there would be inherited by every route that composes from it.

**UI-SPEC correction to record:** the spec's literal *"when it's overdue"* is corrected to *"3 days after"*, because the OVERDUE touchpoint fires at `dueAt + OVERDUE_OFFSET_MS` (72h past due), not at the moment the invoice becomes overdue.

## Task Commits

1. **Task 1: #20 severity fence** — `a69840e` (fix)
2. **Task 2: #21 code-set narrowing** — `3280149` (fix)
3. **Task 3: #12 TOCTOU comment + #22 copy + shared cadence** — `689bfac` (docs)

Branch: `worktree-agent-a7407851a613a2767`, cut from `4de4599` (verified ancestor of HEAD before any work; the plan's `caec650` and `main` preconditions both asserted green).

## Files Created/Modified

- `app/reminder-copy.ts` **(new)** — `REMINDERS_CADENCE`, the import-free cadence constant shared by Settings and (next) the dashboard's R2 empty state
- `app/services/reminders.server.ts` — `RetryDecision`, `outrankedBySentSibling`, fenced `retriableRow`, `markSuppressedStale`, the sweep's outranked branch, `RETRIABLE_GRAPHQL_CODES`, `isDefinitelyNotSent`, rewritten `sendReminder` catch + F-01 doc comment
- `app/routes/app.settings.tsx` — imports `REMINDERS_CADENCE`; `REMINDERS_MOMENTS_BODY` gains the company-only clause and composes the cadence
- `app/services/enforcement.server.ts` — the WINDOWS #12 acknowledgement comment (no behaviour change)
- `tests/reminders.test.ts` — +20 specs (5 fence, 15 error-taxonomy)
- `tests/settings-messages.test.ts` — +3 specs (clause, byte-for-byte cadence, import-free guard)
- `README.md` — § Payment reminders v1 eligibility paragraph

## Decisions Made

1. **Nine codes, not eleven** (see the set table above). The plan proposed eleven; three names failed verification and one of those (`variableMismatch`) was already covered. Recorded here because the exact-set spec makes any future change deliberate.
2. **`markSuppressedStale` is conditional** (`updateMany where status = FAILED`) rather than the plan's plain `update` keyed by id. An on-demand sweep runs alongside the cron tick by design (05-05); an unconditional write could overwrite a `SENT` a concurrent pass had just recorded, erasing the very row `ordersChasedRecently` reads to enforce the per-order guard. In practice both passes apply the same fence so the race is unreachable — this is defence in depth at zero cost. *(Deviation Rule 2.)*
3. **The outranked row is retired before the per-order guard**, not after. Placing it after would mean a schedule whose sibling was sent within the last 25h `continue`s at the guard and never records the decision, leaving the row FAILED to be re-decided on every later tick. Being outranked is permanent; the 24h window is not.
4. **One row retired per sweep.** Checking only the most severe retriable candidate is sufficient because anything below it is outranked by the same sibling. Successive sweeps retire the ladder top-down, converging with zero sends.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `markSuppressedStale` made conditional on `status = FAILED`**
- **Found during:** Task 1
- **Issue:** The plan specified `db.reminderLog.update` keyed by id. Unconditional, that write can stomp a status a concurrent on-demand sweep has just set — including a `SENT`, which would erase the evidence the per-order 24h guard reads and permit a second real send.
- **Fix:** `updateMany` with `where: { id, status: FAILED }`, matching the existing `reclaimFailed` discipline; documented at the definition.
- **Files modified:** `app/services/reminders.server.ts`
- **Verification:** Full reminders suite green (91/91); the exactly-once specs (orphaned SENDING, terminal-status re-claim matrix, F-03 race) all still pass.
- **Committed in:** `a69840e`

**2. [Rule 1 - Correctness] Two proposed retriable codes dropped, one corrected**
- **Found during:** Task 2
- **Issue:** The plan's Group B list contained `variableUsagesAreAllowed`, which is a graphql-ruby rule name rather than an error code, plus `fieldConflict` and `selectionMismatch`, which could not be verified against upstream (network egress blocked from the sandbox).
- **Fix:** Shipped the 6 verifiable Group B codes; documented all three drops and the fail-safe rationale at the definition. The plan's own `<action>` instructed "drop any you cannot verify rather than guessing".
- **Files modified:** `app/services/reminders.server.ts`
- **Verification:** The exact-set spec (T-06-07) pins the 9 shipped codes; the 6 behaviours the plan's `<behavior>` block named as retriable are all covered and green.
- **Committed in:** `3280149`

---

**Total deviations:** 2 auto-fixed (1 missing-critical, 1 correctness)
**Impact on plan:** Both tighten the plan's intent rather than widen it — one closes a concurrent-write hole, the other keeps the retriable set strictly to codes that can be justified. No scope creep; all plan behaviours delivered.

## Issues Encountered

- **Worktree had no `node_modules` and no `app/types/`.** Symlinked the parent checkout's `node_modules` and copied `app/types/` (both gitignored; codegen is a no-op offline, as the autonomy brief anticipated). The symlink was removed after the final verification so nothing dangling survives in the worktree.
- **Network egress blocked** (`curl` → HTTP `000`), which is what forced the two Group B drops. Recorded above rather than worked around.
- **Test isolation:** ran against scratch DB `creditguard_test_0602` (created, migrated, used, dropped).

## Known Stubs

None. No placeholder values, TODOs, or unwired data paths were introduced.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or trust-boundary schema changes. The plan's register entries T-06-06 (mitigated by the fence + closed set, both spec-pinned), T-06-07 (mitigated by the exact-set spec) and T-06-08 (mitigated by the copy + README + spec) are all discharged; T-06-09 remains `accept` with the acknowledgement now in code.

## Next Phase Readiness

- **06-05 is unblocked** on the cadence contract: import `REMINDERS_CADENCE` from `app/reminder-copy.ts` and delete 06-01's duplicate literal.
- **Four WINDOWS items are ready to be marked fixed** by the orchestrator (#12, #20, #21, #22). This executor did not touch `WINDOWS.md`, `STATE.md` or `ROADMAP.md`, and did not push or merge.
- **Not in scope here** (still open from D6-04): #3, #8, #10, #11, #13, #18, #19 — the other peers' plans and the pre-launch human items.

---
*Phase: 06-dashboard-onboarding-launch*
*Completed: 2026-08-22*

## Self-Check: PASSED

All 8 files verified present on disk (7 source/test + the SUMMARY); all 3 commit hashes (`a69840e`, `3280149`, `689bfac`) verified in `git log`.
