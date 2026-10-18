# Phase 1: Foundation & Compliance - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-17
**Phase:** 1-Foundation & Compliance
**Areas discussed:** Hosting & environments, App domain & identity, Uninstall data retention, Partner account & dev store logistics

---

## Area Selection

Four gray areas were presented (hosting & environments, app domain & identity, uninstall data retention, partner/dev-store logistics). The user asked for recommendations across all four instead of selecting a subset; Claude presented a recommendation per area and the user locked all four in a single gate.

---

## Hosting & Environments

| Option | Description | Selected |
|--------|-------------|----------|
| Railway, prod-only, Sentry day one | Research-backed ~US$10–15/mo; local `shopify app dev` is the pre-prod loop | ✓ |
| Fly.io (Sydney region) | AU proximity — rejected: Shopify webhook infra is US-based, UI served inside Shopify admin | |
| Render / prod+staging variants | More cost/ceremony with no pre-launch payoff | |

**User's choice:** Recommendation accepted ("Lock all four in")
**Notes:** Region = Railway US default.

---

## App Domain & Identity

| Option | Description | Selected |
|--------|-------------|----------|
| Buy custom domain now | Stable app URL + Phase-5 email domain needs DMARC lead time | ✓ |
| Launch on host subdomain | Cheaper today; costly URL migration later | |

**User's choice:** Recommendation accepted
**Notes:** Shortlist: creditguard.app, getcreditguard.com, creditguardapp.com. App name "Credit Guard: B2B Net Terms", handle `credit-guard-net-terms`. Domain purchase is the user's manual checkout.

---

## Uninstall Data Retention

| Option | Description | Selected |
|--------|-------------|----------|
| Wipe immediately on uninstall | Simplest compliance story; loses merchant settings on accidental uninstall | |
| Retain until shop/redact, then hard-delete | Deactivate immediately, keep settings for grace window (~48h — researcher to verify), delete on Shopify's redact signal | ✓ |

**User's choice:** Recommendation accepted
**Notes:** Claude corrected its own earlier ~90-day framing to ~48h during discussion; exact timing flagged for phase research.

---

## Partner Account & Dev Store Logistics

| Option | Description | Selected |
|--------|-------------|----------|
| User does Partner signup + B2B dev store this week, in parallel | Phase 1 success criteria need a dev store; only the user can do these | ✓ |

**User's choice:** Recommendation accepted
**Notes:** App registration via Shopify CLI during scaffold (one-time browser auth).

## Claude's Discretion

All technical implementation within the locked stack: scaffold details, TS config, Prisma schema, webhook routing, Sentry integration, deploy pipeline, demo-data seeding.

## Deferred Ideas

- Staging environment (revisit with paying merchants)
- AU-region hosting for data-residency marketing (revisit if AU merchants ask)
