# Credit Guard: B2B Net Terms

## 1.0.1 — 2026-09-10

Hotfix. Closes WINDOWS #30, #31 and #32. No schema change, no scope change, no
Function change.

### Fixed

- **WINDOWS #31 — `shop/redact` and `app/uninstalled` no longer answer 500 when
  the stored offline token cannot be refreshed.** The library's
  `authenticate.webhook` refreshes an expired offline token between the HMAC
  check and the handler, and for a store that no longer exists that refresh
  fails forever — so the delivery 500s on every retry and the store's data is
  never redacted. Both routes now verify the signature through a validation-only
  `@shopify/shopify-api` instance and never load a session at all. Live
  evidence: reviewer store eztcd0-3u, nine retried 500s from 2026-09-05T19:25Z,
  data never redacted.
- **WINDOWS #32 — `EnforcementEvent` rows are now deleted on `shop/redact`.**
  The model carries `companyGid` and `companyName` snapshots with no foreign
  key, so it survived every redact silently. The redaction-contract test now
  counts it, which is what would have caught it in the first place.
- **WINDOWS #30 — a shop whose offline token cannot be refreshed is now
  auto-deactivated instead of being swept forever.** After three separate sweep
  cycles of token-class failures (refresh → 500, `invalid_subject_token`, Admin
  API 401) with no successful call in between, the app treats the revoked token
  as the uninstall it never received: it deactivates the shop and deletes its
  session rows, so a later `shop/redact` needs no refresh. Strikes are
  time-gated to one per 30-minute window, so one sweep's burst across many
  companies counts once and a live merchant cannot be deactivated by a single
  bad minute. A single successful Admin call resets the count; network errors,
  Shopify 5xx, throttling and GraphQL-level errors never count; and a merchant
  who opens the app is reactivated exactly as before.

### Changed

- `@shopify/shopify-api` is now a declared dependency (13.1.0, exact). It was
  already installed transitively as a dependency of
  `@shopify/shopify-app-react-router`; nothing new was downloaded.

## 1.0.0 — 2026-08-24

Submitted for Shopify App Store review. First release: a merchant can see what
every B2B company owes, cap it, and have Shopify refuse a net-terms checkout
that would breach the cap.

**Approved and listed on the Shopify App Store on 2026-09-04** — https://apps.shopify.com/credit-guard-b2b-net-terms (App Store
visibility currently limited; build f1032f0, tag v1.0.0).

### Added

- **Accounts-receivable dashboard** as the app's home page — total outstanding,
  overdue companies, companies on credit hold, and what falls due in seven days,
  over an overdue table, a 30-day due table, a closest-to-limit table and a feed
  of orders that went through *during* a hold. Written throughout in the
  **"credit hold"** vocabulary: the app counts holds and the orders that slipped
  past one, and never claims a dollar total of checkouts it stopped — per-attempt
  refusals are not observable, so the number would be fiction.
- **Guided setup** — three steps (review your balances, set your first credit
  limit, confirm enforcement is on), each reading live state rather than a
  checklist flag, and removable for good once complete.
- **Shopify App Pricing gate** — one plan, US$29/month, 14-day free trial, no
  usage tiers. The app carries zero billing code: `billing.check()` decides, and
  a store without a subscription is sent to Shopify's own plan page. **The gate
  fails open** — a billing API error can never lock a paying merchant out of
  their own receivables.
- **In-admin review moment** — Shopify's Reviews API, fired once after a genuine
  success moment, with neutral platform copy, no incentive and no button
  (policy 1.3.1).
- **Honest data-completeness banner** — while any net-terms order is still
  unmatched to a company, totals say so instead of quietly understating.

### Fixed

- **Order and company ingest latency (submission blocker).** Attribution was
  attempted once, at the first webhook; if Shopify had not yet indexed the order
  on the company edge it was never retried until the next daily reconciliation.
  New orders could take hours to appear — which would have made the reviewer's
  own setup instructions fail deterministically. Now re-attempted on later
  doorbells and by a five-minute `attribution-heal` sweep on its own lease.
  Proven live on a fresh store: `attributed 0 / unresolved 2 / dataComplete
  false` → `2 / 0 / true`, unattended.
- **Template landing page removed** (AI self-review 1.1.4 / 2.3.1) — bare `/`
  served the scaffold's placeholder marketing page and a shop-domain login form.
  Replaced with a factual static page and no shop input.
- **WINDOWS #3** — a webhook delivered after uninstall is acknowledged and
  dropped by name instead of 500-ing and being retried by Shopify for ~48 h.
- **WINDOWS #8** — session-token JWTs no longer reach the host log store: a
  pre-boot stdout/stderr scrubber redacts credential query values. Verified in
  the live log store (17/17 redacted, zero raw JWTs).
- **WINDOWS #10** — the reconciliation exhaustion flip no longer starves on the
  shop's newest unattributable order. Closed on live data.
- **WINDOWS #12** — the `validationUpdate` echo's read-then-write window is
  documented at the site, with its visible-reversion outcome and the absence of
  any CAS on the platform side.
- **WINDOWS #20** — a failed reminder outranked by a more severe sibling already
  sent is retired, not re-sent. No buyer gets "due in 3 days" after "due today".
- **WINDOWS #21** — only a closed set of GraphQL error codes is retriable;
  anything ambiguous is recorded `SENT_UNCONFIRMED` rather than re-sent.
- **WINDOWS #22** — Settings and README state plainly that v1 chases only
  net-terms orders attributed to a company.

### Verified live

- **WINDOWS #13** — a company *overdue but under its credit limit* had a real
  net-terms checkout refused with the overdue message, verbatim as shipped. The
  first overdue-driven hold in the demo store's history.

### Known limitations

- **WINDOWS #18 / #19** — a payment has never been completed through a
  reminder's pay-now link: a development store refuses to transact even with
  Shopify's own test gateway. Closes on the first store with a real gateway.
- **WINDOWS #11** — the exact decimal format of a Function run's cart total is
  unobserved; normalisation handles either form.
- Checkout enforcement applies to **net-terms checkouts**. An order completed
  from a draft, or placed while a company's bypass toggle is on, is not checked
  — but it is counted and surfaced on the dashboard.

---

# @shopify/shopify-app-template-react-router

## 2026.01.08
- [#170](https://github.com/Shopify/shopify-app-template-react-router/pull/170) - Update React Router minimum version to v7.12.0

## 2025.12.11

- [#151](https://github.com/Shopify/shopify-app-template-react-router/pull/151) Update `@shopify/shopify-app-react-router` to v1.1.0 and `@shopify/shopify-app-session-storage-prisma` to v8.0.0, add refresh token fields (`refreshToken` and `refreshTokenExpires`) to Session model in Prisma schema, and adopt the `expiringOfflineAccessTokens` flag for enhanced security through token rotation. See [expiring vs non-expiring offline tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens#expiring-vs-non-expiring-offline-tokens) for more information.

## 2025.10.10

- [#95](https://github.com/Shopify/shopify-app-template-react-router/pull/95) Swap the product link for [admin intents](https://shopify.dev/docs/apps/build/admin/admin-intents).

## 2025.10.02

- [#81](https://github.com/Shopify/shopify-app-template-react-router/pull/81) Add shopify global to eslint for ui extensions

## 2025.10.01

- [#79](https://github.com/Shopify/shopify-app-template-react-router/pull/78) Update API version to 2025-10.
- [#77](https://github.com/Shopify/shopify-app-template-react-router/pull/77) Update `@shopify/shopify-app-react-router` to V1.
- [#73](https://github.com/Shopify/shopify-app-template-react-router/pull/73/files) Rename @shopify/app-bridge-ui-types to @shopify/polaris-types

## 2025.08.30

- [#70](https://github.com/Shopify/shopify-app-template-react-router/pull/70/files) Upgrade `@shopify/app-bridge-ui-types` from 0.2.1 to 0.3.1.

## 2025.08.17

- [#58](https://github.com/Shopify/shopify-app-template-react-router/pull/58) Update Shopify & React Router dependencies.  Use Shopify React Router in graphqlrc, not shopify-api
- [#57](https://github.com/Shopify/shopify-app-template-react-router/pull/57) Update Webhook API version in `shopify.app.toml` to `2025-07`
- [#56](https://github.com/Shopify/shopify-app-template-react-router/pull/56) Remove local CLI from package.json in favor of global CLI installation
- [#53](https://github.com/Shopify/shopify-app-template-react-router/pull/53) Add the Shopify Dev MCP to the template

## 2025.08.16

- [#52](https://github.com/Shopify/shopify-app-template-react-router/pull/52) Use `ApiVersion.July25` rather than `LATEST_API_VERSION` in `.graphqlrc`.

## 2025.07.24

- [14](https://github.com/Shopify/shopify-app-template-react-router/pull/14/files) Add [App Bridge web components](https://shopify.dev/docs/api/app-home/app-bridge-web-components) to the template.

## July 2025

Forked the [shopify-app-template repo](https://github.com/Shopify/shopify-app-template-remix)

# @shopify/shopify-app-template-remix

## 2025.03.18

-[#998](https://github.com/Shopify/shopify-app-template-remix/pull/998) Update to Vite 6

## 2025.03.01

- [#982](https://github.com/Shopify/shopify-app-template-remix/pull/982) Add Shopify Dev Assistant extension to the VSCode extension recommendations

## 2025.01.31

- [#952](https://github.com/Shopify/shopify-app-template-remix/pull/952) Update to Shopify App API v2025-01

## 2025.01.23

- [#923](https://github.com/Shopify/shopify-app-template-remix/pull/923) Update `@shopify/shopify-app-session-storage-prisma` to v6.0.0

## 2025.01.8

- [#923](https://github.com/Shopify/shopify-app-template-remix/pull/923) Enable GraphQL autocomplete for Javascript

## 2024.12.19

- [#904](https://github.com/Shopify/shopify-app-template-remix/pull/904) bump `@shopify/app-bridge-react` to latest
-
## 2024.12.18

- [875](https://github.com/Shopify/shopify-app-template-remix/pull/875) Add Scopes Update Webhook
## 2024.12.05

- [#910](https://github.com/Shopify/shopify-app-template-remix/pull/910) Install `openssl` in Docker image to fix Prisma (see [#25817](https://github.com/prisma/prisma/issues/25817#issuecomment-2538544254))
- [#907](https://github.com/Shopify/shopify-app-template-remix/pull/907) Move `@remix-run/fs-routes` to `dependencies` to fix Docker image build
- [#899](https://github.com/Shopify/shopify-app-template-remix/pull/899) Disable v3_singleFetch flag
- [#898](https://github.com/Shopify/shopify-app-template-remix/pull/898) Enable the `removeRest` future flag so new apps aren't tempted to use the REST Admin API.

## 2024.12.04

- [#891](https://github.com/Shopify/shopify-app-template-remix/pull/891) Enable remix future flags.

## 2024.11.26

- [888](https://github.com/Shopify/shopify-app-template-remix/pull/888) Update restResources version to 2024-10

## 2024.11.06

- [881](https://github.com/Shopify/shopify-app-template-remix/pull/881) Update to the productCreate mutation to use the new ProductCreateInput type

## 2024.10.29

- [876](https://github.com/Shopify/shopify-app-template-remix/pull/876) Update shopify-app-remix to v3.4.0 and shopify-app-session-storage-prisma to v5.1.5

## 2024.10.02

- [863](https://github.com/Shopify/shopify-app-template-remix/pull/863) Update to Shopify App API v2024-10 and shopify-app-remix v3.3.2

## 2024.09.18

- [850](https://github.com/Shopify/shopify-app-template-remix/pull/850) Removed "~" import alias

## 2024.09.17

- [842](https://github.com/Shopify/shopify-app-template-remix/pull/842) Move webhook processing to individual routes

## 2024.08.19

Replaced deprecated `productVariantUpdate` with `productVariantsBulkUpdate`

## v2024.08.06

Allow `SHOP_REDACT` webhook to process without admin context

## v2024.07.16

Started tracking changes and releases using calver
