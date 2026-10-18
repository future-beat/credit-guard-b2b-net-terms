# Requirements: Credit Guard: B2B Net Terms

**Defined:** 2026-08-14
**Core Value:** A merchant can trust that no B2B customer places a new order when they're over their credit limit or overdue — enforcement Shopify natively lacks.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation

- [ ] **FOUND-01**: Merchant can install the app and complete OAuth into an embedded Polaris admin (React Router 7 template, session-token auth)
- [ ] **FOUND-02**: App responds correctly to mandatory GDPR webhooks (customers/data_request, customers/redact, shop/redact) with 401 on bad HMAC
- [ ] **FOUND-03**: App cleans up on uninstall (app/uninstalled webhook: revoke data, stop jobs, mark shop inactive)

### Ledger

- [ ] **LEDG-01**: App backfills all companies, open net-terms orders, and payment schedules on install (zero-config first-session value)
- [ ] **LEDG-02**: App maintains a per-company outstanding-balance ledger driven by order/payment webhooks (HMAC-verified, deduped, refetch-and-recompute — never incremental)
- [ ] **LEDG-03**: Ledger correctly handles partial payments, refunds, and order edits against native payment terms
- [ ] **LEDG-04**: A scheduled reconciliation sweep detects and corrects any ledger drift against Shopify source data
- [ ] **LEDG-05**: A scheduled sweep flips companies to overdue when a payment schedule passes its due date (no webhook exists for time passing)

### Credit Control

- [ ] **CRED-01**: Merchant can set/edit/remove a credit limit per B2B company
- [ ] **CRED-02**: Merchant can flip a per-company bypass toggle to exempt a company from enforcement
- [ ] **CRED-03**: App publishes each company's credit state (limit, exposure, overdue flag, bypass) to $app Company metafields whenever it changes
- [ ] **CRED-04**: New installs default to observe-only mode; enforcement activates per company once a limit is set

### Enforcement

- [x] **ENFC-01**: Checkout validation Function holds the checkout of a purchasing company that is over its credit limit (a terms-bearing B2B checkout collects no payment, so holding the checkout IS blocking the net-terms path; there is no pay-by-card alternative at that checkout — buyers settle open invoices post-order via Pay now, which clears the hold; see WINDOWS #29)
- [x] **ENFC-02**: Checkout validation Function blocks the net-terms path when a company has an overdue balance
- [x] **ENFC-03**: Buyer sees a clear, merchant-editable message at blocked checkout
- [x] **ENFC-04**: Function fails open for D2C/non-B2B checkouts and on any missing/malformed metafield (never breaks a storefront sale)
- [x] **ENFC-05**: Enforcement event log records every company block/unblock state transition (with exposure/limit/overdue snapshot) and every leaked order (order placed via draft/admin/POS while its company was blocked) — re-scoped 2026-08-20: per-attempt block logging is a platform impossibility (validation runs are not webhooked; no bypassCartValidations in 2026-07)
- [x] **ENFC-06**: Orders that bypass checkout validation (draft/admin/POS) still count against balances and are flagged to the merchant

### Reminders

- [x] **REMD-01**: App sends automated reminder emails at due−3 days, due date, and overdue (idempotent via email log; stops on payment)
- [x] **REMD-02**: Reminder emails include a pay-now link to the order's payment page
- [x] **REMD-03**: Every reminder is delivered through Shopify's authenticated notification infrastructure with the merchant's own branding and sender, and contains Shopify's canonical pay-now link for the order — reworded 2026-08-20 (D5-01): the app sends via paymentReminderSend and never handles customer email addresses; the original 'app-owned authenticated domain' wording conflicted with the zero-PII architecture

### Dashboard

- [x] **DASH-01**: Merchant sees an AR dashboard: total outstanding, overdue companies, upcoming due dates, per-company credit utilization
- [x] **DASH-02**: Dashboard surfaces the enforcement log in credit-hold terms — companies currently on hold, hold started/ended transitions with exposure/limit snapshots, and orders that slipped past a hold (bypassed/draft/admin) with amounts — plus reminder activity; reworded 2026-08-21 (D6-02): per-attempt checkout blocks are not observable on the platform (D4-03), so no "blocked $X" estimate is shown
- [x] **DASH-03**: Merchant completes a guided setup: review backfilled balances → set first limit → enable enforcement

### Launch

- [x] **LNCH-01**: App charges US$25–30/mo flat with 14-day free trial via Shopify App Pricing (managed pricing, no billing code)
- [x] **LNCH-02**: In-admin review prompt via official Reviews API, triggered after first success moment (first block or first reminder sent)
- [x] **LNCH-03**: App passes Shopify app review: Polaris web components, App Bridge latest, populated B2B demo store, screencast, reviewer credentials

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Reminders

- **REMD-04**: Merchant can customize reminder cadence and templates
- **REMD-05**: Monthly statement emails per company

### Dashboard

- **DASH-04**: CSV export of AR ledger
- **DASH-05**: Buyer-facing credit widget (company sees own limit/balance)

### Market

- **MRKT-01**: Support tag-based wholesale workflows (non-native B2B stores)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Quoting / price lists / wholesale catalogs | Full B2B suites own this; single-feature focus is the positioning |
| Buyer portal | Scope trap competitors fumble; native B2B already gives buyers order history |
| PDF invoices | Invoice generation is a different product; Shopify + accounting apps cover it |
| Credit scoring / underwriting | Liability + data problem; merchants set their own limits |
| SMS reminders | Usage-based cost structure conflicts with flat-fee positioning |
| Payment processing / factoring | Regulatory burden; Shopify handles payments |
| QuickBooks/Xero/ERP sync | Integration treadmill; crowded incumbent space |
| Hold-for-review enforcement mode | Second enforcement path doubles testing; hard block + bypass chosen |
| Incentivized review collection | Shopify policy 1.3 (July 2026) — account-termination territory |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Pending |
| FOUND-02 | Phase 1 | Pending |
| FOUND-03 | Phase 1 | Pending |
| LEDG-01 | Phase 2 | Pending |
| LEDG-02 | Phase 2 | Pending |
| LEDG-03 | Phase 2 | Pending |
| LEDG-04 | Phase 2 | Pending |
| LEDG-05 | Phase 2 | Pending |
| CRED-01 | Phase 3 | Pending |
| CRED-02 | Phase 3 | Pending |
| CRED-03 | Phase 3 | Pending |
| CRED-04 | Phase 3 | Pending |
| ENFC-01 | Phase 4 | Complete |
| ENFC-02 | Phase 4 | Complete |
| ENFC-03 | Phase 4 | Complete |
| ENFC-04 | Phase 4 | Complete |
| ENFC-05 | Phase 4 | Complete |
| ENFC-06 | Phase 4 | Complete |
| REMD-01 | Phase 5 | Complete |
| REMD-02 | Phase 5 | Complete |
| REMD-03 | Phase 5 | Complete |
| DASH-01 | Phase 6 | Complete |
| DASH-02 | Phase 6 | Complete |
| DASH-03 | Phase 6 | Complete |
| LNCH-01 | Phase 6 | Complete |
| LNCH-02 | Phase 6 | Complete |
| LNCH-03 | Phase 6 | Approved and listed 2026-09-04 — https://apps.shopify.com/credit-guard-b2b-net-terms |

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 27 ✓
- Unmapped: 0

---
*Requirements defined: 2026-08-14*
*Last updated: 2026-08-14 after roadmap creation (traceability mapped)*
