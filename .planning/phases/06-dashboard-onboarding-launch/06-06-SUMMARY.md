---
phase: 06-dashboard-onboarding-launch
plan: 06
subsystem: infra
tags: [shopify-app-pricing, billing-check, app-store-listing, railway, reconciliation, probe]

requires:
  - phase: 06-dashboard-onboarding-launch
    provides: "06-01 the dashboard, 06-02/06-03 the gap closures, 06-04 the billing gate + prod-billing-state probe, 06-05 the guided setup, review moment and the add_shop_onboarding_review migration"
  - phase: 05-payment-reminders
    provides: "the live reminder fixtures, prod-reminder-state / prod-reminder-recipients probes, and the in-container drive pattern"
provides:
  - "06-LISTING.md — the complete App Store listing package: copy with measured character counts, read_all_orders justification, two-track reviewer instructions, screenshot shot list, screencast script, rejection checklist"
  - "README § Billing (App Pricing) and § Launch runbook — the plan facts, the gate's fail-open contract, and the gated release order"
  - "E-1 PROVEN twice: billing.check() sees the $0 dev-store contract, before the deploy and again against the new build"
  - "E-4 ANSWERED: the pricing_plans page renders the plan card, no locale 404"
  - "The phase branch is LIVE on Railway with add_shop_onboarding_review applied and smoke green"
  - "The LIVE DRIVE CARD 06-07 reads aloud (below)"
affects: [06-07, 06-08]

actuals:
  tokens: 7280
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Listing copy measured, not estimated: every character count in 06-LISTING.md was computed against the exact fenced text that gets pasted"
    - "Probe-gated release: the deploy command is preceded by a read-only probe whose false result is a documented halt, not a warning"

key-files:
  created:
    - .planning/phases/06-dashboard-onboarding-launch/06-LISTING.md
  modified:
    - README.md

key-decisions:
  - "E-1 was run BEFORE the deploy and passed — the ordering the plan cared about held, so the gate shipped with no lockout risk queued behind it"
  - "The $0 'Free to test' card proves same-org dev-store behaviour, NOT the 'Free for partners and developers' checkbox — a reviewer's store is a different org, so 06-08 must verify that checkbox explicitly"
  - "The listing states two scope limits in its own text (reminders v1 chases company-attributed orders only; draft/bypassed orders are counted but not checked) — disclosing them is what makes the feature bullets defensible under requirement 4.3"
  - "The #10 live drive was NOT faked or approximated when its transport was denied: the before-state is banked, the exact commands are recorded, and the daily 03:30Z cron will produce the same evidence unattended"

patterns-established:
  - "Pattern: a probe-gated release — the deploy command is preceded by a read-only probe whose false result is a documented halt, not a warning"

requirements-completed: [LNCH-01]

coverage:
  - id: D1
    description: "06-LISTING.md — the complete listing package: name, introduction, details, feature bullets, search terms, read_all_orders justification, two-track reviewer instructions, emergency-contact fields, 5-shot screenshot list, 12-beat screencast script, rejection checklist"
    requirement: "LNCH-03"
    verification:
      - kind: other
        ref: "grep -c read_all_orders 06-LISTING.md -> 3; grep -ci 'blocked $' -> 0; character counts recomputed from the file's own fenced blocks (name 27, introduction 91/100, details 451/500, bullets 54/71/63/69/68/59 all <=80)"
        status: pass
    human_judgment: true
    rationale: "Greps prove the honesty constraints and the counts are measured, but whether the copy passes a Shopify reviewer is a judgment no command can make. The listing has not been submitted."
  - id: D2
    description: "LNCH-01 E-1 — after selecting the plan on credit-guard-demo, billing.check() reports an ACTIVE subscription and the gate would pass"
    requirement: "LNCH-01"
    verification:
      - kind: integration
        ref: "scripts/prod-billing-state.sh credit-guard-demo.myshopify.com -> wouldPassGate: true, subscription 'Credit Guard' ACTIVE, trialDays 14, test false, 0.0 USD / EVERY_30_DAYS, currentPeriodEnd 2026-09-05T06:16:10Z (run at 06:31Z pre-deploy and again at 07:12Z against the new build)"
        status: pass
    human_judgment: false
  - id: D3
    description: "LNCH-01 E-4 — the store-side pricing_plans page renders the plan card"
    requirement: "LNCH-01"
    verification:
      - kind: manual_procedural
        ref: "human checkpoint 2026-08-22: card rendered under 'Free to test' ($29/30 days struck through, $0/30 days, 14 trial days); no 404, no locale fix, no private-plan fallback"
        status: pass
    human_judgment: true
    rationale: "Partner Dashboard and store admin pages have no API surface; a human read the page."
  - id: D4
    description: "README § Billing (App Pricing) + § Launch runbook — plan facts, gate placement and fail-open rationale, the E-1 probe, and the gated release order"
    verification:
      - kind: other
        ref: "grep -c 'App Pricing' README.md -> 1 (heading); sections present at lines 720 and 767"
        status: pass
    human_judgment: false
  - id: D5
    description: "The phase branch deployed on Railway with add_shop_onboarding_review applied by name, smoke green, and the gate passing against the new build"
    requirement: "LNCH-01"
    verification:
      - kind: integration
        ref: "railway up --service credit-guard-app --ci -> Deploy complete, /healthz healthcheck passed, image sha256:315b1cef… (run by the orchestrator at branch head fde3a02)"
        status: pass
      - kind: integration
        ref: "scripts/prod-billing-state.sh | jq .migrations -> 20260821175752_add_shop_onboarding_review finished 2026-08-22T07:14:57.056Z; wouldPassGate true against the new build"
        status: pass
      - kind: integration
        ref: "scripts/smoke-deployed.sh app.creditguardhq.com -> PASS (healthz 200 over valid TLS, forged HMAC 401 on all six webhook surfaces)"
        status: pass
      - kind: other
        ref: "shopify.app.toml byte-identical to the pre-deploy snapshot (CF-5 TOML guard); no shopify app deploy was needed or run"
        status: pass
    human_judgment: false
  - id: D6
    description: "WINDOWS #10 verified on the live reconciliation — the company-less net-terms orders flip UNRESOLVED -> NO_COMPANY and dataComplete becomes true"
    verification:
      - kind: other
        ref: "before-state banked at two instants: 2026-08-21T18:29Z {dataComplete false, attributed 11 / unresolved 5 / noCompany 0} and 2026-08-22T07:20Z {dataComplete false, attributed 14 / unresolved 2 / noCompany 0, unresolved = #1012, #1013}. Live drive NOT run — the in-container transport was denied by the execution sandbox."
        status: unknown
    human_judgment: true
    rationale: "OUTSTANDING — the single unfinished item of this plan. The fix is deployed and unit-proven (tests/reconciliation.test.ts, 4 regression specs that fail on pre-fix code); what is missing is the live observation. It arrives unattended at the next 03:30Z cron tick, or immediately via the commands in § WINDOWS #10. Must be read off before 06-08 submits."

duration: 1h 12m executor time (spanning a human Partner Dashboard checkpoint and an orchestrator-run deploy)
completed: 2026-08-22
status: complete
---

# Phase 6 Plan 6: Launch Gate & Listing Package Summary

**The App Store listing package is drafted against what the code can actually prove, E-1 confirmed `billing.check()` sees the demo store's $0 contract before anything shipped, and the phase branch is now live on Railway with `add_shop_onboarding_review` applied and smoke green — leaving one unfinished item: WINDOWS #10's live observation, whose before-state is banked and whose proof the daily cron will produce unattended.**

## Performance

- **Duration:** 1h 12m executor time (2026-08-22T02:24 → 15:30 +0800 wall clock, spanning the human checkpoint and the orchestrator's deploy)
- **Tasks:** 3 (Task 3 complete except its final live observation)
- **Files modified:** 2

## Accomplishments

- **`06-LISTING.md`** — the whole listing session reduced to copy-paste, with every character count measured against the exact text that gets pasted (introduction 91/100, details 451/500, all six feature bullets ≤ 80) rather than estimated.
- **E-1 passed before any deploy, and again after.** `billing.check()` reports an ACTIVE `Credit Guard` subscription on credit-guard-demo at `0.0 USD / EVERY_30_DAYS`, `trialDays: 14`, `test: false` — first at 06:31Z against the old build, then at 07:12Z against the new one. The gate can be trusted; it will not bounce the subscribed dev store to Shopify's plan page.
- **E-4 answered clean** — the plan card rendered at the `pricing_plans` URL first try. No locale 404, no private-plan fallback. The known locale wart did not bite.
- **The phase branch is live** — dashboard, guided setup, review moment, billing gate and all six code fixes, with `add_shop_onboarding_review` applied by name and the six-surface smoke green.
- **README gained the two sections a future release needs**: the billing facts with the gate's fail-open rationale, and a launch runbook whose first command is the probe that can veto the second.

## Task Commits

1. **Task 1: listing package + README sections** — `f26db13` (docs)
2. **Task 2: [DESKTOP] Partner Dashboard checkpoint** — human action, no commit
3. **Task 3: checkpoint corrections folded into the listing** — `deabf1c` (docs)

**Plan metadata:** `fde3a02`, amended by this revision.

## Evidence

### E-1 — the mandatory gate (PASSED, twice)

`scripts/prod-billing-state.sh credit-guard-demo.myshopify.com`:

| Field | Value |
|---|---|
| `wouldPassGate` | **`true`** at 06:31Z (pre-deploy) and **`true`** at 07:12Z (new build). Was `false` at 18:28Z the day before, when no plan existed |
| Subscription id | `gid://shopify/AppSubscription/33099055337` |
| `name` | `Credit Guard` |
| `status` | `ACTIVE` |
| `test` | `false` |
| `trialDays` | `14` |
| `createdAt` / `currentPeriodEnd` | `2026-08-22T06:16:10Z` / `2026-09-05T06:16:10Z` |
| Pricing | `0.0 USD`, `EVERY_30_DAYS`, planHandle `credit-guard` |
| `appHandleMatchesGate` | `true` (`credit-guard-net-terms`) |

`test: false` with `amount: 0.0` is the same-org dev-store contract behaving exactly as the research predicted: the price is effectively zero, the contract is a real one, and `billing.check()`'s `isTest || !subscription.test` passes on the second clause. The research caveat about needing empirical confirmation is now retired.

### E-4 — the plan page (PASSED, human)

The card rendered at `admin.shopify.com/store/credit-guard-demo/charges/credit-guard-net-terms/pricing_plans` under a **"Free to test"** heading: `$29 / 30 days` struck through, **`$0 / 30 days`**, 14 trial days, with a *Test with this plan* action. Approval showed "You will not be billed for this test charge". Post-approval landing was the app's Home page (the old build, as expected); whether a `plan_handle` param was present was not captured, so nothing is asserted about it.

### The deploy (run by the orchestrator at branch head `fde3a02`)

I was denied `railway up` by the execution sandbox — twice, including the bare authorized form — and halted rather than routing around it. The orchestrator, holding the permission, ran it and supplied the evidence:

| Gate | Result |
|---|---|
| `railway up --service credit-guard-app --ci` | **Deploy complete**, `/healthz` healthcheck passed, image digest `sha256:315b1cef…` |
| `shopify.app.toml` | **byte-identical** to the pre-deploy snapshot — no registry change was needed and none happened |
| `scripts/smoke-deployed.sh app.creditguardhq.com` | **PASS** — healthz 200 over valid TLS, forged HMAC → 401 on all six webhook endpoints |
| Migrations by name | **`20260821175752_add_shop_onboarding_review`** applied `2026-08-22T07:14:57.056Z`, alongside `add_reminder_log_failure_reason`, `add_reminder_log`, `add_validation_registration`, `add_enforcement_events`, `add_company_credit_controls` |
| `wouldPassGate` against the new build | **`true`** |

I re-verified the migration list and `wouldPassGate` independently from my own probe run at 07:12Z rather than taking the report on trust.

### WINDOWS #10 — before-state banked, live observation OUTSTANDING

**This is the one unfinished item of the plan.** The fix is deployed and unit-proven; what is missing is a live reading.

The before-state was captured twice, and the two readings are themselves informative:

| Instant | Build running | `dataComplete` | attributed / unresolved / noCompany | Unresolved orders |
|---|---|---|---|---|
| 2026-08-21T18:29Z | Phase 5 (pre-fix) | `false` | 11 / **5** / 0 | #1012, #1013, #1014, #1015, #1016 |
| 2026-08-22T07:20Z | Phase 5 (pre-fix) | `false` | 14 / **2** / 0 | **#1012, #1013** |

Between the two, the **03:30Z cron tick ran on the still-old build** and healed three rows (#1014, #1015, #1016) out of UNRESOLVED by *attribution* — companies were found for them. That is `healAttribution` doing its ordinary job and says nothing about #10.

**#1012 and #1013 did not move, which is exactly the starvation #10 describes.** They are genuinely company-less (`companyAttached: false`), so no attribution pass can ever resolve them; only the exhaustion flip can prove them company-less and let `dataComplete` go true. Under the pre-fix code that flip never admitted them. The newest of the two is **#1013** (`gid://shopify/Order/7081002598633`, NET terms, ingested 2026-08-20T17:33:00Z); **#1012** (`gid://shopify/Order/7080354775273`, RECEIPT terms, no payment schedules at all) is the older.

> Note: the plan predicted #1012 as the starved order, and after the intervening heals that is again half-right — but the *newest* company-less order, which is the one the fix is specifically about not starving, is #1013.

**Expected on the first post-fix reconciliation:** `flippedNoCompany: 2`, both orders reach `NO_COMPANY`, `dataComplete` → `true`. Second run: `flippedNoCompany: 0`.

**Why it was not run.** The drive needs an uncommitted one-file driver shipped into the container over the base64 / `railway ssh` channel (the 05-05 mechanism). The execution sandbox denied that transport — three times, at both the encode step and the heredoc write. The committed *read-only* probes use the same channel and ran fine throughout, so the channel is not the objection; shipping an ad-hoc executable script into a production container is. **I did not try a fourth encoding to get around it**, because that is the denial's intent rather than an obstacle to it.

**Two ways to finish it, in preference order:**

1. **Do nothing.** The reconciliation cron runs **daily at 03:30 UTC** (cursor `updatedAt` reads `2026-08-21T03:30:02Z` and `2026-08-22T03:30:01Z`). The next tick — `2026-08-23T03:30Z` — is the first to run on the fixed code, and it *is* the live drive. Afterwards:

   ```sh
   scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com \
     | jq '{dataComplete, attribution}'
   # expect: dataComplete true, noCompany 2
   ```

2. **Drive it now**, from a shell with the permission. The driver is written and ready at
   `<scratchpad>/drive-reconcile.ts` (uncommitted by design, T-04-17):

   ```sh
   PAYLOAD="$(base64 < drive-reconcile.ts | tr -d '\n')"
   railway ssh --service credit-guard-app -i ~/.ssh/railway_ed25519 \
     "printf %s '${PAYLOAD}' | base64 -d > /app/.drive-reconcile.ts \
      && cd /app && ./node_modules/.bin/vite-node .drive-reconcile.ts credit-guard-demo.myshopify.com \
      ; rm -f /app/.drive-reconcile.ts"
   ```

   Run it **twice**, reading `scripts/prod-ledger-state.sh … | jq '{dataComplete, attribution}'` after each. `vite-node` and the full source tree are both present in the container (verified read-only: `/app/node_modules/.bin/vite-node`, `/app/app/services/reconciliation.server.ts`). Confirm `/app/.drive-reconcile.ts` is gone afterwards.

**If it does not flip: report it, do not patch live.** A `flippedNoCompany: 0` on the fixed build would be a genuine finding about the fix, and the four regression specs in `tests/reconciliation.test.ts` would be the place to reproduce it.

## Fact corrections carried in from the checkpoint

| Correction | Consequence |
|---|---|
| **Acme Supply's contact is a live iCloud address**, not `example.com` — the earlier "reverted to example.com" note was about a different contact | Acme has a reachable buyer login *today*, so #13's precondition is already satisfied. `06-LISTING.md` §4.0 no longer implies the existing companies are unreachable; the dedicated reviewer company is now justified by credential hygiene, which is the true reason. **Independently corroborated by probe**: `prod-reminder-recipients.sh` shows five notifications to `icloud.com` with `deliverable: true` |
| **#1014's delivered reminder body read "Your payment is 7 days overdue"** | The OVERDUE template branch is adaptive (N days), human-inspected 2026-08-22. This closes 05-VERIFICATION's "read one delivered OVERDUE body" human item |
| **The plan form has no top-features field** (observed 2026-08-22) | `06-LISTING.md` §2.2 drops the paste instruction and keeps the bullets as listing-description material, with a note to re-check the form at submission |
| **The `$0` card proves same-org behaviour, not the checkbox** | New §2.2a: 06-08 must open the plan and confirm "Free for partners and developers" is ticked, because a reviewer's store is a different org and there the checkbox is the only thing between them and a real $29 charge |

---

## LIVE DRIVE CARD — for 06-07

**Read this aloud at 06-07's checkpoint. Every value below was measured on 2026-08-22; re-probe before acting, because the hourly sweeps move exposure.**

### (a) WINDOWS #13 — the overdue-only credit hold

The demo store has never staged a company on hold for **overdueness alone**. Today's only live hold (Northwind Trading) is an *over-limit* hold, so the overdue message has never been seen at a live checkout.

**Use Acme Supply.**

| Field | Current value |
|---|---|
| Company | **Acme Supply** (`gid://shopify/Company/7766278377`) |
| `overdue` | `true` (earliest due 2026-08-17T01:35Z) |
| `exposure` | **`4015.90`** |
| `creditLimit` | **`null`** — so nothing is enforcing today |
| `bypassEnforcement` | **`true`** ⚠️ |
| `blockedState` | `false` |

**Step 0 — the buyer login.** Acme's company contact is a live iCloud address that receives mail (proven by the delivered #1014 reminder). **No contact needs to be added.** If you would rather not touch Acme's fixtures, the alternative is a new company with Net 30 terms, a reachable contact and one net-terms order past its due date — but that costs a wait for the order to age.

**Steps.**
1. Credit Guard → Companies → Acme Supply → turn **bypass OFF**. (It is ON today; while it is on, nothing blocks — bypass is checked first.)
2. Set Acme's credit limit to **`6000`** — comfortably *above* its `4015.90` exposure, so over-limit cannot be the cause. Confirm the badge reads **On credit hold** and the reason is the overdue balance.
3. Log in to the storefront customer account as Acme's contact (one-time code to the iCloud mailbox), add a product, attempt net-terms checkout.
4. **Expected:** refused with the *overdue* message — "Your account has overdue invoices. New orders on payment terms are paused until the balance is settled — please contact us to arrange payment." This is beat 6 of the screencast; record it.

**Restore afterwards, both of them:**
- credit limit → **`null`** (clear the field)
- bypass → **ON**

Skipping the restore leaves Acme permanently blocked and changes what every later screenshot shows.

### (b) E-5 — the pay-now completion (WINDOWS #18)

Two orders have **delivery-confirmed** reminders (recipient domain `icloud.com`, `deliverable: true`):

| Order | GID | Reminder sent | ReminderLog row? |
|---|---|---|---|
| **#1015** | `gid://shopify/Order/7082173759721` | 2026-08-21T07:23:27Z | **no** |
| **#1014** | `gid://shopify/Order/7082172055785` | 2026-08-21T07:22:54Z | **no** — its OVERDUE body is the one that was read |

**An honesty note that matters for E-5:** neither order has a `ReminderLog` row, and both were company-less at the time. Their sends were 05-02's manual E-fixture probes, **not** sweep sends — the shipped sweep only chases company-attributed orders, exactly as the listing claims. So these two prove *delivery and template rendering*, and they do not prove the sweep's own send path end to end.

The `order_payment` URL was **not** fetched here (it needs an Admin query this plan had no reason to make, and no email was opened). Fetch it structurally in 06-07, then pay with Shopify's test gateway per D6-05. Which schedule should complete: **#1015's** — `gid://shopify/PaymentSchedule/47678062825`, due 2026-09-20T07:19:28Z, currently open.

### (c) E-2 — the review prompt

- `reviewPromptedAt` now **exists** in production (its migration landed 2026-08-22T07:14:57Z) and is **`null`**.
- **Eligibility inputs are already satisfied**, so the prompt should fire on the first app open: 6 `EnforcementEvent` rows (3 `BLOCK_STATE_ENTERED`, 2 `BLOCK_STATE_EXITED`, 1 `BYPASSED_ORDER`) **and** 6 `ReminderLog` rows with status `SENT`.
- Dev stores bypass the Reviews API's rate limits and the 24-hour post-install restriction, so a `success` code is expected; `merchant-ineligible` on a dev store would be the finding worth recording.

### (d) WINDOWS #10 — read it off before submitting

If the 03:30Z tick has passed, one command closes it:

```sh
scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com | jq '{dataComplete, attribution}'
```

Expect `dataComplete: true` and `noCompany: 2` (#1012, #1013). While it reads `false`, the merchant-facing dashboard shows its "Some balances may be incomplete" banner — so this is visible to a reviewer, not just to us.

### (e) Live fixture state at hand-off

| Company | Exposure | Limit | Overdue | Bypass | On hold |
|---|---|---|---|---|---|
| Acme Supply | 4015.90 | null | **yes** | **ON** | no |
| Northwind Trading | 899.90 | 800.00 | no | off | **YES** (over limit) |
| Snowdevil | 712.45 | null | no | off | no |

Reminders are **OFF** (`remindersEnabledAt: null`). The enforcement rule is registered and live (`gid://shopify/Validation/134447337`). 16 ledger orders, 15 open net-terms, 3 companies, `dirtyPublishes: 0`.

## Decisions Made

- **Halt rather than route around a denied action, twice.** First on `railway up` (the orchestrator then ran it), then on the in-container drive transport. Both denials were the sandbox, not the project; in neither case was a workaround attempted.
- **Do not fabricate the #10 observation.** With the drive blocked, the honest outputs are the banked before-state, the exact commands, and a coverage entry marked `unknown` — not a plausible-looking claim.
- **The listing discloses its own scope limits.** Reminders v1 chases only company-attributed net-terms orders; draft-completed and bypassed orders are counted but not checked at checkout. Both appear in the reviewer instructions, because the app surfaces both facts in its UI and a reviewer who discovers an undisclosed limit reads it as a false claim.
- **Character counts are computed, not estimated.** The first draft's app-details text was 511 characters against a 500 limit — an error that would have surfaced as a rejected paste mid-session.

## Deviations from Plan

### Auto-fixed / adapted

**1. [Rule 3 - Blocking] `railway up` denied by the sandbox; deploy performed by the orchestrator**
- **Found during:** Task 3
- **Issue:** Two denials by the auto-mode classifier, including the bare authorized form. Not a credential, network or platform failure.
- **Resolution:** Halted, banked all pre-deploy evidence, handed over the exact commands. The orchestrator ran the deploy and returned the evidence, which I then re-verified independently via my own probe.
- **Files modified:** none

**2. [Rule 3 - Blocking] The in-container reconcile drive transport is denied**
- **Found during:** Task 3
- **Issue:** Three denials across the base64 encode and heredoc-write steps of shipping an ad-hoc driver into the container.
- **Resolution:** Driver written and preserved, exact command recorded, unattended cron path documented, coverage D6 marked `unknown`. Not worked around.
- **Files modified:** none

**3. [Rule 1 - Bug] The plan's app-details draft exceeded its own limit**
- **Found during:** Task 1
- **Issue:** The three-paragraph details text measured 511/500 characters; the stated counts for the introduction and three bullets were each off by one (apostrophes).
- **Fix:** Made the 451-character version primary, recorded exactly which sentence was dropped and why, recomputed every count from the file's own fenced blocks.
- **Verification:** counts re-extracted from the committed file — 27 / 91 / 451 / (54, 71, 63, 69, 68, 59)
- **Committed in:** `f26db13`

**4. [Rule 1 - Bug] The honesty grep failed on this document's own prohibition text**
- **Found during:** Task 1 verification
- **Issue:** `grep -ci 'blocked $'` returned 2 — both hits were the rule *forbidding* the claim, quoted literally.
- **Fix:** Reworded the prohibitions ("no dollar total of orders we stopped") so the gate measures claims rather than the rule against them.
- **Verification:** grep now returns 0
- **Committed in:** `f26db13`

**5. [Rule 2 - Missing Critical] The `$0` card does not prove the reviewer-safety checkbox**
- **Found during:** Task 3 (checkpoint report)
- **Issue:** The demo store is same-org, so it renders every plan at $0 whether or not "Free for partners and developers" is ticked. Treating the observed $0 as proof would ship a listing where a reviewer in a different org meets a real $29 charge — a rejection.
- **Fix:** Added §2.2a to `06-LISTING.md` requiring 06-08 to verify the checkbox explicitly.
- **Committed in:** `deabf1c`

**6. [Rule 1 - Bug] The plan's live-fixture facts were stale, and moved again mid-plan**
- **Found during:** Tasks 1 and 3
- **Issue:** The plan expected Acme exposure `3229.95` and two SENT rows; live values were `4015.90` and six SENT rows. The unresolved set then changed *during* the plan (5 → 2) when the 03:30Z cron healed three rows on the old build.
- **Fix:** Every figure in this SUMMARY and the live-drive card comes from a probe, with its timestamp, and the two before-readings are both recorded rather than the later one silently replacing the earlier.

---

**Total deviations:** 6 (2 blocking, 3 bugs, 1 missing-critical)
**Impact on plan:** All three tasks delivered. One verification observation is outstanding and explicitly tracked; nothing was approximated to close it.

## Issues Encountered

- **Two sandbox denials** shaped the execution: the deploy moved to the orchestrator, and the #10 observation moved to the cron. Neither is a project defect.
- **Reminders remain OFF in production**, as 05-05 left them. Any screenshot of reminder activity needs them switched on first.
- **`dataComplete` is still `false` in production**, so the dashboard currently shows its "Some balances may be incomplete" banner to anyone opening the app — including a reviewer. This resolves with the #10 observation above.

## User Setup Required

None — no external service configuration. The outstanding actions are the #10 read-off and 06-08's checkbox verification.

## Next Phase Readiness

**06-07 is unblocked** — the build it needs is live, the migration is applied and smoke is green.

Carry forward:
1. Read off WINDOWS #10 after the 03:30Z tick (one `jq` command, above).
2. Work the LIVE DRIVE CARD: #13 with Acme (bypass OFF, limit 6000, both restored), E-5 via #1015's schedule, E-2 on first app open.
3. **06-08's checklist gains one item from this plan:** confirm "Free for partners and developers" is ticked on the plan.

## Self-Check: PASSED

- `.planning/phases/06-dashboard-onboarding-launch/06-LISTING.md` — FOUND
- `README.md` § Billing (App Pricing) line 720, § Launch runbook line 767 — FOUND
- Commits `f26db13`, `deabf1c`, `fde3a02` — FOUND
- `npm test` — 807 passed / 27 files; typecheck, lint, build clean; working tree clean
- `grep -c read_all_orders 06-LISTING.md` → 3; `grep -ci 'blocked $'` → 0
- Plan Task 3 `<verification>`: `wouldPassGate == true` **PASS**; `migrations contains add_shop_onboarding_review` **PASS**; `smoke-deployed.sh` **PASS**; `git status --porcelain` empty **PASS**; `dataComplete == true` **NOT YET** — recorded as coverage D6 `status: unknown` rather than glossed.

---
*Phase: 06-dashboard-onboarding-launch*
*Completed: 2026-08-22*
