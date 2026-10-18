# Phase 2: AR Ledger & Credit Engine - Pattern Map

**Mapped:** 2026-08-19
**Files analyzed:** 8 analog files (entire Phase 1 surface)
**Analogs found:** 6 categories with strong analogs / 9 total (3 flagged as new-pattern territory)

## File Classification

| New/Modified File (per RESEARCH.md structure) | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `prisma/schema.prisma` (Company, LedgerOrder, LedgerSchedule, WebhookReceipt, SyncCursor, SweepLease) | model | — | existing `Shop` / `ComplianceRequest` models | exact |
| `app/routes/webhooks.orders.tsx` | route (webhook) | event-driven | `app/routes/webhooks.compliance.tsx` | exact |
| `app/routes/webhooks.payment-terms.tsx` | route (webhook) | event-driven | `app/routes/webhooks.compliance.tsx` | exact |
| `app/routes/webhooks.companies.tsx` | route (webhook) | event-driven | `app/routes/webhooks.compliance.tsx` | exact |
| `app/routes/webhooks.bulk-operations.tsx` | route (webhook) | event-driven | `app/routes/webhooks.app.uninstalled.tsx` (single-topic route) | exact |
| `app/services/ledger.server.ts` (`recomputeCompany`, `refetchOrderAndRecompute`, dedupe) | service | CRUD / transform | `app/services/shop-lifecycle.server.ts` | exact |
| `app/services/reconciliation.server.ts` | service | batch | `app/services/shop-lifecycle.server.ts` | role-match |
| `app/services/backfill.server.ts` (Admin GraphQL client + bulk JSONL) | service / API client | batch, file-I/O | **none** — no GraphQL query code exists yet | NO ANALOG |
| `app/services/scheduler.server.ts` (node-cron, SweepLease, `forEachActiveShop`) | service / daemon | event-driven (timer) | **none** — no long-lived process code exists | NO ANALOG |
| `tests/ledger*.test.ts`, chaos tests | test | — | `tests/shop-lifecycle.test.ts` + `tests/webhooks.compliance.test.ts` | exact |
| `scripts/prod-ledger-state.{sh,mjs}`, order-webhook additions to `send-signed-webhook.sh` | script | request-response | `scripts/prod-lifecycle-state.{sh,mjs}`, `scripts/send-signed-webhook.sh`, `scripts/smoke-deployed.sh` | exact |
| `shopify.app.toml` `[[webhooks.subscriptions]]` additions | config | — | existing subscription blocks (lines 19–33) | exact |

## Pattern Assignments

### Prisma models (Company, LedgerOrder, LedgerSchedule, WebhookReceipt, SyncCursor, SweepLease)

**Analog:** `prisma/schema.prisma` — `Shop` and `ComplianceRequest` models (lines 40–66)

**Conventions to copy:**
- `String @id @default(cuid())` primary keys (except `WebhookReceipt`, whose `id` IS the `X-Shopify-Webhook-Id` header value — natural key, per research dedupe prescription).
- Shop scoping via a plain `shop` string column (the domain), never a relation to `Shop` — matches `ComplianceRequest.shop` and keeps `redactShop`'s `deleteMany({ where: { shop } })` pattern extendable. **Every new model needs a line added to `redactShop()`** in `app/services/shop-lifecycle.server.ts` and to the retention/redaction assertions in `tests/shop-lifecycle.test.ts` / `tests/webhooks.compliance.test.ts` (`countsFor`, `wipe`).
- Doc-comment convention: `///` triple-slash block above each model citing the decision/threat IDs it implements, exactly as `Shop` cites "FOUND-03, D-06":

```prisma
/// Per-store lifecycle record (FOUND-03, D-06).
model Shop {
  id            String    @id @default(cuid())
  domain        String    @unique
  active        Boolean   @default(true)
  ...
  @@index? / @@unique as needed
}
```

- Composite uniqueness `@@unique([shop, <gid>])` and targeted `@@index` (analog: `@@index([shop])` on ComplianceRequest; research prescribes `@@index([shop, dueAt])` on LedgerSchedule for the hourly sweep).
- Money: `Decimal @db.Decimal(19, 4)` per RESEARCH.md § Recommended Prisma Schema Shape — no float anywhere. This is new (no money columns exist) but the research section IS the schema; copy it near-verbatim.

### Webhook routes (`webhooks.orders.tsx`, `webhooks.payment-terms.tsx`, `webhooks.companies.tsx`)

**Analog:** `app/routes/webhooks.compliance.tsx` (multi-topic switch) — copy wholesale.

**Core pattern** (lines 26–59):

```typescript
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} compliance webhook for ${shop}`);
  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      await logComplianceRequest(shop, topic);
      break;
    ...
    default:
      console.log(`Unhandled compliance topic ${topic} for ${shop}`);
      break;
  }
  return new Response();
};
```

Rules embodied there that Phase 2 routes must keep:
- `authenticate.webhook(request)` FIRST — it throws a 401 Response on bad HMAC before any handler code; never read `request` body before it (it consumes the raw signed body). Phase 2 addition: routes also need `payload` — destructure `const { shop, topic, payload } = await authenticate.webhook(request)` (the library parses the body; do not `request.json()`).
- Topic constants are the library's normalised `topicForStorage` form: UPPER_SNAKE (`ORDERS_CREATE`, `ORDERS_UPDATED`, `REFUNDS_CREATE`, `PAYMENT_TERMS_UPDATE`, `COMPANIES_UPDATE`, `BULK_OPERATIONS_FINISH`…).
- Thin handler → service function; no business logic in the route. Phase 2 twist (Pattern 1, topic-agnostic ingest): the switch collapses — every `orders/*` + `refunds/create` + `payment_terms/*` case extracts the order gid from `payload` and calls the same `ledger.server.ts` entry (`enqueueOrderRefetch(shop, orderGid)` or equivalent). Dedupe-insert on `X-Shopify-Webhook-Id` happens in the service before processing; ack `new Response()` fast either way.
- `default:` case acknowledges unhandled topics with a log — copy this.
- Doc-comment header explaining threats/decisions and why session is or isn't in scope (session IS undefined for post-uninstall deliveries — see the "never dereferences a session" source-guard test).

**For single-topic `webhooks.bulk-operations.tsx`:** copy `app/routes/webhooks.app.uninstalled.tsx` instead — same shape minus the switch; note its `if (session)` guard pattern if the handler ever needs session-conditional work.

**TOML wiring analog:** `shopify.app.toml` `[[webhooks.subscriptions]]` blocks at lines 19–33 (uri + topics arrays under pinned `api_version = "2026-07"`). Add new blocks in the same style; re-grep `api_version = "2026-07"` after every `shopify` CLI command (CF-5).

### Credit engine service (`ledger.server.ts`)

**Analog:** `app/services/shop-lifecycle.server.ts` — copy structure, tone, and idempotency discipline.

**Module conventions** (whole file, 79 lines):
- Single import: `import db from "../db.server";` — services import Prisma directly, no DI container.
- File-level doc comment stating the contract and its two invariant rules (keying, idempotency) before any code. Phase 2's version should state: recompute-from-source only (no `balance += delta`), `purchasingEntity` never `Order.customer` (D-03), single `recomputeCompany()` code path.
- Exported `async function` per operation with a JSDoc explaining WHY, citing decision IDs.
- Idempotency via `upsert` keyed on the natural key:

```typescript
await db.shop.upsert({
  where: { domain },
  update: { active: false, uninstalledAt },
  create: { domain, active: false, uninstalledAt },
});
```

→ Phase 2: `db.ledgerOrder.upsert({ where: { shop_orderGid: { shop, orderGid } }, ... })`.
- Multi-table atomicity via `db.$transaction([...])` with `deleteMany`/tolerant operations so redelivery is a no-op (see `redactShop`, lines 42–51, including the "deleteMany not delete so absent rows don't P2025-throw" comment — copy that reasoning for schedule replacement inside the order upsert transaction).
- The scheduler contract is already written down in this file's header ("every scheduled job MUST filter `Shop.active = true`") — Phase 2 makes it structural via `forEachActiveShop` in `scheduler.server.ts` and should update that comment to point at the helper.
- **Pure compute core** (research Pattern 2): `computeCompanyState(orders): { exposure, overdue, earliestDueAt }` as a pure function over plain data — the shop-lifecycle functions are all I/O-bound so this exact sub-pattern has no analog; keep it in the same file (or `ledger.core.ts`) with fetch/persist in thin wrappers.

### Tests (unit + webhook + chaos)

**Analogs:** `tests/shop-lifecycle.test.ts` (service tests) and `tests/webhooks.compliance.test.ts` (route tests with real HMAC).

**Conventions to copy exactly:**
- Real Postgres (`creditguard_test`), no DB mocking. Per-suite `wipe(...)`/`countsFor(...)` helpers scoped to fixed test domains, run in `beforeEach` and `afterAll` with `prisma.$disconnect()` (shop-lifecycle.test.ts lines 40–63). Extend `wipe` with the new tables.
- Bystander isolation: every destructive test has an `OTHER_SHOP` "never touches another shop's rows" assertion.
- Idempotency-under-redelivery as a first-class test ("is idempotent under webhook redelivery", lines 96–107) — the chaos tests are this pattern extended: deliver the same signed request twice, deliver `orders/updated` without `orders/paid` (coalescing), deliver out-of-order, and assert the ledger converges to the same state.
- Webhook route tests: do NOT mock `authenticate.webhook` — build requests with `signedWebhookRequest` / `forgedWebhookRequest` from `tests/helpers/webhook-hmac.ts` and invoke the route action directly:

```typescript
async function complianceAction(request: Request) {
  const { action } = await import("../app/routes/webhooks.compliance");
  return action({ request, params: {}, context: {} } as never);
}
// + complianceResponse() wrapper that catches the thrown 401 Response
```

Every new webhook route gets the forged-HMAC 401 + no-side-effect test (webhooks.compliance.test.ts "invalid HMAC" describe block).
- Mock only what must be mocked, via `vi.hoisted` + partial `vi.mock` of `../app/shopify.server` (shop-lifecycle.test.ts lines 24–34) — Phase 2 will use this for `unauthenticated.admin` / the GraphQL client in refetch/backfill tests.
- **Source-guard tests** (readFile + regex over the source): "holds no delete against retained tables", "never dereferences a session", TOML wiring assertions. Phase 2 needs three: ledger service never reads `Order.customer`/`customer` (D-03), scheduler contains no `shop.findMany` without the active filter (CF-3), and TOML declares the new topics under `api_version = "2026-07"`. Also the deferred W-2 `redactUrl` Sentry-scrubber unit test.
- TDD red-first, separate test/feat commits (Phase 1 convention).

### Deployed verification scripts

**Analogs:** all three in `scripts/`.
- Extend `scripts/send-signed-webhook.sh`: add `orders/create` etc. to the topic `case` block (endpoint + minimal body). Keep the secret discipline verbatim — HMAC computed by node reading `SHOPIFY_API_SECRET` from its own environment via stdin body, never openssl, never argv (lines 63–77).
- New `prod-ledger-state.{sh,mjs}` copied from `prod-lifecycle-state.{sh,mjs}`: base64-ship a JSON-printing .mjs into `/app` over `railway ssh` (node_modules resolution requires /app, not /tmp), count sessions rather than select them, print JSON only.
- Extend `scripts/smoke-deployed.sh` style for any new checks: `set -euo pipefail`, no error-suppressing fallbacks, `fail()` helper, assert exact status codes.

## Shared Patterns

### Webhook authentication + 401
**Source:** `authenticate.webhook` via `app/shopify.server.ts` (exports `authenticate`, `unauthenticated`; `ApiVersion.July26` pinned twice — lines 13 and 32).
**Apply to:** all four new webhook routes. Never hand-roll HMAC; never touch the body first.

### Shop-domain keying + Shop.active gating
**Source:** `app/services/shop-lifecycle.server.ts` header contract + `Shop` model.
**Apply to:** every service and every scheduled sweep. `redactShop` must grow a `deleteMany` per new table; scheduler enumerates shops ONLY via `forEachActiveShop`.

### Idempotency (at-least-once, out-of-order tolerant)
**Source:** `deactivateShop`/`redactShop` upsert/deleteMany style.
**Apply to:** webhook dedupe (insert-or-skip `WebhookReceipt` on unique webhook id), order upserts, both sweeps, `SweepLease` atomic-UPDATE claim.

### Test env / config
**Source:** `vitest.config.ts` (pinned dummy `SHOPIFY_API_SECRET`, `SCOPES: ""`, serial files, TEST_DATABASE_URL default) and `package.json` `pretest` migrate.
**Apply to:** update `SCOPES` in vitest env when CF-1 lands the real scope string (`read_orders,read_all_orders,read_payment_terms,read_companies` per research); keep `fileParallelism: false` — chaos tests depend on serial DB access.

## No Analog Found

Files with no close match; planner should use RESEARCH.md prescriptions as the pattern source:

| File | Role | Data Flow | Reason / Recommended shape |
|---|---|---|---|
| `app/services/scheduler.server.ts` | daemon service | timer-driven | No long-lived process code exists. Shape per RESEARCH.md § Scheduler: node-cron **4.x** (`noOverlap: true`, no `scheduled:` option — Pitfall 8), `SweepLease` claim via single atomic `UPDATE ... WHERE lockedUntil < now()` (never Prisma advisory locks), SIGTERM handler stopping tasks, `forEachActiveShop(fn)` as the sole shop enumerator, wired at server start (entry point: `instrument.server.mjs`-adjacent or a server module imported once — decide in planning; nothing analogous exists). Also new dep: `node-cron@^4.6.0`. |
| `app/services/backfill.server.ts` + `app/graphql/` documents | API client / batch | file-I/O | Zero Admin GraphQL calls exist in the codebase (codegen preset configured via `.graphqlrc.ts` but unused). Shape per RESEARCH.md § Backfill + Code Examples: `bulkOperationRunQuery` → `bulk_operations/finish` webhook or `bulkOperation(id:)` poll → stream JSONL with `node:readline`, `__parentId` reassembly (Pattern 3, fixture-file test). Client obtained via `unauthenticated.admin(shop)` (verify exact helper against installed `@shopify/shopify-app-react-router@1.1.0`). Run `npm run graphql-codegen` as the first correctness gate on every query document. |
| `app/services/reconciliation.server.ts` cursor logic | service | batch | Partial analog only (service-module style from shop-lifecycle). Cursor pattern (`SyncCursor` row = max `updatedAt` − 5-min overlap; `orders(query: "updated_at:>=...", sortKey: UPDATED_AT)`) comes from RESEARCH.md § Reconciliation Query; drift discrepancies logged to Sentry as warnings. |

## Metadata

**Analog search scope:** `app/routes/`, `app/services/`, `prisma/`, `tests/`, `scripts/`, root config (`vitest.config.ts`, `package.json`, `shopify.app.toml`, `app/shopify.server.ts`, `.graphqlrc.ts`)
**Files scanned:** 15
**Pattern extraction date:** 2026-08-19
