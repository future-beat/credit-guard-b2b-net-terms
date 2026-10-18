---
phase: 04-checkout-enforcement
plan: 03
subsystem: app-registration
tags: [scopes, write_validations, validationCreate, shopify-functions, checkout-rules, railway, prisma-migration, lockstep-guard]
requires:
  - phase: 04-checkout-enforcement
    provides: "04-01 credit-guard-validation Function extension (wasm 4,971 bytes, comparator pinned); 04-02 EnforcementEvent backend + add_enforcement_events migration"
  - phase: 03-credit-controls-metafield-publishing
    provides: "scope-lockstep guard test, CF-5 deploy ritual, $app credit_v1 publisher and its userErrors-inside-data posture"
provides:
  - "Registry version credit-guard-net-terms-6: six-scope string (adds write_validations) + the credit-guard-validation function extension, released from the phase branch"
  - "ensureValidationRegistered — idempotent, non-throwing, app-managed validationCreate with blockOnFailure: false and the config_v1 defaults metafield"
  - "DEFAULT_MESSAGES — the canonical P4-L4 block copy the Function duplicates, with a mechanical byte-diff test between the two homes"
  - "Shop.validationGid (migration add_validation_registration, strictly additive)"
  - "Railway running the phase-branch backend with BOTH Phase 4 migrations applied"
  - "buildConfigValue() — the P4-L5 config_v1 serializer 04-04's settings page will reuse"
affects:
  - "04-04: settings page reads Shop.validationGid + the Validation's enabled state; its merchant-editable copy defaults to DEFAULT_MESSAGES and writes the same config_v1 shape"
  - "04-05: EC-4 reads the live Validation back to prove blockOnFailure false, and resolves A3 (inline metafields) and A4 (write-implies-read) empirically"
  - "Everything scope-gated in Waves 3-4 is blocked until the browser re-consent below is accepted"
actuals:
  tokens: 13100
  tasks: 3
  commits: 4
tech-stack:
  added: []
  patterns:
    - "App-managed Validation registration: idempotence by platform state (re-read validations(first: 50), match handle client-side), never by stored bookkeeping"
    - "Fire-and-forget app-shell loader hook (after startBackfill) for background ensure-steps that must be non-throwing"
    - "Deploy-time-only assumption handled by an implemented-and-tested fallback path that records which branch won (A3)"
key-files:
  created:
    - tests/enforcement-registration.test.ts
    - prisma/migrations/20260820121500_add_validation_registration/migration.sql
  modified:
    - app/services/enforcement.server.ts
    - app/routes/app.tsx
    - prisma/schema.prisma
    - shopify.app.toml
    - vitest.config.ts
    - tests/scope-lockstep.test.ts
    - tests/webhooks.b2b-events.test.ts
    - README.md
key-decisions:
  - "blockOnFailure is written as the LITERAL false in the create variables (never omitted-to-default) and gets its own dedicated test — the ENFC-04 platform half"
  - "Idempotence keys on platform state, not on Shop.validationGid: a merchant who deletes the rule gets it back next app-open, and a stale GID can never suppress a needed create"
  - "A merchant-disabled rule is recorded honestly and never force-re-enabled (research Open Question 1) — off is a choice, not drift"
  - "The Validation GID is banked BEFORE the optional A3 config hop: a live fail-open rule with default copy beats a live rule the dashboard cannot see"
  - "b2b-events guard now asserts the EXACT write set [write_companies, write_validations] rather than a single-write-scope invariant"
patterns-established:
  - "Four-home scope lockstep (TOML, Railway SCOPES, vitest env, guard-test EXPECTED_SCOPES) changed in ONE commit, never partially"
  - "ACCESS_DENIED is classified as a Sentry warning, not an error, when it is the expected pre-consent state"
requirements-completed: [ENFC-01, ENFC-02, ENFC-03, ENFC-04]
coverage:
  - id: D1
    description: "write_validations requested in all four lockstep homes plus the Railway SCOPES variable"
    requirement: ENFC-01
    verification:
      - kind: unit
        ref: "tests/scope-lockstep.test.ts#shopify.app.toml declares exactly the six-scope string, once"
        status: pass
      - kind: unit
        ref: "tests/webhooks.b2b-events.test.ts#requests exactly the four CF-1 read scopes plus the two write scopes, once"
        status: pass
      - kind: other
        ref: "railway variables --service credit-guard-app --json -> SCOPES == the six-scope string"
        status: pass
    human_judgment: false
  - id: D2
    description: "Idempotent app-managed Validation registration — creates once when absent, never twice, refreshes the stored GID"
    requirement: ENFC-01
    verification:
      - kind: integration
        ref: "tests/enforcement-registration.test.ts#creates the Validation once when the shop has none of ours"
        status: pass
      - kind: integration
        ref: "tests/enforcement-registration.test.ts#does not create a second Validation on a repeat call (the app-open path)"
        status: pass
      - kind: integration
        ref: "tests/enforcement-registration.test.ts#issues NO mutation when our validation already exists"
        status: pass
    human_judgment: false
  - id: D3
    description: "blockOnFailure pinned literally false in the create variables (fail-open on our own crash)"
    requirement: ENFC-04
    verification:
      - kind: integration
        ref: "tests/enforcement-registration.test.ts#pins blockOnFailure to FALSE in the create variables (ENFC-04)"
        status: pass
    human_judgment: false
  - id: D4
    description: "config_v1 defaults metafield created with the Validation; DEFAULT_MESSAGES byte-identical to the Function's duplicate"
    requirement: ENFC-03
    verification:
      - kind: integration
        ref: "tests/enforcement-registration.test.ts#carries the config_v1 defaults metafield inline (ENFC-03, P4-L5)"
        status: pass
      - kind: unit
        ref: "tests/enforcement-registration.test.ts#matches the Function's duplicated copy byte for byte"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every failure shape is non-throwing: userErrors-inside-data, pre-consent ACCESS_DENIED (warning level), transport throw, inactive/absent shop"
    requirement: ENFC-04
    verification:
      - kind: integration
        ref: "tests/enforcement-registration.test.ts#survives a pre-consent ACCESS_DENIED without crashing the app shell"
        status: pass
      - kind: integration
        ref: "tests/enforcement-registration.test.ts#treats userErrors inside data as failure: no GID, Sentry, no throw"
        status: pass
    human_judgment: false
  - id: D6
    description: "Registry version credit-guard-net-terms-6 released with the six scopes and the function extension; both TOMLs byte-identical after the CLI run"
    requirement: ENFC-01
    verification:
      - kind: other
        ref: "shopify app deploy --allow-updates -> 'New version released to users. credit-guard-net-terms-6'; git diff --exit-code on both TOMLs"
        status: pass
    human_judgment: false
  - id: D7
    description: "Railway runs the phase-branch backend with add_enforcement_events and add_validation_registration applied; deployed smoke green"
    verification:
      - kind: e2e
        ref: "railway ssh -> _prisma_migrations lists both Phase 4 migrations; Shop.validationGid present; EnforcementEvent table present"
        status: pass
      - kind: e2e
        ref: "scripts/smoke-deployed.sh app.creditguardhq.com -> healthz 200 over valid TLS, forged HMAC 401 on all six webhook endpoints"
        status: pass
    human_judgment: false
  - id: D8
    description: "The registration actually binds the Function on a real store and blockOnFailure reads back false live"
    verification: []
    human_judgment: true
    rationale: "Gated on the browser-only re-consent tap below. No write_validations-gated live call was attempted in this plan by design; 04-05 EC-4 owns the live read-back, and it also resolves A3 (inline $app metafields accepted?) and A4 (write-implies-read?)."
metrics:
  duration: "17m"
  tasks: 3
  files: 10
  completed: 2026-08-20
status: complete
---

# Phase 4 Plan 03: write_validations + App-Managed Validation Registration Summary

**Registry version `credit-guard-net-terms-6` released with the six-scope string and the `credit-guard-validation` function extension, backed by an idempotent `validationCreate` ensure-step that pins `blockOnFailure: false` and ships the `config_v1` default copy — parked at the browser-only re-consent tap.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-08-20T04:01:28Z
- **Completed:** 2026-08-20T04:18:43Z
- **Tasks:** 3
- **Files modified:** 10 (2 created, 8 modified)
- **Suite:** 453 green across 20 files (floor was 434/19; +19 new specs, zero regressions)

## Accomplishments

- **`write_validations` through all four lockstep homes in ONE commit** — `shopify.app.toml`, `vitest.config.ts` env, `tests/scope-lockstep.test.ts` `EXPECTED_SCOPES`, `tests/webhooks.b2b-events.test.ts` — plus the Railway `SCOPES` service variable. The b2b-events guard changed shape deliberately: it used to assert "`write_companies` is the SINGLE write scope"; it now asserts the exact set `[write_companies, write_validations]`, so a third write scope still has to justify itself by turning the build red first.
- **`ensureValidationRegistered`** — reads `validations(first: 50)`, matches our handle **client-side** (`Query.validations` has no `functionHandle` filter), and calls `validationCreate` only when absent with `functionHandle: "credit-guard-validation"`, `enable: true`, `blockOnFailure: false`, `title: "Credit Guard: net-terms credit check"` and the `$app`/`config_v1` JSON metafield. Wholly non-throwing, all transport through `graphqlJson` (T-02-27), `Shop.active` gated first.
- **`blockOnFailure: false` has its own dedicated test** rather than a code comment. The assertion is that the key is *present* and the value is the literal `false` — an omitted key would leave the platform default deciding whether our crash stops a merchant's real sale.
- **`DEFAULT_MESSAGES` is now the canonical P4-L4 home**, with a test that imports the Function's duplicate and diffs the two strings byte-for-byte. The duplication is deliberate (wasm cannot import server code) and can no longer drift silently.
- **A3 fallback implemented, not deferred** — if `validationCreate` rejects the inline `metafields` input, the step retries a bare create then `metafieldsSet` with `ownerId` = the new Validation GID, and records which path won via `Sentry.captureMessage`.
- **Released and deployed from the phase branch**: registry version `credit-guard-net-terms-6`, and a Railway release whose release phase applied **both** Phase 4 migrations.

## Task Commits

1. **Task 1: write_validations through all four lockstep homes + Railway SCOPES** — `074e5e8` (feat)
2. **Task 2: Shop.validationGid + idempotent ensureValidationRegistered + app-open hook** — `a888e5b` (test, RED: 19 failing) → `57d6893` (feat, GREEN: 19 passing)
3. **Task 3: Registry release + Railway release** — `00f8f84` (docs; the release itself is a platform action, the commit carries its documentation)

## Files Created/Modified

- `app/services/enforcement.server.ts` — `ensureValidationRegistered`, `ENSURE_VALIDATION_QUERY`, `CREATE_VALIDATION_MUTATION`, `SET_VALIDATION_CONFIG_MUTATION`, `DEFAULT_MESSAGES`, `buildConfigValue()`, `CONFIG_METAFIELD_KEY`/`_NAMESPACE`, `VALIDATION_FUNCTION_HANDLE`/`_TITLE`
- `app/routes/app.tsx` — fire-and-forget `ensureValidationRegistered(session.shop)` after `startBackfill`
- `prisma/schema.prisma` + `prisma/migrations/20260820121500_add_validation_registration/migration.sql` — `Shop.validationGid String?`
- `tests/enforcement-registration.test.ts` — 19 specs at the mocked GraphQL seam with real Postgres
- `shopify.app.toml` — six-scope string + per-scope rationale in the established style
- `vitest.config.ts`, `tests/scope-lockstep.test.ts`, `tests/webhooks.b2b-events.test.ts` — lockstep
- `README.md` — two-write-scope table, four-home lockstep table, a new "Checkout enforcement registration" section, `sessionScopes` caveat generalised

## Release Evidence

**Registry version: `credit-guard-net-terms-6`** ("Phase 4: checkout validation function + write_validations").
`shopify app deploy --allow-updates` built the function (`Bundling JS function... Running javy... Done!`), passed registration validation, and released. Dashboard: `.../apps/411936784385/versions/1096061583361`.

**CF-5 byte-guard: clean on both files.** Snapshots taken before the CLI run; `diff` reported *identical* for `shopify.app.toml` and `extensions/credit-guard-validation/shopify.extension.toml`, `git status` clean afterwards. `api_version = "2026-07"` survived in both, and `automatically_update_urls_on_dev = false` survived. No re-pin was needed — the CLI rewrite hazard from 01-01/01-02 did not recur.

**Railway release** (`railway up --service credit-guard-app --ci`, from the branch working tree): `Deploy complete`. Release-phase migration state read back over `railway ssh`:

```
migrations: [ ..., 20260820112500_add_enforcement_events,
                   20260820121500_add_validation_registration ]
lastFinishedAt: 2026-08-20T04:15:38.776Z
shopValidationGidColumn: true
enforcementEventTable: "EnforcementEvent"
```

**Smoke:** `scripts/smoke-deployed.sh app.creditguardhq.com` → healthz 200 over valid TLS (`ssl_verify_result=0`) and forged HMAC rejected 401 on all six webhook endpoints. `scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com` → 8 orders all `ATTRIBUTED`, 0 unresolved, `dataComplete: true`, 0 dirty publishes, both sweep leases healthy.

## Migration / Rollback Story (F-05 — for the PR reviewer)

Production now runs **branch** code with `add_enforcement_events` and `add_validation_registration` applied, while `main` carries neither. This is safe and needs no destructive rollback path:

- Both migrations are **strictly additive**. `add_enforcement_events` adds one new table (`EnforcementEvent`) and one column with a database default (`Company.blockedState BOOLEAN NOT NULL DEFAULT false`). `add_validation_registration` adds one **nullable** column (`Shop.validationGid TEXT`). No drop, rename or retype appears in either.
- Therefore `main`'s current code remains deployable against the migrated database **at any point** — it simply never reads or writes the new column/table. If the Phase 4 PR stalls or needs rework, redeploying `main` is a normal deploy, not a recovery operation.
- The reverse direction (rolling the *schema* back) is neither needed nor advisable: an unused nullable column and an unused table cost nothing, and dropping them would be the only genuinely destructive move available here.

## Decisions Made

- **`blockOnFailure` is written explicitly, never omitted.** Research quotes Shopify verbatim: validation *errors* always block; this flag governs whether runtime *exceptions* also block. Inheriting a default we do not control is the inverted catastrophe (T-04-09), so the literal `false` is in the variables and a test asserts both presence and value.
- **Idempotence keys on platform state, not our bookkeeping.** Every call re-reads the validations connection; `Shop.validationGid` is a dashboard cache, never a skip condition. A merchant who deletes the rule gets it back on the next app-open, and a stale GID cannot suppress a needed create.
- **Merchant "off" is honoured.** A matched node with `enabled: false` is recorded and returned on — no `validationUpdate` to force it back on (research Open Question 1). The GID is still stored so 04-04 can *show* the off state.
- **The GID is banked before the A3 config hop.** If the second-step `metafieldsSet` fails, the rule is still live and fail-open and the Function falls back to its own `DEFAULT_MESSAGES` (ENFC-03); losing the GID would instead strand a live rule the dashboard cannot see. The config failure still goes to Sentry.
- **`appKey` is belt, handle is braces.** A node is ours when the handle matches AND its `appKey` either matches ours or is absent — an absent key falls back to the handle match rather than pretending to know.
- **Railway variable set with `--skip-deploys`.** The scope variable would otherwise have triggered a redeploy of the *previous* image mid-plan; Task 3's `railway up` is the single release that carries both the new scope and the new code.

## Deviations from Plan

None — plan executed exactly as written. Two mechanical notes that are not deviations:

- The plan's Task 1 verify used `railway variables ... | grep -c 'write_validations'`; the table output truncates long values, so the assertion was made against `railway variables --json` instead (same claim, non-truncating source). Value confirmed: `read_orders,read_all_orders,read_payment_terms,read_companies,write_companies,write_validations`.
- The plan's Task 3 verify suggested `railway ssh` + `prisma migrate status`; that was run (`Database schema is up to date!`, 7 migrations) and then strengthened to an explicit read of `_prisma_migrations` plus `information_schema`, so the summary asserts the two migration *names* rather than a green aggregate.

## Issues Encountered

- A first `_prisma_migrations` probe used `to_regclass(...)` and failed with a Prisma deserialization error on the `regclass` type. Re-run with `::text` — a probe-script fix, no production impact.
- `timeout(1)` is not present on this macOS shell; the deploy was run without it.

## Known Stubs

None. No stub values, skipped tests or unrun `<verify>` commands were left behind by this plan.

## Threat Notes

- **T-04-12 (concurrent app-opens double-create), accepted for v1 as planned.** Two simultaneous loaders can both observe "absent" and both create. The next pass matches by handle and stops; a duplicate rule is visible and removable in checkout settings, and both copies are fail-open — the blast radius is cosmetic. Recorded here so 04-05's live pass looks for it.
- **T-04-10 (cross-shop confusion):** every mutation rides the shop's own offline session through `graphqlJson`, and `Shop.validationGid` is written by domain key only.
- No new threat surface beyond the plan's register; no new packages (T-04-SC unchanged).

## Expected ACCESS_DENIED Window (not a defect)

The `credit-guard-net-terms-6` release **invalidated the dev store's offline token within seconds** (the 02-05 / 03-02 precedent). Until the re-consent below is accepted:

- production webhook refetch and reconciliation for `credit-guard-demo.myshopify.com` fail `ACCESS_DENIED` into Sentry (non-throwing);
- the registration ensure-step will do the same, deliberately at **warning** level.

Do not roll back; the ledger heals via reconciliation after acceptance. `prod-ledger-state` still reports `sessionScopes: read_all_orders,read_orders,read_payment_terms,write_companies` — the pre-release canonical set with reads collapsed into writes. **Never assert on `sessionScopes` literals** (03-05's finding); expect `write_validations` to appear there, and possibly to swallow a read, after re-consent.

## User Setup Required — RE-CONSENT (browser only, hard stop)

**This plan parks here. Nothing scope-gated in Waves 3–4 works until this is done.** Relay verbatim to the developer:

1. Open the dev store admin: **https://credit-guard-demo.myshopify.com/admin/apps** (or Shopify admin → **Apps** → **Credit Guard**).
2. Click into **Credit Guard**. Because version `credit-guard-net-terms-6` widened the scope set, Shopify shows a **permissions / re-consent screen** before the app loads.
3. **Check the screen lists the new checkout-validations WRITE access** alongside the existing orders / payment terms / companies permissions. Wording is Shopify's, typically along the lines of "manage checkout validations" or "edit checkout rules". If nothing about validations or checkout rules appears, **stop and report** — the release did not carry the scope and Wave 3 must not proceed.
4. Click **Update** / **Install** to accept.
5. Accepting **opens the app**, and that app-open is what fires the registration ensure-step. No further action is needed.

**What to verify after accepting** (all optional for the human — 04-05 automates the proof):

- Shopify admin → **Settings → Checkout → Checkout rules** should now list **"Credit Guard: net-terms credit check"**, turned on.
- `scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com` should show a `sessionScopes` string that now includes `write_validations`.
- Sentry's `ACCESS_DENIED` warnings for that store should stop within a few minutes.

**Do not** attempt to create the checkout rule by hand in Settings → Checkout. A hand-made rule does not carry `blockOnFailure: false` and would put a merchant's real sales behind our crash behaviour.

## Next Phase Readiness

**Ready:**

- Registry carries the extension and the scope; Railway carries the ensure-step and both migrations; the suite is 453 green.
- `DEFAULT_MESSAGES` and `buildConfigValue()` are exported and tested — 04-04's settings page can default and serialize against them today.
- `Shop.validationGid` exists for 04-04's "is enforcement armed?" read.

**Blocked on the re-consent tap above:**

- Any live `validations` / `validationCreate` call. **Zero write_validations-gated live calls were attempted in this plan**, by design.
- **A3 is still open** (does `ValidationCreateInput.metafields` accept `$app` + json inline?). Both branches are implemented and unit-covered; the live answer arrives on the first post-consent app-open and is recorded by the `Sentry.captureMessage` on the fallback path. 04-05 EC-4 should read the resulting Validation's metafields to settle it.
- **A4 is still open** (does `write_validations` imply the `Query.validations` read?). If 04-05 EC-4 finds it does not, the fix is a follow-up **four-home lockstep commit** adding the read scope — plus another re-consent.

---
*Phase: 04-checkout-enforcement*
*Completed: 2026-08-20*

## Self-Check: PASSED

- All key files present on disk (`enforcement.server.ts`, `app.tsx`, `schema.prisma`, `20260820121500_add_validation_registration/migration.sql`, `tests/enforcement-registration.test.ts`).
- All four task commits present in `git log`: `074e5e8`, `a888e5b`, `57d6893`, `00f8f84`.
- Plan `<verification>` re-run at close-out: `tests/enforcement-registration.test.ts + scope-lockstep + webhooks.b2b-events` 47 green; `npm test` 453 green across 20 files; `git diff --exit-code` clean on both TOMLs; `scripts/smoke-deployed.sh app.creditguardhq.com` PASS.
