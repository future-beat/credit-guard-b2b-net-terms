---
phase: 02-ar-ledger-credit-engine
plan: 06
subsystem: ledger
tags: [attribution, company-orders-edge, graphql-errors, access-denied, resolution-ladder, prisma-migration, source-guard]

# Dependency graph
requires:
  - phase: 02-ar-ledger-credit-engine
    plan: 01
    provides: "ledger.server.ts (upsertOrderFromSource/recomputeCompany), webhooks.orders.tsx, admin-client seam, order fixtures"
  - phase: 02-ar-ledger-credit-engine
    plan: 02
    provides: "payment-terms/companies routes + b2b-events suite the rung-1 preserve-mode rework runs through"
  - phase: 02-ar-ledger-credit-engine
    plan: 05
    provides: "§ CRITICAL FINDING — the live purchasingEntity/read_customers evidence and the verified company(id){orders} query shape"
provides:
  - "LedgerOrder.attributionStatus (ATTRIBUTED/UNRESOLVED/NO_COMPANY) + [shop, attributionStatus] index — migration 20260819113153_add_order_attribution applied to creditguard_dev AND creditguard_test"
  - "graphqlJson() single GraphQL transport + LedgerGraphqlError — any errors[] on a ledger call throws, naming label/shop/extensions.code/requiredAccess"
  - "Reduced OrderForLedger (no purchasingEntity) + CompanyOrdersForLedger + forEachCompanyOrder pager (first:250, find-and-stop, MAX_ATTRIBUTION_PAGES=40)"
  - "upsertOrderFromSource(shop, order, attribution?: OrderAttribution) with preserve-mode; NO_COMPANY unwritable through it"
  - "ingestOrderEvent resolution ladder (known-row → hinted company-edge scan → UNRESOLVED) wired into webhooks.orders.tsx via payloadCompanyHint"
  - "ACCESS_DENIED regression + document source-guard (tests/graphql-error-surfacing.test.ts) with it.fails debt markers for 02-07/02-08"
affects: [02-07-backfill-rework, 02-08-reconciliation-and-deployed-proof, phase-03-metafield-publishing, phase-04-checkout-enforcement]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Resolution ladder: known-row check first (hot path), payload hint only narrows the scan target, attribution evidence is always Shopify's authenticated company→orders edge"
    - "Single error-surfacing GraphQL transport: graphqlJson throws LedgerGraphqlError on any errors[] — a permission failure can never read as absent data"
    - "it.fails debt markers: source-guard entries that flip green mechanically when the pending plan removes the trapped selection"

key-files:
  created:
    - prisma/migrations/20260819113153_add_order_attribution/migration.sql
    - tests/graphql-error-surfacing.test.ts
  modified:
    - prisma/schema.prisma
    - app/services/ledger.server.ts
    - app/services/admin-client.server.ts
    - app/services/backfill.server.ts
    - app/services/reconciliation.server.ts
    - app/routes/webhooks.orders.tsx
    - tests/fixtures/order-fixtures.ts
    - tests/webhooks.orders.test.ts
    - tests/webhooks.chaos.test.ts
    - tests/webhooks.b2b-events.test.ts
    - tests/credit-engine.test.ts
    - tests/reconciliation.test.ts
    - .planning/WINDOWS.md

key-decisions:
  - "graphqlJson + LedgerGraphqlError live in ledger.server.ts, NOT admin-client.server.ts: suites vi.mock admin-client wholesale with a factory exporting only getAdminContext, so any wrapper defined inside that module would be erased by the mock (or close over the real getAdminContext under an importOriginal spread). Placing the wrapper one module up keeps the plan's hard constraint — the vi.mock seam byte-unchanged — while preserving the single-transport contract; admin-client.server.ts documents the contract"
  - "Rung-2 miss degrades to UNRESOLVED with a Sentry warning naming the hint — never a throw: later doorbells (orders/updated, orders/paid) and the daily sweep heal a consistency race; a throw would be a 48h retry storm"
  - "backfill/reconciliation keep pre-02-06 runtime behavior via a local legacyAttributionOf(purchasingEntity) derivation passed explicitly to the new upsert signature — byte-identical behavior until 02-07/02-08 rework them properly"
  - "Payload company attribute read as company:{id, location_id} per the documented B2B order-webhook shape; the ladder tolerates its absence, so a doc discrepancy degrades to the hint-less rung instead of breaking"

patterns-established:
  - "Attribution evidence vs. hint separation (T-02-26): a signed-payload identifier may select what to scan but can never mint an attribution"
  - "Mutation-test in place of impossible RED: mutate the already-implemented rung, record kill counts, restore byte-identically (cmp)"

requirements-completed: []
requirements-progressed: [LEDG-02, LEDG-03]

# Metrics
duration: 39min
completed: 2026-08-19

actuals:
  tokens: 21400
  tasks: 3
  commits: 6

status: complete
---

# Phase 02 Plan 06: Attribution Core — Company-Side Order Attribution Summary

**One-liner:** Order→company attribution now runs over the authenticated `company(id){orders}` edge under the CF-1 scopes (replacing the read_customers-trapped `purchasingEntity`), with an explicit ATTRIBUTED/UNRESOLVED state machine, a resolution ladder in the orders webhook, and a GraphQL transport that throws loudly on any `errors[]`.

## What was built

### Task 1 — Tracer: hinted orders/create → company-edge scan → ATTRIBUTED → nonzero exposure
- **Schema [BLOCKING — verified]:** `LedgerOrder.attributionStatus String @default("UNRESOLVED")` + `@@index([shop, attributionStatus])`. Migration `20260819113153_add_order_attribution` applied to **creditguard_dev** (`migrate dev`) and **creditguard_test** (`migrate deploy`); `prisma migrate status` reports "Database schema is up to date!" on **both**. Existing rows default to UNRESOLVED — correct, since everything ingested under the broken path has unknown attribution.
- **Error seam:** `graphqlJson<T>(shop, document, { variables, label })` + `class LedgerGraphqlError extends Error { errors }`. Throws on any non-empty `errors[]`; message carries label, shop, and each error's `extensions.code` / `extensions.requiredAccess`. It is the only function in ledger.server.ts that touches `getAdminContext(...).graphql`.
- **Reduced OrderForLedger:** the `purchasingEntity` union selection and its node-type field are gone; every remaining field was proven live in the 02-05 empirical run. `npm run graphql-codegen` validates both documents against the pinned 2026-07 schema.
- **CompanyOrdersForLedger + pager:** the 02-05-verified company-side shape (`pageInfo`, full order field parity with the reduced OrderForLedger); `forEachCompanyOrder` pages at `first:250`, stops early on callback `true`, throws past `MAX_ATTRIBUTION_PAGES = 40`, and reports `companyName: null` for a gid Shopify knows no company for.
- **`OrderAttribution` param:** `{kind:"company"}` upserts the company head in-transaction and writes ATTRIBUTED + location gid; `{kind:"unresolved"}` writes null/UNRESOLVED/null; **omitted = preserve-mode** (update leaves all three attribution columns untouched; create starts UNRESOLVED). NO_COMPANY is structurally unwritable here — only 02-08's reconciliation exhaustion pass may set it.
- **Route:** `webhooks.orders.tsx` non-delete branch now calls `ingestOrderEvent(shop, orderGid, payloadCompanyHint(body))`; the hint reader takes `payload.company = { id, location_id }` and returns null when absent/malformed.

### Task 2 — Full resolution ladder + suite rework
Every rung test-locked in `tests/webhooks.orders.test.ts` (Sentry stubbed for assertability):
- **Rung 1 (known row):** refetch preserves attribution — orders/paid moves exposure 500→200 while `attributionStatus`/`companyId`/`companyLocationGid` are untouched (D-01).
- **Rung 2 (found):** the tracer path; company head name from the response, never the payload.
- **Rung 2-miss:** page without the gid AND `company: null` both degrade to the UNRESOLVED ingest with a Sentry warning naming hint + order gid; delivery still acks 200 (pre-decided: no retry storm over an eventual-consistency race). No company row is ever minted from a hint (T-02-26).
- **Rung 3:** hint-less net-terms order persists UNRESOLVED with **zero exposure contribution proven against a live 500.0000 balance**, and warns (Sentry + console); card-paid order persists silently; clean null creates nothing.
- **Chaos suite:** payloads carry the hint, every step registers a CompanyOrdersForLedger page consistent with its OrderForLedger source. All convergence assertions **numerically identical** to pre-rework; snapshots additionally pin `attributionStatus` + `companyLocationGid`. Duplicate/replay/out-of-order/coalesced/storm all green.
- **b2b-events:** `seedOrder` attributes through the real route via the hint; new test locks the unknown-order payment-terms path (UNRESOLVED row, null company, zero contribution, awaiting reconciliation). `webhooks.payment-terms.tsx` / `webhooks.companies.tsx` **not modified**. TOML registration guards untouched.

### Task 3 — ACCESS_DENIED regression + document source-guard
`tests/graphql-error-surfacing.test.ts`:
- Replays the **exact live failure shape** (HTTP-200 body, `data.order` present with the field nulled, `errors[]` with `ACCESS_DENIED` / `requiredAccess: "read_customers access scope"`): `refetchOrderAndRecompute` throws `LedgerGraphqlError`, writes/updates/deletes **nothing**, and an existing attributed row survives byte-for-byte (same `refetchedAt`, exposure still 500.0000).
- Same shape through `forEachCompanyOrder` throws with the callback never invoked and zero rows.
- Message greppability locked: label, shop, `ACCESS_DENIED`, `read_customers access scope`.
- Source-guard (`/purchasingEntity|\bcustomer\s*[({]/` over raw document text): hard-green for `ORDER_FOR_LEDGER_QUERY`, `COMPANY_ORDERS_FOR_LEDGER_QUERY`, `COMPANIES_FOR_LEDGER_QUERY`, `BULK_OPERATION_STATUS_QUERY`, `OPEN_ORDER_IDS_PROBE_QUERY`; **`it.fails` debt markers** for `BACKFILL_ORDERS_DOCUMENT` (02-07 flips) and `ORDERS_UPDATED_SINCE_QUERY` (02-08 flips). Backfill's module-private documents exported as strings only.
- credit-engine D-03 guard reframed: stripped code must NOT contain `purchasingEntity`, must contain `CompanyOrdersForLedger`; buyer-contact prohibition kept.

## Verification

| Gate | Result |
|------|--------|
| Migration status (dev AND test DBs) | "Database schema is up to date!" on both — 4 migrations |
| Full suite | **13 files, 225 passed + 2 expected-fail debt markers (227)** — baseline 210, nothing lost |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run graphql-codegen` | exit 0 (CompanyOrdersForLedger + reduced OrderForLedger validate against 2026-07) |
| `grep -c 'api_version = "2026-07"' shopify.app.toml` | 1; TOML absent from every plan commit and clean in the worktree |
| read_customers | never added anywhere (guarded by the existing TOML scope test + new document guard) |

## Mutation-test evidence (RED impossible for tracer-implemented rungs)

| Mutant | Change | Killed by | Restored |
|--------|--------|-----------|----------|
| 1 | preserve-mode refetch re-ingests as `{kind:"unresolved"}` (rung 1 loses preservation) | **8 tests** across orders/chaos/b2b (incl. all 6 chaos convergence tests) | cmp byte-identical |
| 2 | rung-2 miss believes the hint (false attribution minted) | **2 tests** (both rung-2-miss locks) | cmp byte-identical |
| 3 | graphqlJson swallows `errors[]` (the original defect, reverted) | **4 tests** (entire ACCESS_DENIED regression block) | cmp byte-identical |

## Deviations from Plan

**1. [Rule 3 - Blocking] `graphqlJson`/`LedgerGraphqlError` placed in ledger.server.ts instead of admin-client.server.ts.**
The plan required both (a) the artifacts in admin-client.server.ts and (b) the vi.mock seam unchanged ("tests keep mocking admin-client.server.ts exactly as before"). These are mutually exclusive: every suite mocks that module with a whole-module factory `() => ({ getAdminContext })`, which erases any other export; and a factory spreading `importOriginal` would return a `graphqlJson` whose closure still calls the REAL `getAdminContext`. The seam constraint was judged primary (it is what keeps real HMAC verification in the loop across five suites). The wrapper therefore lives in ledger.server.ts and reaches the mock through the same import every previous call site used; admin-client.server.ts gained the transport-contract documentation. Key link "every Admin GraphQL call goes through graphqlJson" holds as specified.

**2. [Rule 3 - Blocking] `tests/reconciliation.test.ts` orderNode patched (file not in plan's files_modified).**
The plan assumed backfill/reconciliation "fixtures are self-contained"; reconciliation's are not — its `orderNode()` builds on the shared `makeOrderForLedger`, which the plan strips of `purchasingEntity`. The local helper now re-adds the legacy union itself (mirroring the wire shape its still-trapped document selects), keeping the suite green with zero behavioral change. Runtime parity is held by `legacyAttributionOf()` in backfill/reconciliation services: attribution derived from the node's purchasingEntity exactly as the old `companyGidOf` did, passed explicitly to the new signature — behavior byte-identical until 02-07/02-08.

**3. [Minor] credit-engine attribution-block call-site rework pulled from Task 3 into Task 1's feat commit.** Task 1's typecheck gate covers all test files; the removed fixture override keys would not compile. The guard's framing extension stayed in Task 3 as planned.

**4. [Environment] Shopify AI Toolkit unavailable in this host** (not installed as a skill; AGENTS.md forbids adding tooling to the repo, and installing host tooling mid-execution was out of scope). The `company: { id, location_id }` attribute name follows the documented REST-shaped B2B order-webhook payload; per the plan's own contingency the ladder tolerates absence/mismatch either way — a wrong attribute name degrades to the hint-less rung and reconciliation attributes within 24h. **02-08's live re-run should observe a real orders/create payload and confirm the attribute name.**

## Known Stubs / Tracked Debt

| Item | File | Resolution |
|------|------|------------|
| `it.fails`: BACKFILL_ORDERS_DOCUMENT still selects purchasingEntity | tests/graphql-error-surfacing.test.ts | 02-07 removes the selection; flip `it.fails`→`it` (WINDOWS #6) |
| `it.fails`: ORDERS_UPDATED_SINCE_QUERY still selects purchasingEntity | tests/graphql-error-surfacing.test.ts | 02-08 removes the selection; flip `it.fails`→`it` (WINDOWS #7) |
| `legacyAttributionOf` transitional shims | app/services/backfill.server.ts, app/services/reconciliation.server.ts | Deleted by 02-07/02-08 when those services move to company-side attribution + graphqlJson |

Neither stub blocks this plan's goal (webhook-path attribution); both are labeled TRANSITIONAL in-code with the owning plan named, and registered in `.planning/WINDOWS.md` (entries 6, 7).

## Coverage

- id: D1
  description: "ACCESS_DENIED on a ledger-load-bearing query throws LedgerGraphqlError carrying errors[], never reads as null — regression uses the exact live 200+nulled-data+errors[] shape and asserts zero writes plus existing-row survival"
  requirement: LEDG-02
  verification:
    - kind: integration
      ref: "tests/graphql-error-surfacing.test.ts#ACCESS_DENIED regression"
      status: pass
    - kind: mutation
      ref: "mutant 3 (swallow errors[]) killed by 4 tests"
      status: pass
  human_judgment: false
- id: D2
  description: "No app/ ledger GraphQL document selects purchasingEntity or a customer field; ledger.server.ts documents hard-guarded, pending services tracked as it.fails"
  requirement: LEDG-02
  verification:
    - kind: integration
      ref: "tests/graphql-error-surfacing.test.ts#document source-guard"
      status: pass
    - kind: integration
      ref: "tests/credit-engine.test.ts#keys identity off the company edge, never the buyer contact — source guard"
      status: pass
  human_judgment: false
- id: D3
  description: "Signed orders/create naming a company lands an ATTRIBUTED LedgerOrder keyed to that company with nonzero recomputed exposure (D-01/D-03 via the company edge)"
  requirement: LEDG-03
  verification:
    - kind: integration
      ref: "tests/webhooks.orders.test.ts#company-hinted attribution (02-06 tracer)"
      status: pass
  human_judgment: false
- id: D4
  description: "An unattributable order persists as explicit UNRESOLVED — distinct from NO_COMPANY — contributing zero exposure until attributed"
  requirement: LEDG-03
  verification:
    - kind: integration
      ref: "tests/webhooks.orders.test.ts#rung 3 UNRESOLVED zero-contribution (against a live 500.0000 balance)"
      status: pass
    - kind: integration
      ref: "tests/webhooks.b2b-events.test.ts#persists an UNKNOWN order from a payment-terms doorbell as UNRESOLVED"
      status: pass
  human_judgment: false
- id: D5
  description: "Full suite green with recompute-from-source, dedupe, claim-release and redaction semantics unchanged; chaos convergence numerically identical"
  requirement: LEDG-02
  verification:
    - kind: integration
      ref: "npm test -- --run → 225 passed + 2 expected fail (227), 13 files"
      status: pass
    - kind: mutation
      ref: "mutant 1 (preservation lost) killed by 8 tests incl. all chaos convergence"
      status: pass
  human_judgment: false

## Handoff notes for 02-07 (backfill) and 02-08 (reconciliation)

- **02-07:** replace `BACKFILL_ORDERS_DOCUMENT`'s global order sweep with per-company enumeration over `forEachCompanyOrder`/`CompanyOrdersForLedger` (both exported and codegen-validated). Delete backfill's `legacyAttributionOf` + `LegacyPurchasingEntityCarrier`, pass real `{kind:"company"}` attributions, migrate transport to `graphqlJson`, and flip the `it.fails` guard (WINDOWS #6). `upsertCompany`/`syncCompanies` unchanged and compatible.
- **02-08:** same for `ORDERS_UPDATED_SINCE_QUERY` (WINDOWS #7); the NO_COMPANY exhaustion pass must be an `updateMany` gated on `attributionStatus: "UNRESOLVED"` — `upsertOrderFromSource` cannot write NO_COMPANY by design. The `[shop, attributionStatus]` index exists for exactly that scan. Pre-decided contingency stands: if the live run surfaces ACCESS_DENIED on `paymentSchedules.balanceDue` (now loudly thrown), drop `balanceDue` from BOTH order selections and let the schedule money columns go null (never summed, D-01/D-07).
- **Deployed proof (02-08):** dev store has Acme Supply + Northwind Trading, 4 net-terms orders each (2 past-due), all currently `companyId: null` in production — after 02-07/02-08 deploy + backfill they must read ATTRIBUTED with nonzero exposure. Also confirm the live orders/create payload's company attribute name (deviation 4).

## Self-Check: PASSED

- prisma/migrations/20260819113153_add_order_attribution/migration.sql — FOUND
- tests/graphql-error-surfacing.test.ts — FOUND
- migrate status clean on creditguard_dev and creditguard_test — VERIFIED
- Commits 901f006, 15edcc6, d2f5f73, dfb66c1, 4b16be3, ad64601 — FOUND in git log
- Full suite 225 passed + 2 expected fail; typecheck/lint/codegen exit 0 — VERIFIED
- shopify.app.toml untouched by plan commits; api_version "2026-07" ×1 — VERIFIED
