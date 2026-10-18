---
phase: 06-dashboard-onboarding-launch
plan: 08
subsystem: launch
tags: [app-store, listing, submission, screenshots, changelog, pull-request, windows-closure]

requires:
  - phase: 06-07
    provides: "Live-drive evidence for DASH-01/02/03 and LNCH-02, the §8 live facts, and the S1 second-store recommendation"
  - phase: 06-06
    provides: "The drafted listing package, the configured $29/14-day plan, and the deployed release"
provides:
  - "Credit Guard: B2B Net Terms submitted for Shopify App Store review on 2026-08-24 (LNCH-03 terminal state)"
  - "06-LISTING.md §9 — the reconciliation between the drafted package and what the Partner Dashboard actually required"
  - "06-LISTING.md §10 — the as-submitted record: build, timeline, ten-item waiting list, and the screenshot-4 PII disclosure"
  - "CHANGELOG.md v1.0.0 — the first project entry"
  - "PR #4, open and unmerged, carrying the whole phase to main with its evidence"
affects: [post-launch, v1.1]

actuals:
  tokens: 8091
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "The form is the authority on what is mandatory: five required listing fields and a required screencast were discovered by opening the Partner Dashboard, not by reading the requirements"
    - "Audit every uploaded asset image by image before it ships — the PII in screenshot 4 was invisible in the filename, the dimensions and the commit message"

key-files:
  created:
    - .planning/phases/06-dashboard-onboarding-launch/06-08-SUMMARY.md
  modified:
    - .planning/phases/06-dashboard-onboarding-launch/06-LISTING.md
    - CHANGELOG.md
    - screenshots/S4.png
    - .gitignore

key-decisions:
  - "Support URL resolved as B1 (email only): the apex domain redirects to the demo store's password wall, so no link ships rather than one that cannot resolve"
  - "The hero screenshot came from a second development store, never from resetting production onboarding stamps"
  - "Screenshot 4's committed copy was cropped to the modal rather than left intact: a customer name, email, address and phone in the repo contradicts the app's own no-PII posture"
  - "Screencast.mov (36 MB) is gitignored, not committed — a video is not source and the listing is its home"
  - "The PR is opened and left unmerged, with an explicit hold on main while the submitted build is under review"

patterns-established:
  - "Pattern: pre-checkpoint automation — run every check the executor can run before parking, so the human's desktop session is only the browser-only remainder"
  - "Pattern: disclose in the artifact that carries the defect. The PII finding leads the listing's own waiting list rather than living only in a summary"

requirements-completed: [LNCH-03]

coverage:
  - id: D1
    description: "LNCH-03 — the app is submitted for Shopify App Store review with a complete, truthful listing and working reviewer access"
    requirement: "LNCH-03"
    verification:
      - kind: manual_procedural
        ref: "developer report 2026-08-24: Submit clicked on the App Store review page after the automated checks returned green; all preliminary steps complete including capabilities and the AI self-review acknowledgement"
        status: pass
    human_judgment: true
    rationale: "Submission happens in the Partner Dashboard, which no probe of ours can read. The state is asserted by the developer; everything upstream of the click is independently verified below."
  - id: D2
    description: "Pre-submission gate — suite, typecheck, lint, build, deployed smoke, billing probe and privacy URL all green at the submitted build"
    verification:
      - kind: unit
        ref: "npm test -> 838 passed / 28 files (2026-08-24)"
        status: pass
      - kind: command
        ref: "npm run typecheck && npm run lint && npm run build -> all exit 0; build/server/index.js 218.45 kB"
        status: pass
      - kind: integration
        ref: "scripts/smoke-deployed.sh app.creditguardhq.com -> /healthz 200 over valid TLS, forged HMAC 401 on all six webhook surfaces"
        status: pass
      - kind: integration
        ref: "scripts/prod-billing-state.sh -> wouldPassGate true, Credit Guard ACTIVE, trialDays 14, test false, 0.0 USD/EVERY_30_DAYS"
        status: pass
      - kind: command
        ref: "curl https://app.creditguardhq.com/privacy -> 200, title 'Privacy Policy — Credit Guard: B2B Net Terms'"
        status: pass
    human_judgment: false
  - id: D3
    description: "Listing compliance surfaces verified from the repo: mandatory GDPR webhooks, latest App Bridge via CDN, Polaris web components only"
    verification:
      - kind: command
        ref: "grep shopify.app.toml -> compliance_topics [customers/data_request, customers/redact, shop/redact]"
        status: pass
      - kind: command
        ref: "grep node_modules/@shopify/shopify-app-react-router/dist -> unversioned https://cdn.shopify.com/shopifycloud/app-bridge.js; zero '@shopify/polaris' React imports in app/; UI is s-page/s-card/s-grid web components"
        status: pass
    human_judgment: false
  - id: D4
    description: "Asset inventory meets spec — 1200x1200 icon, five screenshots at exactly 1600x900, feature media, English screencast"
    verification:
      - kind: command
        ref: "sips -g pixelWidth -g pixelHeight on all seven assets -> icon 1200x1200; S1-S5 all 1600x900"
        status: pass
      - kind: manual_procedural
        ref: "executor visual audit of all five screenshots 2026-08-23/24: no pricing, no reviews, no outcome claims, no browser chrome, no admin account menu"
        status: pass
      - kind: manual_procedural
        ref: "PII check FAILED on the retaken screenshot 4 — customer name, email, street address and phone legible behind the modal; repo copy cropped, listing copy still live"
        status: fail
    human_judgment: true
    rationale: "Dimensions are machine-checkable; whether a shot leaks something is a judgment made by looking at it. Doing so caught what the filename and dimensions could not."
  - id: D5
    description: "Branch-and-PR flow — a PR from the phase branch to main is open and unmerged"
    requirement: "LNCH-03"
    verification:
      - kind: command
        ref: "gh pr view 4 -> OPEN phase-06-dashboard-onboarding-launch -> main, mergeable MERGEABLE, https://github.com/future-beat/credit-guard/pull/4"
        status: pass
    human_judgment: false
  - id: D6
    description: "CHANGELOG v1.0.0 records the phase's merchant-visible surface and the eight closed WINDOWS fixes"
    verification:
      - kind: command
        ref: "grep -n '1.0.0' CHANGELOG.md -> line 3, '## 1.0.0 — 2026-08-24'"
        status: pass
    human_judgment: false
  - id: D7
    description: "Post-submission record — submission date, expected timeline, waiting list and WINDOWS disclosure written down"
    verification:
      - kind: other
        ref: "06-LISTING.md §10.1-10.5 and this SUMMARY's WINDOWS disclosure table"
        status: pass
    human_judgment: true
    rationale: "A plan for the waiting period is judged useful or not by the person who has to work it, not by a command."

duration: 2 days (three sessions across two blocking checkpoints)
completed: 2026-08-24
status: complete
---

# Phase 6 Plan 8: Submission Summary

**Credit Guard: B2B Net Terms was submitted to the Shopify App Store on 2026-08-24 against build `f1032f0` with 838 tests green — and the two things that made the difference were both found by looking rather than by planning: an ingest-latency bug that would have failed the reviewer's own setup instructions deterministically, and a customer's name, email, address and phone sitting in the screenshot uploaded to illustrate the credit hold.**

## Performance

- **Duration:** 2026-08-22T08:45Z → 2026-08-24T04:40Z, three working sessions separated by two blocking checkpoints
- **Tasks:** 3 (1 human-action checkpoint, 1 decision checkpoint, 1 executor task)
- **Commits by this executor:** 3
- **Files modified:** `06-LISTING.md`, `CHANGELOG.md`, `screenshots/S4.png`, `.gitignore`, plus seven asset files committed

## Accomplishments

- **LNCH-03 reached its terminal state.** Submitted 2026-08-24, immediately after the developer clicked Submit (the exact minute was not captured; this record was written at 04:36Z the same day). Listing, reviewer instructions, credentials, screencast, `read_all_orders` justification, emergency contact and pricing all complete; Shopify's automated checks green.
- **PR #4 is open and unmerged** — https://github.com/future-beat/credit-guard/pull/4 — carrying 53 commits with the phase's evidence, the migration rollback story, the WINDOWS ledger and an explicit hold on `main` while the submitted build is under review.
- **Everything the executor could check was checked before the human's desktop session began**, so that session was only the browser-only remainder: suite, typecheck, lint, build, deployed smoke, billing probe, privacy URL, GDPR webhook declarations, App Bridge CDN, Polaris web components, and live fixture state on both stores.
- **A blocking listing defect was caught before the form was filled:** `creditguardhq.com/support` — the URL the package told the developer to enter — redirects to the demo store's password wall, because the apex domain is attached to the demo store. Resolved as B1: no link ships, support is the monitored email.
- **The listing now records where the Partner Dashboard overruled the plan** (§9): five required fields the research never mentioned, a feature bullet dropped for containing the word "Shopify" (4.5.6), plan top-features that do exist at 40 characters, capabilities corrected to embedded-only, and a screencast that turned out to be **required** rather than the optional nicety the go/no-go had waived.
- **CHANGELOG v1.0.0** — the first project entry, stating the limitations alongside the features.

## Task Commits

1. **Task 1: [DESKTOP] assets, listing, automated checks** — `1684069` (docs) — §9 reconciliation, five screenshots, two icons
2. **Task 2: go/no-go** — decision checkpoint, no commit (the developer chose `submit-now-after-assets` and closed both raised gaps first)
3. **Task 3: PR, CHANGELOG, post-submission record** — `1ee6b34` (fix, PII redaction) and `8dc35bf` (docs, CHANGELOG + §10)

Interleaved orchestrator/sibling commits inside this plan's window: `d1f60ce` (mobile fix reverted at the developer's request), `8b1f452`..`8120f75` (ingest-latency gap closure), `57fb1a4` (retaken S1/S4), `e5dc387` (AI self-review report), `f1032f0` (landing-page fix).

## The two checkpoints, and what they bought

**Task 1** parked with everything preparable already prepared: paste-ready copy with character counts, a shot list with the exact fixture state per shot, the screencast beat list, the reviewer-instruction blocks, and eleven automated checks already green — plus one blocking finding (the support URL) and one decision (which store the hero would come from) surfaced *before* the developer opened a browser.

**Task 2** presented a 21-row readiness table and two findings the developer had not been asked about:

- **R1 — the buyer-facing credit hold was illustrated nowhere.** The shot in the S4 slot was a second dashboard view; with the screencast then believed waived, the app's headline claim had no visual evidence anywhere in the submission.
- **R2 — the hero was an empty dashboard** ($0.00, 0 overdue, 0 on hold) still carrying the incompleteness banner, shot before its own store healed.

Both were closed before Submit at a cost of about fifteen minutes. That is the entire case for the checkpoint: neither was a compliance failure, and neither would have been noticed by anything except opening the images.

## What changed between the go/no-go and Submit

| Change | Commit | Consequence |
|---|---|---|
| Screenshots 1 and 4 retaken | `57fb1a4` | R1 and R2 closed. Hero now shows real data ($973.75 outstanding, one company on credit hold, no banner, guided setup with its Done affordance) |
| **Screencast recorded** | listing only | The App testing section **required** a screencast URL. 4.5.3 is satisfied, not waived — the go/no-go's central risk evaporated because the form insisted |
| AI self-review run | `e5dc387` | 26 ✅ / 0 ❌ / 5 ⚠️ / 71 n/a |
| Template landing page replaced | `f1032f0` | Bare `/` had been serving the scaffold's placeholder page **and a shop-domain login form** — nobody had ever opened it un-embedded. 1.1.4 / 2.3.1 closed, `tests/landing-route.test.ts` added, verified live by curl |
| Listing finalised | — | Five bullets (the sixth contained "Shopify"), plan top-features rewritten to ≤40 chars, capabilities corrected to embedded-only |

## The submission blocker found by using the app

Between the two checkpoints the developer noticed new orders and companies taking hours to appear. Attribution was attempted **once**, at the first webhook; if Shopify had not yet indexed the order on the company edge, it was never retried until the daily 03:30Z reconciliation.

**This would have failed Track B deterministically.** The reviewer instructions promise a balance appears "within seconds" after creating a company and a net-terms order. On the pre-fix code a reviewer would have waited hours and concluded the app was broken — a rejection caused by the app's own documentation being true only on paper.

Fixed with re-attribution on later doorbells plus a five-minute `attribution-heal` sweep on its own lease, and **proven live and unattended** on the fresh store: `attributed 0 / unresolved 2 / dataComplete false` → `2 / 0 / true`, `attribution-heal` lease visible in the sweep table. Suite 808 → 820.

## Submission record

| Field | Value |
|---|---|
| Submitted | **2026-08-24**, reported immediately after the developer clicked Submit |
| Build under review | `f1032f0` — deployed, smoke PASS; production and branch code identical |
| Suite | **838 passing / 28 files** |
| PR | **#4, OPEN, unmerged** — https://github.com/future-beat/credit-guard/pull/4 |
| Demo store | `credit-guard-demo` — `dataComplete: true`, reminders on, Reviewer Test Co on credit hold (841.65 / 500.00) |
| Assets | icon 1200×1200; five screenshots 1600×900; unlisted screencast |
| Support | `support@creditguardhq.com`, no support URL (B1) |
| Reviewer mail | listing contact email, `noreply@shopify.com` allow-listed |

### Expected timeline

Official guidance is "up to 2 weeks"; 2026 community reports describe 3+ weeks before assignment; older guidance said 5–10 business days (06-RESEARCH A9, `[ASSUMED — community sources only]`). **Plan for 10–15 business days plus one resubmission round.** Each failed round forces a full resubmit, and consecutive failures after two exchanges can trigger a temporary submission suspension.

## ⚠ Screenshot 4 carries customer PII

Found by this executor at the start of Task 3, **after** submission. The retaken screenshot 4 is the admin's draft-order "Unresolved business rules" modal — which genuinely evidences the credit hold — but the page behind it is a live draft order whose right-hand panel is legible: **customer name, email address, street address, phone number**, plus the staff name in the header.

It contradicts §5's own rule, Shopify's screenshot guidance, and the posture this app has held since Phase 2 — that it touches no customer contact data at all.

| Where | State | Action |
|---|---|---|
| **Live App Store listing** | **uncropped, public-facing, in front of the reviewer** | **Replace in the Partner Dashboard — first action of the waiting period.** Re-shoot the storefront checkout refusal (the stronger asset anyway), or the same modal with the customer panel out of frame |
| Working tree | **redacted** — cropped to the modal alone | done (`1ee6b34`) |
| Git history | uncropped at `57fb1a4` | private repo; whether it is worth a rewrite is the orchestrator's call |

Why it got through: the shot was requested, produced and committed by three different actors, and each checked what it *showed* (a credit hold) rather than what it *contained*. Dimensions, filename and commit message were all correct.

## WINDOWS disclosure

| # | Item | State | Evidence |
|---|---|---|---|
| #3 | Post-uninstall webhook 500s | **CLOSED** | Named acknowledge-and-drop on all three ingest routes; transient-failure contract untouched |
| #8 | JWTs in the access log | **CLOSED — live** | 17/17 `id_token=[redacted]`, zero raw JWTs in the production log store |
| #10 | Exhaustion flip starvation | **CLOSED — live** | 2026-08-23T03:30Z tick, first on fixed code: `attributed 15 / unresolved 0 / noCompany 2`, `dataComplete: true` |
| #12 | `validationUpdate` TOCTOU | **CLOSED** | Documented at the echo site (comment-only by design) |
| #13 | Overdue-only block never staged | **CLOSED — live** | `BLOCK_STATE_ENTERED`, `overdue: true`, `5345.80 < 6000.00`, buyer read the shipped message verbatim |
| #20 | Outranked touchpoint retried | **CLOSED** | Severity fence + `SUPPRESSED_STALE`, true RED |
| #21 | Over-broad retry narrowing | **CLOSED** | Closed retriable-code set; ambiguity → `SENT_UNCONFIRMED` |
| #22 | Settings copy overstated scope | **CLOSED** | Settings + README state the company-only limit |
| #11 | EC-1 decimal capture | **OPEN — by design** | Behaviourally proven; `cartCents` normalises either format |
| #18 | Pay-now completion | **OPEN — by design** | Dev store refuses to transact even with the Bogus Gateway; needs a real gateway |
| #19 | Reminder delivery latency | **OPEN — by design** | 3.5–5 h on the dev store; confirm on a paid store |
| #4 | A2 partial-pay → refund | **WAIVED** | Partial payments are Plus-only; ICP is Basic/Grow/Advanced |

**Not edited by this executor, by instruction:** `.planning/WINDOWS.md`, `.planning/STATE.md`, `.planning/ROADMAP.md`. `.planning/REQUIREMENTS.md` was also left alone — LNCH-03 is now genuinely complete and is recorded in `requirements-completed` above, but this phase has marked requirements centrally throughout.

**New ledger candidates from this plan:** the screenshot-4 PII (listing + history); `tests/reminders.test.ts` "only ONE schedule per sweep" order-dependence on a reused DB; `tests/review-prompt.test.ts` 5 s timeout under parallel load; the mobile KPI row gap (reverted by choice at `d1f60ce`); and the guided setup's third step rendering its tick above rather than beside its heading.

## While waiting

1. **Replace screenshot 4** — PII, public, in front of a reviewer
2. **A real support page** (option B2) — support is email-only today
3. **#18 / #19 on a launch store with a real gateway** — the reminder → pay-now → balance-drops loop is the one story never demonstrated end to end
4. **#11 EC-1 decimal capture** from a Partner Dashboard Function run — optional
5. **06-07 F2** — persist the review-prompt result code (its own small plan; it is a schema change)
6. **`@shopify/shopify-app-react-router` 2.x for v1.1** — Node 22 image, drop the `AppProvider embedded` prop
7. **First production install** — confirm normal-latency reminder delivery and the billing gate on a store outside our Partner org
8. **Watch Sentry** for billing-check fail-open captures
9. **Fixture isolation** for the two test flakes
10. **Mobile KPI row gap** if it resurfaces as a priority

## Decisions Made

- **Support URL: B1 (email only).** A field left blank beats a link that lands on a password wall.
- **Hero from a second development store**, never from resetting production onboarding stamps for a cosmetic reason.
- **Screenshot 4's repo copy cropped rather than left intact.** The uncropped file remains in history and on the listing; both are disclosed rather than silently carried.
- **`Screencast.mov` (36 MB) gitignored.** A video is not source; the listing is its home.
- **PR opened, not merged**, with an explicit hold on `main` for the duration of the review.

## Deviations from Plan

**1. [Rule 2 - Missing Critical] The support URL in the listing package did not resolve**
- **Found during:** Task 1 pre-checkpoint automation
- **Issue:** §1.9 instructed the developer to enter `https://creditguardhq.com/support`. The apex domain is attached to the demo store, so it — and `/privacy`, and everything else under it — 302s to the storefront password page. `app.creditguardhq.com/support` is a 404. A support URL landing on a password wall is a listed rejection reason.
- **Fix:** Surfaced as a blocking finding with three costed options before the form was opened; the developer chose B1 (no URL, monitored email). Recorded in §9.5, and §1.9 corrected so the document cannot mislead a future session.
- **Files modified:** `06-LISTING.md`
- **Committed in:** `1684069`

**2. [Rule 2 - Missing Critical] Customer PII in an uploaded screenshot**
- **Found during:** Task 3 asset audit
- **Issue:** Retaken screenshot 4 exposes a customer name, email, street address and phone, plus a staff name.
- **Fix:** Repo copy cropped to the modal (`1ee6b34`); listing replacement raised as the first post-submission action in both `06-LISTING.md` §10.3 and this summary; git-history exposure stated rather than glossed.
- **Files modified:** `screenshots/S4.png`
- **Committed in:** `1ee6b34`

**3. [Scope] The screencast was waived at the go/no-go and then required by the form**
- **Found during:** Task 2 → Task 3 boundary
- **Issue:** The decision was presented on the basis that 4.5.3 would be knowingly waived, with a documented compensating argument. The Partner Dashboard's App testing section requires a screencast URL, so one was recorded.
- **Resolution:** §9.6 rewritten from "not produced — a disclosed gap" to "recorded, 4.5.3 satisfied". The superseded reasoning is not left in the document to be mistaken for current.
- **Files modified:** `06-LISTING.md`
- **Committed in:** `8dc35bf`

**4. [Scope boundary] Two test flakes reported, not fixed**
- **Found during:** Task 2 and Task 3 gates
- **Issue:** `tests/reminders.test.ts` "only ONE schedule per sweep" is order-dependent on a reused DB (fails on a pristine tree too); `tests/review-prompt.test.ts` "ask after a success moment" exceeded its 5 s timeout at 5259 ms when the suite ran concurrently with `build`, and was green in isolation on the next run.
- **Resolution:** Both recorded for ledger bundling. Neither is a product defect and neither was in this plan's scope.
- **Files modified:** none

---

**Total deviations:** 4 (2 missing-critical auto-fixed, 1 superseded-decision correction, 1 deliberate scope hold)
**Impact on plan:** All three tasks delivered. The two missing-critical findings were both listing defects invisible to the automated checks, and both were caught by looking at the artifact rather than at its metadata.

## Issues Encountered

- **The uncropped screenshot 4 is still live on the App Store listing.** No executor can change that; it is the first item of the waiting period.
- **The submitted build cannot be changed without consequence.** Anything landing on `main` before PR #4 merges becomes code under review that was never reviewed by us.
- **The exact submission minute was not captured.** Recorded as the date plus "immediately after clicking Submit"; this summary was written at 2026-08-24T04:36Z, which bounds it.

## Next Phase Readiness

**The milestone's terminal act is done.** The app is under review, the phase is on an open PR, and the waiting period has a written plan.

Nothing is blocked. The three items that will want a plan of their own once the review resolves: the screenshot replacement and support page (immediate), `#18`/`#19` on a launch store (needs a paid store), and the library 2.x upgrade for v1.1 (needs the review to be over first).

## Self-Check: PASSED

- `.planning/phases/06-dashboard-onboarding-launch/06-08-SUMMARY.md` — FOUND
- `.planning/phases/06-dashboard-onboarding-launch/06-LISTING.md` §9/§10 — FOUND (703 lines)
- `CHANGELOG.md` — `## 1.0.0 — 2026-08-24` at line 3 — FOUND
- Commits `1684069`, `1ee6b34`, `8dc35bf` — FOUND, all pushed
- `gh pr view 4` → **OPEN**, `phase-06-dashboard-onboarding-launch` → `main`, MERGEABLE, unmerged — VERIFIED
- `npm test` → **838 passed / 28 files**; typecheck, lint, build → PASS
- `scripts/smoke-deployed.sh` → PASS; billing probe → `wouldPassGate: true`; `/privacy` → 200
- `screenshots/S4.png` → 600×290, cropped to the modal, re-inspected for PII — CLEAN
- Working tree clean; `.planning/WINDOWS.md`, `STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md` untouched — VERIFIED

---
*Phase: 06-dashboard-onboarding-launch*
*Completed: 2026-08-24*
