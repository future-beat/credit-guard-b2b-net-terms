# Credit Guard: B2B Net Terms

Credit control for Shopify merchants who sell on native B2B payment terms.
Shopify records the terms; Credit Guard enforces them.

- A **credit limit per company**.
- A **credit hold at checkout** when a company is over its limit or has an
  overdue invoice, with a per-company **bypass** for the orders you want through.
- **Payment reminders** sent by Shopify from the merchant's own template,
  72 hours before, on, and 72 hours after the due date.
- An **accounts-receivable dashboard**: what each company owes, what is
  overdue, what falls due next.
- No buyer contact data is stored, and the app never touches money.

**Status:** v1.0.1, listed on the
[Shopify App Store](https://apps.shopify.com/credit-guard-b2b-net-terms) since
2026-09-04 and running in production. Active development ended in October 2026;
the app is maintained, not extended. One plan, US$29/month, 14-day trial, billed
through Shopify App Pricing (no billing code in this repo). Website:
<https://creditguardhq.com>. Release notes: [`CHANGELOG.md`](CHANGELOG.md).

## About this repository

A solo build by Hesam Abbaszadi, from market research on 14 August 2026 to App
Store approval on 4 September, followed by a production hotfix release (1.0.1).
It was built with AI pair-programming (Claude Code) under a written
plan, execute and verify workflow; the full planning record is kept in
[`.planning/`](.planning/).

Worth reading if you are here to evaluate the work:

- **The constraint chain** in [`.claude/CLAUDE.md`](.claude/CLAUDE.md): four
  platform facts that forced the architecture, starting with Shopify Functions
  having no network access.
- **[`.planning/WINDOWS.md`](.planning/WINDOWS.md)**, the cross-phase defect
  ledger: every known gap, how it was found, and how it was closed or why it
  was waived.
- **Per-phase research, plans and verification reports** in
  [`.planning/phases/`](.planning/phases/), including the App Store self-review
  and a production debugging write-up.
- **885 tests** against a real Postgres, with webhook signatures never mocked
  and source-guard tests that fail the build on known regressions.
- **[`docs/RUNBOOK.md`](docs/RUNBOOK.md)**, the operations record: deployment,
  production probes, and live evidence of checkout holds and delivered
  reminders.

## How it works

Shopify Functions cannot make network calls, so the checkout decision has to be
pre-computed:

1. Order, payment-terms and company **webhooks** feed a Postgres ledger.
   `recomputeCompany` is the only writer of a company's exposure and overdue
   state, and always recomputes from the stored orders.
2. That state is **published to a `credit_v1` metafield** on the Shopify
   Company after every change, with an hourly backstop.
3. The **Cart & Checkout Validation Function** reads the metafield at checkout
   and holds the cart when the company is bypass-off and either overdue or
   would exceed its limit. It fails open on anything malformed.
4. Hourly sweeps flip overdue status and send reminders through Shopify's
   `paymentReminderSend`; a daily reconciliation re-derives every balance from
   Shopify so a missed webhook heals within a day.

Order attribution is company-side (Shopify's `company { orders }` connection),
which is why the app never needs `read_customers`. The full constraint chain,
module map and conventions are in [`.claude/CLAUDE.md`](.claude/CLAUDE.md).

## Repository layout

| Path | Contents |
| ---- | -------- |
| `app/` | React Router 7 app: embedded admin routes, webhook routes, public landing/privacy/support pages, and `services/*.server.ts` (ledger, metafields, enforcement, reminders, reconciliation, scheduler, backfill, dashboard, onboarding, token health). Polaris web components via App Bridge. |
| `extensions/credit-guard-validation/` | The Validation Function (`src/cart_validations_generate_run.ts`), pure and unit-tested without a wasm runtime. |
| `prisma/` | Schema (sessions, shops, companies, order/schedule ledger, receipts, cursors, leases, compliance log, enforcement events, reminder log) and migrations. |
| `scripts/` | Read-only production probes (`prod-*.sh`), `smoke-deployed.sh`, `send-signed-webhook.sh`. |
| `tests/` | Vitest suite against a real local Postgres, including source-guard tests. |
| `site/` | The static marketing page for creditguardhq.com (Vercel). |
| `docs/RUNBOOK.md` | The operations runbook: everything below in full. |
| `.planning/` | GSD planning record: roadmap, requirements, defect ledger (`WINDOWS.md`), research, per-phase plans and verifications. |

## Quick start

Prerequisites: Node ≥ 20.19, a local PostgreSQL, the Shopify CLI.

```shell
export PATH="$HOME/.npm-global/bin:$PATH"
npm install
cp .env.example .env            # fill in; never committed
npm run dev                     # shopify app dev against the dev store
```

Tests use the `creditguard_test` database, never `creditguard_dev`:

```shell
npm test                        # migrations first, then vitest (serial)
npm run graphql-codegen && npm run typecheck
npm run lint
npm run build                   # the only gate that catches server code in client bundles
```

Two rules that have each cost a cycle: wrap every Shopify CLI call in the TOML
byte-guard (the CLI silently re-pins `api_version`; it must stay `2026-07`), and
never set `automatically_update_urls_on_dev = true`. Details:
[runbook → Local development](docs/RUNBOOK.md#local-development).

## Deploy and operate

Production is one always-on Railway service (`credit-guard-app`) with managed
Postgres, at `app.creditguardhq.com`.

```shell
railway up --service credit-guard-app --ci
scripts/smoke-deployed.sh app.creditguardhq.com
scripts/prod-ledger-state.sh <shop>.myshopify.com | jq '.ledger'
```

The runbook covers the rest:

- [Deployment, variables and domain](docs/RUNBOOK.md#deployment-railway)
- [Verifying a deploy and inspecting production](docs/RUNBOOK.md#verifying-the-deployed-app)
- [Access scopes](docs/RUNBOOK.md#access-scopes) and
  [checkout enforcement registration](docs/RUNBOOK.md#checkout-enforcement-registration)
- [Payment reminders: proof of sending](docs/RUNBOOK.md#payment-reminders)
- [Billing](docs/RUNBOOK.md#billing-app-pricing) and the
  [launch runbook](docs/RUNBOOK.md#launch-runbook)
- [Marketing site deploy and DNS](docs/RUNBOOK.md#marketing-site-site)

## Licence

Code: MIT, see [`LICENSE`](LICENSE). The Credit Guard name, logo and App Store
listing assets are not covered by the licence; see [`TRADEMARKS.md`](TRADEMARKS.md).
