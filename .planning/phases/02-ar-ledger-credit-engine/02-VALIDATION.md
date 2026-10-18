---
phase: 2
slug: ar-ledger-credit-engine
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: true
created: 2026-08-19
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.10 (installed Phase 1; creditguard_test isolation via pretest migrate) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- --run` |
| **Full suite command** | `npm test -- --run && npm run typecheck` |
| **Estimated runtime** | ~60 seconds (grows with chaos tests) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run`
- **After every plan wave:** Run `npm test -- --run && npm run typecheck && npm run build`
- **Before `/gsd-verify-work`:** Full suite green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 02-01 | 1 | LEDG-02 | T-02-01/02/05 | Forged HMAC → 401 zero rows; payload doorbell-only; shop-scoped upserts | integration (tracer) | `npx vitest run tests/webhooks.orders.test.ts` | ❌ created in-task | ⬜ pending |
| 02-01-T2 | 02-01 | 1 | LEDG-03 | T-02-04 | D-03 source-guard: attribution via purchasingEntity only | unit (pure core) | `npx vitest run tests/credit-engine.test.ts` | ❌ created in-task | ⬜ pending |
| 02-01-T3 | 02-01 | 1 | LEDG-02 | T-02-03/05 | Dedupe idempotency; redaction covers new tables; bystander survives | integration | `npm test -- --run` | ❌ created in-task | ⬜ pending |
| 02-02-T1 | 02-02 | 2 | LEDG-02 | T-02-07/11 | 401 on both new routes; thin handlers, no direct ledger writes | integration (tracer) | `npx vitest run tests/webhooks.b2b-events.test.ts` | ❌ created in-task | ⬜ pending |
| 02-02-T2 | 02-02 | 2 | LEDG-02/03 | T-02-08 | Chaos convergence: duplicate/replay/out-of-order/coalesced | integration | `npx vitest run tests/webhooks.chaos.test.ts` | ❌ created in-task | ⬜ pending |
| 02-02-T3 | 02-02 | 2 | W-2 debt | T-02-09 | redactUrl scrubs tokens; both Sentry inits share one module | unit | `npx vitest run tests/sentry-scrub.test.ts` | ❌ created in-task | ⬜ pending |
| 02-03-T1 | 02-03 | 2 | LEDG-01 | T-02-14/16 | Idempotent trigger; no order-age window (D-06 grep) | integration (tracer) | `npx vitest run tests/backfill.test.ts` | ❌ created in-task | ⬜ pending |
| 02-03-T2 | 02-03 | 2 | LEDG-01 | T-02-12/13 | JSONL url only from authenticated query (SSRF guard); unknown gid ignored | integration | `npx vitest run tests/backfill.test.ts` | ❌ created in-task | ⬜ pending |
| 02-03-T3 | 02-03 | 2 | LEDG-01 | T-02-14 | Empty-store, determinism, replay edges | integration | `npm test -- --run` | ❌ created in-task | ⬜ pending |
| 02-04-T1 | 02-04 | 2 | LEDG-05 | T-02-17/18/SC | Active-only sweeps; lease exclusion; strict-past dueAt boundary | integration (tracer) | `npx vitest run tests/scheduler.test.ts` | ❌ created in-task | ⬜ pending |
| 02-04-T2 | 02-04 | 2 | LEDG-04 | T-02-19/20 | Drift corrected by full recompute + Sentry warning | integration | `npx vitest run tests/reconciliation.test.ts` | ❌ created in-task | ⬜ pending |
| 02-04-T3 | 02-04 | 2 | LEDG-04/05 | T-02-17 | CF-3 source-guard; SIGTERM; lease wiring | unit (source) | `npm test -- --run` | ❌ created in-task | ⬜ pending |
| 02-05-T1 | 02-05 | 3 | LEDG-02 | T-02-21/23/24 | Exact 4-scope set; TOML byte-diff; api_version pin | integration (deployed tracer) | `bash scripts/smoke-deployed.sh app.creditguardhq.com && npm test -- --run` | ❌ created in-task | ⬜ pending |
| 02-05-T2 | 02-05 | 3 | LEDG-02 | T-02-22/24 | Secrets never in argv; no error-suppressing fallbacks; 401 on all new surfaces | deployed script | `bash scripts/smoke-deployed.sh app.creditguardhq.com` | ❌ created in-task | ⬜ pending |
| 02-05-T3 | 02-05 | 3 | LEDG-01/03 | T-02-25 | Backfill-vs-admin comparison; A2/A7 verdicts recorded | deployed + human-check | `bash scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com \| jq -e '.backfill.status == "completed"'` | ❌ created in-task | ⬜ pending |
| 02-06-T1 | 02-06 | 4 | LEDG-02/03 | T-02-26 | Company-side attribution tracer: hinted order → authenticated company-edge scan → ATTRIBUTED row + nonzero exposure; attributionStatus migration on both DBs | integration (tracer) | `npx vitest run tests/webhooks.orders.test.ts && npm run graphql-codegen` | ❌ created in-task | ⬜ pending |
| 02-06-T2 | 02-06 | 4 | LEDG-02/03 | T-02-26 | Full resolution ladder (known/hinted/hint-miss/unresolved); chaos convergence identical under company-side attribution; UNRESOLVED distinct from proven-none | integration | `npx vitest run tests/webhooks.orders.test.ts tests/webhooks.chaos.test.ts tests/webhooks.b2b-events.test.ts` | ❌ created in-task | ⬜ pending |
| 02-06-T3 | 02-06 | 4 | LEDG-02 | T-02-27 | ACCESS_DENIED throws LedgerGraphqlError naming the missing scope, zero ledger writes; document source-guard bans the trapped field | unit + integration | `npx vitest run tests/graphql-error-surfacing.test.ts && npm test -- --run` | ❌ created in-task | ⬜ pending |
| 02-07-T1 | 02-07 | 5 | LEDG-01 | T-02-27 | Company-driven backfill tracer: enumerate → ingest → exact exposures + overdue flip + completed re-entrant state; D-06 no-window grep | integration (tracer) | `npx vitest run tests/backfill.test.ts` | ❌ created in-task | ⬜ pending |
| 02-07-T2 | 02-07 | 5 | LEDG-01 | T-02-14 | Empty shop, replay determinism, mid-run failure → failed+re-claim, stale-poll self-heal, page caps, BackfillState key freeze | integration | `npx vitest run tests/backfill.test.ts` | ❌ created in-task | ⬜ pending |
| 02-07-T3 | 02-07 | 5 | LEDG-01 | T-02-13 (retired) / T-02-29 | Bulk machinery deleted (no fetch in module), finish route safe no-op, 15-topic registration guard intact | integration + grep gates | `npm test -- --run && npm run typecheck` | ❌ created in-task | ⬜ pending |
| 02-08-T1 | 02-08 | 6 | LEDG-04/05 | T-02-27 | Scope-clean cursor scan; attribution pass heals missed attribution ≤1 cycle; UNRESOLVED→NO_COMPANY exhaustion flip; overdue flips with injected clock | integration | `npx vitest run tests/reconciliation.test.ts tests/graphql-error-surfacing.test.ts` | ❌ created in-task | ⬜ pending |
| 02-08-T2 | 02-08 | 6 | LEDG-01 | T-02-30 | Cursor-clear script scoped to [shop, backfill] only; state script reports attribution counts + session scopes; no secrets/suppression in scripts | script gates | `bash -n scripts/prod-clear-backfill.sh && npm test -- --run` | ❌ created in-task | ⬜ pending |
| 02-08-T3 | 02-08 | 6 | LEDG-01 | T-02-31 | Deployed with attribution migration; smoke 401s; cursor cleared; readiness gate (4 conditions) before the one-tap handoff | deployed script | `bash scripts/smoke-deployed.sh app.creditguardhq.com && bash scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com \| jq -e '(.backfill.status // "absent") == "absent"'` | ❌ created in-task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **Gap closure 2026-08-19 (WINDOWS.md defect 5):** rows 02-06-T1 … 02-08-T3 close the purchasingEntity/read_customers attribution defect via company-side attribution. The post-tap empirical check (backfill-vs-admin, D9) remains a Manual-Only Verification below and closes success criterion 1.

---

## Wave 0 Requirements

Existing infrastructure covers the framework; Phase 2 Wave 0 items are data-shaped:

- [ ] JSONL bulk-operation fixture (with `__parentId` child lines) for backfill reassembly tests
- [ ] Order/PaymentSchedule GraphQL response fixtures covering: unpaid, partially-paid, refunded, edited, cancelled
- [ ] Webhook chaos harness: duplicate delivery, out-of-order delivery, replay of stale payloads

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Backfilled balances match Shopify admin | LEDG-01 | Success criterion 1 compares against admin-visible numbers on the dev store | Create B2B test orders with net terms on dev store; run backfill; compare per-company totals against admin |
| totalOutstandingSet through partial-pay → refund sequence (research A2) | LEDG-03 | Requires live dev-store order manipulation | Execute the A2 test sequence from 02-RESEARCH.md on the dev store before trusting exposure math |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
