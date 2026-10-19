# Credit Guard: B2B Net Terms

A Shopify app that enforces the credit terms Shopify only records: a credit limit
per company, a **credit hold at checkout** when a company is over its limit or
overdue, Shopify-sent payment reminders, and an accounts-receivable dashboard.
No buyer contact data is stored, and the app never touches money.

[Shopify App Store](https://apps.shopify.com/credit-guard-b2b-net-terms) ·
[Website](https://creditguardhq.com) · [Changelog](CHANGELOG.md)

**Status:** v1.0.1, listed since 4 September 2026 and running in production;
maintained, no longer extended. Built solo by Hesam Abbaszadi with AI
pair-programming (Claude Code), from market research to App Store approval in
three weeks.

## How it works

Shopify checkout code cannot call outside servers, so the decision is
pre-computed:

1. Order, payment-terms and company **webhooks** feed a Postgres ledger. One
   function recomputes each company's balance from its stored orders.
2. That state is **published to a metafield** on the Shopify Company.
3. A **Cart & Checkout Validation Function** reads it at checkout and holds the
   cart when the company is over its limit or overdue. It fails open on
   anything malformed.
4. Hourly sweeps flag overdue invoices and send reminders through Shopify; a
   daily reconciliation re-derives every balance so a missed webhook heals.

## Where to look

| Path | What it shows |
| ---- | ------------- |
| [`.claude/CLAUDE.md`](.claude/CLAUDE.md) | The constraint chain, module map and conventions |
| [`.planning/`](.planning/) | Research, per-phase plans and verification, and the defect ledger [`WINDOWS.md`](.planning/WINDOWS.md) |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Deployment, production probes, live evidence |
| `app/`, `extensions/`, `prisma/` | React Router 7 app, the checkout Function, the schema |
| `tests/` | 885 tests against a real Postgres; webhook signatures never mocked |

## Run it

Needs Node ≥ 20.19, PostgreSQL and the Shopify CLI.

```shell
npm install
cp .env.example .env    # your own Shopify app credentials
npm run dev
npm test                # uses the creditguard_test database
```

Stack: TypeScript, React Router 7, Prisma, PostgreSQL, Shopify Functions and
Admin GraphQL (2026-07), Polaris web components, Railway, Sentry.

## Licence

Code is MIT ([`LICENSE`](LICENSE)). The Credit Guard name, logo and listing
assets are excluded ([`TRADEMARKS.md`](TRADEMARKS.md)).
