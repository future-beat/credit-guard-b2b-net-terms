---
phase: 06-dashboard-onboarding-launch
plan: 01
subsystem: ui
tags: [react-router, polaris-web-components, prisma, postgres, decimal, intl, dashboard]

requires:
  - phase: 02-ledger-ingest
    provides: Company / LedgerOrder / LedgerSchedule rows every dashboard number is read from
  - phase: 03-credit-controls-metafield-publishing
    provides: createMoneyFormatter, resolveShopCurrency, utilization rendering rules, shopDataComplete
  - phase: 04-enforcement-function
    provides: EnforcementEvent kinds and snapshot columns behind the credit-hold feed
  - phase: 05-payment-reminders
    provides: ReminderLog statuses/touchpoints and Shop.remindersEnabledAt behind the reminder activity table
provides:
  - "app/lib/money.ts — the single shared createMoneyFormatter (client-safe)"
  - "app/services/shop-currency.server.ts — the single shared resolveShopCurrency"
  - "app/services/dashboard.server.ts — loadDashboard(shop, {now, locale, feedPage}) returning fully serialisable DashboardData, plus the exported pure helpers (feedSentence, feedBadge, channelPhrase, reminderBadge, touchpointLabel, selectBanner, bucketUpcoming, utilisationPercent, formatDue, formatWhen, formatDate, clampFeedPage, resolveLocale)"
  - "app/routes/app._index.tsx — the AR dashboard page with COPY, bannerFor, overdueStatusBadges, overdueEmptyCopy and the 06-05 setup-guide insertion point"
  - "tests/dashboard.test.ts — 79 DB-backed specs, helper pins and route source guards"
affects: [06-02, 06-04, 06-05, 06-06, 06-07]

actuals:
  tokens: 25900
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Loader-formats-everything: money, dates and timestamps become strings inside the loader (UTC), so SSR and hydration cannot disagree"
    - "Snapshot-not-join for names: EnforcementEvent/ReminderLog render their own companyName; only order GIDs are joined to LedgerOrder.name"
    - "One-banner precedence lives in the service (selectBanner); the page only maps the choice to copy (bannerFor)"

key-files:
  created:
    - app/lib/money.ts
    - app/services/shop-currency.server.ts
    - app/services/dashboard.server.ts
    - tests/dashboard.test.ts
  modified:
    - app/routes/app._index.tsx
    - app/routes/app.companies.tsx

key-decisions:
  - "Built the optional 'Closest to limit' section (UI-SPEC flag): DASH-01 names per-company utilisation explicitly"
  - "Dropped banner B4 (currency mismatch): every ledger amount is store currency (D-07) and a mismatched order still counts toward exposure, so B4's body would be false"
  - "K4 and the upcoming table share ONE 30-day schedule query, bucketed in code — the tile and the table can never disagree"
  - "Closest to limit renders a percentage and no verdict, so an at-limit (100%) company is never described as 'within limit' (plan-check I-02)"
  - "s-badge carries no interestFor in polaris-types 1.0.1 — the two reminder tooltips hang off an s-text wrapper (catalog wins over spec)"

patterns-established:
  - "Server-side Intl formatting with timeZone UTC and a validated ?locale, defaulting to en-US"
  - "Search-param hardening at the loader edge: clampFeedPage and resolveLocale never throw and never reach Prisma unvalidated"
  - "Exported pure derivations (badges, sentences, empty copy) so byte-exact contract copy is testable without a DOM"

requirements-completed: [DASH-01, DASH-02]

coverage:
  - id: D1
    description: "KPI row: Total outstanding (with the '· incomplete' marker), Overdue companies, On credit hold, Due in 7 days — every figure summed from ledger rows, money never floated"
    requirement: "DASH-01"
    verification:
      - kind: integration
        ref: "tests/dashboard.test.ts#K1 total outstanding"
        status: pass
      - kind: integration
        ref: "tests/dashboard.test.ts#K2 and K3 counts"
        status: pass
      - kind: integration
        ref: "tests/dashboard.test.ts#K4 due in 7 days"
        status: pass
    human_judgment: false
  - id: D2
    description: "Overdue companies, Due in the next 30 days and Closest to limit tables, with row caps, overflow lines and empty states"
    requirement: "DASH-01"
    verification:
      - kind: integration
        ref: "tests/dashboard.test.ts#overdue companies table"
        status: pass
      - kind: integration
        ref: "tests/dashboard.test.ts#upcoming payments table"
        status: pass
      - kind: integration
        ref: "tests/dashboard.test.ts#closest to limit"
        status: pass
    human_judgment: false
  - id: D3
    description: "Credit holds and bypasses feed: snapshot-rendered rows, byte-exact kind sentences, channel phrasing, 25-row pagination, and the bypassed-order banner"
    requirement: "DASH-02"
    verification:
      - kind: integration
        ref: "tests/dashboard.test.ts#enforcement feed"
        status: pass
      - kind: unit
        ref: "tests/dashboard.test.ts#feed sentence templates"
        status: pass
      - kind: integration
        ref: "tests/dashboard.test.ts#banner selection"
        status: pass
    human_judgment: false
  - id: D4
    description: "Payment reminders activity: off-notice, status-filtered rows, FAILED vs DEAD tones, snapshot company names"
    requirement: "DASH-02"
    verification:
      - kind: integration
        ref: "tests/dashboard.test.ts#payment reminders section"
        status: pass
    human_judgment: false
  - id: D5
    description: "Tenant safety and outage-proofing: every collection shop-scoped from session.shop; no Admin API call on the home loader"
    verification:
      - kind: integration
        ref: "tests/dashboard.test.ts#dashboard loader"
        status: pass
      - kind: unit
        ref: "tests/dashboard.test.ts#dashboard route source guards"
        status: pass
    human_judgment: false
  - id: D6
    description: "The page renders as the App Store hero screenshot intends at real admin widths — tile overflow, table stacking, badge tones, tooltip activation"
    verification: []
    human_judgment: true
    rationale: "Visual fidelity in the embedded admin (200px tile with an 11-character money value, s-table auto stacking, the s-text tooltip wrapper around a badge) can only be judged by looking at it on the dev store; the UI-SPEC carries these as backstop checks."

duration: 45min
completed: 2026-08-22
status: complete
---

# Phase 6 Plan 01: AR Dashboard Read Model and Home Route Summary

**The Phase 1 placeholder home is now a real AR dashboard: four KPI tiles, five tables and a one-banner slot, all projected from Postgres in two round trips with money as Decimal strings and every date formatted server-side in UTC.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3 (1 tracer + 2 TDD)
- **Files modified:** 6 (4 created, 2 modified)
- **Suite:** 666 passed / 23 files (floor was 587 / 22 — this plan adds 79)

## Accomplishments

- **One money formatter, one currency source.** `createMoneyFormatter` moved to `app/lib/money.ts` and `resolveShopCurrency` to `app/services/shop-currency.server.ts`; Companies imports both, so the dashboard total and the Companies row cannot format the same amount two ways. The 59 Companies specs stayed green unchanged.
- **`loadDashboard` answers the whole page** from one `Promise.all` of 14 shop-scoped reads, then one wave of two GID→name joins that could not be issued earlier. No per-row query, no Admin API call.
- **Numbers that cannot silently understate.** K1 sums `Company.exposure`; K4 sums `LedgerOrder.outstandingShop` over DISTINCT orders with an open schedule inside 7 days. `LedgerSchedule` money is never read — the token `balanceDueAmount` does not appear in the module.
- **The credit-hold feed speaks D6-02's vocabulary**, rendered from `EnforcementEvent` snapshots, so an event about a deleted company still reads correctly (proven by deleting the company mid-spec). No "blocked $X", "saved" or "protected" copy exists on the page.
- **At most one banner**, by precedence B1 (backfill running) > B2 (balances incomplete) > B3a/B3b (orders went through in 30 days). Precedence lives in `selectBanner`; the page only maps the choice to copy.
- **Reminder activity hides internal bookkeeping** (`SUPPRESSED_*`, `DEFERRED`, `SENDING`) and teaches "Failed" for both FAILED and DEAD, distinguished only by tone and tooltip.

## Task Commits

1. **Task 1 (tracer): Total outstanding end to end** — `50698b7` (feat)
2. **Task 2: the full read model** — `2c87d9b` (test, RED) → `a0ebf73` (feat, GREEN)
3. **Task 3: the page** — `47580ee` (test, RED) → `c5c0a7b` (feat, GREEN)

## Files Created/Modified

- `app/lib/money.ts` — the shared, client-safe `createMoneyFormatter` (lifted verbatim; `Number()` is display-only).
- `app/services/shop-currency.server.ts` — the shared `resolveShopCurrency` (lifted verbatim).
- `app/services/dashboard.server.ts` — `loadDashboard` plus every exported pure helper; module header states the three contract rules (shop-scoped reads, snapshots-not-joins, schedule money never summed) and why no Admin API call lives here.
- `app/routes/app._index.tsx` — the page: banner slot → **06-05 setup-guide insertion point** → KPI grid → Overdue companies → Due in the next 30 days → Closest to limit → Credit holds and bypasses → Payment reminders.
- `app/routes/app.companies.tsx` — local helper definitions replaced by the shared imports; nothing else touched.
- `tests/dashboard.test.ts` — 79 specs against real Postgres, plus helper pins and route source guards.

## The `DashboardData` shape

```
currencyCode: string | null
banner: BannerSelection | null      // backfill-running | data-incomplete | bypassed-one | bypassed-many
kpis:
  totalOutstanding: { value: string | null, incomplete: boolean }
  overdueCompanies: string          // formatted integer
  onCreditHold: string
  dueIn7Days: { value: string | null }
overdue:        { rows: OverdueRow[10], total, totalLabel, companyCount }
upcoming:       { rows: UpcomingRow[15], total, totalLabel }
closestToLimit: { rows: UtilisationRow[5] }
feed:           { page, rows: FeedRow[25], hasNextPage, hasPreviousPage }
reminders:      { enabled, enabledSince: string | null, rows: ReminderRow[25] }
```

Every money and date field is a string; the only numbers are row counts and the feed page index, and a structural spec walks the object to keep it that way.

## Decisions Made

1. **"Closest to limit" built** (UI-SPEC ⚑, planner's call confirmed): DASH-01 names per-company credit utilisation, so the dashboard carries the top 5 by `exposure / creditLimit` where the limit is > 0, ranked with exact integer-cents cross-multiplication. Observe-only (null) and block-all (0.00) companies are excluded from the ranking.
2. **Banner B4 dropped** (UI-SPEC ⚑ resolved against the implementation): every ledger amount is `shopMoney` (D-07) and `computeCompanyState.currencyMismatch` never excludes an order from exposure, so B4's body — "aren't included in totals" — would be a false statement. No currency-mismatch query exists.
3. **At-limit is not "within limit."** The Closest-to-limit section renders a percentage and no status verdict, so a 100% company — which IS on credit hold under P4-L1 — is never described as within limit (plan-check I-02).
4. **K4 shares the upcoming table's query**, bucketed by `bucketUpcoming`; one query means the tile and the table are the same rows by construction.
5. **R2 is a local literal** with the corrected cadence ("3 days before the due date, on the due date, and 3 days after") and is asserted by substring, not byte-exact — 06-05 swaps it for 06-02's shared `REMINDERS_CADENCE` and owns that assertion (W-04). `app/reminder-copy.ts` was neither created nor imported.

## Deviations from Plan

### Catalog substitutions (hard rule 4 — the live catalog wins over the spec)

**1. `s-badge` has no `interestFor` in `@shopify/polaris-types@1.0.1`**
- **Found during:** Task 3 (typecheck of the reminder Status cell)
- **Issue:** UI-SPEC hangs tooltips T3/T4 directly off the "Sent (unconfirmed)" and DEAD "Failed" badges, but `BadgeProps` exposes only `color | icon | size | tone`.
- **Fix:** The badge is wrapped in an `s-text interestFor={id}` — the nearest primitive that does carry `interestFor` — with the `s-tooltip` as its sibling. The badge keeps its own visible text, so nothing about the accessibility contract changes.
- **Files modified:** `app/routes/app._index.tsx`
- **Verification:** `npm run typecheck` clean; the substitution is commented in place.
- **Committed in:** `c5c0a7b`

**2. Section header links use the `primary-action` slot**
- **Found during:** Task 3
- **Issue:** React `ReactProps` for `s-section` picks only `id | children`, so `primaryAction` is not a JSX prop.
- **Fix:** `<s-link slot="primary-action" …>` as a child — `slot` is typed on every element's base props.
- **Committed in:** `c5c0a7b`

Everything else in the catalog verified as the spec expected: `s-grid` (`gridTemplateColumns`, `gap`), `s-stack gap="small-200"`, `s-table paginate/hasNextPage/onNextPage`, `HeaderFormat = base|currency|numeric`, and `ToneKeyword` with no `attention`.

**Total deviations:** 2 catalog substitutions, 0 auto-fixed bugs.
**Impact on plan:** None — both are rendering-mechanism swaps with identical copy and semantics.

## Issues Encountered

- **The worktree had no `node_modules` and no `app/types/`** (both gitignored). Resolved per the 05-04 precedent: `node_modules` symlinked to the parent checkout (identical `package.json`, `package-lock.json` and `prisma/schema.prisma` by sha) and the three gitignored codegen artifacts copied at the same commit. `npm run graphql-codegen` was not run (offline).
- **Date literals are locale-dependent.** Specs that pin a date string pass an explicit `locale: "en-GB"` so the assertion is the contract rather than the machine's default; the loader's own default remains `en-US`.
- **Scratch database** `creditguard_test_0601` created, migrated, used and dropped.

## Verification

- `npx vitest run tests/dashboard.test.ts` — 79 passed
- `npx vitest run tests/companies-settings.test.ts` — 59 passed, unchanged after the helper lift
- `npm run typecheck` — clean · `npm run lint` — clean · `npm run build` — clean (no server import leaked into the client bundle)
- `npx vitest run` — **666 passed / 23 files** (floor 587 / 22)
- `grep -c "function createMoneyFormatter" app/routes/app.companies.tsx` → 0 (no duplicate formatter)
- `grep -c "balanceDueAmount" app/services/dashboard.server.ts` → 0

## Next Phase Readiness

- **06-05** inserts the guided setup at the marked insertion point (directly under the banner slot, above the KPI grid), swaps R2 for 06-02's shared constant, and adds `readValidationConfig` on the loader while the guide is visible. `tests/dashboard.test.ts` is its file to extend for that swap.
- **06-04** owns `app/routes/app.tsx` (nav + billing gate); this plan did not touch it, so the "Home" nav item is still present and still 06-04's to remove.
- **Not updated by this executor, by instruction:** `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/WINDOWS.md` and `.planning/REQUIREMENTS.md` — the orchestrator owns those after the wave merges. DASH-01 and DASH-02 are recorded in `requirements-completed` above.
- **No stubs.** Every section renders from real rows; the only intentionally-empty region is the setup-guide insertion point, which is 06-05's plan by design.

## Self-Check: PASSED

All six source files and this summary exist on disk; all five task commits (`50698b7`, `2c87d9b`, `a0ebf73`, `47580ee`, `c5c0a7b`) are present in `git log` on `worktree-agent-af2022eb4c3763eb4`.

---
*Phase: 06-dashboard-onboarding-launch*
*Completed: 2026-08-22*
