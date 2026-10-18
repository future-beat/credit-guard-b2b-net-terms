# Phase 3: Credit Controls & Metafield Publishing - Pattern Map

**Mapped:** 2026-08-19
**Files analyzed:** 7 new-code categories → ~10 new/modified files
**Analogs found:** 5 exact/role-match / 7 categories (2 categories are genuinely new-pattern territory — shapes prescribed from 03-RESEARCH.md)

All paths are repo-relative from the project root (`/Users/hesamabbaszadi/Documents/Projects/Shopify app`). Line numbers verified against the working tree at commit `4977b97`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `app/routes/app.companies.tsx` (NEW) | route: loader + action + UI | request-response (CRUD) | loader/UI: `app/routes/app._index.tsx` + `app/routes/app.tsx`; action dispatch: `app/routes/webhooks.orders.tsx` (partial) | **no true analog** — first mutation-bearing admin route; shape prescribed below |
| `app/services/metafields.server.ts` (NEW) | service (publisher) | request-response (GraphQL write) | `app/services/ledger.server.ts` (graphqlJson call sites, contract-doc header) + `app/services/shop-lifecycle.server.ts` (contract-doc style) | role-match |
| `app/services/ledger.server.ts` (MODIFIED — publish hook in `recomputeCompany`) | service | CRUD | itself (`recomputeCompany`, lines 739–775) | exact |
| `prisma/schema.prisma` (MODIFIED — Company fields) + migration | model | — | existing `Company` model (lines 42–63 area) | exact |
| `shopify.app.toml` (MODIFIED — scope + metafield definition) | config | — | existing `[access_scopes]` block + its lockstep comments | exact |
| `tests/companies-settings.test.ts` (NEW) | test | — | `tests/shop-lifecycle.test.ts` (DB-integration style), `tests/privacy-route.test.ts` (route-level request testing) | role-match |
| `tests/metafield-contract.test.ts` + `tests/metafield-publish.test.ts` (NEW) | test | — | `tests/credit-engine.test.ts`, `tests/graphql-error-surfacing.test.ts` + `tests/helpers/admin-client-mock.ts` | exact (mock seam identical) |
| `tests/scheduler.test.ts` / source guards (MODIFIED or NEW guards) | test | — | `tests/scheduler.test.ts` lines 386–447 | exact |
| `scripts/prod-ledger-state.mjs` (EXTENDED or sibling script) | tooling | file-I/O / GraphQL read | `scripts/prod-ledger-state.mjs` itself | exact |
| `app/routes/app.tsx` (MODIFIED — nav item) | route shell | — | itself (nav block, lines ~46–58) | exact |

## Pattern Assignments

### 1. `app/routes/app.companies.tsx` — settings route (NO TRUE ANALOG — first mutation-bearing UI route)

There is no existing admin route with an `action`. Compose from three sources:

**Loader auth + boundary shell — copy from `app/routes/app._index.tsx` (whole file, 37 lines):**
```tsx
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null; // Phase 3: return { session } data — companies list, data_complete, backfill status
};
// ...
export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
```
Every route in `app/routes/app.*` ends with the `boundary.headers` export — keep it. Copy-contract convention also applies: byte-exact copy strings hoisted to named constants with a comment pointing at the UI-SPEC (see `EMPTY_STATE_HEADING`/`EMPTY_STATE_BODY` in `app._index.tsx`).

**Action dispatch discipline — adapt from `app/routes/webhooks.orders.tsx` (lines 118–185):** authenticate FIRST statement, then a `switch` over a whitelisted discriminator with a logging `default` that changes nothing. Translate: `authenticate.webhook` → `authenticate.admin`; topic switch → **intent switch** (`set-limit` | `set-bypass`); unknown intent → 400, never a silent success. Shop domain comes from `session.shop`, never from form data (mirrors the webhook route's "shop from the verified delivery, never the payload" rule, T-02-05 analog).

**Value-echo CAS — no analog; prescribed verbatim from 03-RESEARCH.md §Settings Mutations / §Code Examples:**
```ts
const where = {
  id: companyId, shop,
  creditLimit: previousLimit === null ? null : new Prisma.Decimal(previousLimit),
};
const { count } = await db.company.updateMany({ where, data: { creditLimit: next } });
if (count === 0) return data({ ok: false, code: "stale" as const }, { status: 409 });
await recomputeCompany(shop, companyGid); // republishes with the new limit
```
Rules locked by research: intent whitelist; limit validated by grammar `^\d{1,13}(\.\d{1,2})?$` then `new Prisma.Decimal(value)` (never `parseFloat`); empty string ⇒ `null`; bypass = plain `update`, last-write-wins; `shop` in every WHERE (cross-shop id matches zero rows). Per-row `useFetcher()` (one for limit, one for switch); limit confirmed-not-optimistic via revalidation, switch optimistic with revert-on-error (03-UI-SPEC §Inline-Edit / §Bypass Toggle contracts).

**Re-install/backfill side effects belong to `app.tsx`, not this route** — `app/routes/app.tsx` loader (lines 15–41) already does `ensureShopActive` + `void startBackfill` on every authenticated load; do not duplicate them in the companies loader.

### 2. Inline-edit index table UI — anchor to Phase 1 shell conventions

**Analog:** `app/routes/app.tsx` + `app._index.tsx` for structure only (`s-page` → `s-section` → content; Polaris web components as bare JSX elements, no imports). Nav change in `app/routes/app.tsx` (lines ~46–58): replace the reserved-slot comment with
```tsx
<s-app-nav>
  <s-link href="/app">Home</s-link>
  <s-link href="/app/companies">Companies</s-link>
</s-app-nav>
```
The comment there explicitly names "Companies" as the Phase 3 reserved label — remove/update the comment when consuming the slot.

**Error boundary:** do NOT write a new one; `app/routes/app.tsx` `ErrorBoundary` (lines ~62–107) covers child routes. Route-level failure copy for actions travels in fetcher data, not thrown errors.

**Component specifics have no in-repo analog** — take from 03-UI-SPEC.md + 03-RESEARCH.md §UI Components: `s-table` family, `s-money-field` (auto store-currency formatting, no `currency` prop; fallback `s-number-field` + currency in `details`), `s-switch`, badge tones **`critical`** (Overdue) / **`warning`** (Over limit) / **`caution`** (Enforcement bypassed — there is NO `attention` tone in the app-home catalog). Values via `Intl.NumberFormat`; "No limit" vs "$0.00" rendering is D-02 law.

### 3. `app/services/metafields.server.ts` + publish hook in `recomputeCompany`

**Service module shape — copy from `app/services/shop-lifecycle.server.ts` (lines 1–36) and `app/services/ledger.server.ts` (lines 6–43):** a contract-doc header stating the module's laws in numbered rules. Research locks this header as home #2 of the metafield contract (payload field table, null-vs-0, decimal-string rule, `credit_v2`-not-rename versioning).

**GraphQL transport — copy the call-site pattern from `ledger.server.ts` `graphqlJson` (lines 185–207).** Contract: import `graphqlJson` from `ledger.server.ts` (transport contract T-02-27 — never `getAdminContext(...).graphql` directly), pass a `label` (`"PublishCompanyCredit"`). Document as an exported `#graphql` template-literal const like `ORDER_FOR_LEDGER_QUERY` (ledger.server.ts lines 62–92) so codegen validates it and source-guard tests can scan it.

**THE TRAP (Pitfall 1):** `graphqlJson` throws only on top-level `errors[]`. `metafieldsSet` failures arrive as `userErrors` inside `data` with a 200 — the publisher MUST check `data.metafieldsSet.userErrors.length > 0` explicitly and treat it as failure. Research sketch (03-RESEARCH.md §Code Examples):
```ts
const userErrors = body.data?.metafieldsSet?.userErrors ?? [];
if (userErrors.length > 0) throw new MetafieldPublishError(shop, userErrors); // caught by non-throwing wrapper
```

**Non-throwing wrapper — copy the swallow-and-report pattern from `app/routes/app.tsx` (lines 33–37):**
```ts
void startBackfill(session.shop).catch((error: unknown) => {
  console.error(`Backfill trigger failed for ${session.shop}:`, error);
});
```
Same doctrine for publish: catch → `Sentry.captureException` (Sentry import style: `import * as Sentry from "@sentry/react-router"` per ledger.server.ts line 2) → return. Never rethrow into a webhook (Pitfall 3 — 500 → redelivery → receipt dedupe → publish never retried).

**Hook point — `recomputeCompany`, ledger.server.ts lines 739–775.** It is THE single writer of Company credit state (rule 3, header lines 31–35); add the publish call after its `db.company.update` (line ~762), outside any transaction, preserving sole-writer. Every trigger already funnels here: webhooks (`refetchOrderAndRecompute`), hourly sweep (`overdueSweep` → scheduler.server.ts lines 259–262), reconciliation, and the new settings action.

**Shop.active gate:** publisher checks `Shop.active` (the SCHEDULER CONTRACT in shop-lifecycle.server.ts header lines 18–31 extends explicitly to "metafield publishing"). Sweeps reach it only via `forEachActiveShop` (scheduler.server.ts line 106) — never a second Shop-table read (CF-3 source guard will fail the build).

**Hash-skip + dirty-scan:** no analog; per research — canonical serialize (stable key order), sha256 minus `computed_at`, skip when hash === `Company.publishedStateHash` && `publishedAt ≥ recomputedAt`; hourly sweep's `publishedAt < recomputedAt` scan is the retry channel (no queue/outbox — Don't Hand-Roll table).

### 4. Prisma `Company` extension + migration

**Analog:** the existing `Company` model, `prisma/schema.prisma` (`exposure Decimal @default(0) @db.Decimal(19, 4)`). New fields per research §Schema:
```prisma
creditLimit        Decimal?  @db.Decimal(19, 4)   // null = observe-only (D-02); no default
bypassEnforcement  Boolean   @default(false)      // D-03
publishedStateHash String?
publishedAt        DateTime?
```
Follow the model's `///` doc-comment convention (every Phase 2 model carries requirement IDs + threat refs in doc comments). Migration `add_company_credit_controls` via `prisma migrate dev`, applied to `creditguard_dev` + `creditguard_test` (pretest hook auto-applies) + prod release-phase `prisma migrate deploy`. No new indexes.

**REDACTION CONTRACT (shop-lifecycle.server.ts header lines 32–36):** no new shop-keyed MODEL is added, so `redactShop` needs no new `deleteMany` — but if the planner adds one anyway, it needs both the `deleteMany` line (lines 58–75) AND a counter in `countsFor` in `tests/shop-lifecycle.test.ts`.

### 5. `shopify.app.toml` — scope + metafield definition (CF-5 discipline)

**Analog:** the existing `[access_scopes]` block with its per-scope rationale comments (lines 9–33). Follow both conventions there:
1. Comment each addition with its rationale (`write_companies` — metafieldsSet on Company requires the owner-type write scope).
2. **Lockstep rule (comment at lines 30–33):** the scope string must change in three places — TOML, Railway `SCOPES` var, `vitest.config.ts` test env — `app/shopify.server.ts` reads `process.env.SCOPES`, so TOML alone changes nothing at runtime (Pitfall 4).

Definition block prescribed by research §Code Examples (Assumption A1 — `company` owner-type token unverified; fallback is a schema-verified `metafieldDefinitionCreate` mutation):
```toml
[company.metafields.app.credit_v1]
name = "Credit Guard credit state"
description = "Machine-read credit state published by Credit Guard. Do not edit."
type = "json"
access.admin = "merchant_read"
```
**CF-5 byte-guard:** `git diff shopify.app.toml` after EVERY Shopify CLI invocation; only the intended scope + metafield hunks may survive. Watch for the CLI re-pinning `api_version` to the 2026-10 RC and flipping `automatically_update_urls_on_dev` (comments at lines 36–38 and the `[build]` block document both).

### 6. Tests

**Mock seam — copy from `tests/helpers/admin-client-mock.ts` (whole file):** tests `vi.mock` `app/services/admin-client.server.ts` and inject `createMockAdmin({ PublishCompanyCredit: fixture })`; fixtures keyed by GraphQL operation name; unregistered operation throws. Research's Wave-0 note: the mock factory's default fixture set must gain a benign `metafieldsSet` success so the existing 235 tests stay green once the publish hook lands in `recomputeCompany`.

**Source-guard pattern — copy from `tests/scheduler.test.ts` lines 386–447:** `sourceWithoutComments(relativePath)` helper (readFileSync + comment-strip regex, lines 395–398), then regex assertions over code. Phase 3 guards to add in this style: (a) `metafields.server.ts` never calls `getAdminContext(...).graphql` directly (extends the T-02-27 document guard in `tests/graphql-error-surfacing.test.ts` lines 211–257, which already scans all three services — add the fourth); (b) optional research suggestion: assert `process.env.SCOPES` contains `write_companies` when the publisher is under test (Pitfall 4 guard).

**Contract-lock tests — analog `tests/credit-engine.test.ts`:** pure-function tests over exported helpers (`serializeCreditState` here, `computeCompanyState` there), plus the intent-guard style of its line 349 ("source guard" on intent, not mechanism). `tests/metafield-contract.test.ts` snapshots the exact serialized payload (null-vs-"0.00", decimal strings, key order) — these fixtures are the cross-boundary carrier Phase 4's Function fixtures are generated from.

**Route-action tests — nearest analogs `tests/privacy-route.test.ts` (Request-in, Response-out route testing) and `tests/webhooks.orders.test.ts` (action + real DB rows in `creditguard_test`).** New territory: `authenticate.admin` must be mocked/stubbed (no existing test authenticates an admin session — webhook tests keep real HMAC instead). Keep the creditguard_test DB isolation and `fileParallelism: false` conventions from `vitest.config.ts`.

### 7. `scripts/prod-ledger-state.mjs` extension — live metafield read-back

**Analog:** the script itself (153 lines). Conventions to preserve: runs inside the Railway container (shipped by `scripts/prod-ledger-state.sh` — extend the same ssh wrapper), JSON-only stdout for `jq`, sessions COUNTED never selected (access tokens), Decimals stringified via `.toFixed(4)`. Extension: add the Admin GraphQL read-back per research §Code Examples —
```graphql
query CompanyCreditMetafield($id: ID!) {
  company(id: $id) { id name metafield(namespace: "$app", key: "credit_v1") { value updatedAt type } }
}
```
(readable under existing `read_companies`), plus DB columns `creditLimit`, `bypassEnforcement`, `publishedStateHash`, `publishedAt` in the company select, and a `publishedAt < recomputedAt` dirty count. Note the script uses PrismaClient directly (no offline-session client in scope) — for the GraphQL call it must build a client from the stored offline token or run the query via a small server-side path; mirror however 02-08's signed-sender tooling reached the Admin API (see `.planning/phases/02-ar-ledger-credit-engine/02-08-SUMMARY.md`).

## Shared Patterns

### Shop-domain keying (every service + route)
**Source:** `app/services/shop-lifecycle.server.ts` header rule 1; `app/services/ledger.server.ts` header lines 40–42.
Every Prisma WHERE includes `shop`; the domain comes from `authenticate.admin(request).session.shop` (routes) or the verified webhook — never from form data or payloads. CAS WHERE includes `shop` so forged cross-shop ids match zero rows.

### GraphQL transport + error surfacing
**Source:** `app/services/ledger.server.ts` lines 172–207 (`graphqlJson`) and `app/services/admin-client.server.ts` (the seam + its TRANSPORT CONTRACT comment).
All Admin GraphQL through `graphqlJson(shop, DOC, { variables, label })`; top-level `errors[]` throws `LedgerGraphqlError`; `userErrors` must be checked separately at each mutation call site. Variables only — never interpolate input into documents.

### Non-throwing background side effects
**Source:** `app/routes/app.tsx` lines 33–37 (`void ...catch`), scheduler `forEachActiveShop` per-shop try/catch with `Sentry.captureException` + tags (`scheduler.server.ts` lines ~115–125).
Apply to: the publish call inside `recomputeCompany` and inside the settings action.

### Shop.active gating for background work
**Source:** `shop-lifecycle.server.ts` SCHEDULER CONTRACT (lines 18–31) + `forEachActiveShop` (`scheduler.server.ts` line 106, sole Shop enumerator, `active: true` filter, CF-3 source-guarded).
Apply to: publisher and any new sweep/dirty-scan — write sweeps as `forEachActiveShop(async (shop) => ...)`.

### Contract-doc headers + requirement/threat IDs
**Source:** every service header and prisma doc comment (e.g. `ledger.server.ts` lines 7–43, `Company` model comment).
New modules and schema fields carry the same style: numbered rules, D-xx/CRED-xx/T-xx references, and pointers to the tests that enforce them.

### Copy as named constants
**Source:** `app/routes/app._index.tsx` lines 15–18.
UI-SPEC copy strings are byte-exact constants with a "do not reword without updating the spec" comment — apply to all Companies-page copy (toasts, empty states, staleness message).

## No Analog Found

| Category | Role | Reason | Prescribed shape |
|----------|------|--------|------------------|
| Mutation-bearing admin route (loader+action+fetchers) | route | No existing `app/routes/app.*` has an action; webhook actions are a different auth/data-flow family | 03-RESEARCH.md §Settings Mutations + §Code Examples (value-echo CAS, intent whitelist, per-row fetchers); UI-SPEC interaction contracts |
| Inline-edit table / s-money-field / s-switch / badge tones | component | Phase 1 UI is a static empty state; no table, form, or badge exists anywhere | 03-UI-SPEC.md contracts + research §UI Components (tone enum verified: use `caution`, not `attention`) |
| Metafield publisher hash-skip / dirty-marker retry | service sub-pattern | No prior metafield write or publish bookkeeping in the repo | Research §Write Path + §Publish wiring (sha256 minus computed_at; `publishedAt < recomputedAt` sweep scan; non-throwing) |
| Admin-session route testing (`authenticate.admin` stub) | test | Existing suites mock the admin client, never admin auth | Planner's choice; keep the admin-client mock real-ish and stub only the auth boundary, mirroring how webhook tests keep HMAC real |

## Metadata

**Analog search scope:** `app/routes/`, `app/services/`, `prisma/`, `tests/`, `tests/helpers/`, `scripts/`, `shopify.app.toml`
**Files scanned:** 18 (all routes/services read; 5 test files read for conventions; schema, TOML, prod script read in full)
**Pattern extraction date:** 2026-08-19
