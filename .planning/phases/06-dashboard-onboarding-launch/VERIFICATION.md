---
phase: 06-dashboard-onboarding-launch
verified: 2026-08-24T05:35:00Z
verified_at_commit: cc23664 (main; production build under review is f1032f0, confirmed ancestor of main)
verdict: ACHIEVED_WITH_GAPS
status: human_needed
score: 6/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Shopify App Store review outcome for the 2026-08-24 submission (build f1032f0)"
    expected: "App approved and publicly listed; if a revision round comes back, address findings and resubmit"
    why_human: "LNCH-03's final half ('passes Shopify app review and is publicly listed') is decided by Shopify, not by this codebase. The verifiable boundary — submitted with all known requirements addressed — is reached; the outcome is external and time-gated."
  - test: "Replace screenshot 4 on the live listing (WINDOWS #23)"
    expected: "The PII-carrying uncropped S4 replaced with the storefront credit-hold refusal (or the modal with the customer panel out of frame) at the first review-round opportunity or immediately on approval"
    why_human: "Partner Dashboard action; the listing cannot be edited while under review. Highest-priority waiting-period item (06-LISTING §10.3)."
gaps: []
---

# Phase 6: Dashboard, Onboarding & Launch — Verification Report

**Phase Goal:** Merchant sees their full AR position at a glance, new installs reach first value in the first session, and the app is live, billable, and listed.
**Verified:** 2026-08-24T05:35Z, at `cc23664` on `main` (PR #4 merged; v1.0.0 submitted for App Store review 2026-08-24 against `f1032f0` — verified `f1032f0` is an ancestor of `main`, so production runs the merged code).
**Verdict:** **ACHIEVED_WITH_GAPS** — every codebase-verifiable success criterion is proven (code, tests, and live probes this verifier ran independently); the two remaining items are external and time-gated, not code gaps.
**Re-verification:** No — initial verification.

**The verifiable boundary, stated explicitly (per verification constraints):** LNCH-03 reads "App passes Shopify app review and is publicly listed." Passing review is Shopify's decision and had not been rendered at verification time. The verifiable boundary is *submitted with all known requirements addressed*, and that boundary is reached — with one disclosed defect on the live listing (S4 PII, WINDOWS #23) that cannot be corrected until Shopify's process allows it.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1 — AR dashboard: total outstanding, overdue companies, upcoming due dates, per-company utilization, credit-hold feed with exposure/limit snapshots, bypassed-order alerts; no "blocked $X" (D6-02) | ✓ VERIFIED | Code + tests + live: see "SC1 detail" below. Live drive predicted-vs-observed table matched every KPI/row (06-07 D2); verifier re-probed production 2026-08-24: `dataComplete true`, attribution 15/0/2 |
| 2 | SC2 — guided setup (review balances → set limit → enable enforcement) completes in the first session | ✓ VERIFIED | `onboarding.server.ts`: two stored stamps + steps 2/3 re-derived per load; live stamps `onboardingReviewedAt 07:55:33.432Z` / `onboardingDismissedAt 07:56:08.628Z` (35s apart, one session), re-read by verifier probe today; guide gone on later loads (BFS 4.2.2 #6) |
| 3 | SC3 — 14-day trial then US$29/mo flat via Shopify App Pricing, zero billing code | ✓ VERIFIED | `app.tsx` gate: `billing.check()` only, fail-open, `_top` redirect, side effects first; source guards forbid `billing.require/request`/`appSubscriptionCreate` and any `billing` in `shopify.server.ts`; E-1 probe `wouldPassGate: true` BEFORE deploy (06:31Z) and after (07:12Z); plan card `$29/30 days`, 14 trial days human-observed; "free for partners and developers (verified)" — 06-LISTING §10.1 |
| 4 | SC4 — in-admin review prompt via official Reviews API after first success moment | ✓ VERIFIED | `reviewEligibility` requires a real success (BLOCK_STATE_ENTERED / BYPASSED_ORDER / SENT reminder) AND `reviewPromptedAt` null; B-01 stamp rule exact (`REVIEW_NEVER_EVALUATED_CODES` = recently-installed/already-open/open-in-progress leave null; all else incl. throw stamps); live: stamped `07:16:54.072Z` off a genuine success, 5-star modal seen by developer, three later opens with `GET /app` and NO POST — no re-ask. Verifier re-read the stamp from production today |
| 5 | SC5 — app passes Shopify review and is publicly listed | ⚠ PARTIAL (at verifiable boundary) | Submitted 2026-08-24, build f1032f0, all automated checks green, 838/838 tests, demo store populated, screencast recorded (form required it), reviewer access documented. External outcome pending; S4 PII open on the live listing (WINDOWS #23). Routed to human verification |
| 6 | D6-04 promise — WINDOWS #3 #8 #10 #12 #13 #20 #21 #22 all fixed with evidence | ✓ VERIFIED | Every closure independently re-checked in code and/or live probes by this verifier (table below); ledger updated in this commit |
| 7 | Ingest-latency submission blocker (06-DEBUG) closed: rung-1 re-attribution + 5-min attribution-heal, hazards bounded, proven live | ✓ VERIFIED | Code, tests (RED→GREEN commits 1378c9b→8120f75), and live convergence — detail below; verifier probes today confirm the `attribution-heal` lease actively ticking and both stores converged |

**Score:** 6/7 truths verified (SC5 partial — external half pending by nature, said explicitly per constraints).

### SC1 detail — the dashboard read model (the hardest checks)

All verified by reading `app/services/dashboard.server.ts` and `app/routes/app._index.tsx` at `cc23664`:

- **Money is never summed from schedules.** K1 is `Company.exposure` (sole writer `recomputeCompany` → `computeCompanyState` over the company's `LedgerOrder` rows). K4 dedupes by `orderId` into a Map and sums `order.outstandingShop` — an order with two open schedules in the window is one amount. `LedgerSchedule` supplies due dates and open/closed only.
- **At-limit = on hold (plan-check I-02).** `utilisationPercent` renders a number with deliberately no verdict; status claims come only from the stored `blockedState` flag (P4-L1 `exposure >= limit` is decided in the credit engine, not re-derived on the page).
- **Feed renders snapshots, never joins Company.** `EnforcementEvent.companyName/exposure/limit/overdue/amount/channel` are read straight off the event row; the only join is order-GID → `LedgerOrder.name` (allowed and required). A deleted company cannot erase its audit trail.
- **One banner, loader-owned precedence.** `selectBanner`: backfill-running > data-incomplete > bypassed-one/many; the page's `bannerFor` only maps the choice to copy. B4 deliberately not built (documented, honest).
- **DB-only home path.** Zero Admin API calls in `dashboard.server.ts`. The one Admin read on the home path is step 3's `readValidationConfig`, and `setupStateFor` short-circuits on `onboardingDismissedAt` BEFORE that read (`DISMISSED_SETUP_STATE` return precedes the `Promise.all`) — verified in `onboarding.server.ts:347`. After dismissal the home loader is a pure Postgres projection.
- **No "blocked $X" anywhere.** `feedSentence` vocabulary is "credit hold"; `grep -ci 'blocked $'` on the listing is 0 (re-asserted in 06-07/06-08 self-checks).
- **Tenant boundary + input hardening:** every read is `session.shop`-scoped; `?feedPage`/`?locale` clamped/validated (T-06-01/02).
- **Live honesty cross-check:** the 06-07 predicted-vs-observed table (K1 $7,623.10 · incomplete, K2 2, K3 1, K4 "—", #1013 correctly absent, 112% utilization) was recorded with predictions banked BEFORE the page was opened — an honest procedure, and every value matched.

### SC2/SC4 detail — onboarding + review moment

- Only two facts stored (`onboardingReviewedAt`, `onboardingDismissedAt`); steps 2/3 re-derived every load. Step 3 is a status CONFIRMATION with no new mutation surface (D6-03) — its only button is an `href` to `/app/settings`; the route action's closed intent set is exactly `mark-reviewed` / `dismiss-onboarding` / `review-prompt-result`, anything else 400s (T-06-19). Server re-derives the 3/3 check inside `dismissOnboarding` (T-06-20). Both stamps idempotent via `updateMany` null-guards.
- Review moment: effect-only, no UI of ours (1.3.1-safe), single ask per load, `cancelled`-flag cleanup on unmount, dependency array keyed on eligibility alone. `stampsReviewPrompt` stamps everything except the three never-evaluated codes — including throws (mapped to `"error"` client-side). Once-only proven live and corroborated by the Railway request timeline (the only stamping POST at 07:17:00Z; three later `GET /app` with no POST).
- Known observability gap: the result code is discarded (06-07 F2) — now ledgered as WINDOWS #24.

### SC3 detail — billing gate

`app/routes/app.tsx` loader, verified line by line: side effects (`ensureShopActive`, `startBackfill`, `ensureValidationRegistered`) run before the check; `billing.check()` in try/catch with Sentry capture; **redirect issued only when a check that SUCCEEDED said `hasActivePayment === false`** — every other shape (throw, null, undefined) renders the app. `target: "_top"`. URL built from `session.shop` only (T-06-14). `tests/billing-gate.test.ts` pins all four behaviors behaviorally plus four source guards (two nav links, no home link, no Billing API mutations, zero billing config).

One nuance vs. the verification brief: the app handle is a **constant** (`APP_HANDLE = "credit-guard-net-terms"`) documented as kept in lockstep with `shopify.app.toml` (which declares the same handle — verified), and pinned by test to the literal — it is not read from the TOML at runtime. No automated TOML↔constant lockstep guard exists for the handle specifically. Informational only: the values match and both are test/config-pinned.

The same-org demo store structurally cannot prove cross-org behavior of the "Free for partners and developers" checkbox (06-LISTING §2.2a); the checkbox state itself was human-verified before submission (§10.1 "free for partner and development stores (verified)").

### Truth 7 detail — ingest-latency gap closure (the submission blocker)

Root cause (06-DEBUG, confirmed against code): one-shot attribution at first doorbell + rung-1 preserve-mode trap + daily-only backstop = up to 24h of understated exposure, deterministically failing reviewer Track B. The fix, verified at `cc23664`:

- **Rung-1 re-attribution** (`ledger.server.ts ingestOrderEvent`): any known row not ATTRIBUTED with payment terms gets `reattemptAttribution` on every ring. **Money-refresh isolation (555c402):** the retry is wrapped in its own try/catch (Sentry + warn) so a company-edge blip can never take down the `refetchOrderAndRecompute` money update — verified in code.
- **NO_COMPANY hint-less loop closed (555c402):** the hint-less branch returns early unless status is UNRESOLVED — a NO_COMPANY row already had a full enumeration prove it company-less; re-enumerating per ring forever was the hazard. Doorbell path NEVER writes NO_COMPANY; bounded by `MAX_DOORBELL_COMPANY_SCANS = 10`, biggest-deficit-first.
- **5-minute attribution-heal sweep** (`runAttributionHealSweep`, own `attribution-heal` lease, `*/5 * * * *`): one indexed DB read per shop per tick; zero API cost when nothing is unresolved; runs the heal ONLY — the exhaustion flip stays daily (heal/flip split), exactly the flicker hazard 06-DEBUG §3 Q4 warned about.
- **#10 flip fix:** the two-arm gate (`refetchedAt < sweepStart` OR membership in this sweep's own `scannedGids`) with the empty-set guard — the starved-newest-order case converges.
- **Phase 5 exactly-once interactions checked:** attribution writes go through the same idempotent `upsertOrderFromSource`/`recomputeCompany` as the daily heal; nothing touches `ReminderLog`. The reminder-engine changes preserve the taxonomy: SENT_UNCONFIRMED stamps `sentAt` and counts as SENT for dedupe/suppression and the per-order 24h window; SUPPRESSED_STALE retires outranked FAILED rows instead of sending. No regression path found.
- **Live proof, independently re-verified today:** demo-2 converged unattended (`0/2 unresolved/dataComplete false` → `2/0/true` at 10:52Z, 2026-08-23); verifier probes 2026-08-24T05:17Z: demo `dataComplete true`, 15/0/2; demo-2 `dataComplete true`, 2/0/0, Snowdevil 973.75 vs 900.00 limit; `attribution-heal` lease held with `lockedUntil 2026-08-24T05:15:00Z` — actively ticking every 5 minutes.
- TDD sequence real: `1378c9b` (RED) → `9093fe1` (GREEN) → `c687618` (RED) → `160016e` (GREEN) → `555c402` (bounds) → `8120f75` (docs). All commits exist on main.

### WINDOWS closure table (Truth 6) — each independently re-checked

| # | Claim | Verifier's independent evidence | Verdict |
|---|-------|-------------------------------|---------|
| #3 | SessionNotFoundError acknowledge-and-drop | `SessionNotFoundError` named catch present in `webhooks.orders.tsx`, `webhooks.companies.tsx`, `webhooks.payment-terms.tsx` — logs and acks | FIXED |
| #8 | Access-log credential scrub | `installAccessLogRedaction` imported FIRST in `instrument.server.mjs` (pre-boot); live log store grep 06-07: 17/17 `id_token=[redacted]`, 0 raw JWTs, hmac/session scrubbed | FIXED (live) |
| #10 | Exhaustion-flip starvation | Two-arm `flippable` gate in `reconciliation.server.ts` with `scannedGids` arm + empty-set guard; live 03:30Z 2026-08-23 tick: 15/0/2, `dataComplete true`; re-probed today, still true | FIXED (live) |
| #12 | TOCTOU acknowledgement | `// WINDOWS #12 — TOCTOU, acknowledged` comment at the echo site in `enforcement.server.ts:907` (the entry asked for exactly a comment) | FIXED |
| #13 | Overdue-only live block | Four-event sequence 07:56–08:01Z incl. `BLOCK_STATE_ENTERED` `overdue:true, 5345.80 < 6000.00`; buyer saw the shipped overdue message verbatim; fixtures restored, probe-verified | FIXED (live) |
| #20 | Outranked retry fence | `outrankedBySentSibling` + `SUPPRESSED_STALE` retire path in `reminders.server.ts` (severity fence comment cites #20); regression tests present | FIXED |
| #21 | extensions.code narrowing | Closed retriable set (`ACCESS_DENIED` + validation-class); unknown codes → `SENT_UNCONFIRMED` terminal; verified in `reminders.server.ts` | FIXED |
| #22 | Honest eligibility copy | Settings card: "Only net-terms orders attributed to a company in Credit Guard are chased…"; README §524 states the v1 limitation; both surfaces share `REMINDERS_CADENCE` | FIXED |
| #11, #18, #19 | Open by design | #11: behaviorally proven, `cartCents` normalizes either format; #18: dev store refuses to transact even with Bogus Gateway (quoted verbatim, not worked around); #19: 3.5–5h dev-store delivery latency. All three have written pre-launch procedures (06-LISTING §10.5 items 3–4) | OPEN — by design, correctly held |

`.planning/WINDOWS.md` updated in this commit via the gsd-core `broken-windows` library (parse → markFixed×8 with evidence reasons → append×5 → renderLedger; re-parse verified): now **8 open / 1 waived / 18 fixed / 27 total**. New entries: #23 S4 PII on the live listing (open, action-on-first-opportunity), #24 review-prompt result code not persisted (F2), #25 reminders multi-schedule flake, #26 review-prompt timeout flake, #27 setup step-3 tick-above-heading cosmetic.

### Landing page + self-review (06-08 late finds)

- `f1032f0` verified in code: `app/routes/_index/route.tsx` is a self-contained resource route (no default export, no `shopify.server` import, inline CSS, zero external requests); **no placeholder strings and no shop-domain form** in rendered output (grep hits are documentation comments only); `?shop=` redirect to `/app` preserved; `tests/landing-route.test.ts` (18 tests) guards it. Verified live by curl at submission per 06-08.
- 06-APP-STORE-SELF-REVIEW's five ⚠ items, each addressed or honestly held: **1.1.4** fixed (f1032f0); **2.3.1** fixed (the `_index` form removed; library `/auth/login` fallback retained, which is the template-sanctioned shape); **1.2.2** partially human-verified (plan published + E-1 + live gate drive; decline/reinstall loop remains a first-production-install check — §10.5 item 7); **3.1.1** verified live (`smoke-deployed.sh`: /healthz 200 over valid TLS); **3.2.1** justified in TOML + access request granted since Phase 2 (WINDOWS #2) and mirrored in the listing.
- **S4 PII (the honest hold):** the LIVE listing still carries the uncropped screenshot; the listing cannot be edited while under review. Recorded as an open risk with the planned action "replace at first review-round opportunity or immediately on approval" — WINDOWS #23, top of the waiting list. (Note: 06-LISTING §10.3's line that editing during review is permitted proved not to hold; the ledger entry and this report carry the corrected fact.) Repo copy cropped at `1ee6b34`; uncropped remains in history at `57fb1a4` (private repo — rewrite left to the developer's judgment).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite at cc23664 | `npm run graphql-codegen` then `DATABASE_URL=postgresql://hesamabbaszadi@localhost:5432/creditguard_test npm test` | **838 passed / 28 files**, 15.5s, zero failures (both known flakes green this run) | ✓ PASS |
| Production ledger state (demo) | `scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com` (read-only, railway ssh) | `dataComplete true`, attribution 15/0/2, `reviewPromptedAt 2026-08-22T07:16:54.072Z`, both onboarding stamps exactly as claimed, reminders on since 2026-08-23 | ✓ PASS |
| Production ledger state (demo-2) | `scripts/prod-ledger-state.sh credit-guard-demo-2.myshopify.com` | `dataComplete true`, attribution 2/0/0, Snowdevil exposure 973.75 vs limit 900.00 (matches listing hero claims) | ✓ PASS |
| attribution-heal lease live | same probe, `sweepLeases` | `attribution-heal` held, `lockedUntil 2026-08-24T05:15:00.043Z` — ticking on the 5-min cadence | ✓ PASS |
| f1032f0 in production lineage | `git merge-base --is-ancestor f1032f0 main` | ancestor confirmed | ✓ PASS |
| Fix-commit chain exists | `git cat-file -e` on 1378c9b 9093fe1 c687618 160016e 555c402 8120f75 57fb1a4 1ee6b34 d1f60ce | all present | ✓ PASS |

No production write was made; probes are the committed read-only scripts.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| — | No TBD/FIXME/XXX/TODO/HACK markers in any phase-6-modified source file | — | The known debts are ledgered in WINDOWS.md, not squatting in comments (the one `WINDOWS #12` comment is the deliberate closure of that entry) |

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| DASH-01 | ✓ SATISFIED | Truth 1 |
| DASH-02 (D6-02 rewording) | ✓ SATISFIED | Truth 1 — credit-hold vocabulary, snapshots, slipped-order amounts, no "blocked $X" |
| DASH-03 | ✓ SATISFIED | Truth 2 |
| LNCH-01 | ✓ SATISFIED | Truth 3 |
| LNCH-02 | ✓ SATISFIED | Truth 4 |
| LNCH-03 | ⚠ AT BOUNDARY | Truth 5 — submitted with all known requirements addressed; external review outcome pending |

**Bookkeeping observation:** `.planning/REQUIREMENTS.md` still marks all six Phase 6 rows "Pending" and ROADMAP's phase 6 row reads "Executed (submitted; verification pending)". With this verification done, DASH-01/02/03, LNCH-01, LNCH-02 can be flipped to Complete; LNCH-03 should flip on review approval. Left to the orchestrator (outside this verifier's write scope).

**Second observation for the orchestrator:** the mobile KPI row-gap defect (06-07 F1, fix reverted at the developer's request at `d1f60ce`) was named a ledger candidate by 06-08 but was not in the directed set of new WINDOWS entries; it is not ledgered. All listing screenshots are desktop, so nothing shipped with it — flagging in case it should be #28.

### Gaps Summary

No code gaps. The phase goal's three clauses: "full AR position at a glance" — proven in code, tests, and live; "first value in the first session" — proven live (stamps 35 seconds apart, first block inside the same session, review prompt fired off a genuine success); "live, billable, and listed" — live and billable proven (deployed, smoke green, plan published, gate live-driven); **"listed" is submitted-and-pending**, which is as far as any codebase work can carry it. The two open items — the external review outcome and the S4 screenshot replacement — are human, external, and time-gated, hence `status: human_needed` rather than `gaps_found`.

---

_Verified: 2026-08-24T05:35Z_
_Verifier: Claude (gsd-verifier), goal-backward from ROADMAP Phase 6 SCs + D6-04 + 06-DEBUG closure promise; SUMMARY claims treated as hypotheses and re-checked against code, tests, git history, and read-only production probes._
