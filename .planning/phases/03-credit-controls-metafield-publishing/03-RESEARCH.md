# Phase 3: Credit Controls & Metafield Publishing - Research

**Researched:** 2026-08-19
**Domain:** Shopify Admin GraphQL app-owned metafields on Company; embedded-admin settings CRUD (React Router 7 + Polaris web components)
**Confidence:** HIGH (every prescribed GraphQL field name byte-verified against the local `app/types/admin-2026-07.schema.json` — the same schema `npm run graphql-codegen` validates against; behavioral/scope claims cited from live shopify.dev 2026-07 docs fetched this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Settings UX Model
- **D-01:** One Companies page: Polaris index table with per-row inline editing — columns: company, exposure, limit (inline editable), utilization, overdue badge, bypass toggle. NO per-company detail pages in v1 (deferred). Matches the guided-setup flow "review balances → set first limit" in one click; ICP has 5–50 companies. Uses the reserved "Companies" nav slot from the Phase 1 UI contract.

#### Zero-Limit Semantics
- **D-02:** `limit = 0` is VALID and means "no new net-terms credit — block every net-terms checkout for this company". `limit = null` (never set / cleared) means observe-only. The UI must render the difference unambiguously ("No limit" vs "$0.00"); the metafield contract must carry the distinction (null vs 0). — **Reversibility:** costly — semantics propagate into the Phase 4 Function and merchant expectations; changing after launch changes what $0 means on live stores.

#### Bypass Presentation
- **D-03:** Label: **"Bypass enforcement"** (not "Trusted"/"Exempt"). A bypassed company KEEPS showing exposure, utilization, and overdue badge, plus a distinct "Enforcement bypassed" indicator — visibility without enforcement. Same wording flows into Phase 4's enforcement event log ("allowed — enforcement bypassed").

#### Metafield Contract
- **D-04:** The `$app` credit metafield set includes a **`data_complete` boolean** — false whenever the company has ANY order in `UNRESOLVED` attribution status — plus `computed_at`. Phase 4 decides fail-open-vs-conservative on incomplete data WITHOUT a contract change. — **Reversibility:** one-way once Phase 4's Function ships to merchant checkouts — the deployed Function parses this contract; removing/renaming fields breaks live checkout validation. Namespace/key naming + versioning strategy: researcher prescribes, planner locks.
- **D-05:** Metafield writes consume `recomputeCompany` output ONLY (it remains the sole writer of exposure/overdue/earliestDueAt — Phase 2 verification carry-forward). Publishing is a projection of the ledger, never a second computation.

### Claude's Discretion
- Everything technical: metafield namespace/key/type choices and versioning, write-scope verification (`write_companies`? metafield-specific? — researcher MUST verify the minimal scope for metafieldsSet on Company and flag the re-consent + version-release consequence), publish-on-change wiring (recompute hook vs outbox), rate-limit handling, settings-form validation, optimistic UI vs reload, test design.

### Deferred Ideas (OUT OF SCOPE)
- Per-company detail pages (history, notes) — v2
- Bulk limit editing / CSV import — v2
- Configurable enforcement thresholds (warn at 80% etc.) — Phase 6+ territory
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CRED-01 | Merchant can set/edit/remove a credit limit per B2B company | §Settings Mutations (value-echo CAS, Decimal validation), §Schema, §UI Components |
| CRED-02 | Merchant can flip a per-company bypass toggle to exempt a company from enforcement | §Settings Mutations (optimistic toggle, last-write-wins), §Schema |
| CRED-03 | App publishes each company's credit state (limit, exposure, overdue flag, bypass) to $app Company metafields whenever it changes | §The Scope Answer, §Metafield Contract, §Write Path |
| CRED-04 | New installs default to observe-only mode; enforcement activates per company once a limit is set | §Metafield Contract (`limit: null` = observe-only, D-02 null-vs-0 encoding) |
</phase_requirements>

## Summary

The highest-stakes question is settled: **writing metafields on Company — even in the app-owned `$app` namespace — requires the same access as mutating the owner resource, i.e. `write_companies`.** There is no metafield-specific scope and no app-owned exemption for merchant resources (the exemption exists only for app-data metafields on your own `AppInstallation`). This means Phase 3 triggers one scope addition → dev-store re-consent + `shopify app deploy` version release (CF-5 byte-guard applies). The good news: `write_companies` is the *only* new scope this phase or Phase 4 needs — the Function reads metafields via its input query with no scope at all.

The contract recommendation is **one JSON metafield**: namespace `$app`, key `credit_v1`, type `json` — a single atomic snapshot the Phase 4 Function parses with one `JSON.parse` inside a try/catch (fail-open on malformed, ENFC-04 alignment). Money travels as decimal strings, `limit: null` vs `"0.00"` carries D-02 natively, and versioning is by key (`credit_v2` would be a new key published alongside, never a mutation of `credit_v1`). A definition is declared in `shopify.app.toml` (`[company.metafields.app.credit_v1]`) so the contract is version-controlled, auto-created on deploy, and visible read-only in the merchant admin — which also answers "where does the contract doc live."

One semantic gap surfaced during codebase verification: D-04 says `data_complete` is false when "the company has ANY order in UNRESOLVED attribution status" — but UNRESOLVED rows always carry `companyId: null` (verified in `upsertOrderFromSource`), so no company ever *has* an UNRESOLVED order. The faithful implementation is **shop-scoped**: any UNRESOLVED net-terms order in the shop flags every company's `data_complete: false`, because the order could belong to any of them. This is the honest reading of D-04's intent and the planner must lock it (see Open Questions — resolved with recommendation).

**Primary recommendation:** add `write_companies`, declare `[company.metafields.app.credit_v1]` in TOML, publish a single JSON snapshot from inside `recomputeCompany` (non-throwing, hash-skipped, `Shop.active`-gated), and drive the Companies page with per-row `useFetcher` + value-echo compare-and-swap on the limit.

## Project Constraints (from CLAUDE.md)

- Use the Shopify AI Toolkit for Shopify API/platform work; do not add tooling to the repo (AGENTS.md).
- Admin GraphQL **2026-07** pinned everywhere; GraphQL only — REST is legacy. Function/webhook/admin versions in lockstep.
- Polaris **web components** via App Bridge CDN only — `@shopify/polaris` React is banned. Live CDN catalog wins over indicative tag names.
- Never hand-roll OAuth/sessions — `@shopify/shopify-app-react-router` + Prisma session storage.
- Metafields (not backend calls) are the server↔Function interface — Functions have no network access for public apps.
- GSD workflow enforcement: file changes only through GSD commands.
- Scope string lockstep: `shopify.app.toml` scopes ↔ Railway `SCOPES` var ↔ `vitest.config.ts` test env (TOML comment is explicit about this).
- CF-5: CLI rewrites TOML on link/dev/deploy — byte-guard the TOML after every CLI call; `automatically_update_urls_on_dev` must stay false.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Limit/bypass CRUD UI (inline table) | Frontend Server (RR7 loader/action, SSR) | Browser (fetcher submissions, edit-mode state) | Embedded admin page; data from local DB via loader — never live GraphQL for render (research SUMMARY architecture) |
| Limit/bypass persistence + validation | API/Backend (RR7 action + Prisma) | — | Server re-validates; value-echo CAS in the WHERE clause |
| Credit-state computation | API/Backend (`recomputeCompany`, unchanged) | — | D-05: sole writer of exposure/overdue/earliestDueAt; this phase only *reads* its output |
| Metafield publishing | API/Backend (new `metafields.server.ts`) | Shopify Admin GraphQL (storage) | Projection of ledger + settings → `metafieldsSet`; Shopify stores it where the Function can reach it |
| Credit state at checkout | Shopify platform (Company metafield) | Phase 4 Function (reader) | The metafield IS the interface; nothing in this phase runs at checkout |
| Metafield verification tooling | Ops scripts (`scripts/`) | Shopify Admin GraphQL | Roadmap: contract must be verifiable on real Company records before Phase 4 |

## The Scope Answer (Question 1 — RESOLVED)

| Question | Answer | Confidence |
|----------|--------|------------|
| Minimal scope to WRITE `$app` metafields on Company via `metafieldsSet` | **`write_companies`.** "Requires the same access level needed to mutate the owner resource. For instance, if you want to set a metafield on a product, you need the same permissions as you would need to mutate a product." [CITED: shopify.dev/docs/api/admin-graphql/2026-07/mutations/metafieldsSet]. The app-owned namespace changes *who else* can touch the metafield, not what scope the owning app needs. No metafield-specific write scope exists for Admin API merchant resources. | HIGH (official mutation doc, unambiguous rule) |
| Does the reserved namespace remove the scope requirement? | **No.** The only scope-free write path is app-data metafields with `ownerId` = your own `AppInstallation` GID — useless here; the Function reads *Company* metafields. | HIGH |
| Do definitions need declaring? | **Not required to write or to Function-read** (metafields can exist definition-less), but **recommended**: TOML-declared definitions are version-controlled, auto-created on `shopify app deploy`, give the value admin visibility (`access.admin = "merchant_read"`), and enforce the `json` type at write time. [CITED: shopify.dev/docs/apps/build/metafields/definitions] | MEDIUM-HIGH |
| Definition creation scope | Same owner-type write scope: "Your app has the appropriate access scopes for the owner type... For example, `write_products` for product metafields" → `write_companies` for Company definitions. [CITED: definitions page] | HIGH |
| What makes the metafield readable from the Phase 4 Function? | **Nothing extra.** The 2026-07 Cart/Checkout Validation input schema exposes `cart.buyerIdentity.purchasingCompany.company.metafield(namespace, key)` (and `location.metafield`) [CITED: shopify.dev/docs/api/functions/latest/cart-and-checkout-validation — `Company.metafield` args `key!, namespace` also byte-verified in local admin schema]. Functions support the `$app` prefix in input queries and resolve it against the function's parent app [CITED: shopify.dev/changelog/shopify-functions-now-support-app-owned-metafields-and-reserved-prefixes]. The access-grant regime (`checkout` access on definitions, PCD notes for company owner types) belongs to **checkout UI extensions**, not Function input queries. | MEDIUM-HIGH (Function-read is Phase 4's empirical gate; contract inputs verified) |
| Re-consent consequence | Adding `write_companies` to `[access_scopes]` = TOML edit + `shopify app deploy` (version release; registry publishes on deploy) + re-consent prompt on the dev store on next admin load (managed installation handles the prompt). Update Railway `SCOPES` and `vitest.config.ts` SCOPES in lockstep — `app/shopify.server.ts` reads `process.env.SCOPES`, so TOML alone changes nothing at runtime [VERIFIED: shopify.app.toml `[access_scopes]` comment block — "Keep this string in lockstep with the Railway SCOPES variable and the test env in vitest.config.ts"]. | HIGH |

**Sequencing implication for the planner:** the scope add + TOML definition + deploy is a Wave-1 prerequisite task (everything else in the phase depends on it), and the CF-5 byte-guard ritual applies to the deploy. A cheap negative probe is free along the way: attempting `metafieldsSet` on Company under the current four read scopes must fail with `userErrors[].code = "APP_NOT_AUTHORIZED"` or top-level ACCESS_DENIED — either way, it proves the error surface (see Write Path).

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@shopify/shopify-app-react-router` | ^1.1.0 (installed) | Admin GraphQL client (offline session) | Already the transport under `graphqlJson` [VERIFIED: package.json] |
| Prisma / `@prisma/client` | ^6.16.3 (installed) | Company schema extension + migration, Decimal money | Existing ORM; `Decimal(19,4)` convention established on Company.exposure [VERIFIED: prisma/schema.prisma] |
| React Router | ^7.12.0 (installed) | Companies route loader/action, `useFetcher` per row | Template framework |
| Polaris web components (App Bridge CDN) | CDN latest | `s-table`, `s-money-field`, `s-switch`, `s-badge`, toasts | Mandated; tag names verified in 03-UI-SPEC + this session |
| Admin GraphQL | 2026-07 (pinned) | `metafieldsSet`, Company metafield reads | Locked project pin |

**No new npm packages are required for this phase.** Hashing for change detection uses Node's built-in `crypto` (`createHash("sha256")`).

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@shopify/api-codegen-preset` | ^2.0.0 (installed) | Types for the new metafieldsSet mutation + verification query | Run `npm run graphql-codegen` after adding documents |
| node `crypto` | built-in | `publishedStateHash` (sha256 of canonical payload minus `computed_at`) | Change detection to skip no-op writes on hourly sweeps |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| One `json` metafield `credit_v1` | Several typed metafields (`money` limit, `boolean` overdue, …) | Typed fields get admin-side type UI, but: multi-key reads are non-atomic at checkout (torn state between writes), `money` type cannot express D-02's null-vs-0 (absence of a metafield is indistinguishable from "never set" only if you *rely* on absence — fragile), more keys to version, and the Function needs N input-query fields instead of 1. JSON wins decisively for a machine-read contract |
| TOML-declared definition | `metafieldDefinitionCreate` mutation (ownerType `COMPANY` — enum verified locally) at install/afterAuth | Mutation path needs idempotent runtime code + re-create on reinstall; TOML is declarative, versioned, auto-created on deploy. Use the mutation only if the TOML owner-type token for company turns out unsupported (see Assumptions A1) |
| Publish inside `recomputeCompany` | Transactional outbox (dirty flag + drain loop) | Outbox is the enterprise answer; at 5–50 companies/shop the inline call (non-throwing, hash-skipped) meets "within seconds" with ~40 fewer lines and no new failure modes. The `publishedAt < recomputedAt` sweep IS the outbox-lite backstop |
| Value-echo CAS on limit | `updatedAt` token CAS | **`updatedAt` CAS is a trap here**: Company.updatedAt is `@updatedAt` and `recomputeCompany` touches the row on every webhook/hourly sweep [VERIFIED: ledger.server.ts:763-771 `db.company.update` writes exposure/overdue/earliestDueAt/recomputedAt], so a merchant would get false staleness rejections whenever ledger churn lands mid-edit. Echoing the rendered `creditLimit` value rejects only when the *limit itself* changed — exactly what UI-SPEC row 12's copy describes |

**Installation:**
```bash
# No new packages. The "install" for this phase is the scope + definition deploy:
#   1. Edit shopify.app.toml: add write_companies + [company.metafields.app.credit_v1]
#   2. shopify app deploy   (version release; byte-guard TOML after)
#   3. Update Railway SCOPES + vitest.config.ts SCOPES in lockstep
#   4. Re-consent on credit-guard-demo.myshopify.com (prompt on next admin load)
```

## Package Legitimacy Audit

No external packages are installed in this phase. **Packages removed due to [SLOP] verdict:** none. **Packages flagged as suspicious [SUS]:** none.

## Metafield Contract (Question 2 — RESOLVED; planner locks)

### Namespace / key / type

| Property | Value | Rationale |
|----------|-------|-----------|
| Namespace (as written/read by this app and the Function) | `$app` | Reserved shorthand; the API stores it fully-qualified as `app--{api-client-id}` and both Admin API and Function input queries accept the literal `$app` [CITED: shopify.dev/docs/apps/build/metafields/manage-metafields — "$app… automatically convert this to a fully qualified reserved namespace like app--{your-app-id}[--{optional-namespace}]"]. Never hard-code the `app--…` long form: it is NOT supported in some surfaces and couples code to the client id |
| Key | `credit_v1` | Version-in-key. A breaking change ships as `credit_v2` written *alongside* `credit_v1` until the Phase 4+ Function fleet reads v2 — the D-04 one-way-door mitigation |
| Type | `json` | One atomic snapshot; Function does `JSON.parse` in try/catch → malformed = fail open (ENFC-04) |
| Owner | Company (`gid://shopify/Company/…` = `Company.companyGid` already stored) | Function reads `purchasingCompany.company.metafield`. CompanyLocation granularity is a v2 concern; the ledger is company-keyed (D-03, Phase 2) |
| Definition | `[company.metafields.app.credit_v1]` in shopify.app.toml, `type = "json"`, `access.admin = "merchant_read"` | Merchant can *see* (not edit) the value on the Company page — satisfies the roadmap "verifiable on real Company records" and gives support a debugging window. Merchant editing is explicitly excluded: the app is the sole writer |

### Payload shape (v1 — the ONLY server↔Function interface)

```jsonc
{
  "v": 1,                                  // integer schema version inside the payload too (cheap belt+braces)
  "limit": "5000.00",                      // decimal STRING in store currency, or null = observe-only (D-02).
                                           //   "0.00" is valid and means block-all (D-02)
  "exposure": "1874.95",                   // decimal string; recomputeCompany output verbatim (D-05)
  "currency": "USD",                       // store currency code from the ledger rows
  "overdue": true,                         // Company.overdue (recomputeCompany output)
  "bypass": false,                         // Company.bypassEnforcement (merchant setting)
  "data_complete": true,                   // D-04 — see semantics below
  "computed_at": "2026-08-19T22:10:00.000Z" // ISO-8601 UTC; recomputedAt of the state being published
}
```

Rules the planner must lock as contract law:
- **Money is decimal strings, never JSON numbers** — floats corrupt cents; the Function compares with a tiny string-decimal parse, and `Prisma.Decimal.toFixed(2)` produces the string.
- **`limit: null` ≠ `"0.00"`** — the entire D-02 distinction rides on JSON null vs string zero.
- **Unknown fields must be ignored by readers** — additive evolution without a version bump.
- **Field removal/rename = new key (`credit_v2`)**, never an in-place change (D-04 reversibility).
- Size: payload ≈ 200 bytes — every limit (25 metafields/call, 10MB request [CITED: metafieldsSet doc]; per-value limits) is orders of magnitude away. [ASSUMED: per-value json cap ~64KB–2MB depending on type — irrelevant at this size, not re-verified]

### `data_complete` semantics (gap found — recommendation, planner locks)

**Verified fact:** UNRESOLVED rows always have `companyId: null` — attribution kind `"unresolved"` writes `{ companyId: null, attributionStatus: "UNRESOLVED", companyLocationGid: null }`, and rows created without attribution evidence default the same way [VERIFIED: app/services/ledger.server.ts:657-663 —

```ts
} else if (attribution?.kind === "unresolved") {
  attributionFields = {
    companyId: null,
    attributionStatus: "UNRESOLVED",
    companyLocationGid: null,
  };
}
```

— and the create-default at :672-678 `...(attributionFields ?? { companyId: null, attributionStatus: "UNRESOLVED", companyLocationGid: null })`]. Therefore "the company has ANY order in UNRESOLVED status" is literally unrepresentable per-company: an UNRESOLVED order belongs to no company *yet*, and could resolve to any of them.

**Prescription:** `data_complete` is **shop-scoped, applied to every company**:

```
data_complete(shop) = NOT EXISTS (LedgerOrder WHERE shop = ? AND attributionStatus = 'UNRESOLVED' AND hasPaymentTerms = true)
```

- Filter to `hasPaymentTerms = true`: a card-paid D2C order stuck UNRESOLVED can never contribute exposure (the `contributes()` gate requires payment terms [VERIFIED: ledger.server.ts:399-403 — `if (!order.hasPaymentTerms) return false;`]), so it must not scare checkouts. This mirrors the existing Sentry-loudness split in `ingestOrderEvent` (net-terms UNRESOLVED warns; D2C stays silent).
- Consequence: one UNRESOLVED net-terms order marks *all* companies incomplete. Honest (it could be any of them) and rare/short-lived (rung-2 misses re-ring within seconds via orders/updated; reconciliation heals within 24h).
- Publish trigger: recompute-driven publishes pick up the current shop-level flag; the empty↔non-empty *transition* for other companies is corrected by the sweep backstop (every company republishes when its hash changes — the flag flips the hash). The planner may optionally add an explicit "republish all on transition" but the sweep makes it eventually consistent within an hour, and the direction of error is conservative-flag-true→false, never a phantom block.
- The UI's per-row "· incomplete" marker (UI-SPEC) renders from the same shop-scoped flag — every row shows it while any net-terms order is unattributed. Copy already reads "Some orders for this company couldn't be fully matched yet" — acceptable; planner may soften to shop-level phrasing if desired (flagged to planner, not a contract change).

### Where the contract doc lives (code_context question — RESOLVED)

Three mutually-reinforcing homes, all durable and Phase-4-reachable:
1. **`shopify.app.toml` definition block** — the machine-enforced half (type, access) rides in git next to the scopes.
2. **`app/services/metafields.server.ts` module contract-doc header** (established service convention) — the payload law: field table, null-vs-0, decimal-string rule, versioning policy. The serializer + TS type live here; this file is the single writer.
3. **A contract test** (`tests/metafield-contract.test.ts`) that locks the exact serialized shape with fixture snapshots — the executable spec Phase 4's Function fixtures are generated from. (Functions build as a separate workspace and cannot import app server code — the test fixtures, not a shared import, are the cross-boundary contract carrier.)

## Write Path (Question 3 — RESOLVED)

### Mutation shape (byte-verified against local 2026-07 schema)

```graphql
#graphql
mutation PublishCompanyCredit($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id key namespace updatedAt }
    userErrors { field message code elementIndex }
  }
}
```

Variables:
```json
{ "metafields": [{
  "ownerId": "gid://shopify/Company/123",
  "namespace": "$app",
  "key": "credit_v1",
  "type": "json",
  "value": "{\"v\":1,\"limit\":\"5000.00\", ... }"
}] }
```

[VERIFIED: app/types/admin-2026-07.schema.json — `metafieldsSet` takes single arg `metafields`; `MetafieldsSetInput` fields exactly `compareDigest, key!, namespace, ownerId!, type, value!`; payload fields `metafields, userErrors`; `MetafieldsSetUserError` fields `code, elementIndex, field, message`; error codes include `APP_NOT_AUTHORIZED, INVALID_COMPARE_DIGEST, STALE_OBJECT, INVALID_VALUE, INVALID_TYPE, TOO_LONG, INTERNAL_ERROR`.]

Facts:
- **25 metafields max per call, 10MB request, atomic** ("no changes are persisted if an error is encountered") [CITED: metafieldsSet doc]. This phase writes 1 per company per publish; batching only matters if the planner adds a bulk-republish task (backfill/all-companies sweep) — chunk by 25 there.
- **`compareDigest`** exists for optimistic-concurrency writes (`STALE_OBJECT`/`INVALID_COMPARE_DIGEST` codes) — **skip it**: this app is the sole writer of `$app` metafields by construction; a lost race with itself is impossible when publishes are serialized per company through `recomputeCompany` call sites. Note it for the future; don't add read-before-write round trips.
- **Error surface — the part `graphqlJson` does NOT cover:** `graphqlJson` throws `LedgerGraphqlError` on non-empty top-level `errors[]` [VERIFIED: ledger.server.ts:185-207] — that catches transport/scope/throttle failures. But `userErrors` arrive inside `data` with a 200 and empty `errors[]`. The publisher MUST explicitly check `data.metafieldsSet.userErrors.length > 0` and treat it as failure (Sentry + leave dirty). A scope regression surfaces as `APP_NOT_AUTHORIZED` in userErrors or as top-level ACCESS_DENIED depending on failure point — handle both.
- **Rate limits:** standard cost-based GraphQL throttle; a single metafieldsSet is ~10 points against a 2000-point bucket. At ICP scale (≤50 companies, webhook-frequency publishes) this is noise. Hash-skip (below) keeps hourly sweeps from writing 50 no-op metafields/shop/hour. [ASSUMED: exact cost figure — bucket math not re-verified; irrelevant at this volume]

### Publish wiring (recommendation: inline hook inside `recomputeCompany` + sweep backstop)

Success criterion 3 is a latency promise ("within seconds"). Every state change already funnels through `recomputeCompany` — webhooks (`refetchOrderAndRecompute`, `ingestOrderEvent`), the hourly overdue sweep (`overdueSweep` → `recomputeCompany` [VERIFIED: scheduler.server.ts:259-262]), and reconciliation [VERIFIED: reconciliation.server.ts:398-400, 490]. Hooking publish there covers all triggers with ONE seam and preserves D-05 by construction:

1. New `app/services/metafields.server.ts` exports `publishCompanyCreditState(shop, companyId)`:
   - Reads the Company row (post-recompute: exposure/overdue/limit/bypass/recomputedAt) + shop-level `data_complete` query.
   - Serializes the payload canonically (stable key order), computes `sha256` over the payload **minus `computed_at`**.
   - If hash === `Company.publishedStateHash` and `publishedAt ≥ recomputedAt` → skip (no API call).
   - Else `metafieldsSet` via `graphqlJson` (label `"PublishCompanyCredit"`), check userErrors, then persist `publishedStateHash` + `publishedAt`.
   - **Gated on `Shop.active`** (established rule: scheduler gates on Shop.active; publishing must respect the same) and **never throws to its caller** — catch → `Sentry.captureException` → return. Rationale: a metafield API blip must not 500 a webhook whose ledger work already committed; a 500 would make Shopify redeliver, the receipt would dedupe, and the publish would never retry. The dirty marker (`publishedAt < recomputedAt`) + hourly sweep is the retry.
2. `recomputeCompany` calls it after its `db.company.update`, outside any transaction. Settings mutations (limit/bypass) call `recomputeCompany` after their own DB write — one code path, ledger numbers refresh for free, publish carries the new settings.
3. Backstop: the hourly sweep already recomputes → republishes anything with a changed hash; additionally a cheap `publishedAt < recomputedAt` scan catches swallowed failures. This is the "outbox-lite" — no new infra.

Test-seam note for the planner: existing suites `vi.mock` `admin-client.server.ts` and call `recomputeCompany` extensively — adding a publish call inside it means those mocks will receive metafieldsSet calls. Plan for: (a) the mock returning a benign metafieldsSet success by default, or (b) publish extracted behind an injectable hook — planner's choice; (a) is less machinery and also asserts publish-on-recompute everywhere for free.

## Settings Mutations (Question 4 — RESOLVED)

- **Route:** `app/routes/app.companies.tsx` (loader: Companies + shop-level data_complete + backfill status; action: intent-dispatched mutations). Nav item added in `app.tsx` per UI-SPEC.
- **Fetcher per row:** one `useFetcher()` keyed per company row for the limit editor, a separate one for the switch. Fetchers give per-row in-flight state (`fetcher.state !== "idle"` disables the field/switch per UI-SPEC) without global navigation. Post-action revalidation re-renders rows from loader data — the UI-SPEC "confirmed, not optimistic" model for limits; the switch is optimistic with revert-on-error (fetcher data carries success/failure). [ASSUMED: standard RR7 pattern — training knowledge; no doc fetch needed, it is the framework's documented idiom]
- **Intents:** `set-limit` (value: decimal string or "" for null, plus `previousLimit` echo), `set-bypass` (checked boolean). Server validates intent whitelist.
- **Staleness rejection (limit only) — value-echo CAS:**
  ```ts
  const result = await db.company.updateMany({
    where: { id, shop, creditLimit: previousLimit === null ? null : new Prisma.Decimal(previousLimit) },
    data: { creditLimit: nextLimit },
  });
  if (result.count === 0) return { ok: false, code: "stale" }; // UI: exit edit, revalidate, toast row 12
  ```
  Atomic CAS in the WHERE clause; `count === 0` = the rendered value no longer matches. Why not `updatedAt` token: `@updatedAt` is touched by every `recomputeCompany` (hourly sweep + any webhook), producing false staleness during routine ledger churn — the value echo only trips when the *limit* changed, which is what the copy promises. Prisma `null` equality in `where` works for nullable Decimal columns. Bypass toggle: plain `update`, last-write-wins (UI-SPEC explicitly allows).
- **Decimal handling:** input arrives as a string; validate with `^\d{1,13}(\.\d{1,2})?$` (non-negative enforced by grammar; 13 integer digits keeps far inside `Decimal(19,4)`), then `new Prisma.Decimal(value)`. Empty string ⇒ `null` (remove limit — UI-SPEC saves null on empty). Never `parseFloat`. Server-side re-validation is mandatory (client `min="0"` is advisory).
- **After DB write:** call `recomputeCompany(shop, companyGid)` → publishes the metafield with the new limit/bypass within the same request (the "within seconds" path for settings changes). Action returns after publish attempt (publish is non-throwing, so a metafield blip still returns success for the DB write — the sweep heals the metafield; planner may choose to surface publish failure in the response instead, but the DB is the source of truth and the metafield is a projection).

## Schema (Question 5 — RESOLVED)

```prisma
model Company {
  // ... existing fields unchanged ...
  creditLimit        Decimal?  @db.Decimal(19, 4)          // null = observe-only (D-02)
  bypassEnforcement  Boolean   @default(false)             // D-03
  publishedStateHash String?                               // sha256 of last-published payload (minus computed_at)
  publishedAt        DateTime?                             // when credit_v1 was last successfully written
}
```

- `creditLimit` nullable **without default** — null IS the observe-only default (CRED-04); `Decimal(19,4)` matches `exposure` [VERIFIED: prisma/schema.prisma Company.exposure `@db.Decimal(19, 4)`].
- Migration: one `prisma migrate dev` (name suggestion: `add_company_credit_controls`), applied to `creditguard_dev` + `creditguard_test` (pretest hook auto-applies to test DB [VERIFIED: package.json pretest]) + prod via release-phase `prisma migrate deploy` (existing pattern). All columns nullable/defaulted ⇒ zero-downtime additive migration.
- No new indexes needed: the Companies page lists per shop (existing `@@unique([shop, companyGid])` covers), the dirty-scan `publishedAt < recomputedAt` is a ≤50-row per-shop scan.

## UI Components (Question 6 — RESOLVED THIS SESSION)

| Flag from UI-SPEC | Resolution | Confidence |
|--------------------|-----------|------------|
| `s-badge` tone enum | **Exact enum: `"info" | "success" | "warning" | "critical" | "auto" | "neutral" | "caution"`, default `auto`; size `"base" | "large" | "large-100"`; color `"base" | "strong"`.** There is **NO `attention` tone** in the app-home catalog. UI-SPEC's semantic "attention without alarm" for **"Enforcement bypassed" maps to `tone="caution"`**. Overdue = `critical`, Over limit = `warning` (both exist verbatim). | HIGH [CITED: shopify.dev/docs/api/app-home/web-components/feedback-and-status-indicators/badge — enum quoted verbatim from live page] |
| `s-money-field` currency behavior | Component exists with `label, value (string), min, max (number), error, disabled, placeholder, required, defaultValue, readOnly, name, details, labelAccessibilityVisibility ("visible"|"exclusive")`; events `change/input/blur/focus`. **No `currency`/`currencyCode` property — "The component formats currency based on the merchant's store currency and locale"** automatically. So the UI-SPEC fallback (s-number-field + currency in `details`) is NOT needed; keep it documented as the escape hatch if scaffold-time rendering surprises. | MEDIUM-HIGH [CITED: shopify.dev/docs/api/app-home/polaris-web-components/forms/moneyfield] |

Canonical app-home component URL base observed this session: `shopify.dev/docs/api/app-home/web-components/<category>/<component>` (the `polaris-web-components/feedback/badge` path 404s — executors should use the `web-components` path family when checking the live catalog).

## Reserved Namespace Reality Check (Question 7 — RESOLVED)

- `$app` is the reserved shorthand; on write the API stores the fully-qualified namespace **`app--{your-app-id}[--{optional-namespace}]`** (e.g. `$app:credit` → `app--123456--credit`). [CITED: shopify.dev/docs/apps/build/metafields/manage-metafields via search excerpt — "The API will automatically convert this to a fully qualified reserved namespace like app--{your-app-id}[--{optional-namespace}]"]
- **No install-time grant exists or is needed** for the owning app: reservation is enforced by namespace ownership itself (only the owning app can write its `app--{id}` namespaces; "Public access for app owned metafields... is now disabled" for other apps — Shopify staff [CITED: community.shopify.dev/t/36588]). The earlier project-research phrase "requested at install" was imprecise — nothing is requested; the namespace is intrinsically yours. What IS needed at install is the ordinary `write_companies` scope consent.
- **The Function will query the literal string `$app`** — `metafield(namespace: "$app", key: "credit_v1")` — resolved against the Function's parent app automatically. Never embed the numeric long form; it's unsupported in some surfaces and breaks if compared literally. [CITED: functions changelog + checkout metafields docs]
- Plain `$app` (no `:suffix`) is the recommended namespace here — one app, one credit contract; suffixes add nothing.
- Uninstall behavior worth recording for FOUND-03 docs: uninstall deletes app-owned **definitions**; values are retained for an unguaranteed window and reassociated on reinstall; definitions get new GIDs (always address by owner+namespace+key, never by definition GID). [CITED: community.shopify.dev/t/36588 — Shopify staff answer]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Optimistic concurrency on limit edits | Version-counter column + custom lock table | Prisma `updateMany` value-echo CAS in WHERE | One query, atomic, zero schema noise |
| Metafield write concurrency vs other apps | compareDigest read-modify-write loop | `$app` reserved namespace (sole-writer by platform rule) | Platform already guarantees exclusivity |
| Money input parsing | `parseFloat`/`Number` + rounding | String regex validation → `Prisma.Decimal` | Float cents corruption; Decimal is already the ledger convention |
| Currency display formatting | Custom formatter | `Intl.NumberFormat` (UI-SPEC locked) + `s-money-field` auto-formatting | Locale/currency matrices are a solved problem |
| Publish retry infrastructure | Queue/outbox table + worker | `publishedAt < recomputedAt` scan in the existing hourly sweep | The sweep already exists, is lease-guarded, and gates on Shop.active |
| GraphQL request typing | Hand-written response interfaces | `#graphql` documents + `npm run graphql-codegen` | The Phase 2 typo trap is documented history; codegen validates every field against admin-2026-07.schema.json |

**Key insight:** this phase's entire novelty is ~2 small services + 1 route; every hard sub-problem (concurrency, retries, typing, currency) has an already-in-repo or platform-native answer. New infrastructure is the failure mode.

## Common Pitfalls

### Pitfall 1: Trusting `errors[]` alone on metafieldsSet
**What goes wrong:** publish "succeeds" (200, no errors[]) while `userErrors` reports `INVALID_VALUE`/`APP_NOT_AUTHORIZED` — metafield silently never written; Phase 4 later fail-opens forever.
**Why it happens:** `graphqlJson` only throws on top-level `errors[]` [VERIFIED: ledger.server.ts:196-204].
**How to avoid:** publisher checks `userErrors.length` explicitly; contract test asserts a userErrors fixture raises/Sentries.
**Warning signs:** `publishedAt` never advances; dev-store verification query returns null metafield.

### Pitfall 2: `updatedAt`-token staleness CAS
**What goes wrong:** merchants get "updated by someone else" while editing, with no other human in sight.
**Why it happens:** `@updatedAt` moves on every recompute (webhooks, hourly sweep) — ledger churn ≠ limit change.
**How to avoid:** value-echo CAS on `creditLimit` only (§Settings Mutations).
**Warning signs:** staleness toast frequency correlates with webhook volume.

### Pitfall 3: Publish failure 500s the webhook
**What goes wrong:** metafield API blip → publish throws inside webhook handling → 500 → Shopify redelivers → receipt dedupes → ledger fine but publish never retried; or worse, retry storm.
**How to avoid:** publish is non-throwing (Sentry + dirty state); sweep is the retry channel.
**Warning signs:** Sentry `PublishCompanyCredit failed` without matching later success; `publishedAt < recomputedAt` rows persisting >1h.

### Pitfall 4: Scope-string drift after adding write_companies
**What goes wrong:** TOML updated but Railway `SCOPES`/vitest env not — the running app never requests the scope; every publish dies `APP_NOT_AUTHORIZED` in prod while tests pass (or vice versa).
**How to avoid:** the TOML comment's lockstep rule is a checklist item in the scope task; a source-guard-style test can assert `process.env.SCOPES` contains `write_companies` when the publisher module is under test.
**Warning signs:** works on dev store, fails on Railway.

### Pitfall 5: CLI rewrites the TOML during the deploy (CF-5)
**What goes wrong:** `shopify app deploy`/`config link` rewrites `shopify.app.toml` (re-pins api_version to the RC, reorders keys, resets `automatically_update_urls_on_dev`).
**How to avoid:** byte-guard: `git diff shopify.app.toml` after every CLI invocation; only the intended scope + metafields lines may change.
**Warning signs:** any unexpected TOML hunk.

### Pitfall 6: Encoding money as JSON numbers in the contract
**What goes wrong:** `"limit": 5000.1` round-trips as float in the Function's JS runtime; comparisons drift by cents; a $0.01 phantom over-limit blocks a checkout (the exact catastrophe this app exists to prevent, inverted).
**How to avoid:** decimal strings end-to-end; contract test locks the serialized form.

### Pitfall 7: Renaming/removing contract fields after Phase 4 ships
**What goes wrong:** deployed Functions on merchant checkouts parse `credit_v1`; a field rename breaks live validation (D-04 one-way door).
**How to avoid:** additive-only within `credit_v1`; breaking = `credit_v2` alongside; the contract-doc header states this in bold.

## Code Examples

### Publisher core (metafields.server.ts sketch — names codegen-validated)
```ts
// Source: metafieldsSet shape verified against app/types/admin-2026-07.schema.json this session
const PUBLISH_COMPANY_CREDIT_MUTATION = `#graphql
  mutation PublishCompanyCredit($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key namespace updatedAt }
      userErrors { field message code elementIndex }
    }
  }
`;

export function serializeCreditState(input: {
  limit: Prisma.Decimal | null; exposure: Prisma.Decimal; currency: string;
  overdue: boolean; bypass: boolean; dataComplete: boolean; computedAt: Date;
}): string {
  return JSON.stringify({
    v: 1,
    limit: input.limit === null ? null : input.limit.toFixed(2),
    exposure: input.exposure.toFixed(2),
    currency: input.currency,
    overdue: input.overdue,
    bypass: input.bypass,
    data_complete: input.dataComplete,
    computed_at: input.computedAt.toISOString(),
  });
}

// inside publishCompanyCreditState — after Shop.active gate and hash-skip:
const body = await graphqlJson<PublishCompanyCreditMutation>(shop,
  PUBLISH_COMPANY_CREDIT_MUTATION, {
    variables: { metafields: [{
      ownerId: company.companyGid, namespace: "$app", key: "credit_v1",
      type: "json", value,
    }]},
    label: "PublishCompanyCredit",
  });
const userErrors = body.data?.metafieldsSet?.userErrors ?? [];
if (userErrors.length > 0) throw new MetafieldPublishError(shop, userErrors); // caught by the non-throwing wrapper
```

### Dev-store verification query (extend scripts/prod-ledger-state pattern)
```graphql
#graphql
query CompanyCreditMetafield($id: ID!) {
  company(id: $id) {
    id
    name
    metafield(namespace: "$app", key: "credit_v1") { value updatedAt type }
  }
}
```
[VERIFIED: `Company.metafield(key!, namespace)` args exist in local 2026-07 schema; readable under existing `read_companies`.]

### Value-echo CAS action fragment
```ts
// previousLimit: string | null echoed from the rendered row (form hidden field)
const where = {
  id: companyId, shop,
  creditLimit: previousLimit === null ? null : new Prisma.Decimal(previousLimit),
};
const { count } = await db.company.updateMany({ where, data: { creditLimit: next } });
if (count === 0) return data({ ok: false, code: "stale" as const }, { status: 409 });
await recomputeCompany(shop, companyGid); // republishes with the new limit
```

### TOML additions (scope + definition)
```toml
[access_scopes]
scopes = "read_orders,read_all_orders,read_payment_terms,read_companies,write_companies"

# App-owned Company credit contract (Phase 3, D-04). $app namespace, key credit_v1.
# THE server<->Function interface — see app/services/metafields.server.ts header.
[company.metafields.app.credit_v1]
name = "Credit Guard credit state"
description = "Machine-read credit state published by Credit Guard. Do not edit."
type = "json"
access.admin = "merchant_read"
```
[ASSUMED: the `company` owner-type token in TOML — see Assumptions A1; the `[<owner_type>.metafields.app.<key>]` grammar and access values are CITED from the definitions doc, but no official example with `company` was found this session. Fallback if deploy validation rejects it: `metafieldDefinitionCreate(definition: { ownerType: COMPANY, namespace: "$app", key: "credit_v1", type: "json", ... })` — mutation + `COMPANY` enum byte-verified in the local schema.]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Private metafields (`metafieldStorefrontVisibility`, private namespaces) | App-owned `$app` reserved namespaces | 2023 (private metafields sunset) | `$app` is the only sanctioned private-to-app channel |
| `metafieldDefinitionCreate` at runtime | Declarative TOML definitions, created on deploy | 2024–2025 rollout | Contract rides in git; no install-time definition code |
| Functions read only function-owner config metafields | `$app` prefix supported in any Function input query (incl. Company via purchasingCompany) | Changelog "Functions now support app-owned metafields and reserved prefixes" | Enables exactly this app's architecture |
| Other apps could read app-owned metafields in some surfaces | "Public access for app owned metafields and metaobjects is now disabled" (Shopify staff) | 2025–2026 | Contract is genuinely private; no cross-app tampering vector |
| Polaris React `Badge status="attention"` | app-home `s-badge` tone enum without `attention` (`caution` is the analogue) | Polaris web components catalog | UI-SPEC's indicative `attention` must land as `caution` |

**Deprecated/outdated:** `purchase.validation.run` target naming (old tutorials); `@shopify/polaris` React; REST metafield endpoints — all already banned in CLAUDE.md.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | TOML declarative definitions accept `company` as `<owner_type>` (docs show the grammar + say "see MetafieldOwnerType" but no company example found; `COMPANY` enum verified in Admin schema) | TOML additions | Deploy validation rejects the block → fall back to `metafieldDefinitionCreate` (verified to exist); 30-minute detour, no design change. Planner: make the definition task verify-on-deploy explicitly |
| A2 | Function input queries need no access grant to read the SAME app's `$app` Company metafields (changelog + "Function APIs provide access to the owner and its metafields"; the grant/PCD regime found only in checkout **UI extension** docs) | Scope Answer | Phase 4 discovers a needed grant → definition/TOML addition then, contract unchanged. De-risked by Phase 4's planned empirical input-query gate |
| A3 | metafieldsSet cost ≈ 10 points; per-value json size cap far above ~200B payload | Write Path | None at ICP scale (≤50 companies/shop) |
| A4 | RR7 per-row `useFetcher` + revalidation pattern as described (framework idiom from training; not re-fetched this session) | Settings Mutations | Cosmetic refactor only; contract behaviors (explicit save, CAS, revert-on-error) are UI-SPEC law regardless |
| A5 | `s-money-field` auto-detects store currency correctly inside the embedded admin (doc says store currency + locale; not visually confirmed) | UI Components | UI-SPEC's documented fallback (s-number-field + currency code in `details`) — scaffold-time visual check already mandated by UI-SPEC hard rule 4 |
| A6 | Managed-installation re-consent for the added scope happens via prompt on next admin load after version release (matched Phase 2's read_all_orders experience) | Scope Answer | Merchant-facing timing only; dev store is ours |

## Open Questions

1. **`data_complete` granularity under D-04's per-company wording** — **RESOLVED (recommendation):** shop-scoped `NOT EXISTS(UNRESOLVED ∧ hasPaymentTerms)` applied to every company, because UNRESOLVED rows verifiably carry `companyId: null` (unrepresentable per-company). Planner locks this; it is an *interpretation* of D-04, not a contract change — the field name, type, and Phase 4 read semantics are untouched.
2. **TOML `company` owner-type token (A1)** — RESOLVED-with-fallback: primary path TOML, verified at deploy; fallback mutation is schema-verified. No planning blocker.
3. **Republish-all on `data_complete` transitions** — open, low stakes: inline publishes carry the current flag; other companies' flags heal at the next hourly sweep (hash change forces write). Planner may add an explicit fan-out on transition if the 1-hour tail is deemed too long for an advisory flag whose stale direction is conservative (`false` lingering, never phantom `true`).
4. **Should the settings action surface publish failure to the merchant?** — open, planner's call: DB write is the source of truth; recommended: return success for the DB write, rely on Sentry + sweep for the projection (matches "metafield is a projection" doctrine), and keep UI copy honest (no publish claims in toasts — current copy already qualifies).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | v22.20.0 | — |
| npm | scripts | ✓ | 10.9.3 | — |
| PostgreSQL (local) | dev/test DBs | ✓ (accepting connections) | creditguard_dev + creditguard_test present | — |
| Shopify CLI | deploy (scope + definition release) | ✓ via `npm run shopify` (package.json script; standalone binary not on PATH in probe shell) | template-pinned | `npm run deploy` |
| graphql-codegen + admin-2026-07.schema.json | typed documents | ✓ | schema file present (6.9MB, 2026-07) | — |
| Dev store (B2B) | re-consent + metafield verification | ✓ credit-guard-demo.myshopify.com (canonical since 2026-08-19) | — | — |
| Railway prod | SCOPES var update, deployed verification | ✓ (Phase 2 live-proven) | — | — |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.10 (installed) |
| Config file | `vitest.config.ts` (node env, `tests/**/*.test.ts`, fileParallelism false, creditguard_test isolation, committed dummy SHOPIFY_API_SECRET) |
| Quick run command | `npx vitest run tests/<file>.test.ts` |
| Full suite command | `npm test` (pretest applies migrations to creditguard_test; suite currently 235 green) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CRED-01 | set/edit/remove limit; value-echo CAS staleness; validation (negative/format/empty⇒null) | integration (action + Prisma) | `npx vitest run tests/companies-settings.test.ts` | ❌ Wave 0 |
| CRED-02 | bypass toggle persistence; last-write-wins; Shop.active untouched | integration | `npx vitest run tests/companies-settings.test.ts` | ❌ Wave 0 |
| CRED-03 | payload shape lock (null-vs-0, decimal strings, data_complete, computed_at); publish-on-recompute; hash-skip; userErrors surfaced; non-throwing into webhook path; Shop.active gate; dirty-sweep backstop | unit + integration (mocked admin seam) | `npx vitest run tests/metafield-contract.test.ts tests/metafield-publish.test.ts` | ❌ Wave 0 |
| CRED-04 | fresh company ⇒ `limit: null` published; observe-only rendering states | unit + integration | covered across the three files above | ❌ Wave 0 |
| — (regression) | recomputeCompany sole-writer + scheduler/webhook suites stay green with publish hook added | existing suites | `npm test` | ✅ exists (235 tests) |

Manual-only (justified): visual UAT items from UI-SPEC backstops (badge tones distinct, edit-mode cell layout, money-field currency symbol) — rendering inside the Shopify admin iframe is not automatable in this harness; end-of-phase `human_verify_mode` covers them. Live metafield inspection on the dev store (roadmap gate) is scripted (`scripts/` extension) but requires the deployed app + real store — end-of-phase verification, not per-commit.

### Sampling Rate
- **Per task commit:** `npx vitest run tests/<touched-area>.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** full suite green + dev-store metafield inspection query returns a parseable `credit_v1` on a real Company before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/metafield-contract.test.ts` — serialized-shape snapshot lock (CRED-03/04, D-02, D-04)
- [ ] `tests/metafield-publish.test.ts` — publish wiring, hash-skip, error surfaces (CRED-03)
- [ ] `tests/companies-settings.test.ts` — action intents, CAS, validation (CRED-01/02)
- [ ] Existing-mock adaptation: default metafieldsSet success response in the `admin-client.server.ts` mock factory so 235 existing tests stay green with the publish hook live
- Framework install: none needed

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `authenticate.admin(request)` on the Companies loader/action (template session-token auth — already the pattern in app.tsx routes); never trust shop from form data — derive from session |
| V3 Session Management | yes | Offline sessions via Prisma storage (existing); no new session surface |
| V4 Access Control | yes | Every Prisma WHERE includes `shop` (established shop-domain keying convention); CAS WHERE includes `shop` — a forged companyId from another shop matches zero rows |
| V5 Input Validation | yes | Server-side regex + Decimal validation for limit; intent whitelist in the action; boolean coercion for bypass; never interpolate input into GraphQL (variables only — `graphqlJson` pattern) |
| V6 Cryptography | no (hash is non-security change detection) | Node `crypto` sha256 — not a secret, not auth |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-shop mutation (companyId of another shop's row) | Elevation of privilege | `shop` from authenticated session in every WHERE; test asserts count 0 on cross-shop id |
| Merchant tampering with the credit metafield via admin | Tampering | `access.admin = "merchant_read"` on the definition; app-owned namespace blocks other apps outright |
| CSRF on settings action | Tampering | Embedded-app session token auth on actions (App Bridge fetch carries the token; `authenticate.admin` rejects otherwise) |
| Limit value injection ("1e9", "-0", "NaN", "1,000") | Tampering | Grammar-first validation before Decimal construction; reject rather than coerce |
| Publish path leaking tokens in logs | Information disclosure | Reuse `graphqlJson` (no URL/token logging); note WINDOWS #8 (access-log id_token leak) remains open Phase-2 carry-forward — do not add new logging of request URLs |

## Sources

### Primary (HIGH confidence)
- `app/types/admin-2026-07.schema.json` (local, the codegen source of truth) — metafieldsSet/MetafieldsSetInput/userError codes, `Company.metafield(key!, namespace)`, `MetafieldOwnerType.COMPANY`, `metafieldDefinitionCreate` — byte-verified via introspection script this session
- Repo source: `app/services/ledger.server.ts` (graphqlJson throw semantics :185-207, recomputeCompany :739-775, unresolved attribution :657-678, contributes() :399-403), `app/services/scheduler.server.ts` (:259-262), `app/services/reconciliation.server.ts` (:398-400), `prisma/schema.prisma`, `shopify.app.toml`, `vitest.config.ts`, `package.json`
- [metafieldsSet mutation (2026-07)](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/metafieldsSet) — owner-mutate scope rule, 25/call, 10MB, atomicity, compareDigest — fetched live
- [s-badge (app-home web components)](https://shopify.dev/docs/api/app-home/web-components/feedback-and-status-indicators/badge) — exact tone enum — fetched live

### Secondary (MEDIUM confidence — official docs, single-fetch)
- [Manage metafield definitions](https://shopify.dev/docs/apps/build/metafields/definitions) — TOML grammar, access values, deploy-time creation, owner-scope rule
- [Custom data ownership](https://shopify.dev/docs/apps/build/custom-data/ownership) — app-reserved namespace concept, merchant_read/merchant_read_write
- [Cart and Checkout Validation Function API](https://shopify.dev/docs/api/functions/latest/cart-and-checkout-validation) — input schema `purchasingCompany.company.metafield(namespace, key)`
- [Metafields for Function input queries](https://shopify.dev/docs/apps/build/functions/input-output/metafields-for-input-queries) — `$app:` prefix syntax in input queries
- [s-money-field](https://shopify.dev/docs/api/app-home/polaris-web-components/forms/moneyfield) — property list, auto store-currency formatting
- [Functions app-owned metafields changelog](https://shopify.dev/changelog/shopify-functions-now-support-app-owned-metafields-and-reserved-prefixes) + [Manage values]( https://shopify.dev/docs/apps/build/metafields/manage-metafields) — `$app` → `app--{id}` resolution (via search excerpts; direct changelog fetch 404'd)
- [Community: app-owned TOML definitions on uninstall/reinstall](https://community.shopify.dev/t/app-owned-toml-metafield-definitions-what-happens-after-uninstall-reinstall/36588) — Shopify-staff answers on retention/GIDs/public-access-disabled

### Tertiary (LOW confidence)
- Search-result synthesis on company/companyLocation PCD notes in checkout **UI extension** metafield docs — flagged as not applicable to Function input queries (A2), verify in Phase 4

## Metadata

**Confidence breakdown:**
- Scope answer: HIGH — official mutation doc rule + definitions doc corroboration; no contradicting source found
- Metafield contract mechanics: HIGH — every field name schema-verified locally; shape choices are judgment on cited constraints
- Write path / error surface: HIGH — userError codes and graphqlJson behavior both verified
- Function readability: MEDIUM-HIGH — input schema field cited; no-grant-needed is A2 (Phase 4 empirically gates it before any merchant impact)
- UI components: HIGH (badge enum quoted verbatim) / MEDIUM-HIGH (money-field currency auto-format not visually confirmed)
- Settings/UX patterns: MEDIUM — framework idioms from training (A4), constrained by the approved UI-SPEC either way

**Research date:** 2026-08-19
**Valid until:** 2026-09-19 (stable surfaces; re-check only if api_version pin moves off 2026-07)
