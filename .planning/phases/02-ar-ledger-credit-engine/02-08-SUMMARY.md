---
phase: 02-ar-ledger-credit-engine
plan: 08
subsystem: ledger
tags: [reconciliation, attribution-heal, no-company-exhaustion, graphqljson, railway-deploy, readiness-gate, one-tap]

# Dependency graph
requires:
  - phase: 02-ar-ledger-credit-engine
    plan: 04
    provides: "reconcileShop/runReconciliationSweep contracts, drift/cursor/probe semantics, scheduler wiring"
  - phase: 02-ar-ledger-credit-engine
    plan: 06
    provides: "graphqlJson/LedgerGraphqlError, upsertOrderFromSource preserve-mode + attribution param, attributionStatus column, rung-3 UNRESOLVED ingest, source-guard suite with the 02-08 it.fails marker"
  - phase: 02-ar-ledger-credit-engine
    plan: 07
    provides: "enumerateCompanies (ordersCount riding along), ingestCompanyOrders, frozen BackfillState, prod-ledger-state railway-ssh pattern"
provides:
  - "Scope-clean reconciliation: ORDERS_UPDATED_SINCE_QUERY reduced (no purchasingEntity), transport on graphqlJson, PRESERVE-mode cursor scan"
  - "Attribution pass: re-page a company on ordersCount mismatch OR whenever any UNRESOLVED exists; heals a missed attribution within one sweep"
  - "UNRESOLVED→NO_COMPANY exhaustion flip: single updateMany gated on refetchedAt < sweep start — the ONLY writer of NO_COMPANY; never sticky (W-2 recovery test-locked)"
  - "ReconcileReport additive counters: attributed, flippedNoCompany"
  - "scripts/prod-clear-backfill.{sh,mjs}: audited one-row production cursor clear over railway ssh"
  - "scripts/prod-ledger-state.mjs: additive attribution{attributed,unresolved,noCompany} + sessionScopes keys"
  - "Production deployed with add_order_attribution applied, dev-shop backfill cursor cleared, 4-condition readiness gate PASSED"
affects: [phase-03-metafield-publishing, phase-04-checkout-enforcement]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Belt over count coincidence: whenever ANY row is UNRESOLVED every company is re-paged, so the exhaustion flip is licensed by a provably full enumeration"
    - "Exhaustion verdict is a status, not a tombstone: NO_COMPANY rows stay heal candidates and flip back the moment an authenticated edge claims them"
    - "Production WRITE scripts print before/after state and pin the blast radius to one [shop,key] row (T-02-30)"

key-files:
  created:
    - scripts/prod-clear-backfill.sh
    - scripts/prod-clear-backfill.mjs
  modified:
    - app/services/reconciliation.server.ts
    - tests/reconciliation.test.ts
    - tests/graphql-error-surfacing.test.ts
    - scripts/prod-ledger-state.mjs
    - README.md
    - .planning/WINDOWS.md

key-decisions:
  - "Attribution pass ordering: cursor scan → drift recompute → cursor advance → attribution pass + flip → probe. Drift detection stays byte-identical to 02-04 (compares only cursor-touched companies); the pass does its own recomputes with the injected clock, so a healed company is never double-reported as drift"
  - "attributed counter = rows that were not ATTRIBUTED at pass start and are afterwards — includes NO_COMPANY recoveries; a fresh mid-sweep ingest is not a heal and does not count"
  - "sessionScopes reads the OFFLINE session row's scope string only (isOnline: false, scope selected, token never selected) — the row the webhook/admin contexts actually authenticate with"
  - "The exhaustion flip runs unconditionally after the pass: when nothing is UNRESOLVED it matches zero rows, and any enumeration/re-page failure throws before it — full enumeration is guaranteed by control flow, not by a flag"

patterns-established:
  - "Tests seed UNRESOLVED rows through the real rung-3 ingest (ingestOrderEvent with no hint), never by hand-writing ledger internals — heal tests start from exactly the shape the webhook path leaves behind"

requirements-completed: []
requirements-progressed: [LEDG-01, LEDG-04, LEDG-05]

# Metrics
duration: 28min
completed: 2026-08-19

actuals:
  tokens: 16000
  tasks: 3
  commits: 4

status: complete
---

# Phase 02 Plan 08: Scope-Clean Reconciliation + Deployed Readiness Summary

**One-liner:** The daily reconciliation now runs entirely inside the CF-1 scope set — reduced cursor scan in preserve-mode, a company-side attribution pass that heals within one sweep, and an exhaustion flip that proves NO_COMPANY (and un-proves it the moment an edge claims the order) — deployed to Railway with the attribution migration applied, the dev shop's backfill cursor cleared, and a 4-condition readiness gate passed; the only remaining step is the user's single app-open.

## What was built

### Task 1 — Reconciliation inside CF-1 (TDD: RED `3c7ed24`, GREEN `32107bc`)

- **Reduced cursor scan:** `ORDERS_UPDATED_SINCE_QUERY` no longer selects `purchasingEntity` (the last trapped ledger document — WINDOWS #7). `totalReceivedSet`/`totalRefundedSet` kept: 02-06 did NOT drop them from `OrderForLedgerNode`, and codegen validates the document against the pinned 2026-07 schema. Nodes upsert via `upsertOrderFromSource(shop, node)` — **preserve-mode**: known rows keep attribution (a missed `orders/paid` corrects money without touching attribution, LEDG-04/D-01), new rows land UNRESOLVED.
- **Transport:** `queryWithRetry` rebuilt on `graphqlJson`/`LedgerGraphqlError`. THROTTLED (by `extensions.code` or message) earns exactly one retry; any other failure is Sentry-reported and rethrown immediately — a scope trap is never re-hit, a partial sweep is never silent. `legacyAttributionOf` + `LegacyPurchasingEntityCarrier` shims deleted; `getAdminContext` no longer imported (graphqlJson reaches the same mock seam).
- **Attribution pass** (after cursor advance, before the probe): `enumerateCompanies` every sweep; a company is re-paged via `ingestCompanyOrders` + `recomputeCompany(shop, gid, now)` when Shopify's `ordersCount` disagrees with the local count of rows attributed to it, **OR whenever any UNRESOLVED row exists** (the belt). Heal candidates include NO_COMPANY rows — the pass flips them back to ATTRIBUTED when an edge claims them (W-2).
- **Exhaustion flip:** one `updateMany` — `{shop, attributionStatus: "UNRESOLVED", refetchedAt: {lt: sweepStart}}` → NO_COMPANY. `sweepStart` captured once at `reconcileShop` entry; rows refetched during the sweep (in-flight webhooks, the cursor scan itself) are left UNRESOLVED for the next cycle. This function is the only writer of NO_COMPANY anywhere in the app (`upsertOrderFromSource` cannot express it by design).
- **7 new tests** (all staged RED first): one-sweep heal of a rung-3 UNRESOLVED ingest; overdue-true when a past-due order arrives via the pass at an injected clock (D-04); exhaustion flip after full enumeration; mid-sweep rows left UNRESOLVED; **NO_COMPANY→ATTRIBUTED recovery across two sweeps, sweep 2 driven purely by the ordersCount mismatch (W-2 — never sticky)**; no re-page when counts match and nothing is UNRESOLVED (locked by leaving the CompanyOrdersForLedger fixture unregistered — a re-page would throw); non-throttle LedgerGraphqlError propagates with no retry.
- **Source-guard hard-green:** the 02-08 `it.fails` marker flipped to `it` — zero `it.fails` remain in tests/graphql-error-surfacing.test.ts; the guard is green across ledger, backfill and reconciliation.
- **Existing 15 tests pass with fixture-shape edits only** (no behavioral assertion changed): `orderNode()` dropped its purchasingEntity mirror, `seedLocal` writes `attributionStatus: "ATTRIBUTED"` explicitly, beforeEach registers an empty CompaniesForLedger page, and the three tests whose fresh rows previously attributed off the wire union now attribute through company-edge fixtures.

### Task 2 — Prod tooling + one-tap runbook (`baf9443`)

- **prod-ledger-state.mjs (additive keys only):** top-level `attribution: {attributed, unresolved, noCompany}` from a groupBy over LedgerOrder, and `sessionScopes` — the offline Session row's scope string, access token never selected. The .sh wrapper is byte-unchanged.
- **prod-clear-backfill.{sh,mjs}:** clone of the prod-ledger-state railway-ssh pattern (base64-shipped into /app, DATABASE_URL never leaves Railway). Exactly one `deleteMany(` and its where clause carries both `shop: domain` and `key: "backfill"`; prints before/cleared/after so the write is auditable (T-02-30). `deleteMany` not `delete`, so an absent cursor clears as `{cleared: 0}` instead of throwing.
- **Hygiene gates (comment-filtered):** suppression greps 0 and secret-assignment greps 0 across all four touched scripts; `set -euo pipefail` in the .sh.
- **README § Empirical dev-store checks** rewritten for the company-driven flow: executor-verified list, THE ONE HUMAN STEP, verbatim post-tap jq check, D9 admin comparison, A2 Plus-tier note kept unchanged (02-05 addendum), and the note that WINDOWS defect 5 closes only after the post-tap check passes. The dead A7 (bulk filter) / A7b (JSONL `__parentId`) items went with the bulk machinery they described.

### Task 3 — Deploy, cursor clear, readiness gate (no repo file changes; evidence below)

1. `railway up --service credit-guard-app --ci` → image `sha256:8089b1c5…`, healthcheck `/healthz` passed, **Deploy complete**.
2. Release log (captured verbatim):
   ```
   4 migrations found in prisma/migrations
   Applying migration `20260819113153_add_order_attribution`
   The following migration(s) have been applied:
     └─ 20260819113153_add_order_attribution/
   All migrations have been successfully applied.
   ```
3. **BEFORE state** (prod-ledger-state): stale bulk-era backfill (`status: completed`, `operationGid: gid://shopify/BulkOperation/7418832388329`, `companyCount: 0`), 5 LedgerOrders **all UNRESOLVED** (`attribution: {attributed: 0, unresolved: 5, noCompany: 0}`), 4 companies (Acme Supply, Northwind Trading, Powderbound, Snowdevil) all at `0.0000`, `sessionScopes: "read_all_orders,read_companies,read_orders,read_payment_terms"`. Rows will re-attribute in place on the same `[shop, orderGid]` upsert key — no row surgery needed.
4. `prod-clear-backfill.sh credit-guard-demo.myshopify.com` → `{cleared: 1, after: {status: "absent"}}`, reconciliation cursor and all other keys untouched.

**Readiness gate — all four conditions HOLD:**

| # | Condition | Evidence | Result |
|---|-----------|----------|--------|
| 1 | Backfill status absent after clear | `jq -e '(.backfill.status // "absent") == "absent"'` → true | PASS |
| 2 | sessionScopes = exactly the four CF-1 scopes, no customers scope | `read_all_orders,read_companies,read_orders,read_payment_terms`; `contains("read_customers")` false | PASS |
| 3 | smoke-deployed exit 0 | healthz 200 over valid TLS + forged-HMAC 401 on all six webhook endpoints (`/webhooks/compliance`, `app/uninstalled`, `orders`, `payment-terms`, `companies`, `bulk-operations`) — run twice (post-deploy and post-clear), exit 0 both | PASS |
| 4 | Migration applied in the release log | `Applying migration \`20260819113153_add_order_attribution\` … All migrations have been successfully applied.` | PASS |

Executor STOPPED here per the plan's explicit directive — no app-open, no polling, no checkpoint.

## Verification

| Gate | Result |
|------|--------|
| Full suite | **13 files, 235 passed, 0 expected-fail** — baseline 227+1; +7 new attribution tests, +1 flipped debt marker |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |
| `npm run graphql-codegen` | exit 0 (reduced OrdersUpdatedSince validates against pinned 2026-07) |
| `it.fails` in tests/graphql-error-surfacing.test.ts | **0** — source-guard hard-green across all three services |
| `grep -c 'api_version = "2026-07"' shopify.app.toml` | 1; `git status --porcelain shopify.app.toml` empty — TOML byte-untouched, no shopify CLI run |
| Script hygiene (all 4 scripts, comment-filtered) | suppression 0, secret-assignment 0 |
| `grep -c 'deleteMany(' prod-clear-backfill.mjs` | 1, where clause carries shop AND `key: "backfill"` |
| Deployed smoke | exit 0, six 401s + healthz 200 on app.creditguardhq.com |

## Deviations from Plan

**1. [Minor] Post-tap jq command corrected from the plan's illustrative form.** The plan's snippet `jq '{backfill: .backfill.status, attribution, companies}'` would select a nonexistent top-level `companies` key (companies live under `.ledger.companies`, a frozen structure the plan itself forbids reshaping). README documents the verbatim-runnable form: `jq '{backfill: .backfill.status, attribution, companies: .ledger.companies}'`.

**2. [Minor] `sessionScopes` scoped to the offline session row** (`isOnline: false`) rather than any session — the offline token is what webhooks/admin contexts authenticate with, and a stray online row's scope string could mask a drifted offline grant. Live value confirmed identical to the CF-1 set.

**3. [Minor] Task 3 shipped no README edit.** The plan listed README.md under Task 3's files, but the complete runbook (readiness list, one tap, post-tap commands) already landed in Task 2's rewrite; duplicating it would have created two divergeable copies. Task 3's output is the deploy/gate evidence recorded here.

**4. [Tooling] WINDOWS #7 marked fixed by hand-edit** (table + JSON + counts: open 5→4, fixed 1→2), following 02-07's precedent — `gsd-tools windows fixed` still rejects the file over entry 2's pre-existing `"resolved"` status (out of scope, left untouched, flagged again for whoever next runs the windows tooling).

## Known Stubs / Tracked Debt

None introduced. Both 02-06 transitional shims are now gone (backfill's in 02-07, reconciliation's here). WINDOWS #7 fixed; WINDOWS #5 stays **open** pending the post-tap empirical check (see final section).

## Coverage

- id: D1
  description: "The daily reconciliation runs entirely within the CF-1 scope set: no reconciliation document selects a trapped field; transport throws loudly on errors[]"
  requirement: LEDG-04
  verification:
    - kind: integration
      ref: "tests/graphql-error-surfacing.test.ts#02-08 flip (hard-green, zero it.fails)"
      status: pass
    - kind: integration
      ref: "tests/reconciliation.test.ts#propagates a non-throttle LedgerGraphqlError loudly"
      status: pass
  human_judgment: false
- id: D2
  description: "A missed order-attribution heals within one sweep: rung-3 UNRESOLVED ingest claimed on its company's edge, money folded into exposure"
  requirement: LEDG-04
  verification:
    - kind: integration
      ref: "tests/reconciliation.test.ts#claims a webhook-ingested UNRESOLVED order on its company's edge within one sweep"
      status: pass
  human_judgment: false
- id: D3
  description: "A company with an open past-due net-terms order shows nonzero exposure and overdue true at the sweep, proven with an injected clock (D-04/D-05, LEDG-05)"
  requirement: LEDG-05
  verification:
    - kind: integration
      ref: "tests/reconciliation.test.ts#reads overdue true when a past-due order arrives via the pass"
      status: pass
  human_judgment: false
- id: D4
  description: "UNRESOLVED converges to NO_COMPANY only after full enumeration with refetchedAt < sweep start; only reconciliation writes it; NO_COMPANY is never sticky (W-2)"
  requirement: LEDG-04
  verification:
    - kind: integration
      ref: "tests/reconciliation.test.ts#flips an UNRESOLVED row no company claims to NO_COMPANY / #leaves a row refetched during the sweep UNRESOLVED / #recovers a NO_COMPANY row (W-2)"
      status: pass
  human_judgment: false
- id: D5
  description: "Production ready for the single human tap: migration applied, cursor cleared, four CF-1 scopes held, six surfaces 401 forged HMACs — 4-condition readiness gate"
  requirement: LEDG-01
  verification:
    - kind: gate
      ref: "readiness gate table above — all four PASS, outputs captured"
      status: pass
  human_judgment: false
- id: D6
  description: "After the user's app-open, backfilled per-company balances match the admin-shown outstanding amounts (D9, phase success criterion 1) — Acme Supply and Northwind Trading nonzero with overdue true, zero UNRESOLVED"
  requirement: LEDG-01
  verification:
    - kind: manual
      ref: "README § Empirical dev-store checks — post-tap command; NOT run by this executor per plan directive"
      status: unknown
  human_judgment: true

## Threat Flags

None — no new surface beyond the plan's threat model. T-02-30 (cursor-clear scope creep) mitigated as specified: single deleteMany pinned to `[shop, "backfill"]`, required shop argument, before/after printed. T-02-31 (repudiation) mitigated by the evidence tables above.

## For the orchestrator / user — THE ONE REMAINING STEP

**THE ONE HUMAN STEP:** open the Credit Guard app once in the dev-store admin (phone is fine) — `credit-guard-demo.myshopify.com` admin → Apps → Credit Guard. The embedded loader re-triggers the company-driven backfill within seconds; nothing else to click.

**Post-tap verification (any machine, later):**

```shell
bash scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com \
  | jq '{backfill: .backfill.status, attribution, companies: .ledger.companies}'
```

Expected: `backfill` = `"completed"`; `attribution.unresolved` = `0`; **Acme Supply** and **Northwind Trading** at nonzero exposure with `overdue: true` (each holds an open net-terms order past due since 2026-08-17). Then compare every company's `.exposure` against the admin-shown outstanding balance (Customers → Companies → the company → orders with payment terms) — equal to the cent (D9, success criterion 1). Also worth capturing while there: a real orders/create payload's company attribute name (02-06 deviation 4).

**WINDOWS.md defect 5 stays OPEN until the post-tap check passes** — the orchestrator/user closes it, not this executor.

## Self-Check: PASSED

- scripts/prod-clear-backfill.sh — FOUND
- scripts/prod-clear-backfill.mjs — FOUND
- app/services/reconciliation.server.ts — no purchasingEntity selection, no legacyAttributionOf — VERIFIED
- Commits 3c7ed24, 32107bc, baf9443 — FOUND in git log
- Full suite 235 passed / 0 expected-fail; typecheck/lint/build/codegen exit 0 — VERIFIED
- shopify.app.toml: api_version "2026-07" ×1, worktree clean, untouched by all plan commits — VERIFIED
- Readiness gate: 4/4 PASS with captured outputs — VERIFIED

## POST-TAP VERIFICATION — 2026-08-19 (orchestrator-run)

App-open at 13:32 triggered the company-driven backfill: **completed in ~1s, 8 orders / 7 schedules / 4 companies, attribution 8-0-0** (attributed/unresolved/noCompany). Acme Supply exposure **3229.9500, overdue: true** (earliest due 2026-08-17 — the past-due flip working end-to-end on live data); Northwind Trading **1874.9500**, due 2026-09-18. Powderbound/Snowdevil correctly 0. Live `POST /webhooks/orders` deliveries (3× 200) processed concurrently and converged with the backfill — webhook delivery is NOT blocked pre-PCD-approval as earlier feared. WINDOWS #5 CLOSED. D9 (numbers match admin) awaits the user's eyeball check; new defect #8 recorded (access log prints id_token query params to Railway logs).

## D9 CLOSED — backfill-vs-admin reconciled to the cent (2026-08-19, user-verified)

Northwind Trading: ledger 1874.95 == admin 1,874.95 (exact).
Acme Supply: ledger 3229.95 vs admin Companies-list 4,179.90 — reconciled exactly:
admin figure is LIFETIME order total; exposure is OUTSTANDING. Acme #1001 (NET, PAID,
$0 outstanding) and #1003 (no terms, REFUNDED) are correctly excluded; #1002 (2629.95)
+ #1007 (600.00) = 3229.95. Divergence = 949.95 = the paid+refunded orders — i.e. the
two metrics SHOULD differ and do, by precisely the settled amounts.

Incidentally verified on live data: full-payment transition (PAID net-terms order →
zero exposure) and refund exclusion — two checks previously listed as "verifiable on
Basic". With the overdue flip (Acme, due 2026-08-17 → overdue:true), the full order
lifecycle is now live-proven. D9: PASS. Remaining unknown for Phase 2: only the
Plus-tier partial-payment path (WINDOWS #4, pre-launch task).
