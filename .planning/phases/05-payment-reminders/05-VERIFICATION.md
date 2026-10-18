---
phase: 05-payment-reminders
verified: 2026-08-21T15:08:58Z
status: human_needed
verdict: ACHIEVED_WITH_GAPS
score: 17/17 must-haves verified
behavior_unverified: 0
overrides_applied: 0
commit_verified: a0254f6
suite: "587 passed / 22 files (run once by the verifier, 10.06s, real Postgres)"
warnings:
  - id: W1
    severity: warning
    area: app/services/reminders.server.ts retriableRow()
    summary: "A retriable FAILED row on a LOWER-severity touchpoint is still re-claimed after a MORE-severe touchpoint on the same schedule was already SENT — the lower moment is chased late (>=25h after the higher one). Not a duplicate of any moment, but contradicts the 'most-severe-only, never late' rule. No spec covers it."
  - id: W2
    severity: warning
    area: app/services/reminders.server.ts sendReminder() / ledger.server.ts graphqlJson()
    summary: "Every top-level GraphQL errors[] response is treated as a parsed, definitively-not-sent refusal (retriable FAILED/REFUSED). That is correct for ACCESS_DENIED/THROTTLED/validation errors, but a 200-with-errors[] INTERNAL_SERVER_ERROR on a mutation is ambiguous; and graphqlJson throws before looking at data, so a partial response carrying success:true would also be retried. Damage is bounded by Shopify's per-order 24h limit plus the 25h backoff (worst case: one extra reminder a day later), but the narrowing is broader than its justification."
  - id: W3
    severity: warning
    area: app/routes/app.settings.tsx copy + README.md
    summary: "Merchant-facing copy says 'Each unpaid invoice is chased at three moments' but eligibility is company-attributed orders only (deliberate v1 choice, 05-03). README's Payment reminders section does not state the limitation either; it lives only in the engine JSDoc and 05-03 artifacts."
  - id: W4
    severity: warning
    area: .planning/WINDOWS.md
    summary: "#14, #15, #16 are status fixed with an EMPTY reason in both the table and the JSON — 'fixed on evidence' is not auditable from the ledger. #17's markdown table row still shows the superseded 'CORRECTION ... Re-opened' text while the JSON (the parsed source of truth) carries the PDF evidence — the two representations disagree."
  - id: W5
    severity: info
    area: 05-02-SUMMARY.md
    summary: "N3 ('dev store delivers no customer-facing email') is superseded by 05-05 ('delayed and variable') but is not annotated in place; a reader of 05-02 alone gets the wrong conclusion."
  - id: W6
    severity: info
    area: ROADMAP.md
    summary: "Every phase carries 'Mode: mvp' but no phase goal is a user story; user-story.validate rejects the Phase 5 goal. Verified goal-backward against the outcome goal per orchestrator instruction; the label is a roadmap-wide inconsistency, not a Phase 5 defect."
  - id: W7
    severity: info
    area: live dev-store state
    summary: "The six live SENT rows carry injected-now sentAt values in the future (2026-09-15 / 2026-09-18). If reminders are re-enabled on credit-guard-demo before 2026-09-19, the per-order 24h guard will hold those six orders as 'chased' until then. Dev-store-only artefact of the injected-now technique; harmless, but will puzzle a future drive."
  - id: W8
    severity: info
    area: .planning/REQUIREMENTS.md
    summary: "REMD-01..03 traceability rows still read 'Pending' at a0254f6 — orchestrator bookkeeping."
human_verification:
  - test: "Complete a payment through a reminder's Pay now link on a store with a payment gateway (WINDOWS #18)"
    expected: "The checkout reached from the delivered reminder accepts payment and the schedule's completedAt lands via webhook, after which no further reminder is logged for it"
    why_human: "The dev store's checkout reads 'This store can't accept payments right now.'; completion is unreachable by construction and only a human on a gateway-enabled store can finish it"
  - test: "Confirm normal-latency delivery and the merchant's sender/branding on a paid-plan store with a verified sender domain (WINDOWS #19)"
    expected: "Reminder arrives within minutes, from the merchant's own sender, using the merchant's Payment reminder template"
    why_human: "Dev-store delivery was 3.5h-5h delayed; latency and sender identity are only observable in a real inbox"
  - test: "Open one delivered OVERDUE (past-due) reminder and read its headline"
    expected: "Reads as 'N days overdue' (or the merchant's customised equivalent), not as a pre-due message"
    why_human: "05-05 recorded #1014's past-due reminder as RECEIPT ONLY — the body was never inspected; DUE_SOON wording was read (PDF) but OVERDUE wording was not"
---

# Phase 5: Payment Reminders — Verification Report

**Phase Goal:** Merchants' net-terms customers are automatically chased at the right moments, exactly once per moment, and never after paying
**Verified:** 2026-08-21T15:08:58Z at `a0254f6` on `main` (PR #3 merged)
**Status:** human_needed
**Verdict:** ACHIEVED_WITH_GAPS — the engine does what the goal says, proven by a 587-spec suite I ran and by live rows I re-read from production; the gaps are one edge-case in retry selection (W1), one over-broad failure classification (W2), merchant-facing copy that overstates eligibility (W3), and ledger hygiene (W4). None is a must-have failure. Three pre-launch items remain human-only by construction.
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1: reminders at due-3d, due date, once overdue; each touchpoint at most once | ✓ VERIFIED | `TOUCHPOINT_OFFSET_MS` = -72h/0/+72h; `@@unique([shop, scheduleGid, touchpoint])` in migration `20260820123230`; `claimTouchpoint` INSERT precedes `sendReminder` in `attemptSend`. Specs: "sends the most severe moment once", "the claim IS the idempotence (P2002)", "sends exactly once when two passes race" (both fresh and re-claim). Live: LP-2 one row / one timeline event, LP-3 zero new rows on identical re-drive; I re-read 6 SENT rows, attempts=1 each, one per (schedule, touchpoint). |
| 2 | SC-2: reminders stop as soon as the schedule is paid | ✓ VERIFIED | Three layers in code order: `eligibleSchedules` filters `completedAt: null`; `deriveTouchpoints` returns [] on completedAt; `attemptSend` calls `refetchSchedule` BEFORE `sendReminder` and flips to SUPPRESSED_PAID on live completedAt; Shopify's measured "already completed" refusal classified SUPPRESSED_PAID. Spec "refetches BEFORE it sends, every time" asserts call order `[REFETCH, SEND]`. Ingest: `ledger.server.ts:753 completedAt: toDate(schedule.completedAt)` in the upsert; LP-4 proved webhook ingest landed completedAt and the paid schedule wrote nothing at its next instant. Residual window (payment between refetch and mutation) is acknowledged in code and backstopped by Shopify's own E3 check. |
| 3 | SC-3 / REMD-03: every reminder goes through Shopify's notification infrastructure with merchant sender/branding and Shopify's canonical pay-now link; app never handles a customer address | ✓ VERIFIED (structural) + human evidence recorded honestly | `SEND_REMINDER_MUTATION` is `paymentReminderSend(paymentScheduleId)` returning only `success userErrors`; no email/customer/contact field in any document (source guard spec). LP-2/LP-4: all 6 SENT rows have `payment_reminder_sent` timeline events attributed to the app with recipient fingerprint == order confirmation fingerprint (same probe run). Inbox: #1015 PDF-evidenced (sender, pre-due wording, Pay now → checkout naming the invoice) recorded as `human_judgment: true`; #1014 receipt-only, body uninspected, recorded as such. Not laundered into automated status. |
| 4 | REMD-02: reminder carries a pay-now link to the payment page | ✓ VERIFIED (click-through) / payment completion human-only | LP-5a: `additionalPaymentCollectionUrl` present, well-formed, 302 in-container. LP-5b: human clicked Pay now in the delivered #1015 email, landed on checkout "Acme Supply / The Complete Snowboard / Total due USD $664.95" (PDF). LP-5c completion: NOT DONE, store cannot accept payments — WINDOWS #18 open. |
| 5 | Exactly-once under the failure taxonomy: claim-then-send; SENT only on success===true + empty userErrors; transport failure after issue → terminal SENT_UNCONFIRMED; orphaned SENDING terminal; attempts spent only at the mark; conditional re-claim | ✓ VERIFIED | `classifySendResponse` branches on userErrors content first, then `success === true`; empty-userErrors + success null/false → FAILED/REFUSED (trap specs). `sendReminder` non-`LedgerGraphqlError` throw → SENT_UNCONFIRMED with `sentAt` stamped so the N1 guard holds the slot. `retriableRow` only returns status FAILED, so SENDING/SENT_UNCONFIRMED/DEAD/SUPPRESSED_* are never re-taken; `selectEligible` skips any logged touchpoint. `claimTouchpoint`/`reclaimFailed` do not touch `attempts`; `markSent`/`markFailed`/SENT_UNCONFIRMED branch do. `reclaimFailed` is `updateMany` with `status=FAILED, attempts<3, updatedAt<now-25h` and `count===1` check. Specs: SENT_UNCONFIRMED never retried, orphaned SENDING left alone, DEAD on third refusal, F-03 race. Live: cron ticks at 11:30Z and 14:30Z ran concurrently with on-demand drives and wrote nothing — the guarantee is the unique constraint + conditional update, not the lease (rule 2 in the file header). See W1/W2 for the two edges. |
| 6 | N1 per-order 24h guard: one send per ORDER per sweep; skip if SENT/SENT_UNCONFIRMED within 25h; RATE_LIMITED retriable without consuming attempts | ✓ VERIFIED | `ordersChasedRecently` keys on `orderGid`, uses `sentAt >= now - PER_ORDER_GUARD_MS` (25h) against the injected `now`; `chasedOrderGids.add` after each issued send; RATE_LIMITED → `consumesAttempt: false`, `markFailed` adds 0. Specs: "only ONE schedule of a multi-schedule order per sweep", "20h ago skipped / 25h proceeds", "keys on ORDER not company", "SENT_UNCONFIRMED counts", "never spends an attempt on RATE_LIMITED". |
| 7 | Touchpoint math strict-crossed, ms instants, no timezone; watermark-first precedence; most-severe-only deterministic | ✓ VERIFIED | `instant.getTime() >= now.getTime() → continue` (equality not crossed); `instant < enabledAt → SUPPRESSED_PREEXISTING` evaluated before severity reduce; STALE only for post-watermark outranked. No Date-locale/calendar code in module. Specs at ±1ms boundaries for all three, F-02 precedence spec. |
| 8 | Re-enable stamps a NEW watermark; pause period accumulates nothing | ✓ VERIFIED | `app.settings.tsx:332` `remindersEnabledAt = intent === ENABLE ? new Date() : null` on every enable; instants crossed during the off period are `< new enabledAt` → SUPPRESSED_PREEXISTING at first encounter. Page copy line 150 says so plainly. |
| 9 | Default OFF for every shop; toggle is the only writer; unknown intent → 400 | ✓ VERIFIED | Column nullable with no default in migration; `sweepShop` returns on null before any query; only `db.shop.update` in the settings action writes it (grep: no other writer); settings specs for 400 on unknown/missing intent; probe confirms `remindersEnabled: 0` live. |
| 10 | Company-only eligibility is an explicit, documented product choice with live zero-rows proof | ✓ VERIFIED (as v1 limitation, not a gap) | `eligibleSchedules` JSDoc "COMPANY-ONLY IS A PRODUCT CHOICE, NOT A PLATFORM LIMIT" with E4 citation; filter `attributionStatus ATTRIBUTED, companyId not null`. 05-05 coverage `company-only`: #1013 (gid 7081002598633) 0 rows across four drives. Documentation reach is incomplete for merchants — see W3. |
| 11 | Send cap 50 with DEFERRED re-derivation; redactShop wipes ReminderLog; no Company.* writes from the sweep | ✓ VERIFIED | `SEND_CAP_PER_SWEEP`, DEFERRED deleteMany at sweep start; `shop-lifecycle.server.ts:69 reminderLog.deleteMany`; no `db.company` reference in reminders.server.ts. Cap spec passes. |
| 12 | Scheduler: own lease `reminder-sweep`, cron `30 * * * *`, noOverlap, existing entries untouched | ✓ VERIFIED | `scheduler.server.ts:365 run: reminderSweep`; test asserts lease/cron by value; live leases show `reminder-sweep` held at 14:30:00.181Z. (The `verify.artifacts` "Missing pattern: reminder-sweep" on scheduler.server.ts is a tooling false-positive — the lease is referenced via the `REMINDER_SWEEP_LEASE` constant.) |
| 13 | Scope string identical in all lockstep homes + Railway; write_orders live | ✓ VERIFIED | `shopify.app.toml:61` exact seven-scope string; `tests/scope-lockstep.test.ts` asserts toml and `process.env.SCOPES`; live sends succeeded (write_orders-gated). |
| 14 | PRIVACY.md §2 lists all seven scopes with real reasons; §3 "no customer PII" still true; reminder disclosure present | ✓ VERIFIED | Lines 38-44: seven rows with accurate purposes (write_orders: "Ask Shopify to send its own payment-reminder email ... does not create, edit, cancel or refund orders"). §"Payment reminders — Shopify sends them, not us" (l.50-70). §3 l.89-91 discloses reminder records (identifiers + moment + status only); l.110-115 keeps the no-customer-email claim and explains why. Consistent with `ReminderLog` columns (no address, `failureReason` is a token). |
| 15 | Suite green at the claimed size; scheduler-test leak fix present; two additive migrations | ✓ VERIFIED | I ran codegen + `vitest run`: 587/587, 22 files. `tests/scheduler.test.ts:158 afterAll(...)`. Migrations: one `ADD COLUMN` (nullable) + `CREATE TABLE` + indexes; second: one nullable `ADD COLUMN`. No drop/rename/retype. Both applied by name in production (`_prisma_migrations` via probe). |
| 16 | Live evidence honesty (LP-1..LP-5, human items) and the self-correction record | ✓ VERIFIED | 05-05 frontmatter separates `human_judgment: false` (LP-1..4, LP-5a, attribution, company-only) from `human_judgment: true` (LP-5b, LP-5c unknown, E2-copy, E1-receipt receipt-only, sender-branding). Deviation 5 records the asserted-then-over-corrected pay-now detail and its restoration with the PDF evidence; matches WINDOWS #17 JSON reason. Live state I re-read matches the SUMMARY exactly: 12 rows, 6 SENT / 6 SUPPRESSED_PREEXISTING, reminders OFF, Northwind limit 800.00 / exposure 899.90 (over-limit fixture restored). |
| 17 | No new npm packages; no PII fields; variables-only GraphQL; committed probes read-only | ✓ VERIFIED | `package.json` last changed 2026-08-19 (Phase 2). Source-guard specs for PII/interpolation pass; `prod-reminder-recipients.mjs` contains no mutation (address → salted sha256 12-hex fingerprint, never printed). |

**Score:** 17/17 truths verified (0 present-but-behavior-unverified — every state-transition truth has a passing named spec in the suite run, and the claim/refetch/concurrency invariants additionally have live evidence).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/services/reminders.server.ts` | pure core + full sweep composition | ✓ VERIFIED | 1191 lines; exports `reminderSweep, deriveTouchpoints, selectEligible, classifySendResponse, sendReminder, REMINDER_SWEEP_LEASE, REMINDER_SWEEP_CRON`; wired from scheduler + tests |
| `prisma/schema.prisma` + 2 migrations | ReminderLog, Shop.remindersEnabledAt, failureReason | ✓ VERIFIED | unique index present; additive |
| `app/services/scheduler.server.ts` | third SWEEP_SCHEDULE entry | ✓ VERIFIED | l.365 |
| `app/services/shop-lifecycle.server.ts` | reminderLog in redactShop | ✓ VERIFIED | l.69 |
| `app/routes/app.settings.tsx` | toggle + D5-05/N1/N2/template copy | ✓ VERIFIED | intents l.116-117, copy l.146-172, action l.332-358; no reminders.server import; no @shopify/polaris import |
| `tests/reminders.test.ts` | REMD-01 unit matrix | ✓ VERIFIED | 1398 lines, 13 describe blocks incl. races, taxonomy, N1, cap, cross-shop |
| `tests/settings-messages.test.ts` | intents + 400 | ✓ VERIFIED | l.496-517 |
| `scripts/prod-reminder-state.{mjs,sh}`, `prod-reminder-recipients.{mjs,sh}` | read-only probes | ✓ VERIFIED | executed by me; read-only by inspection |
| `PRIVACY.md` | 7 scopes + disclosure | ✓ VERIFIED | see truth 14 |
| `README.md` | reminders section + tooling | ✓ VERIFIED (W3: no company-only note) | §Payment reminders l.508+, tooling l.320-390 |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| scheduler.server.ts | reminders.server.ts | `run: reminderSweep` | WIRED |
| reminders.server.ts | ledger.server.ts | `graphqlJson` (SendReminder / ScheduleRefetch) — only admin path | WIRED |
| reminders.server.ts | LedgerSchedule | indexed `[shop, dueAt]` query with completedAt/cancelled/terms/attribution filters | WIRED |
| app.settings.tsx | Shop.remindersEnabledAt | `db.shop.update` keyed by session shop | WIRED |
| prod-reminder-state.sh / recipients.sh | live rows + timeline | executed by the verifier; outputs match SUMMARY | WIRED (tooling's `verify.key-links` rejects the two-path `from:` — format only) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite | `npm run graphql-codegen && DATABASE_URL=...creditguard_test npx vitest run` | 587 passed / 22 files | ✓ PASS |
| Live state | `bash scripts/prod-reminder-state.sh credit-guard-demo.myshopify.com` | reminders OFF, both migrations, 12 rows (6 SENT / 6 SUPPRESSED_PREEXISTING), `reminder-sweep` lease present | ✓ PASS |
| Fixture restore | `bash scripts/prod-validation-state.sh ...` | Northwind limit 800.00, exposure 899.90 | ✓ PASS |
| WINDOWS ledger parses | `parseLedger(...)` | 19 entries, open 8, fixed 10, waived 1 | ✓ PASS (content issues → W4) |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention in this repo; the phase's probes are the two read-only state scripts above, both executed with exit 0.

### Requirements Coverage

| Requirement | Plans | Status | Evidence |
|-------------|-------|--------|----------|
| REMD-01 | 01, 02, 03, 04, 05 | ✓ SATISFIED | Truths 1, 2, 5-9, 11, 12; LP-1..LP-4 live |
| REMD-02 | 02, 05 | ✓ SATISFIED (click-through) / completion human-only | Truth 4; #18 open by construction |
| REMD-03 | 01, 02, 05 | ✓ SATISFIED | Truth 3, 14; attribution + fingerprint evidence; inbox sender/branding human-confirmed once (#1015) |

No orphaned requirements: REQUIREMENTS.md maps exactly REMD-01..03 to Phase 5. (W8: rows still say "Pending".)

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| app/services/reminders.server.ts | 924-944 (`retriableRow`) | retry selection ignores a SENT sibling of higher severity | ⚠️ Warning (W1) | a lower moment can be chased late after the higher one went out; no duplicate of any single moment; bounded by N1 |
| app/services/reminders.server.ts | 548-565 (`sendReminder`) | all `LedgerGraphqlError` → retriable | ⚠️ Warning (W2) | an ambiguous INTERNAL_SERVER_ERROR-with-errors[] is retried after 25h; consider keying on `extensions.code` |
| app/routes/app.settings.tsx | 146 | "Each unpaid invoice is chased" | ⚠️ Warning (W3) | overstates company-only coverage to merchants |
| — | — | TBD/FIXME/XXX/HACK/PLACEHOLDER | none found | — |

### Human Verification Required

1. **Pay-now payment completion (WINDOWS #18)** — on a gateway-enabled store, click Pay now in a delivered reminder and pay. Expected: payment completes, completedAt lands by webhook, no further ReminderLog row for that schedule. Why human: dev store cannot accept payments.
2. **Delivery latency + sender/branding on a paid-plan store (WINDOWS #19)** — send one reminder, confirm arrival within minutes from the merchant's sender using their template. Why human: only observable in a real inbox; dev store delivery was 3.5-5h delayed.
3. **OVERDUE wording** — open a delivered past-due reminder and read the headline. Why human: #1014 was confirmed received but its body was never inspected; only the DUE_SOON body (#1015) was read.

### Gaps Summary

No must-have truth failed. The goal — right moments, exactly once per moment, never after paying — is implemented with the claim-then-send / live-refetch / watermark discipline the plans specified, every invariant has a named passing spec, and the live drives I re-read from production agree with the SUMMARY row for row. The verdict is ACHIEVED_WITH_GAPS rather than ACHIEVED because of four non-blocking findings that a follow-up should close:

- **W1** — `retriableRow` should refuse a FAILED row whose touchpoint is outranked by a SENT/SENT_UNCONFIRMED sibling (mark it SUPPRESSED_STALE instead), with a spec "does not retry DUE_SOON after DUE was sent".
- **W2** — in `sendReminder`, inspect `error.errors[].extensions.code`: THROTTLED / ACCESS_DENIED / parse-validation → retriable; anything else → SENT_UNCONFIRMED. Also consider having `graphqlJson` callers see `data` when both `data` and `errors` are present.
- **W3** — settings copy: "Each unpaid invoice for a company you manage here is chased..."; README reminders section: one line on company-only eligibility and the v2 pointer.
- **W4** — WINDOWS #14-#16 need their evidence written into `reason` (05-05 holds it: #1015 PDF, #1014 receipt, DUE_SOON wording); regenerate the markdown table for #17 so it matches the JSON.

Informational: W5 (annotate 05-02 N3 as superseded), W6 (roadmap-wide `Mode: mvp` label vs non-user-story goals), W7 (future `sentAt` rows on the dev store), W8 (REQUIREMENTS.md rows still Pending).

---

_Verified: 2026-08-21T15:08:58Z_
_Verifier: Claude (gsd-verifier)_
