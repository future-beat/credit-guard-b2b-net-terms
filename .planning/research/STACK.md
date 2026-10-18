# Stack Research

**Domain:** Shopify B2B credit-control app (embedded admin app + checkout enforcement + reminder emails)
**Researched:** 2026-08-14
**Confidence:** MEDIUM-HIGH overall (all key claims cross-verified across multiple sources incl. official shopify.dev/changelog pages surfaced via search; direct shopify.dev fetch was DNS-blocked in this environment, so exact GraphQL schema field names should be re-confirmed from docs at phase-plan time)

## The Critical Question First: Can We Block a B2B Checkout?

**YES — via the Cart and Checkout Validation Function API.** This is the single most load-bearing fact for this project, so it goes first.

| Question | Answer | Confidence |
|----------|--------|------------|
| Exact API name | **Cart and Checkout Validation Function API** (a Shopify Functions API) | HIGH — official docs at `shopify.dev/docs/api/functions/latest/cart-and-checkout-validation` |
| Function target name | **`cart.validations.generate.run`** in current API versions (2025-01+). Older versions used `purchase.validation.run` — you will see both in tutorials; use the new one. Shopify's own current example repo uses `cart_validations_generate_run.rs` | MEDIUM-HIGH — confirmed via Shopify's official example repo (`Shopify/example-checkout--validation--preact`); verify exact target string against 2026-07 docs when scaffolding |
| Plan availability | **All Shopify plans.** Validation Functions are the server-side validation mechanism and are NOT Plus-gated. (Only checkout **UI extensions** on info/shipping/payment steps and the checkout editor/branding APIs are Plus-only.) | MEDIUM-HIGH — cross-verified across official docs and community sources |
| Works for B2B (company) checkouts? | **Yes.** The function input exposes `cart.buyerIdentity.purchasingCompany` (company + companyLocation), and Shopify's docs explicitly cite "B2B location order minimums, maximums, or credit limits" as a supported use case | MEDIUM-HIGH |
| Works for draft orders? | **Yes.** Per Shopify's changelog, the Cart and Checkout Validation API runs in **draft orders admin and checkout**. A `bypassCartValidations` argument on `draftOrderComplete` and `prepareForBuyerCheckout` lets merchants deliberately bypass validations when completing/sharing a draft order — which conveniently maps to our "bypass" story but also means our block is advisory for merchant-created drafts | MEDIUM-HIGH — from `shopify.dev/changelog/support-for-additional-shopify-functions-apis-in-draft-orders` |
| Biggest constraint | **No network access from the function.** The `fetch` target for Functions is limited to custom apps on Enterprise. Our public-app function CANNOT call our backend at checkout time. **All credit state must be pre-written to metafields** (on Company or CompanyLocation) that the function reads synchronously | HIGH impact — this dictates the architecture |
| Runtime limits | Compiled wasm < 256KB; ~11M instruction execution budget | MEDIUM |

**Architectural consequence (feeds ARCHITECTURE.md):** the backend is the brain — it listens to order/payment webhooks, computes outstanding balance + overdue status per company, and writes a compact "credit status" metafield (limit, exposure, overdue flag, bypass flag) to the Company/CompanyLocation. The validation function is a dumb, fast comparator: read metafield + cart total (+ `purchasingCompany`), return a block-with-message operation or nothing. Metafield write latency = enforcement freshness window; that's acceptable for net-terms credit control.

**Bonus market fact (verified, multiple sources):** As of **April 2, 2026, Shopify native B2B (company accounts, net payment terms Net 30/60/90, self-serve ordering, draft orders) is available on ALL paid plans** — Basic/Grow/Advanced/Plus — no longer Plus-only. Plus retains unlimited catalogs, deposits/partial payments, expansion stores, contextual checkout customization. This dramatically widens the addressable market beyond Plus merchants and explains why competitor apps in this niche appeared ~12 months ago. Confidence: HIGH (official announcement echoed by many independent sources).

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Shopify CLI + `shopify-app-template-react-router` | latest CLI (3.8x) | App scaffold, dev tunnel, deploys, extension generation | **This is the current official template (React Router 7).** It superseded the Remix template (it's literally a fork of it, converted). Shopify recommends it "for most new apps." Scaffold: `shopify app init` (React Router is the default template) |
| React Router | 7.x | Full-stack framework (loaders/actions, SSR) | What the official template ships; Remix v2 merged into RR7. All Shopify docs/examples now target this |
| `@shopify/shopify-app-react-router` | ^1.2.1 (npm, Aug 2026) | OAuth/session/auth, Admin GraphQL client, webhook verification, Billing API helpers | The official app library; handles token exchange + managed installation (no OAuth code to write), HMAC verification, and `billing.require()` for the $25–30/mo subscription |
| Polaris **web components** (`s-page`, `s-card`, `s-button`…) | via App Bridge CDN script (latest, auto-updating) | Embedded admin UI | **`@shopify/polaris` React is deprecated and unmaintained.** Polaris web components are the 2026 standard, load from the App Bridge CDN (satisfies the "latest App Bridge" app-review requirement automatically), and work inside React/JSX |
| Shopify Functions — **Cart and Checkout Validation API** | API version 2026-07, target `cart.validations.generate.run` | Hard-block checkout when over limit / overdue | The only server-side, all-plans mechanism to block checkout. See table above |
| **TypeScript/JavaScript** for the Function | Javy-compiled (default via CLI) | Function implementation language | Shopify's general recommendation is Rust (~7x fewer instructions), **but our function is trivial** — read one metafield, compare against cart cost, emit one error. That's nowhere near the 11M instruction budget even in JS. One language across the whole repo matters more for a solo dev on a 2–4 week clock. Escape hatch: port to Rust if `function-runner` profiling ever shows limit pressure |
| PostgreSQL | 16+ (managed) | App DB: sessions, company credit settings, invoice/AR ledger, reminder log | Template defaults to SQLite, fine for dev; production on PaaS needs a real managed DB. Postgres is the zero-controversy choice and every candidate host has one-click Postgres |
| Prisma | 6.x (template default) | ORM + migrations + session storage | Ships in the template with `@shopify/shopify-app-session-storage-prisma`; swapping SQLite→Postgres is a one-line datasource change |
| Node.js | 20 LTS+ (22 recommended) | Runtime | Template requirement; matches all host default images |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@shopify/shopify-app-session-storage-prisma` | latest (ships with template) | Persist offline access tokens/sessions in Postgres | Always — this IS the session/auth persistence answer; no custom session code |
| Resend SDK (`resend`) | ^4.x | Reminder emails (due−3d, due date, overdue) | Always. **Free tier = 3,000 emails/mo** — at 20–25 merchants this app sends hundreds/mo, so email is $0 until well past the income goal. Great DX, works with react-email templates |
| `react-email` | ^3.x | Typed, previewable email templates | Optional but cheap polish for reminder emails; pairs natively with Resend |
| `node-cron` | ^3.x | In-process daily scheduler for reminder emails + credit-status recompute | Sufficient because the app runs on an always-on server (required for webhooks anyway). No queue infra needed at this scale |
| `@shopify/app-bridge-react` (via template) | latest CDN | Modals, toasts, nav in embedded admin; **Reviews API** in-admin review prompt | Required for app review; the review-prompt requirement uses App Bridge's reviews/`shopify.reviews.request()` surface |
| GraphQL codegen (`@shopify/api-codegen-preset`) | latest | Typed Admin API queries (companies, paymentTerms, orders, metafieldsSet) | Ships with template; keep it — the AR ledger queries get hairy without types |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Shopify CLI (`shopify app dev`) | Local dev with tunnel, hot reload, extension preview | Also runs Function replay/testing |
| `function-runner` | Local Function execution + instruction-count profiling | Use before every Function deploy; catches instruction-budget issues early |
| Development store (with B2B enabled) | Testing companies, payment terms, B2B checkout | Create via Partner Dashboard; B2B features now on all paid plans so dev stores support it |
| Prisma Migrate | Schema migrations | Run in release phase on host (`prisma migrate deploy`) |

## Hosting Recommendation

**Railway** — realistic **US$10–15/mo** for this app (small Node service + managed Postgres), usage-based from a $5 base. Rationale: best deploy DX for a solo dev (git push, one-click Postgres, built-in cron if you prefer it over node-cron), and webhooks + scheduled reminders require an **always-on** process — which rules out spin-down free tiers.

| Host | Realistic monthly (small app + Postgres) | Verdict |
|------|------------------------------------------|---------|
| **Railway** | ~$5–15 idle-to-modest; $15–25 under steady load | **Recommended.** Best DX; watch: no hard spend cap |
| Fly.io | ~$8–25 (no free tier since 2024; minimal Postgres ~$2–7) | Fine alternative; template has a Fly guide; more ops knobs than you need |
| Render | ~$21–28 ($7 web + $7 Postgres + egress); free tier spins down, free Postgres self-deletes after 30 days | Works, but priciest of the three for this shape; never use its free tier for webhooks |
| Vercel/Netlify (serverless) | — | **Avoid**: cron + long-lived webhook processing + node-cron don't fit serverless well; cold starts hurt OAuth/webhook latency |

Total infra at launch: **~$10–15/mo hosting + $0 email + $19 one-time partner registration.** Comfortably inside flat-fee margins.

## Shopify API Versions & Compliance Pins

| Surface | Version to pin | Notes |
|---------|----------------|-------|
| Admin GraphQL API | **2026-07** (latest stable, Aug 2026) | Quarterly releases, 12-month support; 2026-10 is RC. **GraphQL only — REST Admin API is legacy for new apps** |
| Functions API (validation) | **2026-07** | Set in the extension's TOML; keep in lockstep with Admin API version |
| Webhooks | 2026-07 | Subscribe via `shopify.app.toml`. Needed: `orders/create`, `orders/paid` (or `orders/updated`), `companies` topics as available, and the **3 mandatory GDPR topics** (`customers/data_request`, `customers/redact`, `shop/redact`) — app review blocks without them |
| Billing | via `@shopify/shopify-app-react-router` billing config or **managed pricing** in Partner Dashboard | Managed pricing (dashboard-configured plan + trial) is the lowest-code path for a single flat plan with 14-day trial; library `billing.require()` is the code path if you need logic |

## Installation

```bash
# Scaffold (React Router template is the default)
shopify app init credit-guard

# Generate the validation function extension (choose JS/TS)
shopify app generate extension --template cart_checkout_validation

# App deps beyond template
npm install resend react-email node-cron
npm install -D @types/node-cron

# Prisma: switch datasource to postgresql, then
npx prisma migrate dev
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| React Router 7 template | Remix template | Never for new apps — officially superseded; RR7 template is its continuation |
| JS/TS validation function | Rust function | If `function-runner` shows instruction-budget pressure (won't happen for a metafield comparison), or if you later add complex per-line logic |
| Railway | Fly.io | If you want multi-region or the template's existing Fly deploy guide matters to you |
| Resend | Postmark ($15/mo, 100-email free tier) | If deliverability of overdue notices ever becomes a merchant complaint — Postmark's message streams are the gold standard; overkill at MVP |
| node-cron in-process | Railway cron / BullMQ + Redis | BullMQ only if reminder volume or retry semantics outgrow a daily in-process sweep (~thousands of merchants — a good problem) |
| Managed pricing (dashboard) | `billing.require()` in code | Use code path only if you add plan tiers or usage charges later |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@shopify/polaris` (React package) | **Deprecated, unmaintained** as of 2025/2026; app review + "Built for Shopify" expectations track the new admin design language | Polaris web components via App Bridge CDN |
| Remix app template | Superseded; new docs/examples target React Router 7 | `shopify-app-template-react-router` |
| REST Admin API | Legacy for new public apps; new features (companies, payment terms detail) are GraphQL-first/only | Admin GraphQL 2026-07 |
| `purchase.validation.run` target (old tutorials) | Renamed in 2025-01+ API versions; old blog posts will mislead scaffolding | `cart.validations.generate.run` |
| Checkout UI extensions as the blocking mechanism | They can't hard-block server-side, and info/shipping/payment steps are Plus-only — would silently exclude the newly-opened Basic/Grow/Advanced B2B market | Cart and Checkout Validation Function (all plans, server-side) |
| Calling your backend from the Function (`fetch` target) | Network access in Functions is Enterprise/custom-app only — not available to a public app | Pre-computed credit-status **metafields** on Company/CompanyLocation, written by your backend on webhook events |
| Shopify Scripts | Sunset in 2026 (Plus-only legacy anyway) | Shopify Functions |
| Serverless hosting (Vercel functions) | Always-on needs: webhook bursts, daily cron, in-process scheduler | Railway/Fly always-on container |
| Custom OAuth/session code (express + passport etc.) | Token exchange + managed installation in the official library make hand-rolled OAuth pure risk (and an app-review liability) | `@shopify/shopify-app-react-router` + Prisma session storage |

## Stack Patterns by Variant

**If enforcement freshness must be near-real-time** (merchant fear: "customer sneaks an order in between webhook and metafield write"):
- Write the credit-status metafield synchronously in the `orders/create` webhook handler (exposure increases immediately), and recompute decreases (payments) on `orders/paid` + daily sweep.
- Because the Function reads metafields at checkout, staleness window ≈ webhook latency (seconds), which is acceptable.

**If a merchant is on Shopify Plus with draft-order-heavy workflows:**
- The validation runs in draft orders admin too; document that `bypassCartValidations` on `draftOrderComplete` exists — merchants completing their own drafts can bypass deliberately, which matches the per-company bypass story but should be surfaced in the dashboard ("order X bypassed validation").

**If instruction limits ever bite (large carts + future per-line rules):**
- Port only the function to Rust (`cargo` toolchain via Shopify CLI); app code unchanged. Rust ≈ 7x fewer instructions than Javy JS.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@shopify/shopify-app-react-router@1.2.x` | React Router 7.x, Node 20+ | Do not mix with `@shopify/shopify-app-remix` docs/imports — different package |
| Prisma 6.x | `@shopify/shopify-app-session-storage-prisma` latest | Session table schema ships in template migration; keep it when switching to Postgres |
| Function extension TOML `api_version = "2026-07"` | Admin API 2026-07 | Keep function + admin + webhook versions in lockstep to avoid schema drift on `purchasingCompany` fields |
| App Bridge CDN script | Polaris web components | Web components are served/versioned via the same CDN — no npm version to manage; this is what keeps you perpetually on "latest App Bridge" for review |

## Sources

- [Cart and Checkout Validation Function API (latest)](https://shopify.dev/docs/api/functions/latest/cart-and-checkout-validation) — API name, run target, B2B credit-limit use case — MEDIUM-HIGH (official, via search; direct fetch DNS-blocked)
- [Changelog: Functions APIs in draft orders](https://shopify.dev/changelog/support-for-additional-shopify-functions-apis-in-draft-orders) — draft-order support, `bypassCartValidations` — MEDIUM-HIGH (official changelog)
- [Shopify/shopify-app-template-react-router](https://github.com/Shopify/shopify-app-template-react-router) — current official template, RR7, forked from Remix template — HIGH
- [@shopify/shopify-app-react-router on npm](https://www.npmjs.com/package/@shopify/shopify-app-react-router) — v1.2.1, Aug 2026 — HIGH
- [Build a Shopify app using React Router](https://shopify.dev/docs/apps/build/build?framework=reactRouter) — official guidance — MEDIUM-HIGH
- [Language considerations for Functions](https://shopify.dev/docs/apps/build/functions/programming-languages) + [JS for Functions](https://shopify.dev/docs/apps/build/functions/programming-languages/javascript-for-functions) — Rust recommendation, Javy, limits — MEDIUM-HIGH
- [Shopify/example-checkout--validation--preact](https://github.com/Shopify/example-checkout--validation--preact) — confirms `cart_validations_generate_run` target naming — MEDIUM-HIGH
- [Polaris web components](https://shopify.dev/docs/api/app-home/web-components) + [Shopify engineering: upgrading to Polaris web components](https://shopify.engineering/upgrading-checkout-blocks-app-to-polaris-web-components) — Polaris React deprecated — MEDIUM-HIGH
- [i95dev: Shopify B2B on all plans](https://www.i95dev.com/resources/ecommerce-news/shopify-b2b-on-all-plans/), [Bemeir B2B plans 2026](https://bemeir.com/articles/shopify-b2b-plans-limits-and-where-it-breaks-2026/), [Ask Phill B2B 2026](https://askphill.com/blogs/blog/b2b-on-shopify) — April 2, 2026 B2B-on-all-plans rollout, Plus-only remainders — HIGH (many independent corroborations)
- [Shopify API versioning](https://shopify.dev/docs/api/admin-rest/usage/versioning) + changelog — 2026-07 latest stable, quarterly cadence — MEDIUM-HIGH
- [Render vs Railway vs Fly pricing 2026 (hostim.dev)](https://hostim.dev/blog/render-vs-railway-vs-fly-pricing/), [ExpressTech 2026 pricing showdown](https://expresstech.io/render-vs-railway-vs-fly-io-2026-pricing-showdown/) — realistic hosting costs — MEDIUM (community, cross-checked)
- [Resend vs Postmark comparisons 2026 (courier.com, suprsend, buildmvpfast)](https://www.courier.com/integrations/compare/postmark-vs-resend) — email pricing/free tiers — MEDIUM (cross-checked)

---
*Stack research for: Shopify B2B credit-control app (Credit Guard: B2B Net Terms)*
*Researched: 2026-08-14*
