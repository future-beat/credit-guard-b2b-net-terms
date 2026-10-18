---
phase: 3
slug: credit-controls-metafield-publishing
status: planned
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-19
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.10 (creditguard_test isolation via pretest migrate) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- --run` |
| **Full suite command** | `npm test -- --run && npm run typecheck` |
| **Estimated runtime** | ~90 seconds |

## Sampling Rate

- **After every task commit:** `npm test -- --run`
- **After every plan wave:** `npm test -- --run && npm run typecheck && npm run build && npm run graphql-codegen`
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** 120 seconds

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01/T1 (tracer) | 03-01 | 1 | CRED-03 | T-03-06, T-03-09 | Shop-keyed publish, ownerId from shop-scoped row, non-throwing into webhook path | integration (mocked admin seam + creditguard_test) | `npx vitest run tests/metafield-publish.test.ts` | ❌ Wave 0 (created in-task, red-first) | ⬜ pending |
| 03-01/T2 | 03-01 | 1 | CRED-03, CRED-04 | T-03-07 | Fixed-field payload (no PII), userErrors-as-failure, Shop.active gate, L-01 data_complete | unit snapshot + integration | `npx vitest run tests/metafield-contract.test.ts tests/metafield-publish.test.ts` | ❌ Wave 0 (created in-task) | ⬜ pending |
| 03-01/T3 | 03-01 | 1 | CRED-03 | — | Codegen-validated mutation document; 235-baseline regression with hook live | full suite | `npm run graphql-codegen && npm run typecheck && npm test` | ✅ existing suite | ⬜ pending |
| 03-02/T1 | 03-02 | 1 | CRED-03 | T-03-08 | Least-privilege five-scope string; three-place lockstep guard | source guard | `npx vitest run tests/scope-lockstep.test.ts` | ❌ Wave 0 (created in-task) | ⬜ pending |
| 03-02/T2 | 03-02 | 1 | CRED-03 | T-03-05, T-03-14 | merchant_read definition; CF-5 byte-guard after every CLI call | grep gates + CLI checks | `grep -c 'api_version = "2026-07"' shopify.app.toml` == 1 (+ scope/url greps, railway variables) | n/a (config) | ⬜ pending |
| 03-03/T1 | 03-03 | 2 | CRED-01, CRED-02 | T-03-01, T-03-02, T-03-03, T-03-04 | shop-from-session WHERE, intent whitelist, grammar-first validation, value-echo CAS | integration (action + creditguard_test) | `npx vitest run tests/companies-settings.test.ts` | ❌ Wave 0 (created in-task, red-first) | ⬜ pending |
| 03-03/T2 | 03-03 | 2 | CRED-01, CRED-04 | — | D-02 null-vs-0 rendering, honesty rule (no success tone) | typecheck + build + negative greps | `npm run typecheck && npm run build` + tone/polaris/parse greps | n/a (UI) | ⬜ pending |
| 03-03/T3 | 03-03 | 2 | CRED-01, CRED-02 | T-03-15 | Confirmed-not-optimistic limit save; optimistic-with-revert bypass | integration + full suite | `npx vitest run tests/companies-settings.test.ts && npm test` | ❌ Wave 0 (extended in-task) | ⬜ pending |
| 03-04/T1 | 03-04 | 2 | CRED-03 | T-03-16, T-03-11 | forEachActiveShop-only enumeration; hash-skip-bounded fan-out; per-company isolation | integration (injected clock + mock seam) | `npx vitest run tests/scheduler.test.ts` | ✅ exists (extended) | ⬜ pending |
| 03-04/T2 | 03-04 | 2 | CRED-03 | T-03-17 | Fourth-service document guard (transport + banned selections) | source guard | `npx vitest run tests/graphql-error-surfacing.test.ts` | ✅ exists (extended) | ⬜ pending |
| 03-05/T1 | 03-05 | 3 | CRED-03 | T-03-12, T-03-13 | Token in-container only, absent from serialized output; read-only queries | script hygiene | `node --check` + accessToken-absence greps | ❌ created in-task | ⬜ pending |
| 03-05/T2 | 03-05 | 3 | CRED-03 | — | Release-phase migration; TOML byte-untouched (no CLI run) | deployed smoke + JSON shape check | `bash scripts/smoke-deployed.sh` + prod-ledger-state shape assert | ✅ exists | ⬜ pending |
| 03-05/T3 | 03-05 | 3 | CRED-01..04 | T-03-12 | Live payload assertions (exact limit string, null for untouched, bypass true) without evidence massaging | live read-back (scripted) | `bash scripts/prod-credit-metafields.sh` + node assertion pipe | ❌ created in T1 | ⬜ pending |

## Wave 0 Requirements

Existing infra covers framework + mocks. Phase-3 Wave 0 items:
- [ ] metafieldsSet mock fixtures incl. the userErrors-with-empty-errors[] shape (the trap)
- [ ] Value-echo CAS conflict fixtures (concurrent limit edit)
- [ ] Publish hash-skip fixtures (unchanged state → no mutation call)

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live metafield readable on real Company records | CRED-03 | Roadmap note: contract must be verifiable on real records before Phase 4 | Read back $app credit_v1 via GraphQL on dev store after publish (script) + eyeball values |
| Re-consent for write_companies | — | Browser-only scope approval | Accept permissions prompt on dev store after Wave 1 deploy |
| Inline-edit UX on dev store | CRED-01/02 | Visual/interaction UAT per UI-SPEC backstops | Edit limits, flip bypass, verify badges/toasts at default + narrow widths |

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (13/13 tasks carry `<automated>`; Wave 0 test files are created red-first inside the tasks that need them)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (metafieldsSet userErrors fixture — 03-01/T2; CAS conflict fixtures — 03-03/T1; hash-skip fixtures — 03-01/T2 + 03-04/T1; admin-mock default metafieldsSet success — 03-01/T1)
- [x] No watch-mode flags (all commands use `vitest run` / `npm test` = `vitest run`)
- [x] Feedback latency < 120s (per-file vitest runs ~seconds; full suite ~90s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner sign-off 2026-08-19 (5 plans, 13 tasks mapped)
