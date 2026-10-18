---
phase: 03-credit-controls-metafield-publishing
plan: 03
subsystem: ui
tags: [react-router, polaris-web-components, prisma, app-bridge, compare-and-swap, decimal]

requires:
  - phase: 03-01
    provides: "publishCompanyCreditState + shopDataComplete, and the recomputeCompany publish hook the settings action rides"
  - phase: 02-ar-ledger-credit-engine
    provides: "Company/LedgerOrder rows, recomputeCompany, readBackfillState, the admin-client test seam"
  - phase: 01-foundation-compliance
    provides: "app.tsx shell, ErrorBoundary, s-app-nav reserved slot, copy-as-named-constants convention"
provides:
  - "app/routes/app.companies.tsx — the merchant's control plane: loader over the local ledger, intent-dispatched action, inline-edit index table"
  - "Value-echo CAS on credit-limit writes (409 on stale, never last-write-wins)"
  - "L-03 money grammar validation as a reusable route-level pattern (grammar then Decimal, never float)"
  - "Companies nav item — the Phase 1 reserved slot is consumed; Settings stays reserved"
  - "tests/companies-settings.test.ts — 59 tests covering intents, CAS, concurrency, forgery, rendering derivation and copy"
affects: [04-checkout-enforcement-function, 05-reminders, 06-dashboard]

actuals:
  tokens: 14600
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Mutation-bearing admin route: authenticate.admin first, whitelisted intent switch, 400 default that mutates nothing"
    - "Value-echo CAS in the Prisma WHERE clause (null echo = IS NULL) instead of an updatedAt token"
    - "Integer-cents comparison over fixed-2 decimal strings for money boundaries in the UI"
    - "Confirmed-not-optimistic form control (limit) alongside optimistic-with-revert (bypass), both on per-row fetchers"
    - "Admin-session route testing: stub only authenticate.admin, keep the admin-client seam and Postgres real"

key-files:
  created:
    - app/routes/app.companies.tsx
    - tests/companies-settings.test.ts
  modified:
    - app/routes/app.tsx

key-decisions:
  - "Cross-shop and unknown companyIds return 404, not the 409 the CAS would otherwise produce — the two failures mean different things to the UI and only one of them should tell a merchant to re-check the value"
  - "The CAS echo is captured once when the editor mounts, never re-read from loader data, so a background revalidation cannot refresh the echo into agreement with the write it should have blocked"
  - "Bypass optimism is read off fetcher.formData rather than component state, which makes revert-on-error a consequence of the fetcher settling instead of a state machine that can desync"
  - "Enforcement-bypassed badge uses tone=caution — the app-home catalog has no attention tone, so the UI-SPEC's semantic mapping resolves here (03-RESEARCH.md verified the enum)"
  - "Currency for the shared formatter comes from the shop-wide branch of the L-04 source (most recently refetched order), because the UI-SPEC mandates ONE formatter for the whole table"
  - "Keyboard save/discard is a native listener on the money field rather than a wrapper element's onKeyDown, keeping the table cell's DOM exactly what Polaris expects"

patterns-established:
  - "Copy-as-named-constants extended to a 17-row contract, exported so tests can assert the strings byte for byte"
  - "Source guards on a route file (comment-stripped) for tone choices, float-parsing and Polaris React imports"

requirements-completed: [CRED-01, CRED-02, CRED-04]

coverage:
  - id: D1
    description: "Merchant can set, edit and remove a per-company credit limit; empty field and Remove limit both persist null, 0 persists as a real block-all limit"
    requirement: CRED-01
    verification:
      - kind: integration
        ref: "tests/companies-settings.test.ts#set-limit > sets a limit on an unset company and republishes"
        status: pass
      - kind: integration
        ref: "tests/companies-settings.test.ts#set-limit > persists null when the field is submitted empty (remove via clear)"
        status: pass
      - kind: integration
        ref: "tests/companies-settings.test.ts#set-limit > persists zero as a real limit, never as null (D-02)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Limit input is grammar-validated server-side and rejected rather than coerced (1e9, -0, NaN, 1,000, 5.999, 14 digits)"
    requirement: CRED-01
    verification:
      - kind: integration
        ref: "tests/companies-settings.test.ts#set-limit > rejects %s without touching the row (10 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Concurrent limit edits resolve with exactly one winner via value-echo CAS; the loser gets 409 stale and the DB does not move"
    requirement: CRED-01
    verification:
      - kind: integration
        ref: "tests/companies-settings.test.ts#set-limit > rejects a stale echo with 409 and leaves the winner's value in place"
        status: pass
      - kind: integration
        ref: "tests/companies-settings.test.ts#set-limit > resolves two concurrent edits with exactly one winner"
        status: pass
      - kind: integration
        ref: "tests/companies-settings.test.ts#set-limit > matches a null echo only against rows whose limit IS NULL"
        status: pass
    human_judgment: false
  - id: D4
    description: "Bypass toggle persists both directions, is idempotent, resolves concurrent flips last-write-wins, and never disturbs any other cell"
    requirement: CRED-02
    verification:
      - kind: integration
        ref: "tests/companies-settings.test.ts#set-bypass (6 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every mutation is shop-scoped from the authenticated session; forged cross-shop companyIds and unknown intents mutate nothing"
    verification:
      - kind: integration
        ref: "tests/companies-settings.test.ts#set-limit > cannot write another shop's company (T-03-01)"
        status: pass
      - kind: integration
        ref: "tests/companies-settings.test.ts#set-limit > ignores a shop supplied in the form body (session is the only source)"
        status: pass
      - kind: integration
        ref: "tests/companies-settings.test.ts#intent dispatch (2 tests)"
        status: pass
      - kind: unit
        ref: "tests/companies-settings.test.ts#source guards > reads shop from the session, never from the form body"
        status: pass
    human_judgment: false
  - id: D6
    description: "Loader renders from the local ledger only, shop-scoped, sorted name A-Z with an id tie-break, paged at 50, carrying data_complete and backfill status"
    requirement: CRED-04
    verification:
      - kind: integration
        ref: "tests/companies-settings.test.ts#loader (6 tests)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Status derivation: at-limit is within, one cent over flips to Over limit, overdue outranks everything, null limit reads Observe only"
    requirement: CRED-04
    verification:
      - kind: unit
        ref: "tests/companies-settings.test.ts#status derivation (6 tests)"
        status: pass
      - kind: unit
        ref: "tests/companies-settings.test.ts#utilization (4 tests)"
        status: pass
    human_judgment: false
  - id: D8
    description: "UI-SPEC copy is byte-exact, D-01's column order is locked, the bypass badge is caution-toned, and no success tone or enforcement language exists on the page"
    verification:
      - kind: unit
        ref: "tests/companies-settings.test.ts#copy contract (2 tests)"
        status: pass
      - kind: unit
        ref: "tests/companies-settings.test.ts#source guards (5 tests)"
        status: pass
    human_judgment: false
  - id: D9
    description: "Companies nav item renders under the existing layout and ErrorBoundary; Settings stays unrendered"
    verification:
      - kind: other
        ref: "grep -c 'href=\"/app/companies\"' app/routes/app.tsx == 1 && npm run build"
        status: pass
    human_judgment: false
  - id: D10
    description: "Inline-edit and bypass interaction rendering inside the Shopify admin — one-row-at-a-time editing, Enter/Escape, in-flight disabling, staleness toast, badge stacking, narrow-width layout"
    verification: []
    human_judgment: true
    rationale: "Rendering inside the embedded admin iframe is not automatable in this harness; the four UI-SPEC backstop must_haves are staged as end-of-phase dev-store UAT"

duration: 22min
completed: 2026-08-20
status: complete
---

# Phase 3 Plan 3: Companies Settings Page Summary

**Merchant-facing Companies index table with inline credit-limit editing guarded by value-echo CAS, a per-row bypass toggle, and grammar-validated Decimal money — every settings write recomputing and republishing `credit_v1` in-request.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-08-20T00:52:00Z
- **Completed:** 2026-08-20T01:14:00Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- **The phase's merchant surface exists.** `app/routes/app.companies.tsx` is the app's first mutation-bearing admin route: a shop-scoped loader over the local ledger (never the Admin API), an intent-dispatched action, and the D-01 six-column index table with per-row inline editing.
- **Concurrent limit edits cannot silently overwrite each other.** The save echoes the limit the row was rendered with, and that value sits in the update's WHERE clause. Two simultaneous edits produce exactly one winner and one 409; the loser's UI refreshes and says so. The `updatedAt`-token alternative was rejected upstream for good reason — `recomputeCompany` touches that column on every webhook and every hourly sweep, so routine ledger churn would have produced false staleness on a field nobody edited.
- **Money never becomes a float.** `^\d{1,13}(\.\d{1,2})?$` gates every limit before `Prisma.Decimal` construction, and the UI's over-limit comparison runs on integer cents parsed from fixed-2 strings. "5.999" is rejected, not rounded to 6.00 behind the merchant's back, and a company sitting exactly on its limit is within it — one cent more flips the badge.
- **The tenant boundary is doubled.** Shop comes only from `authenticate.admin`; a forged companyId is caught by an ownership lookup AND by `shop` in every mutation's WHERE, so it matches zero rows twice over.
- **The page tells the truth about what is built.** No success tone, no "protected", no "enforcing" — asserted by source guard. Nothing on this page claims enforcement, because the Function that enforces does not exist until Phase 4. "Within limit" and "Observe only" both stay accurate after Phase 4 ships, so no copy will need rewording.

## Task Commits

1. **Task 1: Loader + action — intent dispatch, value-echo CAS, grammar validation** — `edb4cba` (feat, TDD red-first)
2. **Task 2: Table UI — display mode, badges, value rendering, nav, copy constants** — `46d262e` (feat)
3. **Task 3: Inline-edit + bypass interactions — fetchers, save semantics, toasts** — `9b1752c` (feat)

## Files Created/Modified

- `app/routes/app.companies.tsx` (created, 868 lines) — loader (companies + data_complete + backfill status + shop currency, sorted, paged at 50), action (`set-limit` value-echo CAS, `set-bypass`), the 17-row copy contract as exported constants, the index table, `LimitEditor`, `BypassSwitch`, and the pure `primaryStatusOf` / `utilizationLabel` derivations.
- `tests/companies-settings.test.ts` (created, 897 lines) — 59 tests: loader scoping/sort/paging, intent whitelist, limit CRUD, 10 grammar rejections, staleness and true concurrency, null-echo semantics, cross-shop forgery, bypass behaviour, response-shape contracts, status/utilization derivation, byte-exact copy, and five source guards.
- `app/routes/app.tsx` (modified) — the reserved nav slot now renders Companies; the comment was updated to record that Settings remains reserved.

## Decisions Made

- **404 vs 409 on a missing row.** A raw CAS returns `count === 0` for both "someone else changed it" and "that company isn't yours". Those mean different things to the merchant, so the action does an ownership lookup first: unknown/foreign id → 404 (`not-found`, which the editor surfaces as row 11's save-failure copy), stale echo → 409 (row 12's staleness toast + revalidate). Both mutate nothing.
- **The echo is captured at editor mount, not read at submit.** Reading `row.creditLimit` when the form submits would let a background revalidation refresh the echo to whatever a concurrent editor just wrote — the CAS would then match and overwrite exactly the change it exists to protect.
- **Bypass optimism lives in `fetcher.formData`.** The displayed switch state is the in-flight submission's value when there is one and the server's value otherwise. Revert-on-error falls out of the fetcher settling; there is no second copy of the truth to desync.
- **`tone="caution"` for Enforcement bypassed.** The UI-SPEC's semantic is "attention without alarm", but the app-home catalog has no `attention` tone (03-RESEARCH verified the enum verbatim). Hard rule 4 says the live catalog wins; `caution` is the mapping, and a source guard now prevents `attention` from creeping back in.
- **One shop-level currency for the shared formatter.** The UI-SPEC mandates a single `Intl.NumberFormat` for Exposure and Credit limit, so the loader takes the shop-wide branch of the same L-04 source the metafield payload uses (most recently refetched order's currency). With no orders yet, amounts format to two places with grouping and no symbol rather than guessing one.
- **Native keydown listener over a wrapper element.** Enter/Escape are bound directly to the `s-money-field` host (keydown is composed, so it crosses the shadow boundary) instead of wrapping the cell in a `<div onKeyDown>`. That keeps the table cell's DOM exactly what Polaris expects and adds no non-Polaris element.

## Deviations from Plan

None — plan executed exactly as written. The three tasks, their file ownership, and every `<automated>` gate ran verbatim.

Two small implementation choices went beyond the literal plan text without contradicting it, both recorded above as decisions rather than deviations: the 404/409 split (the plan specified "CAS/update WHERE matches zero rows → failure response"; this makes the failure legible to the UI), and capturing the CAS echo at mount (the plan said "the value the row rendered with" — capturing at mount is what makes that literally true).

## Issues Encountered

- **`getAdminContext` mock shape.** The first test run showed publish never firing. The mock was resolving `{ admin }`, but `graphqlJson` expects `getAdminContext` to resolve the client itself — every existing suite wires `mockResolvedValue(admin)`. Corrected; the publisher's non-throwing contract had quietly swallowed the resulting error, which is exactly why the assertion counted Admin calls rather than trusting a return value.
- **`react-hooks/refs` lint error.** The first keyboard implementation assigned to a ref during render to keep the listener effect mount-only. Restructured into two effects — focus on mount, listener keyed on `[save, value, onDone]` — which is lint-clean and costs one listener swap per keystroke.
- **Fresh worktree needed codegen.** `app/types` is gitignored, so `npm run graphql-codegen` had to run before typecheck would pass (flagged by 03-01; no surprise, recorded for the next worktree).

## User Setup Required

None — no external service configuration required. The `write_companies` scope and the `credit_v1` definition were handled in 03-01/03-05.

## Next Phase Readiness

- **Ready for Phase 4.** The merchant can now produce every credit state the enforcement Function will read: a limit (including 0), no limit, and a bypass — and each of those writes republishes `credit_v1` within the request.
- **Four UI-SPEC backstops remain** (D10 above): badge/toast rendering at narrow widths, edit-mode cell layout, the five status renderings' visual distinctness, and intro-paragraph wrapping. All are dev-store visual UAT, staged for end-of-phase `human_verify_mode` per the plan's `<human-check>`.
- **No blockers.** Suite is 322 green (263 baseline + 59 new); typecheck, lint and build are clean.

## Self-Check: PASSED

- Files verified on disk: `app/routes/app.companies.tsx`, `app/routes/app.tsx`, `tests/companies-settings.test.ts`, this summary.
- Commits verified in `git log`: `edb4cba`, `46d262e`, `9b1752c`.
- Gates re-run at close: `npx vitest run tests/companies-settings.test.ts` (59 pass), `npm test` (322 pass, 17 files), `npm run typecheck`, `npm run lint`, `npm run build` — all exit 0.
- Stub scan over both created files: no TODO/FIXME/placeholder/hardcoded-empty patterns; nothing to record in `.planning/WINDOWS.md`.
- Ownership respected: no changes to `app/services/scheduler.server.ts`, `tests/scheduler.test.ts`, schema, TOML, or `package.json`.

---
*Phase: 03-credit-controls-metafield-publishing*
*Completed: 2026-08-20*
