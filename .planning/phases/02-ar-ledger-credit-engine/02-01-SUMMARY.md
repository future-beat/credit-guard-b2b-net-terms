---
phase: 02-ar-ledger-credit-engine
plan: 01
subsystem: database
tags: [prisma, postgres, shopify-webhooks, admin-graphql, decimal, vitest, b2b, net-terms]

# Dependency graph
requires:
  - phase: 01-foundation-compliance
    provides: "authenticate.webhook 401 pattern, shop-lifecycle service style, signed-webhook test helper, creditguard_test isolation, Prisma session storage"
provides:
  - "Six Prisma ledger models (Company, LedgerOrder, LedgerSchedule, WebhookReceipt, SyncCursor, SweepLease) + add_ledger_models migration on dev and test"
  - "app/services/ledger.server.ts — pure computeCompanyState core plus recordWebhookReceipt, upsertCompany, deleteCompany, upsertOrderFromSource, removeOrder, recomputeCompany, refetchOrderAndRecompute, markWebhookProcessed"
  - "app/services/admin-client.server.ts — getAdminContext(shop), the single background Admin GraphQL seam tests mock"
  - "app/routes/webhooks.orders.tsx — topic-agnostic ingest for orders/* + refunds/create"
  - "tests/helpers/admin-client-mock.ts — fake Admin client keyed by GraphQL operation name (Wave 2 contract)"
  - "tests/fixtures/order-fixtures.ts — makeOrderForLedger / makeOrderForLedgerResponse / makeOrderState builders (Wave 2 contract)"
  - "redactShop extended to every shop-keyed ledger table"
affects: [02-02 chaos and B2B event webhooks, 02-03 install backfill, 02-04 scheduler and reconciliation, 02-05 TOML scopes and deploy, phase-03 metafield publishing, phase-04 checkout enforcement]

actuals:
  tokens: 20200
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Recompute-from-source: recomputeCompany is the only writer of Company.exposure/overdue/earliestDueAt"
    - "Payload-as-doorbell: webhook bodies yield identifiers only; every amount comes from an authenticated OrderForLedger refetch"
    - "Pure compute core with injected I/O: computeCompanyState(orders, now) takes plain data and an explicit clock"
    - "Single mockable Admin seam (getAdminContext) so authenticate.webhook stays real in tests"
    - "Fixture/mock infrastructure keyed by GraphQL operation name, shared across parallel plans"

key-files:
  created:
    - app/services/ledger.server.ts
    - app/services/admin-client.server.ts
    - app/routes/webhooks.orders.tsx
    - tests/helpers/admin-client-mock.ts
    - tests/fixtures/order-fixtures.ts
    - tests/credit-engine.test.ts
    - tests/webhooks.orders.test.ts
    - prisma/migrations/20260819031730_add_ledger_models/migration.sql
  modified:
    - prisma/schema.prisma
    - app/services/shop-lifecycle.server.ts
    - tests/shop-lifecycle.test.ts
    - .gitignore

key-decisions:
  - "A9 RESOLVED: unauthenticated.admin(shop) returns { session, admin } in the installed 1.1.0 — verified against node_modules types, not assumed"
  - "A11 RESOLVED: webhookId comes straight off authenticate.webhook's return in 1.1.0; the X-Shopify-Webhook-Id header fallback was not needed"
  - "PurchasingCompany's location field is `location`, not `companyLocation` — research had it wrong and codegen caught it"
  - "The purchasingEntity union selects only __typename outside the PurchasingCompany branch, so no buyer identity is ever fetched (PCD Level 1 minimisation + makes the D-03 guard airtight)"
  - "A GraphQL errors array on refetch throws instead of being read as 'order deleted' — a permissions blip must never silently delete a live ledger row"
  - "refetchOrderAndRecompute recomputes both the previous and the current company so re-attribution cannot strand a stale balance"
  - "An over-refunded order's negative outstanding nets against the company's other debt rather than being clamped to zero — clamping would overstate exposure, the direction that falsely blocks a paying buyer"
  - "app/types/ (10MB of codegen output) is gitignored: the gate is running codegen, not storing its output"

patterns-established:
  - "Redaction contract: every new shop-keyed model needs a deleteMany line in redactShop AND a counter in the test's countsFor — written into the service header"
  - "Mutation testing as evidence when a TDD RED is not honestly available"
  - "Bystander-shop assertions on every destructive ledger test"

requirements-completed: [LEDG-02, LEDG-03]

coverage:
  - id: D1
    description: "Signed orders webhook drives a GraphQL refetch and persists Company.exposure equal to the refetched totalOutstandingSet.shopMoney"
    requirement: LEDG-02
    verification:
      - kind: integration
        ref: "tests/webhooks.orders.test.ts#refetches the order and persists the refetched exposure"
        status: pass
    human_judgment: false
  - id: D2
    description: "Forged-HMAC POST to /webhooks/orders returns 401 and writes zero rows"
    requirement: LEDG-02
    verification:
      - kind: integration
        ref: "tests/webhooks.orders.test.ts#answers 401 and writes nothing to any ledger table"
        status: pass
      - kind: integration
        ref: "tests/webhooks.orders.test.ts#cannot corrupt an existing company's exposure"
        status: pass
    human_judgment: false
  - id: D3
    description: "Duplicate webhook id is processed exactly once and still acked 200"
    requirement: LEDG-02
    verification:
      - kind: integration
        ref: "tests/webhooks.orders.test.ts#processes the same webhook id exactly once and still acks 200"
        status: pass
    human_judgment: false
  - id: D4
    description: "Exposure matrix — partial payment, refund, edit-down, cancellation, card-paid, settled schedules, multi-order sum (D-01/D-02/D-07)"
    requirement: LEDG-03
    verification:
      - kind: unit
        ref: "tests/credit-engine.test.ts (28 tests, describes 'exposure — what counts' / 'what does NOT count')"
        status: pass
    human_judgment: false
  - id: D5
    description: "Probe edges — empty input, exact-due-instant adjacency (D-04 strict past), order independence, decimal exactness"
    requirement: LEDG-03
    verification:
      - kind: unit
        ref: "tests/credit-engine.test.ts#probe edges + #overdue and earliestDueAt (D-04 strict-past)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Attribution keys to purchasingEntity only; non-company orders persist with null linkage (D-03, Pitfall 7)"
    requirement: LEDG-03
    verification:
      - kind: unit
        ref: "tests/credit-engine.test.ts#never reads the order's buyer-contact field for identity — source guard"
        status: pass
      - kind: integration
        ref: "tests/credit-engine.test.ts#persists a non-company order with no company linkage (Pitfall 7)"
        status: pass
    human_judgment: false
  - id: D7
    description: "shop/redact deletes every new ledger table's rows for that shop and only that shop"
    verification:
      - kind: integration
        ref: "tests/shop-lifecycle.test.ts#deletes every shop-keyed ledger table's rows (Phase 2 models)"
        status: pass
      - kind: integration
        ref: "tests/shop-lifecycle.test.ts#leaves a bystander shop's ledger completely intact"
        status: pass
    human_judgment: false
  - id: D8
    description: "Exposure numbers match what the merchant sees in Shopify admin for real B2B orders (A2/A7 empirical check)"
    verification: []
    human_judgment: true
    rationale: "totalOutstandingSet behaviour through a partial-payment-then-refund sequence can only be confirmed against a live dev store with real B2B net-terms orders; the plan defers this to 02-05 T3, and no local fixture can prove it."

duration: 13min
completed: 2026-08-19
status: complete
---

# Phase 02 Plan 01: Ledger Spine Summary

**Six Prisma ledger models plus a recompute-from-source credit engine, proven end to end by a signed order webhook driving a mocked Admin refetch into a real `Company.exposure` row of 500.0000.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-08-19T03:18:00Z
- **Completed:** 2026-08-19T03:31:42Z
- **Tasks:** 3
- **Files modified:** 12 (8 created, 4 modified)

## Accomplishments

- **The tracer path runs green:** signed webhook → real HMAC verification → dedupe insert → ack → `OrderForLedger` refetch → order/schedule upsert → `recomputeCompany` → persisted exposure, with only the Admin client faked.
- **`computeCompanyState` implements D-01/D-02/D-04/D-07 exactly**, locked by 28 pure tests including the exact-due-instant adjacency boundary and permutation invariance. Mutation testing confirms the matrix bites.
- **Codegen caught a research error before it could ship:** `PurchasingCompany.companyLocation` does not exist in the 2026-07 schema; the field is `location`. This is precisely the first-correctness-gate role the plan assigned to `npm run graphql-codegen`.
- **Two research assumptions resolved against installed types rather than guessed** (A9 background Admin client, A11 `webhookId` source).
- **GDPR completeness restored:** `redactShop` now clears all five new shop-keyed tables, with the global `SweepLease` explicitly excluded and asserted.
- Full suite: **74 tests green across 5 files**, typecheck and lint clean, `api_version` still `2026-07`.

## Task Commits

1. **Task 1: End-to-end tracer (schema + engine + refetch + route + shared test infra)** — `84f92e8` (feat)
2. **Task 2: computeCompanyState correctness matrix** — `9d4746c` (test)
3. **Task 3: Lifecycle integration — redaction, dedupe, delete/cancel** — `6ee05ba` (test, RED) → `d3b32b0` (feat, GREEN)

## Files Created/Modified

- `prisma/schema.prisma` — Company, LedgerOrder, LedgerSchedule, WebhookReceipt, SyncCursor, SweepLease; all money `Decimal(19,4)`
- `prisma/migrations/20260819031730_add_ledger_models/` — applied to `creditguard_dev` (migrate dev) and `creditguard_test` (migrate deploy)
- `app/services/ledger.server.ts` — the credit engine and its three invariant rules
- `app/services/admin-client.server.ts` — `getAdminContext(shop)`, the only background Admin client construction
- `app/routes/webhooks.orders.tsx` — topic-agnostic ingest; also exports `extractOrderGid` for reuse
- `app/services/shop-lifecycle.server.ts` — five `deleteMany` lines added to `redactShop`; header now carries a redaction contract and points the scheduler sentence at 02-04's `forEachActiveShop`
- `tests/helpers/admin-client-mock.ts`, `tests/fixtures/order-fixtures.ts` — the Wave 2 shared contract (below)
- `tests/credit-engine.test.ts` (28 tests), `tests/webhooks.orders.test.ts` (16 tests), `tests/shop-lifecycle.test.ts` (extended)
- `.gitignore` — `/app/types/` (codegen output)

## Wave 2 Contract

Plans 02-02, 02-03 and 02-04 consume the following **without modifying these files**. Anything a Wave 2 plan needs that is missing here should be added in that plan's own new file, not by editing these.

### `app/services/ledger.server.ts`

```ts
computeCompanyState(orders: OrderStateInput[], now: Date): CompanyState
// CompanyState = { exposure: Prisma.Decimal; overdue: boolean;
//                  earliestDueAt: Date | null; currencyMismatch: boolean }
// OrderStateInput = { outstandingShop: Decimal|string|number; currencyCode: string;
//                     hasPaymentTerms: boolean; cancelledAt: Date|null;
//                     schedules: { dueAt: Date|null; completedAt: Date|null }[] }
// Prisma rows from ledgerOrder.findMany({ include: { schedules: true } }) satisfy
// OrderStateInput directly.

recomputeCompany(shop: string, companyGid: string, now?: Date): Promise<CompanyState | null>
refetchOrderAndRecompute(shop: string, orderGid: string): Promise<void>
upsertOrderFromSource(shop: string, order: OrderForLedgerNode): Promise<string | null>  // returns companyGid
removeOrder(shop: string, orderGid: string): Promise<string | null>                     // returns companyGid
upsertCompany(shop: string, companyGid: string, name: string): Promise<string>          // returns local row id
deleteCompany(shop: string, companyGid: string): Promise<void>
recordWebhookReceipt(webhookId: string, shop: string, topic: string): Promise<boolean>  // false = duplicate
markWebhookProcessed(webhookId: string): Promise<void>
ORDER_FOR_LEDGER_QUERY: string
```

`recomputeCompany` takes an optional `now` specifically so 02-04's hourly sweep can drive the overdue flip deterministically under fake timers.

### `app/services/admin-client.server.ts`

`getAdminContext(shop) => LedgerAdminClient` (`{ graphql(query, { variables }) }`). **This is the only module Wave 2 tests should `vi.mock` for Admin API access** — never mock `authenticate.webhook`.

### `tests/helpers/admin-client-mock.ts`

`createMockAdmin({ OperationName: fixture })`. A fixture may be a response body, a `(variables) => body` function, or an **array consumed one entry per call with the last repeating** — that array form is the sequencing primitive for 02-02's chaos tests and 02-03's bulk-operation polling. Also exposes `calls`, `callsFor(op)`, `callCount(op?)`, `setFixture(op, fixture)`, `reset()`, and `operationNameOf(query)`. An unregistered operation throws by design.

### `tests/fixtures/order-fixtures.ts`

`makeOrderForLedger(overrides)`, `makeOrderForLedgerResponse(overrides)`, `makeMissingOrderResponse()`, `makeOrderState(overrides)`, plus constants `FIXTURE_PLACED_AT`, `FIXTURE_DUE_AT`, `FIXTURE_DUE_DATE`, `BEFORE_DUE`, `AFTER_DUE`, `FIXTURE_COMPANY_GID`, `FIXTURE_COMPANY_NAME`, `FIXTURE_ORDER_GID`. Defaults are an unpaid NET-30 $500 USD company order; all dates are fixed constants so nothing drifts with the wall clock.

## Decisions Made

- **A9 (background Admin client) — RESOLVED:** `unauthenticated.admin(shop)` returns `{ session, admin }` in the installed `@shopify/shopify-app-react-router@1.1.0`; `admin.graphql(query, { variables })` resolves a fetch `Response`. Verified by reading `node_modules/.../unauthenticated/admin/types.d.ts`.
- **A11 (webhookId source) — RESOLVED:** `authenticate.webhook` returns `webhookId` on its context in 1.1.0 (confirmed in the library's `authenticate.js` and its `Context` type). The `X-Shopify-Webhook-Id` header fallback the plan allowed for was **not** needed.
- **`getAdminContext` returns a narrow structural interface** rather than the library's `AdminApiContext`, so test doubles need only `graphql`. Typed GraphQL responses are declared locally in `ledger.server.ts`; codegen still validates the document.
- **Migration name:** `20260819031730_add_ledger_models`, applied to both databases before any verification ran.
- **`SyncCursor` uses a cuid primary key plus `@@unique([shop, key])`** rather than a composite `@@id`, matching every other model in the schema and avoiding a duplicate index.
- **`SweepLease` is deliberately outside `redactShop`** — it is global scheduler leadership holding no merchant data. The exclusion is asserted by a test so it reads as a decision, not an omission.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `PurchasingCompany.companyLocation` does not exist in the 2026-07 schema**
- **Found during:** Task 1 (first `npm run graphql-codegen` run)
- **Issue:** 02-RESEARCH.md § Code Examples selects `companyLocation { id }` inside the `PurchasingCompany` fragment. Codegen rejected it: *Cannot query field "companyLocation" on type "PurchasingCompany". Did you mean "location"?* Every company-location value would have been null at runtime, silently.
- **Fix:** Query `location { id }`; response type renamed to `location` with a comment recording why. Fixture builder updated to match.
- **Files modified:** `app/services/ledger.server.ts`, `tests/fixtures/order-fixtures.ts`
- **Verification:** `npm run graphql-codegen` exits 0
- **Committed in:** `84f92e8`

**2. [Rule 2 - Missing Critical] A GraphQL `errors` response must not be read as "order deleted"**
- **Found during:** Task 1 (writing `refetchOrderAndRecompute`)
- **Issue:** The plan's shape — "null order response → removeOrder" — is correct for a genuinely deleted order, but a protected-customer-data or scope failure ALSO returns a null order alongside an `errors` array (research Pitfall 2). That path would delete live ledger rows on a permissions blip and silently understate exposure, the exact failure this phase exists to prevent.
- **Fix:** `refetchOrderAndRecompute` throws when `errors` is non-empty (non-200 → Shopify redelivers) and only treats a clean `data.order === null` as a deletion.
- **Files modified:** `app/services/ledger.server.ts`
- **Verification:** covered by the delete-path tests; the distinction is documented in the function's doc comment
- **Committed in:** `84f92e8`

**3. [Rule 2 - Missing Critical] Re-attribution left a stale balance on the previous company**
- **Found during:** Task 1
- **Issue:** If an order moves from company A to company B, recomputing only B leaves A's exposure overstated forever.
- **Fix:** `refetchOrderAndRecompute` captures the previous company gid before the upsert and recomputes the union of previous and current.
- **Files modified:** `app/services/ledger.server.ts`
- **Committed in:** `84f92e8`

**4. [Rule 2 - Missing Critical] Query narrowed to reduce protected-data surface**
- **Found during:** Task 1
- **Issue:** The research example selects `... on Customer { id }` on the `purchasingEntity` union. The ledger only needs to know whether a company is behind the order; fetching buyer identity widens protected-customer-data exposure for no benefit and weakens the D-03 guard.
- **Fix:** The union selects `__typename` plus the `PurchasingCompany` branch only.
- **Files modified:** `app/services/ledger.server.ts`
- **Verification:** codegen passes (a union may be selected with `__typename` alone); attribution tests cover the non-company case via `__typename`
- **Committed in:** `84f92e8`

**5. [Rule 3 - Blocking] `/app/types/` gitignored**
- **Found during:** Task 1 (after the first successful codegen)
- **Issue:** Codegen writes ~10.5MB of regenerable artifacts (6.7MB schema dump) into an untracked directory that is not in `.gitignore` — it would show up in every future `git status` and risk being committed by an unrelated `git add`.
- **Fix:** `/app/types/` added to `.gitignore` with a comment explaining that running codegen is the gate, not storing its output. `.gitignore` was not in the plan's `files_modified`; the alternative was leaving a 10MB trap in the working tree.
- **Committed in:** `84f92e8`

### Process Deviation (not an auto-fix)

**Task 2's TDD RED could not be honestly staged.** The plan's acceptance criteria call for "a `test(02-01)` commit whose suite fails, then `feat(02-01)` turning it green". Task 1 is a *tracer*, and a tracer that persists a **correct** exposure necessarily implements the whole compute core — so by the time Task 2 began, all 28 matrix assertions passed on first run. Per the TDD gate ("if a test passes unexpectedly during RED, STOP and investigate"), the cause was investigated and is structural, not a mis-written test.

Rather than fabricate a broken intermediate commit, the matrix was **mutation-tested** to prove it is not vacuous. Four mutants were applied to `computeCompanyState`, each run, then reverted (implementation restored byte-identical, confirmed by an empty `git diff`):

| Mutant | Tests failed |
|---|---|
| strict-past overdue `<` → `<=` | 1 |
| drop the open-schedule gate | 4 |
| drop the payment-terms gate | 5 |
| pin `currencyMismatch` to `false` | 1 |

Task 3's RED was genuine (`redactShop` left ledger rows behind) and is committed as a failing test followed by the fix.

---

**Total deviations:** 5 auto-fixed (1 bug, 3 missing-critical, 1 blocking) + 1 documented process deviation
**Impact on plan:** No scope creep. Deviation 1 was caught by a gate the plan itself specified. Deviations 2–4 all harden the same invariant the phase exists for — never let a transient failure produce a wrong balance.

## Issues Encountered

- **Codegen document validation is the real schema gate, and it works.** It rejected the research's `companyLocation` field on the first run. Wave 2 plans adding queries should run `npm run graphql-codegen` before trusting any field name from RESEARCH.md.
- No other blockers. No `shopify` CLI command was run, so the `api_version = "2026-07"` pin was never at risk (re-grepped anyway: intact, as are `application_url` and `automatically_update_urls_on_dev = false`).

## Known Stubs

None. Every exported function has a working implementation and at least one test; no placeholder returns, no TODO/FIXME markers in any file this plan created or modified.

## User Setup Required

Unchanged from the plan's `user_setup` block and still outstanding — both are **launch-blocking but not execution-blocking** (dev stores are exempt), so filing them starts a ~7-business-day clock:

1. Partner Dashboard → app 411936784385 → API access → Access requests → **Read all orders** (purpose: the AR ledger must ingest ALL open net-terms orders regardless of age — a 60-day window silently understates merchant credit exposure).
2. Partner Dashboard → app 411936784385 → API access → **Protected customer data, Level 1 only**. This phase's query reads company ids, money amounts and dates — no name, email, phone or address fields — so Level 1 is sufficient and Level 2 should not be requested until Phase 5 needs contact emails.

No new environment variables. `SCOPES` still needs the value decided in research (`read_orders,read_all_orders,read_payment_terms,read_companies`) — that change belongs to plan 02-05, which owns the TOML, the Railway variable and `vitest.config.ts` together.

## Next Phase Readiness

**Ready for Wave 2 (02-02, 02-03, 02-04 in parallel).** The Wave 2 Contract section above is the shared surface; all three plans consume it read-only.

Notes for the Wave 2 plans:

- **02-02 (chaos + B2B events):** `createMockAdmin`'s array-fixture form is the sequencing primitive for redelivery/out-of-order/coalescing tests. `upsertCompany` / `deleteCompany` are already exported for the `companies/*` route. The W-2 Sentry `redactUrl` test is still owed.
- **02-03 (backfill):** `upsertOrderFromSource` takes an `OrderForLedgerNode`, so reassembled bulk JSONL rows should be shaped into that type and reuse it rather than writing a second upsert path. Note the bulk query must also select `location`, not `companyLocation`.
- **02-04 (scheduler):** `SweepLease` exists and is unused. `recomputeCompany(shop, companyGid, now)` accepts an explicit clock for fake-timer tests. `LedgerSchedule` carries the `@@index([shop, dueAt])` the hourly sweep needs. The `forEachActiveShop` helper is expected by a pointer left in `shop-lifecycle.server.ts`'s header.
- **02-05 (deploy):** owns scopes, the 15 webhook topics, and the A2/A7 dev-store empirical checks (coverage item D8 above stays open until then).

**Open risk carried forward:** A2 — whether `totalOutstandingSet` behaves as the collectible remainder through a partial-payment-then-refund sequence is still unconfirmed against a live store. The engine trusts that number by design, so the check is a real gate, not a formality.

## Self-Check: PASSED

- All 9 claimed files exist on disk (8 created + migration SQL + this summary).
- All 4 claimed commits resolve in `git log`.
- All 10 exports named in the Wave 2 Contract are present in `app/services/ledger.server.ts`.
- `npm test -- --run` → 74 passed / 5 files; `npm run typecheck` → exit 0; `npm run lint` → exit 0.
- `npm run graphql-codegen` → exit 0; `prisma migrate status` against `creditguard_test` → up to date.
- `grep 'api_version = "2026-07"' shopify.app.toml` → intact; `application_url` and `automatically_update_urls_on_dev = false` unchanged.
- `.planning/STATE.md` and `.planning/ROADMAP.md` untouched by this plan; nothing pushed.

---
*Phase: 02-ar-ledger-credit-engine*
*Completed: 2026-08-19*
