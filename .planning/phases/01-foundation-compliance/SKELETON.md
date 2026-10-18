# Walking Skeleton — Credit Guard: B2B Net Terms

**Phase:** 1
**Generated:** 2026-08-17

## Capability Proven End-to-End

A merchant installs the app on a B2B dev store, completes managed OAuth, and lands in an embedded "Credit Guard" Polaris admin shell served by the deployed app — with the session persisted to Postgres and /healthz answering on the production domain.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | React Router 7 via `shopify-app-template-react-router` (official template, template-pinned dependency majors) | Current official Shopify scaffold; managed installation + token exchange means zero custom OAuth code (CLAUDE.md stack lock; research Pattern 1) |
| Auth | Shopify managed installation + session-token auth via `@shopify/shopify-app-react-router` (template `^1.1.0` major — do NOT hand-upgrade to the week-old 2.x) | Hand-rolled OAuth is the #1 app-review liability; the library 401s bad webhook HMACs for free |
| Data layer | Postgres 16+ (Railway managed in prod, local `creditguard_dev`/`creditguard_test` in dev/test) + Prisma 6, provider `postgresql` from day one | One provider everywhere — migrations generated once, `prisma migrate deploy` runs in Railway's release phase (`docker-start`); production-faithful tests |
| UI | Polaris **web components** (`s-*`) via App Bridge CDN script — never the deprecated Polaris React npm package | 2026 admin standard; CDN auto-latest satisfies the "latest App Bridge" review check permanently (UI-SPEC hard rules) |
| Deployment target | Railway, single always-on service + Postgres, default US region, custom domain `app.<domain>` with auto-TLS, healthcheck `/healthz` | D-01/D-02/D-04; webhooks + future cron need always-on; subdomain sidesteps apex-CNAME issues; domain doubles as Phase-5 email domain |
| Error tracking | Sentry via `@sentry/react-router`, server SDK loaded through `NODE_OPTIONS --import ./instrument.server.mjs` on dev AND start | D-03 — webhook-handler errors are the explicit concern; default-PII off, no payload attachments |
| API version | 2026-07 pinned in `shopify.app.toml` webhooks + all config, kept in lockstep with Admin GraphQL in later phases | CLAUDE.md pin; prevents `purchasingCompany` schema drift in Phase 4 |
| Directory layout | Template shape: `app/routes/*` (flat-route convention incl. `webhooks.*` per-topic files), `app/services/*.server.ts` for domain logic, `tests/` + `tests/helpers/`, `scripts/` for ops | Follows template convention; per-topic webhook routes except GDPR topics sharing one `webhooks.compliance.tsx` (library dispatches by topic) |
| Shop lifecycle | `Shop` table (domain-unique, `active` flag) — two-stage uninstall: deactivate+retain on `app/uninstalled`, hard-delete on `shop/redact` (T+48h), reactivate via `ensureShopActive` upsert in the authenticated layout loader | D-06 painless-reinstall stance; the `Shop.active = true` filter is the contract every Phase 2+ scheduled job must honor |

## Stack Touched in Phase 1

- [x] Project scaffold (React Router 7 template, build, typecheck; vitest test runner added in plan 01-03)
- [x] Routing — `app.tsx` layout, `app._index.tsx` home, `healthz.tsx`, `webhooks.*` routes
- [x] Database — real session write on install (Prisma session storage) + `Shop`/`ComplianceRequest` reads/writes in lifecycle handlers
- [x] UI — embedded Polaris shell with nav, empty state, and error-boundary retry action wired to real route state
- [x] Deployment — Railway always-on service at `https://app.<domain>` with release-phase migrations and healthcheck-gated deploys

## Out of Scope (Deferred to Later Slices)

- AR ledger, balance math, webhook-driven recompute, backfill, reconciliation/overdue sweeps (Phase 2)
- Credit limits UI, bypass toggle, `$app` Company metafield publishing (Phase 3)
- Checkout Validation Function and any enforcement (Phase 4) — Phase 1 install is deliberately observe-only and changes nothing in the merchant's store
- Reminder emails, sending domain DNS (Phase 5 — but the domain purchased now feeds its SPF/DKIM lead time)
- Dashboard data, onboarding flow, billing, review prompt, app-review submission (Phase 6)
- Staging environment and AU-region hosting (explicitly deferred in CONTEXT.md)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: webhook-ingestion + scheduler slice — per-company balance/overdue ledger (hangs off `Shop`, filters `Shop.active`)
- Phase 3: settings UI + metafield-publisher slice — per-company limits/bypass published to `$app` Company metafields
- Phase 4: Functions extension slice — checkout validation reading those metafields (extension directory seam left clean)
- Phase 5: email slice — reminders via Resend from the D-04 domain, reusing the Phase-2 scheduler loop
- Phase 6: dashboard/onboarding/billing slice — reads the ledger + event logs; managed pricing; app review
