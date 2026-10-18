# Phase 1: Foundation & Compliance - Research

**Researched:** 2026-08-17
**Domain:** Shopify embedded app scaffold (React Router 7 template), GDPR compliance webhooks, uninstall lifecycle, Railway deployment, Sentry
**Confidence:** MEDIUM-HIGH (all key claims fetched from official docs/repos this session; provider-seam ceiling for web research is noted per claim)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Hosting & Environments
- **D-01:** Host on Railway (single production environment + Postgres). No staging environment — local `shopify app dev` tunneling to the dev store is the pre-production loop. — **Reversibility:** reversible — containerized Node app; moving hosts later is a redeploy + DNS change.
- **D-02:** Railway default US region (Shopify webhook infra is US-based; app UI is served inside Shopify admin, so AU proximity buys nothing).
- **D-03:** Sentry (free tier) wired in during scaffold — error tracking from day one, especially for webhook handlers.

#### App Domain & Identity
- **D-04:** Buy a custom domain NOW (user's manual task) and serve the app from it from first deploy. It becomes the stable app URL (avoids re-verifying OAuth redirects/webhook subscriptions later) and the Phase-5 email sending domain (SPF/DKIM/DMARC reputation needs lead time). Availability shortlist: `creditguard.app`, `getcreditguard.com`, `creditguardapp.com`. — **Reversibility:** costly — changing the app URL after install-base exists means re-verifying every OAuth redirect and webhook subscription.
- **D-05:** Partner dashboard identity: app name "Credit Guard: B2B Net Terms", handle `credit-guard-net-terms`.

#### Uninstall Data Retention
- **D-06:** On `app/uninstalled`: immediately deactivate (revoke tokens, stop scheduled jobs, mark shop inactive) but RETAIN merchant data (credit limits, settings, ledger). Hard-delete everything when Shopify's `shop/redact` webhook arrives (~48h after uninstall — researcher to pin exact timing). Re-installs within the grace window recover all settings painlessly; GDPR deletion is driven by Shopify's own redact signal. — **Reversibility:** reversible — retention window is a config change.

#### Partner Account & Dev Store Logistics (user's manual tasks, in parallel)
- **D-07:** User creates the Shopify Partner account (US$19 one-time) and a development store with B2B enabled this week — Phase 1 success criteria require installing on a dev store. App registration happens via Shopify CLI during scaffold (one-time browser auth by user). User also purchases the chosen domain (Claude must not enter payment details — user completes checkout).

### Claude's Discretion
- Everything technical within the locked stack: template scaffolding details, TypeScript config, Prisma schema for sessions/shops, webhook routing structure, Sentry integration shape, deploy pipeline (Railway git-push deploy is fine), demo-data seeding approach.

### Deferred Ideas (OUT OF SCOPE)
- Staging environment — revisit only if paying merchants exist and deploys become risky.
- AU-region hosting for data-residency marketing — revisit if AU merchants ever ask; not an MVP concern.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUND-01 | Merchant can install the app and complete OAuth into an embedded Polaris admin (React Router 7 template, session-token auth) | Scaffold command + template state verified from GitHub README; managed installation/token exchange is the template default (no OAuth code); template `app.tsx` layout provides embedded shell; Node engine constraints pinned. See "Standard Stack", "Code Examples §1" |
| FOUND-02 | App responds correctly to mandatory GDPR webhooks (customers/data_request, customers/redact, shop/redact) with 401 on bad HMAC | Compliance topics are **commented out** in the template's `shopify.app.toml` and no GDPR routes ship — must be added. Exact TOML shape + 48h `shop/redact` timing + 401 requirement verified from official privacy-law-compliance docs. Library `authenticate.webhook` handles HMAC and rejects with 401. See "Common Pitfalls §1–2", "Code Examples §2–3" |
| FOUND-03 | App cleans up on uninstall (app/uninstalled webhook: revoke data, stop jobs, mark shop inactive) | Template's `webhooks.app.uninstalled.tsx` deletes sessions only — must be extended to mark shop inactive while RETAINING merchant data per D-06; hard delete happens on `shop/redact` (48h later, verified). Re-install works via managed installation (no stored state required). See "Code Examples §3–4" |
</phase_requirements>

## Summary

Phase 1 is a scaffold-and-harden phase with one deployment. The official `shopify-app-template-react-router` gives ~70% of FOUND-01 for free: managed installation + token exchange (no OAuth code), session-token auth, Prisma session storage, an embedded app shell, and `app/uninstalled` + `app/scopes_update` webhook routes. The three things it does **not** give you — and which this phase must add — are: (1) the three mandatory GDPR webhook subscriptions (they exist only as commented-out TOML in the template) plus their handler routes; (2) an uninstall lifecycle that matches D-06 (template deletes sessions; we must also mark the shop inactive and retain merchant data until `shop/redact`); (3) production deployment (Postgres datasource swap, Railway service + custom domain, Sentry).

Two version-currency findings matter for planning. First, `@shopify/shopify-app-react-router` released **v2.0.0 on 2026-08-10** (7 days ago) — it requires Node 22+, drops non-embedded support, and removes the deprecated webhook `subTopic` param; the template still pins `^1.1.0`. Recommendation: scaffold with whatever the template pins and do **not** hand-upgrade to a week-old major during a 2–4-week MVP. Second, the timing question from CONTEXT.md D-06 is now pinned: official docs state `shop/redact` arrives **48 hours** after uninstall (verbatim quote in Pitfalls §2), and `customers/redact` arrives 10 days after a deletion request (or is withheld 6 months if the customer ordered recently).

Deployment shape on Railway is simple and confirmed: build with `npm run build` (`react-router build`), start with the template's `docker-start` pattern (`npm run setup && npm run start`, where `setup` = `prisma generate && prisma migrate deploy`), listen on Railway's injected `PORT`, set `SHOPIFY_APP_URL`/`SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET`/`DATABASE_URL`, add the custom domain (CNAME + TXT records, free auto-SSL), and point `application_url` in `shopify.app.toml` at the custom domain before running `shopify app deploy`.

**Primary recommendation:** Scaffold from the official template unmodified, keep its pinned dependency majors, then layer exactly four additions: GDPR compliance TOML + routes, D-06 uninstall/redact lifecycle with a `Shop` table, Sentry (`@sentry/react-router` manual setup), and Railway deploy config — in that order, deploying early so success criterion 4 is exercised for the whole phase, with API version set to 2026-07 everywhere.

## Project Constraints (from CLAUDE.md)

- Stack is locked: React Router 7 template, `@shopify/shopify-app-react-router`, Prisma + Postgres, Polaris **web components** via App Bridge CDN (NOT `@shopify/polaris` React — deprecated), Node 20+/22, Railway hosting.
- Admin GraphQL API pinned **2026-07**; webhooks pinned 2026-07; keep all API versions in lockstep. GraphQL only — never REST Admin API.
- Mandatory GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) required — app review blocks without them.
- No custom OAuth/session code — use the official library + `@shopify/shopify-app-session-storage-prisma`.
- No serverless hosting (always-on container required for webhooks + future cron).
- Keep infra to a single small server + DB (flat-fee margin constraint).
- GSD workflow enforcement: all file changes go through GSD commands.
- Scaffold command per CLAUDE.md: `shopify app init` (React Router is the default template).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OAuth / managed installation / session-token auth | API/Backend (library middleware) | — | `@shopify/shopify-app-react-router` handles token exchange server-side; zero custom code |
| Embedded admin shell (Polaris web components) | Frontend Server (SSR, RR7 routes) | Browser (App Bridge CDN script) | RR7 loaders render inside Shopify admin iframe; App Bridge script loads client-side from CDN |
| GDPR + lifecycle webhook handling | API/Backend | — | HMAC verification and data mutations are strictly server-side; must return 401 on bad HMAC |
| Session persistence | Database/Storage | — | Prisma `Session` table (template migration), Postgres in production |
| Shop lifecycle state (active/inactive, retained data) | Database/Storage | API/Backend | New `Shop` table; written by webhook handlers, read by future phases |
| Error tracking | API/Backend (server init via `--import`) | Browser (client init) | Sentry needs both server instrumentation (webhook handlers — D-03's explicit concern) and client init |
| TLS, domain, routing | CDN/Static (Railway edge) | — | Railway terminates TLS on the custom domain; app just listens on `PORT` |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@shopify/cli` | 4.6.1 latest (published 2026-08-16) [CITED: npm registry, legitimacy verdict SUS/too-new — see audit] | Scaffold, dev tunnel, `shopify app deploy` | Official; not currently installed locally — install step required |
| `shopify-app-template-react-router` | repo `main` | App scaffold | Official current template. Scaffold: `shopify app init --template=https://github.com/Shopify/shopify-app-template-react-router` [CITED: github.com/Shopify/shopify-app-template-react-router README]; plain `shopify app init` defaults to it per CLAUDE.md |
| `@shopify/shopify-app-react-router` | template pins `^1.1.0`; npm latest **2.0.0** (2026-08-10) [CITED: npm registry] | Auth, webhook HMAC verification, Admin GraphQL client | **Use the template's pinned major.** v2.0.0 is 7 days old; breaking changes: Node 22+ only, embedded-only, `subTopic` removed, tightened GraphQL error types [CITED: shopify-app-js CHANGELOG]. Upgrade later, not during scaffold week |
| `@shopify/shopify-app-session-storage-prisma` | ships with template (npm latest 10.0.0, 2026-08-10) [CITED: npm registry] | Session persistence in Postgres | Template default; do not replace |
| Prisma / `@prisma/client` | template pins `^6.16.3` (npm latest prisma 7.9.1) [CITED: template package.json; npm registry] | ORM + migrations | Keep template's Prisma 6 — do not jump to Prisma 7 major mid-scaffold |
| React Router | `@react-router/dev ^7.12.0`, React `^18.3.1` [CITED: template package.json] | Full-stack framework | Template default |
| Node.js | **22.x** (local: v22.20.0 ✓) | Runtime | Template engines: `>=20.19 <22 \|\| >=22.12` [CITED: template package.json]. Choosing 22 also keeps the future v2 library upgrade path open |
| PostgreSQL | 16+ (Railway managed) | Production DB | Template defaults to SQLite; datasource provider swap in `schema.prisma` [CITED: template README] |
| Polaris web components + App Bridge | CDN script (auto-latest) | Embedded admin UI | Per CLAUDE.md; no npm version to manage; satisfies "latest App Bridge" review check |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@sentry/react-router` | 10.70.0 (npm, 2026-08-12) [CITED: npm registry] | Error tracking (D-03) | Always — this is Sentry's official RR7 framework-mode SDK; correct package for this template |
| `@sentry/profiling-node` | matching 10.x | Optional server profiling | Optional; the manual-setup docs install it alongside [CITED: docs.sentry.io react-router manual-setup] — skip at MVP to keep the surface small |
| `vitest` | latest 3.x | Test framework (none ships with template) | Wave 0 — needed for HMAC/webhook/lifecycle tests; template already uses Vite 7 so vitest is the zero-friction choice [ASSUMED: vitest 3.x/Vite 7 compat — verify at install] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Template-pinned lib v1.x | `@shopify/shopify-app-react-router` v2.0.0 | v2 is cleaner (embedded-only matches us) but is 7 days old; a solo dev on a 2–4-week clock should not debug a fresh major. Revisit at Phase 6 hardening |
| Sentry manual setup | `npx @sentry/wizard@latest -i reactRouter` | Wizard is faster but rewrites entry files it doesn't fully understand (Shopify template has customized entries); manual setup is deterministic and diff-reviewable |
| Railway dashboard config | `railway.json` config-as-code | Health check path is set in service settings per docs [CITED: docs.railway.com/guides/healthchecks]; keep dashboard config for MVP, document values in README |
| One combined webhooks route | Per-topic routes (`webhooks.app.uninstalled.tsx` etc.) | Template convention is per-topic routes — follow it; GDPR topics can share one `webhooks.compliance.tsx` route since the library dispatches by `topic` |

**Installation:**
```bash
# Install CLI (missing locally — see Environment Availability)
npm install -g @shopify/cli@latest

# Scaffold (user completes one-time browser auth to Partner account)
shopify app init   # React Router template is the default; or --template=<repo URL>

# Beyond template (Phase 1 only)
npm install @sentry/react-router
npm install -D vitest
```

**Version verification (performed 2026-08-17 via `npm view`):** `@shopify/shopify-app-react-router` 2.0.0, `@shopify/cli` 4.6.1, `@sentry/react-router` 10.70.0, `prisma` 7.9.1, `@shopify/shopify-app-session-storage-prisma` 10.0.0, `@shopify/app-bridge-react` 4.2.12. Note all Shopify app libs republished 2026-08-10 (coordinated major-release train) — the template repo may lag; trust the lockfile the scaffold produces.

## Package Legitimacy Audit

Seam command: `gsd-tools query package-legitimacy check --ecosystem npm …` run 2026-08-17.

| Package | Registry | Latest publish | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@shopify/shopify-app-react-router` | npm | 2026-08-10 | 125,895/wk | github.com/Shopify/shopify-app-js | [SUS] too-new | Flagged — mitigate by pinning template's `^1.1.0` major, not the 7-day-old 2.0.0 |
| `@shopify/shopify-app-session-storage-prisma` | npm | 2026-08-10 | 134,798/wk | github.com/Shopify/shopify-app-js | [SUS] too-new | Flagged — ships inside template lockfile; same mitigation |
| `@shopify/cli` | npm | 2026-08-07 | 450,588/wk | github.com/Shopify/cli | [SUS] too-new | Flagged — official CLI; global install, planner adds checkpoint:human-verify before install |
| `@sentry/react-router` | npm | 2026-08-10 | 204,131/wk | github.com/getsentry/sentry-javascript | [SUS] too-new | Flagged — official Sentry monorepo package; planner adds checkpoint:human-verify before install |
| `vitest` | npm | — (not yet seam-checked) | — | — | [ASSUMED] | Run legitimacy check at plan time before install task |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** all four above — every verdict's sole reason is "too-new" (latest publish < 14 days old, a coordinated official release train). All four have official org repos, six-figure weekly downloads, no postinstall scripts, and no deprecation flags. Per protocol the planner must gate installs behind `checkpoint:human-verify`; the practical human check is "confirm the resolved version in the lockfile matches the official repo's release tags."

## Architecture Patterns

### System Architecture Diagram

```
                       ┌──────────────────────────────────────────────┐
                       │              SHOPIFY PLATFORM                │
 Merchant browser      │                                              │
┌──────────────────┐   │  ┌──────────────┐   webhook POSTs (HMAC)     │
│ Shopify Admin    │   │  │ Managed      │   app/uninstalled          │
│ (iframe host)    │   │  │ installation │   app/scopes_update        │
│  └─ Embedded app │   │  │ + token      │   customers/data_request   │
│     (Polaris web │   │  │ exchange     │   customers/redact         │
│     components + │   │  └──────┬───────┘   shop/redact (T+48h)      │
│     App Bridge   │   └─────────┼──────────────────┬─────────────────┘
│     CDN script)  │             │                  │
└────────┬─────────┘             │                  ▼
         │ session-token         │        ┌────────────────────────┐
         │ authed HTTPS          │        │ RAILWAY (custom domain,│
         ▼                       ▼        │ auto-TLS, PORT env)    │
┌─────────────────────────────────────┐   │                        │
│ APP SERVER (RR7, single process)    │◄──┘  build: react-router   │
│ ├ app.tsx embedded layout           │      build                 │
│ ├ app._index.tsx (placeholder home) │      start: npm run setup  │
│ ├ webhooks.app.uninstalled.tsx ─────┼──┐   && npm run start      │
│ ├ webhooks.app.scopes_update.tsx    │  │   health: GET /healthz  │
│ ├ webhooks.compliance.tsx (NEW) ────┼──┤   → 200                 │
│ │   401 on bad HMAC (library)       │  │                         │
│ └ healthz.tsx (NEW)                 │  │  Sentry: instrument.    │
└──────────────┬──────────────────────┘  │  server.mjs (--import)  │
               │ Prisma                  │  + entry.client init    │
               ▼                         ▼
        ┌─────────────────┐   uninstalled: delete sessions,
        │ POSTGRES        │   Shop.active=false (RETAIN data, D-06)
        │ Session (tmpl)  │   shop/redact:  hard-delete shop rows
        │ Shop (NEW)      │   customers/redact: no-op in Phase 1
        └─────────────────┘   (no customer PII stored yet) + log
```

Trace (install): merchant clicks install → Shopify managed installation (no app-side OAuth code) → admin iframe loads app URL → library exchanges session token → `app.tsx` loader authenticates → Polaris shell renders. Trace (uninstall): Shopify POSTs `app/uninstalled` → HMAC verified → sessions deleted + shop marked inactive → 48h later `shop/redact` POSTs → hard delete.

### Recommended Project Structure (template shape + Phase-1 additions)

```
credit-guard/
├── shopify.app.toml            # + uncommented compliance_topics, api_version 2026-07
├── instrument.server.mjs       # NEW — Sentry server init (loaded via --import)
├── vite.config.ts              # + sentryReactRouter plugin
├── react-router.config.ts      # + sentryOnBuildEnd
├── app/
│   ├── shopify.server.ts       # template: shopifyApp() config
│   ├── db.server.ts            # template: Prisma client
│   ├── entry.client.tsx        # + Sentry client init
│   ├── entry.server.tsx        # + createSentryHandleRequest / HandleError
│   ├── routes/
│   │   ├── app.tsx             # template: embedded layout
│   │   ├── app._index.tsx      # template: home (placeholder for Phase 6 dashboard)
│   │   ├── webhooks.app.uninstalled.tsx   # template — EXTEND for D-06
│   │   ├── webhooks.app.scopes_update.tsx # template — keep as-is
│   │   ├── webhooks.compliance.tsx        # NEW — 3 GDPR topics
│   │   └── healthz.tsx                    # NEW — Railway health check
│   └── services/
│       └── shop-lifecycle.server.ts       # NEW — deactivate / redact / reactivate
└── prisma/schema.prisma        # template Session model + NEW Shop model; provider "postgresql"
```

### Pattern 1: Managed installation — there is no OAuth code to write

**What:** The template uses Shopify managed installation + token exchange: install/consent happens on Shopify's side; the embedded app authenticates every request with session tokens via `authenticate.admin(request)` in loaders/actions. There is no callback route to implement and no access-token persistence code beyond the library's Prisma session storage.
**When to use:** Always — FOUND-01's "complete OAuth" success criterion is satisfied by the template default; any hand-rolled OAuth is an app-review liability (CLAUDE.md).
**Planning consequence:** FOUND-01 tasks are: scaffold, register app via CLI (user browser auth, D-07), verify embedded shell loads on the dev store. Not: build auth.

### Pattern 2: Compliance topics live in TOML; handlers are ordinary webhook routes

**What:** GDPR topics are declared declaratively in `shopify.app.toml` under `[[webhooks.subscriptions]]` with a `compliance_topics` array + `uri` [CITED: shopify.dev/docs/apps/build/compliance/privacy-law-compliance]; the template has this block **commented out** [CITED: template shopify.app.toml]. `shopify app deploy` syncs subscriptions. The route handler calls `authenticate.webhook(request)` — the library verifies HMAC and rejects invalid signatures with a 401 before your code runs (observed library behavior: 401 with `{valid: false, reason: invalid_hmac}` [CITED: Shopify community / template issue reports — MEDIUM]).
**When to use:** FOUND-02. One route for all three compliance topics (dispatch on `topic`) keeps the TOML `uri` single.
**Anti-pattern:** Writing manual HMAC verification alongside the library — `authenticate.webhook` consumes the request body; double-reading it breaks verification.

### Pattern 3: Two-stage uninstall (deactivate now, redact at T+48h) — D-06

**What:** `app/uninstalled` → delete sessions (tokens are already invalidated by Shopify at uninstall; deleting sessions removes the dead tokens), set `Shop.active = false`, leave all merchant data intact. `shop/redact` (arrives 48h later, verified) → hard-delete the shop's rows. Re-install within the window: managed installation creates fresh sessions; a `Shop` row flip back to `active = true` restores everything.
**When to use:** FOUND-03. The `Shop` model created here is the seam Phases 2–5 hang settings/jobs off.
**Note:** the scheduler ("stop scheduled jobs") doesn't exist until Phase 2 — Phase 1 encodes the contract: all future jobs must filter `Shop.active = true`. Document this in the service module.

### Pattern 4: Deploy-first, single always-on Railway service

**What:** Deploy in the first wave, not the last: Railway service from the GitHub repo, Postgres attached (`DATABASE_URL` via `${{Postgres.DATABASE_URL}}` reference variable [ASSUMED — standard Railway pattern; confirm syntax in dashboard]), custom domain with CNAME + TXT records and auto-provisioned TLS [CITED: docs.railway.com], health check on `/healthz` returning 200 (default timeout 300s) [CITED: docs.railway.com/guides/healthchecks], start command `npm run docker-start` (= `npm run setup && npm run start`, running `prisma migrate deploy` on every release) [CITED: template package.json].
**Why:** Success criterion 4 ("runs deployed") should be true from day 2 so webhook criteria are testable against the real URL, and the costly-to-change custom domain (D-04) is locked in before app registration URLs propagate.

### Anti-Patterns to Avoid

- **Upgrading to week-old majors during scaffold** (`shopify-app-react-router` 2.0.0, Prisma 7): burn risk with zero Phase-1 payoff. Respect the template lockfile.
- **`@shopify/polaris` React package:** deprecated; use Polaris web components via the App Bridge CDN script (CLAUDE.md).
- **Custom HMAC middleware:** the library does it; hand-rolling it is how you fail the automated 401 check.
- **Deleting merchant data on `app/uninstalled`:** violates D-06 and destroys the painless-reinstall experience; deletion belongs to `shop/redact` only.
- **Hardcoding the tunnel URL anywhere:** `shopify app dev` rewrites dev URLs; production URLs come from env (`SHOPIFY_APP_URL`) + `shopify.app.toml` `application_url` = custom domain.
- **Trusting shop identity from query params:** always derive shop from `authenticate.admin` / `authenticate.webhook` results.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth / install flow | Authorization-code grant handlers | Template managed installation + token exchange | Zero code, review-safe; hand-rolled OAuth is the #1 template-divergence review liability |
| Webhook HMAC verification | Crypto compare middleware | `authenticate.webhook(request)` | Library returns 401 on bad HMAC; handles header-case variants and body consumption correctly |
| Session storage | Custom token tables | `@shopify/shopify-app-session-storage-prisma` + template `Session` migration | Schema ships with the template; survives the SQLite→Postgres swap unchanged |
| TLS/certificates on custom domain | certbot/nginx | Railway auto-provisioned SSL | "Free SSL certificates automatically provisioned and renewed" [CITED: docs.railway.com] |
| Error aggregation for webhook handlers | Log-file grepping | `@sentry/react-router` (D-03) | Official RR7 SDK captures loader/action/server errors with `createSentryHandleError` |
| DB migration on deploy | SSH-and-migrate scripts | Template `setup` script in start command | `prisma generate && prisma migrate deploy` is the template's own production pattern |

**Key insight:** Phase 1's entire risk profile is "diverging from the template." Every subsystem the review process checks (auth, HMAC, CSP headers, App Bridge version) is template-default-correct; custom code can only make it worse.

## Common Pitfalls

### Pitfall 1: Assuming the template ships GDPR webhooks working

**What goes wrong:** The compliance block in `shopify.app.toml` is commented out and no compliance route exists; only `app/uninstalled` and `app/scopes_update` routes ship [CITED: template repo, routes listing + TOML]. Shipping the scaffold as-is fails app review's automated compliance check.
**Why it happens:** Compliance topics are "public apps only," so the template can't enable them by default.
**How to avoid:** Uncomment/add the `compliance_topics` subscription with a real `uri`, create the route, run `shopify app deploy` to sync, then test each topic from the Partner dashboard's webhook test tool AND with a raw `curl` POST carrying a bad HMAC (expect 401).
**Warning signs:** No `compliance_topics` in TOML; Partner dashboard automated checks flag "Use HMAC verification" — note community reports exist of that check staying red even with green endpoints; re-run after deploy sync.

### Pitfall 2: Guessing the redact timings

**What goes wrong:** Retention logic built on assumed timings. Verified verbatim from official docs [CITED: shopify.dev/docs/apps/build/compliance/privacy-law-compliance]:
- `shop/redact`: *"48 hours after a store owner uninstalls your app, Shopify sends a payload on the `shop/redact` topic."* → **D-06's ~48h assumption is CONFIRMED.**
- `customers/redact`: *"If a customer hasn't placed an order in the past six months, then Shopify sends the payload 10 days after the deletion request. Otherwise, the request is withheld until six months have passed."*
- Requests must be actioned within **30 days** of receipt; invalid HMAC must receive **`401 Unauthorized`**.
**How to avoid:** Drive deletion off webhook receipt, never a self-scheduled timer. Handlers must be idempotent (webhooks re-deliver; a `shop/redact` for an already-deleted shop must still 200).

### Pitfall 3: `session` is undefined in uninstall-adjacent webhooks

**What goes wrong:** Handler dereferences `session` and crashes → 500 → Shopify retries → Sentry noise → eventual subscription removal. Official docs: webhooks "can trigger after an app is uninstalled. If the app is already uninstalled, the session may be undefined" [CITED: shopify.dev shopify-app-react-router authenticate.webhook].
**How to avoid:** Every webhook handler treats `session` as optional; compliance handlers must work with **no session at all** (the shop uninstalled 48h ago). Key data operations off `shop` (the domain string), not off session state.

### Pitfall 4: Railway start/build mismatch with the template

**What goes wrong:** Default Nixpacks/Railpack start (`npm start`) skips migrations → app boots against an unmigrated Postgres → crash loop; or app listens on 3000 while Railway injects a different `PORT` → health check times out at 300s → failed deploy.
**How to avoid:** Set start command to `npm run docker-start` (template's own production composition) [CITED: template package.json]; rely on `react-router-serve` honoring `PORT` [ASSUMED — verify on first deploy]; add `/healthz` route and set it as `healthcheckPath`.
**Warning signs:** Deploy stuck "waiting for healthcheck"; Prisma `P1001`/table-missing errors at boot.

### Pitfall 5: Sentry server-side never initializes

**What goes wrong:** Client init works, but server errors (the webhook handlers D-03 exists for) never appear — the server SDK must load **before** the app via `NODE_OPTIONS='--import ./instrument.server.mjs'` on the start script [CITED: docs.sentry.io react-router manual-setup]. Railway's start command must preserve that flag.
**How to avoid:** Put `NODE_OPTIONS` into the `start` script itself (not just `dev`), keep `docker-start` delegating to it; verify by throwing a test error in a route action on the deployed app and seeing the event in Sentry.
**Warning signs:** Sentry shows only browser events; no `instrumentations` export in `entry.server.tsx`.

### Pitfall 6: Custom domain wired after app registration

**What goes wrong:** App URL flips tunnel → railway.app subdomain → custom domain, each flip requiring `shopify app deploy` re-syncs, and D-04 warns post-install-base URL changes are costly. Also apex domains can't take a plain CNAME — Railway needs CNAME flattening/ALIAS support, or Cloudflare nameservers as the workaround [CITED: docs.railway.com working-with-domains + Railway station threads]; TXT verification is occasionally sticky (remove/re-add after 10–15 min).
**How to avoid:** Sequence: user buys domain (manual, D-07) → add to Railway service (CNAME + TXT) → confirm TLS issued → set `SHOPIFY_APP_URL` + `application_url` to it → `shopify app deploy` → only then do install testing on the dev store. Prefer a subdomain (`app.<domain>`) to sidestep apex CNAME issues entirely, reserving root + `mail.` for Phase 5.

### Pitfall 7: Template API version drift vs. project pin

**What goes wrong:** The template repo currently sets `api_version = "2025-10"` for webhooks in its TOML [CITED: template shopify.app.toml fetch — may lag npm]; the project pin is **2026-07** (CLAUDE.md). Leaving the scaffold default creates version skew with later phases' Admin GraphQL 2026-07 code.
**How to avoid:** Explicit task: set webhook `api_version = "2026-07"` in `shopify.app.toml` at scaffold time; grep for any other version literals after scaffold.

## Code Examples

Verified patterns from official sources; adapt names, don't copy blind.

### 1. Compliance TOML (shopify.app.toml)

```toml
# Source: shopify.dev/docs/apps/build/compliance/privacy-law-compliance
# (template ships this commented out — uncomment/adapt)
[webhooks]
api_version = "2026-07"

  [[webhooks.subscriptions]]
  topics = [ "app/uninstalled" ]
  uri = "/webhooks/app/uninstalled"

  [[webhooks.subscriptions]]
  topics = [ "app/scopes_update" ]
  uri = "/webhooks/app/scopes_update"

  [[webhooks.subscriptions]]
  compliance_topics = [ "customers/data_request", "customers/redact", "shop/redact" ]
  uri = "/webhooks/compliance"
```

### 2. Compliance route — `app/routes/webhooks.compliance.tsx`

```typescript
// Pattern source: template's webhooks.app.uninstalled.tsx (fetched verbatim this session)
// + shopify.dev authenticate.webhook docs. Library 401s bad HMAC before this code runs.
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { redactShop, logComplianceRequest } from "../services/shop-lifecycle.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  // NOTE: session will be undefined here for redact topics (app uninstalled) — never touch it.

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // Phase 1 stores no customer PII; log receipt for the 30-day audit trail.
      await logComplianceRequest(shop, topic, payload);
      break;
    case "CUSTOMERS_REDACT":
      await logComplianceRequest(shop, topic, payload); // becomes a real delete in Phase 5 (email logs)
      break;
    case "SHOP_REDACT":
      await redactShop(shop); // hard-delete retained data (D-06); idempotent
      break;
  }
  return new Response(); // 200
};
```
[ASSUMED: exact uppercase topic strings `CUSTOMERS_DATA_REQUEST`/`CUSTOMERS_REDACT`/`SHOP_REDACT` — the library normalizes topics to this form for regular webhooks; confirm against the scaffold's generated types at build time.]

### 3. Extended uninstall handler — template baseline, verbatim, then D-06 extension

Template's `webhooks.app.uninstalled.tsx` as shipped [CITED: raw.githubusercontent.com/Shopify/shopify-app-template-react-router/main/app/routes/webhooks.app.uninstalled.tsx, fetched 2026-08-17]:

```typescript
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  return new Response();
};
```

D-06 extension: after the session delete, also `await deactivateShop(shop)` (sets `Shop.active = false`, records `uninstalledAt`) — and **nothing else**; retained data survives until `SHOP_REDACT`.

### 4. Prisma `Shop` model (new, Phase-1 seam for later phases)

```prisma
// Companion to the template's Session model. Postgres provider swap per template README.
model Shop {
  id            String    @id @default(cuid())
  domain        String    @unique          // e.g. my-store.myshopify.com
  active        Boolean   @default(true)
  installedAt   DateTime  @default(now())
  uninstalledAt DateTime?
  redactedAt    DateTime?                  // set by SHOP_REDACT (audit stub survives if you keep row)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```
[ASSUMED: field shape is Claude's-discretion design, not an external contract.]

### 5. Sentry wiring (manual setup)

```typescript
// Source: docs.sentry.io/platforms/javascript/guides/react-router/manual-setup/ (fetched this session)
// instrument.server.mjs (project root)
import * as Sentry from "@sentry/react-router";
Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
```
```json
// package.json — flag must be on BOTH dev and start so Railway's start inherits it
"dev":   "NODE_OPTIONS='--import ./instrument.server.mjs' react-router dev",
"start": "NODE_OPTIONS='--import ./instrument.server.mjs' react-router-serve ./build/server/index.js"
```
```typescript
// entry.server.tsx additions (docs-verbatim shape)
export default Sentry.createSentryHandleRequest({ ServerRouter, renderToPipeableStream, createReadableStreamFromReadable });
export const handleError = Sentry.createSentryHandleError({ logErrors: false });
export const instrumentations = [Sentry.createSentryServerInstrumentation()];
```
```typescript
// vite.config.ts + react-router.config.ts
plugins: [reactRouter(), sentryReactRouter({ org, project, authToken: process.env.SENTRY_AUTH_TOKEN }, config)]
buildEnd: async (args) => { await sentryOnBuildEnd(args); }
```
Note: Shopify's template dev script is `shopify app dev` (which invokes the RR dev server) — put `NODE_OPTIONS` where the actual `react-router dev`/`serve` command runs. Source-map upload (`SENTRY_AUTH_TOKEN`) is optional at MVP; error capture works without it.

### 6. Health check route — `app/routes/healthz.tsx`

```typescript
export const loader = () => new Response("ok", { status: 200 }); // must NOT require Shopify auth
```

### 7. Railway production environment variables

| Variable | Value | Source |
|----------|-------|--------|
| `SHOPIFY_APP_URL` | `https://app.<custom-domain>` | [CITED: shopify.dev deploy-web-app — "The URL origin where the app will be accessed"] |
| `SHOPIFY_API_KEY` | client ID from Partner dashboard | [CITED: shopify.dev deploy-web-app] |
| `SHOPIFY_API_SECRET` | client secret (Railway sealed variable) | [CITED: shopify.dev deploy-web-app] |
| `SCOPES` | optional under managed installation | [CITED: shopify.dev deploy-web-app] |
| `DATABASE_URL` | Railway Postgres reference | [ASSUMED: `${{Postgres.DATABASE_URL}}` syntax — confirm in dashboard] |
| `PORT` | injected by Railway; app must listen on it | [CITED: docs.railway.com/guides/healthchecks] |
| `SENTRY_DSN` | from Sentry project settings | [CITED: docs.sentry.io] |
| `NODE_ENV` | `production` | [CITED: template README] |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Remix template + `@shopify/shopify-app-remix` | React Router 7 template + `@shopify/shopify-app-react-router` | 2025 | All new docs target RR7; do not mix remix-package imports |
| Authorization-code OAuth grant in app code | Managed installation + token exchange (template default) | 2024–25 | FOUND-01 requires no auth code at all |
| `@shopify/polaris` React | Polaris web components via App Bridge CDN | 2025/2026 | Admin UI markup uses `<s-page>`, `<s-card>`… |
| Webhook subscriptions via API calls in `afterAuth` | Declarative TOML subscriptions synced by `shopify app deploy` | 2024+ | Compliance topics also declared in TOML; admin-created webhooks fail library HMAC validation [CITED: template README gotcha] |
| `@shopify/shopify-app-react-router` v1.x | v2.0.0 (Node 22+, embedded-only) | 2026-08-10 | Too fresh — stay on template major this phase; note for Phase 6 |
| Prisma 6 | Prisma 7 | 2026 | Template still on 6; don't upgrade mid-MVP |

**Deprecated/outdated:** REST Admin API (legacy for new apps); `@shopify/polaris` React; Remix template; `subTopic` webhook param (removed in lib v2).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Library topic strings arrive as `CUSTOMERS_DATA_REQUEST` / `CUSTOMERS_REDACT` / `SHOP_REDACT` in the compliance route switch | Code Examples §2 | Switch never matches → handlers no-op (still 200s, so review passes but redact silently fails). Verify against scaffold's generated types on day 1 |
| A2 | `react-router-serve` honors Railway's injected `PORT` env var | Pitfall 4 | Health check timeout, failed deploys. Verify on first deploy; fallback: set explicit `PORT` service variable |
| A3 | Railway Postgres `DATABASE_URL` reference variable syntax `${{Postgres.DATABASE_URL}}` | Code Examples §7 | Trivial — dashboard shows exact syntax when attaching |
| A4 | `vitest` 3.x is compatible with the template's Vite 7 | Standard Stack | Pick matching vitest major at install time |
| A5 | The npm-published template (via `shopify app init` today) matches the GitHub `main` fetched this session (routes, scripts, versions); TOML showed `api_version = "2025-10"` which may be a stale cache vs. an Aug-2026 scaffold | Whole doc | Diff the actual scaffold output against this research on day 1; the API-version pin task (2026-07) covers the drift either way |
| A6 | Partner dashboard "Use HMAC verification" automated check passes once compliance topics deploy via TOML + library handles 401 (community reports of false reds exist) | Pitfall 1 | Re-run automated checks after deploy; escalate via Partner support if red with passing curl tests |
| A7 | Sentry free tier suffices (D-03) — error volume at 1 dev store is trivial | Standard Stack | None materially; quota config change |

## Open Questions (RESOLVED)

1. **Does `shopify app dev` work end-to-end while `application_url` points at the production custom domain?**
   - What we know: CLI rewrites dev URLs to the tunnel automatically on each `dev` run; the template README documents the tunnel flow.
   - What's unclear: whether webhook compliance-topic testing from the Partner dashboard targets the tunnel or the deployed URL during dev.
   - Recommendation: use `shopify.app.toml` for prod config and let CLI manage a dev config variant (`shopify.app.dev.toml` pattern); test GDPR endpoints against the deployed Railway URL with curl.
   - **RESOLVED:** Recommendation adopted by plan 01-02 Task 3 — `application_url` points at production, local dev continues through the CLI-managed dev-config variant (the variant file the CLI creates is recorded in the 01-02 SUMMARY), and GDPR endpoints are curl-tested against the deployed URL (plan 01-04).
2. **Exact behavior of Partner-dashboard automated compliance checks against the deployed app** (A6). Recommendation: run checks immediately after first deploy, not at phase end — leaves time to fix.
   - **RESOLVED:** Recommendation adopted by plan 01-04 Task 2 — Partner dashboard automated checks + three webhook test deliveries run right after the deploy sync, with the A6 re-run-then-escalate path (not code churn) for a false-red HMAC check backed by passing curl evidence.
3. **Whether the scaffolded lockfile resolves `@shopify/shopify-app-react-router` to 1.x or 2.x** (template `^1.1.0` pin should hold to 1.x, but Shopify may bump the template any day). Recommendation: read the lockfile after scaffold; if the template itself moved to 2.x, Node 22 (already chosen) makes that fine — follow the template.
   - **RESOLVED:** Recommendation adopted by plan 01-01 Task 2 steps 7–8 — respect the template lockfile majors (no hand-upgrade), record the resolved versions of all five approved packages in the SUMMARY for cross-check against the Task 1 legitimacy approval, and diff the actual scaffold against assumption A5.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | template engines (`>=22.12` path) | ✓ | v22.20.0 | — |
| npm | installs, scripts | ✓ | 10.9.3 | — |
| git | repo, Railway deploys | ✓ | 2.50.1 | — |
| Shopify CLI | scaffold, dev, deploy | ✗ | — | `npm install -g @shopify/cli@latest` — install task, wave 0 |
| Railway CLI | deploys | ✗ | — | Not required — dashboard + GitHub-push deploys (D-01 allows) |
| psql | local DB inspection | ✓ | 17.10 | — (dev uses SQLite anyway; prod Postgres is Railway-managed) |
| Docker | — | ✗ | — | Not needed — Railway builds via Nixpacks/Railpack; `docker-start` script is just npm |
| Shopify Partner account + dev store (B2B) | install testing | ✗ (user task, D-07) | — | **Blocking for success criteria** — user creates this week, in parallel with scaffold |
| Custom domain | D-04, deploy | ✗ (user task, D-07) | — | Temporary fallback: railway.app subdomain for smoke-testing only; do NOT register app URLs against it |
| Sentry account (free) | D-03 | unknown | — | User creates free account; 2-minute task, needed before Sentry env vars |

**Missing dependencies with no fallback:** Partner account + B2B dev store; custom domain (for final success criteria). Both are user manual tasks (D-07) — the plan must front-load them as human checkpoints.
**Missing dependencies with fallback:** Shopify CLI (install task), Railway CLI (dashboard), Docker (not needed).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (to be installed — template ships NO test framework [CITED: template package.json devDeps]) |
| Config file | none — Wave 0 (`vitest.config.ts` reusing template Vite setup) |
| Quick run command | `npx vitest run tests/<file> --reporter=dot` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUND-01 | App scaffold builds; embedded shell route authenticates | build + smoke | `npm run build` (typecheck+build); install flow itself is manual UAT on dev store | ❌ Wave 0 (build gate); manual step |
| FOUND-02 | Compliance route: bad HMAC → 401; valid HMAC → 200 + correct dispatch per topic | integration (route action w/ signed requests) | `npx vitest run tests/webhooks.compliance.test.ts` | ❌ Wave 0 |
| FOUND-02 | Deployed endpoints reject bad HMAC | smoke (deployed) | `curl -s -o /dev/null -w "%{http_code}" -X POST https://app.<domain>/webhooks/compliance -d '{}' -H 'Content-Type: application/json'` → expect `401` | ❌ (script, Wave 0) |
| FOUND-03 | Uninstall handler: deletes sessions, sets Shop.active=false, retains data; idempotent on redelivery; SHOP_REDACT hard-deletes; reinstall reactivates | unit/integration on lifecycle service | `npx vitest run tests/shop-lifecycle.test.ts` | ❌ Wave 0 |
| (crit. 4) | Deployed app healthy, API version pinned | smoke + grep | `curl .../healthz` → 200; `grep -r "2026-07" shopify.app.toml` | ❌ (script, Wave 0) |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test file>` + `npm run build`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green + deployed curl smoke (401/200/healthz) + manual install/uninstall/reinstall UAT on dev store before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `vitest` install + `vitest.config.ts` — no test infra exists
- [ ] `tests/webhooks.compliance.test.ts` — covers FOUND-02 (signed-request helper computing real HMAC with test secret)
- [ ] `tests/shop-lifecycle.test.ts` — covers FOUND-03 (Prisma against SQLite test db)
- [ ] `scripts/smoke-deployed.sh` — curl checks for deployed 401/healthz (success criteria 2 & 4)

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Shopify managed installation + session-token auth via `@shopify/shopify-app-react-router` — no custom auth surface |
| V3 Session Management | yes | Library-managed sessions in Prisma storage; sessions deleted on uninstall (template handler) |
| V4 Access Control | yes | Shop identity derived only from validated session token / webhook HMAC — never from query params |
| V5 Input Validation | yes | Webhook HMAC via `authenticate.webhook` (401 on invalid); webhook payloads treated as untrusted (log, don't eval); no other user input in Phase 1 |
| V6 Cryptography | yes | HMAC-SHA256 verification is library-owned — never hand-roll; TLS via Railway auto-certs |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged webhook POSTs (fake uninstall/redact → data wipe) | Spoofing/Tampering | Library HMAC verification; 401 on failure; redact handlers idempotent so replay is harmless |
| Clickjacking of embedded admin | Elevation | Template's `frame-ancestors` CSP (verify header present after scaffold — review automated check) |
| Secret leakage (`SHOPIFY_API_SECRET`, `SENTRY_AUTH_TOKEN`) | Information disclosure | Railway sealed variables; never committed (docs explicitly warn [CITED: shopify.dev deploy-web-app]); `.env` gitignored by template |
| Cross-shop data access | Elevation | All queries scoped by `shop` from authenticated context; `Shop.domain` unique |
| Retained-data-after-redact (GDPR violation) | Compliance | `SHOP_REDACT` hard delete + test asserting zero rows for shop post-redact |
| Sentry capturing webhook payload PII | Information disclosure | Configure `beforeSend`/default PII off (`sendDefaultPii` not enabled); don't attach payloads to Sentry context |

## Sources

### Primary (fetched directly this session)
- https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance — 48h `shop/redact`, `customers/redact` timing, 401 requirement, TOML `compliance_topics`
- https://github.com/Shopify/shopify-app-template-react-router — README (scaffold command, deploy guidance), `app/routes` listing, raw `webhooks.app.uninstalled.tsx`, raw `shopify.app.toml`, raw `package.json`
- https://raw.githubusercontent.com/Shopify/shopify-app-js/main/packages/apps/shopify-app-react-router/CHANGELOG.md — v2.0.0 breaking changes
- https://shopify.dev/docs/api/shopify-app-react-router/latest/authenticate/webhook — WebhookContext shape, undefined session
- https://shopify.dev/docs/apps/launch/deployment/deploy-web-app — env vars, deploy steps
- https://docs.sentry.io/platforms/javascript/guides/react-router/manual-setup/ — full Sentry RR7 wiring
- https://docs.railway.com/guides/healthchecks — health check config, 300s timeout, PORT injection
- npm registry via `npm view` (2026-08-17) — all package versions
- gsd-tools `package-legitimacy check` (2026-08-17) — verdicts + download/repo signals

### Secondary (search, cross-checked)
- https://docs.railway.com/networking/domains/working-with-domains + Railway Station threads — CNAME+TXT, apex flattening, Cloudflare workaround, sticky TXT verification
- Shopify community / template GitHub issues — library 401 `{valid:false, reason: invalid_hmac}` behavior, "Use HMAC verification" check flakiness, body-consumption gotcha

### Tertiary (LOW confidence, validate at build)
- Compliance topic string casing in library dispatch (A1); `${{Postgres.DATABASE_URL}}` syntax (A3)

## Metadata

**Confidence breakdown:**
- Scaffold/template state: HIGH-for-web — raw files fetched from repo `main` this session (A5 caveat: npm-published scaffold may differ from GitHub `main`)
- GDPR timings & 401 requirement: HIGH-for-web — verbatim quotes from official docs; resolves CONTEXT.md's flagged D-06 question
- Railway deploy/domain: MEDIUM — official docs fetched, but reference-variable syntax and `react-router-serve` PORT behavior assumed until first deploy
- Sentry wiring: HIGH-for-web — manual-setup docs fetched with code verbatim
- Version currency: HIGH — `npm view` against registry today; note seam classifies web providers LOW-ceiling; tags above reflect [CITED] not [VERIFIED] except where the in-repo/registry rules are fully met

**Research date:** 2026-08-17
**Valid until:** 2026-08-31 (fast-moving: Shopify libs mid-major-release train; re-check lockfile resolution at scaffold)
