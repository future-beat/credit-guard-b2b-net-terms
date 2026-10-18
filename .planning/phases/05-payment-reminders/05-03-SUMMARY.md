---
phase: 05-payment-reminders
plan: 03
subsystem: reminders
status: complete
tags: [reminders, dunning, REMD-01, exactly-once, shopify-functions-adjacent, gdpr]

requires:
  - "05-01: ReminderLog model, claim primitive, sweep registration, sendReminder seam"
  - "05-02: measured E3/N1/E4/N5 response shapes; write_orders consent proven live"
provides:
  - "reminderSweep: the complete REMD-01 engine (derive -> select -> suppress -> guard -> cap -> claim -> refetch -> send -> classify -> resolve)"
  - "deriveTouchpoints/selectEligible: the pure dunning calendar, no I/O"
  - "classifySendResponse: measured-shape refusal classifier"
  - "ReminderLog.failureReason (nullable, token-only)"
  - "ReminderLog in the shop/redact deletion path"
affects:
  - "05-04: consumes REMINDER_STATUS/TOUCHPOINT for settings copy (no file overlap)"
  - "05-05: drives reminderSweep(now) with injected instants; deploys the migration"
  - "Phase 6: ReminderLog rows become the merchant-visible dunning feed"

tech-stack:
  added: []
  patterns:
    - "pure core + I/O half: the whole calendar decided without a database or clock"
    - "claim-then-send, with the unique constraint as the correctness primitive"
    - "conditional updateMany gated on affected-count === 1 for atomic re-claim"
    - "injected `now` stamped onto updatedAt/sentAt so time-driven tests equal cron"

key-files:
  created:
    - "prisma/migrations/20260821170000_add_reminder_log_failure_reason/migration.sql"
  modified:
    - "app/services/reminders.server.ts"
    - "app/services/shop-lifecycle.server.ts"
    - "prisma/schema.prisma"
    - "tests/reminders.test.ts"
    - "tests/shop-lifecycle.test.ts"

decisions:
  - "Attempts are spent at the MARK only, never at the claim or re-claim — otherwise 'three refusals flip DEAD' would fire on the second"
  - "A top-level GraphQL errors[] response (ACCESS_DENIED) is a PARSED refusal and stays retriable; only a non-GraphQL throw is ambiguous"
  - "DEFERRED rows are deleted at the start of the next sweep and re-derived (the one mechanism)"
  - "SENT_UNCONFIRMED stamps sentAt so the per-order guard treats it exactly like a confirmed send"
  - "The per-order guard and retry backoff key on sentAt/updatedAt stamped from the injected `now`, never wall-clock"

metrics:
  duration: "~50 min"
  completed: "2026-08-21"
  tasks: 2
  commits: 4
  tests_added: 45
  suite: "562 passed / 22 files (floor was 517)"

actuals:
  tokens: 19000
  tasks: 2
  commits: 4
---

# Phase 5 Plan 03: The Reminder Engine Summary

**The dunning calendar is now a pure function and the send path is a machine that can only ever send less** — three touchpoint instants derived to the millisecond, most-severe-only catch-up, the D5-02 watermark winning over severity, and a claim/refetch/send/classify pipeline in which every ambiguity resolves toward silence.

## What Was Built

**Task 1 — the pure core.** `deriveTouchpoints` and `selectEligible` decide everything REMD-01 cares about with no database, clock or network: DUE_SOON at `dueAt − 259_200_000ms`, DUE at `dueAt`, OVERDUE at `dueAt + 259_200_000ms` (D5-03/D5-04, instant math only). Crossing is strictly past — an instant equal to `now` waits a tick. Of the crossed-and-unlogged moments, the watermark check runs first and wins (F-02), then the single most severe survivor sends and the rest are SUPPRESSED_STALE. A five-day outage therefore owes one message, not three.

**Task 2 — the sweep machine.** Per schedule, in this order: derive → select → write suppressions → per-ORDER 24h guard → cap → claim → live `nodes()` refetch → send → classify → resolve. The order is the feature: every step can only reduce what is sent, and both steps that can silence a message entirely (the guard, the refetch) run before anything irreversible.

`classifySendResponse` branches on `userErrors` **content** first, because 05-02 measured `success: null` on every single refusal — reading `success` first cannot distinguish a settled schedule from a rate limit from a real fault.

## Deviations from Plan

**1. [Rule 1 — Bug] Attempts are spent at the mark, not at the re-claim**

The plan's F-03 parenthetical specified the conditional `updateMany` as `SET status SENDING, attempts increment`. Applied literally alongside `markFailed`'s existing increment, attempts would grow by two per cycle and the row would flip DEAD on the **second** refusal — contradicting the same task's stated bound ("third failure flips DEAD") and the tracer's committed spec asserting `attempts === 1` after one failure. Resolved in favour of the observable behaviour: the re-claim only flips status, and attempts are spent exactly once per answer from Shopify. `attempts` now literally means "answers received", which is what makes RATE_LIMITED-spends-nothing coherent.

**2. [Rule 2 — Correctness] A top-level `errors[]` response is a parsed refusal, not an ambiguous one**

The plan mapped "thrown → SENT_UNCONFIRMED". But `graphqlJson` throws `LedgerGraphqlError` for a **complete, parsed** HTTP 200 body carrying `errors[]` — the ACCESS_DENIED shape produced during the post-release re-consent window. That definitively means nothing was sent. Burying it as terminal-unconfirmed would silently drop *every* reminder for a shop during re-consent, exactly the window 05-01's own `markFailed` comment calls "expected operational noise". `sendReminder` now distinguishes `LedgerGraphqlError` (retriable FAILED/REFUSED) from any other throw (terminal SENT_UNCONFIRMED/TRANSPORT). This tightens rather than loosens F-01's principle: *only parsed refusals are retriable*, and a GraphQL error response is parsed.

**3. [Rule 1 — Bug] Fixed a latent cross-suite leak in tests/reminders.test.ts**

The tracer suite seeded shops and never cleaned up. Because suites share one Postgres database and `forEachActiveShop` enumerates whatever active shops it finds, the leftovers inflated later suites' call counts — surfacing as six `scheduler.test.ts` publish-backstop failures once this plan's extra shop shifted vitest's duration-based file ordering. Root-caused rather than worked around: an `afterAll` wipe now keeps this suite's blast radius inside itself. Suite verified stable across repeated full runs.

**4. [Rule 3 — Blocking] Tracer specs encoding single-touchpoint semantics were updated**

Eight tracer assertions asserted `logs).toHaveLength(1)` or read `logs[0]` positionally — true only while OVERDUE was the sole derived touchpoint. Since a sweep now writes up to three rows per schedule, these were updated to assert **by touchpoint name** (`logFor`, `statusesFor`) rather than by row position, which is both correct under the expansion and no longer order-dependent. The sweep-level strictness spec moved from the OVERDUE boundary to the **DUE_SOON** boundary, the earliest moment and the only one observable end-to-end with no other touchpoint in play; DUE and OVERDUE strictness are pinned in the pure-core specs. No tracer behaviour was dropped.

**5. [Process] Started with one untracked file in the tree**

`git status --porcelain` was not empty: `.planning/phases/05-payment-reminders/05-PLAN-CHECK.md`, the orchestrator's own plan-check artifact (dated 2026-08-20, its findings already absorbed into this plan at `3fd6dad`). HEAD was exactly `3fd6dad`, the branch was correct, and there were zero tracked modifications. Since staging is per-file and never `git add .`, this posed no risk to the commits; proceeded rather than halting. **The file remains untracked and unmodified.**

## Requested Records

- **DEFERRED mechanism (one, as required):** DEFERRED rows are **deleted at the start of the next sweep** (`deleteMany` on `status: DEFERRED`, before eligibility) and the touchpoint is re-derived from scratch. Re-claiming in place is impossible — the `@@unique([shop, scheduleGid, touchpoint])` constraint would refuse the second claim and strand the moment forever.
- **Pinned refusal substrings:** `ALREADY_COMPLETED_MESSAGE = "already completed"` and `RATE_LIMIT_MESSAGE = "24hour period"`, exported beside the verbatim 05-02 fixtures. A wording drift fails exactly one spec and names the sentence that moved.
- **Migration pending deploy:** `20260821170000_add_reminder_log_failure_reason` is strictly additive (one nullable `TEXT`, no default, no backfill) and is **not yet deployed** — 05-05 ships it with the release. Verified to apply cleanly to a virgin database.

## Verification

| Check | Result |
|-------|--------|
| `npx vitest run tests/reminders.test.ts -t touchpoint` | 15 passed |
| `npx vitest run tests/reminders.test.ts tests/shop-lifecycle.test.ts` | 90 passed |
| `npm test` (full suite) | **562 passed / 22 files** — floor was 517, +45, zero regressions |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | clean |
| `prisma migrate deploy` on a virgin DB | all migrations apply; `failureReason` nullable text |

Prohibitions re-checked by grep against the final source: no `Company.*` writes (ledger rule 3), no `balanceDueAmount` reference, no PCD field in any document, no second shop enumerator, and the single `sendReminder` call site sits inside `attemptSend` — unreachable without a claim.

Suite stability was explicitly re-verified across three consecutive full runs after the leak fix (562/562 each time), since the original failure was order-dependent.

## Truths Proven

| Truth | Where it is pinned |
|-------|--------------------|
| Three instants, exact, strictly crossed | `the touchpoint calendar` + `holds the same strict boundary at DUE and at OVERDUE` |
| Most-severe-only catch-up | `sends only the MOST SEVERE crossed touchpoint and stales the rest` |
| Watermark first and wins (F-02) | `classifies a both-pre-watermark-AND-outranked instant PREEXISTING, never STALE` |
| Claim-then-send under race | `sends exactly once when two passes race the same fresh touchpoint` |
| Atomic re-claim (F-03) | `sends exactly once when two passes race the same FAILED re-claim` |
| Never after paying | local-skip, live-refetch, and E3-refusal specs (three separate paths) |
| Ambiguity is terminal (F-01) | `marks SENT_UNCONFIRMED and never retries when the send transport dies` |
| N1 per-order, not per-company | four specs incl. `keys the guard on the ORDER, not the company` |
| RATE_LIMITED never spends an attempt | `never spends an attempt on a RATE_LIMITED refusal` |
| Cap cannot starve the oldest | `sends the cap, defers the rest` (asserts the deferred are the 10 newest) |
| GDPR: the trail dies with the shop | `tests/shop-lifecycle.test.ts` countsFor/EMPTY_COUNTS |

## Known Stubs

None. No stub, placeholder, skipped test, or unrun `<verify>` was introduced by this plan.

## Notes for 05-05

- `reminderSweep(now)` takes its instant by injection and stamps `sentAt`/`updatedAt` from it, so a driven sweep behaves **exactly** like a cron tick — including the 25h guard and backoff arithmetic. This was load-bearing enough that Prisma's honouring of an explicit `@updatedAt` value was verified empirically before the design was committed to.
- The engine remains inert in production: `remindersEnabledAt` is null for every shop and 05-04 owns the only path that sets it.
- The migration must be deployed before the code that reads `failureReason` runs.

## Self-Check: PASSED

- `app/services/reminders.server.ts` — FOUND
- `app/services/shop-lifecycle.server.ts` — FOUND
- `prisma/schema.prisma` — FOUND
- `prisma/migrations/20260821170000_add_reminder_log_failure_reason/migration.sql` — FOUND
- `tests/reminders.test.ts` — FOUND
- `tests/shop-lifecycle.test.ts` — FOUND
- Commits `a201cf3`, `f333f6e`, `1b260f2`, `76712b8` — all FOUND on `phase-05-payment-reminders`
