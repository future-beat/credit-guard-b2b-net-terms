---
phase: 02-ar-ledger-credit-engine
plan: 05
subsystem: infra
tags: [shopify-cli, shopify-app-toml, access-scopes, webhooks, railway, protected-customer-data, deployment, verification]

# Dependency graph
requires:
  - phase: 02-ar-ledger-credit-engine
    plan: 01
    provides: "webhooks.orders.tsx, recordWebhookReceipt/markWebhookProcessed, refetchOrderAndRecompute, admin-client seam"
  - phase: 02-ar-ledger-credit-engine
    plan: 02
    provides: "webhooks.payment-terms.tsx, webhooks.companies.tsx, the b2b-events suite this plan's TOML guard extends"
  - phase: 02-ar-ledger-credit-engine
    plan: 03
    provides: "webhooks.bulk-operations.tsx + the SyncCursor backfill status schema the prod-state script parses; the claim-then-work defect report"
  - phase: 02-ar-ledger-credit-engine
    plan: 04
    provides: "SweepLease/scheduler running on the deployed container"
  - phase: 01-foundation-compliance
    provides: "smoke-deployed.sh, send-signed-webhook.sh, prod-lifecycle-state.{sh,mjs} railway-ssh pattern, Railway release-phase migrations"
provides:
  - "shopify.app.toml: the CF-1 four-read-scope string + fifteen Phase-2 webhook topics across four routes (declared; NOT yet published — see the two Partner gates)"
  - "vitest.config.ts test env SCOPES in lockstep with the TOML"
  - "Railway service variable SCOPES set to the same string"
  - "Phase 2 code + the add_ledger_models migration live in production"
  - "scripts/prod-ledger-state.{sh,mjs} — production ledger state over railway ssh"
  - "smoke-deployed.sh extended to all six unauthenticated POST surfaces; send-signed-webhook.sh extended with the ledger topics"
  - "releaseWebhookReceipt + the claim-release fix on all three ingest routes (carried fix from 02-03)"
  - "Measured, reproducible evidence of the two Partner Dashboard gates that block `shopify app deploy` outright"
affects: [phase-03-metafield-publishing, phase-04-checkout-enforcement, phase-05-reminder-emails]

actuals:
  tokens: 12100
  tasks: 4
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Provisional webhook claim: claim before work, release on failure, so Shopify's retry stays the retry mechanism"
    - "Registration source-guard test: parse the comment-stripped TOML and assert scopes, api_version, every topic, and that each subscription uri has a route file"
    - "Non-publishing CLI probe: `shopify app deploy --no-release` to measure a registration validation gate without touching the live version"

key-files:
  created:
    - scripts/prod-ledger-state.sh
    - scripts/prod-ledger-state.mjs
  modified:
    - shopify.app.toml
    - vitest.config.ts
    - app/services/ledger.server.ts
    - app/routes/webhooks.orders.tsx
    - app/routes/webhooks.payment-terms.tsx
    - app/routes/webhooks.companies.tsx
    - tests/webhooks.orders.test.ts
    - tests/webhooks.b2b-events.test.ts
    - scripts/send-signed-webhook.sh
    - scripts/smoke-deployed.sh
    - README.md

key-decisions:
  - "A webhook claim is released when the work fails, and the error is rethrown: a non-200 is what makes Shopify redeliver, and the released claim is what makes that redelivery real work instead of a dedupe no-op"
  - "The release is guarded on processedAt: null, so a completed delivery can never be un-recorded — dedupe-on-success is preserved by construction, not by convention"
  - "The same fix was applied to webhooks.payment-terms.tsx and webhooks.companies.tsx: identical defect, identical enforcement-critical consequence"
  - "shopify.app.toml was NOT trimmed to a publishable subset. A partial publish would ship a knowingly-wrong scope set to the live registration and still require a second deploy after approval, while unblocking nothing — the empirical checks are browser-gated regardless"
  - "Research A12's fallback (deploy without read_all_orders for dev) was evaluated and does NOT unblock: the protected-customer-data gate on the orders/companies topics is independent and blocks the same version creation"
  - "The deployed ingest proof uses orders/delete, the one ledger topic that touches no Admin API, so it is provable before the scope grant exists"
  - ".env.example is blocked by this environment's env-file guard; README § Access scopes (CF-1) is the documented canonical location for the scope string, as the plan's fallback allows"

patterns-established:
  - "Measure an external gate rather than infer it: `--no-release` probes attributed the deploy failure to specific topic groups without publishing anything"
  - "Prove a deployed path with the operation that has the fewest prerequisites, then record what the blocked operations actually return"

requirements-completed: [LEDG-01, LEDG-02, LEDG-03, LEDG-04, LEDG-05]

coverage:
  - id: D1
    description: "shopify.app.toml requests exactly read_orders,read_all_orders,read_payment_terms,read_companies — no write scope, no read_customers (CF-1 closed in the repo)"
    requirement: LEDG-01
    verification:
      - kind: integration
        ref: "tests/webhooks.b2b-events.test.ts#requests exactly the four CF-1 read scopes and no write scope"
        status: pass
      - kind: command
        ref: "grep -v '^\\s*#' shopify.app.toml | grep -c 'read_all_orders' -> 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "All fifteen Phase-2 topics are declared under api_version 2026-07, each on a route file that exists, with the Phase 1 compliance/lifecycle blocks and the production URL untouched"
    requirement: LEDG-02
    verification:
      - kind: integration
        ref: "tests/webhooks.b2b-events.test.ts#declares all fifteen Phase-2 topics on their routes"
        status: pass
      - kind: integration
        ref: "tests/webhooks.b2b-events.test.ts#points every subscription at a route file that exists"
        status: pass
      - kind: integration
        ref: "tests/webhooks.b2b-events.test.ts#leaves the Phase 1 compliance and lifecycle subscriptions intact"
        status: pass
      - kind: integration
        ref: "tests/webhooks.b2b-events.test.ts#keeps the api_version pinned to the stable 2026-07 (CF-5)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Phase 2 code is live in production with the ledger migration applied during the release"
    requirement: LEDG-02
    verification:
      - kind: integration
        ref: "railway up --service credit-guard-app --ci -> Deploy complete (image sha256:846c686aaf5f27284c926fd7ba381f43c7cbf902693fec4f52005a038afe3b1d); release log: 'Applying migration `20260819031730_add_ledger_models`' then 'All migrations have been successfully applied.'"
        status: pass
      - kind: integration
        ref: "bash scripts/smoke-deployed.sh app.creditguardhq.com -> GET /healthz http=200 ssl_verify_result=0; exit 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "A Shopify-SIGNED delivery to the deployed URL returns 200 and lands a WebhookReceipt row in production Postgres (LEDG-02 deployed-true)"
    requirement: LEDG-02
    verification:
      - kind: integration
        ref: "shopify app webhook trigger --topic orders/delete --api-version 2026-07 --address https://app.creditguardhq.com/webhooks/orders -> enqueued; Railway log 'POST /webhooks/orders 200'; prod-ledger-state shop.myshopify.com -> receipt 9c86295e-5723-4ba7-87a5-c8966af0e7de ORDERS_DELETE processedAt 2026-08-19T04:33:47.335Z"
        status: pass
      - kind: integration
        ref: "scripts/send-signed-webhook.sh app.creditguardhq.com orders/delete credit-guard-demo.myshopify.com -> 200; prod-ledger-state -> receipt cg-20260819T043217Z-48514 ORDERS_DELETE processedAt set"
        status: pass
    human_judgment: false
  - id: D5
    description: "Forged-HMAC POSTs to all four new deployed webhook endpoints return 401 (T-02-24), smoke-gated and re-runnable"
    requirement: LEDG-02
    verification:
      - kind: integration
        ref: "bash scripts/smoke-deployed.sh app.creditguardhq.com -> /webhooks/orders 401, /webhooks/payment-terms 401, /webhooks/companies 401, /webhooks/bulk-operations 401 (plus the two Phase 1 surfaces); exit 0"
        status: pass
      - kind: integration
        ref: "Railway log shows the six 401s with no handler line attached — the library rejected before any route code ran"
        status: pass
    human_judgment: false
  - id: D6
    description: "A transient ingest failure leaves the delivery re-processable instead of deduped away — the carried 02-03 defect, fixed on all three ingest routes"
    requirement: LEDG-02
    verification:
      - kind: integration
        ref: "tests/webhooks.orders.test.ts#survives a transient failure — the redelivery is real work, not a dedupe no-op"
        status: pass
      - kind: integration
        ref: "tests/webhooks.orders.test.ts#keeps a SUCCEEDED delivery's receipt even if a later error is raised"
        status: pass
      - kind: integration
        ref: "tests/webhooks.b2b-events.test.ts#releases its claim on a transient failure so the redelivery still lands"
        status: pass
      - kind: mutation
        ref: "release call deleted from webhooks.orders.tsx -> regression red with receipts: 1; restored byte-identically (cmp)"
        status: pass
      - kind: integration
        ref: "PRODUCTION: two signed deliveries failed with 'Access denied for order field', logged 'claim released for redelivery', and left unprocessedReceiptCount 0 — zero orphan receipts"
        status: pass
    human_judgment: false
  - id: D13
    description: "The deployed companies and payment-terms routes accept signed deliveries and write exactly the right rows — including writing NO exposure fields"
    requirement: LEDG-02
    verification:
      - kind: integration
        ref: "scripts/send-signed-webhook.sh app.creditguardhq.com companies/create|companies/update|payment_terms/update <bystander> -> 200 each; prod-ledger-state -> Company 'Deployed Probe Co' exposure 0.0000 recomputedAt null, three receipts all processed, unprocessedReceiptCount 0"
        status: pass
      - kind: integration
        ref: "signed shop/redact for the bystander domain -> 200; prod-ledger-state -> companies 0, receipts 0, shop rows 0"
        status: pass
    human_judgment: false
  - id: D7
    description: "Production ledger state is queryable over the railway ssh pattern (companies, exposures, receipts, cursors, leases) with DATABASE_URL never leaving Railway"
    requirement: LEDG-01
    verification:
      - kind: integration
        ref: "bash scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com -> valid JSON parsed by node/jq; shop active true, sessionCount 1, backfill status absent"
        status: pass
      - kind: command
        ref: "grep -v '^\\s*#' scripts/*.sh | grep -cE '2>/dev/null|\\|\\| *true' -> 0 per script; SHOPIFY_API_SECRET assignment count 0; no credential literals under scripts/"
        status: pass
    human_judgment: false
  - id: D8
    description: "The registration itself carries the scopes and the fifteen topics (a released app version)"
    requirement: LEDG-01
    verification:
      - kind: integration
        ref: "shopify app deploy --allow-updates -> 'Version couldn't be created' — 8 protected-customer-data topic rejections + app_access validation error on scopes: read_all_orders. Active version remains credit-guard-net-terms-3."
        status: fail
    human_judgment: true
    rationale: "BLOCKED by two Partner Dashboard actions that have no CLI or API surface (see § Outstanding human checks). The TOML, the Railway variable and the test env all carry the correct values; publishing them is one browser action plus one `shopify app deploy` away."
  - id: D9
    description: "Backfilled per-company balances match the admin-shown outstanding amounts on the dev store (LEDG-01, phase success criterion 1)"
    verification:
      - kind: integration
        ref: "scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com -> backfill status 'absent', companyCount 0 — the backfill has not run and cannot until the scope grant exists"
        status: unknown
    human_judgment: true
    rationale: "Three prerequisites are all browser-only or gated behind them: the app version carrying the scopes cannot be created (D8), the merchant must accept the re-consent prompt, and the B2B net-terms test orders must be created in admin. Production proved the exact failure mode in the meantime: an order refetch returns 'Access denied for order field. Required access: read_orders access scope'."
  - id: D10
    description: "A2 — a refund on a partially-paid net-terms order leaves ledger exposure equal to the admin-shown balance due (LEDG-03)"
    verification: []
    human_judgment: true
    rationale: "Requires real B2B net-terms orders on the dev store plus a granted read_orders scope; both blocked as in D9. The engine's behaviour under this sequence is proven against fixtures (02-01 D4), but the claim under test is about what Shopify's totalOutstandingSet does, which no fixture can settle. Procedure written into README § Empirical dev-store checks."
  - id: D11
    description: "A7 — unpaid net-terms orders match the pending financial-status filter, and the real JSONL __parentId shape for payment schedules"
    verification: []
    human_judgment: true
    rationale: "Needs one real bulk operation on a store with B2B orders. Blocked by the same scope gate. The parser tolerates either parent shape by design (02-03), so this is a record-keeping gap rather than a correctness risk; procedure written into README § Empirical dev-store checks."
  - id: D12
    description: "The hourly sweep actually ticks on the deployed Railway container and claims its Postgres lease (02-04's carried-forward D11)"
    requirement: LEDG-05
    verification:
      - kind: integration
        ref: "sweepLeases [] at 04:38Z (deploy landed 04:21Z, cron fires at minute 0) -> after the tick: { name: 'overdue-sweep', holder: '5ea3934b-0b3a-4fb7-bbea-dfa0c396592b', lockedUntil: '2026-08-19T05:00:00.243Z' } — claimed by RAILWAY_DEPLOYMENT_ID and released in the same second"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-08-19
status: complete
---

# Phase 02 Plan 05: Registration, Deploy & Empirical Evidence Summary

**Phase 2's code and its ledger migration are live in production and every deployed webhook surface rejects a forged signature with 401 — but the app registration could not be updated at all: two unfiled Partner Dashboard approvals (protected customer data, and `read_all_orders`) block `shopify app deploy` from creating any version, which in turn blocks the scope grant that every empirical dev-store check depends on.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 4 (3 planned + the carried 02-03 fix)
- **Commits:** 5
- **Files:** 13 (2 created, 11 modified), 816 insertions, 0 deletions
- **Tests:** 184 → 194 (+10: 3 claim-release regressions, 7 registration source guards)

## Task Commits

1. **Carried fix — webhook claim release** — `77e7413` (fix)
2. **Task 1 — CF-1 scopes + fifteen topics + lockstep + source guard** — `be5a6c2` (feat)
3. **Task 2 — deployed verification tooling** — `3f4ee16` (chore)
4. **Task 2b — companies/payment-terms deployed proof + ssh retry note** — `25f36ef` (chore)
5. **Task 3 / documentation** — this summary (docs)

Production artifacts (not git objects): Railway image `sha256:846c686a…`, released 2026-08-19T04:21Z with `20260819031730_add_ledger_models` applied. Shopify app version: **unchanged, still `credit-guard-net-terms-3`** — see below.

## The finding that shaped this plan

`shopify app deploy` **cannot create an app version at all** for this app right now. Two independent registration-validation gates fire:

```
Version couldn't be created.
  • This app is not approved to subscribe to webhook topics containing
    protected customer data.        (x8)

Version couldn't be created.
  app_access
  Validation errors
    • scopes: read_all_orders
```

Both correspond to Partner Dashboard access requests that 02-01 and 02-03 recorded as **launch-blocking but not execution-blocking**, on the research finding that development stores are exempt. That reading was half right: dev stores are exempt from the *runtime* 60-day order window, but neither gate is store-scoped — they are validated when the **app version** is created, before any store is involved. So they block execution too.

I measured which topics are affected using `shopify app deploy --no-release`, which runs the same validation and publishes nothing (the active version was `credit-guard-net-terms-3` before and after every probe):

| Subscription block | PCD rejections |
|---|---|
| `/webhooks/orders` (7 topics) | 6 |
| `/webhooks/companies` (3 topics) | 2 |
| `/webhooks/payment-terms` (4 topics) | 0 |
| `/webhooks/bulk-operations` (1 topic) | 0 |

`payment_terms/*` and `bulk_operations/finish` are **not** protected-customer-data topics; the orders-shaped and `companies/*` topics are. (Per-topic attribution below that granularity was unstable across repeated probes — the CLI surfaces the scope error and the topic errors together and did not report them consistently for single-topic configs — so the block-level numbers above are what I am willing to assert.)

**What I did not do:** trim the TOML to the publishable subset. It would have shipped a scope set to the live registration that the phase explicitly forbids, still required a second deploy after approval, and unblocked nothing — the empirical checks need a human in a browser regardless (accept the consent prompt, create B2B orders). Research **A12**'s fallback ("temporarily deploy without `read_all_orders` for dev") was evaluated for the same reason and rejected: the PCD gate is independent and blocks the identical version creation.

## What IS deployed and proven

Production runs the Phase 2 code. The evidence below is from the live host and the production database, not a test environment.

| Check | Result |
|---|---|
| Release migration | `Applying migration 20260819031730_add_ledger_models` → `All migrations have been successfully applied.` |
| `GET /healthz` | `200`, `ssl_verify_result=0` on `app.creditguardhq.com` |
| Forged HMAC → 401 | `/webhooks/compliance`, `/webhooks/app/uninstalled`, `/webhooks/orders`, `/webhooks/payment-terms`, `/webhooks/companies`, `/webhooks/bulk-operations` — all six, all 401, no handler log line attached |
| **Shopify-signed** `orders/delete` | `200`; production receipt `9c86295e-…` `ORDERS_DELETE`, `processedAt` stamped |
| Locally-signed `orders/delete` | `200`; production receipt `cg-20260819T043217Z-…`, `processedAt` stamped |
| Locally-signed `orders/create` / `refunds/create` | `500` — `Access denied for order field. Required access: read_orders access scope`. **Zero receipts left behind.** |
| Shopify-signed `orders/create` (sample shop) | `500` — `SessionNotFoundError` for `shop.myshopify.com`. **Zero receipts left behind.** |
| Signed `companies/create` + `companies/update` | `200` each; production `Company` row `gid://shopify/Company/1001` "Deployed Probe Co", `exposure 0.0000`, **`recomputedAt null`** |
| Signed `payment_terms/update` with no order reference | `200`, receipt processed, nothing written — the deferred-to-reconciliation path |
| Test rows cleaned up | signed `shop/redact` for both probe domains → `200`, all rows back to 0 |
| **Deployed scheduler tick** | `sweepLeases` empty at 04:38Z → after the hourly cron: `{ name: "overdue-sweep", holder: "5ea3934b-…" (`RAILWAY_DEPLOYMENT_ID`), lockedUntil: "2026-08-19T05:00:00.243Z" }` |

Two things worth naming in that table.

**The must-have "a Shopify-signed delivery returns 200 and lands a receipt row" is met via `orders/delete`.** It is the one ledger topic whose handler touches no Admin API (a deleted order cannot be refetched), so it is provable before any scope exists. The plan expected `orders/create` to serve this role and predicted a tolerated 404; the real blocker turned out to be authorization, not a missing order.

**Three of the four Phase-2 routes are proven end to end on the deployed app.** `/webhooks/orders` (via `orders/delete`), `/webhooks/companies` and `/webhooks/payment-terms` all accept a signed delivery, land a processed receipt, and write exactly what they should — including the negative: the companies route left `recomputedAt` null and `exposure` at 0, confirming in production that `recomputeCompany` remains the sole writer of the exposure fields (02-02's invariant). Only `/webhooks/bulk-operations` has no 200-path proof, because a finish delivery is only meaningful for a bulk operation this shop actually started.

**02-04's open item is closed.** Its D11 asked whether the node-cron scheduler actually ticks on a real Railway container rather than only under fake timers. It does: the container deployed at 04:21Z created no lease, then at exactly `05:00:00.243Z` the `overdue-sweep` lease appeared holding `RAILWAY_DEPLOYMENT_ID` — claimed and released inside the same second, on a shop set with nothing due. What is still unobserved is only the *rolling-deploy* half (two containers with different deployment ids racing one tick), which needs a deploy timed against a tick.

**The carried fix has a production proof, not just a test.** Three deliveries failed mid-work on the deployed app; each logged `claim released for redelivery` and left `unprocessedReceiptCount: 0`. Before this fix those three webhook ids would be permanently burned — Shopify's redelivery would have been discarded as already-seen. It also confirms 02-01's decision that a GraphQL `errors` array must throw rather than be read as "order deleted": a permissions failure did not silently delete a ledger row.

## Carried fix (from 02-03's deferred items)

`webhooks.orders.tsx` claimed the webhook receipt *before* doing the work. A transient failure then returned non-200, Shopify redelivered, and the dedupe check discarded the redelivery — losing that delivery permanently, converting an instant correction into a ≤24h one via reconciliation, on the path that decides whether a merchant's customer is blocked at checkout.

**Fix:** `releaseWebhookReceipt(webhookId)` deletes the receipt **only when `processedAt` is null**, and each ingest route wraps its work in `try/catch → release → rethrow`. The rethrow matters as much as the release: a non-200 is what makes Shopify redeliver, and the released claim is what makes that redelivery real work.

This deliberately differs from `webhooks.bulk-operations.tsx`, which acks 200 and leaves the run for `pollBackfillIfStale`. That route has a poll fallback; the order routes have none, so Shopify's retry *is* the retry mechanism and must be kept usable. The shape is the same — a receipt is only durably claimed once the work succeeded — with the recovery path each route actually has.

Re-doing released work is safe by construction: every ingest path is a refetch-from-source plus idempotent upserts, so a half-applied delivery converges on replay rather than double-counting.

**Scope note:** the identical defect existed in `webhooks.payment-terms.tsx` and `webhooks.companies.tsx` (02-02's files). Both were fixed. A lost `payment_terms/update` is a lost due-date change — the same enforcement-critical class — and both routes were about to be deployed by this plan.

**Regression evidence:** `tests/webhooks.orders.test.ts#survives a transient failure…` (a rejected `getAdminContext`, asserting zero receipts and then that the same webhook id does real work), a companion asserting a *succeeded* receipt survives a later release call, and the same scenario on the payment-terms route. Mutation-checked: deleting the release call turns the orders regression red with `receipts: 1`; the file was restored byte-identically (`cmp`).

## Empirical dev-store checks (Task 3) — not run

| Check | Verdict | Why |
|---|---|---|
| Backfill vs admin (LEDG-01, success criterion 1) | **unknown** | Backfill has never run: `backfill.status = "absent"`, `companyCount 0`. It cannot run without the scope grant, which cannot exist without the app version, which cannot be created (above). |
| A2 — partial-pay → refund vs admin balance due | **unknown** | Same gate, plus the sequence itself must be created by a human in admin. |
| A7 — unpaid net-terms orders match the `pending` filter | **unknown** | Needs one real bulk operation. |
| A7b — real JSONL `__parentId` shape (Order vs PaymentTerms gid) | **unknown** | Needs the same bulk result. The parser attributes children positionally and treats `__parentId` as advisory (02-03), so either answer is already tolerated — this is a record-keeping gap, not a correctness risk. |

The procedure for all four is now written into **README § Empirical dev-store checks**, so it is re-runnable at Phase 4 time rather than reconstructed from this summary.

## Outstanding human checks (browser-only — none are claimed as passing)

### 1. Protected customer data, Level 1 — LAUNCH- **AND** EXECUTION-BLOCKING

Dev Dashboard → app `411936784385` → **API access → Protected customer data**. Request/configure **Level 1 only**. This app stores company ids, money amounts and dates, and reads no customer name, email, phone or address anywhere — Level 2 should not be requested until Phase 5 needs contact emails.

Until this is granted, `shopify app deploy` fails with `This app is not approved to subscribe to webhook topics containing protected customer data` and **no app version can be created at all**.

### 2. `read_all_orders` access request — LAUNCH- **AND** EXECUTION-BLOCKING

Dev Dashboard → app `411936784385` → **API access → Access requests → "Read all orders"**. Purpose to state: *the AR ledger must ingest ALL open net-terms orders regardless of age — a 60-day window silently understates a merchant's credit exposure.* Review takes up to seven business days.

Until this is granted, version creation fails with `app_access → Validation errors → scopes: read_all_orders`.

### 3. After both are granted — the exact sequence

```shell
export PATH="$HOME/.npm-global/bin:$PATH"
cp shopify.app.toml /tmp/toml.pre
shopify app deploy --allow-updates
diff /tmp/toml.pre shopify.app.toml            # MUST be empty (CF-5)
grep -c 'api_version = "2026-07"' shopify.app.toml   # MUST be 1
```

Then, in the browser:

1. Open the app in `credit-guard-demo.myshopify.com` admin → **accept the new-permissions prompt**. It should list exactly: read orders, read all orders, read payment terms, read companies. **Until it is accepted, every Admin API call for this shop fails** — proven live today: `Access denied for order field`.
2. Confirm the backfill ran: `scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com | jq '.backfill'` → `"status": "completed"`.
3. Create the B2B net-terms test data and run README § Empirical dev-store checks (backfill-vs-admin, A2, A7, A7b).

*(02-04's carried-forward D11 — the deployed scheduler — is no longer outstanding; see below.)*

## Deviations from Plan

### Auto-fixed / discretionary

**1. [Rule 2 — Missing critical] The claim-release fix was applied to all three ingest routes, not just the orders route**

- **Found during:** the carried fix
- **Issue:** `webhooks.payment-terms.tsx` and `webhooks.companies.tsx` carry the identical claim-then-work ordering. A lost `payment_terms/update` is a lost due-date change — the same class of permanent loss on the same enforcement-critical path — and this plan was about to deploy both routes.
- **Fix:** the same `try → release → rethrow` guard, with a regression test on the payment-terms route.
- **Committed in:** `77e7413`

**2. [Rule 3 — Blocking] The app registration could not be published**

- **Issue and evidence:** documented in full above. Two Partner Dashboard gates, no CLI or API surface for either.
- **What was done instead:** the correct values are committed to `shopify.app.toml`, set on Railway, pinned in the test env, guarded by tests, and documented in the README with the exact error strings so the next attempt is recognisable rather than mysterious. The gate was *measured* with `--no-release` probes rather than guessed at.
- **What was deliberately NOT done:** trimming the TOML to a publishable subset (reasoning above).

**3. [Discretionary] `orders/delete` added to `send-signed-webhook.sh`**

- The plan lists `orders/create`, `orders/updated` and `refunds/create`. All three refetch through the Admin API, so none of them can return 200 before the scope grant. `orders/delete` acts on local rows only and is therefore the ingest probe that works at any stage — it is what produced the deployed 200-plus-receipt evidence.

**4. [Discretionary] `unprocessedReceiptCount` in the prod-state script**

- Claimed-but-unfinished receipts are the exact residue the carried fix prevents. Counting them turns "the fix works" into a standing production assertion rather than a one-off observation.

**5. [Environment] `.env.example` could not be written**

- The executor's environment denies all access to `.env*`. Per the plan's own fallback, README § Access scopes (CF-1) is the canonical documented home for the scope string; it names all three places the value must agree and gives the `railway variables --set` command.

**6. [Discretionary] Test rows cleaned up with a signed `shop/redact`**

- The Shopify-signed trigger created rows for its sample shop `shop.myshopify.com`, and the companies probe created a `Company` row for a throwaway bystander domain. Both were cleared through the already-tested Phase 1 redact path (`companies 0`, `receipts 0`, `shop rows 0` afterwards), so the dev store's production ledger contains no probe data going into the empirical checks.

**7. [Discretionary] `companies/*` and `payment_terms/update` added to `send-signed-webhook.sh`**

- Neither route calls the Admin API, so both are provable on the deployed app *today*, before any scope grant. That converted two routes from "rejects forgeries" to "rejects forgeries and does the right thing when signed" — including the negative assertion that the companies route writes no exposure fields. The `payment_terms/update` body deliberately carries no order reference, which exercises the defer-to-reconciliation path rather than the refetch path.

---

**Total deviations:** 1 missing-critical, 1 blocking, 5 discretionary. No scope creep; no architectural change; no dependency added.

## Issues Encountered

- **`--allow-updates` and `--no-release` are mutually exclusive.** The first probe combined them and failed on flag validation, which looks identical to "zero errors" through a `grep -c`. Every subsequent probe's full output was read rather than counted. Worth remembering: an error-count grep can silently measure the wrong failure.
- **`shopify app deploy --force` does not exist** (it is `--allow-updates`).
- **The CLI reports the scope error and the topic errors from the same validation pass**, and its formatting differs between one error (no bullet) and many (bulleted) — a fragile thing to grep.
- **A delivery for a shop with no offline session currently 500s** (`SessionNotFoundError`), so Shopify will retry it for ~48h. That is pre-existing behaviour, not introduced here, but it is now visible. See Deferred Items.
- **`ssh.railway.com` intermittently presents a different host key.** One `prod-ledger-state.sh` call mid-run failed with `REMOTE HOST IDENTIFICATION HAS CHANGED!`; the identical command succeeded on retry with strict checking still on, which means the hostname fronts a fleet whose members carry different host keys while `known_hosts` pins one. **`known_hosts` was NOT modified** — silently re-keyscanning is precisely the action a real man-in-the-middle needs, and this is not a decision to make on the user's behalf. Documented in README § Inspecting the production database: retry first, and verify a fingerprint against Railway's published keys before ever appending one.

## Deferred Items

- **`SessionNotFoundError` should probably not be retried.** Deliveries can arrive after uninstall (both route headers say so). Today that produces a 500, a released claim, and ~48h of Shopify retries that can never succeed. The library throws a *named* error class, so it is cleanly distinguishable from a transient session-store failure — an acknowledged-and-dropped path for that one class would be a small, safe follow-up. Deliberately not done here: it is unrelated to this plan's surface and would have widened a deploy-day change.
- **Per-topic PCD attribution** below block granularity (which single topic in `/webhooks/orders` and which in `/webhooks/companies` are exempt) was not settled; repeated probes disagreed. Zero action value — PCD Level 1 is required either way.

## Known Stubs

None. Every function this plan added has a working implementation and at least one test; no TODO/FIXME markers, no placeholder returns, no skipped tests in any file it created or modified.

## Threat Flags

None. No new endpoint, auth path or trust boundary was introduced. The scope set is exactly the four reads the threat register allows (T-02-23), secrets never entered argv or script text (T-02-22), the CLI-rewrite hazard was byte-diffed after every invocation (T-02-21), and all four new deployed surfaces have forged-HMAC 401 assertions in the committed smoke gate (T-02-24).

## Self-Check: PASSED

- All 13 claimed files exist on disk; `git diff --stat b0dad4d..HEAD` lists exactly those 13, with zero deletions (`git diff --diff-filter=D` empty).
- All claimed commits resolve in `git log`: `77e7413`, `be5a6c2`, `3f4ee16`, `25f36ef`.
- `npm test -- --run` → **194 passed / 11 files** (184 inherited + 10 new); `npm run typecheck`, `npm run lint`, `npm run build`, `npm run graphql-codegen` → all exit 0.
- Flake check: the full suite was run **127 consecutive times** (12 + 40 + 75) with 127 passes and 0 failures. Worth doing here because every suite shares one Postgres database with `fileParallelism: false`, and this plan added tests that assert on row counts.
- `bash scripts/smoke-deployed.sh app.creditguardhq.com` → exit 0 with all six 401 assertions executed.
- `bash scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com` → valid JSON (parsed).
- **CF-5:** `shopify.app.toml` is byte-identical to its pre-CLI snapshot (`cmp` clean) — checked after `railway up`, after both `shopify app deploy --allow-updates` attempts, after every `--no-release` probe (each of which restored the file and re-compared), and after both `shopify app webhook trigger` calls. `api_version = "2026-07"` count 1; `application_url = "https://app.creditguardhq.com"` count 1; `automatically_update_urls_on_dev = false` count 1. The CLI did **not** attempt a rewrite at any point in this run.
- Script hygiene greps re-run: error-suppressing constructs 0 per script; `SHOPIFY_API_SECRET=` assignments 0; credential literals under `scripts/` 0.
- `shopify app versions list` → active version still `credit-guard-net-terms-3`; the `--no-release` probes published nothing.
- `.planning/STATE.md` and `.planning/ROADMAP.md` untouched by this plan; nothing pushed.

---
*Phase: 02-ar-ledger-credit-engine*
*Completed: 2026-08-19*

---

## ADDENDUM — 2026-08-19: approvals granted, version creation UNBLOCKED

**Supersedes the two EXECUTION-BLOCKING entries in § Outstanding human checks.**

The user configured Protected customer data (data access only — **no** protected
customer *fields* selected, so the app stays under Level 1 requirements; reason:
App functionality) and submitted the `read_all_orders` access request. Both are
now in effect.

**Verified by probe, not assumed** — `shopify app deploy --no-release` (publishes
nothing) at 2026-08-19:

```
Running validation ...
New version created.
  credit-guard-net-terms-4
```

Validation passed with the full CF-1 scope set and all fifteen webhook topics
declared. The eight protected-customer-data topic rejections and the
`app_access → scopes: read_all_orders` error are gone. `shopify.app.toml` was
byte-identical after the probe (CF-5 guard held).

### Correction to a prior assumption

Earlier planning treated PCD approval as a prerequisite to clear *before*
continuing. It is not: Shopify does **not** review a protected-customer-data
request until the App Store listing is submitted. What actually unblocked
version creation was configuring the request plus the `read_all_orders` grant —
review of the PCD request itself happens later, as part of app review.

Practical consequence: PCD is **not** a gate on Phases 3–6. Development and
dev-store testing proceed normally (dev stores are exempt); the PCD request is
reviewed alongside the listing at Phase 6 submission.

### State now

- Version `credit-guard-net-terms-4` exists but is **NOT released** — active
  version is still `credit-guard-net-terms-3`. Releasing it activates the new
  scope set and the fifteen subscriptions, and will require re-consent on the
  dev store (a scope change).
- The three empirical checks (D9 backfill-vs-admin, D10 A2 partial-pay→refund,
  A7 `__parentId` shape) remain `status: unknown`. They are no longer *blocked*
  — they now need: release the version, accept the consent prompt on
  `credit-guard-demo.myshopify.com`, create B2B net-terms test orders, then run
  README § Empirical dev-store checks.

### Still open, unchanged

- Filing is done; **approval** of the PCD request lands with app review (Phase 6).
- WINDOWS.md item 3 (SessionNotFoundError → 500 retried ~48h) is untouched by this.

## KNOWN GAP — partial payments are Plus-only (recorded 2026-08-19)

**A2's partial-pay→refund sequence cannot be exercised on this dev store, by design
of Shopify's plan tiers — not by misconfiguration.**

`.planning/research/FEATURES.md:20` predicted this: *"Deposits / partial payments /
payment per fulfillment — **Plus-only**. App's ledger must read `partially_paid`
status and outstanding amounts correctly, but never process payments."* The dev
store emulates **Basic**, so the admin offers no partial-payment control, and a
refund cannot precede a capture.

### Why this is acceptable rather than a hole

Credit Guard's ICP is Basic/Grow/Advanced merchants — the segment that gained
native B2B in April 2026 and that the B2B suites price out. Those merchants collect
by cheque or wire and mark orders paid in the admin; partial payments are not part
of their workflow. The path A2 exercises is one most target customers cannot use.

The ledger reads `financial_status` and `totalOutstandingSet` from Shopify rather
than maintaining a parallel payments record (FEATURES.md:40), so tier differences
change the *inputs* it observes, not the arithmetic it performs. `partially_paid`
handling is already covered against fixtures in 02-01's correctness matrix.

### Status

- **D10 (A2 partial-pay→refund) → `status: unknown`, cause changed** from "blocked
  on approvals" to "not reproducible on a Basic-tier store". Not claimed as passing.
- Full-payment and full-refund transitions REMAIN verifiable on Basic and are part
  of this run's checks.
- **To close before launch:** create a second dev store with **Plus** plan emulation
  (free, unlimited) and run the A2 sequence there. Plus merchants are the upsell
  tier and `partially_paid` is a real Shopify status the code already handles, so
  this deserves closing — but it is a pre-launch task, not a Phase 2 gate.

## EMPIRICAL RUN 2026-08-19 — partial results

Ran after v4 release + re-consent. Session confirmed holding all four scopes
(`read_all_orders,read_companies,read_orders,read_payment_terms`).

### A7 `__parentId` shape — **RESOLVED** (was 02-03's single open question)

Captured real bulk JSONL from operation `gid://shopify/BulkOperation/7418832388329`:

```
{"id":"gid://shopify/Order/7078414319849","name":"#1002",...}
{"id":"gid://shopify/PaymentSchedule/47618195689","dueAt":"2026-08-17T08:45:05Z",
 "completedAt":null,"__parentId":"gid://shopify/Order/7078414319849"}
```

`__parentId` names the **Order** gid, not the PaymentTerms gid. 02-RESEARCH.md's
claim was correct. 02-03's positional attribution with `__parentId` treated as
advisory produces the right result either way, so no code change is needed — the
conservative implementation is vindicated rather than invalidated.

### Backfill mechanics — WORKING

Bulk submit → JSONL reassembly → persist ran clean: 5 orders, 5 schedules,
4 companies, `status: completed` in ~3s. Amounts, currencies, payment-terms types
and due dates all landed correctly (e.g. #1005 `749.95 USD` NET, PENDING).

An earlier run failed `ACCESS_DENIED` — that was the token invalidated by the v4
scope change (session expired 07:49:45, 25s after release at 07:49:20). Expected
platform behaviour, not a defect. Cursor cleared and re-run succeeded.

### Exposure remained 0.0000 — NOT a defect

Every company read `exposure: 0.0000` despite 5 open net-terms orders, because
every order row had `companyId: null`.

Diagnosed to root cause rather than assumed:
1. Bulk JSONL returned `purchasingEntity: null` on every order line.
2. A **normal** (non-bulk) Admin API query for the same order also returned
   `purchasingEntity: null` — ruling out both a bulk-API limitation and a parser
   bug.
3. Conclusion: the test orders carry payment terms but have **no purchasing
   company**. Attaching Net terms to an ordinary order does not make it a B2B
   order; the customer must be the company.

`companyGidOf` correctly returned null and `upsertOrderFromSource` correctly
excluded them from exposure — the documented D2C path (Pitfall 7). **The ledger
behaved exactly as specified.** The empirical check did its job: it surfaced a
test-data problem that internal consistency alone would have hidden.

### Still unverified

- **D9 backfill-vs-admin (success criterion 1)** — needs orders whose customer is
  a company. Retest procedure: Draft orders → select a **company** as customer →
  complete. Two existing orders already carry past due dates (2026-08-17), so once
  company-attributed they also exercise the overdue sweep (LEDG-05).
- **D10 A2 partial-pay→refund** — blocked by the Plus-tier gap recorded above.

## CRITICAL FINDING — `purchasingEntity` requires `read_customers` (2026-08-19)

**Supersedes the "non-B2B test data" conclusion recorded earlier in this run.
That conclusion was WRONG.** The user's orders are correctly formed B2B orders
(company contacts Ayumu Hirano → Acme Supply, Russell Winfield → Northwind
Trading, Net 30, 4 orders each). In Shopify B2B the *customer contact* is
selected, not the company — the company association flows through the contact's
location.

### Root cause

Shopify returns an explicit GraphQL error, which the app was swallowing as `null`:

```
Access denied for purchasingEntity field.
Required access: The user must have access to customers and orders or draft orders.
extensions.requiredAccess: `read_customers` access scope   (on order.customer)
```

`Order.purchasingEntity` requires **`read_customers`**. The CF-1 scope set
(`read_orders,read_all_orders,read_payment_terms,read_companies`) deliberately
excludes it, so `purchasingEntity` is null for EVERY order regardless of whether
it is a B2B order.

### Impact if shipped unnoticed

`companyGidOf` → null → `companyId: null` on every order → `recomputeCompany`
sums an empty set → **every company reads `exposure: 0.0000` forever**, so no
company is ever blocked no matter what it owes. The app appears healthy:
companies sync, orders ingest, backfill reports `completed`, zero errors. This is
the exact "understates exposure → lets an over-limit buyer through" direction
PITFALLS.md flags as the failure that matters.

### Secondary defect (real, independent)

The GraphQL client **discards `errors[]` and treats a nulled field as absent**.
An ACCESS_DENIED on a load-bearing field must not be indistinguishable from
"this order has no company". Any fix must surface field-level GraphQL errors.

### Two remedies — company-side attribution is preferred

1. **Add `read_customers`** — one-line scope change, but pulls customer PII the
   app never needs, escalates PCD scrutiny toward Level 2, and directly
   contradicts both the CF-1 rationale and the published privacy policy, which
   states the app deliberately does not request it. **Rejected** unless option 2
   proves unworkable.
2. **Attribute from the company side** — VERIFIED WORKING this session with the
   current scopes:
   `company(id:…){ orders(first:N){ … totalOutstandingSet.shopMoney, paymentTerms{ paymentTermsType, paymentSchedules{ dueAt completedAt } } } }`
   returns everything the ledger needs, plus `companies{ ordersCount }` for
   reconciliation. Keeps Level 1, keeps the privacy policy true, keeps the
   "asked for less than it could have" review position.

### Scope of the change (NOT a patch)

Both the backfill (02-03) and the webhook refetch path (02-01/02-02) assume
`purchasingEntity`. Company-side attribution changes the backfill from a global
order sweep to a per-company enumeration, and the `orders/*` refetch needs a
company-side route or a company-scoped lookup. This warrants a planned fix, not
an inline edit.

### Status changes

- **D9 backfill-vs-admin — remains `unknown`**, now blocked on this defect rather
  than on test data. Test data is CORRECT and ready.
- LEDG-02/LEDG-03 must be re-verified after the fix: exposure has never been
  computed from a real company-attributed order.
