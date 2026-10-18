# Phase 2: AR Ledger & Credit Engine - Discussion Log

> **Audit trail only.** Decisions live in CONTEXT.md.

**Date:** 2026-08-19
**Areas discussed:** Exposure definition, Overdue semantics, Backfill scope, Multi-currency stance

## Format

Four gray areas were presented; the user asked for recommendations across all of them (same pattern as Phase 1). Claude presented one recommendation per area with rationale; the user locked all four in a single gate ("Lock all four in").

| Area | Recommendation accepted |
|---|---|
| Exposure definition | Net-terms unpaid/partially-paid balances only, net of refunds, all order sources; card-paid and incomplete drafts excluded; keyed via purchasingEntity |
| Overdue semantics | No grace period in v1; hourly overdue sweep; daily reconciliation; grace period deferred to v1.x |
| Backfill scope | All open net-terms orders, no age window; observe-only default + guided review makes stale items visible instead of hidden |
| Multi-currency | Single base-currency ledger via shopMoney; limits in store currency; per-currency deferred |

## Claude's Discretion

All technical implementation: schema shape, webhook topics + minimal scope set (CF-1), query design, dedupe storage, backfill strategy, chaos-test design.

## Deferred Ideas

- Merchant-configurable grace period (v1.x)
- Per-currency ledgers/limits
