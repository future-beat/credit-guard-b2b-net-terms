---
phase: 01-foundation-compliance
plan: 03
subsystem: compliance
tags: [gdpr, webhooks, hmac, prisma, vitest, lifecycle, shopify-app-react-router]

requires:
  - "01-01 — React Router 7 scaffold, Prisma/Postgres datasource, shopify.app.toml, template uninstall webhook"
  - "01-02 — Railway deploy target and Sentry server capture (the route this plan adds reports through it)"
provides:
  - Wave 0 test infrastructure — vitest 4 pinned to creditguard_test with a committed dummy API secret
  - Signed-webhook test helper (tests/helpers/webhook-hmac.ts) reproducing real Shopify deliveries header-for-header
  - Prisma Shop model — the D-06 two-stage uninstall switch (active / uninstalledAt / redactedAt)
  - Prisma ComplianceRequest model — GDPR receipt metadata only, no payload column
  - app/services/shop-lifecycle.server.ts — ensureShopActive / deactivateShop / redactShop / logComplianceRequest
  - app/routes/webhooks.compliance.tsx — all three mandatory GDPR topics on one route
  - shopify.app.toml compliance_topics subscription ready for the 01-04 deploy sync
  - "Scheduler contract for Phase 2+: every scheduled job must filter Shop.active = true"
affects: [01-04, phase-02, phase-03, phase-04, phase-05]

actuals:
  tokens: 9700          # chars/4 over the realized diff (38,757 chars, lockfile and .planning excluded)
  tasks: 3
  commits: 5

tech-stack:
  added:
    - "vitest 4.1.10 (devDependency) — the major that peer-supports the template's Vite 7"
  patterns:
    - "Dedicated vitest.config.ts (not a test block in vite.config.ts) so React Router and Sentry build plugins stay out of the test pipeline"
    - "Route actions are tested by importing and invoking `action({ request })` directly with a Fetch Request — the library registers the web-api adapter, so no HTTP server is needed"
    - "authenticate.webhook is never mocked; HMAC behaviour is proven against the real library"
    - "Lifecycle operations key on the shop domain string and use upsert/deleteMany so redelivery is always a no-op"

key-files:
  created:
    - vitest.config.ts
    - tests/helpers/webhook-hmac.ts
    - tests/helpers/webhook-hmac.test.ts
    - tests/shop-lifecycle.test.ts
    - tests/webhooks.compliance.test.ts
    - app/services/shop-lifecycle.server.ts
    - app/routes/webhooks.compliance.tsx
    - prisma/migrations/20260818132232_add_shop_lifecycle/
  modified:
    - prisma/schema.prisma
    - app/routes/webhooks.app.uninstalled.tsx
    - app/routes/app.tsx
    - shopify.app.toml
    - package.json

key-decisions:
  - "A1 RESOLVED from library source, not assumption: @shopify/shopify-api `topicForStorage()` is `topic.toUpperCase().replace(/\\/|\\./g, '_')`, so the switch cases are CUSTOMERS_DATA_REQUEST, CUSTOMERS_REDACT, SHOP_REDACT — the research guess was correct but is now verified"
  - "A4 RESOLVED: installed vitest 4 rather than the assumed 3.x — vitest 4.1.10 declares `vite: ^6 || ^7 || ^8`, matching the template's Vite 7.3.6 exactly; vitest 3 predates Vite 7"
  - "Test database URL is derived (`TEST_DATABASE_URL` override, else postgresql://$USER@localhost:5432/creditguard_test) rather than hardcoding the developer's role into a committed config"
  - "deactivateShop upserts rather than updates — an uninstall can legitimately arrive for a shop we hold no row for, and recording it inactive is what lets a later shop/redact clean up after it"
  - "redactShop deletes sessions too, and runs all three deletes in one transaction — a redact must not leave a live access token behind if one delete fails"
  - "The HMAC helper self-test lives in a sibling tests/helpers/webhook-hmac.test.ts rather than an in-source describe block, so the helper stays free of includeSource machinery"
  - "The route ships a `default` switch case that acknowledges unknown topics without acting — an unhandled topic must not 500 into a Shopify retry storm"

patterns-established:
  - "Prohibitions get executable guards: source-level assertions prove the uninstall route holds no delete against retained tables and the compliance route dereferences no session"
  - "Every destructive-operation test also asserts what SURVIVED (retention counts, bystander-shop counts) — a delete-everything bug would otherwise pass a naive test"
  - "fileParallelism: false because all suites share one Postgres database and row-count assertions must stay deterministic"

requirements-completed: [FOUND-02, FOUND-03]

coverage:
  - id: D1
    description: "A webhook POST with an invalid HMAC receives 401 with zero side effects, on every compliance topic"
    requirement: FOUND-02
    threat: T-01-10
    verification:
      - kind: integration
        ref: "tests/webhooks.compliance.test.ts — 'invalid HMAC (threat T-01-10)' (3 tests: 401 status; forged shop/redact deletes nothing; forged data_request writes no receipt)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A validly-signed compliance webhook returns 200 and dispatches by topic — customer topics write a receipt, shop/redact hard-deletes every row for the shop"
    requirement: FOUND-02
    threat: T-01-14
    verification:
      - kind: integration
        ref: "tests/webhooks.compliance.test.ts — customers/data_request, customers/redact, shop/redact suites (5 tests, incl. bystander-shop isolation)"
        status: pass
    human_judgment: false
  - id: D3
    description: "app/uninstalled deletes sessions and sets Shop.active=false with uninstalledAt stamped, while every other row for the shop is RETAINED"
    requirement: FOUND-03
    threat: T-01-11
    verification:
      - kind: integration
        ref: "tests/shop-lifecycle.test.ts — 'app/uninstalled webhook route' + 'deactivateShop' suites; asserts sessions 0, shops 1, complianceRequests 1 after uninstall"
        status: pass
    human_judgment: false
  - id: D4
    description: "shop/redact is idempotent — a second delivery for an already-deleted shop still returns 200"
    requirement: FOUND-02
    threat: T-01-11
    verification:
      - kind: integration
        ref: "tests/webhooks.compliance.test.ts — 'returns 200 on redelivery for an already-redacted shop'; tests/shop-lifecycle.test.ts — 'is idempotent for an unknown or already-redacted shop'"
        status: pass
    human_judgment: false
  - id: D5
    description: "A re-install (first authenticated admin load after uninstall) flips Shop.active back to true and clears uninstalledAt"
    requirement: FOUND-03
    verification:
      - kind: integration
        ref: "tests/shop-lifecycle.test.ts — 'app layout loader (authenticated load reactivates)' invokes the real app.tsx loader with authenticate.admin stubbed"
        status: pass
    human_judgment: false
  - id: D6
    description: "Compliance handlers never dereference the session object — they work when session is undefined 48h post-uninstall"
    requirement: FOUND-02
    verification:
      - kind: integration
        ref: "tests/webhooks.compliance.test.ts — 'never dereferences a session' (comment-stripped source assertion); all compliance tests run with no Session row present"
        status: pass
    human_judgment: false
  - id: D7
    description: "ComplianceRequest stores receipt metadata only — the audit trail never becomes retained PII"
    requirement: FOUND-02
    threat: T-01-12
    verification:
      - kind: integration
        ref: "tests/shop-lifecycle.test.ts — asserts row keys are exactly [id, receivedAt, shop, topic]; prisma/schema.prisma has no payload/body/json column"
        status: pass
    human_judgment: false
  - id: D8
    description: "shopify.app.toml declares all three compliance topics on /webhooks/compliance under api_version 2026-07"
    requirement: FOUND-02
    verification:
      - kind: integration
        ref: "tests/webhooks.compliance.test.ts — 'declares all three compliance topics'; plan verify `grep -q 'compliance_topics' && grep -q 'webhooks/compliance'`"
        status: pass
    human_judgment: false
  - id: D9
    description: "Compliance requests are actioned within Shopify's 30-day deadline — receipt rows provide the audit trail"
    requirement: FOUND-02
    verification:
      - kind: backstop
        ref: "process check at app-review time; ComplianceRequest rows are appended per delivery (proven by 'appends rather than overwrites') so receipt timestamps constitute the trail"
        status: deferred
    human_judgment: true
    rationale: "A calendar-deadline process cannot be asserted from code; the machinery it depends on (per-delivery receipt rows) is test-proven"
  - id: D10
    description: "Deployed endpoint answers forged posts with 401 and Partner dashboard automated compliance checks pass"
    requirement: FOUND-02
    verification:
      - kind: manual_procedural
        ref: "deferred to plan 01-04 by design — this plan is deliberately offline-verifiable and runs no `shopify app deploy`"
        status: deferred
    human_judgment: true
    rationale: "Requires the deployed registration sync and Shopify-side checker; 01-04-T1/T2 own it"

duration: ~40 minutes
completed: 2026-08-18
status: complete
---

# Phase 01 Plan 03: GDPR Compliance Webhooks + Two-Stage Uninstall Lifecycle Summary

**The three mandatory GDPR webhooks now answer 401 to forged posts and dispatch correctly to receipt-logging or hard deletion on valid ones, and uninstall deactivates-and-retains while `shop/redact` deletes — all of it proven by a 31-test vitest suite that runs in under a second against an isolated test database.**

## Performance

- **Duration:** ~40 minutes
- **Tasks:** 3 (1 auto, 2 TDD)
- **Commits:** 5 (RED and GREEN separated for both TDD tasks)
- **Files created/modified:** 13 (lockfile and planning docs excluded)
- **Suite runtime:** 778 ms for 31 tests across 3 files — well inside the 60 s max feedback latency in 01-VALIDATION.md

## Accomplishments

- **Wave 0 closed.** vitest 4 installed and configured; `npm test -- --run` and `npm run typecheck` both green. All three Wave 0 requirements in 01-VALIDATION.md are now delivered (framework, HMAC stubs, lifecycle stubs).
- **FOUND-02 proven locally.** A forged HMAC gets 401 with zero side effects on all three topics; a validly-signed delivery gets 200 and dispatches by topic. The library's `authenticate.webhook` is never mocked, so what the tests prove is the behaviour app review will actually exercise.
- **FOUND-03 proven locally.** Uninstall deletes sessions, flips `Shop.active` false, stamps `uninstalledAt`, and leaves every other row standing; `shop/redact` deletes everything for that shop and only that shop; both are idempotent under redelivery; an authenticated load reactivates.
- **Assumption A1 verified from source rather than assumed.** `topicForStorage()` in `@shopify/shopify-api` is `topic.toUpperCase().replace(/\/|\./g, '_')` — the switch cases are `CUSTOMERS_DATA_REQUEST`, `CUSTOMERS_REDACT`, `SHOP_REDACT`. This was the plan's highest-risk silent-failure mode (a mismatched case no-ops while still returning 200).
- **Migration applied to both databases before verification** (the [BLOCKING] gate), confirmed via `psql \dt` on each — not inferred from a green build.

## Confirmed Topic Strings (A1)

| Header value (`X-Shopify-Topic`) | String yielded to the route |
|----------------------------------|-----------------------------|
| `customers/data_request` | `CUSTOMERS_DATA_REQUEST` |
| `customers/redact` | `CUSTOMERS_REDACT` |
| `shop/redact` | `SHOP_REDACT` |

Normalisation rule, verified at `node_modules/@shopify/shopify-api/lib/webhooks/registry.ts:16-18`:
`topic.toUpperCase().replace(/\/|\./g, '_')`.

Also verified in the same pass: `authenticate.js` throws `new Response(undefined, { status: 401 })` on `WebhookValidationErrorReason.InvalidHmac`, **before** any handler code runs; the HMAC is base64 HMAC-SHA256 of the raw body (`HashFormat.Base64`), with no timestamp-tolerance check for webhooks.

## Scheduler Contract (Phase 2+)

Recorded as a module-level docblock in **`app/services/shop-lifecycle.server.ts`** (lines 3–21):

> Every scheduled job — credit recompute, reminder emails, metafield publishing — MUST filter `Shop.active = true`. A deactivated shop still has all of its rows on purpose; `active` is the only signal that says "stop doing work for this merchant."

This is the seam D-06 hangs off: because uninstall retains data, `active` is the *only* thing distinguishing a live merchant from an uninstalled one.

## Task Commits

1. **Task 1: Wave 0 test infra + Shop/ComplianceRequest schema** — `9e924be` (chore)
2. **Task 2 RED: failing lifecycle tests** — `43b7b25` (test)
3. **Task 2 GREEN: lifecycle service + D-06 uninstall** — `df19bbc` (feat)
4. **Task 3 RED: failing compliance webhook tests** — `1593277` (test)
5. **Task 3 GREEN: compliance route + TOML subscriptions** — `ac5226b` (feat)

## Verification Evidence

| Check | Result |
|-------|--------|
| `npm test -- --run` | 3 files, 31 tests passed (778 ms) |
| `npm run typecheck` | clean |
| `npm run build` | exit 0 |
| `npm run lint` | clean |
| `npx prisma migrate status` | "Database schema is up to date!" (2 migrations) |
| Tables in `creditguard_test` | Session, Shop, ComplianceRequest, _prisma_migrations |
| Tables in `creditguard_dev` | Session, Shop, ComplianceRequest, _prisma_migrations |
| `creditguard_dev` rows after test run | Shop 0, ComplianceRequest 0 — tests never touched it |
| `api_version` in shopify.app.toml | still `2026-07` (re-grepped after all edits) |
| `application_url` / `automatically_update_urls_on_dev` | unchanged (`https://app.creditguardhq.com` / `false`) |
| Task 3 verify command, verbatim | passed |

## Decisions Made

See `key-decisions` frontmatter. Two are load-bearing:

**vitest 4, not 3 (A4 resolved).** vitest 4.1.10 declares `vite: ^6.0.0 || ^7.0.0 || ^8.0.0`; the template runs Vite 7.3.6. vitest 3 predates Vite 7 and would have forced either a duplicate Vite install or a peer-conflict override. The plan explicitly permitted picking the matching major.

**`deactivateShop` upserts.** An `app/uninstalled` can arrive for a domain we hold no row for (webhook redelivery after a redact, or an install that never reached an authenticated load). Creating an inactive row rather than silently doing nothing means the uninstall is recorded and the later `shop/redact` has something to clean up — and it keeps the function honest about being idempotent.

## Deviations from Plan

### Auto-fixed / discretionary

**1. [Rule 3 — Blocking] Test database URL derived instead of hardcoded**
- **Found during:** Task 1
- **Issue:** The plan specified `DATABASE_URL=postgresql://localhost:5432/creditguard_test`. Prisma rejects role-less URLs with `P1010` (a trap already recorded in 01-01), and hardcoding this machine's role into a committed config would break the first other environment that runs the suite.
- **Fix:** `vitest.config.ts` and the `pretest` script both derive `postgresql://$USER@localhost:5432/creditguard_test`, overridable wholesale via `TEST_DATABASE_URL`.
- **Verification:** A test asserts `DATABASE_URL` contains `creditguard_test` and not `creditguard_dev`; `creditguard_dev` row counts confirmed 0 after the run.
- **Committed in:** `9e924be`

**2. [Discretionary] HMAC self-test in a sibling file, not an in-source describe block**
- **Issue:** The plan asked for the self-test "in the helper's own describe block". Doing that literally requires vitest `includeSource` plus `import.meta.vitest` guards inside the helper.
- **Fix:** `tests/helpers/webhook-hmac.test.ts` sits beside the helper and pins a known digest vector, satisfying the acceptance criterion ("`npm test -- --run` exits 0 running at least the HMAC helper self-test") without the extra machinery.
- **Committed in:** `9e924be`

**3. [Rule 2 — Missing critical] `redactShop` also deletes sessions, inside a transaction**
- **Issue:** The plan's behavior list named Shop and ComplianceRequest rows only. A redact that leaves a live access token row behind is both a GDPR gap and a security one, and three independent `deleteMany` calls could partially fail.
- **Fix:** All three deletes run in one `db.$transaction`; the shop/redact test asserts the session count is zero afterwards.
- **Committed in:** `df19bbc`

**4. [Rule 2 — Missing critical] `default` case on the topic switch**
- **Issue:** An unhandled topic routed to this endpoint would fall through silently; without an explicit branch, any future subscription change risks an unlogged no-op.
- **Fix:** `default` logs the unhandled topic and returns 200 — acknowledging rather than 500-ing into a Shopify retry storm — while changing nothing.
- **Committed in:** `ac5226b`

**5. [Discretionary] `fileParallelism: false` in the vitest config**
- **Issue:** All suites share one Postgres database; parallel files would make row-count assertions (retention, zero-rows-after-redact) racy.
- **Fix:** Serial file execution. Costs nothing at this size (778 ms total).
- **Committed in:** `9e924be`

**6. [Discretionary] Source-level guards for the two prohibitions**
- **Issue:** "MUST NOT delete on uninstall" and "MUST NOT dereference session" are prohibitions — behaviour tests can only prove the current code path, not that a future edit will not reintroduce them.
- **Fix:** Two assertions read the route sources: the uninstall route must contain no `shop.delete`/`complianceRequest.delete` and must contain `deactivateShop`; the compliance route, with comments stripped, must not mention `session`.
- **Committed in:** `43b7b25`, `1593277`

---

**Total deviations:** 6 (2 missing-critical, 1 blocking, 3 discretionary). **Impact:** none change plan scope; three strengthen the compliance/security posture beyond what the plan literally specified.

## Issues Encountered

- **`ComplianceRequest` needed an index on `shop`.** Every read path (receipt lookup, redact) filters by shop; added `@@index([shop])` in the same migration rather than leaving a sequential scan for Phase 5 to discover.
- **`.env` remains agent-unwritable** (global permission rule). The migration was run with `DATABASE_URL` passed inline on the command; no `.env` change was needed or attempted. The test suite gets its environment entirely from `vitest.config.ts`, so no `.env` dependency was introduced.
- **Vite 7 / vitest 3 incompatibility** surfaced exactly where A4 predicted, and resolved cleanly by taking vitest 4.
- **19 npm high-severity advisories** are reported by `npm audit` on the existing tree; none originate from vitest's subtree and none were introduced by this plan. Logged, not acted on — out of scope per the deviation scope boundary.

## Not Done (by design)

- **No `shopify app deploy`.** Plan 01-04 owns the registration sync, the deployed bad-HMAC/signed-webhook smoke scripts, and the Partner-dashboard automated compliance checks. Keeping this plan offline-verifiable is deliberate.
- **`customers/data_request` and `customers/redact` perform no data export or deletion.** Phase 1 stores zero customer PII, so the receipt IS the complete correct action. Both handlers become substantive in Phase 5 when reminder-email logs start holding contact data — the receipt rows already prove the endpoints work.

## Next Phase Readiness

**Ready for 01-04.** The compliance subscription is declared and the route is locally proven; 01-04 needs only to deploy, sync the registration, and run the deployed smoke tests. `Shop.active` and the lifecycle service are the seam Phase 2's scheduler plugs into.

## Self-Check: PASSED

All 9 claimed files exist on disk; all 5 claimed commit hashes resolve in `git log`. `prisma/schema.prisma` contains exactly one `model Shop` and one `model ComplianceRequest`, and the latter's fields are exactly `id, shop, topic, receivedAt` (the only `payload`/`body` occurrence in the file is the comment forbidding such a column). `topicForStorage` confirmed at `node_modules/@shopify/shopify-api/lib/webhooks/registry.ts:16-18`.
