---
phase: 06-dashboard-onboarding-launch
plan: 04
subsystem: billing
tags: [shopify-app-pricing, managed-pricing, billing-check, react-router, app-bridge, bfs, probe]

requires:
  - phase: 01-foundation
    provides: app/routes/app.tsx shell, AppProvider + s-app-nav, ErrorBoundary
  - phase: 02-ledger
    provides: startBackfill install kick, the prod-* probe pattern (railway ssh + base64 payload)
  - phase: 04-enforcement
    provides: ensureValidationRegistered ensure-step, BYPASSED_ORDER enforcement events
  - phase: 05-payment-reminders
    provides: paymentReminderSend as the reminder channel (the fact that retires the Resend rows)
provides:
  - Fail-open Shopify App Pricing subscription gate in the app.tsx loader (LNCH-01, D6-01)
  - Exported APP_HANDLE + pricingPlansUrl() helper — plan-page URL built from session.shop only
  - tests/billing-gate.test.ts — 10 specs pinning redirect target, pass-through, fail-open, ordering, and the nav shape
  - scripts/prod-billing-state.{mjs,sh} — the read-only E-1 instrument (does the Admin API see the contract?)
  - Two-item admin nav (Companies, Settings); the Home link is retired (BFS 4.1.4 #3)
  - A CLAUDE.md that no longer misstates draft-order bypass, the email stack, or the pinned library versions
affects: [06-06 launch checkpoints, app store review submission, any future plan touching app.tsx's loader]

actuals:
  tokens: 10200
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Subscription gate as a loader tail: side effects first, one uncached Admin round trip, redirect only on a SUCCESSFUL negative"
    - "Fail-open security gate: try/catch → Sentry → render; the redirect is issued only on `=== false`, so an unknown shape renders too"
    - "Constant-plus-session URL construction for any redirect that leaves the app's own origin"

key-files:
  created:
    - tests/billing-gate.test.ts
    - scripts/prod-billing-state.mjs
    - scripts/prod-billing-state.sh
  modified:
    - app/routes/app.tsx
    - .claude/CLAUDE.md

key-decisions:
  - "The gate is never cached: App Pricing emits no webhook, so a cached verdict is the only thing that could keep a FROZEN/CANCELLED merchant inside a paid app (plan-check I-01)"
  - "Redirect only on `hasActivePayment === false` from a check that resolved — a throw OR an unexpected shape both render the app (fail-open superset of the plan's wording)"
  - "No dashboard nav item at all, not a renamed one: a 'Dashboard' label is still a second item pointing at the homepage (BFS 4.1.4 #3)"
  - "Route paths are spelled out, never glob-written, in app.tsx line comments — a `/app/*` glob reads as an opening block comment to the shared source-guard comment stripper"
  - "Probe mirrors billing.check's rule (`activeSubscriptions` non-empty) rather than re-deriving one, and still prints `test` and the line-item price so a $0 dev contract is distinguishable from a real charge"

patterns-established:
  - "Fail-open gate: any error path renders the product and tells Sentry, never the merchant"
  - "Empirical instrument before reliance: the probe that tests a premise ships in the same plan as the code that depends on it, and runs before the deploy"

requirements-completed: [LNCH-01, LNCH-03]

coverage:
  - id: D1
    description: "No active subscription redirects the TOP window to the store's Shopify-hosted plan page, with the URL built from session.shop plus the constant app handle"
    requirement: "LNCH-01"
    verification:
      - kind: unit
        ref: "tests/billing-gate.test.ts#redirects the TOP window to the plan page when there is no subscription"
        status: pass
      - kind: unit
        ref: "tests/billing-gate.test.ts#builds the store handle from the session, never from a forged ?shop"
        status: pass
    human_judgment: false
  - id: D2
    description: "An active subscription (including the dev store's $0 contract) renders the app unchanged, and a thrown billing.check fails OPEN — app renders, Sentry captures, zero billing copy"
    requirement: "LNCH-01"
    verification:
      - kind: unit
        ref: "tests/billing-gate.test.ts#renders the app untouched when a subscription is active"
        status: pass
      - kind: unit
        ref: "tests/billing-gate.test.ts#fails OPEN when billing.check throws: app renders, Sentry hears it, merchant sees nothing"
        status: pass
    human_judgment: false
  - id: D3
    description: "The three install side effects are kicked off before the billing check, so a first session backfills while the merchant is away on the plan page"
    requirement: "LNCH-01"
    verification:
      - kind: unit
        ref: "tests/billing-gate.test.ts#kicks off all three side effects BEFORE the billing check"
        status: pass
    human_judgment: false
  - id: D4
    description: "Zero billing configuration exists in shopify.server.ts and no Billing API mutation exists anywhere — billing.check() works because the library force-enables unstable_managedPricingSupport"
    requirement: "LNCH-01"
    verification:
      - kind: unit
        ref: "tests/billing-gate.test.ts#keeps ZERO billing configuration in shopify.server.ts (D6-01)"
        status: pass
      - kind: unit
        ref: "tests/billing-gate.test.ts#uses the managed App Pricing read, never a Billing API mutation"
        status: pass
    human_judgment: false
  - id: D5
    description: "The admin nav has exactly two items, Companies and Settings; the redundant Home link is gone (BFS 4.1.4 #3)"
    requirement: "LNCH-03"
    verification:
      - kind: unit
        ref: "tests/billing-gate.test.ts#has exactly two nav links, Companies and Settings (BFS 4.1.4 #3)"
        status: pass
      - kind: unit
        ref: "tests/billing-gate.test.ts#has no link back to the app home — the app name in the sidebar IS that link"
        status: pass
    human_judgment: false
  - id: D6
    description: "scripts/prod-billing-state.{sh,mjs} report, read-only and in-container, the activeSubscriptions facts billing.check() reads, plus a wouldPassGate verdict — E-1's instrument"
    requirement: "LNCH-01"
    verification:
      - kind: other
        ref: "node --check scripts/prod-billing-state.mjs && bash -n scripts/prod-billing-state.sh && test -x scripts/prod-billing-state.sh"
        status: pass
    human_judgment: true
    rationale: "Parse and permission checks prove only that the probe runs. Whether the Admin API actually reports the App Pricing contract — the entire question E-1 exists to answer (RESEARCH A2) — can only be established by running this against credit-guard-demo after a human creates the plan. 06-06 carries that as a blocking halt."
  - id: D7
    description: "CLAUDE.md no longer claims bypassCartValidations exists in 2026-07, no longer lists Resend/react-email as the reminder stack, pins node-cron ^4.6.0, and records the shopify-app-react-router 1.2.1 pin with the 2.0.0 deferral"
    verification:
      - kind: other
        ref: "node -e introspection of app/types/admin-2026-07.schema.json — draftOrderComplete args are id, paymentGatewayId, sourceName; 0 occurrences of bypassCartValidations"
        status: pass
      - kind: other
        ref: "grep gates: 'lets merchants deliberately bypass validations'=0, 'Resend SDK'=0, paymentReminderSend>0, 'node-cron.*\\^4'>0"
        status: pass
    human_judgment: false

duration: 25 min
completed: 2026-08-21
status: complete
---

# Phase 06 Plan 04: Billing Gate, Nav, and the E-1 Probe Summary

**Fail-open Shopify App Pricing gate in the `app.tsx` loader — `billing.check()` with zero billing config, `_top` redirect to the store's plan page, running after the install side effects — plus the read-only production probe that must prove the premise before it ships.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-21T17:05:00Z
- **Completed:** 2026-08-21T17:29:41Z
- **Tasks:** 3 (Task 1 executed TDD: RED → GREEN)
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- **The LNCH-01 gate exists and cannot lock anyone out.** `billing.check()` runs on every `/app` document load with no billing configuration anywhere in the repo; a resolved `hasActivePayment: false` redirects the TOP window to `https://admin.shopify.com/store/{handle}/charges/credit-guard-net-terms/pricing_plans`. Anything else — a throw, a non-2xx surfaced as a throw, an unrecognised shape — renders the app and tells Sentry. Ten specs pin all of it.
- **Ordering is a tested property, not a comment.** `ensureShopActive`, `startBackfill` and `ensureValidationRegistered` are asserted (via `mock.invocationCallOrder`) to be called before `billing.check()`, so an unsubscribed merchant's first session still starts their backfill while they are on Shopify's plan page.
- **The open-redirect surface is closed by construction.** The URL is a constant handle plus `session.shop`; a request carrying `?shop=evil-store.myshopify.com` is proven to redirect to the session's own store (T-06-14).
- **E-1 has its instrument.** `scripts/prod-billing-state.{sh,mjs}` reads `currentAppInstallation { app, activeSubscriptions { … pricing } }` in-container over the existing `railway ssh` channel — the same query `billing.check()` issues — and computes `wouldPassGate` by that function's own rule. It prints no token and writes nothing.
- **Two-item nav.** `s-app-nav` is Companies + Settings; the Home link is gone and the comment now cites 06-UI-SPEC § Navigation with the BFS rejection reason.
- **Four CLAUDE.md rows are now true**, each backed by evidence re-verified in this session rather than carried over.

## Task Commits

1. **Task 1 (RED): failing gate + nav specs** — `c4effe1` (test) — 8 of 10 specs failing against the un-gated loader
2. **Task 1 (GREEN): the gate + nav** — `edbf613` (feat)
3. **Task 2: the E-1 probe** — `836aef3` (feat)
4. **Task 3: CLAUDE.md corrections** — `b72da2e` (docs)

## Files Created/Modified

- `app/routes/app.tsx` — exported `APP_HANDLE` and pure `pricingPlansUrl()`; loader destructures `{ session, billing, redirect }` and ends in the try/catch gate; nav reduced to two links with a 06-UI-SPEC citation
- `tests/billing-gate.test.ts` — 10 specs: redirect URL + `_top`, pass-through, fail-open + Sentry, side-effect ordering, forged-`?shop` resistance, the URL builder, and four source guards (nav shape, no `/app` self-link, no Billing API mutation, zero billing config in `shopify.server.ts`)
- `scripts/prod-billing-state.mjs` — read-only in-container probe: subscriptions with `status`/`test`/`trialDays`/`currentPeriodEnd`/recurring price + `planHandle`, `wouldPassGate`, the exact `pricingPlansUrl` the gate would use, session scopes/expiry, and the newest five migrations as a build marker
- `scripts/prod-billing-state.sh` — the `railway ssh` + base64 wrapper, mode 755, usage text pointing at the 06-06 halt
- `.claude/CLAUDE.md` — four rows corrected (see below)

## Decisions Made

- **Fail-open is implemented as a superset of the plan's wording.** The plan said "on `hasActivePayment === false`, redirect". The code redirects only on a strict `=== false` from a check that resolved, so an unexpected/`undefined` shape falls through and renders. That is what UI-SPEC's Billing Gate Contract asks for ("fail open") and it removes an entire class of lockout that a truthy/falsy test would have kept open.
- **No caching, deliberately.** Documented in the loader against plan-check I-01: App Pricing has no subscription webhook, so a cached verdict is the only mechanism that could keep a FROZEN or CANCELLED merchant inside a paid app; fail-open already pays the throttling/outage cost a cache would buy off.
- **The probe does not invent its own verdict rule.** `wouldPassGate` reproduces `billing.check()`'s predicate exactly (no `plans` filter, `isTest` defaulting to `true` ⇒ any active subscription counts), with the reasoning written out beside it, so E-1 measures the gate rather than a lookalike.
- **`sourceName` is how the app talks about bypass now.** With `bypassCartValidations` proven absent from 2026-07, CLAUDE.md's draft-order rows describe the observable fact (a `BYPASSED_ORDER` event after the order lands) instead of a mutation argument that does not exist.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree had no `node_modules` and no generated `app/types/`**
- **Found during:** Task 1 (before the first test run)
- **Issue:** The isolated worktree ships only tracked files; both `node_modules/` and `app/types/` are gitignored, so vitest could not start and `tsc` failed with `Cannot find module '../types/admin.generated'`.
- **Fix:** Symlinked the parent checkout's `node_modules` into the worktree and copied `app/types/` across, exactly as the execution brief anticipated. No dependency was installed and no `package.json` was touched.
- **Files modified:** none tracked (both paths are gitignored)
- **Verification:** `npm test` runs 597 tests; `npm run typecheck` clean.
- **Committed in:** n/a — nothing tracked changed

**2. [Rule 1 - Bug] A glob in a line comment silently blanked the source guards**
- **Found during:** Task 1 (GREEN — one guard stayed red after the gate was written)
- **Issue:** The loader comment said "one round trip per `/app/*` document load". `tests/helpers/module-source.ts` strips block comments **before** line comments, so `/*` inside that line opened a block comment that swallowed everything down to the next `*/` — 38 lines later, inside the JSX. The guard asserting `billing.check()` was in the source failed against code that was demonstrably there, and, worse, the swallowed region included the nav, so the nav guards were passing on an empty string.
- **Fix:** Reworded to "every route under `/app`", and recorded the rule in the comment itself so the next author does not reintroduce it.
- **Files modified:** `app/routes/app.tsx`
- **Verification:** All four source guards now assert against the full file; deliberately reverting the gate turns them red again.
- **Committed in:** `edbf613`

**3. [Rule 2 - Missing Critical] The library row still advertised `billing.require()`**
- **Found during:** Task 3
- **Issue:** The plan listed three corrections plus a version note for the `@shopify/shopify-app-react-router` row. That same row's rationale sold `billing.require()` "for the $25–30/mo subscription" — the Billing API path that D6-01 rules out and that App Pricing forbids once opted in. Leaving it would have contradicted the code shipped an hour earlier in the same plan.
- **Fix:** The row now describes `billing.check()` and the zero-config reason it works, alongside the 1.2.1 pin and the 2.0.0 deferral. Scope stayed inside the one row the plan already directed me to edit.
- **Files modified:** `.claude/CLAUDE.md`
- **Verification:** `git diff` touches six lines, all of them rows named in Task 3.
- **Committed in:** `b72da2e`

---

**Total deviations:** 3 auto-fixed (1 blocking environment, 1 bug, 1 missing critical)
**Impact on plan:** No scope creep. Deviation 2 is the notable one — without it the nav guards would have been green against nothing, which is the exact failure mode a source guard exists to prevent.

## Issues Encountered

- The `bypassCartValidations` claim was re-verified here rather than taken from 06-RESEARCH: `draftOrderComplete` in `app/types/admin-2026-07.schema.json` takes `id`, `paymentGatewayId`, `sourceName`, and the string occurs zero times in the schema. The correction rests on this run, not on a citation.
- `eslint` reports `no-undef` for `process` on every `scripts/*.mjs` (the existing probes included); `npm run lint` excludes that directory and is clean. Pre-existing, unrelated to this plan, not touched.

## Verification Results

| Check | Result |
|---|---|
| `npx vitest run tests/billing-gate.test.ts` | 10 passed |
| `npm test` | **597 passed / 23 files** (floor 587/22 + this plan's 10 specs in 1 new file) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | clean |
| `node --check` / `bash -n` / `test -x` on the probe pair | pass |
| `grep -v '^\s*//' app/routes/app.tsx \| grep -c 'href="/app"'` | 0 |
| Task 1 precondition (`caec650` and `main` are ancestors of HEAD) | both pass |

## Known Stubs

None.

## User Setup Required

None in this plan — but see below: the Partner Dashboard plan is a human step that **06-06** owns.

## Next Phase Readiness

**The gate is written, tested and NOT deployed. It must not reach Railway yet.** 06-06 owns the sequence, in this order:

1. **Human checkpoint — create the plan** in the Partner Dashboard listing's Pricing section: monthly, US$29, **Free trial duration 14**, **"Free for partners and developers" ticked** (without it the reviewer's out-of-org dev store faces a real charge and cannot proceed), welcome link `/app`, plus display name and top features.
2. **Run the E-1 probe** — `scripts/prod-billing-state.sh credit-guard-demo.myshopify.com | jq '{wouldPassGate, subscriptions}'` — after the demo store selects the $0 plan. **`wouldPassGate: false` is a hard halt:** deploying then would bounce every merchant to the plan page on every load, which is precisely the A2 risk this probe exists to retire.
3. Only then `railway up`, and re-check that the deployed app renders for the subscribed demo store.

Also carried forward: the probe echoes `pricingPlansUrl` so the documented locale-404 wart (E-4) can be reproduced by hand from its output without deploying anything.

Not touched by this plan, by instruction: `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/WINDOWS.md`, and `.planning/REQUIREMENTS.md` (LNCH-03 is shared with sibling wave-1/wave-2 plans; the orchestrator marks requirements centrally after the merge). `LNCH-03` above covers only this plan's share of it — the nav fix and the no-redirect-loop guarantee — not the listing assets, screencast or submission.

## Self-Check: PASSED

- All six key files present on disk (3 created, 2 modified, 1 summary).
- All five commits present on `worktree-agent-a1fbad3c69270ce38`: `c4effe1`, `edbf613`, `836aef3`, `b72da2e`, `4788990`.
- Every task `<verify>` block re-run after the final commit: gate suite 10/10, full suite 597/23, typecheck/lint/build clean, probe parse + executable-bit checks pass, `href="/app"` count 0 in code lines, all four Task-3 grep gates in their required state.
- No file deletions in any commit; working tree clean.

---
*Phase: 06-dashboard-onboarding-launch*
*Completed: 2026-08-21*
