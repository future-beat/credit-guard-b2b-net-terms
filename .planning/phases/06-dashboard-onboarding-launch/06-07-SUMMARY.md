---
phase: 06-dashboard-onboarding-launch
plan: 07
subsystem: verification
tags: [live-drive, dashboard, onboarding, enforcement, reviews-api, billing-gate, windows-closure]

requires:
  - "The 06-06 release running on Railway (deployment 93a3ace2, image sha256:315b1cef…)"
  - "A subscribed credit-guard-demo ($0 contract, E-1)"
provides:
  - "Live proof of DASH-01/02/03 and LNCH-02 on the real store, each human observation paired with a probe read"
  - "WINDOWS #13 closed: the overdue-only credit hold refused a real net-terms checkout"
  - "WINDOWS #8 live-verified in the real log store"
  - "The verbatim page text that keeps WINDOWS #18 open by design"
  - "06-LISTING.md §8 — what the drive changed for the screenshots, the screencast and the reviewer notes"
affects: [06-08]

actuals:
  tokens: 4100
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Every human observation is paired with a probe read AND an access-log line, so the claim, the database and the request trail have to agree before it counts as evidence"
    - "A fixture mutation made for a test is restored in the same session and the restoration is proved by the same probe that proved the mutation"

key-files:
  created:
    - .planning/phases/06-dashboard-onboarding-launch/06-07-SUMMARY.md
  modified:
    - .planning/phases/06-dashboard-onboarding-launch/06-LISTING.md

key-decisions:
  - "E-5 was NOT forced. With the Bogus Gateway active the pay-now page still refuses, so the exact text was recorded and #18 stays open by design rather than being closed by a workaround"
  - "The S1 hero screenshot moves to a second development store rather than resetting production onboarding stamps for a cosmetic reason"
  - "The mobile spacing defect is reported, not fixed — this plan forbids code changes, and a fix belongs on the branch before 06-08's screenshots"
  - "E-2 could only be observed retrospectively: the prompt had already fired at 07:16:54Z, ~2 minutes after the deploy. The honest reading is the developer's recollection plus the stamp plus the POST in the access log, not a re-staged modal"
  - "REQUIREMENTS.md was not mutated — LNCH-03 is not deliverable until 06-08 submits, and this phase has been marking requirements centrally (LNCH-01 is still Pending after 06-06)"

patterns-established:
  - "Pattern: probe → human action → probe, with the access log as the third witness. The request timeline reconstructs the drive independently of what anyone remembers"

requirements-completed: [DASH-01, DASH-02, DASH-03, LNCH-02]

coverage:
  - id: D1
    description: "LNCH-01 gate live — the subscribed demo store lands on the dashboard, not on a plan page"
    requirement: "LNCH-01"
    verification:
      - kind: integration
        ref: "scripts/prod-billing-state.sh credit-guard-demo.myshopify.com -> wouldPassGate: true (Credit Guard ACTIVE, 0.0 USD/EVERY_30_DAYS, test false, trialDays 14), run 2026-08-22T07:35Z against the live build"
        status: pass
      - kind: manual_procedural
        ref: "human live drive 2026-08-22: opened Apps -> Credit Guard, landed on the dashboard; no pricing/plan page; Railway log GET /app 200 at 07:55:16Z"
        status: pass
    human_judgment: true
    rationale: "The probe proves billing.check() would pass; that the browser actually landed on the dashboard was read by the developer."
  - id: D2
    description: "DASH-01/02 live — the dashboard's numbers match the ledger and the Companies page on real data"
    requirement: "DASH-01"
    verification:
      - kind: integration
        ref: "scripts/prod-ledger-state.sh -> exposures Acme 5345.80 / Northwind 899.90 / Snowdevil 1377.40 (sum 7623.10), overdue 2, blockedState 1; predicted K1-K4 before the drive and the rendered dashboard matched every value"
        status: pass
      - kind: manual_procedural
        ref: "human live drive + desktop PDF export 2026-08-22: K1 $7,623.10 '· incomplete', K2 2, K3 1, K4 '—'; overdue table, 30-day table (6 rows, #1013 correctly absent), Closest to limit 112%, credit-holds feed, reminders-off notice; no raw gids"
        status: pass
    human_judgment: true
    rationale: "Rendering fidelity — badges, wording, absent rows, no raw gids — is read off a screen. The numbers behind it are probe-verified."
  - id: D3
    description: "LNCH-02 / E-2 — the Reviews API prompt fires once off a genuine success moment and never re-asks"
    requirement: "LNCH-02"
    verification:
      - kind: integration
        ref: "prod-ledger-state -> reviewPromptedAt 2026-08-22T07:16:54.072Z (was null before the deploy); Railway log GET /app 200 07:16:21Z followed by POST /app.data?index 200 — the only stamping intent available, both onboarding stamps still null at that instant"
        status: pass
      - kind: manual_procedural
        ref: "developer: Shopify's rating modal appeared on the first post-deploy open (~07:17Z) and a 5-star review was submitted; no modal on any later open (desktop 07:55Z / 08:01Z, phone 08:07-08:08Z — three GET /app with no POST)"
        status: pass
    human_judgment: true
    rationale: "The result code Shopify returned is not persisted (only the timestamp), so 'the modal appeared' rests on the developer's account; the stamp and the POST corroborate that Shopify evaluated the ask."
  - id: D4
    description: "DASH-03 live — the guided setup stamps, reads step 2/3 from live state, and does not come back after Done"
    requirement: "DASH-03"
    verification:
      - kind: integration
        ref: "prod-ledger-state -> onboardingReviewedAt 2026-08-22T07:55:33.432Z, onboardingDismissedAt 2026-08-22T07:56:08.628Z; Railway log POST /app.data?index 200 at 07:55:36Z and 07:56:16Z (mark-reviewed, dismiss-onboarding); later loads at 08:01Z and 08:07Z render without the section"
        status: pass
      - kind: manual_procedural
        ref: "developer: completed step 1 ('Looks right'), step 2 already complete, step 3 read 'Enforcement is on', progress reached 'All set', 'Done' removed the section and a reload did not bring it back"
        status: pass
    human_judgment: true
    rationale: "Reported as done without the toast strings transcribed, so the exact toast copy ('Balances marked as reviewed' / 'Setup complete') is unverified; the stamps and POSTs prove both mutations landed."
  - id: D5
    description: "WINDOWS #13 — a company OVERDUE but UNDER its credit limit is refused at a real net-terms checkout with the overdue message"
    verification:
      - kind: integration
        ref: "scripts/prod-enforcement-events.sh -> BLOCK_STATE_ENTERED Acme Supply 2026-08-22T07:56:59.388Z with overdue:true, exposure 5345.80, limit 6000.00, bypass:false — the first overdue-driven hold in the store's history (the other 6 events are all Northwind, overdue:false)"
        status: pass
      - kind: manual_procedural
        ref: "developer, logged in as Acme's company contact: net-terms checkout refused with the shipped overdue message verbatim ('Your account has overdue invoices. New orders on payment terms are paused until the balance is settled — please contact us to arrange payment.')"
        status: pass
    human_judgment: true
    rationale: "The Function's refusal is not webhooked (D4-03), so the buyer-side message can only be read by a human at a real checkout; the server-side state transition is probe-proven."
  - id: D6
    description: "Fixture restoration — Acme back to limit null / bypass ON, reminders still off, gateway deactivated, no residue"
    verification:
      - kind: integration
        ref: "prod-enforcement-events -> BLOCK_STATE_EXITED 08:01:40.848Z then BYPASS_ENABLED 08:01:43.099Z; prod-ledger-state -> Acme creditLimit null, bypassEnforcement true, dirty false, publishedAt 08:01:43.316Z, dirtyPublishes 0"
        status: pass
      - kind: integration
        ref: "prod-reminder-state -> remindersEnabledAt null, reminderRowCount 12 (6 SENT / 6 SUPPRESSED_PREEXISTING) — unchanged across the drive; git status --porcelain empty"
        status: pass
    human_judgment: false
  - id: D7
    description: "WINDOWS #8 live — no JWT fragment reaches the Railway log store"
    verification:
      - kind: command
        ref: "railway logs --service credit-guard-app --lines 400 | grep -c 'id_token=' -> 17, all reading id_token=[redacted]; grep -Ec 'id_token=eyJ' -> 0; grep -Ec 'hmac=[A-Za-z0-9]' -> 0; grep -Ec 'session=[A-Za-z0-9]' -> 0 (run after the drive's own embedded requests)"
        status: pass
    human_judgment: false
  - id: D8
    description: "E-5 / WINDOWS #18 — completing a payment schedule from a reminder's pay-now link"
    verification:
      - kind: manual_procedural
        ref: "developer, with '(for testing) Bogus Gateway' activated: the #1015 order-payment page answers 'This store can't accept payments right now.' verbatim; no payment was attempted past that point; gateway deactivated afterwards"
        status: fail
      - kind: integration
        ref: "prod-reminder-state -> #1015 (gid://shopify/PaymentSchedule/47678062825) still OPEN, financialStatus PENDING, balanceDue 664.95 USD; no orders/paid webhook in the access log; Acme exposure unchanged at 5345.80"
        status: fail
    human_judgment: true
    rationale: "BLOCKED, open by design. A development store's order-payment page refuses even with Shopify's own test gateway, so the paid-off path is not demonstrable here; #18/#19 stay open for a launch store with a real gateway (RESEARCH Gray Area 5)."
  - id: D9
    description: "UI-SPEC responsive backstop — the dashboard on a phone"
    verification:
      - kind: manual_procedural
        ref: "developer + phone screenshot 2026-08-22: single column, no horizontal scrolling, money values intact, no review modal"
        status: pass
      - kind: manual_procedural
        ref: "DEFECT in the same screenshot: the KPI grid's second row ('On credit hold' / 'Due in 7 days') has no vertical gap beneath it — the tiles butt directly against the 'Overdue companies' section. First-row spacing is correct and desktop is unaffected"
        status: fail
    human_judgment: true
    rationale: "Visual spacing at a narrow viewport; no automated check asserts it. Reported for a fix before 06-08's screenshots, per this plan's no-code-changes prohibition."
  - id: D10
    description: "06-LISTING.md §8 — the four live facts that change what can be photographed, narrated or promised"
    requirement: "LNCH-03"
    verification:
      - kind: other
        ref: "grep -c read_all_orders -> 3 and grep -ci 'blocked $' -> 0 still hold after the edit; §8 table + S1 second-store recommendation + beat 6 verbatim message + §4.0 item 6 payment prohibition present"
        status: pass
    human_judgment: true
    rationale: "Whether the listing passes a Shopify reviewer remains a judgment no command can make; it has not been submitted."
  - id: D11
    description: "WINDOWS #10 — the reconciliation exhaustion flip"
    verification:
      - kind: integration
        ref: "prod-ledger-state 2026-08-22T08:2xZ -> dataComplete false, attribution {attributed 14, unresolved 2, noCompany 0} — unchanged since 06-06 banked it; the next 03:30Z cron (2026-08-23) is the first tick on the fixed code"
        status: unknown
    human_judgment: true
    rationale: "Cross-reference only. 06-06 owns this item; by orchestrator decision the live proof is deferred to the unattended cron and no in-container drive was attempted here."

duration: 57 min
completed: 2026-08-22
status: complete
---

# Phase 6 Plan 7: Live Drive on credit-guard-demo Summary

**The whole Phase 6 build was driven on the real store and it held: the gate landed the subscribed merchant on a dashboard whose every number matched the ledger, the guided setup stamped and stayed gone, and — for the first time in the store's history — a company that was overdue but comfortably *under* its credit limit had a real net-terms checkout refused with the overdue message, closing WINDOWS #13. Two things did not go the plan's way: a development store still cannot take a payment even with Shopify's own test gateway (#18 stays open, with the refusal quoted), and the phone layout loses a row gap under the KPI tiles.**

## Performance

- **Duration:** 57 min (2026-08-22T07:32Z → 08:29Z), spanning one clustered human session
- **Tasks:** 2 (1 human checkpoint, 1 executor evidence bundle)
- **Files modified:** 1 (`06-LISTING.md`) + this SUMMARY

## Accomplishments

- **WINDOWS #13 is closed on live evidence, not inference.** `BLOCK_STATE_ENTERED` for Acme Supply at `07:56:59.388Z` with `overdue: true`, `exposure 5345.80`, `limit 6000.00`, `bypass false` — the first event in this store's log where overdueness alone did the blocking. The buyer saw the shipped overdue message verbatim at a real checkout.
- **The dashboard was predicted before it was opened.** Every KPI and table was computed from the probes first; the rendered page matched all of it, including the two values most likely to be misread as bugs (`K4 "—"` and the "Some balances may be incomplete" banner).
- **The review moment is proven end to end and proven *not* to nag.** It fired once at `07:16:54Z` off a genuine success moment; three later app opens — two desktop, one phone — produced `GET /app` with no follow-up POST.
- **#8 verified in the real log store:** 17 `id_token=` occurrences, all `[redacted]`, zero raw JWTs, and `hmac`/`session` scrubbed alongside.
- **Every fixture the drive touched was put back**, and the restoration was proved by the same probes that proved the mutation, including the metafield republish (`dirtyPublishes: 0`).
- **The listing now knows what the drive found** — §8 records the four facts that change what can be shot, narrated or promised.

## Task Commits

1. **Task 1: live drive on credit-guard-demo** — human checkpoint, no commit
2. **Task 2: evidence bundle + listing live facts** — `e68e000` (docs)

## Evidence

### The request timeline — the third witness

Reconstructed from `railway logs --json`, independent of anyone's memory:

| Time (UTC) | Request | What it was |
|---|---|---|
| 07:16:21 | `GET /app 200` | first post-deploy open |
| 07:17:00 | `POST /app.data?index 200` | **review-prompt-result** — the only stamping intent available then |
| 07:55:16 | `GET /app 200` | the drive begins |
| 07:55:36 | `POST /app.data?index 200` | **mark-reviewed** (stamp 07:55:33.432Z) |
| 07:56:16 | `POST /app.data?index 200` | **dismiss-onboarding** (stamp 07:56:08.628Z) |
| 07:56:43 | `POST /app/companies.data 200` | bypass OFF → `BYPASS_DISABLED` 07:56:43.388Z |
| 07:56:59 | `POST /app/companies.data 200` | limit 6000 → **`BLOCK_STATE_ENTERED`** 07:56:59.388Z |
| 07:57:01 | `POST /webhooks/companies 200` | the credit metafield republish echoing back |
| 08:01:47 | `POST /app/companies.data 200` ×2 | limit cleared + bypass ON → `BLOCK_STATE_EXITED` 08:01:40.848Z, `BYPASS_ENABLED` 08:01:43.099Z |
| 08:07–08:08 | `GET /app 200` ×3 | the phone opens — **no POST**, so no re-ask |

No app request corresponds to the refused checkout, and none should: the validation Function runs on Shopify's infrastructure and is not webhooked (D4-03). The block is proven by the state transition plus the human's reading of the buyer's screen.

### 1. Gate + dashboard (LNCH-01, DASH-01/02)

`wouldPassGate: true`. The developer landed on the dashboard, not a plan page. Predicted vs. observed:

| | Predicted from probes | Observed |
|---|---|---|
| K1 Total outstanding | $7,623.10 · incomplete | ✅ identical |
| K2 Overdue companies | 2 | ✅ |
| K3 On credit hold | 1 | ✅ |
| K4 Due in 7 days | "—" (every open schedule is past due or in September) | ✅ |
| Overdue table | Acme $5,345.80 / Aug 14; Snowdevil $1,377.40 / Aug 14 | ✅ with badges `Overdue` + `Enforcement bypassed` on Acme |
| Due in the next 30 days | #1005, #1008, #1009, #1010, #1011, #1015 | ✅ — and **#1013 absent**, the company-less order correctly excluded |
| Closest to limit | Northwind 899.90 / 800.00 = 112% | ✅ |
| Banner | "Some balances may be incomplete" | ✅ (expected — `dataComplete` false until the 03:30Z cron) |

No raw GIDs anywhere. Nav reads `Credit Guard: B2B Net…` + Companies + Settings.

### 2. E-2 — the review moment (LNCH-02)

`reviewPromptedAt` was `null` at hand-off and is **`2026-08-22T07:16:54.072Z`** now — stamped ~2 minutes after the deploy, on an app open that predates this plan. The developer confirms Shopify's rating modal appeared on that open and that a 5-star review was submitted (dev-store reviews are unpublished). Every later open — twice on desktop, once on the phone — produced no POST, i.e. no second ask.

**An honesty note.** The code Shopify returned is not persisted; `recordReviewPromptResult` writes only a timestamp. So the database can prove *asked and evaluated*, and cannot prove *shown*. That the modal was rendered rests on the developer's account. See Finding F2.

### 3. Guided setup (DASH-03)

Both stamps landed, 35 seconds apart, and the section has not rendered since:

| Stamp | Value |
|---|---|
| `onboardingReviewedAt` | `2026-08-22T07:55:33.432Z` |
| `onboardingDismissedAt` | `2026-08-22T07:56:08.628Z` |

Step 2 read complete from the existing limits and step 3 read "Enforcement is on" from the live `gid://shopify/Validation/134447337`, exactly as specified. The toast strings were not transcribed during the drive — recorded as a judgment pass rather than a copy verification.

### 4. WINDOWS #13 — the overdue-only credit hold (**CLOSED**)

Before the drive, all six enforcement events in the store's history were Northwind's, every one with `overdue: false`. The overdue message had never been seen by a buyer. The drive produced four new events:

| Time (UTC) | Kind | Company | Exposure | Limit | Overdue | Bypass |
|---|---|---|---|---|---|---|
| 07:56:43.388 | `BYPASS_DISABLED` | Acme Supply | 5345.80 | null | true | true→false |
| **07:56:59.388** | **`BLOCK_STATE_ENTERED`** | **Acme Supply** | **5345.80** | **6000.00** | **true** | **false** |
| 08:01:40.848 | `BLOCK_STATE_EXITED` | Acme Supply | 5345.80 | null | true | false |
| 08:01:43.099 | `BYPASS_ENABLED` | Acme Supply | 5345.80 | null | true | true |

`5345.80 < 6000.00`, so over-limit cannot explain the hold — this is `isBlockedState`'s `if (state.overdue) return true;` arm firing in production for the first time. The buyer's screen read, verbatim:

> Your account has overdue invoices. New orders on payment terms are paused until the balance is settled — please contact us to arrange payment.

That is `DEFAULT_MESSAGES.overdue` from `app/services/enforcement.server.ts:308` character for character, delivered through the metafield the Function reads.

**Restored.** Acme is back to `creditLimit: null`, `bypassEnforcement: true`, `blockedState: false`, `dirty: false`, republished at `08:01:43.316Z`, `dirtyPublishes: 0`.

### 5. E-5 — the pay-now completion (**BLOCKED — WINDOWS #18 stays open**)

With "(for testing) Bogus Gateway" activated on the store, the #1015 order-payment page answered, verbatim:

> This store can't accept payments right now.

No card was entered; there was no field to enter one into. The gateway was deactivated again. The ledger agrees that nothing happened: schedule `gid://shopify/PaymentSchedule/47678062825` is still `OPEN` / `PENDING` at `664.95 USD`, no `orders/paid` webhook appears in the log, and Acme's exposure is unmoved at `5345.80`.

**Reading.** The obstacle is not our reminder link and not the ingest path — it is that a development store's order-payment page will not transact even against Shopify's own test gateway. So #18 (and #19 behind it) stay open **by design**, to be closed on a store with a real gateway after listing approval (RESEARCH Gray Area 5). This was not forced; the refusal is quoted rather than worked around, and §4.0 of the listing now forbids any reviewer instruction or screencast beat that depends on a payment completing.

### 6. WINDOWS #8 — the access-log scrub (**live-verified**)

```
railway logs --service credit-guard-app --lines 400
  grep -c 'id_token='            -> 17
  grep -c 'id_token=\[redacted\]'-> 17
  grep -Ec 'id_token=eyJ'        -> 0
  grep -Ec 'hmac=[A-Za-z0-9]'    -> 0
  grep -Ec 'session=[A-Za-z0-9]' -> 0
```

Two scrubbed samples, exactly as they appear in the log store:

```
GET /?admin_theme=admin&embedded=1&hmac=[redacted]&host=YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvY3JlZGl0LWd1YXJkLWRlbW8&id_token=[redacted]&locale=en&session=[redacted]&shop=credit-guard-demo.myshopify.com&timestamp=1787386095 302 - - 4.3 ms
POST /app.data?index&admin_theme=admin&embedded=1&hmac=[redacted]&host=YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvY3JlZGl0LWd1YXJkLWRlbW8&id_token=[redacted]&locale=en&session=[redacted]&shop=credit-guard-demo.myshopify.com&timestamp=1787382971 200 - - 50.578 ms
```

The `host` parameter is a base64 of `admin.shopify.com/store/credit-guard-demo` — a public store identifier, not a credential.

### 7. Phone (UI-SPEC responsive backstop)

Single column, no horizontal scrolling, money values intact, no review modal. **One visual defect** — see Finding F1.

### Restoration checklist

| Item | State | Evidence |
|---|---|---|
| Acme credit limit | `null` | `prod-ledger-state` |
| Acme bypass | `ON` | `prod-ledger-state`, `BYPASS_ENABLED` event |
| Credit metafield | republished, `dirty: false`, `dirtyPublishes: 0` | `prod-ledger-state` |
| Bogus Gateway | deactivated | developer report |
| Reminders | still off, 12 ReminderLog rows unchanged | `prod-reminder-state` |
| Working tree | clean | `git status --porcelain` empty |
| Container | no probe files left (read-only committed probes only) | probes `rm` their payload by construction |

## WINDOWS closure table

| # | Item | State after this plan | Evidence |
|---|---|---|---|
| **#13** | Overdue-only credit hold never observed live | **CLOSED** | `BLOCK_STATE_ENTERED` 07:56:59.388Z, `overdue:true`, `5345.80 < 6000.00`, plus the verbatim buyer message |
| **#8** | id_token possibly logged | **CLOSED (live)** | 17/17 `[redacted]`, 0 raw JWTs in the production log store |
| **#18** | Pay-now completion unproven | **OPEN — by design** | "This store can't accept payments right now." with the test gateway active; #1015 still OPEN |
| **#19** | (behind #18) | **OPEN — by design** | same cause |
| **#10** | Reconciliation exhaustion flip unobserved | **OPEN — deferred** | `dataComplete false`, unresolved 2, unchanged; the 2026-08-23 03:30Z cron is the first tick on fixed code (06-06 owns it) |

**Ledger note for the orchestrator:** `.planning/WINDOWS.md` was deliberately not edited (executor prohibition). #13 and #8 are ready to be marked closed with the evidence above, and three new findings below are candidates for entries.

## Findings for the orchestrator (not fixed here — this plan forbids code changes)

**F1 — [defect, mobile] The KPI grid loses its row gap at narrow widths.**
On a phone, the second KPI row ("On credit hold" / "Due in 7 days") has no vertical gap beneath it; the tiles butt directly against the "Overdue companies" section. Spacing *between* the first-row tiles is correct and desktop is unaffected, so this looks like the wrapped grid row losing its gap (or the section's top spacing collapsing against it) at the narrow breakpoint. Visible in the phone screenshot. **Wanted before 06-08's screenshots** — S1 and any mobile shot would ship the defect.

**F2 — [observability gap, LNCH-02] The review prompt's result code is not persisted.**
`recordReviewPromptResult` stamps `reviewPromptedAt` and discards the code, and the code travels in a POST body so it is not in the access log either. Consequence: the app can prove it asked and that Shopify evaluated the ask, but cannot distinguish `success` from `merchant-ineligible`, `cooldown-period` or `error` after the fact — the one question a future "why was nobody asked?" investigation will need. Cheap fix (a nullable `reviewPromptResult` column, or a log line), but it is a schema change and belongs in its own plan.

**F3 — [plan artifact] 06-07's own `<verify>` command cannot pass on macOS.**
`git status --porcelain | wc -l | grep -qx 0` fails because BSD `wc -l` left-pads its output (`"       0"`), so the composite returns FAIL even when all three conditions hold. Each clause was run separately and all three PASS (see Self-Check). Any future plan should use `[ -z "$(git status --porcelain)" ]`.

## Deviations from Plan

**1. [Rule 1 - Bug] The live-drive card's fixture figures were stale by the time the drive ran**
- **Found during:** Task 1 preparation
- **Issue:** The card had Acme at `4015.90` exposure and Snowdevil clean; the hourly sweep had moved Acme to `5345.80` and made Snowdevil overdue (`1377.40`). The card's `6000` limit still cleared the exposure, so #13's design survived — but the dashboard's expected numbers would all have been wrong.
- **Fix:** Re-probed everything immediately before presenting the checkpoint and published a predicted-values table so the developer compared against live figures, not day-old ones.
- **Files modified:** none

**2. [Rule 1 - Bug] E-2's precondition was already spent**
- **Found during:** Task 1 preparation
- **Issue:** The plan and card both assumed `reviewPromptedAt` was `null`. It was stamped at `07:16:54Z`, ~2 minutes after the deploy — the prompt had already fired on an open nobody had recorded. Presenting the card verbatim would have asked the developer to watch for a modal that cannot appear, and a "no modal" report would have looked like a failure of LNCH-02 when it is the once-only guard working.
- **Fix:** Reframed step 2 as a retrospective question plus a live no-re-ask check, and used the access log to pin the ask to a specific request. Recorded the residual gap as Finding F2.
- **Files modified:** none

**3. [Rule 3 - Blocking, not worked around] E-5 could not complete**
- **Found during:** Task 1 step 5
- **Issue:** The order-payment page refuses on a development store even with the Bogus Gateway active.
- **Resolution:** Quoted verbatim, ledger-confirmed that nothing moved, #18/#19 left open by design, and the listing changed so nothing downstream depends on a payment completing. No second gateway, no forced draft-order workaround.
- **Files modified:** `06-LISTING.md` (§4.0 item 6, §8 L2)

**4. [Scope boundary] Mobile spacing defect reported, not fixed**
- **Found during:** Task 1 step 7
- **Issue:** Wrapped KPI row loses its bottom gap on a phone.
- **Resolution:** Recorded as Finding F1 with the exact symptom. The plan's prohibitions forbid code changes here, and the orchestrator will dispatch a fix before 06-08's screenshots.
- **Files modified:** none

---

**Total deviations:** 4 (2 stale-precondition bugs, 1 blocked-and-not-worked-around, 1 deliberate scope hold)
**Impact on plan:** Both tasks delivered. Six of the seven drive steps passed; the seventh (E-5) is a recorded platform limitation, and one visual defect is queued for a separate fix.

## Issues Encountered

- **E-5 is not closable on a development store.** This is now a launch-store item, not an app defect — but it means the "reminder → payment → balance drops" loop remains the one end-to-end story the app has never demonstrated on live data. #19 inherits that.
- **The demo store can no longer produce the S1 hero screenshot.** The guided setup is dismissed for good there. A second development store is the recommended answer; resetting production stamps for a screenshot was rejected.
- **`dataComplete` is still `false`,** so the incomplete banner is visible to anyone opening the app, reviewer included, until the 2026-08-23 03:30Z cron tick.
- **`REQUIREMENTS.md` was not mutated.** LNCH-03 (in this plan's `requirements:` array) is not deliverable until 06-08 submits, and marking it would be a false claim; the phase has been marking requirements centrally anyway (LNCH-01 still reads Pending after 06-06). `requirements-completed` above lists only what this drive actually proved.

## Next Phase Readiness

**06-08 is unblocked**, with three carried items:

1. **F1's mobile spacing fix should land before screenshots** — otherwise the defect ships in the assets.
2. **Stage a second development store for S1** (fresh install, one company, one net-terms order, one limit).
3. **Read off WINDOWS #10** after the 03:30Z tick — one `jq` command, in 06-06 § (d) — and confirm "Free for partners and developers" is ticked (06-LISTING §2.2a).

## Self-Check: PASSED

- `.planning/phases/06-dashboard-onboarding-launch/06-07-SUMMARY.md` — FOUND
- `.planning/phases/06-dashboard-onboarding-launch/06-LISTING.md` §8 — FOUND (495 lines)
- Commit `e68e000` — FOUND
- Plan `<verify>`, clause by clause: `grep -Ec "id_token=eyJ"` → **0 PASS**; `prod-ledger-state` contains `reviewPromptedAt` → **true PASS**; working tree clean (`[ -z "$(git status --porcelain)" ]`) → **PASS**. The composite one-liner reports FAIL for the `wc -l` padding reason in Finding F3 only.
- Listing honesty greps after the edit: `grep -c read_all_orders` → 3; `grep -ci 'blocked $'` → 0
- Fixture restoration: Acme `creditLimit null` / `bypassEnforcement true` / `dirtyPublishes 0` — **VERIFIED by probe**
- No code changes: `git diff --stat 1edb800..HEAD` touches `.planning/` only

---
*Phase: 06-dashboard-onboarding-launch*
*Completed: 2026-08-22*
