---
phase: 05-payment-reminders
plan: 05
subsystem: reminders
status: complete
tags: [reminders, live-proof, REMD-01, REMD-02, REMD-03, dunning, exactly-once, dev-store, railway, pr]

requires:
  - "05-01: ReminderLog + Shop.remindersEnabledAt schema, registry v7 with write_orders, prod-reminder-state probe"
  - "05-02: the evidence standard, prod-reminder-recipients probe, N1/N2/E3/E4/E5 measurements"
  - "05-03: reminderSweep(now) with injected-instant semantics, failureReason migration"
  - "05-04: the settings toggle — the only writer of the watermark"
provides:
  - "LP-1..LP-5 live evidence on credit-guard-demo: enablement without a blast, one send at the right moment, exactly once, stop-on-payment, company-only eligibility"
  - "scripts/prod-reminder-state.mjs touchpointPlan — per-schedule instants, crossed/logged flags, nextInstantAfterWatermark with tie detection, lastSendByOrder"
  - "Both Phase-5 migrations applied in production and asserted by name"
  - "The open PR to main carrying the whole phase"
affects:
  - "Phase 6 (LNCH-02): ReminderLog now holds 12 real rows across 6 statuses/touchpoints — the dunning feed has live data to render"
  - "05-02's N3 is SUPERSEDED: the dev store delivers customer email with multi-hour latency, it does not suppress it"

tech-stack:
  added: []
  patterns:
    - "Predict-then-drive: run the app's own pure core read-only at the injected instant and pre-register the expected row count, so a live drive confirms a prediction instead of producing a surprise"
    - "Tie detection as a precondition of an exactly-once claim: an instant is only a valid drive target if no other unlogged instant sits within the injection offset"
    - "Compare identities within one probe run only — the recipient fingerprint is salted per run, so equality is answerable and cross-run comparison is meaningless"

key-files:
  created:
    - ".planning/phases/05-payment-reminders/05-05-SUMMARY.md"
  modified:
    - "README.md"
    - "scripts/prod-reminder-state.mjs"
    - "scripts/prod-reminder-state.sh"
    - ".planning/WINDOWS.md"

decisions:
  - "LP-4's collateral sends were accepted rather than engineered away: #1004's next instant (18 Sep) is necessarily later than five other orders' DUE_SOON instants (15-16 Sep), so no injected now can cross the paid schedule's next moment without crossing theirs. The honest response was to wait out the one blocked order's N1 window, not to weaken the assertion"
  - "Honoured the plan's 25h N1 margin rather than Shopify's 24h platform limit, costing an extra hour of wall clock and zero risk"
  - "The touchpointPlan eligibility filter is a deliberate MIRROR of eligibleSchedules rather than a shared import: the probe runs in-container against @prisma/client with no bundler, so the filter is spelled out in full and a drift shows up as evidence disagreeing with the sweep"

metrics:
  duration: "~5.5h wall clock (3h of it a mandatory N1 window hold)"
  completed: "2026-08-21"
  tasks: 3
  commits: 3

actuals:
  tokens: 61000
  tasks: 3
  commits: 3

requirements-completed: [REMD-01, REMD-02, REMD-03]

coverage:
  - id: LP-1
    description: "Enabling reminders on a mature store with real backfilled data produces ZERO sends — every pre-existing crossed moment suppresses"
    requirement: REMD-01
    verification:
      - kind: other
        ref: "merchant enabled at 11:01:28.480Z (column read, never written by a probe); reminderSweep driven at the real clock 11:06:30Z -> 6 new rows ALL SUPPRESSED_PREEXISTING (#1007, #1002 x3 touchpoints), 0 SENT, 0 new timeline events. Pre-registered prediction was exactly 6"
        status: pass
    human_judgment: false
  - id: LP-2
    description: "One sweep at the earliest post-watermark instant sends exactly ONE reminder, for exactly that (schedule, touchpoint), meeting the three-signal evidence standard"
    requirement: REMD-01
    verification:
      - kind: other
        ref: "injected now 2026-09-15T01:02:00Z (#1004 DUE_SOON + 5min, zero ties). One new row: #1004 DUE_SOON SENT attempts=1 failureReason=null sentAt=2026-09-15T01:02:00.000Z. Timeline: payment_reminder_sent at 2026-08-21T11:09:09Z attributed to 'Credit Guard: B2B Net Terms'. Fingerprint 63da1c97885a == #1004's own confirmation fingerprint in the same probe run. N1 clear by choice: #1004 had never been reminded"
        status: pass
    human_judgment: false
  - id: LP-3
    description: "An immediate second drive at the same injected instant produces zero new rows and zero new timeline events"
    requirement: REMD-01
    verification:
      - kind: other
        ref: "re-drive at the identical instant: rowsBefore 7, rowsAfter 7, newRows [], changedRows []; exactly ONE new timeline event across both drives combined"
        status: pass
    human_judgment: false
  - id: LP-4
    description: "After the merchant records payment and completedAt lands via webhook, a drive at that schedule's NEXT instant writes nothing for it — it never enters derivation"
    requirement: REMD-01
    verification:
      - kind: other
        ref: "#1004 completedAt 2026-08-21T11:54:42.000Z (PAID, balance 0) via webhook ingest. Drive at injected now 2026-09-18T01:02:00Z (#1004 DUE + 5min): ZERO new rows and ZERO new timeline events for #1004, whose DUE moment was crossed-and-eligible at that instant. Five collateral DUE_SOON sends (#1005/#1008/#1009/#1010/#1011), all N1-checked clear first, all SENT with fingerprint equality"
        status: pass
    human_judgment: false
  - id: LP-5a
    description: "The pay-now URL exists and is well-formed, read and fetched in-container so the bearer URL never crosses the ssh boundary"
    requirement: REMD-02
    verification:
      - kind: other
        ref: "#1004 additionalPaymentCollectionUrl present, wellFormed true, shape /<11-digit>/order_payment/<13-digit>?secret=... on the store host, 302 when fetched inside the Railway container"
        status: pass
    human_judgment: false
  - id: LP-5b
    description: "Clicking Pay now in a DELIVERED reminder reaches a checkout page identifying the correct invoice (F-04's criterion)"
    requirement: REMD-02
    verification:
      - kind: manual_procedural
        ref: "user clicked Pay now in the delivered #1015 reminder; landed on a Shopify checkout page reading 'Acme Supply', line item 'The Complete Snowboard', 'Total due USD $664.95'; exported as PDF and read by the orchestrator"
        status: pass
    human_judgment: true
    rationale: "The button is rendered by Shopify's notification template Liquid and the landing page is Shopify's checkout; only a human clicking a delivered message can verify it."
  - id: LP-5c
    description: "A payment is COMPLETED through a reminder's Pay now link"
    requirement: REMD-02
    verification:
      - kind: manual_procedural
        ref: "NOT DONE — the checkout page reads 'This store can't accept payments right now.' (verbatim). Pre-launch: complete one payment through a reminder link on a store with a payment gateway. Tracked as WINDOWS #18"
        status: unknown
    human_judgment: true
    rationale: "A dev store cannot process a real transaction, so completion is unreachable here by construction."
  - id: E2-copy
    description: "The DUE_SOON reminder reads sensibly for an invoice that is NOT yet due — the phase's largest open risk"
    requirement: REMD-03
    verification:
      - kind: manual_procedural
        ref: "delivered pre-due reminder for #1015 read by the user and exported as PDF; reads correctly for a not-yet-due invoice. NOTE: the string `due_later?` is ABSENT from this store's Payment reminder Liquid, so the template branches on some other variable — the observed behaviour is the evidence, the mechanism is not claimed"
        status: pass
    human_judgment: true
    rationale: "Template rendering lives entirely inside Shopify; only a delivered message shows what a buyer reads."
  - id: E1-receipt
    description: "An overdue (past-due) reminder is actually received by a human"
    requirement: REMD-02
    verification:
      - kind: manual_procedural
        ref: "#1014's past-due reminder (sent 07:23Z) received ~12:15Z, ~5h later, human-confirmed. RECEIPT ONLY — the body was not inspected, so no claim is made here about the overdue headline wording"
        status: pass
    human_judgment: true
  - id: REMD-03-attribution
    description: "Shopify accepts each send, attributes it to this app, and resolves the order's own mailbox"
    requirement: REMD-03
    verification:
      - kind: other
        ref: "all 6 SENT rows carry a payment_reminder_sent timeline event attributed to 'Credit Guard: B2B Net Terms', each with a recipient fingerprint equal to that order's own confirmation fingerprint within the same probe run"
        status: pass
    human_judgment: false
  - id: company-only
    description: "Order #1013 (net terms, no purchasing company) never receives a ReminderLog row at any drive"
    requirement: REMD-01
    verification:
      - kind: other
        ref: "gid://shopify/Order/7081002598633 — 0 rows across all four drives; ReminderLog touched exactly 8 orders, none of them #1013"
        status: pass
    human_judgment: false
  - id: sender-branding
    description: "Reminder sender identity and branding are the merchant's own"
    requirement: REMD-03
    verification:
      - kind: manual_procedural
        ref: "delivered #1015 reminder, human-read, PDF-evidenced (titled 'Payment reminder for order 1015')"
        status: pass
    human_judgment: true
---

# Phase 5 Plan 05: Live Proof + PR Summary

**The machine was pointed at a real store and did exactly what it claimed: enabling on a mature account sent nothing, one moment sent one email, a second identical sweep sent none, and a paid invoice was never chased again — and a delivered email finally closed the questions 05-02 could only defer, including the one that could have killed the pre-due touchpoint outright.**

## The four drives

Every drive used the app's **own** `reminderSweep(now)` via `vite-node` against the real source inside the Railway container. Nothing was hand-rolled, nothing waited for cron, and every claim below comes from `scripts/prod-reminder-state.sh` / `scripts/prod-reminder-recipients.sh` JSON.

| # | Injected `now` | Real clock | Result |
|---|---|---|---|
| LP-1 | `2026-08-21T11:06:30Z` (real) | 11:06:23Z | 6 rows, all `SUPPRESSED_PREEXISTING`; **0 sent**; 0 timeline events |
| LP-2 | `2026-09-15T01:02:00Z` | 11:09:08Z | **1** row: #1004 `DUE_SOON` `SENT`; 1 timeline event |
| LP-3 | `2026-09-15T01:02:00Z` (identical) | 11:10:53Z | **0** new rows, **0** changed rows, 0 timeline events |
| LP-4 | `2026-09-18T01:02:00Z` | 14:33:13Z | **0 rows for the paid #1004**; 5 collateral `DUE_SOON` sends |

Final `ReminderLog`: **12 rows — 6 `SENT`, 6 `SUPPRESSED_PREEXISTING`**, across 8 orders and all three touchpoints.

### Predict, then drive

Before each write-side drive the app's *own* `eligibleSchedules`/`deriveTouchpoints`/`selectEligible` were run **read-only** in-container at the same injected instant, and the expected outcome pre-registered. LP-1 was predicted at 6 suppressions / 0 sends and produced exactly that; LP-2 was predicted at exactly one send and produced exactly one. A live drive that merely *looks* right is a much weaker artefact than one that confirms a number written down beforehand.

The `nextInstantAfterWatermark` output added to the state probe also reports **ties** — any other unlogged instant within the five-minute injection offset. LP-2's target had none, which is what makes "exactly one" a proof rather than an observation.

## LP-2 and the evidence standard

`success: true` means Shopify **accepted and enqueued** the send, not that a mailbox received it, and no API surface distinguishes the two. A reminder therefore counts as SENT only on three signals together:

| Signal | LP-2 evidence |
|---|---|
| `success: true`, empty `userErrors` | one row, #1004 `DUE_SOON` → `SENT`, `attempts: 1`, `failureReason: null`, `sentAt: 2026-09-15T01:02:00.000Z` |
| timeline event, attributed | `payment_reminder_sent` at `2026-08-21T11:09:09Z`, app **"Credit Guard: B2B Net Terms"** |
| recipient fingerprint | `63da1c97885a`, **equal** to #1004's own confirmation fingerprint |

`sentAt` is stamped from the **injected** instant, not the wall clock, which is what makes a driven sweep arithmetically identical to a cron tick — including the 25h guard and the retry backoff.

**Fingerprints are salted per probe run.** They answer "same mailbox?" within one run and are meaningless across runs. An earlier note in this session quoted a fingerprint across runs as if stable; it is not.

## LP-4, and the collateral that could not be engineered away

The merchant marked #1004 paid; `completedAt: 2026-08-21T11:54:42.000Z` landed through the real `orders/*` webhook path, balance `0 USD`. The drive at #1004's **next** instant (`DUE + 5 min`) wrote **nothing** for it: a completed schedule is filtered out of `eligibleSchedules` entirely, so the moment is never derived, never claimed, and never considered. Stop-on-payment is a *local skip*, cheaper and more certain than a refusal.

That drive also sent five legitimate first reminders (#1005, #1008, #1009, #1010, #1011), each meeting the full evidence standard. **This was unavoidable, and the reasoning matters more than the outcome:** #1004's next instant is `2026-09-18T00:57Z`, while five other orders' `DUE_SOON` instants fall on 15–16 September. Any `now` past the former necessarily crosses the latter, and logging those moments any other way would itself have required sending them. There was no injected instant that isolates the paid schedule.

One of the five, **#1010, was inside Shopify's per-order 24h window**. The plan forbids driving at an order inside 25h, so the drive was **held for three hours** until the margin cleared, then re-checked against the live timeline immediately before firing (#1010 measured at **25.03h**). It sent successfully — which incidentally produced a clean live confirmation of the N1 arithmetic: 05-02 measured a **refusal at 17.4h**, and this phase measured a **success at 25.03h**, on the same order.

## What a delivered email proved — and the 05-02 conclusion it overturns

**05-02 concluded that the dev store delivers no customer-facing email at all. That conclusion was wrong.** Delivery is *delayed and variable*, not suppressed: two reminders issued ~30 seconds apart arrived ≈**3.5h** (#1015) and ≈**5h** (#1014) after send, both human-confirmed. Order confirmations were similarly delayed. What looked like a wall was a latency artefact — a reminder that "we observed nothing arrive" and "nothing can arrive" are different claims.

That unlocked three verifications 05-02 had to defer, all `human_judgment: true`:

- **DUE_SOON copy (E2): PASS.** The delivered pre-due reminder for #1015 reads correctly for an invoice that is not yet due. **This was the phase's largest open risk** — had the template been unconditionally overdue-phrased, a DUE_SOON reminder would have told a buyer their payment was overdue up to 30 days early, which is worse than sending nothing, and the touchpoint would have had to be dropped. Recorded precisely: the string `due_later?` is **absent** from this store's Payment reminder Liquid, so the template branches on some other variable. The observed behaviour is the evidence; the mechanism is not claimed.
- **Pay-now click-through (REMD-02): PASS at F-04's criterion.** Clicking **Pay now** in the delivered #1015 reminder reaches a Shopify checkout identifying the right invoice — "Acme Supply", "The Complete Snowboard", **"Total due USD $664.95"**. Payment could not be *completed*; the page reads "This store can't accept payments right now." (verbatim — reading that as a dev-store gateway limitation is an inference, not a measurement).
- **Overdue receipt (E1): PASS, receipt only.** #1014's past-due reminder was received ~5h after send. **The body was not inspected**, so nothing is claimed here about the overdue headline wording.

## Cron and on-demand drives coexisting, for real

The production hourly sweep ran throughout. The `reminder-sweep` lease was held at `11:30:00.185Z` and again at `14:30:00.181Z` by this very release — real ticks, after enablement, one of them three minutes before LP-4 — and neither wrote a row, because every crossed moment already had one. The claim table was exercised against genuine concurrency rather than a simulated race.

## Deployment (LP-0)

Deployed from the branch working tree. Both Phase-5 migrations confirmed in `_prisma_migrations` **by name**: `20260820123230_add_reminder_log` and `20260821170000_add_reminder_log_failure_reason` (the latter shipped by this plan). `scripts/smoke-deployed.sh app.creditguardhq.com` green. The deployed bundle was checked for the Wave-3/4 code, `/app/settings` confirmed served (410 auth-bounce vs 404 for a nonexistent route), and reminders confirmed still **off** with `ReminderLog` **empty** before the human was asked for anything — the 04-05 lesson that everything a human step depends on gets pre-verified below the UI.

## Deviations from Plan

**1. [Rule 3 — Blocking] LP-4 was held three hours for an N1 window**

- **Found during:** Task 1's pre-drive N1 clearance table
- **Issue:** #1010 last received a reminder at `2026-08-20T13:31:10Z`, and it is unavoidably in LP-4's collateral set (see above). Driving earlier would have spent a guaranteed refusal, which the plan prohibits.
- **Fix:** waited until `14:31:15Z` (the plan's 25h margin, not Shopify's 24h limit), then re-verified on the live timeline before firing. Measured 25.03h.
- **Cost:** ~3h wall clock, zero risk taken.

**2. [Rule 2 — Correctness] The now-selection output is nested under `touchpointPlan`**

The plan's verify snippet reads `nextInstantAfterWatermark` at the top level of the probe's JSON. It is emitted under `touchpointPlan` instead, alongside the per-schedule instants and the tie list it only means something next to. The `verify` assertion was adjusted to match. The plan's other top-level check (`remindersEnabledAt`) does not exist at top level either — the switch lives under `shops.rows[]`, and `shops.remindersEnabled` is the count actually asserted.

**3. [Rule 3 — Blocking] `scripts/prod-reminder-state.sh` was modified, beyond the plan's file list**

The plan lists `README.md` and `prod-reminder-state.mjs`. The `--after` provisional-watermark argument has to reach the container, so the shell wrapper needed a third positional and an argument guard (a regex allow-list, since the remote command is assembled as a single-quoted string).

**4. [Process] Background timers were killed repeatedly; the wait ran in the foreground**

Two `run_in_background` timers were stopped rather than completing. The remaining wait was taken as bounded foreground waits with a clock check between each. No behavioural impact; recorded because it made the hold visible rather than silent.

**5. [Process — self-correction] An unrelayed observation was asserted, then over-corrected**

Mid-session this executor stated pay-now click-through details that had not appeared in any relay it could point to, then — on discovering that — re-opened `WINDOWS #17` and rewrote `#18` to strip them. The orchestrator confirmed the relay **had** existed (two user-exported PDFs, read and relayed verbatim). `#17` was restored to `fixed` with the full evidence as its reason. The instinct to distrust an unsourced fact was right; the conclusion was wrong. Both the error and the correction are left on the record rather than tidied away, because the ledger is only useful if its churn is legible.

## Live fixture changes this plan caused

| Change | Effect | Restore |
|---|---|---|
| #1004 marked **paid** ($1,025) | Northwind Trading exposure `1,924.90 -> 899.90`, i.e. **under** its $1,500 limit — the over-limit fixture is gone | Credit Guard -> Companies -> Northwind Trading -> set credit limit to **800** |
| 6 reminders sent | 6 orders now carry a `payment_reminder_sent` event; each is inside its own 24h N1 window until ~2026-08-22T14:33Z | time |
| `remindersEnabledAt` set | the store dunns on the real clock from `11:01:28.480Z` | Settings -> Payment reminders -> **Turn off payment reminders** |

Also observed, not caused: #1014/#1015/#1016 are **not yet company-attributed** in the ledger, so the company-only filter currently excludes them; the daily 03:30 reconciliation sweep is the mechanism that heals that. And Acme's contact email was reverted to `example.com` by the merchant — per N2 this does not affect the snapshotted recipients on orders already placed, only future Acme orders.

## Final store state

`remindersEnabledAt: 2026-08-21T11:01:28.480Z` — **reminders left ENABLED**, pending a merchant tap of "Turn off payment reminders" that was requested but is not yet reflected in the column at the time of writing. This is a coherent, safe state rather than a half-driven one: every derived moment is resolved, and the next real-clock instant on this store is #1005's `DUE_SOON` on **15 September**, three and a half weeks out. Should the merchant prefer it off, one tap does it and the watermark nulls.

## Known Stubs

None. No stub, placeholder, skipped test, or unrun `<verify>` was introduced by this plan.

## Outstanding — tracked in `.planning/WINDOWS.md`

- **#18 (open):** no payment has ever been *completed* through a reminder's Pay now link — `credit-guard-demo` cannot accept payments.
- **#19 (open, informational):** delivery latency measured only on a dev store (3.5–5h across two sends 30s apart); confirm normal-latency delivery on a paid-plan store with a verified sender domain.
- **#14 / #15 / #16 / #17 (fixed):** inbox receipt, DUE_SOON copy, delivery, and pay-now click-through, all closed on the delivered #1015 and #1014 messages.

## Verification

| Check | Result |
|-------|--------|
| `npm test` | **587 passed / 22 files** (floor 587; no source changes in this plan) |
| `npm run lint` | clean |
| `scripts/smoke-deployed.sh app.creditguardhq.com` | PASS |
| Both Phase-5 migrations in `_prisma_migrations` by name | PASS |
| `git status` clean of probe files | PASS (every mutating probe stayed in the session scratchpad, T-05-08) |
| Container clean of probe files | PASS |

## Task commits

1. **Task 1 — now-selection probe + finalized reminder docs (LP-0)** — `c640d75`
2. **Task 2 — the guided live drive** — no commit by design (live evidence, no source change)
3. **Task 3 — this SUMMARY + WINDOWS corrections** — final metadata commit

## Self-Check: PASSED

- `README.md` — FOUND
- `scripts/prod-reminder-state.mjs` — FOUND (touchpointPlan returns valid JSON against the live store)
- `scripts/prod-reminder-state.sh` — FOUND
- `.planning/WINDOWS.md` — FOUND (`windows status` -> ok: true)
- `.planning/phases/05-payment-reminders/05-05-SUMMARY.md` — FOUND
- commit `c640d75` — FOUND
- `npm test` — 587 passed across 22 files
- `git status` — clean of probe files; container clean of probe files
