---
phase: 02-ar-ledger-credit-engine
plan: 02
subsystem: api
tags: [shopify-webhooks, hmac, prisma, postgres, vitest, sentry, b2b, payment-terms, chaos-testing]

# Dependency graph
requires:
  - phase: 02-01
    provides: ledger.server.ts (refetchOrderAndRecompute, upsertCompany, deleteCompany, recordWebhookReceipt, markWebhookProcessed), admin-client-mock, order-fixtures
  - phase: 01-foundation-compliance
    provides: webhooks.compliance.tsx route pattern, webhook-hmac test helper, Sentry init sites
provides:
  - payment_terms/* + payment_schedules/due webhook ingest funnelling into the shared refetch path
  - companies/* lifecycle ingest (upsert/delete, no Admin API call)
  - executable convergence proof that duplicate/replayed/out-of-order/coalesced deliveries cannot corrupt balances
  - app/sentry-redact.mjs — one shared, tested URL scrubber for both Sentry init sites (W-2 closed)
affects: [02-03, 02-04, 02-05, phase-03-metafield-publication, phase-05-reminder-emails]

actuals:
  tokens: 12761
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Topic-agnostic webhook ingest — no ledger behaviour branches on topic name"
    - "Chaos convergence testing — deep-equal a normalised ledger snapshot against a single-clean-recompute baseline"
    - "Mutation-verified test suites — prove a suite can fail before trusting it green"
    - "Runtime-reachable shared modules are .mjs so raw-Node entry points can import them"

key-files:
  created:
    - app/routes/webhooks.payment-terms.tsx
    - app/routes/webhooks.companies.tsx
    - app/sentry-redact.mjs
    - tests/webhooks.b2b-events.test.ts
    - tests/webhooks.chaos.test.ts
    - tests/sentry-scrub.test.ts
  modified:
    - instrument.server.mjs
    - app/entry.client.tsx

key-decisions:
  - "The payment-terms order extractor has NO payload.id fallback — on those topics `id` is the PaymentTerms id, so a fallback would refetch an unrelated real order"
  - "Chaos baseline is ONE clean delivery of the final source state — the executable form of 'recompute from source, never increment'"
  - "Shared scrubber is .mjs not .ts: production runs Node 20 (no type-stripping) and instrument.server.mjs is loaded by raw Node"
  - "redactUrl fails CLOSED on unparseable URLs rather than passing them through — losing a diagnostic beats leaking a session token"

patterns-established:
  - "Chaos convergence: replay(steps) vs baseline(finalSource), deep-equal on a volatile-field-free snapshot"
  - "Mutation check before trusting a green suite: break the production path, confirm red, revert with targeted git checkout"
  - "Source-guard tests read comment-stripped source to assert a control still exists and is wired"

requirements-completed: [LEDG-02, LEDG-03]

coverage:
  - id: D1
    description: "payment_terms/update (a merchant due-date edit) converges the ledger via the shared refetch path — new dueAt lands on LedgerSchedule and Company.earliestDueAt follows"
    requirement: LEDG-02
    verification:
      - kind: integration
        ref: "tests/webhooks.b2b-events.test.ts#moves the schedule dueAt and Company.earliestDueAt to the refetched value"
        status: pass
    human_judgment: false
  - id: D2
    description: "companies/create|update upsert the Company row; companies/delete removes it while its orders survive with null linkage"
    requirement: LEDG-02
    verification:
      - kind: integration
        ref: "tests/webhooks.b2b-events.test.ts#deletes the company while its orders survive with null linkage"
        status: pass
      - kind: integration
        ref: "tests/webhooks.b2b-events.test.ts#refreshes the name on update without disturbing exposure"
        status: pass
    human_judgment: false
  - id: D3
    description: "Duplicate, replayed-stale and out-of-order webhook sequences all converge to the identical ledger state as a single clean recompute"
    requirement: LEDG-02
    verification:
      - kind: integration
        ref: "tests/webhooks.chaos.test.ts#processes one refetch and converges to the clean-recompute baseline"
        status: pass
      - kind: integration
        ref: "tests/webhooks.chaos.test.ts#ignores the staleness of an old orders/create redelivered after newer state"
        status: pass
      - kind: integration
        ref: "tests/webhooks.chaos.test.ts#converges when orders/updated overtakes its own orders/create"
        status: pass
      - kind: integration
        ref: "tests/webhooks.chaos.test.ts#converges under duplicates, replays, reordering and coalescing combined"
        status: pass
    human_judgment: false
  - id: D4
    description: "A payment recorded ONLY as orders/updated (coalescing suppresses orders/paid) still converges exposure to the remaining balance, then to zero on settlement"
    requirement: LEDG-03
    verification:
      - kind: integration
        ref: "tests/webhooks.chaos.test.ts#converges a partial payment announced only as orders/updated"
        status: pass
      - kind: integration
        ref: "tests/webhooks.chaos.test.ts#drops the contribution to zero when the order settles, still without orders/paid"
        status: pass
    human_judgment: false
  - id: D5
    description: "redactUrl scrubs id_token, hmac, signature, access_token, token, session and code from URLs and breadcrumbs while preserving other query params (W-2)"
    verification:
      - kind: unit
        ref: "tests/sentry-scrub.test.ts#replaces the id_token value while preserving every other parameter"
        status: pass
      - kind: unit
        ref: "tests/sentry-scrub.test.ts#redacts the %s parameter"
        status: pass
      - kind: unit
        ref: "tests/sentry-scrub.test.ts#the server init imports the shared module and defines no scrubber of its own"
        status: pass
    human_judgment: false
  - id: D6
    description: "Forged-HMAC POSTs to both new routes return 401 with zero side effects"
    verification:
      - kind: integration
        ref: "tests/webhooks.b2b-events.test.ts#answers 401 on /webhooks/payment-terms and writes nothing"
        status: pass
      - kind: integration
        ref: "tests/webhooks.b2b-events.test.ts#answers 401 on /webhooks/companies and writes nothing"
        status: pass
    human_judgment: false
  - id: D7
    description: "The payment_terms payload's real order-reference field, confirmed against a live Shopify delivery"
    verification: []
    human_judgment: true
    rationale: "The extractor accepts every plausible spelling but no live payment_terms delivery has been observed. 02-05 wires the real TOML subscriptions and is the first point this can be confirmed against a dev-store trigger."

duration: 22min
completed: 2026-08-19
status: complete
---

# Phase 02 Plan 02: B2B Event Ingest & Chaos Convergence Summary

**Payment-terms and companies webhook routes funnelling into the shared refetch path, a 7-scenario chaos suite that deep-equals hostile delivery orderings against a single-clean-recompute baseline, and the W-2 Sentry scrubber extracted into one tested `.mjs` module both init sites import.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-08-19T11:36:00Z
- **Completed:** 2026-08-19T11:58:00Z
- **Tasks:** 3
- **Files modified:** 8 (6 created, 2 modified)
- **Tests:** 74 → 117 (+43)

## Accomplishments

- **The ledger's central promise is now an executable proof, not a design claim.** Seven chaos scenarios — duplicate (same and distinct webhook id), replayed-stale, out-of-order, coalesced partial payment, coalesced settlement, and all of them at once — each deep-equal a normalised ledger snapshot against a baseline built from ONE clean delivery of the final source state.
- **The suite was mutation-verified before being trusted.** Removing `ORDERS_UPDATED` from the orders route switch (simulating the coalescing bug) turns all 7 red, including a phantom `500.0000` exposure where `200.0000` is owed — precisely the false-block-a-paying-customer failure the phase exists to prevent. The mutation was reverted, never committed.
- **Full webhook ingest surface for 02-05's TOML subscriptions exists and is forgery-proof.** Both new routes reject forged HMAC with 401 and zero rows.
- **W-2 debt closed.** The Sentry URL scrubber is one shared, directly-tested module; deleting `beforeSend` or the redact logic now fails a test instead of passing a grep.
- **Caught a latent production-boot bug** while doing it (see Deviations #2).

## Task Commits

1. **Task 1 (tracer): payment-terms + companies routes** — `abe4b9f` (feat)
2. **Task 2: chaos convergence suite** — `b11367f` (test)
3. **Task 3 RED: failing scrubber test** — `078570a` (test)
4. **Task 3 GREEN: shared scrubber + rewiring** — `38d636a` (feat)

## Files Created/Modified

- `app/routes/webhooks.payment-terms.tsx` — PAYMENT_TERMS_{CREATE,UPDATE,DELETE} + PAYMENT_SCHEDULES_DUE, all funnelling into `refetchOrderAndRecompute`
- `app/routes/webhooks.companies.tsx` — company head upsert/delete; makes no Admin API call and writes no exposure fields
- `app/sentry-redact.mjs` — the single `redactUrl` + `CREDENTIAL_QUERY_PARAMS`, zero imports
- `tests/webhooks.b2b-events.test.ts` — 12 tests: dueAt convergence, company lifecycle, cross-shop isolation, forged-HMAC 401 on both routes
- `tests/webhooks.chaos.test.ts` — 7 convergence scenarios
- `tests/sentry-scrub.test.ts` — 24 tests: redaction behaviour, param preservation, fail-closed parsing, both-init-site source guards
- `instrument.server.mjs` — 39 lines of duplicated scrubber replaced with one import
- `app/entry.client.tsx` — same

## Decisions Made

- **No `payload.id` fallback in the payment-terms extractor.** The orders route can fall back to `payload.id` because on `orders/*` that IS the order. On `payment_terms/*`, `id` and `admin_graphql_api_id` belong to the PaymentTerms object — falling back would refetch `gid://shopify/Order/<terms id>`, which resolves either to nothing or, far worse, to an unrelated real order and would corrupt a bystander company's balance. Only fields that explicitly name an order are trusted; returning null is safe because LEDG-04's reconciliation is the universal backstop. Locked by a dedicated test.
- **Chaos baseline = one clean delivery of the final source state.** This is a stronger and simpler invariant than comparing permutations against each other: it directly asserts "final state equals what a single clean recompute would produce", which is the executable form of the recompute-from-source rule.
- **Snapshot excludes row ids, `createdAt`, `refetchedAt`, `recomputedAt`.** These differ between two runs by construction and say nothing about correctness. Everything a merchant could be harmed by — money, dates, overdue, company linkage — is included.
- **Company name falls back to the gid when a payload carries none**, keeping the non-null column honest without inventing a friendly-looking string indistinguishable from a real merchant-entered name.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree forked from the wrong base — Phase 2 did not exist**

- **Found during:** Setup, before Task 1
- **Issue:** The worktree was created from `origin/HEAD` (`818bc70`, the Phase-1 merge) rather than local `main` (`f51e320`). The 15 commits in between contain **every artifact this plan depends on**: `02-02-PLAN.md` itself, 02-01's `ledger.server.ts`, the ledger Prisma models and migration, and the shared test helpers. Nothing in the plan was executable. This is the known #2649 base-drift failure mode.
- **Fix:** Verified `main` is a strict descendant of the fork point and that my branch had zero commits of its own, then `git merge --ff-only main`. A fast-forward of my own per-agent branch — non-destructive, no protected ref touched, no history rewritten. The pulled commits already exist on `main`, so merging this branch back contributes only my own work.
- **Verification:** `git merge-base --is-ancestor` confirmed fast-forward safety beforehand; `npm ci` + full suite green (74/74) established a clean baseline afterward.
- **Committed in:** N/A (branch pointer move, no new commit)

**2. [Rule 1 - Bug] Shared scrubber as `.ts` would have crashed the production server at boot**

- **Found during:** Task 3
- **Issue:** The plan specifies `app/sentry-redact.ts`. But `instrument.server.mjs` is loaded by **raw Node** via `NODE_OPTIONS='--import ./instrument.server.mjs'`, before any bundler or loader exists — and the Dockerfile pins `node:20-alpine`, which has no TypeScript type-stripping. A `.ts` module would import fine on this Node 22.20 dev machine, pass every local test and the build, and then crash the deployed server on startup. 02-05 deploys, so this would have surfaced as a mystery production outage.
- **Fix:** Created `app/sentry-redact.mjs` — plain ESM with JSDoc types. Importable by raw Node 20, Vite's client bundle, and vitest alike; typechecked by `tsc` because tsconfig already sets `allowJs: true`, so no extra declaration file was needed. The file's header documents why it is not `.ts` so nobody "fixes" it later.
- **Verification:** `node --import ./instrument.server.mjs -e "..."` → OK (this is the actual production boot path); `npm run typecheck` exit 0; `npm run build` exit 0; 24 scrubber tests pass.
- **Committed in:** `38d636a`

**3. [Rule 2 - Missing Critical] Kept the scrubber failing CLOSED on unparseable URLs**

- **Found during:** Task 3
- **Issue:** The plan's behavior list says malformed URLs should "pass through unmodified rather than throwing". Both existing implementations instead return `[redacted]`. Passing an uninspectable string through would be a privacy **regression** against threat T-02-09 — a malformed URL can still contain an `id_token` substring, and forwarding it unscrubbed is exactly the leak this control exists to prevent.
- **Fix:** Kept the fail-closed behaviour. The essential requirement — *does not throw* — is preserved and tested across four malformed inputs. The test states the reasoning inline so the divergence from the plan is not mistaken for an oversight.
- **Verification:** `tests/sentry-scrub.test.ts` — "fails CLOSED — an unparseable URL never forwards credential material", plus four `not.toThrow()` cases.
- **Committed in:** `38d636a`

**4. [Rule 1 - Bug] Relative URLs could leak the parser's placeholder origin**

- **Found during:** Task 3
- **Issue:** Both original implementations chose their output form with `url.startsWith("/")`. A bare relative URL without a leading slash (e.g. `foo?id_token=…`) therefore took the absolute branch and serialised to `https://placeholder.invalid/foo?...`, injecting a fake host into the event.
- **Fix:** Detect absoluteness by scheme (`/^[a-z][a-z0-9+.-]*:\/\//i`) instead of a leading slash, so anything without a scheme emits `path + query` only.
- **Verification:** `tests/sentry-scrub.test.ts` — "scrubs a relative path without inventing an origin" asserts `not.toContain("placeholder.invalid")`.
- **Committed in:** `38d636a`

**5. [Process] Task 2 shipped as one `test` commit, not a RED→GREEN pair**

- **Found during:** Task 2
- **Issue:** The acceptance criteria require "RED commit precedes GREEN commit". Task 2's `files` list contains only `tests/webhooks.chaos.test.ts` — it adds no production behaviour. The chaos suite passed on first run because 02-01 built the ingest path correctly, so there was no bug to fix and therefore no GREEN half. Manufacturing a RED commit would have meant committing a knowingly-broken production state, poisoning `git bisect` and any CI on that commit.
- **Fix:** Satisfied the *intent* of the RED gate — proof the suite can fail — with a mutation experiment instead: removed `ORDERS_UPDATED` from the orders route switch, confirmed all 7 scenarios go red with the correct money errors, then reverted via targeted `git checkout -- app/routes/webhooks.orders.tsx`. The mutation was never committed. Committed the suite as a single `test(02-02)` commit whose message records the mutation result.
- **Verification:** Mutation run output captured in the commit message; `git diff --name-status f51e320 HEAD` confirms `webhooks.orders.tsx` is unmodified on this branch.
- **Committed in:** `b11367f`

---

**Total deviations:** 5 (1 blocking, 2 bugs, 1 missing-critical, 1 process)
**Impact on plan:** No scope creep. Deviation 1 was a precondition for executing at all; 2–4 are correctness/privacy fixes discovered while implementing the planned work; 5 is a documented, reasoned departure from a TDD ceremony that does not apply to a test-only task. Deviation 2 in particular caught a bug that would not have surfaced until production deploy.

## Issues Encountered

- **No `node_modules` in the fresh worktree.** Resolved with `npm ci`, which installs from the lockfile without modifying `package.json` or `package-lock.json` — both owned by sibling 02-04. Confirmed clean with `git status` afterward.
- **`payment_terms` payload shape is unverified.** No live delivery has been observed, and RESEARCH.md documents the topics but not their payload bodies. The extractor accepts `order_id`, an Order-typed `admin_graphql_api_id`, nested `order.{id,admin_graphql_api_id}`, and `payment_schedule.order_id`, and safely returns null otherwise. Flagged for 02-05 (see below).

## File Ownership Compliance

`git diff --name-status f51e320 HEAD` lists exactly 8 files, all within this plan's declared surface (with `.mjs` substituted for `.ts` per Deviation 2). Untouched: `prisma/schema.prisma`, `prisma/migrations/`, `package.json`, `package-lock.json`, `vitest.config.ts`, `shopify.app.toml`, `app/services/ledger.server.ts`, `tests/helpers/*`, `tests/fixtures/*`. Per instruction, `STATE.md` and `ROADMAP.md` were not modified and nothing was pushed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Ready for 02-05 (deploy/TOML):**

- Two new endpoints need `[[webhooks.subscriptions]]` blocks: `/webhooks/payment-terms` (topics `payment_terms/create`, `payment_terms/update`, `payment_terms/delete`, `payment_schedules/due`) and `/webhooks/companies` (`companies/create`, `companies/update`, `companies/delete`). Both require `read_payment_terms` / `read_companies` scopes per RESEARCH.md.
- **Action for 02-05 — the one open question this plan could not close:** trigger a real `payment_terms/update` on `credit-guard-demo.myshopify.com` and record which field actually carries the order reference. `extractOrderGidFromTermsPayload` accepts several spellings and fails safe, but only a live delivery confirms which one Shopify sends. If none matches, the route logs and defers to reconciliation rather than misbehaving — so this is a coverage gap, not a correctness risk.

**Fixture-shape learnings for 02-05's deployed triggers:**

- A settled order needs BOTH `outstanding: "0.00"` and a non-null schedule `completedAt` — `contributes()` gates on the open schedule, not the outstanding total, so a fixture with only the zeroed total still contributes and produces a confusing non-zero exposure.
- `PurchasingCompany.location` (not `companyLocation`) — 02-01's correction holds; codegen validates it.
- `overdue` is wall-clock dependent (`recomputeCompany` defaults `now` to `new Date()`). The chaos suite is immune because baseline and chaos snapshots are taken milliseconds apart, but any deployed assertion on `overdue` must pin `now` or pick fixture dates far from today.

**No blockers for siblings.** 02-03 and 02-04 consume nothing this plan produced.

## Self-Check: PASSED

- All 6 created files verified present on disk via `ls -la`
- All 4 commits verified in `git log`: `abe4b9f`, `b11367f`, `078570a`, `38d636a`
- Plan verification run verbatim: `npm test -- --run` → 117 passed / 8 files; `npm run typecheck` → exit 0; `npm run build` → exit 0; `npm run lint` → clean
- Production boot path verified: `node --import ./instrument.server.mjs` → OK
- All task acceptance criteria re-run and passing (route grep checks, `authenticate.webhook` first-await, no direct prisma writes in routes, no `orders/paid` in the coalescing scenario)
- No stubs, no skipped tests, no unrun `<verify>` commands

---
*Phase: 02-ar-ledger-credit-engine*
*Completed: 2026-08-19*
