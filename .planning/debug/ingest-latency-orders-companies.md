---
status: diagnosed
trigger: "it takes a long time to fetch new data like orders and companies — refreshing the page is not helpful either. Newly created companies and net-terms orders do not appear in Credit Guard's Companies page / dashboard for a long time (minutes to hours+); orders #1014-#1016 stayed UNRESOLVED until the 03:30Z daily reconciliation cron."
created: 2026-08-23T00:00:00Z
updated: 2026-08-23T10:05:00Z
symptoms_prefilled: true
goal: find_root_cause_only
---

## Current Focus

hypothesis: CONFIRMED — see Resolution.
test: done
expecting: n/a
next_action: Deliverable written to .planning/phases/06-dashboard-onboarding-launch/06-DEBUG-ingest-latency.md; fix is a separate plan (not applied — goal was find_root_cause_only).
bug_class: Bohrbug (deterministic: every hint-less/edge-lagged new order waits for the 03:30Z cron)

reasoning_checkpoint:
  hypothesis: "A new net-terms order is attributed to its company ONLY by (i) rung 2 of ingestOrderEvent at the very first doorbell, or (ii) the daily 03:30Z reconciliation. Rung 2 yields nothing at T0 in production (observed 100% of live cases: 04-05 matrix x4, #1014-#1017, demo-2 x2), and rung 1 then traps the UNRESOLVED row on every later doorbell (preserve-mode), so attribution — and therefore exposure, the credit_v1 metafield and the checkout hold — waits up to 24h."
  confirming_evidence:
    - "ledger.server.ts L1039-1046: rung 1 fires on ANY existing row and calls refetchOrderAndRecompute → upsertOrderFromSource(shop, order) with attribution omitted → L736 update leaves attribution columns untouched"
    - "Live demo-2 (fresh store, installed 04:52Z): ORDERS_UPDATED 05:22:54.405Z (first doorbell, 334ms, console 'persisted UNRESOLVED'), ORDERS_CREATE 05:22:54.947Z (182ms), 3 more order doorbells at 05:23:35 — at 09:49Z still unresolved:2, attributed:0, Snowdevil exposure 0.0000 with creditLimit 900, dataComplete:false"
    - "Live demo: #1017 'persisted UNRESOLVED' 2026-08-22T11:52:42Z; Reviewer Test Co exposure 841.65 only after 2026-08-23T03:30Z cron (cursor updatedAt 03:30:01Z)"
    - "scheduler.server.ts L69: RECONCILIATION_CRON = '30 3 * * *'; reconciliation.server.ts L374 healAttribution is the only other attribution writer"
  falsification_test: "If a new net-terms order's company exposure moved within minutes of orders/create on any live store, the hypothesis is wrong. Observed: never (7/7 live orders waited for cron or manual reconcileShop)."
  fix_rationale: "Root cause is 'attribution is attempted exactly once at T0 and then only daily'. The fix must (a) re-attempt attribution on later doorbells for non-ATTRIBUTED net-terms rows and (b) add a bounded, minutes-scale backstop that runs only while something is UNRESOLVED — both reuse existing company-edge scan code, neither trusts the payload."
  blind_spots: "Whether the payload `company` hint is present on live deliveries is not directly observed (Sentry-only signal, no read credential). Timing (+150ms on first doorbell only) suggests rung 2 fires and misses on a lagging company→orders edge; 04-05 inferred 'no hint'. The recommended fix is correct under either sub-cause. Company.ordersCount consistency at T0 is also unverified."
  candidate_causes:
    - "code: rung 1 short-circuit preserves UNRESOLVED forever between sweeps (CONFIRMED, primary)"
    - "environment/platform: Shopify company→orders edge not yet indexed at orders/create time, or company attribute redacted from payload (CONTRIBUTING — one of the two, undetermined which)"
    - "config: reconciliation cadence is daily (CONTRIBUTING — sets the 24h ceiling)"
    - "data/read-side caching (ELIMINATED)"
  and_gate: "yes — failure requires (rung-2 miss at T0) AND (rung-1 trap on later doorbells) AND (daily-only backstop). Removing any one bounds the latency: a hit at T0 → instant; a rung-1 retry → seconds (if edge indexed by then); a minutes-scale backstop → minutes."

## Symptoms

expected: A newly created company appears in Companies page within seconds of companies/create; a new net-terms order counts toward the company's exposure within seconds of orders/create; a page reload reflects DB state.
actual: Companies/orders take minutes to hours to appear; reload doesn't help. Orders #1014/#1015/#1016 (created 2026-08-21 ~07:00-07:50Z) stayed UNRESOLVED until the 03:30Z reconciliation on 2026-08-22.
errors: none reported
reproduction: On a fresh dev store: install → create company → create net-terms order → open Credit Guard dashboard → empty/zero until next cron.
started: Always (architectural — since Phase 2 company-side attribution fix)

## Eliminated

- hypothesis: Dashboard/Companies loaders cache or suppress revalidation so reload shows stale data
  evidence: Loaders are direct Prisma reads; headers are boundary.headers only; no Cache-Control/shouldRevalidate
  timestamp: 2026-08-23T00:25Z
- hypothesis: The #10 exhaustion flip (06-03) skips/slows attribution of orders that have a company
  evidence: healAttribution pages companies BEFORE the flip; flip gated on UNRESOLVED only; NO_COMPANY is re-healed next sweep (candidates = not ATTRIBUTED; ordersCount mismatch forces re-page)
  timestamp: 2026-08-23T00:20Z
- hypothesis: payloadCompanyHint reads the wrong attribute name
  evidence: REST Order doc confirms company:{id,location_id}; code reads exactly that
  timestamp: 2026-08-23T00:26Z

## Evidence

- timestamp: 2026-08-23T00:05Z
  checked: app/routes/webhooks.orders.tsx L117-215 + app/services/ledger.server.ts L1033-1102 (ingestOrderEvent ladder)
  found: orders/create → ingestOrderEvent(shop, gid, payloadCompanyHint(body)). Rung 1 (L1039-1046): ANY existing LedgerOrder row → refetchOrderAndRecompute → upsertOrderFromSource(shop, order) with attribution OMITTED = preserve-mode (L736-745: update leaves companyId/attributionStatus untouched). Rung 2 (L1049-1080): only runs when NO row exists AND payload carries company:{id}. Rung 3 (L1083-1090): persists UNRESOLVED.
  implication: Once a row is UNRESOLVED, every later orders/updated / orders/paid / orders/edited doorbell hits rung 1 and never re-attempts attribution. The doc comment at L1023-1024 ("orders/updated + orders/paid re-ring the doorbell shortly") is wrong — they re-ring rung 1, which preserves UNRESOLVED. Only reconciliation can attribute it.

- timestamp: 2026-08-23T00:06Z
  checked: .planning/phases/04-checkout-enforcement/04-05-SUMMARY.md L245, L307; 06-06-SUMMARY L189
  found: Live 2026-08-21 matrix: "The orders/create deliveries carried no company hint, so ingest took rung 3" — all four live orders UNRESOLVED until reconcileShop was driven by hand. 06-06: #1014-#1016 stayed UNRESOLVED until 03:30Z cron. 02-06 deviation 4: the company:{id,location_id} attribute name was never confirmed against a real payload (Shopify AI Toolkit unavailable).
  implication: In production the payload hint is ALWAYS absent → rung 2 never fires → every net-terms order takes rung 3 → attribution waits for the daily 03:30Z cron. This is deterministic, not a race.

## Evidence (cont.)

- timestamp: 2026-08-23T00:20Z
  checked: app/services/scheduler.server.ts L67-69; app/services/reconciliation.server.ts L374-449 (healAttribution)
  found: RECONCILIATION_CRON = "30 3 * * *" (daily 03:30Z). healAttribution is the ONLY code path besides rung 2 and the install backfill that attributes an order to a company; it runs once a day. The #10 exhaustion flip runs AFTER the heal pass, gated on UNRESOLVED, and NO_COMPANY is re-healed next sweep (candidates = not ATTRIBUTED) — it does not slow companied orders.
  implication: Worst-case attribution latency for a hint-less order = time until next 03:30Z (up to 24h). Mean ~12h.

- timestamp: 2026-08-23T00:22Z
  checked: app/routes/webhooks.companies.tsx L93-101; app/services/backfill.server.ts L207-341
  found: companies/create → upsertCompany (DB-only, no Admin API) — should be instant on delivery. Backfill is once-per-shop: status "completed" short-circuits forever (L318-321); it only re-runs after "failed". On a fresh store with zero companies it completes in ~1s with nothing, and nothing ever re-runs it.
  implication: Company latency should be webhook-delivery latency (seconds) unless delivery fails. Backfill cannot catch orders created after install.

- timestamp: 2026-08-23T00:25Z
  checked: app/routes/app._index.tsx L187-207, L927; app/routes/app.companies.tsx L158-200, L871; app/services/dashboard.server.ts header
  found: Both loaders read Postgres directly with no memoization; `headers` = boundary.headers (App Bridge CSP only); no Cache-Control on app routes; no shouldRevalidate suppression.
  implication: Reload faithfully shows DB state. The DB itself is stale. Eliminates read-side caching.

- timestamp: 2026-08-23T00:26Z
  checked: REST Order resource doc (shopify.dev/docs/api/admin-rest/latest/resources/order), fetched live
  found: Documented order payload shape includes `"company": { "id": 182772, "location_id": 753095 }` — payloadCompanyHint's attribute name is correct.
  implication: The absence of the hint on live deliveries is not a naming bug. Most likely the field is redacted from webhook payloads for an app without approved protected-customer-data fields / read_customers (the same regime that nulls purchasingEntity). Mechanism unproven from docs, but the live absence is established (04-05 L245).

## Resolution

root_cause: "Order→company attribution is attempted exactly once, at the first order doorbell (ingestOrderEvent rung 2), and in production that attempt yields nothing (company hint absent or company→orders edge not yet indexed). Every later doorbell hits rung 1 (existing row) which is preserve-mode and never re-attempts attribution; the only remaining attributor is healAttribution inside the daily 03:30Z reconciliation. Net-terms orders therefore sit UNRESOLVED (zero exposure, no credit_v1 change, no checkout hold) for up to 24h. Companies themselves arrive in seconds via companies/create; what the merchant perceives as 'slow companies' is the company's balance staying 0.00 / '· incomplete'."
fix: "(not applied — diagnose-only) Recommended: (1) in ingestOrderEvent rung 1, when the existing row is not ATTRIBUTED and has payment terms, re-run the company-edge attribution (hint scan, else bounded company scan by ordersCount mismatch) before the preserve-mode refetch; (2) add a 5-minute 'attribution-heal' cron on its own lease that runs only for shops with UNRESOLVED net-terms rows and does NOT run the NO_COMPANY exhaustion flip; (3) optional: 'Refresh balances' action in the data-incomplete banner."
verification: "n/a (diagnose-only)"
files_changed: []
