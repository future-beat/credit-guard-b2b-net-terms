# Phase 6 Plan Check — Dashboard, Onboarding & Launch

**Checked:** 2026-08-22 · plans at commit `8a771a8` (main) · checker: gsd-plan-checker
**Verdict:** ISSUES FOUND — 1 goal blocker (needs a user decision), 1 procedural blocker per protocol, 7 warnings, 6 info
**Binding law applied:** 06-CONTEXT (D6-01..05), 06-UI-SPEC, 06-RESEARCH, WINDOWS.md #3 #8 #10 #12 #13 #20 #21 #22, and the code on main (line refs below were re-verified, not taken from the plans).

## Verdict per plan

| Plan | Verdict | Findings |
|------|---------|----------|
| 06-01 dashboard | PASS (with W-04, I-02) | read model is correct against the schema; no Admin API on the home path; R2 literal transient |
| 06-02 #20 #21 #12 #22 | PASS (with W-02, W-03) | fixes are concrete and test-first; cadence constant should live in a plain module |
| 06-03 #3 #8 #10 | PASS (with I-03) | named-error drop only; stdout/stderr scrubber shares the param list; flip widening is race-safe |
| 06-04 billing gate | PASS | fail-open, after side effects, session-derived URL, handle matches TOML, `_top` supported by the library helper |
| 06-05 setup + review | ISSUES — B-01 | stamp-always + `recently-installed` defeats LNCH-02 for first-session success moments |
| 06-06 pricing/E-1/deploy | PASS (with W-05) | E-1 is a hard halt; live #10 procedure concrete; live-drive card must state the buyer-login precondition |
| 06-07 live drive | ISSUES — W-05 | #13 staging correct (limit above exposure), but the overdue company's contact email is unreachable as recorded |
| 06-08 submit + PR | PASS (with I-05) | all listing fields/assets covered; go/no-go is a real decision gate |

## Verified-good foundations (no finding)

- **Requirement coverage:** DASH-01/02 → 06-01; DASH-03 → 06-05; LNCH-01 → 06-04/06-06; LNCH-02 → 06-05/06-07; LNCH-03 → 06-02/03/04/06/07/08. Every roadmap ID appears in a `requirements:` field. All eight WINDOWS items have a code task (or #13 a live task) and a closure-table obligation in a SUMMARY.
- **Structure:** all 8 plans pass `verify.plan-structure`; 2–3 tasks each; every auto task has `<automated>` verify; estimates all under the 100k smart zone (06-01 0.90, 06-05 0.85 — the two to watch; confidence `low`, fewer than 3 calibrated phases).
- **Dependencies:** 01–04 wave 1 (`depends_on: []`), 05 → [01,02], 06 → [01..05], 07 → [06], 08 → [07]. Acyclic, waves consistent.
- **Wave-1 file ownership is disjoint** (intersected): 06-01 {app/lib/money.ts, shop-currency.server.ts, dashboard.server.ts, app._index.tsx, app.companies.tsx, tests/dashboard.test.ts}; 06-02 {reminders.server.ts, enforcement.server.ts, app.settings.tsx, README.md, tests/reminders, tests/settings-messages}; 06-03 {webhooks.{orders,companies,payment-terms}.tsx, access-log-redact.mjs, instrument.server.mjs, reconciliation.server.ts, their tests}; 06-04 {app.tsx, tests/billing-gate, scripts/prod-billing-state.*, .claude/CLAUDE.md}. No shared file. Branch discipline is stated identically in all four (phase branch cut from main tip; no merge to main during wave 1; precondition asserts `main` is an ancestor). Main is clean at `8a771a8` with phase-05 merged (PR #3).
- **Billing gate (06-04), code-verified:** `@shopify/shopify-app-react-router@1.2.1` passes `unstable_managedPricingSupport: true` unconditionally (`dist/esm/server/shopify-app.mjs:126`); `@shopify/shopify-api@13.1.0` `check.mjs` runs `currentAppInstallation.activeSubscriptions` with `isTest` defaulting to `true`, so a dev-store $0 contract counts. The community 500 (`installation.activeSubscriptions.forEach` on an undefined installation) is inside the try/catch → fail-open. `redirect(url, { target })` is supported by the library helper (`helpers/redirect.mjs:66-79`). `shopify.app.toml:5` handle = `credit-guard-net-terms`, matching the URL. The gate lives only in `app/routes/app.tsx` (never `webhooks.*`, `auth.*`, `/healthz`, `/privacy`). E-1 is a hard halt in 06-06 Task 3 before `railway up`.
- **Dashboard truth (06-01), schema-verified:** K1 = `company.aggregate _sum.exposure`; K4 and upcoming sum `LedgerOrder.outstandingShop` over distinct orders (grep gate forbids `balanceDueAmount`); feed renders `EnforcementEvent.companyName` snapshots (the model has `companyName`, `amount`, `limit`, `exposure`, `overdue`, `channel`, `orderGid`); `[shop, createdAt]` indexes exist on EnforcementEvent and ReminderLog, `[shop, overdue]` on Company, `[shop, dueAt]` on LedgerSchedule — no unindexed hot query, two round-trips total. `shopDataComplete` (`metafields.server.ts:202`) drives B2; #10 ships in the same deploy so the demo store will not show a permanent "· incomplete". Source guard forbids `admin-client.server`/`graphqlJson` imports in the route. Banner precedence B1 > B2 > B3, B4 dropped with a correct reason (`currencyMismatch` is a console warning at `ledger.server.ts:880`, never an exclusion).
- **#20 / #21 (06-02):** `retriableRow` (`reminders.server.ts:902`) receives the schedule's `rows`, so the sibling fence is implementable without a new query; `TOUCHPOINT_SEVERITY` exists (line 118); `SUPPRESSED_STALE` already in `REMINDER_STATUS` (line 155). `sendReminder` catch (line 555) is exactly the branch to narrow; `LedgerGraphqlError.errors` (`ledger.server.ts:164`) carries the raw `errors[]`. Shopify returns `THROTTLED` and `ACCESS_DENIED` as HTTP 200 + `errors[].extensions.code`, so the closed set is the right shape. The ambiguous branch already captures to Sentry (line ~795), so a systematic failure stays visible.
- **#3 (06-03):** the catch at `webhooks.orders.tsx:165-172` releases and rethrows for everything; the plan adds an `instanceof SessionNotFoundError` branch BEFORE release and keeps the rethrow for all other errors, preserving 02-03's claim-release contract. `webhooks.app.uninstalled.tsx:14` deletes sessions, so the post-uninstall path does throw this named error from `unauthenticated.admin`.
- **#8 (06-03):** `start` = `NODE_OPTIONS='--import ./instrument.server.mjs' react-router-serve` and Railway's start command is `npm run docker-start` → `npm run start`, so the pre-boot hook runs in production. morgan calls `stream.write()` on the `process.stdout` object at log time, so wrapping the instance method catches it; `console.*` output is covered on both streams; the `[?&]name=` / `[^&\s"']*` regex stops at a JSON quote so structured lines survive. Live verification is in 06-07 Task 2 (`railway logs | grep -Ec "id_token=eyJ"` must be 0).
- **#10 (06-03):** matches the code: `sweepStart` captured at `reconcileShop` entry (line 441), flip where-clause at line 418, step-1 callback at lines 452-470 is where `scannedGids` is collected. The OR is limited to the sweep's own scan, so the in-flight-webhook race stays protected.
- **#13 staging (06-07):** correct. `isBlockedState` (`enforcement.server.ts:119-129`) returns false for a null limit, and the Function allows on null limit before the overdue check (`cart_validations_generate_run.ts:204`), so WINDOWS #13's literal "limit null" would NOT block; the plan's "limit above exposure, overdue, bypass off" is the only valid staging.
- **Review prompt mechanics (06-05):** `@shopify/app-bridge-types@0.7.2` types `reviews.request()` → `success` code `"success"` or the nine declined codes (d.ts:1651); `useAppBridge` is already used in `app.companies.tsx:523`. Trigger is `useEffect`-only, no button, COPY guard forbids "rate us"/"leave a review". `cancelled` flag handles StrictMode's dev-only double effect.
- **Context compliance:** D6-01..05 each have implementing tasks; no deferred idea is built (the "Hide setup" and B4 flags are explicitly not built; E-5 is authorised by D6-05). No 2.x upgrade; no new deps; TOML untouched; executors barred from WINDOWS/STATE/ROADMAP in every plan.

## Findings

### B-01 — BLOCKER (goal) — 06-05 Task 3: stamp-always + platform `recently-installed` refusal means most merchants are never asked (LNCH-02 / SC4)

- Quote (06-05 must_haves): "the server stamps reviewPromptedAt for EVERY known code and for 'error'"; (06-UI-SPEC § Review Prompt, Stamp): "for every returned code (user instruction: 'record regardless of result code')".
- Defect: the platform refuses with `recently-installed` for the first 24h after install (06-RESEARCH, CONTEXT). The guided setup (06-05) drives the merchant to set their first limit in the first session, and for the ICP (merchants with overdue net-terms customers) that very act writes the first `BLOCK_STATE_ENTERED`. So the first success moment is, by design, inside the 24h window → `recently-installed` → stamped → the app never asks again. E-2 on the dev store will not expose this, because dev stores bypass the limits. The effect is that SC4 ("after the first blocked order or first reminder sent, the merchant sees an in-admin review prompt") is not achieved for the common install path.
- This honours the UI-SPEC rule as written, so it is not a plan-vs-decision contradiction; it is a goal failure that the user needs to decide on in one line.
- Fix (pick one, record in CONTEXT/UI-SPEC, then adjust 06-05 Task 3 behaviours + specs):
  (a) Recommended: stamp for `success`, `already-reviewed`, `annual-limit-reached`, `cooldown-period`, `merchant-ineligible`, `mobile-app`, `cancelled`, `error`; do NOT stamp for `recently-installed`, `already-open`, `open-in-progress` (the request was never evaluated). Nagging is still impossible: the platform enforces once/60d and the stamp lands on the first evaluated attempt.
  (b) Keep stamp-always, and the user explicitly accepts that merchants whose first hold happens in session one are never prompted.

### B-02 — BLOCKER (procedural, per checker protocol) — VALIDATION.md missing while `workflow.nyquist_validation: true` and 06-RESEARCH carries a Validation Architecture section

- Protocol: Dimension 8 check 8e fails closed when `06-VALIDATION.md` is absent.
- Mitigation already in place: every auto task has an `<automated>` verify; the RESEARCH § Validation Architecture maps all six requirements to named spec files; per-wave `npm test` is prescribed. Phases 4 and 5 were checked and executed without a VALIDATION.md (05-PLAN-CHECK did not raise it).
- Disposition for the orchestrator: either generate `06-VALIDATION.md` from the RESEARCH section (cheap; no research re-run needed) or waive explicitly as in Phases 4–5. Do not block execution on a full `--research` re-run.

### W-01 — WARNING — ROADMAP Phase 6 success criterion 1 still says "blocked $X of over-limit orders"

- `ROADMAP.md:201` SC1 contradicts D6-02 and the reworded DASH-02 (`REQUIREMENTS.md:49`). The verifier reads ROADMAP SCs; 06-01's honesty guard deliberately forbids that phrase. Executors may not edit ROADMAP — the orchestrator should reword SC1 to the D6-02 vocabulary before execution.

### W-02 — WARNING — 06-02 Task 3 / 06-05 Task 3: `REMINDERS_CADENCE` defined in a route module, imported by another route module

- Quote (06-05): "import from `./app.settings` — … if importing a route module into another route pulls loader code into the client bundle, move the constant to … `app/reminder-copy.ts`".
- Defect: this is a known-brittle pattern in RR7/Vite (route-module export stripping plus `.server` import guards); the plan leaves the decision to execution time and the fallback touches a file that is not in 06-05's `files_modified`. Fix now: 06-02 Task 3 creates `app/reminder-copy.ts` (or similar plain module) holding `REMINDERS_CADENCE`, `app.settings.tsx` imports it; 06-05 imports from the shared module. Add the file to 06-02's `files_modified`. No wave-1 conflict (06-01 does not touch it).

### W-03 — WARNING — 06-02 Task 2: the closed retriable set omits the "validation-class" codes WINDOWS #21 names

- Quote (WINDOWS #21): "only ACCESS_DENIED/validation-class codes are retriable"; plan: `RETRIABLE_GRAPHQL_CODES = ["ACCESS_DENIED", "THROTTLED"]`.
- Effect: a query/schema-drift error (Shopify returns these with `extensions.code` values such as `undefinedField`, `argumentNotAccepted`, `variableNotDefined`, `missingRequiredArguments`) — which is certainly-not-sent — lands `SENT_UNCONFIRMED` with `sentAt` stamped, and the dashboard's reminders section (06-01) would show "Sent (unconfirmed)" for emails never sent. Sentry capture keeps it visible, so this is a warning, not a blocker. Fix: either add the documented validation-class codes to the set (still closed, still spec-pinned) or record in the doc comment why they are deliberately excluded.

### W-04 — WARNING — 06-01 Task 3 pins R2 to the UI-SPEC literal; 06-02 changes the cadence wording

- 06-01 renders R2 in wave 1 from the UI-SPEC literal ("…and when it's overdue"); 06-02 fixes the factual cadence to "3 days after"; 06-05 swaps the literal for the constant. Between the wave-1 merge and 06-05 the two pages disagree (acceptable, transient), but if 06-01's COPY spec pins R2 byte-for-byte, 06-05 must also edit `tests/dashboard.test.ts` (not in its `files_modified`). Fix: tell 06-01 NOT to pin R2 byte-exact (pin E4/R4 only) and note that 06-05 owns the R2 assertion; or add `tests/dashboard.test.ts` to 06-05's files.

### W-05 — WARNING — 06-06 live-drive card / 06-07 step 4: the overdue company's buyer login is not reachable as the fixtures stand

- The only overdue company on credit-guard-demo is Acme Supply (WINDOWS #5; 05-05-SUMMARY). Phase 4's live checkout buyer was Northwind (04-05-SUMMARY row 1), and 05-05-SUMMARY records that Acme's contact email "was reverted to `example.com`". The B2B customer-account login is a one-time code to the contact email, so step 4's "as that company's buyer" cannot be executed until the user re-adds a contact they can receive mail at. Fix: 06-06 Task 3's LIVE DRIVE CARD must state this precondition ("before step 4, ensure the overdue company has a company contact whose email you control; re-add it in Shopify admin → Companies"), and 06-07 step 4 should open with that check. No PII in the SUMMARY.

### W-06 — WARNING — 06-05 Task 1: `files_modified` for the migration folder is a guess

- Prisma names the folder from the clock at `migrate dev` time; the plan acknowledges it ("rename the folder timestamp only if prisma generated a different one"). Prefer: keep whatever Prisma generates and record it; do not rename a generated migration (the `_prisma_migrations` name is what 06-06's `jq .migrations | contains("add_shop_onboarding_review")` check matches, and that substring survives any timestamp).

### W-07 — WARNING — 06-03 `<verification>` says the #8 live check is in 06-06; it is in 06-07

- 06-06 Task 3 does E-1/deploy/smoke/#10 only; the `railway logs` grep is 06-07 Task 2. Cosmetic, but the 06-03 SUMMARY will cite the wrong plan for the verifier. Fix the cross-reference.

### I-01 — INFO — Gate adds one Admin GraphQL round-trip to every `/app/*` document load

- Intentional (D6-01); fail-open covers outages/throttling. Worth a sentence in the app.tsx doc comment so nobody later "optimises" it into a cached check without thinking about FROZEN/CANCELLED.

### I-02 — INFO — 06-01 "Closest to limit" at-limit semantics

- UI-SPEC says at-limit "is NOT a hold"; `isBlockedState` uses `exposure.gte(limit)` (`enforcement.server.ts:128`), so an at-limit company IS on hold (K3 counts it, badge "Within limit" on Companies is a Phase 3 nuance). The dashboard reads `blockedState` directly so the numbers are truthful; just do not let the 100% row copy claim otherwise.

### I-03 — INFO — #3 drop branch during a re-install window

- A delivery that arrives between session deletion and the new session write is acknowledged and dropped; the daily reconciliation heals it. Acceptable; mention in the doc comment.

### I-04 — INFO — 06-06 E-1 probe rule vs `billing.check`

- `wouldPassGate = subscriptions.length > 0` mirrors `check()` with `isTest=true` for subscriptions (it ignores one-time purchases, which this app never creates). Fine.

### I-05 — INFO — Deploy-from-branch, PR after submission

- The deployed build is the phase-branch tip; the PR opens after submission and is merged by the user. This matches the Phase 4/5 precedent; the only obligation is that nothing else lands on main before that merge, which 06-08 should state in the PR body.

### I-06 — INFO — Step 3 can never complete on a store whose Validation is `disabled`

- By D6-03 there is no in-app re-enable, so the guide persists with "Open settings" until the merchant flips the rule in Shopify. UI-SPEC calls this the intended nudge; the verifier should not read a persistent guide on such a store as a defect.

## Dimension summary

| Dimension | Result |
|-----------|--------|
| 1 Requirement coverage | PASS |
| 2 Task completeness | PASS |
| 3 Dependency correctness | PASS |
| 4 Key links planned | PASS |
| 5 Scope sanity | PASS (06-01 0.90, 06-05 0.85 of budget; low confidence) |
| 6 Verification derivation | PASS (truths are user-observable) |
| 7 Context compliance | PASS |
| 7b Scope reduction | PASS (no "v1/static/later" reductions of a locked decision; the R2 cadence correction is a factual fix, recorded) |
| 7c Architectural tier | PASS (gate in loader; reviews in browser with server eligibility; dashboard = Postgres projection) |
| 8 Nyquist | FAIL-PROCEDURAL (B-02); all tasks carry `<automated>` verify; no watch-mode or E2E commands |
| 9 Cross-plan data contracts | PASS (06-01 reads `SUPPRESSED_STALE`/`SENT_UNCONFIRMED` rows that 06-02 writes; filters are compatible) |
| 10 CLAUDE.md compliance | PASS (06-04 corrects the stale rows; no forbidden libs) |
| 11 Research resolution | Open Questions 1–5 are carried as E-1..E-5 tasks (06-06/06-07); Q6 resolved by D6-02. Not marked "(RESOLVED)" in the file — cosmetic |
| 12 Pattern compliance | SKIPPED (no PATTERNS.md) |
| Verify-command format | PASS (no `2>/dev/null || echo` feeding comparisons; no `^`-anchored package-manager greps; counts are measured floors) |

## Required revision

1. **B-01** — user decision on the stamp rule; update 06-UI-SPEC § Review Prompt + 06-05 Task 3 behaviours/specs accordingly.
2. **B-02** — orchestrator disposition (generate `06-VALIDATION.md` from RESEARCH or waive as in 04/05).
3. **W-01** — orchestrator rewords ROADMAP SC1.
4. **W-02, W-04** — small edits to 06-02 / 06-01 / 06-05 file lists and the R2 pinning rule.
5. **W-05** — add the buyer-login precondition to 06-06's card and 06-07 step 4.
6. **W-03, W-06, W-07** — doc/cross-reference fixes; can be folded into the same revision pass.

Nothing else in the eight plans needs to change; the gap closures, the gate, and the dashboard read model are correct against the code on main.
