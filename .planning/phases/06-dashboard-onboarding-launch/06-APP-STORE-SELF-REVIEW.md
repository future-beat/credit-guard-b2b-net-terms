# Shopify App Store — AI self-review (pre-submission)

**App:** Credit Guard: B2B Net Terms (`credit-guard-net-terms`)
**Branch / head:** `phase-06-dashboard-onboarding-launch` @ `1684069`
**Reviewed:** 2026-08-24
**Source of truth:** App Store review requirements fetched via Shopify CLI (`/shopify-app-store-review`), evaluated requirement-by-requirement against the codebase.

## Summary

- ✅ Likely passing: **26**
- ❌ Likely failing: **0**
- ⚠️ Needs review: **5**
- ⏭️ Skipped (not applicable): **71** requirements across 10 groups

> This is an automated static review of the code only. It cannot verify listing content, Partner Dashboard configuration, live TLS, demo-store behaviour, or reviewer judgement. A ✅ here does not guarantee approval; treat ⚠️ items as things to confirm manually before submitting.

## ⚠️ Requirements that need review

### 1.1.4 Use only factual information
- **Why this needs attention:** The app must not present placeholder or non-factual content on any surface a merchant or reviewer can reach.
- **What was detected:** `app/routes/_index/route.tsx` still carries the template's placeholder landing copy — heading `A short heading about [your app]`, tagline `A tagline about [your app]…`, and three `Product feature` bullet stubs. It is reachable at the bare `application_url` (`https://app.creditguardhq.com/`) without a `?shop` parameter. No fabricated data/reviews/statistics were found anywhere else. Replace or remove the placeholder landing page before submission.

### 1.2.2 Implement Shopify App Pricing or the Shopify Billing API correctly
- **Why this needs attention:** Decline and reinstall handling for Shopify App Pricing lives in the Partner Dashboard plan configuration and in Shopify's hosted plan page, not in this repo, so the code alone cannot prove it.
- **What was detected:** `app/routes/app.tsx` uses only `billing.check()` and redirects (`target: "_top"`) to `https://admin.shopify.com/store/{handle}/charges/credit-guard-net-terms/pricing_plans` when `hasActivePayment === false`; it fails open on errors and never calls `billing.require()`/`billing.request()`. No external billing integrations found. Confirm manually on the demo store: (a) declining the plan returns the merchant to the plan page rather than a loop, (b) a reinstall after uninstall re-prompts for the plan, and (c) the plan + 14-day trial is actually published in the Partner Dashboard.

### 2.3.1 Initiate installation from a Shopify-owned surface
- **Why this needs attention:** The app must not ask a merchant to type their `.myshopify.com` domain during install or configuration.
- **What was detected:** Two template routes render a "Shop domain" text input with an `example.myshopify.com` hint: `app/routes/auth.login/route.tsx` (`<s-text-field name="shop" …>`) and `app/routes/_index/route.tsx` (form posting to `/auth/login`). These are the official template's fallback login forms and are only reached when the app is opened outside the admin without `?shop`; the real install path is managed installation + token exchange via `@shopify/shopify-app-react-router`. Reviewers have nonetheless flagged this form in the past. Consider removing the `_index` form (and the placeholder page) and keeping only the library's `/auth/login` fallback, or removing both if you never need a non-admin entry point.

### 3.1.1 Use a valid TLS/SSL certificate
- **Why this needs attention:** TLS termination is handled by the hosting edge (Railway), not by anything in the repository.
- **What was detected:** `application_url` and all `redirect_urls` in `shopify.app.toml` are `https://app.creditguardhq.com/...`; `Dockerfile` exposes plain port 3000 (expected behind a TLS-terminating proxy); no HTTP-only fallback or HTTPS-redirect middleware exists in code (none is needed for an embedded app behind Railway). Verify manually that `https://app.creditguardhq.com` serves with a valid certificate for the custom domain and no mixed-content warnings.

### 3.2.1 Request `read_all_orders` access scope only if it provides necessary app functionality
- **Why this needs attention:** This scope requires a Partner Dashboard access request and a demonstrated need; the reviewer will check the justification against actual usage.
- **What was detected:** Positive evidence of need: `shopify.app.toml` documents the rationale (backfill every open net-terms order regardless of age so exposure is not understated), and `app/services/ledger.server.ts` (`COMPANY_ORDERS_FOR_LEDGER_QUERY`, `company.orders` connection) plus `app/services/reconciliation.server.ts` (`orders(… sortKey: UPDATED_AT)`) walk order history without a 60-day window — an AR ledger on net-terms orders legitimately needs unpaid invoices older than 60 days. Confirm the `read_all_orders` access request has been submitted and approved in the Partner Dashboard for production stores (the TOML notes development stores are exempt), and mirror this justification in the listing/review notes.

## ❌ Requirements that are likely failing

None detected.

## Skipped groups

| Group | Reason skipped |
|---|---|
| 5.1 Online store (3 reqs) | No `shopify.extension.toml` with `type = "theme"`; the only extension is `type = "function"` (`extensions/credit-guard-validation`). |
| 5.2 Payment (8 reqs) | No `type = "payment"` extension and no `write_payment_gateway` scope. |
| 5.3 Payment facilitator (1 req) | Opt-in group; not requested. |
| 5.4 Purchase option (16 reqs) | No `customer_payment_methods`, `own_subscription_contracts`, or `payment_mandate` scopes in `shopify.app.toml`. |
| 5.5 Product sourcing (3 reqs) | Opt-in group; not requested. |
| 5.6 Checkout customization (7 reqs) | No `type = "ui-extension"` / checkout targets; the validation Function (`cart.validations.generate.run`) is not a checkout UI extension. |
| 5.7 Sales channel (14 reqs) | No `type = "channel_config"` extension. |
| 5.8 Post purchase (10 reqs) | No `type = "checkout_post_purchase"` extension. |
| 5.9 Mobile app builders (2 reqs) | Opt-in group; not requested. |
| 5.10 Donation (7 reqs) | Opt-in group; not requested. |

## Notes on evaluated groups (evidence basis, not individually listed)

- Session-token auth, OAuth/token exchange, webhook HMAC, and post-install redirect are all delegated to `@shopify/shopify-app-react-router` (`app/shopify.server.ts`, `app/routes/auth.$.tsx`, `app/routes/app.tsx`); no cookie/localStorage session code exists. Re-install is handled by `ensureShopActive` upsert on every authenticated load.
- App Bridge is loaded by `AppProvider` (CDN `app-bridge.js`), with `@shopify/app-bridge-react@^4.2.4` present; no legacy `@shopify/app-bridge` or Polaris React package.
- All Admin API usage is GraphQL 2026-07 (`metafieldsSet`, `validationCreate`/`validationUpdate`, `paymentReminderSend`, order/company queries); no REST `/admin/api/*.json` calls.
- No order creation, refunds, external checkout, payment processing, theme APIs, capital lending, marketplace, or third-party POS integration found. The Function only blocks/allows checkout; it adds no charges and touches no shipping options.
- Review prompt uses `shopify.reviews.request()` in an effect (no button/banner) — no admin extensions exist, so 2.2.6 is not implicated.
- Mandatory compliance webhooks are subscribed in `shopify.app.toml` and handled in `app/routes/webhooks.compliance.tsx`.

## Resources

- [Shopify App Store requirements](https://shopify.dev/docs/apps/launch/app-requirements-checklist)
- [Shopify App Pricing (managed pricing)](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing)
- [Access scopes — requesting `read_all_orders`](https://shopify.dev/docs/api/usage/access-scopes#orders-permissions)
- [App Bridge getting started](https://shopify.dev/docs/api/app-bridge-library#getting-started)
- [Mandatory compliance webhooks](https://shopify.dev/docs/apps/build/privacy-law-compliance)
- [TLS certificates for apps](https://shopify.dev/docs/apps/store/security/tls-certificates)
