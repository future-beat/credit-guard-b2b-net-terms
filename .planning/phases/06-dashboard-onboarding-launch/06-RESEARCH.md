# Phase 6: Dashboard, Onboarding & Launch - Research

**Researched:** 2026-08-21
**Domain:** Shopify App Pricing (managed billing), App Bridge Reviews API, Shopify App Store review, Polaris web-component dashboard over the existing Prisma ledger
**Confidence:** HIGH on billing/reviews/listing mechanics (official docs fetched verbatim this session + installed-library source read), HIGH on dashboard data (schema read), MEDIUM on review timeline and launch-store costs

## Summary

Phase 6 has no new infrastructure. Every dashboard metric DASH-01/02 asks for is already in Postgres (`Company`, `LedgerOrder`, `LedgerSchedule`, `EnforcementEvent`, `ReminderLog`), already indexed for the read paths the dashboard needs, and already accumulating live data on credit-guard-demo. The work is (a) one new migration adding onboarding/review bookkeeping columns to `Shop`, (b) a real home route replacing the Phase 1 placeholder, (c) a ~12-line subscription gate in the root loader, (d) a ~15-line review-prompt hook, and (e) a Partner Dashboard + listing checklist that is mostly human, browser-only work.

The three launch questions resolve cleanly. **LNCH-01:** Shopify App Pricing (renamed from "managed pricing") is the default for new public apps; plans, 14-day trials and welcome links are configured in the listing's Pricing section; dev stores in your own Partner org select any plan at $0; the app reads subscription state with `billing.check()` from the already-installed `@shopify/shopify-app-react-router@1.2.1` with **zero billing config** (the library force-enables `unstable_managedPricingSupport`) and redirects to the Shopify-hosted plan page when there is none. **LNCH-02:** `shopify.reviews.request()` is typed in the installed `@shopify/app-bridge-types@0.7.2`, returns `{success, code, message}`, is rate-limited by Shopify (once/60 days, 3/365 days, never <24h after install), and dev stores bypass the limits so it is testable now. **LNCH-03:** the listing needs a 1200x1200 icon, 3-6 screenshots at 1600x900, a feature image/video, a screencast in English, test credentials, a privacy URL (exists at /privacy), an emergency developer contact, and a `read_all_orders` justification; review takes "5-10 business days" nominally and 2-3+ weeks in recent reports.

Two gray areas need a decision before planning: the DASH-02 requirement text ("blocked $X of over-limit orders") describes a number the platform cannot observe (Phase 4 D4-03); and DASH-03's "enable enforcement" step describes an action the app already performs automatically. Both get honest proposed mappings below.

**Primary recommendation:** Build the dashboard as a pure projection of existing tables; gate on `billing.check()` in `app.tsx`; prompt for a review on the first dashboard load after a `BLOCK_STATE_ENTERED`/`BYPASSED_ORDER`/`ReminderLog SENT` row exists; close WINDOWS #8, #22, #12, #20, #21, #3 in a hygiene wave before submission; tick "Free for partners and developers" on the plan so the reviewer's dev store can select it.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DASH-01 | Merchant sees an AR dashboard: total outstanding, overdue companies, upcoming due dates, per-company credit utilization | § Dashboard Data Map — every metric maps to an indexed Prisma query on existing tables; § Components — `s-grid`/`s-section`/`s-table`/`s-badge` |
| DASH-02 | Dashboard surfaces the enforcement event log ("blocked $X of over-limit orders") and bypassed-order alerts | § Dashboard Data Map rows 6-9; § Gray Area 1 (honest phrasing, since per-attempt blocks are unobservable per D4-03) |
| DASH-03 | Merchant completes a guided setup: review backfilled balances -> set first limit -> enable enforcement | § Onboarding — composed setup guide (no catalog component exists), derived step state, one `Shop` migration; § Gray Area 2 ("enable enforcement" semantics) |
| LNCH-01 | App charges US$25–30/mo flat with 14-day free trial via Shopify App Pricing (managed pricing, no billing code) | § LNCH-01 — Partner Dashboard steps, `billing.check()` gate, testing table, trial proration; § Gray Area 3 (price point) |
| LNCH-02 | In-admin review prompt via official Reviews API, triggered after first success moment (first block or first reminder sent) | § LNCH-02 — `shopify.reviews.request()` surface, codes, rate limits, trigger query, dev-store testing |
| LNCH-03 | App passes Shopify app review: Polaris web components, App Bridge latest, populated B2B demo store, screencast, reviewer credentials | § LNCH-03 — submission checklist, listing asset specs, common rejection reasons, reviewer access plan, WINDOWS triage |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Actionable directives extracted from `./CLAUDE.md` -> `AGENTS.md` + `.claude/CLAUDE.md`:

- Use the Shopify AI Toolkit for Shopify platform work; do not add tooling to the repo. `[CITED: AGENTS.md]` — note the `/shopify-app-store-review` self-review skill ships in that toolkit (see LNCH-03).
- Polaris **web components** only; `@shopify/polaris` React is forbidden. `[CITED: .claude/CLAUDE.md "What NOT to Use"]`
- Admin GraphQL **2026-07** only; REST forbidden; Functions/webhooks pinned in lockstep. `[VERIFIED: shopify.app.toml:81, app/shopify.server.ts:13]`
- Managed pricing (now "Shopify App Pricing") is the chosen billing path; `billing.require()` only if tiers appear later. `[CITED: .claude/CLAUDE.md "Billing" row]`
- Reviews: official Reviews API in-admin prompts only; no incentivized reviews. `[CITED: .claude/CLAUDE.md Constraints]`
- Flat US$25–30/mo, no usage tiers. `[CITED: .claude/CLAUDE.md Constraints]`
- GSD workflow enforcement: all edits go through `/gsd-execute-phase` / `/gsd-quick`. `[CITED: .claude/CLAUDE.md]`

### CLAUDE.md rows proven stale this session (correct during Phase 6, do not trust as-is)

| CLAUDE.md claim | Reality | Evidence |
|---|---|---|
| "`bypassCartValidations` argument on `draftOrderComplete`" | **Absent from 2026-07.** `draftOrderComplete` args are exactly `id`, `paymentGatewayId`, `sourceName`; the string occurs 0 times in the schema | `[VERIFIED: app/types/admin-2026-07.schema.json via node introspection this session]` |
| Resend SDK ^4 + react-email ^3 for reminders | Not installed, not used. Phase 5 sends via Shopify's own `paymentReminderSend` (D5-01); no email provider exists in the app | `[VERIFIED: package.json has no resend/react-email; shopify.app.toml:44-54]` |
| `node-cron` ^3.x | `^4.6.0` | `[VERIFIED: package.json:39]` |
| `@shopify/shopify-app-react-router` ^1.2.1 "latest" | 1.2.1 installed; **2.0.0 published 2026-08-10** (Node 22 only, removes `AppProvider embedded` prop, which `app.tsx` ErrorBoundary uses). **Do not upgrade in Phase 6** | `[VERIFIED: npm view; CHANGELOG.md fetched]` |
| "Polaris web components via App Bridge CDN script" | Two scripts: `AppProvider` injects `app-bridge.js` (embedded) **and** `polaris.js` separately | `[VERIFIED: node_modules/@shopify/shopify-app-react-router/dist/esm/react/components/AppProvider/AppProvider.mjs:58]` |
| Per-attempt block counts surfaced on dashboard | Impossible (D4-03); see Gray Area 1 | `[VERIFIED: prisma/schema.prisma:264-271]` |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Subscription gate (LNCH-01) | Frontend Server (RR7 loader, `app.tsx`) | Shopify-hosted plan page | Loader already authenticates; `billing.check()` is server-side Admin GraphQL; redirect must be `target:"_top"` because the iframe cannot navigate its parent |
| Plan/trial/price configuration | Partner Dashboard (human) | — | App Pricing has no API surface for plan creation; it is a listing form |
| Review prompt (LNCH-02) | Browser (App Bridge `shopify.reviews.request()`) | Frontend Server (eligibility query + stamp) | Modal is rendered by the admin host; only the browser can call it; the server decides *whether* |
| AR dashboard reads (DASH-01/02) | Frontend Server loader -> Postgres | — | Pure projection of local ledger; never the Admin API at page-load (Phase 3 rule: one DB round trip, unbreakable by a Shopify outage) |
| Onboarding state (DASH-03) | Database (`Shop` columns) + derived from ledger | Frontend Server | Steps 2-3 are facts already in the DB; only "reviewed balances" acknowledgement and "dismissed" need storage |
| Listing, screencast, reviewer creds (LNCH-03) | Partner Dashboard (human) | Demo store (human) | Browser-only; plans should emit checkpoints, not code tasks |

## LNCH-01 — Shopify App Pricing (formerly Managed Pricing)

All statements in this section are `[CITED: shopify.dev/docs/apps/launch/billing/shopify-app-pricing(.md) and sub-pages, fetched verbatim 2026-08-21]` unless tagged otherwise.

### What it is, who can use it
- "Managed Pricing has been renamed to Shopify App Pricing"; "Shopify App Pricing is the default option when you submit a new public app for approval." New apps get it without opting in.
- `activeSubscription` "only works for public apps." App must be distributed via the App Store (ours is: `distribution: AppDistribution.AppStore` `[VERIFIED: app/shopify.server.ts:18]`).
- "Once you opt in to Shopify App Pricing, you can't create new recurring application charges using the Billing API." Fine — we never will.

### Plan capabilities (flat recurring + trial)
- Recurring: "free, monthly, yearly, or monthly-with-yearly-discount plans." Up to 8 public plans, 15 private plans.
- Free trial: "Under **Free trial duration**, enter the number of days you want to offer" — per plan. Listing guidance: "consider offering a free trial (we recommend 14 days)."
- Trial proration: "tracks trial days over a 180-day period to prevent users from repeatedly reinstalling apps to exploit free trial periods." Trial extensions and discounts are per-merchant Partner Dashboard actions (no code).
- Welcome link: "Specify a relative path to your app root, such as `/welcome`. Your `plan_handle` URL parameter is appended." -> set to `/app` (our home). Do **not** build a separate welcome route; the onboarding guide lives on the home page anyway.
- Currency/regional pricing: **not addressed in the docs.** `[ASSUMED]` Plans are priced in USD and shown to merchants in USD. (A1)

### Exact Partner Dashboard steps (human checkpoint)
1. Partner Dashboard -> **Apps > All Apps** -> *Credit Guard: B2B Net Terms*.
2. **Distribution** -> beside *Shopify App Store listing*, **Manage listing**.
3. Under **Published languages**, **Edit** the English listing.
4. Under **Pricing content**, **Manage** (Pricing index page). If a Settings toggle appears, choose **Shopify App Pricing**.
5. **Public plans > Add**: Billing = *monthly*; Monthly charge = the chosen price (Gray Area 3); **Free trial duration = 14**; **Development stores: tick "Free for partners and developers"** (see next bullet); Welcome link = `/app`; Save.
6. Back in Pricing content: **Display name** (e.g. "Credit Guard") + **Top features** (bullets). "A plan will only display to merchants if it has a description for the current language."
7. Optionally add the **$0 private test plan** ("Private plans" section) scoped to `credit-guard-demo.myshopify.com` for testing before publishing a plan.

### Dev stores, the reviewer, and the demo store — the testing matrix (verbatim)
| App and dev store relationship | Plans available at no charge |
|---|---|
| The app and dev store belong to the same Partner organization | Every plan that is available to the store |
| The app and dev store belong to different Partner organizations | Free plans and paid plans the Partner marks as free to test |

- Our demo store is same-org -> selects the paid plan at $0: "Shopify creates an app subscription contract with effective prices of $0."
- **The app reviewer's store is a different org.** If the plan is not marked "Free for partners and developers", the reviewer faces a real charge and cannot proceed. **Tick it.** ("The plan's price still applies on production stores.")
- "Don't use the Billing API `test` field for this flow."
- Known wart: "its plan selection page might return a 404 error if the development store and the app listing are set to different locales. This issue doesn't affect production stores or published apps."

### How the app knows the subscription state with zero billing code
Official React Router guide (`.../shopify-app-pricing/redirect-plan-selection-page.md`) — verbatim pattern:

```ts
// app/routes/app.tsx loader  — Source: shopify.dev redirect-plan-selection-page.md
const { billing, redirect, session } = await authenticate.admin(request);
const { hasActivePayment } = await billing.check();
const storeHandle = session.shop.replace(".myshopify.com", "");
if (!hasActivePayment) {
  return redirect(
    `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`,
    { target: "_top" }, // required since the URL is outside the app scope
  );
}
```

Verified against the installed library, not just the doc:
- `billing.check()` exists with no billing config: `@shopify/shopify-app-react-router@1.2.1` passes `future: { unstable_managedPricingSupport: true }` unconditionally, and `@shopify/shopify-api`'s `check()` only throws "Attempted to look for purchases without billing configs" when that flag is off. `[VERIFIED: node_modules/@shopify/shopify-app-react-router/dist/esm/server/shopify-app.mjs:125-127; node_modules/@shopify/shopify-api/dist/esm/lib/billing/check.mjs:12-17]`
- It runs Admin GraphQL `currentAppInstallation { activeSubscriptions {...} oneTimePurchases(...) }` and sets `hasActivePayment` when any subscription passes `isTest || !subscription.test`; **`isTest` defaults to `true`**, so dev-store $0 contracts count as active. `[VERIFIED: check.mjs:19,42-46,62-65,72-76]`
- Schema: `QueryRoot.appInstallation`/`currentAppInstallation` -> `AppInstallation.activeSubscriptions: [AppSubscription]`; `AppSubscription { createdAt currentPeriodEnd id lineItems name returnUrl status test trialDays }`; `AppSubscriptionStatus` enum verbatim: `ACCEPTED, ACTIVE, CANCELLED, DECLINED, EXPIRED, FROZEN, PENDING`. `[VERIFIED: app/types/admin-2026-07.schema.json, introspected this session]`
- `appHandle` = `credit-guard-net-terms`. `[VERIFIED: shopify.app.toml:5]`
- Library 401 handling is built in (token invalidation + re-auth response). `[VERIFIED: dist/esm/server/authenticate/admin/billing/check.mjs]`

Caveats the planner must carry:
- The App Pricing page says subscription status comes from the **Partner API** `activeSubscription(appId:, shopId:)` and that "This is different from the Billing API, where subscription status comes from the GraphQL Admin API" — yet Shopify's own React Router App Pricing guide uses Admin-API `billing.check()`. Both are official. **Use `billing.check()`** (no Partner API client, no extra secret); **empirically confirm** on the demo store that selecting the $0 plan flips `hasActivePayment` to `true` (E-1). A community report of `activeSubscription` returning 500 right after plan selection during review exists (`[ASSUMED]`, community.shopify.dev/t/35807) — so the gate must fail **open** on transport errors (render the app, log to Sentry), never fail closed, to avoid a reviewer seeing a redirect loop. (A2)
- Is the plan page shown automatically during install? The docs only say "A common pattern is to redirect merchants to your plan selection page after they install your app." `[ASSUMED]` It is **not** guaranteed to be automatic for every install path -> the root-loader gate is required regardless. (A3)
- Trial expiry / declined or frozen charges: the merchant approves the charge (with trial terms) when selecting the plan; at trial end Shopify bills automatically. On `SUBSCRIPTION_FROZEN` ("store billing issue") or cancellation, `activeSubscriptions` should no longer return the contract and the gate redirects the merchant to re-select. `[ASSUMED]` that FROZEN contracts drop out of `activeSubscriptions` (the enum has `FROZEN` but the field's filter semantics are undocumented). (A4) **No webhook** exists for App Pricing: "Shopify App Pricing doesn't use webhooks to notify your app of subscription changes."
- Gate scope: put it in `app.tsx` so every `/app/*` route is covered; exclude nothing — webhooks and `/privacy`/`/healthz` are outside `app.tsx`. Do **not** gate the `ensureShopActive`/`startBackfill`/`ensureValidationRegistered` side effects behind the plan check; run them before the redirect so a merchant's first load still kicks off backfill during the plan step (first-session value).
- "Pricing set before listing submission?" Yes in practice: plans live *inside* the listing form, and requirement 4.2 demands accurate pricing in the designated section. Set the plan first, then submit.

### Revenue math for the price point (Gray Area 3 input)
- Income floor A$900–1,000/mo. `[CITED: memory/income-goal-shopify-first.md]`
- `[ASSUMED]` USD/AUD ≈ 1.53 and Shopify's 0% revenue share on the first US$1M/yr for registered developers. (A5)
- At **$29**: 23 merchants ≈ US$667 ≈ A$1,020. At **$25**: 27 merchants needed. $29 is inside the constraint band, is the App Store's most common sub-$30 price point, and cuts the merchant count needed by ~15%.

## LNCH-02 — Reviews API (App Bridge)

`[CITED: shopify.dev/docs/api/app-home/apis/user-interface-and-interactions/reviews-api(.md), fetched verbatim]` + `[VERIFIED: node_modules/@shopify/app-bridge-types/dist/index.d.ts:235,1004-1036,1651-1652]`

- Surface: `shopify.reviews.request(): Promise<ReviewRequestResponse>` on the App Bridge global (already obtained in the codebase via `useAppBridge()` — `[VERIFIED: app/routes/app.companies.tsx:14,523]`).
- Response verbatim: success `{ success: true, code: "success", message: "Review modal shown successfully" }`; declined `{ success: false, code, message }` with `ReviewRequestDeclinedCode = "mobile-app" | "already-reviewed" | "annual-limit-reached" | "cooldown-period" | "merchant-ineligible" | "recently-installed" | "already-open" | "open-in-progress" | "cancelled"`.
- Rate limits: "Once within any 60-day period (`cooldown-period`). Three times within any 365-day period (`annual-limit-reached`)."
- Restrictions: never shown if already reviewed, on mobile, merchant ineligible, or "installed your app for less than 24 hours (`recently-installed`)".
- Guidance: "It's better to request a review at the end of a successful workflow than when a merchant first opens your app... Don't trigger a request with a merchant action, as rate-limiting might prevent the modal from displaying, making your app appear to be broken." -> never wire it to a button.
- Testing: "You can use your development store to test the Reviews API, which bypasses the rate limits and restrictions. Reviews submitted from development stores are not published." -> testable on credit-guard-demo today. `[ASSUMED]` the modal renders for an app that is not yet listed (A6) — E-2 checks this.
- Policy: 1.3.1 "Asking for reviews must be done so in neutral language. It is forbidden to offer incentives or withhold features." 2.2 also forbids requesting reviews from admin UI extensions/Sidekick/checkout extensions — we use none.
- App Bridge version: delivered by `https://cdn.shopify.com/shopifycloud/app-bridge.js` (unversioned = latest), injected by `AppProvider` with `data-api-key`. `[VERIFIED: AppProvider.mjs:58 + authenticate/const.mjs]` The `app-bridge-react` npm package (4.2.12 installed) only wraps the global; it does not pin a version.

### Trigger design (prescriptive)
Success moments, from tables the app already writes:
- First enforcement: `EnforcementEvent.kind IN ('BLOCK_STATE_ENTERED','BYPASSED_ORDER')` — constants verbatim `BLOCK_STATE_ENTERED: "BLOCK_STATE_ENTERED"`, `BYPASSED_ORDER: "BYPASSED_ORDER"`. `[VERIFIED: app/services/enforcement.server.ts:57-67]`
- First reminder: `ReminderLog.status = 'SENT'` — constant verbatim `SENT: "SENT"`. `[VERIFIED: app/services/reminders.server.ts:136-140]` The schema comment already names this query: "Phase-6 dashboard feed and LNCH-02's 'first reminder sent' query." `[VERIFIED: prisma/schema.prisma:367-368]`

Flow: home loader computes `reviewEligible = (Shop.reviewPromptedAt == null) && (exists enforcement success row OR exists SENT row)`. On mount, if eligible, `await shopify.reviews.request()`; then POST intent `review-prompt-result` with the code. Server stamps `Shop.reviewPromptedAt` when `code ∈ {success, already-reviewed, merchant-ineligible, annual-limit-reached}`; leaves it null for `recently-installed`, `cooldown-period`, `mobile-app`, `already-open`, `open-in-progress`, `cancelled` so a later load retries. Shopify enforces its own limits, so a retry is harmless; the stamp just stops needless calls. Requires a `Shop.reviewPromptedAt DateTime?` column (same migration as onboarding).

## LNCH-03 — App review submission (2026)

`[CITED: shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review.md, pass-app-review.md, app-requirements-checklist.md, shopify-app-store/app-store-requirements.md, built-for-shopify/requirements.md — all fetched verbatim 2026-08-21]`

### Submission mechanics
- Start at the **Shopify App Store review page** in the Partner Dashboard: guided mandatory fields + **automated checks** that "must be run and completed successfully."
- Configuration section: app URLs must not contain "Shopify"; compliance webhooks required (done: `compliance_topics` `[VERIFIED: shopify.app.toml:137-139]`); app icon "1200 x 1200 pixels... JPEG or PNG"; API contact email without "Shopify"; **emergency developer contact (email + phone)** required (4.5.6).
- Protected customer data: "Applying for protected customer data isn't possible while the app is under review." Ours is already approved at Level 1 (WINDOWS #2 fixed) — nothing to do.
- `read_all_orders`: 3.2.1 "If your app is accessing the `read_all_orders` scope, it must demonstrate the need for this scope." The access request was granted (WINDOWS #2) for the app; include the D-06 justification (backfill every open net-terms invoice regardless of age; without it exposure is silently understated) in the testing notes. `[ASSUMED]` the granted access request carries over to production stores at listing approval without a second request (A7).
- AI self-review: `/shopify-app-store-review` skill in the Shopify AI Toolkit "reads the requirements, inspects your project, and returns a report" — run it as a Wave-0-style task (AGENTS.md already mandates the toolkit).
- Contact: reviewer email comes to the listing's contact email; allow-list `noreply@shopify.com`.

### Listing assets (exact specs)
| Asset | Spec (verbatim) |
|---|---|
| App icon | "Dimensions of 1200px by 1200px", JPEG/PNG, square with padding, no text/screenshots/Shopify marks |
| Feature media | "A short video (2-3 minutes)... limit screencasts to 25% of the video" OR feature image "1600px by 900px, 16:9", one focal point, 4.5:1 contrast, alt text |
| Screenshots | "1600px by 900px (16:9). Include 3-6 desktop screenshots, including at least one of your app's UI... Crop out browser chrome and sensitive information... avoid PII, and don't include pricing, reviews, or outcome guarantees" |
| App introduction | 100 characters, benefit-led |
| App details | 500 characters, functional, no testimonials |
| Feature list | up to 80 characters per feature |
| Demo store URL | "Provide a link to a development store that showcases your app" |
| Privacy policy | required (have: `/privacy`, unauthenticated resource route `[VERIFIED: app/routes/privacy.tsx]`) |
| Pricing | "Recurring charge"; plans auto-sorted; 14-day trial recommended |
| Categories/tags | up to 25 structured features; 5 search terms, one idea each |
| Install eligibility | optional; B2B is not a listed criterion |
| Translations | English auto-translated into 8 languages; nothing to do |

### Testing instructions and reviewer access
- 4.5.3 "Include a screencast to demonstrate your app's onboarding and features as described in its listing... clear step-by-step instructions showing how to set up your apps core features... in English or have English subtitles."
- 4.5.4/4.5.5 test credentials must be valid and "grant full access to the app's complete feature set."
- Reviewers install on **their own development store** (pass-app-review.md: "Install your app on a development store"; the demo store URL is explicitly "a development store"). **App review does not require a paid store.** `[CITED]`
- B2B reality: a reviewer's fresh dev store has no companies, no net-terms orders, and the checkout block needs a company buyer. Prescribe a two-track instruction set: (1) **demo-store track** — collaborator/staff access to credit-guard-demo plus the storefront password and a company-buyer login (customer-account email with one-time code) so they can see the block live; (2) **own-store track** — numbered steps: enable B2B, create company + location with Net 30 terms, add a customer, create a net-terms order via draft order, open Credit Guard, set a limit below the balance, attempt checkout as the buyer. `[ASSUMED]` reviewers accept collaborator access to a Partner-owned dev store as "credentials" (A8) — common practice, not spelled out in the docs.
- Screencast storyboard (in listing order): install -> onboarding guide -> balances appear (backfill) -> set limit -> Companies badge flips -> buyer checkout blocked with merchant's message -> bypass toggle lets it through -> dashboard shows the bypassed-order alert -> Settings reminders on -> dashboard reminder feed. 2-4 minutes.

### Embedded-app checks against our code
- 2.2.3 "all apps must use the latest Shopify App Bridge by adding the `app-bridge.js` script tag before any other script tags. We recommend adding it to the <head>." Our `AppProvider` renders the script inside `<body>` before React Router's `<Scripts />` — identical to the official React Router template, which is the reference implementation the automated check is built for. `[VERIFIED: app/root.tsx, app/routes/app.tsx:63; AppProvider.mjs]` — leave as is.
- Session-token auth, no third-party cookies, incognito-safe: `authenticate.admin` everywhere. `[VERIFIED: routes]`
- 2.1.1/2.1.3: no 404/500/300 in the UI. The home placeholder is replaced in this phase; the `/auth/login` route exists (template) — fine.
- 2.3.x install/reinstall: managed installation via CLI config; two-stage uninstall proven in Phase 1.
- Performance: **Lighthouse storefront scoring does not apply** ("For apps that affect storefronts directly"); the validation Function is not a storefront script. Admin Web Vitals (LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms at p75) are **Built for Shopify** criteria, not App Store gates, and need 100+ calls/28 days to even be assessed.

### Built for Shopify — cheap wins vs. out of reach
- Out of reach now: 50 net paid installs, 5 reviews, rating threshold (1.2.x).
- Cheap and worth doing in Phase 6 (also improve review odds):
  - 4.1.4 #3: "An app has a separate navigation item in addition to the app name that redirects to the app's homepage" is a rejection reason -> **remove `<s-link href="/app">Home</s-link>`** from `s-app-nav`. `[VERIFIED: app/routes/app.tsx:72]`
  - 4.2.2: onboarding must be concise, findable, and **removable once complete** ("After onboarding has been completed, there is no mechanism to remove UI related to onboarding" is a rejection) -> dismiss affordance + `Shop.onboardingDismissedAt`.
  - 4.2.3: homepage must "clearly indicate if the app is set up and working" and show metrics; "a homepage only displays links... or a static welcome message" is a rejection -> the dashboard is exactly this.
  - 4.1.5 contextual save bar / 4.1.6 modals — not needed by the dashboard.

### Review timeline
- Official guidance in reviewer emails: "up to 2 weeks"; community reports (2026) of 3+ weeks before a reviewer is assigned; older guidance "5-10 business days". `[ASSUMED — community sources only]` (A9). Plan for **10-15 business days** plus one resubmission round; each failed round in the "Yes" column of the common-problems table forces a full resubmit. Consecutive failures after two exchanges can trigger a temporary submission suspension.

### Common rejection reasons mapped to this app
| Category (official table) | Our exposure | Mitigation |
|---|---|---|
| Billing: pricing inaccurate; plan changes impossible | Single plan -> "upgrade/downgrade" is moot, but 1.2.3 still applies; a reviewer can cancel via the admin charge page | State in testing notes that there is one plan; App Pricing handles cancellation natively |
| Installation: no immediate OAuth redirect / fatal error / reinstall broken | Proven in Phase 1; reinstall flips `Shop.active` | Re-run uninstall->reinstall on the demo store before submitting |
| Embedding: flips between embedded/non-embedded | ErrorBoundary renders non-embedded `AppProvider` only on loader failure | Keep; ensure the billing gate cannot throw into it (fail open) |
| UI: broken/404/500 | New home route + gate are the new risk | Integration tests on the loader; manual pass in incognito |
| App testing: no instructions/credentials/screencast | Biggest B2B-specific risk | Two-track instructions + screencast above |
| "Apps that falsify data" (1.1) / truthful listing (4.3) | "blocked $X" claims we cannot substantiate; settings copy overstating reminder eligibility (WINDOWS #22) | Gray Area 1 phrasing; fix #22 |

## Dashboard Data Map (DASH-01 / DASH-02)

All columns verified by reading `prisma/schema.prisma` this session. Store currency comes from the Phase 3 `resolveShopCurrency` pattern (most recently refetched `LedgerOrder.currencyCode`) `[VERIFIED: app/routes/app.companies.tsx:164-171]`; format with the existing `createMoneyFormatter` (Intl, display-only) `[VERIFIED: app.companies.tsx:457-466]` — lift it into a shared module rather than duplicating.

| # | Metric | Source (verbatim schema) | Query | Index |
|---|--------|--------------------------|-------|-------|
| 1 | Total outstanding | `Company.exposure Decimal @default(0) @db.Decimal(19, 4)` (schema.prisma:94) — "never incremented... overwritten by a full recompute" | `db.company.aggregate({ where:{shop}, _sum:{exposure:true}, _count:true })` | `@@unique([shop, companyGid])` (:132) — seq scan over ≤ 50 rows is fine |
| 2 | Overdue companies | `Company.overdue Boolean @default(false)` (:95), `earliestDueAt DateTime?` (:96) | `db.company.findMany({ where:{shop, overdue:true}, orderBy:{earliestDueAt:'asc'} })` | `@@index([shop, overdue])` (:133) |
| 3 | Upcoming due dates (7/30 d) | `LedgerSchedule.dueAt DateTime?`, `completedAt DateTime?` (:190-191); money columns "are NEVER summed" (:182-184) | `db.ledgerSchedule.findMany({ where:{shop, completedAt:null, dueAt:{gte:now, lte:now+30d}, order:{ companyId:{not:null}, cancelledAt:null } }, include:{order:{select:{name,outstandingShop,currencyCode,company:{select:{name,companyGid}}}}}, orderBy:{dueAt:'asc'} })`; show `order.outstandingShop` per row; bucket by 7/30 in code | `@@index([shop, dueAt])` (:199) |
| 4 | Per-company utilization | `creditLimit Decimal? @db.Decimal(19, 4)` (:102) — null = observe-only; `exposure` | `exposure / creditLimit` as Decimal, only when `creditLimit` non-null and > 0; `creditLimit = 0` is "block-all" (100%+) | as #1 |
| 5 | Companies on credit hold | `blockedState Boolean @default(false)` (:126) — "true iff bypassEnforcement == false AND creditLimit != null AND (overdue OR exposure >= creditLimit)" | `db.company.count({ where:{shop, blockedState:true} })` | seq; add `@@index([shop, blockedState])` only if a later phase grows the table |
| 6 | Enforcement feed | `EnforcementEvent { kind, companyName, orderGid?, amount?, channel?, exposure, limit?, overdue, bypass, createdAt }` (:278-307); kinds verbatim `BLOCK_STATE_ENTERED, BLOCK_STATE_EXITED, BYPASS_ENABLED, BYPASS_DISABLED, BYPASSED_ORDER` | `db.enforcementEvent.findMany({ where:{shop}, orderBy:{createdAt:'desc'}, take:25 })` | `@@index([shop, createdAt])` (:306) |
| 7 | Bypassed-order alerts | rows with `kind = 'BYPASSED_ORDER'`; `amount` = "The leaked order's outstanding balance at attribution time"; `channel` = `Order.sourceName` | `db.enforcementEvent.aggregate({ where:{shop, kind:'BYPASSED_ORDER', createdAt:{gte:now-30d}}, _count:true, _sum:{amount:true} })` + list | same index; kind filter is post-index, fine at scale |
| 8 | Reminder activity | `ReminderLog { touchpoint, status, companyName?, orderGid, sentAt?, failureReason?, createdAt }` (:328-369); statuses verbatim `SENDING, SENT, SENT_UNCONFIRMED, FAILED, DEAD, SUPPRESSED_PAID, SUPPRESSED_STALE, SUPPRESSED_PREEXISTING, DEFERRED`; touchpoints `DUE_SOON, DUE, OVERDUE` | `db.reminderLog.findMany({ where:{shop, status:{in:['SENT','SENT_UNCONFIRMED','FAILED','DEAD']}}, orderBy:{createdAt:'desc'}, take:25 })` — hide SUPPRESSED_* and DEFERRED from the merchant feed (internal bookkeeping) or show under a "skipped" filter | `@@index([shop, createdAt])` (:368) |
| 9 | Currency-mismatch companies (D4-02) | `LedgerOrder.currencyCode String` (:163) vs shop currency | `db.ledgerOrder.groupBy({ by:['companyId','currencyCode'], where:{shop, companyId:{not:null}} })` then companies with any row whose `currencyCode !== shopCurrency` | `@@index([shop, companyId])` (:174) |
| 10 | Data completeness / backfill | `shopDataComplete(shop)` `[VERIFIED: metafields.server.ts:202]`; `readBackfillState(shop)` -> `status: "running"|...|"failed"`, `orderCount`, `companyCount` `[VERIFIED: backfill.server.ts:106-117,147]` | reuse as Companies page does | — |

- Reminder orders: `ReminderLog.orderGid` is a GID; join to `LedgerOrder.name` via `{shop, orderGid}` unique (:173) to show "#1015" instead of a GID.
- `EnforcementEvent.companyGid/companyName` are snapshots with no FK (:273-275) — render from the row; never join to `Company` for the name.
- No migration is needed for any read. One migration is needed for `Shop`: `onboardingReviewedAt DateTime?`, `onboardingDismissedAt DateTime?`, `reviewPromptedAt DateTime?`. Add all three to `redactShop`'s scope only insofar as the Shop row is already hard-deleted on `shop/redact` (nothing extra).

## Components (Polaris web components, app-home catalog)

Verified two ways this session: the live catalog index (`shopify.dev/docs/api/app-home/web-components.md`) and the installed `@shopify/polaris-types@1.0.1` (and 1.0.7 unpacked from npm). `[VERIFIED: node_modules/@shopify/polaris-types/dist/polaris.d.ts; catalog URL list]`

Available tags (1.0.1): `s-avatar s-badge s-banner s-box s-button s-button-group s-checkbox s-chip s-choice s-choice-list s-clickable s-clickable-chip s-color-field s-color-picker s-date-field s-date-picker s-divider s-drop-zone s-email-field s-grid s-grid-item s-heading s-icon s-image s-link s-list-item s-menu s-modal s-money-field s-number-field s-option s-option-group s-ordered-list s-page s-paragraph s-password-field s-popover s-query-container s-search-field s-section s-select s-spinner s-stack s-switch s-table s-table-body s-table-cell s-table-header s-table-header-row s-table-row s-text s-text-area s-text-field s-thumbnail s-tooltip s-unordered-list s-url-field`. 1.0.7 adds only `s-press-button`, `s-scroll-box`. `s-app-nav` comes from App Bridge (typed locally in `app/globals.d.ts`).

**Does NOT exist (do not plan for it):** `s-setup-guide`, `s-progress`, `s-progress-bar`, `s-empty-state`, `s-card`, `s-index-table`, `s-data-table`, `s-resource-list`, `s-callout-card`, `s-stat`.

| Need | Use | Props verified |
|---|---|---|
| KPI tiles | `s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base"` of `s-section` (or `s-box` with `border`/`borderRadius`/`background="subdued"`) each holding `s-text` label + `s-heading` value | `GridProps: gridTemplateColumns, gap...`; `BoxProps: background 'transparent'|'base'|'subdued'|'strong', border*, borderRadius` |
| Lists (overdue, upcoming, feeds) | `s-table variant="auto"` + `s-table-header-row`/`s-table-header format="currency"|"numeric"`/`s-table-body`/`s-table-row`/`s-table-cell`; `paginate`/`hasNextPage`/`onnextpage` for feeds | `TableProps: variant 'list'|'table'|'auto', loading, paginate, hasPreviousPage, hasNextPage`; `HeaderFormat = 'base'|'currency'|'numeric'` |
| Status | `s-badge tone=...` — **`ToneKeyword = 'auto'|'neutral'|'info'|'success'|'caution'|'warning'|'critical'|'accent'|'custom'`** (no `attention` — the Phase 3 lesson holds); `icon?: IconType` | polaris.d.ts:201 |
| Alerts (bypassed order, currency mismatch, backfill running) | `s-banner tone="warning"|"critical"|"info" heading=... dismissible ondismiss=...` | `BannerProps: heading, tone, hidden, dismissible, ondismiss` |
| Setup guide rows | `s-stack direction="inline" gap="base" alignItems="center"` with `s-icon type="check-circle-filled"` (done) / `"circle-dashed"` (todo), `s-text`, `s-button variant="secondary"`; progress as `s-text color="subdued"` "2 of 3 complete" | icon names `check-circle-filled`, `circle-dashed`, `check-circle`, `alert-circle`, `clock`, `receivables`, `credit-card`, `shield-check-mark` all in `IconType` (polaris.d.ts:2851) |
| Page actions | `s-page heading="Credit Guard"` with `primaryAction` / `secondaryActions` slots ("Only accepts a single Button... variant primary") | `PageProps: heading, inlineSize, primaryAction, secondaryActions` |
| Tooltips on "· incomplete" | `s-tooltip id` + `interestFor` (as Companies page) | existing pattern |

Optionally bump `@shopify/polaris-types` to `1.0.7` (docs: "specify `@shopify/polaris-types@latest`") — no new tags the dashboard needs, so it is hygiene, not a dependency.

## Onboarding (DASH-03)

**Pattern:** a single `s-section heading="Set up Credit Guard"` at the top of the home page, three rows, derived state, dismissible when 3/3. Matches BFS 4.2.2's illustrated pattern (cards with title, body, button) and its rejection list.

| Step | Complete when (derived, not stored) | Action button | Honest copy direction |
|---|---|---|---|
| 1. Review your balances | `readBackfillState(shop)?.status !== "running"` AND merchant clicked "Looks right" -> `Shop.onboardingReviewedAt` | "Review companies" -> `/app/companies` | Show `companyCount`/`orderCount` from backfill state; show "still importing" spinner while running |
| 2. Set your first credit limit | `db.company.count({ where:{shop, creditLimit:{not:null}} }) > 0` | "Set a limit" -> `/app/companies` | "Companies stay observe-only until you set a limit" (existing Phase 3 vocabulary) |
| 3. Enforcement is on | `Shop.validationGid != null` AND `readValidationConfig(shop)` reports `enabled: true` `[VERIFIED: enforcement.server.ts:772,818]` AND step 2 complete | "Check checkout message" -> `/app/settings`; if the rule is missing/disabled, button "Turn on" -> the existing settings action | See Gray Area 2 |

- Persist only `onboardingReviewedAt` and `onboardingDismissedAt` on `Shop` (the spine's "Shop columns"). Steps 2/3 re-derive on every load so they cannot go stale and need no writer discipline.
- First-session value: `startBackfill` fires on the first authenticated load (`[VERIFIED: app.tsx:36]`), completes in minutes via `bulk_operations/finish`; the guide's step 1 shows live counts so the merchant sees value inside the first session even before setting a limit. The plan-selection redirect must not pre-empt `startBackfill` (see LNCH-01 gate scope).
- Show the guide only while `onboardingDismissedAt == null`; once 3/3, render a "Done" button that stamps it. Never auto-hide without a merchant click (BFS 4.2.2 #3 "difficult to locate" vs #6 "no mechanism to remove" — explicit dismissal satisfies both).

## Gray-Area Decisions (surface to the user before planning)

### Gray Area 1 — DASH-02 phrasing: "blocked $X of over-limit orders" is unobservable
Facts: "Per-checkout-attempt block logging is a platform impossibility — validation Function runs are not webhooked, and 2026-07 exposes no bypass trace" `[VERIFIED: prisma/schema.prisma:264-266]`; D4-03 re-scoped ENFC-05 to transitions + leaks `[VERIFIED: 04-CONTEXT.md]`. Claiming a blocked dollar figure would violate 1.1 ("Apps that falsify data") / 4.3 truthfulness.
Competitor phrasing (`[ASSUMED]`, listing copy via web search): Net Terms Tracker — "the Net Terms payment method disappears from their checkout"; BizCred — "blocking or restricting checkout when limits are exceeded." None advertise a blocked-dollar total.
**Recommendation:** adopt "credit hold" vocabulary and count what is true:
- KPI: "Companies on credit hold: N" (from `blockedState`).
- Feed rows: "Acme Supply placed on credit hold — $3,229.95 outstanding, limit $3,000, overdue" (`BLOCK_STATE_ENTERED` with snapshot); "released from credit hold" (`EXITED`); "Bypass turned on/off for Northwind" (`BYPASS_*`); "Order #1016 ($664.95) went through while Acme was on hold — via draft order" (`BYPASSED_ORDER`, `channel`).
- Alert banner: "3 orders totalling $1,980.00 were placed while a company was on credit hold in the last 30 days" (row 7).
- Record the rewording as a Phase 6 decision and amend the REQUIREMENTS.md DASH-02 text so the verifier does not fail the phase on the literal string.

### Gray Area 2 — DASH-03 "enable enforcement"
Facts: the Validation is created with `enable: true` on every authenticated load by `ensureValidationRegistered` `[VERIFIED: app.tsx:51]`; enforcement is per-company (`creditLimit != null`) not per-shop; merchants can disable the rule in Settings -> Checkout and the app's settings page already shows the status/repair path (Phase 4).
Options: (a) add a merchant-facing shop-level kill switch — new state, new metafield semantics, new Function input: **no**; (b) treat "enable enforcement" as "confirm the checkout rule is live and preview the message" — zero new enforcement semantics; (c) treat it as "set first limit" (merging with step 2) — makes the guide two steps.
**Recommendation:** (b). Step 3 title "Enforcement is on" when the rule is live, "Turn enforcement on" when `readValidationConfig` says missing/disabled (button invokes the existing ensure/repair path). Honest and it reuses Phase 4's status machinery.

### Gray Area 3 — $25 vs $29
See revenue math. **Recommend $29/mo, 14-day trial, monthly only** (yearly discount adds a second plan and proration surface for no MVP gain). Decide before the Partner Dashboard checkpoint because the listing's pricing section and screenshots must agree (screenshots may not show pricing anyway).

### Gray Area 4 — which WINDOWS must close before submission
`workflow.windows_enforce` is **not set** in `.planning/config.json`; its default is `false` ("ship does not block") `[VERIFIED: ~/.claude/gsd-core/bin/lib/capability-registry.cjs:452-456]`. Triage on merit, not on the gate:

| # | Item | Verdict | Why |
|---|---|---|---|
| 8 | id_token JWTs in Railway access logs | **Must fix** | Security leak of live session tokens; small change to the request logger (`start` script uses `react-router-serve`) |
| 22 | Settings copy overstates reminder eligibility + README | **Must fix** | Truthful-listing requirement 4.3; one clause |
| 21 | Ambiguous send treated as not-sent, retried after 25 h | **Must fix** | Double-dunning a real buyer is the listed feature's trust-killer; keyed on `extensions.code` |
| 20 | Late retry of outranked touchpoint ("due in 3 days" after "due today") | **Must fix** | Buyer-visible nonsense email; simple fence + `SUPPRESSED_STALE` |
| 3 | Post-uninstall webhook 500s retried ~48 h | **Should fix** | Reviewer does uninstall/reinstall; 500s are logged platform-side; acknowledge-and-drop on `SessionNotFoundError` |
| 12 | TOCTOU comment | **Fix (trivial)** | Comment only |
| 13 | Live overdue-only block never staged | **Run during screencast prep** | Free while the demo store is being staged; also proves the overdue path for the video |
| 10 | Reconciliation exhaustion starvation -> `data_complete` stuck false | **Fix if ≤ half a day, else ship with a dashboard caveat** | It makes the dashboard's "· incomplete" marker permanent for affected shops — merchant-visible on the new home page |
| 11 | EC-1 decimal-format capture | Can ship | Defensive normalisation already handles both shapes |
| 18 | Pay-now completion never completed | Can ship after E-5 (Bogus gateway on dev store); escalate to a paid store only if E-5 fails | Not a review requirement; the link and page are proven |
| 19 | Email latency on dev store | Can ship | Informational; re-check on first production install |
| 4 | Partial-pay A2 (waived) | Ship | ICP excludes Plus |

### Gray Area 5 — launch store
- App review **does not** require a non-dev store (reviewers use dev stores; the listing's demo store field is a dev store). `[CITED]`
- Cheapest path for #18/#19: **E-5** — on credit-guard-demo, Settings -> Payments -> activate Shopify's **test gateway** ("deactivate your payment gateway and activate Shopify's Test payment gateway" — `[CITED: help.shopify.com/en/manual/b2b/getting-started/testing via WebFetch]`), then open the `order_payment` URL from a reminder and pay with the test card. The observed "This store can't accept payments right now" is consistent with *no active gateway* rather than a dev-store block (`[ASSUMED]`, A10). Cost: $0, 15 minutes.
- If E-5 fails: a real store on Shopify's intro offer (`[ASSUMED]` "3-day free trial, then US$1/mo for 3 months", Basic US$39/mo after — A11) — ≈ US$3 for three months; transfer is unnecessary — install Credit Guard via the Partner "Install app" flow on a non-dev store only after listing approval, or via a private $0 plan + direct install link before. Avoid the "development store -> transfer to merchant" path: it converts the demo store, which the listing needs to keep.
- **Recommendation:** E-5 now; paid store only on failure; otherwise let the first real install close #19 with Sentry/ReminderLog monitoring.

## Standard Stack

### Core (no additions)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@shopify/shopify-app-react-router` | 1.2.1 (installed) — **do not bump to 2.0.0 this phase** | `billing.check()`, `redirect(..., {target:"_top"})`, `authenticate.admin` | Official; managed-pricing support force-enabled `[VERIFIED]` |
| `@shopify/app-bridge-react` / `@shopify/app-bridge-types` | 4.2.12 / 0.7.2 (installed) | `useAppBridge().reviews.request()`, toasts | Types already include `ReviewsApi` `[VERIFIED]` |
| Polaris web components via `polaris.js` CDN + `@shopify/polaris-types` | CDN latest / 1.0.1 (1.0.7 optional) | Dashboard UI | Only sanctioned UI kit |
| Prisma | 6.16.x (installed) | One migration (`Shop` columns) + aggregate/groupBy reads | Existing |
| vitest | 4 (installed) | Loader/query tests | Existing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `billing.check()` (Admin API) | Partner API `activeSubscription` | Needs a Partner API client + token in Railway; docs call it canonical, but the RR7 guide uses `billing.check()`; revisit only if E-1 fails |
| Composed setup guide | Waiting for an official `s-setup-guide` | None exists in the catalog today `[VERIFIED]` |
| Prisma aggregates | Raw SQL views | Not needed at ≤ 50 companies/shop |

**Installation:** none. `npm view` confirms `@shopify/shopify-app-react-router` latest is 2.0.0 (2026-08-10) and `@shopify/polaris-types` latest is 1.0.7 (2026-04-29).

## Package Legitimacy Audit

No new packages. Seam run for the two type packages that might be bumped:

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@shopify/polaris-types` | npm | 10 mo (1.0.7: 2026-04-29) | 120k/wk | none in manifest | SUS (`no-repository`) | Already installed (1.0.1); official Shopify scope; bump optional — if bumped, planner adds `checkpoint:human-verify` per protocol |
| `@shopify/app-bridge-types` | npm | years | 268k/wk | github.com/Shopify/shopify-app-bridge | OK | Installed, unchanged |

**Packages removed due to [SLOP] verdict:** none. **Flagged [SUS]:** `@shopify/polaris-types` (signal is a missing `repository` field on an official Shopify package; no postinstall script).

## Architecture Patterns

### System Architecture Diagram

```
Merchant opens /app/*  ──► app.tsx loader
                            ├─ authenticate.admin ─► ensureShopActive / startBackfill / ensureValidationRegistered (unchanged, before gate)
                            ├─ billing.check() ──► hasActivePayment? ──no──► redirect(_top) admin.shopify.com/store/{h}/charges/credit-guard-net-terms/pricing_plans
                            │                          │yes                        │ merchant approves plan (14-day trial) ─► welcome link /app?plan_handle=...
                            │                          ▼
                            └─► <AppProvider embedded> (app-bridge.js + polaris.js) ─► <s-app-nav> Companies | Settings  ─► <Outlet>

/app (home) loader ──► Postgres (one round trip, Promise.all)
   ├─ Company aggregate/list ──► KPI tiles, utilization table
   ├─ LedgerSchedule upcoming ──► due-date list (7/30 d)
   ├─ EnforcementEvent feed ──► credit-hold feed + bypassed-order banner
   ├─ ReminderLog feed ──► reminder activity
   ├─ backfill state + shopDataComplete + currency-mismatch groupBy ──► banners / "· incomplete"
   ├─ Shop.onboarding* + derived steps ──► setup guide
   └─ reviewEligible ──► client: shopify.reviews.request() ──► action stamps Shop.reviewPromptedAt

Partner Dashboard (human): plan ($29, 14 d, free-for-partners, welcome /app) ─► listing (icon, 3-6 shots, feature image, copy, privacy URL, demo store, screencast, creds, emergency contact) ─► automated checks ─► submit
```

### Recommended structure
```
app/
├── routes/app.tsx                 # + billing gate (fail-open), − "Home" nav link
├── routes/app._index.tsx          # dashboard + setup guide + review hook (replaces placeholder)
├── services/dashboard.server.ts   # the read queries in the Data Map (pure functions over db, shop-scoped)
├── services/onboarding.server.ts  # derived step state + stamps
├── lib/money.ts                   # createMoneyFormatter lifted from app.companies.tsx
prisma/migrations/2026MMDD_add_shop_onboarding_review/   # 3 nullable DateTime columns
tests/dashboard.test.ts, tests/onboarding.test.ts, tests/billing-gate.test.ts
```

### Pattern 1: Fail-open billing gate
**What:** wrap `billing.check()` in try/catch; on error, Sentry-capture and render the app. **When:** always — a reviewer or merchant must never meet a redirect loop because Shopify's billing query hiccuped (community 500 report). Redirect only on a *successful* `hasActivePayment === false`.

### Pattern 2: Shop-scoped read service
**What:** every query takes `shop` from `session.shop` and puts it in `where` (T-03-01 discipline already enforced on the Companies page). Return Decimals as fixed-2 strings to the client (`toFixed(2)`), never floats.

### Pattern 3: Derived-not-stored onboarding
**What:** steps computed from ledger facts each load; only acknowledgements stored. **Why:** no second writer to `creditLimit`/`validationGid`; cannot drift.

### Anti-Patterns to Avoid
- **Summing `LedgerSchedule.balanceDueAmount`** — D-07 forbids; use `Company.exposure` / `LedgerOrder.outstandingShop`.
- **Joining `EnforcementEvent` to `Company` for the name** — the company may be deleted; use the snapshot.
- **Reading the Admin API in the home loader** — breaks the one-round-trip, outage-proof property.
- **Tying `reviews.request()` to a button** — explicitly discouraged by Shopify.
- **`billing.require()` / any Billing API mutation** — incompatible with App Pricing once opted in.
- **Adding a Home nav item** — BFS 4.1.4 rejection; the app name is the home link.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Subscription/charge/trial | Any billing mutation, trial timers, charge status webhooks | App Pricing + `billing.check()` | No webhooks exist for App Pricing; Shopify owns proration, 180-day trial memory, extensions, discounts |
| Review modal | Custom "rate us" UI/links to the listing | `shopify.reviews.request()` | Policy 1.3; rate limits are Shopify's |
| Parent-window redirect | `window.top.location` | `redirect(url, {target:"_top"})` from `authenticate.admin` | iframe sandbox |
| Money formatting | String concatenation | existing `createMoneyFormatter` (Intl) | locale/currency correctness; display-only |
| Plan page | A pricing page in the app | Shopify-hosted `/charges/{app_handle}/pricing_plans` | Required by App Pricing |

**Key insight:** Phase 6's launch surface is almost entirely Shopify-hosted; the app's job is to *ask* (check, request) and *redirect*, never to *own* the billing or review flows.

## Common Pitfalls

### Pitfall 1: Reviewer cannot select the plan
**What goes wrong:** reviewer's dev store (different Partner org) sees only "Free plans and paid plans the Partner marks as free to test" -> a paid-only plan forces a real charge -> review fails.
**How to avoid:** tick "Free for partners and developers"; verify by installing on a dev store outside the org if one is available (E-3), or state in the notes that the plan is marked free-to-test.

### Pitfall 2: Redirect loop / blank app during review
**Why:** billing query transient error or locale 404 on the plan page ("might return a 404 error if the development store and the app listing are set to different locales").
**Avoid:** fail-open gate; keep the listing locale English and the demo store English.

### Pitfall 3: Review prompt never fires in the screencast/session
**Why:** `recently-installed` (<24 h) on production; not on dev stores (limits bypassed).
**Avoid:** test on credit-guard-demo (E-2); do not promise a prompt in the first session.

### Pitfall 4: Dashboard claims unobservable numbers
**Avoid:** Gray Area 1 vocabulary; include the `channel` on leaked orders so "via draft order" is explicit.

### Pitfall 5: "· incomplete" forever on the home page (WINDOWS #10)
**Avoid:** fix #10 or phrase the marker as "some orders are still being matched" with no time promise.

### Pitfall 6: Upgrading `@shopify/shopify-app-react-router` to 2.0.0 mid-launch
**Why:** removes `AppProvider embedded` (ErrorBoundary uses `embedded={false}`), requires Node ≥ 22 (Railway image must match), changes GraphQL error types.
**Avoid:** pin `^1.2.1` through listing approval; schedule the upgrade for v1.1.

### Pitfall 7: Side effects skipped by the gate
**Why:** if `billing.check()` runs before `startBackfill`/`ensureValidationRegistered`, an un-subscribed first load does no backfill -> first session shows nothing after the plan step.
**Avoid:** keep the three fire-and-forget calls above the gate.

## Code Examples

### Home loader skeleton (shop-scoped, one round trip)
```ts
// Source: composed from verified schema + existing route patterns
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const [totals, overdue, upcoming, events, leaks30d, reminders, backfill, dataComplete, currencyCode, shopRow] =
    await Promise.all([
      db.company.aggregate({ where: { shop }, _sum: { exposure: true }, _count: true }),
      db.company.findMany({ where: { shop, overdue: true }, orderBy: { earliestDueAt: "asc" } }),
      db.ledgerSchedule.findMany({
        where: { shop, completedAt: null, dueAt: { gte: now, lte: in30 },
                 order: { companyId: { not: null }, cancelledAt: null } },
        include: { order: { select: { name: true, outstandingShop: true, company: { select: { name: true } } } } },
        orderBy: { dueAt: "asc" }, take: 50 }),
      db.enforcementEvent.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, take: 25 }),
      db.enforcementEvent.aggregate({
        where: { shop, kind: EVENT_KIND.BYPASSED_ORDER, createdAt: { gte: new Date(now.getTime() - 30 * 24 * 3600 * 1000) } },
        _count: true, _sum: { amount: true } }),
      db.reminderLog.findMany({
        where: { shop, status: { in: [REMINDER_STATUS.SENT, REMINDER_STATUS.SENT_UNCONFIRMED, REMINDER_STATUS.FAILED, REMINDER_STATUS.DEAD] } },
        orderBy: { createdAt: "desc" }, take: 25 }),
      readBackfillState(shop), shopDataComplete(shop), resolveShopCurrency(shop),
      db.shop.findUnique({ where: { domain: shop }, select: { validationGid: true, onboardingReviewedAt: true, onboardingDismissedAt: true, reviewPromptedAt: true } }),
    ]);
  // ... Decimal -> toFixed(2) strings; derive onboarding steps; reviewEligible
};
```

### Review prompt hook (client)
```ts
// Source: shopify.dev Reviews API example + app-bridge-types 0.7.2
const shopify = useAppBridge();
const fetcher = useFetcher();
useEffect(() => {
  if (!reviewEligible) return;
  (async () => {
    try {
      const result = await shopify.reviews.request();
      fetcher.submit({ intent: "review-prompt-result", code: result.code }, { method: "post" });
    } catch (error) { /* never surface to the merchant */ }
  })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [reviewEligible]);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "Managed Pricing" + `APP_SUBSCRIPTIONS_UPDATE` webhook | "Shopify App Pricing"; no webhooks; Partner API `activeSubscription`/`events`; URL params on redirect | April 2026 | Apps "enrolled before April 2026" keep legacy behaviour; ours is new |
| `billing.require()` in code | `billing.check()` + hosted plan page | 2024-2026 | Zero billing code |
| Polaris React | Polaris web components (`polaris.js` CDN) | 2025-2026 | No `s-setup-guide`/`s-index-table` equivalents yet |
| `@shopify/shopify-app-react-router` 1.x | 2.0.0 (Node 22, no `embedded` prop) | 2026-08-10 | Defer |

**Deprecated/outdated:** `bypassCartValidations` (never in 2026-07); Billing API recurring charges once on App Pricing.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Plans are priced/displayed in USD only | LNCH-01 | Listing copy mentions USD; low |
| A2 | Admin `currentAppInstallation.activeSubscriptions` reflects App Pricing contracts (official RR7 guide says so; Partner API page implies otherwise); community 500 report | LNCH-01 gate | Gate would redirect paying merchants -> E-1 mandatory; fail-open design bounds the damage |
| A3 | Plan page is not guaranteed automatic on install | LNCH-01 | Only cost is a redundant redirect |
| A4 | FROZEN/CANCELLED contracts drop out of `activeSubscriptions` | LNCH-01 | Frozen merchants keep access until Shopify resolves; acceptable |
| A5 | USD/AUD ≈ 1.53; 0% rev share first US$1M | Price point | Merchant count needed shifts by a few |
| A6 | Reviews modal renders on a dev store before the app is listed | LNCH-02 | E-2 may show `merchant-ineligible` until listed; prompt still correct in prod |
| A7 | Granted `read_all_orders` request carries to production at approval | LNCH-03 | A second access request (~7 business days) would delay listing |
| A8 | Reviewers accept collaborator/staff access to a Partner dev store as credentials | LNCH-03 | Fallback: own-store track instructions |
| A9 | Review takes 10-15 business days in practice | Timeline | Planning only |
| A10 | "can't accept payments right now" = no active gateway on the dev store | WINDOWS #18 | E-5 fails -> paid store (A11) |
| A11 | Shopify intro offer ≈ US$1/mo for 3 months; Basic US$39/mo | Launch store | Cost estimate off by tens of dollars |
| A12 | Competitor listing phrasing (Net Terms Tracker, BizCred) | Gray Area 1 | Copy inspiration only |

## Open Questions

1. **Does `billing.check()` see the App Pricing contract?** Known: library + official RR7 guide say yes; Partner API page hedges. Unclear: behaviour on the $0 dev-store contract. **E-1:** select the plan on credit-guard-demo, hit `/app`, log `hasActivePayment`, `appSubscriptions[0].{name,status,test,trialDays}`.
2. **Does the review modal show pre-listing on a dev store?** **E-2:** temporary dev-only trigger; expect `success` or `merchant-ineligible`; record the code.
3. **Can a different-org dev store select the free-to-test plan?** **E-3:** only if a second Partner org/dev store is available; otherwise rely on the doc table.
4. **Plan page locale 404** — **E-4:** open the `pricing_plans` URL for the demo store before submission.
5. **Pay-now completion with Shopify's test gateway on the dev store** — **E-5** (see Gray Area 5).
6. **Does amending DASH-02's literal text need user sign-off?** Yes — Gray Area 1.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | app | ✓ | v22.20.0 | — |
| npm | deps | ✓ | 10.9.3 | — |
| Shopify CLI | deploy, `app dev` | ✓ | 4.7.0 | — |
| PostgreSQL (local, tests) | vitest | ✓ | accepting on :5432 | — |
| Railway CLI | deploy | ✗ (not on PATH) | — | Git-push deploys / Railway dashboard (Phase 1 path) |
| Partner Dashboard access | LNCH-01/03 | human | — | none — checkpoints |
| Screen recorder / image editor (1600x900, 1200x1200) | LNCH-03 assets | human | — | none — checkpoint |
| Shopify AI Toolkit (`/shopify-app-store-review`) | pre-submission self-review | unknown in this host | — | manual checklist above |

**Missing with no fallback:** none that blocks code. Human-only items (dashboard, assets, screencast) must be `checkpoint:human-verify` tasks.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4, node environment, serial files, Postgres `creditguard_test` `[VERIFIED: vitest.config.ts]` |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/dashboard.test.ts` |
| Full suite command | `npm test` (runs `prisma migrate deploy` on the test DB first via `pretest`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-01 | totals/overdue/upcoming/utilization computed from seeded rows; shop isolation; Decimal strings | unit (DB) | `npx vitest run tests/dashboard.test.ts` | ❌ Wave 0 |
| DASH-02 | feed ordering; BYPASSED_ORDER 30-day aggregate; snapshot name used; reminder feed filters SUPPRESSED_* | unit (DB) | same | ❌ Wave 0 |
| DASH-03 | step derivation (backfill running / limit set / validation live); dismiss + reviewed stamps; action intent whitelist | unit (DB) | `npx vitest run tests/onboarding.test.ts` | ❌ Wave 0 |
| LNCH-01 | gate redirects to the exact `pricing_plans` URL with `_top` when `hasActivePayment` false; renders when true; fails open on throw; side effects run before gate | unit (mock `authenticate.admin`) | `npx vitest run tests/billing-gate.test.ts` | ❌ Wave 0 |
| LNCH-01 | plan visible, $0 selection, `hasActivePayment` true on demo store | manual (E-1) | — | checkpoint |
| LNCH-02 | eligibility query true only after first success row; stamp rules per code | unit (DB) | `npx vitest run tests/review-prompt.test.ts` | ❌ Wave 0 |
| LNCH-02 | modal appears on dev store | manual (E-2) | — | checkpoint |
| LNCH-03 | nav has no Home item; home route renders no GIDs; privacy route still unauthenticated (existing `tests/privacy-route.test.ts`) | unit | `npx vitest run tests/privacy-route.test.ts` | ✅ / ❌ |
| LNCH-03 | listing submitted; automated checks green; approval | manual | — | checkpoint |

### Sampling Rate
- Per task commit: the file-scoped `npx vitest run tests/<file>.test.ts`
- Per wave merge: `npm test`
- Phase gate: full suite green + `npm run typecheck` + `npm run lint` before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/dashboard.test.ts` — DASH-01/02 (seed helpers likely reusable from `tests/enforcement-events.test.ts`, `tests/reminders.test.ts`)
- [ ] `tests/onboarding.test.ts` — DASH-03
- [ ] `tests/billing-gate.test.ts` — LNCH-01 (mock `@shopify/shopify-app-react-router` `authenticate.admin` returning `{ billing:{check}, redirect, session }`)
- [ ] `tests/review-prompt.test.ts` — LNCH-02
- [ ] Migration `add_shop_onboarding_review` applied by `pretest`

## Security Domain

### Applicable ASVS Categories (L1)
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `authenticate.admin` on every loader/action (existing) |
| V3 Session Management | yes | library session tokens; **close WINDOWS #8** (id_token in access logs) before listing |
| V4 Access Control | yes | `shop` from session in every `where`; intents whitelisted; onboarding/review stamps keyed by `session.shop` only |
| V5 Input Validation | yes | action intents closed set; review `code` validated against the 10 known literals before stamping |
| V6 Cryptography | no new | — |
| V8 Data Protection | yes | dashboard renders money/state only; no buyer contact data exists in these tables (T-03-07/T-05-04 discipline) |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant read via forged shop param | Information disclosure | shop from session only (T-03-01 precedent) |
| Open redirect from the billing gate | Tampering | URL built from `session.shop` + constant handle; never from request input |
| Review-prompt spam / policy breach | Repudiation/compliance | neutral copy; no incentive; stamp prevents re-asks; Shopify limits |
| Session JWT in logs (#8) | Information disclosure | redact query strings in the request logger |
| Stale onboarding state misleading merchant | Tampering (self) | derived steps; only acknowledgements stored |

## Sources

### Primary (HIGH confidence — fetched verbatim this session)
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing (.md) — models, setup steps, plan page URL, testing table, Partner API queries, no-webhook notice, limitations
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/redirect-plan-selection-page (.md) — `billing.check()` + `redirect(_top)` pattern
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/offer-free-trials (.md) — trial config, 180-day proration, extensions
- https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/plans (.md) and .../setup-subscription-charges (.md) — plan editor fields incl. "Free for partners and developers", welcome link
- https://shopify.dev/docs/api/app-home/apis/user-interface-and-interactions/reviews-api (.md) — Reviews API surface, codes, limits, dev-store testing
- https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review (.md), .../pass-app-review (.md) — submission flow, automated checks, billing test guidance, common problems table
- https://shopify.dev/docs/apps/launch/app-requirements-checklist (.md) — asset specs, listing fields, performance scope
- https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements (.md) — 1.2, 1.3, 2.1-2.3, 3.2.1, 4.3, 4.5
- https://shopify.dev/docs/apps/launch/built-for-shopify/requirements (.md) — 1.2.x thresholds, Web Vitals, 4.1.4, 4.2.2, 4.2.3
- https://shopify.dev/docs/api/app-home/web-components (.md) — component catalog
- Installed sources: `@shopify/shopify-app-react-router@1.2.1` (`shopify-app.mjs`, `billing/check.mjs`, `AppProvider.mjs`, `authenticate/const.mjs`), `@shopify/shopify-api` `lib/billing/check.mjs`, `@shopify/app-bridge-types@0.7.2`, `@shopify/polaris-types@1.0.1` and 1.0.7 tarball, `app/types/admin-2026-07.schema.json`, `prisma/schema.prisma`, routes and services cited inline
- https://raw.githubusercontent.com/Shopify/shopify-app-js/main/packages/apps/shopify-app-react-router/CHANGELOG.md — 2.0.0 breaking changes

### Secondary (MEDIUM)
- https://help.shopify.com/en/manual/b2b/getting-started/testing (WebFetch summary) — test gateway for B2B test orders

### Tertiary (LOW — community/web)
- community.shopify.dev/t/35807 — `activeSubscription` 500 after plan selection during review
- Review-timeline threads: community.shopify.com/t/review-process-timeline/399738, community.shopify.dev/t/29646, growave.io blog
- Competitor listings: apps.shopify.com/net-terms-tracker, apps.shopify.com/bizcred-b2b

## Metadata

**Confidence breakdown:**
- Billing (LNCH-01): HIGH on mechanics/steps/testing (official docs + library source); MEDIUM on `billing.check()` reflecting App Pricing contracts until E-1
- Reviews (LNCH-02): HIGH (official doc + installed types)
- Listing/review (LNCH-03): HIGH on requirements/specs; LOW on timeline and reviewer-credential conventions
- Dashboard data/components: HIGH (schema and types read; catalog verified)
- WINDOWS triage and launch-store: MEDIUM (judgement + one unverified help-center fact)

**Research date:** 2026-08-21
**Valid until:** 2026-09-20 for billing/listing docs (fast-moving: App Pricing renamed April 2026, library 2.0.0 Aug 2026); schema/components stable through 2026-07 API support window
