# Phase 2: AR Ledger & Credit Engine - Context

**Gathered:** 2026-08-19
**Status:** Ready for planning

<domain>
## Phase Boundary

The provably correct per-company outstanding-balance and due-date ledger: install backfill, webhook-driven recompute (dedupe, refetch-from-source, never incremental), correct handling of partial payments/refunds/edits, hourly overdue sweep, daily reconciliation sweep. This phase also builds the scheduler loop Phase 5 reuses. NO metafield publishing (Phase 3), NO checkout enforcement (Phase 4), NO emails (Phase 5), NO dashboard UI (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Exposure Definition (what counts against the credit limit)
- **D-01:** Exposure = sum of remaining `balanceDue` across a company's UNPAID and PARTIALLY-PAID net-terms payment schedules, net of refunds — from EVERY order source (checkout, draft, admin, POS; consistent with ENFC-06 counting bypassed orders). — **Reversibility:** costly — the semantics propagate into Phase 3 metafields, Phase 4 blocking, and merchant trust; changing them after launch changes what merchants' numbers mean.
- **D-02:** Excluded from exposure: card-paid orders (no credit extended), incomplete draft orders (no obligation yet), processing-state card payments. A partially-paid net-terms order counts at its REMAINING balance.
- **D-03:** Identity: exposure keys to the Company via `Order.purchasingEntity` (→ `PurchasingCompany`), NEVER `Order.customer` (which returns the company contact on B2B orders — documented Shopify attribution trap; see `.planning/research/SUMMARY.md` § Post-Research Findings).

### Overdue Semantics
- **D-04:** No grace period in v1. A company becomes overdue at the first sweep after any of its payment schedules passes `dueAt`. Rationale: the merchant chose the due date; zero-config is the positioning vs Flow; the per-company bypass (CRED-02) is the escape valve. Merchant-configurable grace period → deferred (v1.x).
- **D-05:** Overdue sweep runs HOURLY (cheap indexed query over due dates). Full source-of-truth reconciliation sweep runs DAILY. Both in the same node-cron in-process scheduler; scheduler must skip shops where `Shop.active = false` (carry-forward CF-3 — make this structural, not a comment).

### Backfill Scope
- **D-06:** Install backfill ingests ALL open (unpaid/partially-paid) net-terms orders regardless of age — no window. Understating exposure on day one is worse than surfacing stale disputes: observe-only default (CRED-04) plus the guided-setup "review balances" step makes old junk visible and non-blocking until the merchant acts.

### Multi-Currency
- **D-07:** Single ledger in the store's base currency using `shopMoney` amounts on every money field (Shopify's canonical conversion). Credit limits are denominated in store currency. No per-currency ledgers or limits in v1. Dashboard labels amounts with store currency (note for Phase 6).

### Claude's Discretion
- Everything technical: Prisma schema shape for orders/schedules/company balances, webhook topic set and scope list (CF-1 — decide the minimal scope set from the real query needs of this phase and record it), GraphQL query design, dedupe storage, bulk-query vs paginated backfill, test data design, chaos-test approach for webhook redelivery/reordering.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project research (verified)
- `.planning/research/SUMMARY.md` — architecture (recompute-from-source, webhook dedupe/reconciliation patterns), § Post-Research Findings (purchasingEntity attribution requirement — MUST for this phase), § Domain / DNS Constraints
- `.planning/research/ARCHITECTURE.md` — webhook ingestion path, credit engine as pure module (`recomputeCompany()` single code path), scheduler as correctness component
- `.planning/research/PITFALLS.md` — balance drift (killer bug #2), webhook at-least-once/out-of-order, no-webhook-for-time-passing

### Phase 1 outputs (established patterns)
- `.planning/phases/01-foundation-compliance/01-03-SUMMARY.md` — lifecycle service patterns, webhook topic constants (`topicForStorage` uppercase mapping), test isolation to creditguard_test, TDD red-first convention
- `.planning/phases/01-foundation-compliance/01-04-SUMMARY.md` — deployed smoke-test scripts, signed-webhook helper reuse, `railway ssh` production DB query pattern
- `.planning/phases/01-foundation-compliance/01-VERIFICATION.md` — carry-forwards CF-1 (scopes = "" must be decided THIS phase), CF-2 (purchasingEntity), CF-3 (Shop.active enforcement becomes load-bearing with this phase's scheduler), CF-5 (CLI rewrites api_version — re-grep after every shopify command), CF-6, W-2 (Sentry beforeSend scrubber has no test — add one when touching webhook paths)

### Config contracts
- `shopify.app.toml` — api_version MUST stay 2026-07; application_url and automatically_update_urls_on_dev MUST NOT change; compliance subscriptions already present
- `prisma/schema.prisma` — Session, Shop, ComplianceRequest models exist; this phase extends

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/services/shop-lifecycle.server.ts` — service-module pattern (pure functions, Prisma transactions, idempotency); extend alongside, don't fork the style
- `tests/helpers/webhook-hmac.ts` — signed-webhook test helper; reuse for order webhook tests
- `scripts/send-signed-webhook.sh`, `scripts/prod-lifecycle-state.{sh,mjs}` — deployed verification patterns
- vitest infra with creditguard_test isolation (pretest migrate; TEST_DATABASE_URL override with $USER-derived default)

### Established Patterns
- Webhook routes: `authenticate.webhook` → 401 pre-handler on bad HMAC; topic switch on UPPERCASE_UNDERSCORE constants; thin handler → service function
- TDD red-first with separate test/feat commits
- Deviations documented per-summary; secrets never in argv (sign HMACs via node, not openssl)

### Integration Points
- Scheduler loop is NEW in this phase (node-cron in-process) — must gate on Shop.active and be reused by Phase 5
- `app/routes/app.tsx` calls `ensureShopActive` — reinstall path already handled
- Webhook subscriptions added to shopify.app.toml [[webhooks.subscriptions]]; deploy syncs them (config publishes on EVERY deploy — keep TOML pristine)

</code_context>

<specifics>
## Specific Ideas

- "Balance correctness IS the product; a false block of a paid customer is an instant uninstall" (roadmap note) — chaos tests for duplicate/replayed/out-of-order webhooks are non-negotiable, not nice-to-have.
- Backfilled balances must match what the merchant sees in Shopify admin (success criterion 1) — verification should compare against admin-visible numbers, not internal consistency alone.

</specifics>

<deferred>
## Deferred Ideas

- Merchant-configurable overdue grace period (v1.x — weakens zero-config positioning now; bypass toggle covers exceptions)
- Per-currency ledgers/limits (multi-entity suite territory)

</deferred>

---

*Phase: 2-AR Ledger & Credit Engine*
*Context gathered: 2026-08-19*
