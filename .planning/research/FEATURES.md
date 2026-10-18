# Feature Research

**Domain:** Shopify B2B credit-control / net-terms / accounts-receivable apps
**Researched:** 2026-08-14
**Confidence:** MEDIUM (cross-verified web sources per classify-confidence seam; Shopify-native facts corroborated by official Help Center + Changelog pages; competitor claims from vendor marketing pages are single-source LOW→MEDIUM where cross-checked)

## Context: What Shopify Native B2B Already Does (Do NOT Rebuild)

The app targets stores on **native Shopify B2B**, which as of ~2025 is available on **all plans** (Basic, Grow, Advanced, Plus) — not just Plus. Native already provides:

| Native capability | Detail | Implication for app |
|---|---|---|
| Companies + company locations | First-class B2B entities with contacts, roles | App attaches credit config to these — never build its own customer registry |
| Payment terms | Net 7/15/30/45/60/90, fixed-date, due-on-fulfillment, assignable per company location; shown at checkout | App **enforces** terms; never re-implements term assignment |
| Order due dates + Overdue status | Orders past due automatically show "Overdue" payment status | App reads this; it's the overdue signal, not something to compute from scratch |
| Pay-now links / invoice emails | Buyers get payment collection emails with embedded pay-now link | App reminder emails should deep-link to Shopify's pay flow, not build payment collection |
| Flow "Send payment reminder" action | Up to 5 reminders per order, customizable template, sent to the company's **main contact**, with pay-now link | **Closest native substitute for the app's reminder feature** — see Differentiators for how to beat it |
| Flow "Payment schedule is due" trigger, "Charge vaulted payment" action | Automation hooks; auto-charge vaulted cards | Positioning: app = zero-config; Flow = DIY assembly merchants demonstrably struggle with (community threads on pre-due/looping reminder workflows) |
| Vaulted cards, ACH | On all plans | Out of app scope entirely |
| Deposits / partial payments / payment per fulfillment | **Plus-only** | App's ledger must *read* `partially_paid` status and outstanding amounts correctly, but never process payments |
| Store credit for B2B | Native | Not credit limits — different feature; ignore |

**What native does NOT do (the entire product wedge, confirmed by multiple independent sources):** enforce credit limits at checkout, block new orders when a company has overdue balances, aggregate a company-level AR view ("who owes what across all invoices"), or run pre-due reminder sequences without hand-built Flow workflows. "A buyer on Net 60 with a large outstanding balance can place another order and Shopify will process it."

## Feature Landscape

### Table Stakes (Users Expect These)

Every direct competitor (Net Terms Tracker, NET30, netterms.app, BizCred, Folio) has these. Missing any = merchants churn to a competitor.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Per-company credit limit setting | The category-defining control; every competitor leads with it | LOW | Store limit against native Company ID (metafield or app DB). Simple CRUD + Polaris UI |
| Real-time outstanding-balance ledger | Enforcement is only trusted if the balance is right; BizCred/Folio market "real-time ledger" explicitly | HIGH | Webhook-driven (orders/create, orders/paid, orders/edited, refunds). **Correctness here IS the product** — a wrong block or missed block destroys trust. Must handle `partially_paid`, order edits, refunds, cancellations |
| Checkout enforcement when over limit | "Enforced at checkout" is the phrase competitors use; SparkLayer's warn-only approach is the weak alternative | HIGH | Competitor pattern worth copying: **remove/hide the net-terms payment option** so the buyer can still prepay by card, rather than bricking the whole checkout. Clear buyer-facing message required |
| Block when overdue balance exists | Net Terms Tracker: "the moment a buyer goes overdue, they're suspended from buying more on credit" | MEDIUM | Reads native Overdue order status; same enforcement path as over-limit. Configurable grace days is a fast follow |
| Automated reminder emails (pre-due, due, overdue) | All competitors have it; PROJECT.md requires it | MEDIUM | Sequence: due−3d, due date, overdue. Deliverability is a quality bar — AReceivables sits at 3.3★ partly over unreliable email notifications. Include pay-now deep link to Shopify's payment page |
| AR dashboard (outstanding, overdue, upcoming) | The merchant-facing payoff; netterms.app/AReceivables both center a dashboard | MEDIUM | Company-level rollup: balance, credit utilization, overdue amount, next due date. Embedded Polaris page |
| Zero-config onboarding from native B2B data | Time-to-first-value in first session decides trial conversion (~80% of trials never convert) | MEDIUM | On install: import companies, existing open/overdue orders, terms. Merchant should see their real AR picture within minutes, before configuring anything |
| Respect Shopify payment status (mark-paid, partial payments, refunds) | Merchants collect checks/wires and mark orders paid in admin; Plus stores take deposits | MEDIUM | Read `financial_status` + outstanding amount from Shopify rather than maintaining a parallel payments record. Native-first = no reconciliation drift, unlike portal-based competitors |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Hard block (not warn)** with per-company bypass toggle | SparkLayer only *notifies* the buyer they're exceeding the limit; Wholesale Gorilla just routes to draft-order review. Predictable hard enforcement + a one-click exception switch is the exact missing behavior | MEDIUM | Bypass is per-company, logged, and visible on dashboard. This is the PROJECT.md core value — lean into "trust that no order slips through" |
| **Native-B2B-first, no parallel ledger** | Net Terms Tracker & NET30 largely run their own customer/invoice ledgers (works "on all plans" via tags/own portal). Enforcing what Shopify *already records* means no double data entry, no drift, no second source of truth | MEDIUM | This is architecture-as-feature. Marketing line: "You already set terms in Shopify. We make them mean something." |
| **Enforcement event log ("blocked orders" feed)** | Shows the app earning its fee — "we blocked $4,300 of over-limit orders this month." No competitor surfaces this as ROI | LOW | Also the trigger for the Reviews API prompt (first success moment). Cheap to build once enforcement exists |
| **Company-level statement view / statement email** | Native Flow reminders are strictly per-order to the main contact. A "here's everything your account owes" digest is what real AR teams send; only AReceivables attempts statements | MEDIUM | v1.x candidate: weekly/monthly statement email per company. Beats native Flow decisively |
| Reminder sequences that native Flow can't easily do | Community threads show merchants failing to build pre-due and recurring "until paid" reminders in Flow; native action fires per-order, post-creation, max 5 | LOW (marginal over base reminders) | Position reminders as "works out of the box, no Flow surgery." Escalating cadence + stop-on-payment |
| Flat $25–30/mo pricing vs suites | SparkLayer $49–499/mo, Wholesale Gorilla gates net terms behind Advanced/Premium; single-feature price point undercuts on the one job | — | Pricing is a feature in this category. Free plans of young rivals (NET30, netterms.app, Net Terms Tracker's free-to-5-customers) compete on price-to-try — the 14-day trial must demo value fast |
| Credit utilization shown to the buyer at checkout/cart | Net Terms Tracker's "live cart credit widget" is liked; reduces support tickets ("why can't I check out?") | MEDIUM | v1.x. MVP ships a clear block message; widget later |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Quoting, price lists, wholesale catalogs | "Can it also do wholesale pricing?" (Net Terms Tracker bundles discounts) | Full suites (SparkLayer, BSS, B2B Edition) own this; doubles scope, kills 2–4wk timeline, dilutes "credit control only" positioning | Integrate cleanly beside suites; explicitly market compatibility |
| Buyer self-service finance portal | Net Terms Tracker's flagship ("Finance Portal", "Pay Now") | Heavy build (auth, buyer UX, payment links); native B2B customer accounts already show orders + pay-now links for exactly our target stores | Reminder emails deep-link to Shopify's native pay page; revisit portal only if merchants demand it |
| Branded PDF invoice generation | Every competitor lists it; feels mandatory | Crowded separate category (Sufio etc.); native B2B already emails order invoices with pay links; PDF layout/tax/locale rabbit hole | MVP: link to Shopify's order invoice. v2: CSV export of ledger for accountants |
| Credit scoring / A–F grades / "payment intelligence" | NET30's A–F grades, netterms.app's scoring sound smart | At 5–50 wholesale accounts, merchants already know who pays late; scores add UI noise and legal/fairness questions, zero enforcement value | Show plain facts: days-overdue, average-days-to-pay per company |
| SMS reminders | "Emails get ignored" | Per-message cost forces usage-based pricing — conflicts with flat-fee positioning (PROJECT.md) | Email with escalating cadence; merchant gets a "call this company" overdue flag instead |
| Payment processing / financing (Resolve-style) | "Can buyers pay you through the app? Can you advance the cash?" | Handling money = PCI, payouts, disputes, regulatory weight; factoring is a different business | Stay out of funds flow entirely; Shopify collects, app enforces |
| Tag-based (non-native) wholesale support | Bigger TAM — many stores still use tag workflows (BSS, Wholesale Gorilla world) | Doubles integration surface: two enforcement paths, two data models; competitors serve it already | Native-B2B only for MVP; revisit after validation (PROJECT.md decision) |
| "Hold order for review" mode | Wholesale Gorilla's draft-order review workflow has fans | Second enforcement path = double the states, double the bugs; contradicts "predictable hard block" promise | Hard block + per-company bypass covers exceptions; revisit only on merchant pull |
| QuickBooks/Xero live sync | "My accountant needs this" | OAuth apps, mapping UI, sync-conflict support burden — a whole product | CSV export of invoice/ledger data (what Net Terms Tracker actually ships) |
| Cash-flow forecasting | netterms.app markets it | Vanity chart at this segment size; needs data volume to be non-trivial | Dashboard's "upcoming due dates" list covers the real need |

## Feature Dependencies

```
[Company sync from native B2B]
    └──required by──> [Outstanding-balance ledger (webhooks)]
                          ├──required by──> [Credit-limit enforcement at checkout]
                          ├──required by──> [Overdue enforcement]
                          ├──required by──> [AR dashboard]
                          └──required by──> [Reminder emails (due dates from orders)]

[Credit-limit enforcement] ──required by──> [Bypass toggle]
[Credit-limit enforcement] ──required by──> [Enforcement event log]
[Enforcement event log] ──required by──> [Reviews API success-moment prompt]
[Reminder emails] ──required by──> [Reviews API success-moment prompt] (alternate trigger)
[AR dashboard] ──enhances──> [Bypass toggle] (surface bypassed companies)

[Hard block] ──conflicts──> [Hold-for-review mode] (two enforcement paths)
[Flat pricing] ──conflicts──> [SMS reminders] (usage costs)
```

### Dependency Notes

- **Ledger before everything:** enforcement, dashboard, and reminders are all views over one correct balance/due-date ledger. Phase ordering must put webhook ingestion + reconciliation first, and it needs the deepest testing (order edits, partial payments, refunds are where a wrong block comes from).
- **Enforcement before bypass:** bypass is a modifier on the block decision — trivial once blocking exists, meaningless before.
- **Event log before review prompt:** PROJECT.md requires the Reviews API prompt after "first success moment"; that moment must be detected (first block or first reminder delivered).
- **Enforcement mechanism is a research flag:** whether blocking is a checkout-validation Function, a payment-customization Function (hide net-terms payment option — the pattern Net Terms Tracker's "Net Terms disappears from checkout" implies), or B2B-checkout-compatible at all on each plan tier must be verified against current API docs before the roadmap freezes (noted in PROJECT.md Context; belongs to STACK/ARCHITECTURE research).

## MVP Definition

### Launch With (v1)

Matches PROJECT.md Active requirements; nothing here is optional against the competitor baseline.

- [ ] Company sync + per-company credit limit CRUD — the entry point for everything
- [ ] Webhook-driven outstanding/overdue ledger reading native financial status (incl. partially_paid) — correctness is the product
- [ ] Checkout enforcement: block net-terms purchase when over limit **or** overdue, with clear buyer message (prepay path stays open)
- [ ] Per-company bypass toggle — the exception valve that makes hard blocking sellable
- [ ] Reminder emails at due−3d / due date / overdue, with pay-now deep link, stop-on-payment
- [ ] AR dashboard: outstanding, overdue companies, upcoming due dates, credit utilization
- [ ] Enforcement event log (blocked-order feed) — cheap, powers ROI story + review prompt
- [ ] Shopify Billing ($25–30/mo, 14-day trial), GDPR webhooks, Polaris/App Bridge embedded admin — app-review gate
- [ ] Reviews API prompt after first block or first reminder sent

### Add After Validation (v1.x)

- [ ] Company-level statement email (weekly/monthly digest) — trigger: merchants forwarding dashboards manually
- [ ] Buyer-facing credit/limit widget in cart or checkout — trigger: "why is my customer blocked?" support tickets
- [ ] Configurable reminder cadence + templates — trigger: first merchant asking to change copy/timing
- [ ] Overdue grace period + per-company term overrides — trigger: bypass toggle being used as a workaround
- [ ] CSV export of ledger/invoices — trigger: first accountant request

### Future Consideration (v2+)

- [ ] Tag-based wholesale support — only if native-B2B MVP validates and TAM ceiling is hit
- [ ] Buyer finance portal — only on strong merchant pull; native accounts cover most of it
- [ ] QuickBooks/Xero sync — only at revenue scale that supports the support burden
- [ ] Hold-for-review enforcement mode — only if hard-block+bypass demonstrably loses deals

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Balance ledger (webhooks, reconciliation) | HIGH | HIGH | P1 |
| Credit-limit checkout blocking | HIGH | HIGH | P1 |
| Overdue blocking | HIGH | LOW (on top of ledger) | P1 |
| Bypass toggle | HIGH | LOW | P1 |
| Reminder emails (fixed cadence) | HIGH | MEDIUM | P1 |
| AR dashboard | HIGH | MEDIUM | P1 |
| Enforcement event log | MEDIUM | LOW | P1 |
| Billing + app-review compliance | HIGH (gate) | MEDIUM | P1 |
| Statement emails | MEDIUM | MEDIUM | P2 |
| Buyer credit widget | MEDIUM | MEDIUM | P2 |
| Custom reminder cadence/templates | MEDIUM | LOW | P2 |
| CSV export | MEDIUM | LOW | P2 |
| Credit scores/grades | LOW | MEDIUM | P3 |
| Portal, PDF invoices, ERP sync | LOW (for this wedge) | HIGH | P3 |

## Competitor Feature Analysis

| Feature | Net Terms Tracker | NET30 (net30.app) | netterms.app (LIETL) | SparkLayer ($49–499) | Wholesale Gorilla | BizCred / Folio (micro-apps) | Shopify native | **Our Approach** |
|---------|-------------------|-------------------|----------------------|----------------------|-------------------|------------------------------|----------------|------------------|
| Credit limits | Per-customer, own ledger | Per-customer + A–F grades | Per-customer, credit scoring, application links | Display + **warn only** on exceed | None (order min/max only in suite peers like BSS) | Per-company, real-time ledger | **None** | Per-company on native Company, hard-enforced |
| Order blocking | Net-terms option disappears when over limit/overdue | Implied via credit mgmt | Automated collections focus, blocking unclear | No block — buyer notified | No block — orders become editable drafts for manual review | "Block checkout or restrict payment methods" | **None** | Hard block of net-terms path (prepay stays open) + per-company bypass |
| Overdue handling | Auto-suspend credit purchases | Reminders + grade downgrade | Automated collections, "reduce overdue 40%" | N/A | Manual (merchant reviews drafts) | Ledger tracks due amounts | Order shows "Overdue" status only | Auto-block on overdue, grace config later |
| Reminders | Automated, before + after due | Automated, before + after due | Automated + AR reports | Via integrations | No | Varies | **Flow action: up to 5, per-order, main contact, DIY setup** | Zero-config due−3/due/overdue sequence, stop-on-payment |
| Partial payments | Pay Now full invoice; ledger own-tracked | Unclear | Unclear | Synced from ERP | Draft-order edits | Ledger-based | Record partial payment → `partially_paid` (deposits Plus-only) | Read native financial status — no parallel payment records |
| Buyer portal | Yes — flagship | No (invoices via email) | Application portal | Full B2B frontend | Wholesale storefront | No | Native customer accounts | **No (anti-feature)** — deep-link to native pay page |
| Invoices | Branded PDF | Auto-generated, order-matched | Auto-generated | Via integrations | Draft-order invoicing | No | Native invoice emails w/ pay link | **No PDF at MVP** — use native invoices |
| Pricing | Free ≤5 customers; $29/mo Pro | Free (paid "soon") | Free plan, usage scaling | $49–499/mo | Net terms on Advanced/Premium only | Free plans | Included in Shopify | Flat $25–30/mo, 14-day trial, no free plan |
| Review signals | Young, few reviews | Very young (paid plans not launched) | Very young | Established suite | 292 reviews; praise net-terms UX + support, complaints on support responsiveness | Young | — | Win on polish + fast reviewed listing |

**Category complaint themes (informs quality bars):** unreliable email notifications (AReceivables, 3.3★/6 reviews); support responsiveness (Wholesale Gorilla); merchants describing "a confusing maze of apps, workarounds, and expensive upgrades." → Reminder deliverability, fast support, and a 5-minute setup are competitive weapons, not chores.

**Competitive threat ranking:** (1) **Shopify native + Flow** — free, already installed; the app must beat it on enforcement (Flow can't block checkout) and zero-config reminders. (2) **Net Terms Tracker** — most complete feature set, $29/mo head-on, but portal/own-ledger architecture targets non-native stores; our native-first wedge is the counter. (3) Free micro-apps (BizCred, Folio, NET30) — price pressure; counter with polish, reviews, and reliability.

## Sources

- [Net Terms Tracker — Shopify App Store listing](https://apps.shopify.com/net-terms-tracker) and [nettermstracker.com](https://nettermstracker.com/) (features, pricing — fetched directly)
- [NET30 — net30.app](https://www.net30.app/) (features, credit grades, pricing status)
- [Net Terms — netterms.app (LIETL Solutions)](https://netterms.app/) (features, scoring, free plan)
- [SparkLayer Docs — Credit, Net Terms & Invoicing](https://docs.sparklayer.io/credit-net-terms-and-invoicing) and [Payment Methods](https://docs.sparklayer.io/payment-methods) (warn-on-exceed behavior)
- [Wholesale Gorilla — Net Terms help docs](https://wholesalegorilla.zendesk.com/hc/en-us/articles/19758724257044-Net-terms) and [Advanced net-terms features](https://wholesalegorilla.zendesk.com/hc/en-us/articles/20547239992724-Advanced-features-for-net-terms); [App Store reviews](https://apps.shopify.com/wholesale-gorilla/reviews)
- [BSS B2B Wholesale Solution docs — Net terms](https://docs-shpf.bsscommerce.com/b2b-wholesale-solution/order-management/net-terms) and [Order limits](https://docs-shpf.bsscommerce.com/b2b-wholesale-solution/order-management/order-limits)
- [Shopify Help — Setting up payment terms in B2B](https://help.shopify.com/en/manual/b2b/checkout-and-orders/payment-terms); [Send payment reminder (Flow action)](https://help.shopify.com/en/manual/shopify-flow/reference/actions/send-payment-reminder); [Payment schedule is due (Flow trigger)](https://help.shopify.com/en/manual/shopify-flow/reference/triggers/payment-schedule-due); [Partial payments](https://help.shopify.com/en/manual/payments/partial-payments); [B2B payment methods](https://help.shopify.com/en/manual/b2b/checkout-and-orders/payment-methods)
- [Shopify Changelog — Key B2B features now on non-Plus plans](https://changelog.shopify.com/posts/key-b2b-features-now-available-on-non-plus-plans); [B2B payment reminders](https://changelog.shopify.com/posts/increase-on-time-b2b-payments-with-payment-reminders)
- [AReceivables — Shopify App Store](https://apps.shopify.com/areceivables) (3.3★/6 reviews, complaint themes)
- [BizCred: B2B Credit Management](https://apps.shopify.com/bizcred-b2b); [Folio: B2B Credit Management](https://apps.shopify.com/folio-credit-ledger); [Upro B2B](https://apps.shopify.com/upro-credit-limit-b2b-and-wholesale) (micro-competitor scan)
- Gap analyses: [Optimum7 — Shopify B2B payment terms](https://www.optimum7.com/blog/advanced-b2b-payment-terms-in-shopify-how-to-support-net-30-credit-limits-invoice-logic-at-scale.html); [Uncap — Shopify net terms guide](https://www.uncap.com/post/shopify-net-terms); [i95Dev — credit management challenge](https://www.i95dev.com/overcoming-shopify-b2b-biggest-challenge-advanced-credit-management-payment-terms/); [Shopify Community — Flow reminder struggles](https://community.shopify.com/t/shopify-flow-daily-until-paid-reminders-5-days-before-due-loops-scheduled-time-order-context/572816)

---
*Feature research for: Shopify B2B credit-control / net-terms apps*
*Researched: 2026-08-14*
