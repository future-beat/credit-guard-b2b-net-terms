# Phase 1: Foundation & Compliance - Context

**Gathered:** 2026-08-17
**Status:** Ready for planning

<domain>
## Phase Boundary

A deployed, review-compliant embedded admin shell: merchant can install the app on a dev store, complete OAuth, and land in an embedded Polaris admin; the three mandatory GDPR webhooks respond correctly (401 on bad HMAC); uninstall cleans up and re-install works; the app runs on an always-on host with Postgres and the Shopify API version pinned everywhere. No ledger, no enforcement, no emails, no billing — those are Phases 2–6.

</domain>

<decisions>
## Implementation Decisions

### Hosting & Environments
- **D-01:** Host on Railway (single production environment + Postgres). No staging environment — local `shopify app dev` tunneling to the dev store is the pre-production loop. — **Reversibility:** reversible — containerized Node app; moving hosts later is a redeploy + DNS change.
- **D-02:** Railway default US region (Shopify webhook infra is US-based; app UI is served inside Shopify admin, so AU proximity buys nothing).
- **D-03:** Sentry (free tier) wired in during scaffold — error tracking from day one, especially for webhook handlers.

### App Domain & Identity
- **D-04:** Buy a custom domain NOW (user's manual task) and serve the app from it from first deploy. It becomes the stable app URL (avoids re-verifying OAuth redirects/webhook subscriptions later) and the Phase-5 email sending domain (SPF/DKIM/DMARC reputation needs lead time). Availability shortlist: `creditguard.app`, `getcreditguard.com`, `creditguardapp.com`. — **Reversibility:** costly — changing the app URL after install-base exists means re-verifying every OAuth redirect and webhook subscription.
- **D-05:** Partner dashboard identity: app name "Credit Guard: B2B Net Terms", handle `credit-guard-net-terms`.

### Uninstall Data Retention
- **D-06:** On `app/uninstalled`: immediately deactivate (revoke tokens, stop scheduled jobs, mark shop inactive) but RETAIN merchant data (credit limits, settings, ledger). Hard-delete everything when Shopify's `shop/redact` webhook arrives (~48h after uninstall — researcher to pin exact timing). Re-installs within the grace window recover all settings painlessly; GDPR deletion is driven by Shopify's own redact signal. — **Reversibility:** reversible — retention window is a config change.

### Partner Account & Dev Store Logistics (user's manual tasks, in parallel)
- **D-07:** User creates the Shopify Partner account (US$19 one-time) and a development store with B2B enabled this week — Phase 1 success criteria require installing on a dev store. App registration happens via Shopify CLI during scaffold (one-time browser auth by user). User also purchases the chosen domain (Claude must not enter payment details — user completes checkout).

### Claude's Discretion
- Everything technical within the locked stack: template scaffolding details, TypeScript config, Prisma schema for sessions/shops, webhook routing structure, Sentry integration shape, deploy pipeline (Railway git-push deploy is fine), demo-data seeding approach.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research (project-level, verified Aug 2026)
- `.planning/research/SUMMARY.md` — synthesis: stack, architecture, phase rationale, confidence gaps
- `.planning/research/STACK.md` — prescriptive stack with versions (React Router 7 template, `@shopify/shopify-app-react-router` ^1.2, Prisma 6 + Postgres, Polaris web components via App Bridge CDN, API 2026-07 pinned)
- `.planning/research/PITFALLS.md` — Phase-1-relevant: GDPR webhook 401-on-bad-HMAC requirement, deprecated `@shopify/polaris` React trap, App Bridge latest requirement, plan-feature matrix pinning
- `.planning/research/ARCHITECTURE.md` — component boundaries the skeleton must leave room for (webhook ingestion path, scheduler, metafield publisher)

### Project
- `.planning/PROJECT.md` — constraints (2–4 week MVP, flat pricing, review compliance) and Key Decisions table
- `.planning/REQUIREMENTS.md` — FOUND-01..03 are this phase's contract

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — empty repo; this phase creates the codebase via `shopify app init` (React Router 7 template).

### Established Patterns
- None yet — patterns established here (webhook routing, session storage, error tracking) become the conventions for Phases 2–6.

### Integration Points
- Scaffold must leave clean seams for: webhook ingestion pipeline (Phase 2), scheduler loop (Phase 2/5), metafield publisher (Phase 3), Function extension directory (Phase 4).

</code_context>

<specifics>
## Specific Ideas

- Uninstall/reinstall must be a painless loop for merchants — settings survive the grace window (D-06); this is a deliberate merchant-experience stance, not just compliance.
- Keep infra minimal and cheap (single Railway service + Postgres) to preserve flat-fee margins — no queues, no extra services.

</specifics>

<deferred>
## Deferred Ideas

- Staging environment — revisit only if paying merchants exist and deploys become risky.
- AU-region hosting for data-residency marketing — revisit if AU merchants ever ask; not an MVP concern.

</deferred>

---

*Phase: 1-Foundation & Compliance*
*Context gathered: 2026-08-17*
