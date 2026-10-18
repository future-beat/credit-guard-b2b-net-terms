# Pitfalls Research

**Domain:** Shopify B2B credit-control app (checkout enforcement, net-terms tracking, reminder emails) — solo dev, public App Store distribution
**Researched:** 2026-08-14
**Confidence:** MEDIUM overall (websearch cross-verified against official shopify.dev / help.shopify.com pages surfaced in results; seam-classified per finding)

> Confidence tags below come from the classify-confidence seam: `websearch` unverified = LOW, cross-verified across independent sources = MEDIUM. Findings quoting official Shopify docs/changelog that appeared consistently across multiple results are tagged MEDIUM (the seam ceiling for web research). Anything tagged LOW must be re-verified during phase planning before you build on it.

## Critical Pitfalls

### Pitfall 1: Assuming the checkout validation Function can call your backend

**What goes wrong:**
The core feature — "block checkout when company is over limit / overdue" — gets designed as "at checkout, ask my server for the company's balance." Shopify Functions are sandboxed WASM: **no network access, no API calls, no database reads**. The only data available at checkout time is what the Function's GraphQL input query can reach — cart, buyer identity, and **pre-written metafields**. If you discover this mid-build, the entire enforcement architecture must be redesigned.

**Why it happens:**
Every other part of a Shopify app is a web server that can query anything. Developers assume checkout works the same way.

**How to avoid:**
Design around the documented pattern from day one: your backend continuously computes each company's credit state (limit, outstanding balance, overdue flag, bypass flag) and writes it to **company metafields** (e.g., namespace `$app:credit`, keys `blocked`, `reason`). The validation function reads `buyerIdentity.purchasingCompany.company.metafield(...)` and returns errors based on that pre-computed value. The Function itself should be dumb — read flag, block or allow. All intelligence lives server-side, ahead of checkout time.

Corollary: **enforcement freshness = metafield sync freshness.** An order placed 10 seconds ago won't be reflected at the next checkout unless your `orders/create` webhook handler updates the metafield immediately. Make "webhook → recompute → metafield write" a single fast path, not a batch job.

**Warning signs:**
- Any design doc sentence like "the function checks our API"
- Enforcement logic that needs data you can't express as a metafield read
- Metafield updates scheduled hourly/nightly instead of event-driven

**Phase to address:** Architecture/foundation phase (before any enforcement code). This single constraint dictates the whole data-flow design.
**Confidence:** MEDIUM (official Functions docs pattern, corroborated by shopify.dev cart-checkout-validation examples and community-verified `buyerIdentity.purchasingCompany.company.metafield` query path)

---

### Pitfall 2: Enforcement bypass paths — draft orders, Admin API orders, and `bypassCartValidations`

**What goes wrong:**
The merchant believes "no over-limit company can order," but orders keep appearing. B2B merchants heavily use **draft orders** (sales-rep workflows, phone orders, Shopify's own B2B draft-order flow). Since Dec 2024, draft-order invoice checkout **does** run cart/checkout validation functions — but `draftOrderComplete` and `prepareForBuyerCheckout` accept a `bypassCartValidations` argument, and orders created directly via the Admin API (`orderCreate`) or POS never pass through checkout at all. Your app's promise ("hard block") silently has holes, and the merchant discovers them when an over-limit customer's order ships.

**Why it happens:**
Developers test only the storefront checkout path. B2B order creation is unusually multi-path compared to D2C.

**How to avoid:**
1. **Count every order** against the balance regardless of how it was created (webhooks on `orders/create` catch all paths) — so even bypassed orders update the balance immediately.
2. **Detect and surface** enforcement gaps: when an order arrives from a company that was blocked, flag it on the dashboard ("Order #1234 was placed via draft order while Acme Co was over limit").
3. **Set expectations in the UI and listing copy**: "blocks online checkout; draft orders completed by staff can bypass" — merchants tolerate documented limits, not silent ones.
4. Optionally treat merchant-initiated draft-order completion as an intentional override — it aligns with your bypass-toggle mental model.

**Warning signs:**
- Test plan only covers storefront checkout
- Balance updates only triggered from checkout-adjacent events
- No dashboard visibility into orders placed while blocked

**Phase to address:** Enforcement phase (test matrix must include draft-order invoice checkout + `draftOrderComplete`) and dashboard phase (gap surfacing).
**Confidence:** MEDIUM (Shopify changelog Dec 2024 "Support for additional Shopify Functions APIs in draft orders" + `bypassCartValidations` documented on `draftOrderComplete`)

---

### Pitfall 3: GDPR compliance webhooks missing or failing HMAC checks → review rejection

**What goes wrong:**
The single most common first-submission rejection (sources claim it factors into 60%+ of rejections): the three mandatory compliance webhooks — `customers/data_request`, `customers/redact`, `shop/redact` — are missing, return non-2xx, or (the sneaky one) **don't return 401 on invalid HMAC**. Shopify's automated review checks POST to these endpoints with bad signatures and expect a 401; a handler that returns 200-for-everything or 500-on-parse-failure fails review.

**Why it happens:**
These webhooks do nothing visible in the app, so they're left as stubs; HMAC verification is skipped in dev because it's annoying with tunnels.

**How to avoid:**
Use the official Remix/Node app template — it wires compliance topics in `shopify.app.toml` and HMAC verification out of the box. Then actually implement the handlers: for this app, `customers/redact` must delete stored contact info used for reminders; `shop/redact` (arrives ~48h post-uninstall) must purge the shop's companies, balances, and email logs. Before submission, test each endpoint with a bad signature and confirm 401.

**Warning signs:**
- Compliance handlers containing only `return 200`
- No test that sends an invalid-HMAC request
- Reminder-email tables with no deletion path

**Phase to address:** Scaffold phase (template gives it free) + a dedicated pre-submission compliance checklist in the launch phase.
**Confidence:** MEDIUM (official privacy-law-compliance docs + multiple independent review-guide sources agree)

---

### Pitfall 4: Balance drift — incremental balance counters vs. webhook reality

**What goes wrong:**
Balances are maintained by incrementing/decrementing a counter on each webhook (`orders/create` +$500, `orders/paid` −$500). Shopify webhooks are **at-least-once, unordered, and not guaranteed**: duplicates arrive, `orders/paid` can arrive before your handler finishes `orders/create`, deliveries get dropped during downtime, and after 19 consecutive failures the subscription is silently removed. Refunds, order edits, partial payments, and manually-marked-paid orders add more mutation paths. Within weeks the cached balance disagrees with reality — and your app **blocks a customer who already paid** (merchant-facing catastrophe, instant uninstall + bad review) or fails to block one who hasn't.

**Why it happens:**
Increment-on-event is the obvious design and works perfectly in dev where nothing is ever missed or duplicated.

**How to avoid:**
1. **Never store balance as an incremental counter.** Treat webhooks as *triggers to recompute*, not as deltas: on any order/payment event for a company, re-derive its balance from Shopify (query outstanding orders with payment terms + `dueAt` + financial status) and overwrite the metafield.
2. **Idempotency:** dedupe on `X-Shopify-Webhook-Id`; ignore events older than the last-seen `updated_at`/`X-Shopify-Triggered-At` per resource.
3. **Reconciliation job:** periodic (e.g., hourly or nightly) sweep that re-queries all companies' open orders and corrects drift — this is your safety net for missed webhooks and removed subscriptions.
4. Respond 200 fast (<5s), process async (queue), so timeouts don't cascade into dropped subscriptions.

**Warning signs:**
- Code doing `balance += order.total`
- No dedup table / no webhook-id storage
- No scheduled reconciliation task
- "It works" claims based only on happy-path dev-store testing

**Phase to address:** Data-sync phase — reconciliation and idempotency are core scope, not hardening to add later. The overdue-blocking requirement also needs a scheduled job anyway (an order becomes overdue by time passing, with **no webhook fired** — only a clock can catch it).
**Confidence:** MEDIUM (official webhook best-practices docs: no ordering guarantee, at-least-once, reconciliation recommended; cross-verified by Hookdeck/community guides)

---

### Pitfall 5: Building on the legacy Billing API instead of Shopify App Pricing

**What goes wrong:**
Following pre-2025 tutorials, you hand-code `appSubscriptionCreate`, trial-day logic, charge-approval redirects, reinstall/trial-reset handling, and test-charge flows — then discover Shopify rebranded Managed Pricing as **Shopify App Pricing (May 2026), the default billing solution configured in the Partner Dashboard; the Billing API is now legacy**. App Pricing handles trials, proration, test charges, and plan changes with zero billing code, and reviewers scrutinize custom billing implementations much harder (trial reset on reinstall, charge acceptance flow, test-mode charges are classic review friction).

**Why it happens:**
Nearly all existing tutorials, templates, and LLM training data teach the Billing API.

**How to avoid:**
For a single flat plan (US$25–30/mo, 14-day trial) — the exact shape App Pricing was built for — configure the plan in the Partner Dashboard, gate app access on active-subscription status (via API check or `app_subscriptions/update` webhook), and write no charge-creation code. Keep the 14-day trial platform-managed so reinstall abuse is Shopify's problem, not yours. Verify current App Pricing capabilities at build time (it's new; edge cases like per-shop overrides may still require the legacy API — confirm before committing).

**Warning signs:**
- `appSubscriptionCreate` mutations in your codebase for a simple flat plan
- Hand-rolled trial-days-remaining logic
- Billing tutorials dated before 2025 in your reference list

**Phase to address:** Billing/launch phase — but decide App Pricing vs. legacy API in the architecture phase, since it removes an entire subsystem from the roadmap.
**Confidence:** MEDIUM (Shopify changelog May 2026 + shopify.dev billing docs, cross-verified; re-verify capabilities at build time since this is <3 months old)

---

### Pitfall 6: Merchant-branded reminder emails that spoof the merchant's domain

**What goes wrong:**
"Merchant-branded" gets implemented as `From: accounts@merchant-store.com` sent through your ESP with no authorization from the merchant's DNS. SPF fails (your ESP isn't in their SPF record), DKIM doesn't align (signed with your domain or the ESP's), DMARC fails → Gmail/Yahoo/Microsoft (enforcing since 2024–25) route to spam or reject outright, **silently** — no bounce reaches you. Payment reminders that land in spam are worse than none: merchants believe reminders were sent; customers never saw them; overdue blocking then looks arbitrary.

**Why it happens:**
ESPs let you type any From address; nothing fails in testing against your own inbox.

**How to avoid:**
1. **MVP:** send from an app-owned authenticated domain (e.g., `reminders@mail.creditguard.app`) with full SPF+DKIM+DMARC on that domain. Brand via display name (`From: "Acme Wholesale" <reminders@mail.creditguard.app>`) and set `Reply-To:` to the merchant's email. This is deliverable on day one with zero merchant DNS work.
2. Use a dedicated sending subdomain (never the app's root domain) so reputation damage is isolated and rotatable.
3. **Later feature (post-MVP):** true custom-domain sending via ESP domain verification (merchant adds CNAME/DKIM records) — real onboarding friction; don't put it in the 2–4 week MVP.
4. Log delivery events (delivered/bounced/spam-complaint via ESP webhooks) and show send status in the dashboard — "reminder sent" must mean "accepted by recipient server," not "handed to ESP."

**Warning signs:**
- From-address set to any domain you don't control DNS for
- No `mail.` subdomain / sending from the marketing root domain
- No bounce/complaint webhook handling
- Deliverability tested only merchant→own inbox

**Phase to address:** Reminders phase (architecture decision on sending identity belongs in phase discussion, before ESP integration).
**Confidence:** MEDIUM (Gmail/Yahoo sender requirements and DMARC alignment are well-documented; SaaS-specific guidance cross-verified across multiple deliverability sources)

---

### Pitfall 7: Validation function breaks the merchant's D2C checkout

**What goes wrong:**
The store also sells retail. Your validation function runs on **every** checkout, not just B2B ones. If it errors, times out, or blocks when `purchasingCompany` is null (or when your metafield is missing/unparseable), you've broken the merchant's entire revenue flow. Nothing gets an app uninstalled — and a 1-star review — faster than blocking normal customers.

**Why it happens:**
Dev stores get tested with B2B company customers only; the null-company path is never exercised.

**How to avoid:**
First line of the function: if `buyerIdentity.purchasingCompany` is null → return no errors (fast no-op). **Fail open on every anomaly**: missing metafield, malformed JSON, unknown state → allow checkout, log nothing at checkout (you can't), and let the reconciliation job flag companies with missing credit state. A missed block is recoverable (dashboard flags it); a false block of a paying customer is not. Test matrix: D2C guest, D2C logged-in customer, B2B customer with no credit state, B2B under limit, B2B over limit, B2B overdue, bypass-toggle on.

**Warning signs:**
- Function code without an early null-`purchasingCompany` guard
- "Fail closed" defaults (block when data missing)
- No D2C checkout case in the test plan

**Phase to address:** Enforcement phase — make the seven-case checkout matrix an explicit verification gate.
**Confidence:** MEDIUM (validation API docs confirm functions run on cart/checkout generally; fail-open reasoning is standard practice for this API)

---

### Pitfall 8: Modeling credit against the wrong identity (customer vs. company vs. company location)

**What goes wrong:**
Credit limits get keyed to the Shopify **customer**. In native B2B, a customer is a *contact* who can belong to multiple companies; a company can have multiple **locations**, and Shopify assigns payment terms and catalogs at the **company or company-location level**. At checkout, the buyer identity is a `purchasingCompany` triple (customer + company + location). Key by customer and you get: the same buyer ordering for Company B consuming Company A's credit; two contacts at one company each getting a full limit; location-level terms ignored. Migrating the data model after launch is a rewrite of enforcement, sync, and dashboard.

**Why it happens:**
D2C habits — "customer" is the only identity most Shopify devs have ever modeled.

**How to avoid:**
Model credit at the **company** level for MVP (matches merchant mental model: "Acme owes us $12k"), store the location on each order for future granularity, and derive everything (balance, overdue, bypass) per company. In the validation function, read the company via `buyerIdentity.purchasingCompany.company`, never via `buyerIdentity.customer`. Decide company-vs-location explicitly in domain modeling and write the decision down — Shopify's own payment terms can be set per location, so a location-level upgrade path should exist.

**Warning signs:**
- DB schema with `customer_id` as the credit-limit foreign key
- No `company_location` column on the orders/balance tables
- Test data with only single-contact, single-location companies

**Phase to address:** Domain-modeling / data-sync phase (first thing after scaffold).
**Confidence:** MEDIUM (Shopify B2B help docs: terms assigned at company/company-location level; `purchasingCompany` structure per Functions API docs)

---

### Pitfall 9: App review process misses — demo store, screencast, embedded-app automated checks

**What goes wrong:**
The app works, but review drags through multiple 7–14-day rejection cycles for non-code reasons: no screencast (now **required** at submission), demo store empty or lacking B2B setup so the reviewer can't exercise the core flow, reviewer has no way to trigger a "blocked checkout" moment, embedded-app automated checks fail (missing session tokens, wrong `Content-Security-Policy: frame-ancestors` header, third-party cookies, old App Bridge version). Each cycle burns 1–2 weeks against a 2–4 week build target and a race with young competitors.

**Why it happens:**
Solo devs treat submission as an afterthought; B2B apps are worse because the reviewer needs a company + payment terms + a company customer login to see anything work.

**How to avoid:**
- Build the demo store *while developing*, not before submission: dev store with B2B enabled, 2–3 companies (one over limit, one overdue, one healthy), a company-customer login you hand to the reviewer, and step-by-step testing instructions ("log in as X, add item, checkout → see block message").
- Record the screencast showing install → onboarding → set limit → blocked checkout → reminder email → dashboard.
- Use latest App Bridge from Shopify's CDN, session-token auth (template default), correct security headers; run Shopify's automated checks in the Partner Dashboard before submitting; test embedded app in Chrome incognito.
- Expect verify-first publishing to delay listing/reviews; plan launch outreach accordingly.

**Warning signs:**
- "We'll set up the demo store after code-freeze"
- Any custom auth/cookie logic replacing template session-token handling
- Never having run the pre-submission automated checks

**Phase to address:** Launch/submission phase, with the demo store started in the enforcement phase (it doubles as your test environment).
**Confidence:** MEDIUM (screencast requirement per Shopify changelog; session-token/header failures per official pass-app-review docs and community reports)

---

### Pitfall 10: Mis-scoping the addressable market — Plus-only assumptions (in either direction)

**What goes wrong:**
Two symmetric failures: (a) assuming native B2B is Plus-only and building tag-based workarounds "for reach" — wasted scope, since **native B2B (companies, locations, net payment terms) is available on all paid plans as of April 2026**; or (b) assuming *everything* B2B works on every plan and designing features on Plus-only primitives — **partial payments/deposits, unlimited catalogs, and B2B order review (`orderReviewAdd`) remain Plus-only**. E.g., a "partial payment reduces balance" flow or a "hold order for review" enforcement mode would silently not exist for Basic/Grow/Advanced merchants. Also: public App Store apps with Functions run on all plans, but **custom apps with Functions are Plus-only** — distribute through the App Store or checkout blocking dies on non-Plus stores.

**Why it happens:**
B2B plan availability changed materially in April 2026; most content (and LLM priors) predates it.

**How to avoid:**
Pin the feature-by-plan matrix (help.shopify.com "B2B features by plan") at architecture time; design MVP only on all-plan primitives: companies, net terms, order/payment webhooks, company metafields, App-Store-distributed validation function. Handle partially-paid orders *read-only* (Plus merchants will have them — count `totalOutstanding`, don't assume paid/unpaid binary). Confirmed: "hold for review" enforcement correctly stayed out of MVP scope — it's Plus-only anyway.

**Warning signs:**
- Balance logic that treats order payment as binary paid/unpaid
- Any roadmap item built on deposits, partial-payment collection, or order review
- Plans to ship as a custom app "to launch faster"

**Phase to address:** Architecture phase (plan-matrix pin) + data-sync phase (outstanding-amount handling).
**Confidence:** MEDIUM (help.shopify.com plan-features page + April 2026 rollout cross-verified across multiple sources; re-verify the exact matrix during planning)

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Increment balance counters instead of recompute-from-source | Simpler webhook handlers | Balance drift → false blocks → uninstalls | Never |
| Skip reconciliation job for MVP | ~2 days saved | Drift accumulates invisibly; overdue detection needs the scheduler anyway | Never (scheduler is required for overdue anyway) |
| App-owned sending domain instead of merchant custom domains | Zero merchant DNS onboarding | Slightly less "branded" emails | MVP — correct choice, upgrade later |
| Fail-open validation on anomalies | Never breaks merchant checkout | Occasional missed block | Always acceptable if dashboard flags the gap |
| Company-level (not location-level) credit | Simpler model, matches merchant mental model | Multi-location wholesalers need granularity later | MVP, if location is stored on orders now |
| Hardcode single flat plan via App Pricing | No billing code at all | Harder per-shop discounts later | MVP — matches positioning |
| Skip processing-queue; handle webhooks inline | Less infra | >5s handlers → timeouts → dropped subscription after repeated failures | Only if handlers stay provably <2s; add queue before launch |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Cart/Checkout Validation Function | Expecting network/API access at runtime | Pre-write credit state to company metafields; function only reads `buyerIdentity.purchasingCompany.company.metafield` |
| Validation Function input | Querying all line items/fields "just in case" | Request only needed fields; limits: ~128 kB input (200-line carts), 20 kB output, ~11M instructions |
| Webhooks | Trusting delivery + ordering | Dedupe on `X-Shopify-Webhook-Id`, order by `X-Shopify-Triggered-At`/`updated_at`, reconcile periodically, ACK <5s |
| Draft orders | Assuming they're outside your scope | They run validations since Dec 2024; `bypassCartValidations` exists; always count resulting orders against balance |
| GDPR webhooks | 200-for-everything stubs | Real handlers + 401 on invalid HMAC (automated review tests this) |
| Billing | Hand-coding legacy Billing API | Shopify App Pricing in Partner Dashboard (default since May 2026); gate features on subscription status |
| Metafields | Writing per-request without rate-limit budget | Batch via `metafieldsSet` (25/call), respect GraphQL cost limits; one write per company per event, not per line item |
| Reviews API | Custom review nags / incentives | Official in-admin Reviews API prompt after first success moment only (policy 1.3, July 2026 crackdown) |
| ESP (email) | From: merchant's domain unauthenticated | App-owned authenticated subdomain + display-name branding + Reply-To merchant; handle bounce/complaint webhooks |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-order full-shop resync | Sync jobs take minutes; API throttling (429s) | Recompute only the affected company on webhook; full sweep only in scheduled reconciliation | ~50 orders/day/shop |
| Inline webhook processing | Random webhook "misses" (actually timeouts); subscription removed after repeated failures | Persist → 200 → process from queue | First slow DB query or ESP call inside a handler |
| Reconciliation as single serial loop over all shops | Nightly job overruns window as merchants grow | Per-shop jobs, parallelize; cursor pagination on open orders | ~50–100 installed shops |
| Metafield write on every webhook even when state unchanged | Burning API budget; write conflicts | Compare computed state to last-written; write only on change | High-volume stores (flash-sale bursts) |
| Reminder sends in one daily batch from a cold domain | Spam-foldering, throttling by Gmail | Warm up sending domain; spread sends; keep volume per shop small (it naturally is) | Only if you later add marketing-style volume |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Skipping webhook HMAC verification | Forged webhooks corrupt balances / inject data; automatic review rejection | Verify HMAC on every webhook incl. compliance topics; 401 on failure |
| Trusting shop domain from query params instead of session token | Cross-shop data access in embedded admin | Session-token auth (template default); derive shop from validated token |
| Storing B2B customer contact data with no deletion path | GDPR violation; `customers/redact` non-compliance | Implement redact handlers against real tables; purge on `shop/redact` |
| Credit metafields writable by other apps/theme | Tampered limits bypass enforcement | Use app-reserved namespace (`$app:`) with app-only write access |
| Exposing per-company balances in storefront-visible metafields | Leaking one company's financials to buyers/other apps | Restrict metafield access; keep detailed balances server-side, only the block flag + message in metafields |
| Missing `frame-ancestors` CSP header | Clickjacking; automated review check failure | Set CSP per Shopify embedded-app docs (template default) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Generic block message at checkout ("Order cannot be placed") | Buyer confused, calls merchant angry; merchant blames app | Merchant-editable message with reason + next step ("Account on hold — contact accounts@… or pay outstanding invoice") |
| Empty dashboard on install (no data until first webhook) | Merchant sees nothing in first session; ~80% of trials never convert — first session decides | On-install backfill: import companies, open payment-terms orders, compute balances immediately; guided "set your first limit" onboarding |
| Silent enforcement (merchant can't tell it's working) | No perceived value → churn before first block ever happens | Activity feed: "Blocked checkout for Acme (limit $10k, owed $12.4k)"; this is also the Reviews-API prompt trigger moment |
| Reminder emails merchant can't preview or audit | Merchant fears app is spamming their customers | Preview templates, per-company opt-out, send log with delivery status |
| Bypass toggle with no expiry/audit | Merchant flips it for one order, forgets, credit control silently off | Show bypass state prominently on dashboard; optional "bypass for next order only" |
| Blocking immediately on install with default limits | False blocks on day one | Install in observe-only mode; enforcement off until merchant sets limits explicitly |

## "Looks Done But Isn't" Checklist

- [ ] **Checkout blocking:** Often missing the D2C/null-company no-op and fail-open paths — verify all 7 checkout cases (D2C guest, D2C customer, B2B no-state, under, over, overdue, bypassed)
- [ ] **Checkout blocking:** Often missing draft-order path — verify validation fires on draft-order invoice checkout and that bypassed/API orders still hit the balance
- [ ] **Balance tracking:** Often missing refunds, order edits, partial payments (`totalOutstanding`), and manual mark-as-paid — verify each mutates balance correctly
- [ ] **Overdue detection:** Often missing the no-webhook-fires-at-due-date reality — verify a scheduled job flips overdue state and updates metafields without any Shopify event
- [ ] **Webhooks:** Often missing dedup + reconciliation — verify duplicate and out-of-order deliveries don't corrupt state; kill the app for an hour and confirm reconciliation heals it
- [ ] **GDPR endpoints:** Often stubs — verify 401 on bad HMAC and actual data deletion on redact topics
- [ ] **Reminder emails:** Often missing bounce handling and spam testing — verify SPF/DKIM/DMARC pass (mail-tester ≥9/10) and bounces surface in dashboard
- [ ] **Billing:** Often missing the subscription-lapsed path — verify app gates gracefully when trial ends without conversion and on uninstall/reinstall
- [ ] **Uninstall:** Often missing cleanup — verify `app/uninstalled` handling, `shop/redact` purge, and that orphaned metafields don't keep blocking checkout after uninstall (Shopify removes function-owned validations with the app — confirm)
- [ ] **Review submission:** Often missing reviewer access — verify demo store has B2B companies + a company-customer login + written test steps + screencast

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Discovered Functions can't call backend mid-build | HIGH | Rearchitect to metafield-sync pattern; salvage server logic as the sync engine |
| Balance drift in production | MEDIUM | Ship reconciliation job; force full recompute for all shops; notify affected merchants proactively before they notice |
| False-blocking a paid customer | HIGH (reputation) | Fail-open hotfix; per-company bypass as immediate mitigation; personal apology to merchant (you're onboarding personally in months 1–3 anyway) |
| GDPR/App Bridge review rejection | LOW–MEDIUM | Fix per rejection notes; each cycle costs 7–14 days — batch all fixes before resubmitting |
| Reminders landing in spam | MEDIUM | Switch to app-owned authenticated subdomain; re-verify DNS; resend failed reminders with merchant notice |
| Built on legacy Billing API | LOW (pre-launch) / MEDIUM (post) | Pre-launch: swap to App Pricing config, delete billing code. Post-launch: Shopify migration tooling (announced, verify availability) |

## Pitfall-to-Phase Mapping

Assumes a roadmap shaped like: 1 Scaffold/foundation → 2 B2B data model & sync → 3 Checkout enforcement → 4 Reminders → 5 Dashboard/onboarding → 6 Billing & launch.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Functions can't call backend (P1) | Phase 1 (architecture decision) | Design doc shows metafield-sync data flow; no runtime API calls in function |
| Wrong identity model (P8) | Phase 2 | Schema keyed on company id; location stored on orders; multi-contact company test passes |
| Balance drift (P4) | Phase 2 | Chaos test: duplicate + reordered + dropped webhooks → reconciliation converges to correct balance |
| Plus-only mis-scoping (P10) | Phase 1–2 | Plan matrix pinned; `totalOutstanding` used; no deposit/order-review dependencies |
| Draft-order bypass (P2) | Phase 3 | Draft-invoice checkout blocked; bypassed order still updates balance + flagged on dashboard |
| Breaking D2C checkout (P7) | Phase 3 | 7-case checkout matrix green; anomalies fail open |
| Email spoofing/deliverability (P6) | Phase 4 | SPF/DKIM/DMARC pass on sending subdomain; mail-tester ≥9/10; bounce webhook wired |
| Empty-first-session UX | Phase 5 | Fresh install shows backfilled balances within first session |
| GDPR webhooks (P3) | Phase 1 (scaffold) + Phase 6 (audit) | Bad-HMAC → 401; redact handlers delete real rows |
| Legacy Billing API (P5) | Phase 1 (decision) + Phase 6 (config) | Plan configured via App Pricing; zero charge-creation code; lapsed-subscription gating tested |
| Review-process misses (P9) | Phase 6 (demo store started Phase 3) | Automated checks pass in Partner Dashboard; screencast + reviewer credentials + test steps attached |

## Sources

- shopify.dev — Cart and Checkout Validation Function API; About cart and checkout validation; Function APIs / About Shopify Functions (plan availability, limits) — via search results (MEDIUM)
- shopify.dev — API limits (128 kB input / 20 kB output / 11M instructions for validation functions) (MEDIUM)
- shopify.dev changelog — "Support for additional Shopify Functions APIs in draft orders" (Dec 2024, `bypassCartValidations`); "App submissions now require a screencast demo"; "All embedded apps required to adopt session tokens"; "Shopify App Pricing" (May 2026) (MEDIUM)
- shopify.dev — Webhooks best practices (no ordering guarantee, at-least-once, reconciliation, 5s timeout); Privacy law compliance (mandatory compliance webhooks, 401 on invalid HMAC) (MEDIUM)
- help.shopify.com — B2B features by plan; Setting up payment terms in B2B; Creating B2B orders using draft orders (MEDIUM)
- Bemeir "Shopify B2B in 2026: what every plan includes, what is still Plus-only" — April 2026 all-plans rollout; Plus-only: partial payments/deposits, unlimited catalogs (MEDIUM, cross-checked with help.shopify.com results)
- Gadget.dev "How to pass the Shopify app store review the first time"; Codersy/eSEOspace/Digital Heroes review-guideline guides — GDPR webhooks as top rejection cause, security headers, demo quality (LOW–MEDIUM, multiple independent sources agree)
- Hookdeck / EventDock / community.shopify.com — webhook reliability, missed-webhook reconciliation threads (MEDIUM)
- EasyDMARC / SalesHive / dev.to SaaS deliverability guides — SPF 10-lookup limit, DMARC alignment, subdomain isolation, 2024–25 Gmail/Yahoo enforcement (MEDIUM)
- community.shopify.com — `buyerIdentity.purchasingCompany.company.metafield` query path for validation functions (MEDIUM)

---
*Pitfalls research for: Shopify B2B credit-control app (Credit Guard: B2B Net Terms)*
*Researched: 2026-08-14*
