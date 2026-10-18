# Phase 6 Context — Dashboard, Onboarding & Launch

**Gathered:** 2026-08-21 (post-research; five gray areas locked by user)

## Locked Decisions

### D6-01: Price — US$29/mo flat, 14-day free trial, monthly only
Configured in the listing's Pricing section (Shopify App Pricing / managed
pricing). ZERO billing config in code: `billing.check()` via the installed
`@shopify/shopify-app-react-router@1.2.1` (force-enables
`unstable_managedPricingSupport`); on no active subscription, redirect
`target:"_top"` to `admin.shopify.com/store/{h}/charges/credit-guard-net-terms/pricing_plans`.
The gate FAILS OPEN and runs AFTER backfill/validation side effects.
"Free for partners and developers" MUST be ticked on the plan (reviewer dev
stores in other orgs cannot select it otherwise). 23 merchants reach the
A$1k floor.

### D6-02: Enforcement feed uses "credit hold" vocabulary — DASH-02 amended
Per-attempt blocks are unobservable (D4-03). The dashboard shows what is
TRUE: companies currently on credit hold; hold started/ended transitions
with exposure/limit snapshots; orders that slipped past a hold
(BYPASSED_ORDER) with amounts; bypass toggles. No estimated "blocked $X".
DASH-02 requirement text reworded to match.

### D6-03: Onboarding step 3 = status confirmation, not a kill switch
"Enforcement is on" read live from the registered validation (existing
`readValidationConfig`), with a pointer to Settings → Checkout for turning
it off. No new validationUpdate surface (the mutation that silently
disabled the rule in Phase 4). Guided setup: (1) review backfilled balances
→ (2) set first limit → (3) enforcement status confirmed. Progress persisted
on Shop (`onboardingReviewedAt`, `onboardingDismissedAt`) + `reviewPromptedAt`
— one additive migration.

### D6-04: Fix EVERYTHING fixable in WINDOWS before submission
Close all eight code-addressable open items: #3 (SessionNotFoundError 500
retry loop), #8 (access-log id_token leak), #10 (reconciliation exhaustion
starvation — also pins the home page "incomplete" flag), #12 (TOCTOU
acknowledgement), #13 (overdue-only live block — run while staging the
screencast), #20 (late retry of outranked touchpoint), #21
(LedgerGraphqlError narrowing → key on extensions.code), #22 (settings
copy overstates eligibility). #11/#18/#19 remain open by design
(launch-store / optional-capture items) and are disclosed in the SUMMARY.

### D6-05: Launch store — $0 path first
Try Shopify's test gateway (Bogus Gateway) on credit-guard-demo for the
pay-now completion check (#18) before paying for any store. Review does NOT
require a paid store (reviewers use dev stores).

## Research corrections binding on the planner
- Reviews API: `shopify.reviews.request()` returns {success, code, message};
  platform-enforced once/60d, 3/365d, never <24h post-install; dev stores
  bypass limits (testable now). Trigger ONLY from a success moment (first
  BLOCK_STATE_ENTERED / BYPASSED_ORDER, or first ReminderLog SENT) — never a
  button, never incentivized.
- Listing assets (human): icon 1200×1200; 3–6 screenshots 1600×900; feature
  image or video; screencast in English; reviewer credentials incl. a B2B
  buyer login on the demo store; emergency developer contact;
  read_all_orders justification; privacy URL (/privacy exists).
- BFS cheap win: remove the redundant `Home` nav link (BFS 4.1.4).
- Polaris app-home catalog has NO s-setup-guide/s-progress/s-card/s-index-table
  — compose from s-section/s-stack/s-grid/s-table/s-badge/s-banner/s-icon.
  Verify every element against the live catalog (Phase 3 lesson: no
  `attention` tone).
- Do NOT upgrade @shopify/shopify-app-react-router to 2.0.0 this phase
  (breaking changes, shipped 2026-08-10).
- CLAUDE.md stale rows to correct: bypassCartValidations (absent in 2026-07),
  Resend/react-email (unused), node-cron ^4.
- Empirical checks E-1..E-5 from 06-RESEARCH must be carried as tasks:
  E-1 billing.check() sees the $0 contract on the dev store (mandatory
  before relying on the gate); E-2 review modal renders pre-listing on a dev
  store; E-4 plan-page locale 404 check; E-5 test-gateway payment via a
  reminder link.
