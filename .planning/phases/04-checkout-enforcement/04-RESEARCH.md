# Phase 4: Checkout Enforcement - Research

**Researched:** 2026-08-20
**Domain:** Shopify Functions — Cart and Checkout Validation API (2026-07), B2B net-terms enforcement
**Confidence:** HIGH on the Function contract and Admin API surface (live docs + official example repo + byte-verified local 2026-07 schema); MEDIUM on plan-gating of alternatives and runtime limits

## Summary

Every load-bearing claim from the earlier LOW-MEDIUM-confidence stack research was re-verified this session against live shopify.dev (reachable again), the official `Shopify/example-checkout--validation--preact` repo, the official `Shopify/function-examples` JS template, and the repo's own byte-authoritative `app/types/admin-2026-07.schema.json`. The target is `cart.validations.generate.run` (2026-07), the input exposes `cart.buyerIdentity.purchasingCompany.company.metafield(...)`, and — the cleanest finding of the session — the Function schema documents that **omitting the `namespace` argument entirely resolves to the app-reserved namespace**, sidestepping the `$app`-literal question. The result shape changed from the old `purchase.validation.run` era: it is now `CartValidationsGenerateRunResult { operations: [{ validationAdd: { errors: [{ message, target }] } }] }` with global target `"$.cart"` — old tutorials using `localizedMessage`/flat `errors` will mislead.

The currency question (priority 1) is settled at the schema level: `cart.cost.totalAmount` is a `MoneyV2` in **presentment currency**, and the input root carries `presentmentCurrencyRate: Decimal!` (shop-default-currency → presentment conversion). No store-currency cart amount exists in the input. Recommended v1 policy: compare integer cents only when `cart.cost.totalAmount.currencyCode === payload.currency`; on mismatch, skip the over-limit comparison (fail open for that rule) **but still enforce the overdue block, which needs no money comparison**. Two more findings force design changes versus prior assumptions: (a) the validation input exposes **no payment-method or payment-terms selection**, so "block only the net-terms path" cannot be done inside the Function — but native B2B checkout with terms collects no payment at checkout anyway, so blocking the checkout of a terms-bearing company *is* blocking the net-terms path (competitors Folio and BizCred do exactly this); (b) `bypassCartValidations` **does not exist in the 2026-07 Admin schema** (verified in the local schema and live `draftOrderComplete` docs) — draft-order bypass is now a merchant admin-UI action ("Ignore all checkout rules"), invisible to the API, so ENFC-05/06 must be implemented as server-side inference on `orders/create`, which the Phase 2 ledger ingest already receives.

**Primary recommendation:** One JS validation function (scaffolded via `shopify app generate extension --template cart_checkout_validation`, TypeScript flavor, Javy-compiled), registered programmatically with `validationCreate(functionHandle, enable: true, blockOnFailure: false)` — `blockOnFailure: false` is the platform-level fail-open knob (schema-verified: "Validation errors always block checkout progress. The `blockOnFailure` field controls whether runtime exceptions, such as timeouts, also block checkout"). Merchant-editable messages live as a JSON metafield on the Validation object, read in-function via `validation.metafield`. This requires one new scope: `write_validations` (re-consent + lockstep update).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Block/allow decision at checkout | Shopify Functions (wasm, Shopify-run) | — | Only server-side, all-plans blocking mechanism; no network, metafield-only input |
| Credit state computation & publishing | API/Backend (existing `recomputeCompany` → `publishCompanyCreditState`) | — | Already built (Phase 3); Function is a pure reader |
| Validation registration & lifecycle | API/Backend (Admin GraphQL `validationCreate`/`validationUpdate`) | Merchant admin UI (Settings → Checkout → Checkout rules) | App-managed via mutation so merchants never hunt through checkout settings; UI path is the manual fallback |
| Merchant-editable block messages (ENFC-03) | API/Backend (writes Validation metafield) + embedded admin settings UI | Shopify Functions (reads `validation.metafield`) | Message is shop-level config; Validation object is its documented home |
| Enforcement event log (ENFC-05/06) | API/Backend (Postgres, driven by orders/create ingest + publish-time state transitions) | — | Blocks are not observable per-attempt; server-side inference is the only implementable path |
| Block UX rendering | Shopify Checkout (native) | — | Shopify renders `errors[].message` at `$.cart`; no UI extension needed |

## Phase Requirements

<phase_requirements>

| ID | Description | Research Support |
|----|-------------|------------------|
| ENFC-01 | Block net-terms path when over limit (prepay stays open) | §Net-Terms Path Detection — validation input has no payment selection; terms-bearing B2B checkout IS the net-terms path; comparator in §Code Examples |
| ENFC-02 | Block net-terms path when overdue | §Reader Decision Table — overdue rule is currency-independent, survives currency mismatch |
| ENFC-03 | Clear, merchant-editable block message | §Merchant-Editable Messages — Validation metafield + `validationUpdate`; function fallback default text |
| ENFC-04 | Fail open for D2C / missing / malformed metafield | §Fail-Open Matrix (9 cases), `blockOnFailure: false`, strict payload validation before any block |
| ENFC-05 | Every block and bypass recorded with order/company/amount | §Enforcement Observability — per-attempt block logging is NOT possible on this platform; honest scoping options given (state-transition events + leaked-order events) |
| ENFC-06 | Orders bypassing validation (draft/admin/POS) still count and are flagged | §Enforcement Observability — ledger already counts them (Phase 2); flagging = orders/create inference on `sourceName` + blocked-state-at-ingest |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- API version **2026-07 everywhere in lockstep** (Admin, Function TOML, webhooks) — extension TOML must pin `api_version = "2026-07"`; CLI may try to rewrite to the 2026-10 RC on link/dev — re-pin if so
- **JS/TS Function via Javy** — no Rust toolchain installed (verified: `cargo` absent); port to Rust only if `function-runner` profiling shows instruction pressure (it will not for this comparator)
- **No network calls from the Function** — `fetch` target exists in the schema (`cart.validations.generate.fetch`) but network access is not available to public apps [ASSUMED — carried from stack research; do not design against it]
- **No `@shopify/polaris` React** — settings UI uses Polaris web components (`s-*`)
- **GraphQL only, never REST**; never interpolate input into GraphQL — variables only (`graphqlJson` pattern)
- Money is **decimal strings, never floats** — Function comparator must use integer cents (payload law rule 1)
- `automatically_update_urls_on_dev = false` must survive any CLI touch of `shopify.app.toml`
- Scope string lockstep: TOML ↔ Railway `SCOPES` ↔ `vitest.config.ts` env ↔ `tests/scope-lockstep.test.ts` — adding `write_validations` touches all four
- GSD workflow entry points for any code changes

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Shopify CLI | 4.6.1 (installed, verified) | `generate extension`, `function typegen/build/run/replay`, `deploy` | Only toolchain for Functions [VERIFIED: `shopify version` → 4.6.1] |
| `@shopify/shopify_function` | 2.0.1 (npm, 2026-04) | JS Function runtime bindings (scaffolded into the extension's own package.json by the CLI) | Official; ships with the template [VERIFIED: npm registry + package-legitimacy OK — 56.5k weekly downloads, Shopify GitHub repo] |
| Cart and Checkout Validation Function API | 2026-07, target `cart.validations.generate.run` | The blocking mechanism | [VERIFIED: live docs at functions/latest/cart-and-checkout-validation state target + 2026-07; example repo TOML uses `target = "cart.validations.generate.run"`, `export = "cart_validations_generate_run"`] |
| Admin GraphQL `validationCreate`/`validationUpdate` | 2026-07 | Programmatic registration + message config | [VERIFIED: app/types/admin-2026-07.schema.json — `Mutation.validationCreate(validation: ValidationCreateInput)`, input fields `blockOnFailure, enable, functionHandle, metafields, title`] |
| vitest | ^4.1.10 (already in repo) | Unit tests for `run()` as a pure function | Official JS template itself ships a vitest `run.test` with plain-object fixtures [VERIFIED: function-examples `src/run.test.liquid`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `shopify app function typegen` | via CLI | Generates `generated/api.ts` types from the function's input query | After every input-query edit |
| `shopify app function run` / `function-runner` | via CLI | Local execution + instruction-count profile | Before every deploy; JSON input piped in |
| `shopify app function replay` | via CLI | Re-run a real logged input locally | The empirical input-inspection tool (see §Empirical Checks) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Validation function blocking checkout | Payment Customization API `paymentTermsSet`/`orderReviewAdd` (target `cart.payment-methods.transform.run`) to force pay-now or require review | Would literally keep card open, but multiple sources say payment-terms setting via functions is **Plus-gated** [ASSUMED — conflicting sources; see Open Questions]; second extension type; weaker guarantee. v2 candidate, not MVP |
| App-managed `validationCreate` | Merchant manually adds rule (Settings → Checkout → Checkout rules → Add rule → Turn on) | Manual path needs no new scope but guarantees onboarding drop-off; keep as documented fallback |
| Message in Validation metafield | Message inside each company's `credit_v1` payload | Message is shop-level; duplicating per company bloats every publish and re-publishes all companies on every copy edit |

**Installation:**
```bash
# no npm installs in the app workspace; the CLI scaffolds the extension with its own package.json
shopify app generate extension --template cart_checkout_validation --name credit-guard-validation
# choose TypeScript flavor at the prompt
```

**Version verification:** `npm view @shopify/shopify_function version` → `2.0.1` (2026-04-16) [VERIFIED: npm registry].

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@shopify/shopify_function` | npm | published 2026-01-30 (v2 line; package years old) | 56,516/wk | github.com/Shopify/shopify-function-javascript | OK | Approved (CLI-scaffolded dependency) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Priority Question Findings

### Q1 — Currency (HIGHEST PRIORITY)

**Facts, all schema-level:**
- `cart.cost.totalAmount` is `MoneyV2 { amount: Decimal!, currencyCode: CurrencyCode! }` in **presentment currency** [CITED: shopify.dev functions/latest/cart-and-checkout-validation — "all monetary values reflect presentment currency"; corroborated by the function schema.graphql from the official example repo].
- The input **root** exposes `presentmentCurrencyRate: Decimal!`: "The exchange rate used to convert discounts between the shop's default currency and the currency that displays to the customer during checkout." [VERIFIED: schema.graphql from Shopify/example-checkout--validation--preact, Input root — fields `buyerJourney, cart, fetchResult, localization, presentmentCurrencyRate, shop, validation` — quoted verbatim from the downloaded schema]
- No store-currency cart amount exists in the input.
- The payload's `currency` is the store currency of the ledger rows (metafields.server.ts rule 5, D-07).

**Recommended decision (planner to lock):**
1. If `cart.cost.totalAmount.currencyCode === payload.currency` → compare directly in integer cents. On a single-currency store (the overwhelming B2B case, incl. the dev store) this is always true.
2. If they differ → **skip the over-limit comparison (fail open for that rule only)**, consistent with ENFC-04's malformed-payload posture. **The overdue block still applies** — it is a boolean, currency-independent. This kills the worst outcome (overdue deadbeat sails through because their cart is in EUR).
3. Do NOT convert via `presentmentCurrencyRate` in v1: the ledger exposure was booked at historical rates, so a converted comparison is approximate in an uncontrolled direction, and division breaks pure integer math. Record as v2 option (buyer-favorable rounding if ever done).
4. Server-side mirror: the publisher already knows each company's ledger currency; a company whose currency ≠ shop default currency can be surfaced on the Phase 6 dashboard as "over-limit enforcement inactive (currency mismatch)" so the hole is visible, not silent.

**Empirical check (before comparator freeze):** see §Empirical Checks, EC-1.

### Q2 — Target + input query shape + `$app`

- Target `cart.validations.generate.run`, export `cart_validations_generate_run` [VERIFIED: example repo TOML, quoted above; live docs page states 2026-07].
- **`$app` resolution is moot: omit the namespace argument.** The function schema's `Company.metafield` doc reads verbatim: *"If omitted, then the [app-reserved namespace](…/custom-data/ownership) is used."* [VERIFIED: schema.graphql `Company implements HasMetafields`, metafield args — `key: String!`, `namespace: String` with that doc string]. The function belongs to the same app that wrote `credit_v1` under `$app`, so `metafield(key: "credit_v1")` with no namespace reads exactly our metafield. `$app`-prefixed namespaces are also supported in function input queries generally [CITED: shopify.dev changelog "Shopify Functions now support app-owned metafields and reserved prefixes"; the official example's input query uses `namespace: "$app:product-limits"` on `validation.metafield`].
- `Metafield` in the function schema exposes both `value: String!` and `jsonValue: JSON!` [VERIFIED: schema.graphql]. Recommend `jsonValue` (no manual `JSON.parse`, no parse-throw path) with strict shape validation in code.
- Input query (see §Code Examples). EC-2 is the empirical gate.

### Q3 — Net-terms path detection

- The validation input contains **no payment-method, payment-terms, or deferred-payment selection** [CITED: functions/latest/cart-and-checkout-validation — no such fields in the input; confirmed by reading the full 5,101-line function schema: no payment types on Cart/BuyerIdentity].
- Native behavior: when a company location has payment terms, checkout collects **no payment** — that checkout IS the net-terms path. The buyer's prepay option is post-order: "B2B customers can log in to customer accounts, select an order, and pay for it by clicking Pay now" [CITED: help.shopify.com/en/manual/b2b/checkout-and-orders/payment-terms]. Deposits (partial pay-at-checkout with terms) are Plus-only [CITED: same page].
- Consequence: blocking the whole checkout of an enforced company is, for terms-bearing locations, **exactly** "blocking the net-terms path." Companies that pay by card at checkout accumulate no net-terms exposure, so they only become blockable if the merchant deliberately sets `limit: "0.00"` (block-all) — the "no other checkout is ever affected" goal largely self-resolves.
- Known limitation to document (not solve) in v1: a company with mixed locations (one on terms, one pay-now) that is over limit will also be blocked at its pay-now location's checkout. The merchant-editable message plus the per-company bypass toggle are the pressure valves.
- Competitors do the same: Folio and BizCred block checkout via a validation function and "prompt the buyer to pay outstanding balances" [CITED: apps.shopify.com listings for folio-credit-ledger and bizcred-b2b via search].
- The literal keep-card-open mechanism would be Payment Customization `paymentTermsSet` (see Alternatives) — Plus-gating unresolved, v2.

### Q4 — Merchant-editable message (ENFC-03)

- Config home: **metafield on the Validation object**. `ValidationCreateInput.metafields` ("Additional metafields to associate to the validation") and `ValidationUpdateInput.metafields` exist [VERIFIED: local 2026-07 schema, input fields listed above]. The function reads it via the input-query root `validation: Validation!` → `metafield(...)` — `Validation implements HasMetafields` [VERIFIED: schema.graphql].
- Official pattern: the example's input query is `validation { metafield(namespace: "$app:product-limits", key: "product-limits-values") { jsonValue } }` [VERIFIED: example repo `cart_validations_generate_run.graphql`, quoted verbatim].
- Recommended shape: one JSON metafield, e.g. key `config_v1`, value `{"v":1,"over_limit_message":"…","overdue_message":"…"}`; our embedded Settings page edits it via `validationUpdate(id, { metafields: [...] })`. The function hard-codes fallback copy when the metafield is absent/malformed (a missing config must never fail closed OR silence the block — fallback text keeps ENFC-01/02 alive).
- Message renders at checkout as plain text on the `$.cart` global target — no HTML, no injection surface beyond text length; cap length server-side.

### Q5 — Reader-side contract decisions (recommendations to lock)

1. **`data_complete: false` → ENFORCE anyway.** UNRESOLVED rows carry `companyId: null` by construction (payload law rule 4), so incomplete data can only **understate** a company's exposure — enforcing against it can under-block but can never falsely block. Suppressing enforcement would be strictly worse (maximal under-block). Record in the Function source: "data_complete is informational; exposure understatement only under-blocks (D-04 decision, Phase 4)."
2. **Integer-cents comparison.** Payload money is exactly 2dp by construction (`Decimal.toFixed(2)`, contract-test-locked). Grammar-check then convert: `limit` must match `/^\d{1,15}\.\d{2}$/` (or null), `exposure` `/^-?\d{1,15}\.\d{2}$/` (refund history can push it negative). Cart `amount` is a Decimal string from Shopify with *unknown* dp — normalize: split on `.`, right-pad/truncate fraction to 2 digits, `Number` the cent value (safe: far below 2^53). **Never `parseFloat`, never float arithmetic.** Add the float-trap fixture: limit `"0.10"`, exposure `"0.00"`, cart `"0.10"` → allow (0.1+0.2 territory).
3. **`computed_at` staleness → informational-only, and this is forced, not chosen:** the wasm runtime is deterministic and has **no clock**; `shop.localTime`'s `dateTimeAfter/Before` helpers take only static literals in the input query, so an age comparison against a metafield value is unrepresentable [VERIFIED: schema.graphql `LocalTime` fields]. Staleness is bounded server-side (webhook latency + hourly publish backstop). Add the "ancient computed_at" case to the matrix as: no effect.
4. **Bypass precedence: `if (bypass === true) return allow` is the FIRST check** — overrides overdue AND over-limit (D-03; prisma schema comment). Restate additively in the metafields.server.ts contract header (allowed under payload-law rule 3).
5. **Over-limit semantics (new decision surfaced this session):** recommend **remaining-credit semantics** — block iff `exposure_cents + cart_total_cents > limit_cents` (subsumes the already-over case; it is what competitors mean by "if a new order exceeds the remaining credit"). Alternative (state-only: block iff `exposure > limit`) lets a company at $1,499.99 of $1,500.00 place a $50,000 order. ENFC-01's wording ("is over its credit limit") permits either; planner should lock remaining-credit and put it in the success-criteria wording. [ASSUMED — product decision, needs user confirmation]

### Q6 — Registration/lifecycle

- `validationCreate` is real in 2026-07 and app-callable: "Creates a cart and checkout validation: a server-side rule enforced before a customer can complete checkout … using `functionId` or `functionHandle`" [VERIFIED: local schema mutation description, quoted]. `enable: true` = "live on the merchant checkout" [VERIFIED: `ValidationCreateInput.enable` description]. Scope: **`write_validations`** [CITED: shopify.dev validationCreate mutation page].
- `blockOnFailure` is the fail-open knob for runtime failures: "Validation errors always block checkout progress. The `blockOnFailure` field controls whether runtime exceptions, such as timeouts, also block checkout." [VERIFIED: local schema `validationUpdate` description, quoted verbatim]. **Set `blockOnFailure: false`** (ENFC-04: never break a storefront sale on our crash).
- Manual path exists and remains the fallback: Settings → Checkout → Checkout rules → Add rule → select function → Turn on [CITED: create-complex-validation-rules tutorial].
- Lifecycle plan: after deploy + (re)auth with the new scope, an idempotent ensure-step queries `validations(first: 50) { nodes { id enabled shopifyFunction { handle appKey } } }`, matches our function handle, creates if absent (`enable: true, blockOnFailure: false, title: "Credit Guard: net-terms credit check"`, config metafield inline), stores the Validation GID per shop. Surface `enabled` on the dashboard — a merchant can toggle the rule off in checkout settings and the app should show that honestly.
- `Query.validations` has no functionHandle filter (`sortKey: ID` only) [VERIFIED: local schema] — filter client-side on `shopifyFunction.handle`/`appKey`.
- Scope consequences: TOML scopes string + Railway `SCOPES` + vitest env + `tests/scope-lockstep.test.ts` all change together; existing install needs re-consent before the ensure-step can run (same dance as Phase 3's `write_companies`). Whether `write_validations` alone also grants the reads (`Query.validations`) is undocumented on the pages fetched — assume yes per Shopify's write-implies-read convention [ASSUMED], and the ensure-step will prove it on the dev store immediately.

### Q7 — ENFC-05/06 observability (honest scoping required)

Hard facts:
- A block produces no order, no webhook, no Admin API record. There is **no validation-run event surface for apps** — `Validation.errorHistory` is `FunctionsErrorHistory` (function *crash* tracking: `errorsFirstOccurredAt`, `hasSharedRecentErrors`), not run/block telemetry [VERIFIED: local schema].
- `bypassCartValidations` (Dec 2024 changelog, on `draftOrderComplete`/`prepareForBuyerCheckout`) **is gone from 2026-07**: `draftOrderComplete` args are exactly `id: ID!, paymentGatewayId: ID, sourceName: String` (+ deprecated `paymentPending`) [VERIFIED: local schema AND live draftOrderComplete latest page — both checked this session]. No identifier containing "bypass" exists anywhere in the 2026-07 schema [VERIFIED: grep over the schema JSON — zero hits].
- Current draft-order behavior: checkout rules apply to draft orders by default; the merchant can choose "Ignore all checkout rules" in the draft-order admin UI [CITED: changelog "draft orders now support delivery and payment method customizations and checkout rules" + help pages, via search — MEDIUM]. That choice is not visible on the resulting Order via API.
- Validation functions do not run for POS (the "checkout validation for POS" changelog is a different native feature — customer-detail collection) [CITED: changelog.shopify.com "checkout validation for pos checkout" — MEDIUM].

Implementable design (recommend planner adopt, and re-scope ENFC-05's wording in success criteria):
1. **Blocked-state transition events** — at publish time the backend knows when a company crosses into/out of blocking state (over-limit per the locked semantics, overdue, bypass flips). Write `EnforcementEvent` rows (company, kind: BLOCK_STATE_ENTERED/EXITED/BYPASS_ENABLED/DISABLED, exposure, limit, timestamps). This is the "blocked $X" feed for DASH-02.
2. **Leaked/bypassed-order events (ENFC-06)** — the orders/create ingest (already live, Phase 2) flags any net-terms order whose company was in blocking state at ingest: `EnforcementEvent(kind: BYPASSED_ORDER, orderGid, amount, channel)`. Channel from the order's source (draft orders arrive as `shopify_draft_order`; POS as `pos`) — these orders already count against balances via the ledger (first half of ENFC-06 is free).
3. **Per-attempt block logging: not possible.** Document as a platform limitation in the plan and in VERIFICATION wording. Do not fake it with abandoned-checkout heuristics (legacy checkout webhooks are not reliable for B2B and add a scope for nothing).

### Q8 — Dev workflow

- Scaffold: `shopify app generate extension --template cart_checkout_validation --name credit-guard-validation`, flavors: Rust (default), JavaScript, TypeScript, Wasm [CITED: create-checkout-validation tutorial — exact command quoted]. Pin the generated TOML to `api_version = "2026-07"` (template currently emits its own default; the repo TOML convention note warns the CLI may push the RC).
- The current JS template in `function-examples` is still on 2025-01/`purchase.validation.run` with the OLD flat result `{ errors: [{ localizedMessage, target }] }` [VERIFIED: function-examples `shopify.extension.toml.liquid` + `run.liquid`, read this session]. The CLI may scaffold either era depending on its bundled templates — **whatever it emits, converge on the 2026-07 shape**: target `cart.validations.generate.run`, result `{ operations: [{ validationAdd: { errors: [{ message, target: "$.cart" }] } }] }`. Error `target` allowed values are enumerated in the docs; the global one is `"$.cart"` [CITED: functions reference "supported checkout field targets" — full list fetched; the Rust example's bare `"cart"` is the older convention, do not copy it].
- Types: `shopify app function typegen` regenerates `generated/api.ts` from the input query — the generated types are the final arbiter of field names at scaffold time.
- Unit tests: the official JS template ships a vitest `run.test` importing `run` and calling it with plain-object inputs [VERIFIED: function-examples `run.test.liquid`]. Our root vitest already includes `tests/**/*.test.ts`; a root-level `tests/checkout-validation-function.test.ts` can import the extension's `run` directly (pure function, no wasm needed) so the suite stays one command. Fixtures must be **generated from the byte-exact strings in `tests/metafield-contract.test.ts`** — e.g. the locked serialization `{"v":1,"limit":"5000.00","exposure":"1874.95","currency":"USD","overdue":false,"bypass":false,"data_complete":true,"computed_at":"2026-08-19T22:10:00.000Z"}` [VERIFIED: tests/metafield-contract.test.ts:66-70, quoted verbatim] — parsed with `JSON.parse` in the fixture builder to produce the `jsonValue` object the input carries.
- Local run + profiling: `shopify app dev` (rebuilds drafts live), `shopify app function run` (pipe JSON input; prints instruction count via function-runner), `shopify app function replay` (re-run a real logged execution locally) [CITED: tutorial + template package.json scripts `preview: shopify app function run`].
- Limits: ~11M instructions (scales beyond 200 cart lines), 256 KB compiled wasm, 128 KB input, 20 KB output, 10 MB linear memory [ASSUMED — community-cross-checked numbers (function-examples discussions, community forums); the current official limits page could not be pinned this session]. The comparator is a few thousand instructions even in Javy JS — no realistic pressure.

## Architecture Patterns

### System Architecture Diagram

```
                     (existing, Phase 2/3)                        (new, Phase 4)
┌──────────────┐  webhooks   ┌─────────────────┐  metafieldsSet  ┌──────────────────────────┐
│   Shopify    │────────────▶│  App backend     │───────────────▶│ Company metafield        │
│ orders/etc   │             │  recomputeCompany│                │ $app / credit_v1 (JSON)  │
└──────────────┘             │  publishCredit   │                └───────────┬──────────────┘
                             └───┬──────────┬───┘                            │ read (input query,
       ┌─────────────────────────┘          │ EnforcementEvent rows          │ namespace omitted)
       │ validationCreate/Update            │ (state transitions,            ▼
       │ (write_validations)                │  bypassed orders)   ┌──────────────────────────┐
       ▼                                    ▼                     │ Validation Function       │
┌──────────────────┐   config metafield   ┌────────┐             │ cart.validations.generate │
│ Validation object │◀────────────────────│Postgres│             │ .run (Javy wasm)          │
│ (enabled, block   │  $app/config_v1     └────────┘             │  bypass? limit? overdue?  │
│  OnFailure=false) │──────────────────────────────────────────▶ │  integer-cents compare    │
└──────────────────┘   read via validation.metafield             └───────────┬──────────────┘
                                                                              │ operations[].validationAdd
                                                                              ▼
                                                    ┌──────────────────────────────────────┐
                                                    │ Shopify Checkout / cart / draft-order │
                                                    │ renders errors[].message at $.cart    │
                                                    │ → buyer cannot proceed                │
                                                    └──────────────────────────────────────┘
```

Trace (block case): order webhooks → recompute → `credit_v1` published (exposure 1874.95 / limit 1500.00 on Northwind) → buyer starts checkout → Shopify runs the function with the metafield inline in input → comparator returns one error at `$.cart` with the merchant's message → checkout blocked. D2C trace: `purchasingCompany` is null → function returns `{ operations: [] }` → untouched.

### Recommended Project Structure

```
extensions/
└── credit-guard-validation/
    ├── shopify.extension.toml      # api_version 2026-07, target cart.validations.generate.run
    ├── package.json                # CLI-scaffolded; @shopify/shopify_function
    ├── schema.graphql              # generated by CLI (function API schema)
    ├── generated/api.ts            # shopify app function typegen output
    └── src/
        ├── cart_validations_generate_run.graphql   # input query
        └── cart_validations_generate_run.ts        # pure run(input) — ALL logic here
app/
├── services/enforcement.server.ts  # validation ensure-step, config metafield writes, EnforcementEvent writes
└── routes/app.settings.tsx         # (or existing settings surface) message editor
tests/
└── checkout-validation-function.test.ts  # fixtures generated from metafield-contract bytes
```

### Pattern 1: Strict-validate-then-decide reader

**What:** The function treats the metafield as untrusted input despite being its own app's: validate `v === 1`, field presence, types, and money grammar before any comparison; any failure → allow.
**When to use:** Always — this IS ENFC-04.
**Example:** see §Code Examples.

### Pattern 2: App-managed validation with honest status

**What:** Backend owns the Validation object (create/update/config); dashboard reads `enabled` and shows "enforcement rule off" if the merchant disabled it in checkout settings.
**Why:** A silent merchant toggle would otherwise make every Phase 4 promise false while the app looks green.

### Pattern 3: Fixture generation from the contract lock

**What:** Function tests consume payloads produced by the byte-exact strings in `tests/metafield-contract.test.ts` (the declared cross-boundary carrier), not hand-written objects.
**Why:** The Functions workspace cannot import app server code; bytes are the contract (contract-home #3's stated purpose).

### Anti-Patterns to Avoid

- **Old-target cargo-culting:** `purchase.validation.run`, flat `errors`, `localizedMessage`, bare `"cart"` target — all pre-2025-10 era. Use `cart.validations.generate.run`, `operations/validationAdd`, `message`, `"$.cart"`.
- **`parseFloat` anywhere near money** — integer cents only.
- **Blocking on our own failure:** any `throw` inside `run()` is a runtime failure; with `blockOnFailure: false` Shopify fails open, but code should still never throw — wrap the whole body, return allow on any exception.
- **Reading `value` and `JSON.parse`-ing when `jsonValue` exists** — one less throw path.
- **Assuming the block is observable** — no per-attempt telemetry exists; don't design dashboard copy that promises "N blocked checkouts."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Blocking checkout server-side | Checkout UI extension "blocker", theme JS, cart-attribute tricks | Validation Function | UI extensions can't hard-block and are Plus-gated on payment/info steps; theme JS is client-side theater |
| Function ↔ backend communication | Any network call from wasm | Pre-published `credit_v1` metafield | fetch targets aren't available to public apps [ASSUMED]; architecture already built for this |
| Types for the input | Hand-written interfaces | `shopify app function typegen` | Generated from the exact input query against the exact API version |
| Currency conversion in-function | FX math on `presentmentCurrencyRate` | Currency-match gate (mismatch → skip limit rule) | Historical-rate exposure vs spot-rate cart is approximate either way; v1 correctness beats coverage |
| Clock/staleness in-function | Encoding "now" into config metafields on a timer | Nothing (informational-only) | Deterministic wasm has no clock; server-side backstop already bounds staleness |

**Key insight:** every hand-rolled alternative here fails Shopify app review or fails silently at checkout — the two most expensive failure modes this app has.

## Runtime State Inventory

Not a rename/refactor/migration phase — omitted by design. New runtime state *created* by this phase (for the uninstall path, FOUND-03): the Validation object on the shop (deleted automatically with app uninstall along with app-owned metafields — no cleanup task [ASSUMED, standard app-owned-resource behavior; verify in uninstall test]).

## Common Pitfalls

### Pitfall 1: Scaffold emits the old target era
**What goes wrong:** CLI template may generate `purchase.validation.run` + flat result shape (the JS template in function-examples is still 2025-01).
**How to avoid:** Immediately set TOML `api_version = "2026-07"`, target `cart.validations.generate.run`, run `typegen`, and let `generated/api.ts` dictate result type names.
**Warning signs:** `FunctionRunResult`/`localizedMessage` appearing in generated types.

### Pitfall 2: CLI rewrites the repo's TOML
**What goes wrong:** `shopify app dev`/`deploy` may bump `api_version` to the 2026-10 RC or touch `shopify.app.toml` (known behavior, documented in the repo TOML comments).
**How to avoid:** Diff both TOMLs after every CLI invocation; `automatically_update_urls_on_dev = false` must survive.

### Pitfall 3: `blockOnFailure` left default
**What goes wrong:** If created through the merchant UI or with `blockOnFailure: true`, a function timeout blocks real sales — inverted catastrophe.
**How to avoid:** App-managed `validationCreate` with `blockOnFailure: false`; assert it in the ensure-step and in a test against the mocked mutation.

### Pitfall 4: Float money in the comparator
**What goes wrong:** `Number("0.10") + Number("0.20") > 0.30` — phantom over-limit blocks a legitimate sale.
**How to avoid:** Integer cents from grammar-checked strings; ship the float-trap fixture (limit "0.10", exposure "0.00", cart "0.10" → allow).

### Pitfall 5: Treating `limit: null` as zero
**What goes wrong:** Observe-only companies (Snowdevil, Powderbound live payloads) get blocked-all.
**How to avoid:** `limit === null` → always allow (CRED-04); byte-distinct from `"0.00"` (block-all) — both fixtures exist in the contract lock.

### Pitfall 6: Assuming draft orders can't leak
**What goes wrong:** Merchant clicks "Ignore all checkout rules" on a draft; order lands with no API trace of the bypass.
**How to avoid:** ENFC-06 inference on orders/create (blocked-state-at-ingest + source channel), never a checkout-side guarantee.

### Pitfall 7: New scope dance forgotten
**What goes wrong:** `validationCreate` returns ACCESS_DENIED in prod because `write_validations` wasn't consented / Railway SCOPES stale / scope-lockstep test fails.
**How to avoid:** Same four-place update as Phase 3's `write_companies`; deploy + re-consent BEFORE the ensure-step ships.

### Pitfall 8: Blocking during `CART_INTERACTION` surprises
**What goes wrong:** Errors also surface on the online-store cart page (buyerJourney step CART_INTERACTION exists in the schema: `CART_INTERACTION, CHECKOUT_INTERACTION, CHECKOUT_COMPLETION` [VERIFIED: schema.graphql enum]) — buyers see the block before checkout.
**How to avoid:** This is arguably desirable (earlier signal); decide deliberately. If cart-page blocking is unwanted, gate on `buyerJourney.step !== "CART_INTERACTION"` — but note that weakens nothing (checkout still blocks) while delaying the message. Recommend: do not gate in v1 (fewer branches, harder guarantee).

## Code Examples

### Input query — `src/cart_validations_generate_run.graphql`
```graphql
# Source: pattern from Shopify/example-checkout--validation--preact (official), field
# names from the function schema.graphql; namespace omitted => app-reserved namespace.
query Input {
  cart {
    cost {
      totalAmount { amount currencyCode }
    }
    buyerIdentity {
      purchasingCompany {
        company {
          id
          metafield(key: "credit_v1") { jsonValue }
        }
      }
    }
  }
  validation {
    metafield(key: "config_v1") { jsonValue }
  }
}
```
(`presentmentCurrencyRate` deliberately NOT queried in v1 — the mismatch policy is skip, not convert.)

### `run` skeleton — pure, throw-proof, integer cents
```typescript
// Source: shape per generated/api.ts after typegen; decision table per this research.
const MONEY = /^-?\d{1,15}\.\d{2}$/;
const cents = (s: string): number | null =>
  MONEY.test(s) ? Math.round(Number(s.replace(".", ""))) : null; // string surgery, no float math
// cart amounts may have 0-N decimal places — normalize first:
const cartCents = (s: string): number | null => {
  const m = /^(\d{1,15})(?:\.(\d{1,4}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number(((m[2] ?? "") + "00").slice(0, 2));
};

export function run(input: RunInput): CartValidationsGenerateRunResult {
  const ALLOW = { operations: [] as Operation[] };
  try {
    const pc = input.cart.buyerIdentity?.purchasingCompany;
    if (!pc) return ALLOW;                                    // case 1: D2C / no company
    const p = pc.company.metafield?.jsonValue as unknown;
    if (p === null || p === undefined || typeof p !== "object") return ALLOW; // case 2/3
    const pay = p as Record<string, unknown>;
    if (pay.v !== 1) return ALLOW;                            // case 4: unknown version
    if (typeof pay.overdue !== "boolean" || typeof pay.bypass !== "boolean") return ALLOW;
    if (pay.bypass === true) return ALLOW;                    // case 6: bypass FIRST (D-03)
    if (pay.limit === null) return ALLOW;                     // observe-only (CRED-04)
    if (typeof pay.limit !== "string" || typeof pay.exposure !== "string") return ALLOW;
    const limitC = cents(pay.limit);
    const exposureC = cents(pay.exposure);
    if (limitC === null || exposureC === null || limitC < 0) return ALLOW; // malformed money

    const msgs = messagesFrom(input.validation.metafield?.jsonValue); // fallback defaults inside

    if (pay.overdue === true) return block(msgs.overdue);     // ENFC-02 — currency-independent

    const total = input.cart.cost.totalAmount;
    if (typeof pay.currency !== "string" || total.currencyCode !== pay.currency)
      return ALLOW;                                           // case 8: currency mismatch → skip limit rule
    const cartC = cartCents(String(total.amount));
    if (cartC === null) return ALLOW;
    if (exposureC + cartC > limitC) return block(msgs.overLimit); // ENFC-01, remaining-credit
    return ALLOW;
  } catch {
    return ALLOW;                                             // belt: blockOnFailure=false is braces
  }
}
const block = (message: string): CartValidationsGenerateRunResult => ({
  operations: [{ validationAdd: { errors: [{ message, target: "$.cart" }] } }],
});
```
(Note `pay.data_complete` is deliberately not read: false still enforces — understated exposure only under-blocks.)

### Registration ensure-step (Admin GraphQL 2026-07)
```graphql
# Source: byte-verified against app/types/admin-2026-07.schema.json
mutation EnsureValidation($validation: ValidationCreateInput!) {
  validationCreate(validation: $validation) {
    validation { id enabled blockOnFailure shopifyFunction { handle } }
    userErrors { field message code }
  }
}
# variables: { "validation": { "functionHandle": "credit-guard-validation",
#   "enable": true, "blockOnFailure": false, "title": "Credit Guard: net-terms credit check",
#   "metafields": [{ "namespace": "$app", "key": "config_v1", "type": "json",
#                    "value": "{\"v\":1,\"over_limit_message\":\"…\",\"overdue_message\":\"…\"}" }] } }
```
(Exact `metafields` input type/namespace acceptance is deploy-time-verifiable — see Assumptions A3.)

### Fail-open matrix (the ENFC-04 test plan — 9 cases + live fixtures)

| # | Case | Expected | Fixture source |
|---|------|----------|----------------|
| 1 | D2C / `purchasingCompany` null | allow | hand fixture |
| 2 | B2B, metafield null (never published) | allow | hand fixture |
| 3 | malformed payload (non-object, missing/typed-wrong fields, bad money grammar) | allow | mutations of contract bytes |
| 4 | `v !== 1` | allow | contract bytes with v:2 |
| 5 | `data_complete: false` | **enforce normally** | contract bytes |
| 6 | `bypass: true` (+ overdue + over-limit) | allow | **Acme Supply live payload** |
| 7 | `limit: null` (observe-only, even if overdue) | allow | **Snowdevil live payload** |
| 8 | currency mismatch (payload USD, cart EUR) | overdue→block; over-limit→allow | contract bytes + EUR cart |
| 9 | function throws / times out | checkout proceeds | `blockOnFailure: false` (platform) + try/catch |
| + | over-limit block | block w/ merchant message | **Northwind live payload** (1874.95 / 1500.00) |
| + | float trap | allow | limit "0.10", exposure "0.00", cart "0.10" |
| + | boundary | exposure+cart == limit → allow; +0.01 → block | contract bytes |

## Empirical Checks (dev store, before comparator freeze)

- **EC-1 (currency):** With the extension deployed to credit-guard-demo (Basic, USD), run a Northwind B2B checkout to the block, then `shopify app function replay` (or read the run in the Partner Dashboard function runs view) and inspect the real input JSON: confirm `cart.cost.totalAmount.currencyCode === "USD"` and record the exact `amount` format (dp count). Optional mismatch probe: add a EUR market/catalog for one company location and repeat — expected per this research: `currencyCode: "EUR"` while payload currency stays USD → over-limit rule skips, overdue still blocks.
- **EC-2 (namespace omission):** The same replay shows whether `company.metafield` came back non-null with the omitted namespace. If null, fall back to `namespace: "$app"` literally in the input query (both are schema-legal) and re-test. This is the phase's Phase-2-`purchasingEntity`-class trap gate.
- **EC-3 (draft orders):** Create a draft order for Northwind in admin, send the invoice / complete — confirm the validation blocks, and that "Ignore all checkout rules" produces an order our ingest flags as BYPASSED_ORDER.
- **EC-4 (registration):** After scope re-consent, run the ensure-step; confirm the rule appears under Settings → Checkout → Checkout rules as enabled without manual steps, and that `write_validations` also satisfies the `validations` query.
- **EC-5 (fail-open live):** With Snowdevil (limit null) and a D2C customer, complete checkouts end-to-end — zero visible difference.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `purchase.validation.run`, flat `errors[].localizedMessage` | `cart.validations.generate.run`, `operations[].validationAdd.errors[].message` | 2025-01→2025-10 era | All pre-2025 tutorials are wrong about the result shape |
| `bypassCartValidations` on `draftOrderComplete` | Removed in 2026-07; merchant UI "Ignore all checkout rules" instead | between 2025-x and 2026-07 | ENFC-06 must be server-side inference; CLAUDE.md's stack note is stale on this point |
| Merchant-only validation setup (checkout settings) | `validationCreate/Update/Delete` mutations (`write_validations`) | available in 2026-07 | App-managed lifecycle; zero-setup onboarding |
| `@shopify/polaris` React | Polaris web components | 2025/2026 | Settings/message editor uses `s-*` components |

**Deprecated/outdated:** `handleResult` mutation root in the function schema (`@deprecated: "Use the target-specific field instead"`); Shopify Scripts; REST Admin.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Runtime limits are 11M instructions / 256KB wasm / 128KB input / 20KB output (community-cross-checked, official page not pinned) | Q8 | None practical — comparator is orders of magnitude below any plausible limit; `shopify app function run` prints the real count |
| A2 | Network access (fetch target) unavailable to public apps | Don't Hand-Roll | Architecture doesn't use it either way |
| A3 | `ValidationCreateInput.metafields` accepts namespace `"$app"` with type `json` inline | Q6/Code Examples | Fallback: create validation bare, then `metafieldsSet` with ownerId = Validation GID (Validation implements HasMetafields in Admin schema) — 30-minute detour |
| A4 | `write_validations` also grants `Query.validations` reads | Q6 | EC-4 proves/disproves immediately; fallback add `read_validations` [unverified scope name] to the same consent |
| A5 | `paymentTermsSet` (payment customization) is Plus-gated | Alternatives | Only affects the v2 keep-card-open path, not this phase |
| A6 | Draft-order "Ignore all checkout rules" leaves no API trace on the Order | Q7 | If a trace exists, ENFC-06 flagging gets *better*; inference design still correct |
| A7 | Remaining-credit semantics (`exposure + cart > limit`) is the intended ENFC-01 meaning | Q5.5 | Product decision — needs user confirmation at plan/discuss time |
| A8 | App uninstall auto-deletes the shop's Validation object | Runtime State | If not, FOUND-03 cleanup needs a `validationDelete` best-effort call (cannot run post-uninstall — token revoked; likely moot) |
| A9 | Validation functions do not execute for POS transactions | Q7 | ENFC-06 inference covers POS orders regardless |

## Open Questions

1. **Does the merchant-visible "Add rule" UI show our app-created rule as editable/deletable by the merchant?** (Almost certainly yes.) What we know: `Validation.enabled` is queryable, so the dashboard can detect a merchant toggle-off. Recommendation: surface rule status prominently; treat merchant-off as a legitimate state, not an error.
2. **Exact `amount` decimal-place format for `cart.cost.totalAmount` in real runs** (schema says `Decimal`; docs show e.g. "12.99"). Handled defensively by `cartCents` normalization; EC-1 records the observed format.
3. **Plus-gating of `paymentTermsSet`** — conflicting sources (search results say Plus-only; the payment-terms build tutorial page contains no plan restriction). Only matters for the v2 keep-card-open upgrade; park it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Shopify CLI | scaffold/typegen/build/deploy/replay | ✓ | 4.6.1 | — |
| Node.js | Javy build, app | ✓ | 22.20.0 | — |
| Rust toolchain | only if porting Function to Rust | ✗ | — | Not needed (JS/TS by decision); install rustup only if profiling ever demands |
| Dev store w/ live fixtures | empirical checks EC-1..5 | ✓ | credit-guard-demo.myshopify.com (Basic; Northwind over-limit, Acme bypass, Snowdevil observe-only) | — |
| `gh` CLI (GitHub API) | reference repo reads | ✓ | used this session | — |
| shopify.dev reachability | doc verification | ✓ (restored — was DNS-blocked in Phase 3) | — | — |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.10 (root suite, 337 tests / 17 files green at phase start) |
| Config file | `vitest.config.ts` (includes `tests/**/*.test.ts`) |
| Quick run command | `npx vitest run tests/checkout-validation-function.test.ts` |
| Full suite command | `npm run graphql-codegen && DATABASE_URL=…creditguard_test npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENFC-01 | over-limit block, remaining-credit boundary, float trap | unit (pure `run`) | `npx vitest run tests/checkout-validation-function.test.ts` | ❌ Wave 0 |
| ENFC-02 | overdue block; overdue+mismatch still blocks | unit | same | ❌ Wave 0 |
| ENFC-03 | message from config metafield; fallback text when absent/malformed | unit | same | ❌ Wave 0 |
| ENFC-04 | 9-case fail-open matrix (incl. live-payload fixtures) | unit | same | ❌ Wave 0 |
| ENFC-05 | EnforcementEvent rows on state transitions | integration (Postgres) | `npx vitest run tests/enforcement-events.test.ts` | ❌ Wave 0 |
| ENFC-06 | orders/create ingest flags BYPASSED_ORDER w/ channel | integration | same | ❌ Wave 0 |
| — | registration ensure-step (create/skip/blockOnFailure asserted) | integration (GraphQL seam mock) | `npx vitest run tests/enforcement-registration.test.ts` | ❌ Wave 0 |
| — | scope lockstep incl. `write_validations` | unit | `npx vitest run tests/scope-lockstep.test.ts` | ✅ (update) |

### Sampling Rate
- **Per task commit:** the phase-relevant quick command above
- **Per wave merge:** full suite
- **Phase gate:** full suite green + EC-1..EC-5 dev-store evidence before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/checkout-validation-function.test.ts` — ENFC-01..04 (fixtures generated from `tests/metafield-contract.test.ts` bytes)
- [ ] `tests/enforcement-events.test.ts` — ENFC-05/06
- [ ] `tests/enforcement-registration.test.ts` — ensure-step
- [ ] Prisma migration for `EnforcementEvent` (+ Validation GID storage on Shop)
- [ ] Extension scaffold itself (`shopify app generate extension …`) — the Function workspace does not exist yet (`extensions/` dir absent)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (no new auth surface) | existing session-token auth |
| V3 Session Management | no | existing |
| V4 Access Control | yes | `write_validations` scope minimal-add; Validation GID stored per shop, all queries shop-scoped (T-03-06 pattern); `$app` metafield namespaces private to the app by platform rule |
| V5 Input Validation | yes | Function strict-validates the payload (own-app data treated as untrusted); merchant message length-capped + stored as JSON string, rendered by Shopify as plain text; settings action intent-whitelisted, variables-only GraphQL |
| V6 Cryptography | no new | — |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Phantom block from float/format bug (self-inflicted DoS on merchant sales) | DoS | integer cents, grammar gates, float-trap + boundary fixtures, fail-open matrix |
| Function crash blocking checkout | DoS | `blockOnFailure: false` + total try/catch → allow |
| Another app/merchant editing the config metafield | Tampering | `$app` namespace is app-private; `merchant_read` at most |
| Message content injection into checkout | Injection | plain-text rendering by Shopify; server-side length cap; no user HTML |
| Cross-shop validation-object confusion | Elevation | Validation GID persisted on the shop row, mutations through the shop's own offline session only |

## Sources

### Primary (HIGH confidence)
- `app/types/admin-2026-07.schema.json` (repo, byte-authoritative) — Validation type/mutations/inputs, `draftOrderComplete` args, zero "bypass" identifiers, mutation description texts
- [Shopify/example-checkout--validation--preact](https://github.com/Shopify/example-checkout--validation--preact) (files read via `gh api`) — extension TOML (target/export), input query with `validation.metafield` + `$app:` namespace, full function `schema.graphql` (Input root incl. `presentmentCurrencyRate`, `Company.metafield` namespace-omission doc string, `BuyerJourneyStep`, result input types)
- [Shopify/function-examples](https://github.com/Shopify/function-examples) `checkout/javascript/cart-checkout-validation` — JS template era (2025-01/old target), vitest test pattern, package.json scripts
- [Cart and Checkout Validation Function API (2026-07)](https://shopify.dev/docs/api/functions/latest/cart-and-checkout-validation) — target, presentment currency, no payment-selection input, output shape
- [supported checkout field targets](https://shopify.dev/docs/api/functions/reference/cart-checkout-validation/graphql) — `$.cart` et al.
- [validationCreate](https://shopify.dev/docs/api/admin-graphql/latest/mutations/validationCreate) — `write_validations`
- [draftOrderComplete (latest)](https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftOrderComplete) — no bypass arg in 2026-07
- `tests/metafield-contract.test.ts`, `app/services/metafields.server.ts` (read this session) — payload law, fixture bytes

### Secondary (MEDIUM confidence)
- [create checkout validation tutorial](https://shopify.dev/docs/apps/build/checkout/cart-checkout-validation/create-checkout-validation) — CLI command, flavors, replay, admin activation path
- [create complex validation rules tutorial](https://shopify.dev/docs/apps/build/checkout/cart-checkout-validation/create-complex-validation-rules) — merchant UI flow, `$app:` config metafield pattern
- [B2B payment terms help](https://help.shopify.com/en/manual/b2b/checkout-and-orders/payment-terms), [B2B payment methods help](https://help.shopify.com/en/manual/b2b/checkout-and-orders/payment-methods) — no card choice at terms checkout; deposits Plus-only; post-order Pay now
- [Payment Customization Function API](https://shopify.dev/docs/api/functions/latest/payment-customization) + [set payment terms tutorial](https://shopify.dev/docs/apps/build/checkout/payments/payment-terms) — `cart.payment-methods.transform.run`, `paymentTermsSet`, conflicting Plus-gating signals
- [metafields for input queries](https://shopify.dev/docs/apps/build/functions/input-queries/metafields-for-input-queries), [functions + $app changelog](https://shopify.dev/changelog/shopify-functions-now-support-app-owned-metafields-and-reserved-prefixes) (via search summary)
- Draft-order checkout-rules changelog + help (via search): rules apply by default; "Ignore all checkout rules"

### Tertiary (LOW confidence — validate if load-bearing)
- Runtime limit numbers (function-examples discussions #329/#425, community forums, 2026 blog round-ups)
- Competitor behavior (Folio, BizCred app listings via search)
- [POS checkout validation changelog](https://changelog.shopify.com/posts/checkout-validation-for-pos-checkout) — different native feature; functions not implicated

## Metadata

**Confidence breakdown:**
- Function contract (target, input, output, currency): HIGH — live docs + official example schema + tutorial, mutually consistent
- Admin API surface (validation mutations, scopes, draft-order args): HIGH — byte-verified local 2026-07 schema is the same artifact codegen validates against
- Reader-decision recommendations (data_complete, remaining-credit, currency policy): reasoning is sound but items A7 and the currency policy are product decisions — flag for user confirmation
- Enforcement observability limits: HIGH on "no per-attempt telemetry / no bypass API trace" (schema-negative verified); MEDIUM on draft-order merchant-UI specifics
- Limits/tooling: MEDIUM — community numbers; irrelevant at this function's size

**Research date:** 2026-08-20
**Valid until:** 2026-09-20 (2026-10 API becomes stable ~October — re-check target/schema drift then)
