# 06-DEBUG — Ingest latency: new orders (and "companies") take hours to count

**Investigated:** 2026-08-23, read-only, against branch `phase-06-dashboard-onboarding-launch` at `d1f60ce` plus live read-only probes of production (`scripts/prod-ledger-state.sh`, `scripts/prod-lifecycle-state.sh`, `railway logs`). No source was modified. No production write was made.
**Debug session file:** `.planning/debug/ingest-latency-orders-companies.md`
**Verdict:** submission-blocking defect, deterministic, architectural. Root cause confirmed with line citations and two live reproductions (one of them still unresolved at the time of writing).

---

## 1. Root cause

A net-terms order is attributed to its company — and therefore counts toward exposure, publishes `credit_v1`, and can trigger a checkout hold — by exactly **two** code paths:

| Path | Where | When it runs |
|---|---|---|
| Rung 2 of the resolution ladder | `app/services/ledger.server.ts` L1049–1080 (`ingestOrderEvent`) | Only on the **first** doorbell for an order the ledger has never seen, and only if the payload carried a `company` hint |
| `healAttribution` | `app/services/reconciliation.server.ts` L374–449 | Inside `runReconciliationSweep`, cron `30 3 * * *` (`app/services/scheduler.server.ts` L69) — **once a day at 03:30 UTC** |

Nothing else ever writes `attributionStatus = ATTRIBUTED` after install. (The install backfill, `app/services/backfill.server.ts` L304–341, is once-per-shop — `status: "completed"` short-circuits forever at L318–321 — and it only sees orders that exist at install time.)

Three conditions combine (all three are needed for the 24 h latency; this is an AND-gate, not a single cause):

### 1a. The one-shot attribution attempt at T0 yields nothing in production

Every live net-terms order observed so far took rung 3 and was persisted `UNRESOLVED`:

- 04-05 enforcement matrix (2026-08-21): 4/4 orders — "the `orders/create` payloads carried no company hint, so ingest took rung 3" (04-05-SUMMARY L245, L307); `reconcileShop` was driven by hand to proceed.
- #1014, #1015, #1016 (2026-08-21 07:00–07:50Z): UNRESOLVED until the 03:30Z cron on 2026-08-22 (06-06-SUMMARY L189).
- #1017 on credit-guard-demo: `Unattributed net-terms order gid://shopify/Order/7084914442473 … persisted UNRESOLVED` at **2026-08-22T11:52:42Z** (Railway deploy log). Attributed by the **2026-08-23T03:30Z** cron (reconciliation cursor `updatedAt: 2026-08-23T03:30:01Z`; Reviewer Test Co exposure now `841.65`). Latency: **15 h 38 min**.
- credit-guard-demo-2 (the fresh screenshot store): two orders, `persisted UNRESOLVED` at 05:01:01Z and 05:22:54Z on 2026-08-23. At 09:49Z: `attribution: {attributed: 0, unresolved: 2}`, Snowdevil `exposure: 0.0000` with `creditLimit: 900`, `dataComplete: false`. Next attribution opportunity: **2026-08-24T03:30Z (~22 h after the order)**.

Whether rung 2 is skipped (no `company` key in the payload) or fires-and-misses (the `company(id){orders}` edge has not indexed a seconds-old order yet) could **not** be settled read-only: the rung-2-miss signal is Sentry-only (`ledger.server.ts` L1072–1077) and no Sentry read credential is available. Two facts bear on it:

- The REST Order resource documents `"company": { "id", "location_id" }` exactly as `payloadCompanyHint` reads it (`app/routes/webhooks.orders.tsx` L97–115), so it is not a naming bug.
- Timing: the **first** doorbell for every new order takes 300–335 ms of server time; every **subsequent** one 150–200 ms (demo-2: 334 → 182 ms, 300 → 198 ms; demo #1017: 324 → 167 ms). A single extra ~150 ms is one Admin GraphQL round-trip — consistent with rung 2 *running the company scan and missing*, then falling to the rung-3 refetch. 04-05's "no hint" was an inference, not an observation.

The recommended fix (§4) is correct under either sub-cause, so this ambiguity does not block the fix.

### 1b. Rung 1 then traps the `UNRESOLVED` row on every later doorbell

`ingestOrderEvent` L1039–1046:

```ts
/* Rung 1 — known order. */
const existing = await db.ledgerOrder.findUnique({ where: { shop_orderGid: { shop, orderGid } }, select: { id: true } });
if (existing) {
  await refetchOrderAndRecompute(shop, orderGid);
  return;
}
```

`refetchOrderAndRecompute` (L963–991) calls `upsertOrderFromSource(shop, order)` **with no attribution argument**, which is preserve-mode by design (L633–637, L736–745: `update: attributionFields ? {...} : fields` — the three attribution columns are untouched). That is correct for an *attributed* order receiving `orders/paid` (D-01), but it also means an `UNRESOLVED` row is never re-examined. Shopify sends 3–5 more order-shaped doorbells within the first minute (`orders/updated`, `orders/paid`, `payment_terms/create`, …) — on demo-2 the next came **0.5 s** after the first — and every one of them takes rung 1.

The ladder's own doc comment (L1019–1024) says a rung-2 miss is healed because "orders/updated + orders/paid re-ring the doorbell shortly". **They re-ring rung 1, which cannot attribute.** The comment describes behaviour the code does not have.

### 1c. The only backstop is daily

`RECONCILIATION_CRON = "30 3 * * *"` (`scheduler.server.ts` L69). Worst case 24 h, mean 12 h, and for a merchant in the Americas or Europe creating orders during their working day, essentially always "tomorrow".

### What is NOT the cause (eliminated with evidence)

| Hypothesis | Evidence against |
|---|---|
| Read-side caching / reload not reflecting DB | `app/routes/app._index.tsx` L187–207 and `app.companies.tsx` L158–200 are direct Prisma reads; `headers` on both is `boundary.headers` (App Bridge CSP only, L927 / L871); no `Cache-Control`, no `shouldRevalidate`. Reload shows the DB faithfully — the DB is what is stale. |
| The 06-03 WINDOWS #10 exhaustion flip slowing/skipping attribution | `healAttribution` pages companies **before** the flip (L410–415 vs L440–447); the flip is gated on `UNRESOLVED` only; `NO_COMPANY` is never sticky — it is a heal candidate next sweep (`attributionStatus: { not: "ATTRIBUTED" }`, L380–382) and an `ordersCount` mismatch forces the re-page. No effect on orders that have a company. |
| `payloadCompanyHint` reading the wrong attribute | REST Order doc (fetched live): `company: { id, location_id }`; the code reads exactly that. |
| Fresh store's webhooks not registered / backfill stuck on a lease | demo-2: 21 receipts across `ORDERS_CREATE/UPDATED/CANCELLED`, `PAYMENT_TERMS_CREATE/DELETE`, `REFUNDS_CREATE`, `COMPANIES_UPDATE`; `unprocessedReceiptCount: 0`; backfill `completed` in 0.78 s (`04:52:32.810 → 04:52:33.594`); all three sweep leases held by the live deployment, none wedged. The TOML comment about a "10-minute poll fallback" (`shopify.app.toml` L126–128) describes the retired bulk-operation backfill and is stale. |
| Companies arriving late | `companies/create` → `upsertCompany` is a DB-only write with no Admin API call (`webhooks.companies.tsx` L93–101; `ledger.server.ts` L583–594). Live: `POST /webhooks/companies 200` in 23–63 ms; Reviewer Test Co's create landed 2026-08-22T11:45:33Z and the row existed when #1017 was placed at 11:52. **The company appears in seconds — with `0.00` exposure and, once its order lands, "· incomplete".** That is what the merchant reads as "companies are slow". |

---

## 2. Latency a merchant experiences today

| Event | Latency today | Source |
|---|---|---|
| **(a) New company** appears in Companies page | **Seconds** (Shopify delivery + ~25–60 ms server). But it shows `0.00` exposure / "· incomplete" until (b) resolves. | demo: company create 11:45:33Z, present by 11:52Z; handler is DB-only |
| **(b) New net-terms order** counts toward exposure, publishes `credit_v1`, can trigger a hold | **Until the next 03:30 UTC** — 0–24 h, mean ~12 h. Live: #1017 15 h 38 min; #1014–#1016 ≈ 19.5–20.5 h; demo-2 order of 05:22Z will be ≈ 22 h. During that window the dashboard shows the "Some balances may be incomplete" banner and the company's balance is wrong (understated — the direction that lets an over-limit buyer through). | Railway logs + `prod-ledger-state` on both stores |
| **(c) First backfill on install** | **~1 s** (demo: 8 orders / 4 companies in 1.02 s; demo-2: 0.78 s) — but it only covers orders that already exist. A reviewer who installs first and creates the order afterwards gets nothing from it. | backfill cursors on both stores |
| Once attributed → hold active at checkout | **Seconds**: `recomputeCompany` publishes `credit_v1` in the same handling (`ledger.server.ts` L937–942). | code |

**Reviewer Track B as it stands:** install → create company (appears, `0.00`) → create net-terms order (dashboard stays `0.00`, "incomplete" banner) → set limit → storefront checkout **not blocked** because `exposure` is still 0. Rejection as non-functional is the expected outcome unless the reviewer happens to test after 03:30 UTC the next day.

---

## 3. Answers to the five investigation questions

1. **Attribution path for a new order.** `orders/create` → `ingestOrderEvent(shop, gid, payloadCompanyHint(body))` (`webhooks.orders.tsx` L155). Attribution is company-side (D-03): rung 2 scans `company(id){orders}` for the gid. It runs **only on the first doorbell for an unknown gid**; all subsequent doorbells take rung 1 = preserve-mode refetch. After that: only (a) the daily reconciliation. (b) `companies/*` webhooks never attribute (DB-only head-row upsert). (c) The install backfill is once-per-shop and pre-dates the order. (d) Nothing else on `orders/create`.
2. **Company creation latency.** Near-instant via webhook (see §2a). demo-2's subscriptions are registered and receiving; backfill completed in <1 s; no lease wedge; no poll fallback is in play (that code path only applies to a `running` state older than 10 min — `STALE_AFTER_MS`, `backfill.server.ts` L87).
3. **Read-side caching.** None. Eliminated (§1 table).
4. **#10 fix interaction.** None. Eliminated (§1 table). One note for whoever adds a faster attribution tick: the exhaustion flip must stay on the daily cadence only — running it every few minutes would race the company-edge lag and flip fresh orders to `NO_COMPANY` (self-healing next tick, but it would make `dataComplete` and exposures flicker).
5. **Live datapoints (2026-08-23T09:48–09:49Z):**
   - **credit-guard-demo:** 4 companies / 17 orders / 15 schedules; attribution `15 / 0 / 2` (attributed / unresolved / noCompany); `dataComplete: true`; backfill `completed` 2026-08-19T13:32:39Z (1.02 s); reconciliation cursor `2026-08-22T11:47:49Z`, last run `2026-08-23T03:30:01Z`; 257 receipts, 0 unprocessed; latest receipts are the hourly `COMPANIES_UPDATE` echoes of our own `credit_v1` publishes (:00 sweep). #1017 → Reviewer Test Co attributed at the 03:30Z cron; Reviewer Test Co `exposure 841.65`, `creditLimit 500`, `bypass false` (i.e. the hold is now correct — 15.6 h late).
   - **credit-guard-demo-2** (fresh, installed 2026-08-23T04:52:32Z): 2 companies (Powderbound, Snowdevil — both pre-existing sample companies, present from backfill) / 2 orders / 1 schedule; attribution `0 / 2 / 0`; `dataComplete: false`; Snowdevil `exposure 0.0000`, `creditLimit 900.00`; reconciliation cursor `04:47:32Z`, **never run yet** (first tick 2026-08-24T03:30Z); 21 receipts, 0 unprocessed; receipt sequence for the open order: `PAYMENT_TERMS_CREATE` 05:22:48/05:22:54, `ORDERS_UPDATED` 05:22:54.405, `ORDERS_CREATE` 05:22:54.947, (second order cancelled 05:23:29–30 with `REFUNDS_CREATE`, `PAYMENT_TERMS_DELETE`, `ORDERS_CANCELLED`), `COMPANIES_UPDATE` 05:23:53 / 05:24:17 (our own limit-set publishes).
   - **Sweep leases** (global): `overdue-sweep` / `reconciliation` / `reminder-sweep` all held by deployment `6eb73f54…`; `lockedUntil` values are in the past (released normally). New deployment `60c439c5…` started 09:35Z and will claim on its next tick.
   - Third shop row `uvszh1-m5.myshopify.com` is `active: false` (uninstalled, retained per D-06) — not relevant.

---

## 4. Fix options, ranked

All options keep the Phase-2 invariant: **attribution evidence is only ever Shopify's authenticated `company(id){orders}` edge** (T-02-26). None trusts the payload. None needs a new scope.

| # | Option | What changes | Latency after fix | API cost | Risk | Submission-safe? |
|---|---|---|---|---|---|---|
| **1** | **Re-attempt attribution on later doorbells** (rung-1 retry) | In `ingestOrderEvent` rung 1, select `attributionStatus, hasPaymentTerms` instead of just `id`; if the row is not `ATTRIBUTED` and has terms: with a hint → run the rung-2 scan; without a hint → `enumerateCompanies(shop)` and page only companies whose `ordersCount` ≠ local attributed count (the exact invariant `healAttribution` already uses, L410–412), upserting the matched node with `kind: "company"` + `recomputeCompany`. Then fall through to the preserve-mode refetch as today. | **Seconds** in the common case — Shopify sends 3–5 further doorbells within ~60 s of `orders/create`. Misses again only if the company edge is still un-indexed at the retry, which is why #2 is also needed. | +1 GraphQL call per doorbell **only while a row is unresolved** (+1 companies page for the hint-less branch). Bounded by `MAX_ATTRIBUTION_PAGES`. | Low — reuses `forEachCompanyOrder`, `upsertOrderFromSource`, `recomputeCompany`, `enumerateCompanies`; the rung tests in `tests/webhooks.orders.test.ts` and the chaos suite cover the surrounding contract. Must also fix the L1019–1024 comment. | **Yes** |
| **2** | **Minutes-scale attribution backstop** (new cron, own lease) | New `ATTRIBUTION_HEAL_CRON = "*/5 * * * *"` in `scheduler.server.ts` with lease `attribution-heal`. Per active shop: one indexed DB check — `ledgerOrder.findFirst({ shop, attributionStatus: "UNRESOLVED", hasPaymentTerms: true })` (this is `shopDataComplete`, `metafields.server.ts` L202–208) — and **only if** something is unresolved, run the heal half of `healAttribution` (enumerate companies, re-page mismatched ones, recompute). **Do not run the NO_COMPANY exhaustion flip here** — leave that to the daily sweep (§3 Q4). Needs a small extraction from `reconciliation.server.ts` (heal vs. flip) or a `{ flip: false }` parameter. | **≤ 5 min** worst case, regardless of whether any further doorbell arrives. | Zero when nothing is unresolved (one cheap DB read per shop per 5 min). When something is: 1 companies page + 1 orders page per mismatched company. | Low–medium — new cron + lease (pattern exists three times already; `tests/scheduler.test.ts` has the source-guard for `forEachActiveShop`). Must stay idempotent (it is — same upserts). | **Yes** |
| **3** | **Delayed self-retry after a rung-3 persist** | After `upsertOrderFromSource(..., { kind: "unresolved" })` for a net-terms order, schedule an in-process `setTimeout(60_000)` that re-runs the attribution attempt for that gid (same body as #1). | ≤ 60–90 s even with no further doorbell. | 1–2 GraphQL calls per unresolved order, once. | Medium — timers die on deploy/restart (#2 catches that); needs a drain hook like `awaitBackfillIdle`. Cheap but strictly weaker than #2. | Yes, but only as a complement |
| **4** | **"Refresh balances" action** in the data-incomplete banner / Companies page | New dashboard intent (closed-set dispatch like the existing ones, `app._index.tsx` action) that runs the #2 heal for `session.shop`, rate-limited (e.g. one run per shop per 60 s, stored on `Shop` or via the lease). | On demand — gives the reviewer and the merchant agency *and* a visible explanation. | Same as #2, user-triggered. | Low–medium — UI + action + rate limit; T-06-01 shop scoping via session only. | Yes |
| 5 | Reconciliation every 10 min instead of daily | Change `RECONCILIATION_CRON`. | ≤ 10 min | Cursor scan is incremental (cheap), but the "belt" re-pages **every** company whenever anything is unresolved, and the exhaustion flip would run every 10 min. | **Medium–high**: the flip racing edge lag would mark fresh orders `NO_COMPANY`, making `dataComplete`/exposure flicker; more API per large merchant. #2 is this option with the dangerous half removed. | Works, but not recommended as-is |
| 6 | Subscribe to a webhook that carries the company | — | — | — | **Not viable**: `orders/create` already carries `company` (when it does); there is no "company placed an order" topic; `companies/update` does not fire on order placement (verified on demo-2: the only `COMPANIES_UPDATE`s at order time are our own metafield-publish echoes). | n/a |
| 7 | Add `read_customers` and attribute order-side from `purchasingEntity` | Scope + query change | Seconds | 0 extra | **High**: PII scope the app does not need, PCD Level 2 implications, re-consent for every store, and the 02-05 CF-1 posture explicitly rejects it. App review scrutiny goes up, not down. | **No — not before submission** |

### Recommendation

**Ship #1 + #2 together** (and #4 if there is budget — it is the best UX answer to "refreshing the page is not helpful" and a natural home is the existing "Some balances may be incomplete" banner).

- #1 makes the reviewer's flow work in **seconds** in the overwhelmingly common case (several doorbells follow every order).
- #2 guarantees a **≤ 5 min** ceiling with no reliance on Shopify sending another doorbell and with ~zero steady-state cost, and it also covers #1's residual miss (edge still lagging at the retry).
- Together they turn the exposure-understatement window — "the direction that lets an over-limit buyer through" (`shopify.app.toml` L16–21's own words) — from up to 24 h into minutes.

Also in the same change, because they now describe false behaviour:
- `ledger.server.ts` L1019–1024 (rung-2-miss "healed by later doorbells" comment) and L1096–1099 (the rung-3 warning text "until reconciliation attributes it" → "until the attribution heal").
- `shopify.app.toml` L126–128 (10-minute poll fallback comment — the bulk-operation backfill it refers to was replaced in 02-07).
- `app._index.tsx` L115 banner body could add "usually within a few minutes" once #2 is live.

Regression test to add (Phase 1A guardrail): in `tests/webhooks.orders.test.ts`, an order whose first doorbell's `CompanyOrdersForLedger` page does **not** contain the gid (UNRESOLVED persisted), followed by an `orders/updated` whose page **does** — must end `ATTRIBUTED` with nonzero exposure. That test fails today (rung 1 preserves) and is the exact shape of the defect. Boundary neighbours: a card-paid (no-terms) order must not trigger the retry; an already-`ATTRIBUTED` order must still be preserve-mode (the existing D-01 test).

---

## 5. Must-fix before submission vs. can ship

**MUST fix before submitting (blocking):**
- #1 + #2 (or at minimum #2). Without them Track B of the reviewer instructions in `06-LISTING.md` cannot pass inside one sitting, and the merchant-facing promise — "no B2B customer places a new order when over limit" — is false for up to 24 h after every order.
- The two stale comments above, so the next person does not rely on the "later doorbells heal it" claim.

**Can ship after submission:**
- #4 (refresh action) — UX polish; the fix above removes the need for it, it just makes the state legible.
- #3 — redundant once #2 exists.
- Settling whether the live payload actually carries `company` (needs a Sentry look for "Order attribution miss" warnings, or one captured payload). Useful for the knowledge base, not for the fix.

**Operational note for the live drive / screenshots (no code):** until the fix is deployed, after creating a net-terms order on either demo store, attribution can be forced by invoking the app's own `reconcileShop` inside the container via `vite-node` (the 04-05 / 06-06 mechanism) — or simply wait for 03:30 UTC. Do not hand-edit ledger rows.

---

## 6. Evidence index

- `app/routes/webhooks.orders.tsx` L97–115 (`payloadCompanyHint`), L143–157 (dispatch → `ingestOrderEvent`)
- `app/services/ledger.server.ts` L633–637 and L736–745 (preserve-mode), L963–991 (`refetchOrderAndRecompute`), L1013–1031 (ladder doc incl. the wrong "re-ring" claim), L1039–1046 (rung 1), L1049–1080 (rung 2), L1083–1101 (rung 3, warning at L1096–1099), L937–942 (recompute publishes `credit_v1`)
- `app/services/reconciliation.server.ts` L374–449 (`healAttribution`: heal then flip)
- `app/services/scheduler.server.ts` L67–69 (cron strings), L116–140 (`forEachActiveShop`)
- `app/services/backfill.server.ts` L87 (`STALE_AFTER_MS`), L207–229 (claim), L311–341 (once-per-shop)
- `app/routes/webhooks.companies.tsx` L93–101; `app/routes/app.tsx` L46–58; `app/routes/app._index.tsx` L113–115, L187–207, L927; `app/routes/app.companies.tsx` L158–200, L871
- `app/services/metafields.server.ts` L202–208 (`shopDataComplete`)
- `.planning/phases/04-checkout-enforcement/04-05-SUMMARY.md` L245, L307; `.planning/phases/06-dashboard-onboarding-launch/06-06-SUMMARY.md` L189; `.planning/phases/02-ar-ledger-credit-engine/02-06-SUMMARY.md` L56, L140
- Live: `scripts/prod-ledger-state.sh` on `credit-guard-demo.myshopify.com` and `credit-guard-demo-2.myshopify.com` at 2026-08-23T09:48–09:49Z; `scripts/prod-lifecycle-state.sh` (shop enumeration); `railway logs -d` for deployments `6eb73f54…` (2026-08-22T08:41 → 2026-08-23T09:35) and `60c439c5…`
- REST Order resource doc (shopify.dev, fetched 2026-08-23): `company: { id, location_id }` on the order payload shape
