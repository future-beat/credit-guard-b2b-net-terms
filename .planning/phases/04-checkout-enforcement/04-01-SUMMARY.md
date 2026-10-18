---
phase: 04-checkout-enforcement
plan: 01
subsystem: api
tags: [shopify-functions, wasm, javy, cart-validation, graphql, vitest, function-runner, b2b]

requires:
  - phase: 03-credit-controls-metafield-publishing
    provides: "the credit_v1 payload law and its byte-exact contract lock (tests/metafield-contract.test.ts) — the only server<->Function interface, and the source every fixture here is generated from"
  - phase: 02-ar-ledger-ingest
    provides: "the exposure/overdue ledger values the payload carries"
provides:
  - "extensions/credit-guard-validation — the Cart and Checkout Validation Function extension, API 2026-07, target cart.validations.generate.run, building to a 4,971-byte wasm"
  - "A pure, throw-proof run(input) implementing the locked comparator: D4-01 remaining-credit, D4-02 currency policy, D-03 bypass-first, CRED-04 observe-only, and the F-01/F-02 revision rules"
  - "DEFAULT_MESSAGES — the two fallback block strings (P4-L4), the wasm-side half of the pair 04-03 owns server-side"
  - "The input query that 04-05's EC-2 proves live: metafield(key: \"credit_v1\") with the namespace OMITTED"
  - "tests/fixtures/function-inputs/*.json — an eight-fixture corpus executable by both vitest and function-runner"
affects: [04-02, 04-03, 04-04, 04-05, 06-dashboard]

actuals:
  tokens: 62000
  tasks: 3
  commits: 3

tech-stack:
  added:
    - "@shopify/shopify_function ^2.0.1 (CLI-scaffolded; the only new runtime dep)"
    - "function-runner 9.2.1 (bundled with Shopify CLI 4.6.1 — no separate install needed)"
    - "Javy JS->wasm toolchain via `shopify app function build`"
  patterns:
    - "Pure-comparator-in-a-Function: all decision logic in a dependency-free module the root vitest imports directly; the wasm glue never enters the test path"
    - "Cross-workspace contract carriage by byte-exact strings rather than a shared import"
    - "Type-refusing fixture overrides: a deliberate contract violation must be declared, not smuggled in"
    - "Mutation testing to prove an ordering pin is load-bearing"
    - "TOML byte-guard (snapshot -> run CLI -> diff -> restore) around every Shopify CLI invocation"

key-files:
  created:
    - extensions/credit-guard-validation/src/cart_validations_generate_run.ts
    - extensions/credit-guard-validation/src/cart_validations_generate_run.graphql
    - extensions/credit-guard-validation/shopify.extension.toml
    - extensions/credit-guard-validation/generated/api.ts
    - extensions/credit-guard-validation/.eslintrc.cjs
    - tests/checkout-validation-function.test.ts
    - tests/fixtures/function-inputs/ (8 JSON inputs)
  modified:
    - package-lock.json

key-decisions:
  - "The CLI's bundled cart_checkout_validation template already emits the 2026-07 era (target cart.validations.generate.run, operations/validationAdd result). 04-RESEARCH Pitfall 1 did not fire — no rewrite from purchase.validation.run was needed."
  - "generated/api.ts is COMMITTED, against the scaffold's default .gitignore: the root tsconfig includes **/*.ts, and regenerating it needs the Shopify CLI plus a Partner session, so it is not an offline-reproducible gate the way npm run graphql-codegen is for /app/types."
  - "An ABSENT limit key is treated as observe-only alongside an explicit null — it is indistinguishable from unconfigured, and never surprise-blocking is the safe direction against T-04-01."
  - "Number.isSafeInteger guards after every cents conversion and on the projected sum; an unrepresentable value fails open."
  - "The scaffold's demo vitest (a second vitest major nested in the workspace) was removed — the root suite is the single test home, per 04-RESEARCH Q8."

patterns-established:
  - "Pin-by-mutation: for any ordering that a reasonable refactor would 'clean up', prove the guarding test fails under the exact reversion before trusting it."
  - "Fixture provenance is asserted, not asserted-in-prose: a test checks every committed fixture payload carries exactly the credit_v1 key set."

requirements-completed: [ENFC-01, ENFC-02, ENFC-03, ENFC-04]

coverage:
  - id: D1
    description: "Over-limit block uses remaining-credit semantics (D4-01): blocks iff exposure_cents + cart_cents > limit_cents, at-limit exactly allowed, integer cents throughout"
    requirement: ENFC-01
    verification:
      - kind: unit
        ref: "tests/checkout-validation-function.test.ts#run — D4-01 remaining-credit arithmetic (integer cents, never float)"
        status: pass
      - kind: integration
        ref: "shopify app function run --input tests/fixtures/function-inputs/block-over-limit.json (real wasm, 1 error at $.cart)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Overdue block (ENFC-02) is currency-independent and is evaluated BEFORE money parsing, so a malformed limit cannot silence it (F-01)"
    requirement: ENFC-02
    verification:
      - kind: unit
        ref: "tests/checkout-validation-function.test.ts#run — F-01: a garbage limit must not silence the overdue rule"
        status: pass
      - kind: integration
        ref: "shopify app function run --input tests/fixtures/function-inputs/block-malformed-limit-overdue.json (real wasm, overdue copy at $.cart)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Block messages read config_v1 from the Validation metafield with per-FIELD fallback to hard-coded copy; a missing config never fails closed and never silences the block"
    requirement: ENFC-03
    verification:
      - kind: unit
        ref: "tests/checkout-validation-function.test.ts#run — block messages (ENFC-03: a missing config never fails closed, never silences)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The nine-case fail-open matrix: D2C, metafield null, malformed payloads, v!==1, data_complete false enforces, bypass-first, observe-only, currency mismatch, throw-proof"
    requirement: ENFC-04
    verification:
      - kind: unit
        ref: "tests/checkout-validation-function.test.ts#run — fail-open matrix (ENFC-04)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The extension builds under the real toolchain to a sub-256KB wasm and executes all eight committed fixtures in function-runner with verdicts matching the unit suite"
    verification:
      - kind: integration
        ref: "shopify app function build + function-runner over tests/fixtures/function-inputs/*.json — 8/8 match, peak 379.01K instructions, wasm 4971 bytes"
        status: pass
      - kind: unit
        ref: "tests/checkout-validation-function.test.ts#committed function-runner fixtures agree with the pure comparator"
        status: pass
    human_judgment: false
  - id: D6
    description: "The input query reads the app's own credit_v1 metafield with the namespace argument OMITTED (app-reserved namespace resolves)"
    verification: []
    human_judgment: true
    rationale: "Schema-legal and documented, but only a live replay on the dev store shows whether company.metafield comes back non-null with the namespace omitted. This is 04-RESEARCH EC-2, explicitly gated to plan 04-05; the documented fallback is a literal namespace: \"$app\". Cannot be proven by any local test."

duration: 42min
completed: 2026-08-20
status: complete
---

# Phase 4 Plan 01: Checkout Validation Function Summary

**A 4,971-byte Javy wasm that blocks a B2B checkout when a company's cart would exceed its remaining credit or when it is overdue — 64 pinned cases, 8 fixtures proven against the real runtime, and 379K of an ~11M instruction budget.**

## Performance

- **Duration:** 42 min
- **Started:** 2026-08-20T03:14:00Z
- **Completed:** 2026-08-20T03:56:00Z
- **Tasks:** 3
- **Files modified:** 21 (20 created, 1 modified)
- **Branch:** `worktree-agent-a59b456990ae147ee` (based at `e35245d`, the plan-check revision commit)

## Accomplishments

- **The comparator is real and it is provably ordered.** `run()` implements the locked twelve-step decision order end to end. The two orderings the plan called load-bearing were not merely asserted — they were mutation-tested. Reverting to the research skeleton's grammar-before-overdue order fails exactly the one F-01 pin and nothing else; removing the block-all currency-gate skip fails exactly the two F-02 pins. The source was restored byte-identical after each mutation.
- **The toolchain is proven, not assumed.** Scaffold, 2026-07 pin, input query, typegen, Javy build and function-runner execution all ran for real. The wasm path was derived from the build (`find`), never hardcoded. All eight fixtures executed against the compiled wasm and every verdict matched the pure comparator, message copy included.
- **Enormous budget headroom.** Peak 379.01K instructions against the ~11M budget — 3.4%, roughly 29x headroom. The Rust-port escape hatch in CLAUDE.md is not needed and is unlikely ever to be.
- **Fixture provenance is checkable.** Every payload is `JSON.parse`d from one of the two byte-exact contract strings and overridden through a helper that *refuses* any override silently changing a field's JSON type. A test then asserts each committed fixture carries exactly the credit_v1 key set — so "generated from the contract bytes" is enforced rather than claimed.
- **337 -> 401 tests, zero failures**, with `npm run lint` and `tsc --noEmit` both clean.

## Task Commits

1. **Task 1 (tracer): Scaffold and prove one block + one allow end-to-end** — `f862232` (feat)
2. **Task 2: Full comparator — 9-case matrix, D4-01/D4-02, messages** — `e715af7` (test)
3. **Task 3: Function-runner matrix, instruction budget, fixture library** — `71b53cc` (test)

_No plan-metadata commit: this executor was instructed not to touch STATE.md/ROADMAP.md — the orchestrator owns those._

## Files Created/Modified

- `extensions/credit-guard-validation/src/cart_validations_generate_run.ts` — the comparator. Pure, throw-proof, integer cents by string surgery, with the full decision order and its rationale documented inline.
- `extensions/credit-guard-validation/src/cart_validations_generate_run.graphql` — input query; namespace omitted on the credit_v1 read, `presentmentCurrencyRate` deliberately absent.
- `extensions/credit-guard-validation/shopify.extension.toml` — `api_version = "2026-07"`, target `cart.validations.generate.run`, export `cart-validations-generate-run`, plus the re-pin convention comment.
- `extensions/credit-guard-validation/generated/api.ts` — typegen output, committed (see Deviations #2).
- `extensions/credit-guard-validation/.eslintrc.cjs` — scoped lint exemption for `generated/**` only.
- `extensions/credit-guard-validation/.gitignore` / `package.json` — scaffold, minus the demo test runner; `generated` deliberately un-ignored with the reason recorded.
- `tests/checkout-validation-function.test.ts` — 64 cases (532 lines).
- `tests/fixtures/function-inputs/*.json` — eight runner inputs.
- `package-lock.json` — the extension workspace (see Deviations #4).

## Function-Runner Matrix (real wasm, function-runner 9.2.1)

| Fixture | Verdict | Errors | Message | Instructions |
|---|---|---|---|---|
| `allow-d2c.json` | ALLOW | 0 | — | 223,896 |
| `allow-observe-only.json` | ALLOW | 0 | — | 275,121 |
| `allow-bypass.json` | ALLOW | 0 | — | 277,060 |
| `allow-currency-mismatch.json` | ALLOW | 0 | — | 323,360 |
| `block-malformed-limit-overdue.json` | BLOCK | 1 @ `$.cart` | overdue copy | 322,229 |
| `block-overdue.json` | BLOCK | 1 @ `$.cart` | overdue copy | 322,481 |
| `block-all-zero-limit.json` | BLOCK | 1 @ `$.cart` | over-limit copy | 371,056 |
| `block-over-limit.json` | BLOCK | 1 @ `$.cart` | over-limit copy | 379,010 |

**wasm:** `extensions/credit-guard-validation/dist/function.wasm`, **4,971 bytes** (gate 262,144 — 1.9% of budget).
**Peak instructions:** 379,010 against the ~11M assumption (A1) — well under the 1M flag threshold the plan set.

## Decisions Made

- **Kept the CLI's export naming.** The scaffold emits `export = "cart-validations-generate-run"` (kebab) bound to a `cartValidationsGenerateRun` TS function, not the plan's `cart_validations_generate_run`. That is what the runtime actually binds — function-runner resolved it without a flag. The decision logic lives in a pure `run()` that `cartValidationsGenerateRun` delegates to, so tests import the logic and the platform imports the binding.
- **Cart fraction width widened to 6 digits** (research skeleton used 4). Truncation to cents can only make a cart cheaper, and a cheaper cart can only under-block, so accepting more well-formed inputs strictly reduces spurious fail-opens.
- **`data_complete` is not read at all**, per D-04 — recorded in a source comment as the plan required.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1's verify regex is unsatisfiable as written**
- **Found during:** Task 1
- **Issue:** `grep -c 'cart.validations.generate.run' shopify.extension.toml | grep -q '^1$'` returns **3**, not 1. The unescaped `.` metacharacters also match `cart-validations-generate-run` (the export) and `cart_validations_generate_run.graphql` (the input_query path). The command can never pass against a correct file.
- **Fix:** Used `grep -cF` (fixed-string), which returns exactly 1 and preserves the intent — "the target is declared exactly once".
- **Verification:** `grep -cF` -> 1; `grep -c` -> 3, both recorded.
- **Committed in:** `f862232`

**2. [Rule 2 - Missing Critical] `generated/api.ts` had to be committed**
- **Found during:** Task 1
- **Issue:** The scaffold's `.gitignore` ignores `generated`. But the root `tsconfig.json` includes `**/*.ts`, so `npm run typecheck` resolves `../generated/api` from the extension — and regenerating it requires `shopify app function typegen`, i.e. the Shopify CLI plus a Partner session. Unlike `/app/types` (regenerable offline via `npm run graphql-codegen`), this is not a reproducible gate, so a fresh clone would fail typecheck with no offline remedy.
- **Fix:** Un-ignored `generated` in the extension `.gitignore` with the reasoning recorded there; `dist` stays ignored.
- **Verification:** `tsc --noEmit` clean.
- **Committed in:** `f862232`

**3. [Rule 1 - Bug] Lint regression caused by deviation #2**
- **Found during:** Task 3
- **Issue:** Committing `generated/api.ts` put 3,106 lines of codegen output under the root eslint run (`--ignore-path .gitignore`), producing 21 `@typescript-eslint/no-explicit-any` errors from codegen's custom-scalar mapping. `npm run lint` went from clean to 23 errors (21 generated + 2 mine).
- **Fix:** Added `extensions/credit-guard-validation/.eslintrc.cjs` exempting `generated/**` only — hand-written `src/` stays fully linted — and replaced the two `any`s in the test file with the real `CartValidationsGenerateRunInput` type.
- **Verification:** `npm run lint` clean; `tsc --noEmit` clean.
- **Committed in:** `71b53cc`

**4. [Rule 3 - Blocking] `package-lock.json` modified outside the stated ownership boundary**
- **Found during:** Task 1
- **Issue:** `shopify app generate extension` — mandated by the plan — registers the new workspace in the root lockfile. `package-lock.json` is not in this plan's declared file ownership.
- **Fix:** Committed it (the repo is inconsistent otherwise) and **measured the production blast radius** rather than assuming: `npm ci --omit=dev --dry-run` against the Dockerfile's actual layer (root `package.json` + lock only, extension dir absent) installs **942 packages before and 942 after** — production is bit-for-bit unaffected.
- **Verification:** Both dry-runs recorded; see "Note for 04-05" below.
- **Committed in:** `f862232`

**5. [Rule 2 - Missing Critical] Scaffold demo test runner removed**
- **Found during:** Task 1
- **Issue:** The scaffold ships `tests/default.test.js` (testing the deleted quantity example), `vitest.config.js`, and a nested **vitest 3.x** devDependency — a second vitest major inside a repo running vitest 4, and a test file that would rot immediately.
- **Fix:** Removed the demo tests, config, `test` script and the two test-only devDeps. Root vitest is the single test home per 04-RESEARCH Q8. This also cut the lockfile churn from ~2,600 lines to ~2,000.
- **Verification:** `shopify app function build` still succeeds; full suite green.
- **Committed in:** `f862232`

**6. [Rule 2 - Missing Critical] Absent `limit` key treated as observe-only**
- **Found during:** Task 2
- **Issue:** The plan's step (6) is `limit === null -> allow`. A payload with the `limit` key *missing* would fall through to step (7) and could **block an unconfigured company on overdue** — a surprise block on a company the merchant never opted in.
- **Fix:** Step (6) tests `=== null || === undefined`. An absent key is indistinguishable from unconfigured, and the safe direction against T-04-01 (critical: phantom block) is to allow.
- **Verification:** Pinned by `row 7: an absent limit key is indistinguishable from unconfigured -> allow, even overdue`.
- **Committed in:** `e715af7` (the behaviour shipped in `f862232`)

**7. [Rule 2 - Missing Critical] Safe-integer guards on all cents arithmetic**
- **Found during:** Task 1
- **Issue:** The contract grammar permits 15 integer digits, so a cent value can reach 17 digits — past `Number.MAX_SAFE_INTEGER` (~9.0e15), where `Number()` silently loses precision. A silently-wrong comparison is exactly the class of bug that phantom-blocks a customer.
- **Fix:** `Number.isSafeInteger` guard after each conversion **and** on the projected sum; an unrepresentable value fails open.
- **Verification:** Covered by the money-grammar cases; the guard is a pure widening of the fail-open set.
- **Committed in:** `f862232`

---

**Total deviations:** 7 auto-fixed (2 blocking, 4 missing-critical, 1 bug). No Rule 4 (architectural) situations arose.
**Impact on plan:** No scope change. Four of the seven exist only because the plan could not have known what the CLI would emit; the other three are safe-direction hardening on the highest-severity threat in the register.

## TDD Gate Compliance

Task 2 was marked `tdd="true"` ("write the failing tests FIRST"), but **RED was structurally impossible**: Task 1 (the tracer) was instructed by the same plan to "implement the full decision skeleton". By the time Task 2 began, `run()` was already complete, and all 56 new cases passed on first run. `run()` required no change in Task 2 — the commit is test-only.

Rather than fake a RED phase, the pins were validated by **mutation testing**, which is a stronger guarantee than RED for this specific risk (RED proves a test fails when nothing is implemented; mutation proves it fails under the *exact* regression it exists to catch):

| Mutation | Expected red | Observed |
|---|---|---|
| Revert to grammar-before-overdue order (F-01) | the F-01 pin | **1 failed / 55 passed** — exactly the F-01 pin |
| Remove the block-all currency-gate skip (F-02) | the F-02 pins | **2 failed / 54 passed** — exactly the two F-02 pins |

Source restored byte-identical after each (`git diff --exit-code` clean). Flagging this so the phase verifier sees the gate was consciously substituted, not skipped.

## Issues Encountered

- **`function-runner` resolves `--input` relative to the extension directory**, not the invocation cwd, so a repo-relative fixture path fails with `No such file or directory`. All matrix runs use absolute paths.
- **The plan anticipated a pre-2025-10 scaffold** (Pitfall 1: "if generated types contain pre-2025-10 identifiers, rewrite the TOML and re-run typegen"). CLI 4.6.1's bundled template is already 2026-07 — `cart_validations_generate_run` file naming, `operations`/`validationAdd` result, `message`/`target` error fields. No convergence work was needed. `generated/api.ts` confirms `ValidationError = { message, target }` with no `localizedMessage` anywhere.
- **No `function-runner` install was required** — CLI 4.6.1 bundles `function-runner-9.2.1`. The plan's contingency (dev dep or npx) was unnecessary; nothing was installed.

## Byte-Guard Record

Six Shopify CLI invocations ran (1 generate, 1 typegen, 2 builds, 10 function runs). `shopify.app.toml` and `shopify.extension.toml` were snapshotted before and diffed after each mutating command. **Neither file drifted once** — no api_version bump to the 2026-10 RC, no `automatically_update_urls_on_dev` flip, no URL rewrite. `git diff --exit-code shopify.app.toml` is clean against HEAD. `shopify app deploy` was **not** run, per instruction.

## Note for 04-05 (deploy)

`@shopify/shopify_function` is a **production** dependency of the extension workspace and pulls a large `@graphql-codegen` tree. The current `Dockerfile` copies only root `package.json` + `package-lock.json` before `npm ci --omit=dev`, so the extension workspace is absent at install time and production is unaffected — measured at **942 packages both before and after** this plan. If that Dockerfile is ever changed to `COPY . .` before `npm ci`, the production tree grows to **1,058 packages** (measured). Leave the copy order alone.

## Known Stubs

None. No placeholder values, no TODO/FIXME, no skipped tests, and every `<verify>` in the plan was executed. Nothing was added to `.planning/WINDOWS.md` because nothing is left open: all seven deviations were resolved inside their task commits.

The one thing this plan **cannot** prove locally is D6 — that `metafield(key: "credit_v1")` with the namespace omitted returns our metafield on a live store. That is 04-RESEARCH EC-2, explicitly assigned to plan 04-05, and it is flagged `human_judgment: true` in the coverage block rather than quietly assumed.

## Requirements Note

`requirements-completed` lists all four IDs from the plan frontmatter, but each has a remainder outside this plan by design:
- **ENFC-03** — the function-side read and fallback are done here; the merchant-facing *editor* is 04-04 and the live render is 04-05.
- **ENFC-04** — the code-side belt (try/catch, per-rule fail-open) is done here; the platform-side braces (`blockOnFailure: false` at registration) are 04-03.
- **ENFC-01/02** — comparator complete; the live storefront proof is 04-05.

## Next Phase Readiness

Ready. The spine every later Phase-4 plan expands from is proven:
- **04-02** (unaffected — disjoint ownership; this plan touched only `extensions/**`, the two named test paths, and `package-lock.json`).
- **04-03** registers the function: `functionHandle` is `credit-guard-validation`, and `DEFAULT_MESSAGES` in `cart_validations_generate_run.ts` is the exact copy its server-side twin must mirror (P4-L4 strings, verbatim).
- **04-04** edits `config_v1`; the function's reader enforces `v === 1`, non-empty strings, and a 250-character cap — the settings page must validate to the same bounds or its saved text will silently fall back.
- **04-05** deploys and runs EC-1 through EC-5. EC-2 (namespace omission) is the one genuinely unproven assumption; the documented fallback is a literal `namespace: "$app"` in the input query.

---
*Phase: 04-checkout-enforcement*
*Completed: 2026-08-20*

## Self-Check: PASSED

All 18 claimed files exist on disk, all three task commits resolve in `git log`, and the
three files most at risk of being silently gitignored (`generated/api.ts`, the scoped
`.eslintrc.cjs`, the test file) are confirmed tracked by git rather than merely present.
Verified 2026-08-20 against worktree branch `worktree-agent-a59b456990ae147ee`.
