---
phase: 03-credit-controls-metafield-publishing
plan: 01
subsystem: services
tags: [metafields, credit-limit, shopify-functions-contract, prisma, sha256, metafieldsSet, tdd, mutation-testing]

# Dependency graph
requires:
  - phase: 02-ar-ledger-credit-engine
    plan: 01
    provides: "recomputeCompany (sole writer of exposure/overdue/earliestDueAt), graphqlJson transport (T-02-27), admin-client mock seam"
  - phase: 02-ar-ledger-credit-engine
    plan: 06
    provides: "attributionStatus tri-state (ATTRIBUTED/UNRESOLVED/NO_COMPANY) + hasPaymentTerms the L-01 data_complete query filters on"
  - phase: 01-foundation-compliance
    provides: "Shop.active lifecycle switch the publisher gates on (SCHEDULER CONTRACT)"
provides:
  - "Company columns: creditLimit Decimal(19,4) nullable NO-default (null IS observe-only, D-02), bypassEnforcement default false (D-03), publishedStateHash, publishedAt — migration add_company_credit_controls applied to creditguard_dev + creditguard_test"
  - "app/services/metafields.server.ts — single writer of $app/credit_v1: serializeCreditState, creditStateHash (sha256 minus computed_at), shopDataComplete (L-01), publishCompanyCreditState (non-throwing, Shop.active-gated, hash-skip, explicit userErrors check), PUBLISH_COMPANY_CREDIT_MUTATION, MetafieldPublishError"
  - "recomputeCompany → publishCompanyCreditState hook: every state change publishes credit_v1 within the same handling (CRED-03 'within seconds' path), D-05 sole-writer preserved"
  - "tests/metafield-contract.test.ts — byte-exact credit_v1 snapshot fixtures; THE source Phase 4 Function fixtures are generated from"
  - "tests/metafield-publish.test.ts — publish wiring + every edge (hash-skip, dirty retry, userErrors trap, Shop.active gate, L-01, ordering)"
  - "admin-client-mock default benign PublishCompanyCredit fixture (explicit fixtures still win; throw-on-unregistered preserved for other operations)"
affects: [03-02, 03-03, 03-04, 03-05, phase-04-checkout-enforcement]

actuals:
  tokens: 10200
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Contract-lock snapshot test with raw-substring assertions alongside parse-equality, so number-vs-string regressions cannot hide"
    - "Non-throwing publisher: whole body in try/catch → Sentry.captureException with tags { publisher, shop } → return; dirty marker publishedAt < recomputedAt is the retry state"
    - "Hash-skip: sha256 over canonical serialization minus computed_at; skip only when hash equal AND publishedAt >= recomputedAt"
    - "Mutation-test convention for green-first tests: invert each guard, watch exactly the guarding test fail, revert"
    - "Mock-default fixture for a hook that fires inside an already-tested path, keeping the whole prior suite green without per-suite edits"

key-files:
  created:
    - app/services/metafields.server.ts
    - prisma/migrations/20260819160906_add_company_credit_controls/migration.sql
    - tests/metafield-contract.test.ts
    - tests/metafield-publish.test.ts
  modified:
    - prisma/schema.prisma
    - app/services/ledger.server.ts
    - tests/helpers/admin-client-mock.ts

key-decisions:
  - "computed_at for a never-recomputed row (recomputedAt null) stamps the publish instant — the null branch PUBLISHES (checker info-4 lock: fail toward freshness)"
  - "L-04 'most recent LedgerOrder' resolved as ORDER BY refetchedAt DESC — the row most recently confirmed against source"
  - "MetafieldPublishError exported (not just internal) so tests assert the exact error class reaching Sentry"
  - "creditStateHash pinned to a sha256 constant in the contract test after a Date.now() salt mutation escaped the equality-only test (same-millisecond collision)"

duration: 25min
completed: 2026-08-19
status: complete
---

# Phase 3 Plan 01: Credit Controls Schema + credit_v1 Metafield Publishing Tracer Summary

**recomputeCompany now projects every committed credit-state change into a `$app`/`credit_v1` metafieldsSet within the same handling — schema columns, byte-locked serializer contract, non-throwing hash-skipping publisher, all proven at the mocked admin seam on top of the 235-test baseline.**

## What Was Built

- **Schema (CRED-01/02, D-02/D-03):** `Company.creditLimit Decimal(19,4)` nullable with NO default (null IS the observe-only encoding), `bypassEnforcement` default false, plus `publishedStateHash`/`publishedAt` publish bookkeeping. Additive zero-downtime migration `add_company_credit_controls` applied to `creditguard_dev` and `creditguard_test` (verified `migrate status` up-to-date on both). No new model → REDACTION CONTRACT untouched.
- **`app/services/metafields.server.ts` — the single writer of credit_v1.** Contract-doc header carries the payload law (field table, decimal-strings-never-numbers, `limit: null` ≠ `"0.00"`, additive-only within v1 / breaking = credit_v2 alongside, L-01/L-03/L-04). Exports `serializeCreditState` (canonical key order v, limit, exposure, currency, overdue, bypass, data_complete, computed_at; money via `Decimal.toFixed(2)`), `creditStateHash` (sha256 hex, computed_at excluded), `shopDataComplete` (L-01 NOT-EXISTS: UNRESOLVED + hasPaymentTerms=true), and `publishCompanyCreditState` — Shop.active gate, shop-keyed Company read (T-03-06), hash-skip (skip only when hash equal AND publishedAt ≥ recomputedAt; null recomputedAt publishes), `metafieldsSet` via `graphqlJson` label `PublishCompanyCredit`, **explicit userErrors check** (the Pitfall-1 trap: failures arrive inside `data` with empty top-level `errors[]`), bookkeeping advanced on success only, and the entire body non-throwing (catch → Sentry with `{ publisher: "credit_v1", shop }`).
- **Hook (D-05):** `recomputeCompany` fires the publish after its `db.company.update`, outside any transaction. The publisher only projects — a tracer assertion proves exposure/overdue/earliestDueAt are byte-identical to what recompute wrote.
- **Tests:** 23 new (258 total, was 235). Contract suite locks the exact serialized bytes with raw-substring checks and a pinned hash constant; publish suite covers the tracer, hash-skip, backdated-publishedAt dirty retry, null-recomputedAt publish, userErrors trap (Sentry + no bookkeeping advance + caller does not throw), transport-throw swallow, Shop.active gate, all three L-01 attribution cases, sequential-recompute convergence, and limit/bypass projection.
- **Codegen typing:** `PUBLISH_COMPANY_CREDIT_MUTATION` validates against `admin-2026-07.schema.json`; the response `data` is the generated `PublishCompanyCreditMutation`.

## Commits

| Commit | Type | Content |
|---|---|---|
| `dd59ae6` | feat(03-01) | Tracer: schema + migration, metafields.server.ts, recompute hook, mock default fixture, tracer test |
| `c4cdde5` | test(03-01) | Contract byte-shape lock + publisher edge suites, mutation-validated |
| `1a59fbf` | chore(03-01) | Codegen-generated PublishCompanyCreditMutation response typing; full-suite regression |
| (this) | docs(03-01) | SUMMARY |

## Verification

- `npx vitest run tests/metafield-contract.test.ts tests/metafield-publish.test.ts` — 23/23 green
- `npm test` — 258/258 green (235 baseline preserved with the hook live)
- `npm run graphql-codegen && npm run typecheck && npm run build && npm run lint` — all exit 0
- `prisma migrate status` — "Database schema is up to date" on creditguard_dev AND creditguard_test
- Comment-filtered grep: metafields.server.ts contains no direct admin-context usage (T-02-27 transport contract)
- `git diff --name-only HEAD -- package.json` — empty; zero dependency changes (hashing is node:crypto)
- Only this plan's files touched: ledger.server.ts, metafields.server.ts, schema.prisma + migration, admin-client-mock.ts, two new test files

## TDD / Mutation Evidence

Tracer ran red-first (failed on `PublishCompanyCredit` call count 0 vs 1) before any implementation existed. Task 2's edge tests landed green-first against the full Task 1 implementation, so the plan's mutation-test convention was applied — six guard inversions, each failing exactly its guarding test before revert:

1. userErrors length check removed → userErrors-trap test failed
2. Shop.active gate removed → gate test failed
3. hash-skip disabled → zero-further-calls test failed
4. null-recomputedAt rows skipped → fail-toward-freshness test failed
5. hasPaymentTerms filter dropped from shopDataComplete → D2C-UNRESOLVED test failed
6. per-call salt added to creditStateHash → initially ESCAPED (Date.now() collides across two immediate calls); the test was hardened with a pinned sha256 constant, after which the mutation was caught

## Deviations from Plan

None — plan executed as written. One test hardened beyond spec: the hash-stability test gained a pinned sha256 constant after mutation testing exposed that equality-only assertions cannot catch a same-millisecond timestamp salt (documented in key-decisions; strictly additive to the required behavior list).

## Notes for Later Plans

- **03-04 (sweep backstop):** the retry channel is exactly `publishedAt < recomputedAt`; hash-skip only fires on publish calls that are NOT preceded by a fresh recompute (a recompute always bumps recomputedAt past publishedAt, so recompute-driven publishes always write — the sweep's direct `publishCompanyCreditState` calls are where hash-skip saves API calls).
- **Phase 4:** generate Function fixtures from `tests/metafield-contract.test.ts` expected strings — they are the contract carrier.
- **Post-merge housekeeping:** `app/types/` is gitignored; run `npm run graphql-codegen` after checkout before a standalone `npm run typecheck` (the verify chain in this plan and the main working tree both already have it generated).
- Live-store proof of the publish lands in 03-05 after the write_companies re-consent (unchanged from plan).

## Self-Check: PASSED

- app/services/metafields.server.ts — FOUND
- prisma/migrations/20260819160906_add_company_credit_controls/migration.sql — FOUND
- tests/metafield-contract.test.ts — FOUND
- tests/metafield-publish.test.ts — FOUND
- Commits dd59ae6, c4cdde5, 1a59fbf — FOUND in git log
