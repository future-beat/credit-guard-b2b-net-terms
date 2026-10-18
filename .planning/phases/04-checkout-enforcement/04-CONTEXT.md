# Phase 4 Context — Checkout Enforcement

**Gathered:** 2026-08-20 (post-research; three gray areas locked by user)

## Locked Decisions

### D4-01: Over-limit semantics — REMAINING-CREDIT
Block iff `exposure_cents + cart_total_cents > limit_cents`. Subsumes the
already-over case and closes the $1,499.99-of-$1,500 → $50,000-order hole.
ENFC-01 success-criteria wording must say "would exceed remaining credit".
At-limit exactly (sum == limit) is ALLOWED — consistent with Phase 3's
at-limit-is-within boundary (integer cents, never float).

### D4-02: Currency mismatch — SKIP LIMIT, KEEP OVERDUE
Compare integer cents only when `cart.cost.totalAmount.currencyCode ===
payload.currency`. On mismatch: skip the over-limit rule (fail open for that
rule only, per ENFC-04 posture); the overdue block STILL applies (boolean,
currency-independent). Never convert via presentmentCurrencyRate — a stale
rate false-blocking a paying customer is the instant-uninstall scenario.
Phase 6 dashboard surfaces affected companies ("over-limit enforcement
inactive — currency mismatch") so the hole is visible, not silent.

### D4-03: ENFC-05 re-scoped — TRANSITIONS + LEAKED ORDERS
Per-attempt block logging is a platform impossibility (validation runs are not
webhooked; 2026-07 has no bypassCartValidations — draft bypass is a UI action
with no API trace). ENFC-05 therefore records:
- state-transition events: company became blocked/unblocked, with
  exposure/limit/overdue snapshot at transition time;
- leaked-order events (ENFC-06): an order arriving via orders/create whose
  company was in a blocked state at ingest time — flagged to the merchant.
Requirement wording updated to match what is observable.

## Research corrections binding on the planner
- `bypassCartValidations` DOES NOT EXIST in 2026-07 — CLAUDE.md's claim is
  stale. Do not plan around it.
- Function input has NO payment-method/terms selection. Blocking a
  terms-bearing company's checkout IS the net-terms block (native B2B checkout
  on terms collects no payment at checkout). Prepay-by-card remains available
  via the merchant-side paths, not via a Function branch.
- Validation output shape: `operations[].validationAdd.errors[{message,
  target: "$.cart"}]` — not localizedMessage/flat errors from old tutorials.
- Registration: `validationCreate(functionHandle, enable: true,
  blockOnFailure: false)` — new scope `write_validations` required.
  blockOnFailure MUST stay false (fail-open on crash/timeout).
- Metafield read: `metafield(key: "credit_v1")` with namespace OMITTED — the
  app-reserved namespace resolves automatically in a Function input query.
