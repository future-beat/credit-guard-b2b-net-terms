---
phase: 06-dashboard-onboarding-launch
plan: 05
subsystem: ui
tags: [react-router, polaris-web-components, prisma, postgres, app-bridge, onboarding, reviews-api]

requires:
  - phase: 06-dashboard-onboarding-launch
    provides: "06-01 — the dashboard route, its COPY object and the setup-guide insertion point"
  - phase: 06-dashboard-onboarding-launch
    provides: "06-02 — app/reminder-copy.ts / REMINDERS_CADENCE, the shared cadence sentence"
  - phase: 02-ledger-ingest
    provides: "readBackfillState / BackfillState behind step 1's live counts"
  - phase: 03-credit-controls-metafield-publishing
    provides: "Company.creditLimit, the derived fact behind step 2"
  - phase: 04-enforcement-function
    provides: "readValidationConfig (step 3's live status) and the EnforcementEvent kinds behind review eligibility"
  - phase: 05-payment-reminders
    provides: "ReminderLog SENT, the other success moment behind review eligibility"
provides:
  - "prisma/migrations/20260821175752_add_shop_onboarding_review — three nullable Shop columns, nothing else"
  - "app/setup-copy.ts — SETUP_COPY and the guide's rendered types, transport-free so a component can import them"
  - "app/review-codes.ts — REVIEW_RESULT_CODES, REVIEW_NEVER_EVALUATED_CODES, isReviewResultCode, stampsReviewPrompt (transport-free)"
  - "app/services/onboarding.server.ts — deriveSetupSteps/deriveSetupState/primaryCta (pure), loadSetupState, loadHomeOnboarding, markBalancesReviewed, dismissOnboarding, reviewEligibility, recordReviewPromptResult"
  - "app/routes/app._index.tsx — the guided-setup section, the three-intent action, the post-mount review effect, and R2 composed from the shared cadence"
  - "tests/onboarding.test.ts (39 specs) and tests/review-prompt.test.ts (38 specs)"
affects: [06-06, 06-07, 06-08]

actuals:
  tokens: 61000
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Transport-free sibling modules (app/setup-copy.ts, app/review-codes.ts) for anything a route COMPONENT renders, with the .server module re-exporting them so server code keeps one import"
    - "Derive-don't-store: only the two acts of a human get columns; every other step re-derives per load and cannot go stale"
    - "Visibility-gated Admin reads: the one GraphQL call on the home path lives behind the dismissed short-circuit"

key-files:
  created:
    - prisma/migrations/20260821175752_add_shop_onboarding_review/migration.sql
    - app/services/onboarding.server.ts
    - app/setup-copy.ts
    - app/review-codes.ts
    - tests/onboarding.test.ts
    - tests/review-prompt.test.ts
  modified:
    - prisma/schema.prisma
    - app/routes/app._index.tsx
    - tests/dashboard.test.ts
    - scripts/prod-ledger-state.mjs

key-decisions:
  - "SETUP_COPY and the guide's render types were lifted into app/setup-copy.ts after `react-router build` caught the 04-04 trap — a component cannot import a runtime value out of a .server module"
  - "Step 1's 'Open companies' link is dropped once the step completes, alongside its button: there is nothing left to go and review"
  - "loadHomeOnboarding answers both halves of the page off ONE Shop read rather than letting the setup and review paths each query it"
  - "reviewEligibility returns false for a shop with no row at all — an uninstalled or unknown store is never asked"
  - "Counts in step 1's body are grouped via Intl.NumberFormat (locale from the loader, en-US default), matching the dashboard's own integer rendering"

patterns-established:
  - "Statement-level import guards (`/^\\s*import\\s/m`) rather than substring greps, so prose containing the word 'imported' cannot defeat the check"
  - "Two table-driven spec sets pin a decision with two sides — the eight codes that stamp and the three that do not — plus a third spec asserting their union IS the whole vocabulary"

requirements-completed: [DASH-03, LNCH-02]

coverage:
  - id: D1
    description: "One strictly additive migration adds onboardingReviewedAt, onboardingDismissedAt and reviewPromptedAt as nullable columns"
    requirement: "DASH-03"
    verification:
      - kind: command
        ref: "grep -c 'ADD COLUMN' prisma/migrations/*add_shop_onboarding_review/migration.sql -> 3; grep -Ec 'DROP|ALTER COLUMN|RENAME' -> 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "The guided setup renders three steps — live backfill counts and a 'Looks right' stamp, a deep link to set the first limit, and a live enforcement-status confirmation with no mutation surface"
    requirement: "DASH-03"
    verification:
      - kind: unit
        ref: "tests/onboarding.test.ts#guided setup step 1 (DASH-03)"
        status: pass
      - kind: unit
        ref: "tests/onboarding.test.ts#guided setup step 2 (DASH-03)"
        status: pass
      - kind: unit
        ref: "tests/onboarding.test.ts#guided setup step 3 (D6-03 — status, not a switch)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Progress, the single-primary-CTA rule, and a 'Done' offered only at 3/3 that dismisses the guide for good"
    requirement: "DASH-03"
    verification:
      - kind: unit
        ref: "tests/onboarding.test.ts#progress and the single primary button (UI-SPEC C1)"
        status: pass
      - kind: integration
        ref: "tests/onboarding.test.ts#dismissing the guide"
        status: pass
    human_judgment: false
  - id: D4
    description: "readValidationConfig runs only while the guide is visible; once dismissed the home loader is a pure Postgres projection again"
    verification:
      - kind: integration
        ref: "tests/onboarding.test.ts#the live validation read"
        status: pass
    human_judgment: false
  - id: D5
    description: "Review eligibility is a genuine success moment on this shop's own rows, and nothing else qualifies"
    requirement: "LNCH-02"
    verification:
      - kind: integration
        ref: "tests/review-prompt.test.ts#review eligibility (LNCH-02)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The B-01 stamp rule: eight evaluated outcomes close the question, three never-evaluated codes leave it open, forged codes are refused"
    requirement: "LNCH-02"
    verification:
      - kind: integration
        ref: "tests/review-prompt.test.ts#recording the prompt result (B-01)"
        status: pass
      - kind: integration
        ref: "tests/review-prompt.test.ts#the review moment on the home route"
        status: pass
    human_judgment: false
  - id: D7
    description: "The ask happens once per eligible load from a post-mount effect, never from a button, with no copy of ours anywhere near it (policy 1.3.1)"
    requirement: "LNCH-02"
    verification:
      - kind: unit
        ref: "tests/review-prompt.test.ts#review prompt source guards (policy 1.3.1)"
        status: pass
    human_judgment: false
  - id: D8
    description: "R2's cadence sentence is composed from the shared REMINDERS_CADENCE, byte-identical to Settings"
    verification:
      - kind: unit
        ref: "tests/dashboard.test.ts#composes the reminder cadence from the shared constant (R2, W-04)"
        status: pass
      - kind: unit
        ref: "tests/dashboard.test.ts#takes its cadence wording from the shared module, not a literal (W-04)"
        status: pass
    human_judgment: false
  - id: D9
    description: "On the dev store, Shopify's review modal appears once on the first dashboard load after a success moment and reviewPromptedAt reads stamped through the probe (E-2)"
    verification: []
    human_judgment: true
    rationale: "Only a real embedded admin can show (or decline to show) Shopify's own modal; the App Bridge surface cannot be exercised from node. Carried as 06-06's E-2 empirical check."
  - id: D10
    description: "The guide reads as intended at real admin widths — icon/tone distinctions, the inline spinner beside step 1's running body, row rhythm and divider placement"
    verification: []
    human_judgment: true
    rationale: "Visual fidelity of Polaris web components in the embedded admin can only be judged by looking at it; the UI-SPEC carries these as backstop checks."

duration: 35min
completed: 2026-08-22
status: complete
---

# Phase 6 Plan 05: Guided Setup and the Review Moment Summary

**A new install now lands on a three-step guide backed by one additive Shop migration — live import counts, a deep link to the first credit limit, and enforcement status read live from Shopify — and the app asks for an App Store review exactly once, from a post-mount effect, only after something has genuinely worked.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 (1 tracer + 2 TDD)
- **Files:** 10 (6 created, 4 modified)
- **Suite:** 807 passed / 27 files (floor was 730 / 25 — this plan adds 77 specs and 2 files)

## Accomplishments

- **One strictly additive migration.** `20260821175752_add_shop_onboarding_review` is three `ADD COLUMN … TIMESTAMP(3)` lines and nothing else, so main stays deployable against the migrated database throughout the wave.
- **The guide derives itself.** Only two facts got columns, because only two are acts of a human: "I looked at the balances" and "I'm done with this guide". Steps 2 and 3 re-derive on every load — from `Company.creditLimit` and from Shopify's own answer about our checkout rule — so a merchant who removes every limit sees step 2 honestly reopen, and nothing can go stale the way a cached boolean would.
- **Step 3 confirms, it does not switch (D6-03).** The app already registers its Validation on every load, so a "turn it on" button would either duplicate that or lie about it. Instead the row reports what Shopify currently says — active, disabled or unregistered — with a pointer to Settings → Checkout and no new mutation surface anywhere in the plan.
- **The outage-proofing rule is structural, not incidental.** `loadSetupState` short-circuits on `onboardingDismissedAt` **before** any other read, so the single Admin GraphQL call on the home path exists only while the guide is visible. Both halves are spec-pinned: the admin transport is called while visible, and never once dismissed.
- **The review moment can neither nag nor silently give up.** Eligibility needs a real success moment on this shop's own rows (a credit hold, a bypassed order, or a reminder genuinely sent — a release, a bypass toggle, an unconfirmed send and a failure all deliberately do not count). The ask fires once per eligible load from a `useEffect`, with no UI, no copy, no timer and no retry loop.
- **B-01 implemented as two tables, not one rule.** Eight evaluated outcomes stamp `reviewPromptedAt` and close the question for good; the three codes under which Shopify never evaluated the request leave it null so a later load may ask once more. A third spec asserts the two sets' union IS the entire App Bridge vocabulary, so a code added upstream fails loudly rather than falling quietly into the invalid branch.
- **The cadence sentence now exists in exactly one place.** R2 composes from `REMINDERS_CADENCE`, 06-01's tripwire is flipped to demand the import, and a guard asserts the literal `"3 days before the due date"` no longer appears in the route at all.

## Task Commits

1. **Task 1 (tracer): step 1 end to end** — `164347a` (feat)
2. **Task 2: steps 2-3, Done, live status read** — `3e8d899` (test, RED) → `99acd54` (feat, GREEN)
3. **Task 3: the review moment, R2 swap, probe columns** — `efb3f39` (test, RED) → `70bfad0` (feat, GREEN)

## Files Created/Modified

- `prisma/schema.prisma` — three nullable `Shop` columns, each with a doc comment stating its single writer and why it is never cleared.
- `prisma/migrations/20260821175752_add_shop_onboarding_review/migration.sql` — **the folder name Prisma generated, kept verbatim** (never renamed: `_prisma_migrations` records this name, and 06-06's substring check matches `add_shop_onboarding_review` regardless of timestamp).
- `app/services/onboarding.server.ts` — the pure derivation (`deriveSetupSteps`, `deriveSetupState`, `primaryCta`), the reads (`readOnboardingShopRow`, `loadSetupState`, `loadHomeOnboarding`), the two setup writes and the two review functions.
- `app/setup-copy.ts` **(new)** — `SETUP_COPY` and the guide's rendered types. Import-free.
- `app/review-codes.ts` **(new)** — the eleven result codes, the three never-evaluated ones, and the two predicates. Import-free.
- `app/routes/app._index.tsx` — the setup section at 06-01's insertion point, the closed-set action, `useReviewPrompt`, and R2 composed from the shared constant.
- `tests/onboarding.test.ts` **(new, 39 specs)** · `tests/review-prompt.test.ts` **(new, 38 specs)** · `tests/dashboard.test.ts` — R2 byte-exact plus the flipped W-04 guard.
- `scripts/prod-ledger-state.mjs` — a read-only `shop.onboarding` block printing the three stamps for 06-06's E-2.

## The client/server split this plan had to draw

`react-router build` failed with *"Server-only module referenced by client: '../services/onboarding.server' imported by route 'app/routes/app._index.tsx'"* the first time the component rendered `SETUP_COPY`. That is the 04-04 trap exactly: it typechecks, every unit test passes, and only the production build objects. Two transport-free modules resolve it, in the same shape `app/block-messages.ts` and `app/reminder-copy.ts` already use:

| Module | Ships to | Why it cannot live in the service |
|--------|----------|------------------------------------|
| `app/setup-copy.ts` | client + server | The component renders the strings and walks `SetupStep` |
| `app/review-codes.ts` | client + server | The browser validates Shopify's code before posting it |

Both are guarded by a **statement-level** regex (`/^\s*import\s/m`) rather than a substring grep, because step 1's copy legitimately contains "imported" and "importing" — a `toContain("import")` guard fails on its own prose.

## Decisions Made

1. **Copy and render types were lifted out of the service** (above). The service re-exports them, so server code still has one import and `tests/onboarding.test.ts` reads `SETUP_COPY` from either module — a spec asserts the two are the same object.
2. **Step 1's "Open companies" link goes when its button goes.** UI-SPEC hides buttons on completed steps; the link is the same affordance in a different weight, and a completed review has nothing left to go and look at.
3. **`loadHomeOnboarding` answers both halves off one `Shop` read.** The setup state and the review flag hinge on the same row; issuing that query twice on the app's most-loaded page for a tidier signature is the kind of small waste nobody ever notices again.
4. **A shop with no row is never asked for a review** and renders the failed-import body — an unknown or uninstalled store is not a merchant to prompt.
5. **Counts are grouped** (`Intl.NumberFormat`, locale from the loader, `en-US` default), matching how the dashboard renders every other integer.
6. **I-06 accepted as designed:** on a store where the merchant switched the checkout rule off, step 3 cannot complete from inside the app. The guide persists with "Open settings". That persistence is the intended nudge, not a defect, and it is spec-pinned.

## Deviations from Plan

### Catalog substitution (hard rule 4 — the live catalog wins over the spec)

**1. `s-spinner` has no `size="small"` in `@shopify/polaris-types@1.0.1`**
- **Found during:** Task 1 (typecheck of step 1's running row)
- **Issue:** UI-SPEC § Loading specifies `s-spinner size="small"`; `SpinnerProps` accepts only `base | large | large-100`.
- **Fix:** `size="base"` — the smallest size that exists — with the substitution commented in place.
- **Files modified:** `app/routes/app._index.tsx`
- **Verification:** `npm run typecheck` clean.
- **Committed in:** `164347a`

### [Rule 3 - Blocker] The 04-04 build trap on `SETUP_COPY`

- **Found during:** Task 3, at the plan's `npm run build` gate
- **Issue:** the route component imported a runtime value (`SETUP_COPY`) from `onboarding.server.ts`, which owns Prisma and the Admin client. Typecheck, lint and all 27 test files were green; `react-router build` was not.
- **Fix:** `app/setup-copy.ts` and `app/review-codes.ts` as transport-free modules, re-exported by the service; two new guard specs (`imports nothing, so a component can render it`, `keeps the page's copy identical to the service's`).
- **Verification:** `npm run build` clean, both client and server bundles.
- **Committed in:** `70bfad0`

**Total deviations:** 1 catalog substitution, 1 auto-fixed blocker.
**Impact on plan:** none on behaviour or copy — one rendering-mechanism swap and one module split that the plan's own build gate was written to catch.

## Verification

- `npx vitest run tests/onboarding.test.ts` — 39 passed · `tests/review-prompt.test.ts` — 38 passed · `tests/dashboard.test.ts` — 79 passed
- Migration SQL: `grep -c "ADD COLUMN"` → **3**; `grep -Ec "DROP|ALTER COLUMN|RENAME"` → **0**
- `node --check scripts/prod-ledger-state.mjs` — clean
- `npm run typecheck` — clean · `npm run lint` — clean · `npm run build` — clean (no server import leaked into the client bundle)
- `npx vitest run` — **807 passed / 27 files** (floor 730 / 25)
- Route guards: `reviews.request()` appears once; the token `attention` appears zero times; `REMINDERS_CADENCE` appears twice (import + composition)
- Scratch database `creditguard_test_0605` created, migrated, used and dropped. Production was never pointed at.

## Next Phase Readiness

- **06-06 (E-2, live):** on `credit-guard-demo` — which already has `BLOCK_STATE_ENTERED` and `SENT` rows — the first dashboard load should show Shopify's review modal once, and `node scripts/prod-ledger-state.mjs` should then print a non-null `shop.onboarding[].reviewPromptedAt`. A `recently-installed` code is the one outcome that legitimately leaves it null; that is B-01 working, not a failure, and the next load asks again.
- **06-06 migration check:** match on the substring `add_shop_onboarding_review` in `_prisma_migrations`, not on the timestamp.
- **Cadence constant:** `app/reminder-copy.ts` → `REMINDERS_CADENCE`, imported by `app/routes/app.settings.tsx` (06-02) and now `app/routes/app._index.tsx`. Any future cadence change edits one string.
- **Not updated by this executor, by instruction:** `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/WINDOWS.md`. DASH-03 and LNCH-02 are recorded in `requirements-completed` above.
- **No stubs.** Every step renders from a real read; nothing is placeholdered.

## Self-Check: PASSED

All six created files and this summary exist on disk; all five task commits (`164347a`, `3e8d899`, `99acd54`, `efb3f39`, `70bfad0`) are present in `git log` on `phase-06-dashboard-onboarding-launch`.

---
*Phase: 06-dashboard-onboarding-launch*
*Completed: 2026-08-22*
