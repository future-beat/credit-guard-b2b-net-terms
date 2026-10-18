# Market Research — Competitive Landscape

**Project:** Credit Guard: B2B Net Terms
**Researched:** 2026-09-05 (post-listing; app public on the App Store since 2026-09-04)
**Method:** every app profiled from its individual App Store listing page plus the wholesale category's "Net terms" feature filter (278 apps, page 1 sampled). App Store *search* pages failed to load on every query. Three pages could not be fetched and are flagged inline: LIETL's listing (404), Shopify's Summer '26 Editions page (404; Winter '26 fetched), B2B Wholesale Hub's reviews sub-page.
**Companion documents:** `MARKET-DEMAND.md`, `MARKET-CHANNELS.md`; the playbook artifact "The Credit Guard Playbook" (2026-09-05) synthesises all three.

## 1. Comparison table

BFS = Built for Shopify badge. "Native B2B" = works on Shopify Companies / payment terms (vs customer-tag wholesale). "Enforces" = blocks checkout.

| App | Type | Native B2B? | Enforces? | Reminders? | Price | Reviews / rating | BFS | Launched |
|---|---|---|---|---|---|---|---|---|
| **Credit Guard: B2B Net Terms** (Hesam Labs) | Credit control | Yes (companies only) | Yes — over-limit **and** overdue, per-company bypass | Yes — Shopify-sent, 72h before / on / 72h after due | $29/mo, 14-day trial | 0 / 0.0 | No | Sep 3, 2026 (listing) |
| Net Terms Tracker: B2B Credit (HJBCodeForge) | Credit control + invoicing + portal | "Alongside native B2B or standalone"; per-**customer** | Yes — "Net terms auto-hide for customers who are overdue or over limit" | Yes — own email reminders (Pro) | Free (5 customers) / Pro $29, 30-day trial | 0 / 0.0 | Conflicting (one pass read No, one Yes) | May 6, 2026 |
| Net Vantage: B2B Credit & A/R (Valence Core) | Credit control + AR aging | Per-customer & per-company; reads payment terms | Partial — draft-order warnings; "restrict or block over-limit B2B checkout" | No | $29 (50 cust.) / $59 (200) / $99 (500), 14-day | 0 / 0.0 | No | May 5, 2026 |
| Folio: B2B Credit Limits (Folio3) | Credit control + ledger | Yes (companies, payment terms) | Yes — "Automated checkout validation blocks orders exceeding available credit" | No | Free (10 cos.) / $59 / $99 | 0 / 0.0 | No | May 12, 2026 |
| BizCred: B2B Credit Management (Seventh Triangle) | Credit control + ledger | Per-company; Flow + Checkout | Yes — blocks/restricts payment methods when limit breached | No | Free (dev) / $39, 7-day | 0 / 0.0 | **Yes** | Apr 20, 2026 |
| Trade Credit: B2B Credit Limit (NicheLab) | Credit control | Customers, tags **or** companies | Yes — "Auto-block checkouts instantly when buyers exceed their approved credit limit" | No | $39/mo or $390/yr, 14-day | 0 / 0.0 | No | May 20, 2026 |
| TermShield: Net Terms & Credit (Termguard) | Credit control + AR aging | Yes (companies, payment terms) | Yes — "Hard credit-limit block… (outstanding + cart over limit)"; soft mode | "Overdue email alerts" (recipient unclear) | Free (1 co.) / $29 (10 cos.) / $59 unlimited, 14-day | 0 / 0.0 | No | Jul 2, 2026 |
| SmartB2B (Dynamic Dreamz) | B2B onboarding + credit | Yes (companies, payment terms) | Yes — "auto-block" overdue accounts (Plus tier) | Not stated | Free (10 cos.) / $49 / $99 | 0 / 0.0 | No | Jun 4, 2026 |
| Upro B2B & Wholesale (Monk Commerce) | B2B suite w/ credit limits | Yes (companies, catalogs, locations) | Yes — "order restrictions or due warnings/alerts at checkout" | No | $30–$299/mo (+bundles $45–$449), 60-day | **23 / 5.0** | **Yes** | Oct 1, 2024 |
| Net Terms (LIETL Solutions, netterms.app) | Credit control + scoring + collections | Claims "works alongside Shopify native B2B" | Claims "Checkout blocks orders exceeding available credit" | Yes — email; SMS/WhatsApp on Growth | Free (10 inv./mo) / $19 / $49 / $99 | **Listing URL 404** — unverifiable | — | Not stated |
| NET30 (net30.app) | Net terms + invoicing | Not stated | Not stated | Yes (claimed) | "Free to install… paid plans launching soon" — **pre-launch signup** | — | — | — |
| TermStack: Net Terms for B2B (Varr Labs) | Dynamic payment-terms rules (Functions) | Yes, **Plus only** | No credit limits | No | $99 / $249 / $499, 14-day | 1 / 5.0 | Yes | Mar 9, 2026 |
| Payment Terms ‑ B2B Wholesale (Ecom Weave) | Apply/remove net terms by rule (Functions) | Yes, Plus | No credit limits | No | Free | 0 / 0.0 | Yes | Jun 4, 2026 |
| Wholster: Wholesale B2B (Gist) | Wholesale platform w/ NET30 + receivables | Customer groups (tags) | Has credit limits (per 1★ review) | Statements; unclear | Free+3% / $29.99+1% / $99.99+0.5% / $999.99 | 42 / 4.7 | No | Oct 24, 2019 |
| B2Bridge B2B Wholesale Pricing | B2B suite | Tags + Markets; "B2B Checkout with net term & credit limit" | Not stated | No | $99 / $199 / $299, 14-day | 26 / 5.0 | Yes | Dec 26, 2024 |
| Duos B2B Self‑service (Qikify Plus) | B2B suite w/ finance module | Yes (native B2B) | Not stated | No | Free / $166 / $256 / $396, 30-day | 1 / 5.0 | Yes | Mar 4, 2025 |
| SparkLayer B2B & Wholesale | B2B suite | Native payment terms; QBO/Xero | No credit limits | No | Free / $49 / $149 / $299, 14-day | 382 / 4.9 | Yes | Apr 28, 2021 |
| B2B Wholesale Hub (Orbit, "Wholesale Club") | B2B suite | Tags | No | No | $39 / $69 / $99, 14-day | 699 / 4.7 | Yes | Jan 6, 2015 |
| Wholesale Gorilla | B2B suite | Tags; net terms Adv+ | Order limits only | No | $34.95 / $69.95 / $149.95, 21-day | 313 / 4.7 | Yes | Sep 26, 2018 |
| Wholesale Pricing Discount B2B (Wholesale Helper) | B2B suite | Tags; Net 15/30/60 Pro+ | No | No | $24.99 / $44.99 / $49.99 / $64.99, 14-day | 723 / 4.9 | Yes | Apr 4, 2018 |
| BSS B2B Wholesale Pricing | B2B suite | Tags + payment terms | No | No | Free / $29 / $49 / $99, 14-day | 1,146 / 4.9 | Yes | Sep 18, 2020 |
| Sami B2B Wholesale Pricing (Samita) | B2B suite | Tags; "Edit companies"; net terms | No | No | Free / $24.90 / $49.90, 14-day | 981 / 4.9 | Yes | Sep 26, 2023 |
| Massy B2B Wholesale Pricing | B2B suite | Net terms only in $129 Plus tier | No | No | Free / $29 / $59 / $129 | 223 / 5.0 | Yes | Jan 28, 2025 |
| NetWise B2B Wholesale Discount (ShopTrade Labs) | B2B suite | Native payment terms Net 7–90 | No | No | Free / $24.95, 30-day | 26 / 5.0 | Yes | Sep 22, 2023 |
| Wholesale Pro B2B Pricing (Productive Passengers) | B2B suite + AR | Tags; Net 15/30/60 | No | Yes — "Send invoice reminders" (Advanced) | Free / $9.99 / $29.99, 21-day | 16 / 4.6 | Yes | Sep 20, 2024 |
| Nexora B2B Wholesale Pricing | B2B suite + invoicing | Native payment terms | No | No (tracks paid/overdue) | Free / $15 / $35 / $75, 7-day | 4 / 5.0 | Yes | May 28, 2026 |
| B2B Wholesale Pricing GOAT (Conspire) | B2B suite | "Works with Shopify's built-in B2B"; net terms | No | No | $29 / $69.95 / $149 | 3 / 5.0 | Yes | Dec 3, 2024 |
| Wholesale ‑ All in one (DigitalCoo) | B2B suite | Net terms add-on | No | No | $24 / $29 / $39, 14-day | 276 / 4.9 | No | Mar 12, 2019 |
| effizient: Wholesale & B2B | B2B suite | Tags; Net 7–90 included | No | No | $149 / $689 / $1,499 | 0 / 0.0 | No | Dec 16, 2025 |
| Kuhl B2B Wholesale & Net Terms | Portal + invoices | Own portal; net 15–60 via invoice | No | No | $20, 30-day | 0 / 0.0 | No | Apr 1, 2025 |
| Charge Me Later (Buddy Apps) | Pay-later invoicing | Tags/groups | No | No | $9.99 / $19.99 / $29.99, 4-day | 152 / 4.9 | Yes | Feb 23, 2018 |
| Charge Rabbit | — | — | — | — | "not currently available on the Shopify App Store" | — | — | — |
| Sufio: Invoices | Invoicing | "Automate invoicing for Shopify B2B" | No | Overdue reminders (Growth+) | $7 / $19 / $49 / $129, 14-day | 460 / 4.9 | Yes | Jul 22, 2013 |
| Invoice Hero (MLVeda) | Invoicing + AR | No B2B-company support stated | No | Yes — payment reminders | Free / $5.95 / $8.95 / $24.95 | 310 / 4.8 | Yes | Nov 22, 2018 |
| Invoice Falcon | Invoicing | Companies + payment terms on docs | No | No | Free / $15, 14-day | 325 / 4.8 | Yes | Jul 19, 2019 |
| Order Printer Pro | Documents | B2B + payment terms on docs | No | No | Free / $10 / $20 / $40 | 2,874 / 4.9 | Yes | Dec 2, 2014 |
| QuickBooks Online (Intuit) | Accounting sync | "B2B orders as invoices"; AR | No | No | Free install (Intuit bills) | 3,299 / 4.7 | Not shown | Feb 23, 2015 |
| Resolve Pay | Embedded financing | Own credit line at checkout | Resolve underwrites | n/a | Free install; SaaS + financing fees; "up to 3.5% on 30 day net terms"; advances 50/75/90% | 0 / 0.0 | No | Feb 13, 2024 |
| Balance | Embedded financing | Own checkout; "funds on day 1" | Balance underwrites | n/a | Free install; fees undisclosed; ACH 1–2% | 0 / 0.0 | No | May 18, 2022 |
| Credit Key B2B Payments | Embedded financing | Net 30 to 12 mo; up to $50k instant | Credit Key underwrites | n/a | Free install; "Fees starting at 1% monthly, after 30 days" | 0 / 0.0 | No | May 31, 2022 |
| Hokodo ‑ Pay Later for B2B | Embedded financing (UK/EU) | — | — | — | Free install; fees from 2% | 0 / 0.0 | No | Sep 22, 2022 — **company shut down, final transaction Nov 2025** |
| Two (two.inc) | Embedded financing (Europe) | Via **Mondido** gateway only; no own listing | — | — | Undisclosed | — | — | — |
| Mondu | Embedded financing (EU/UK) | **Custom distribution only**, Plus required | — | — | Undisclosed | — | — | — |
| Billie | Embedded financing (DE/AT/NL/CH/FR/SE) | Shopify integration exists; fees undisclosed | — | — | — | — | — | — |
| TreviPay (incl. Apruve, acq. Dec 2022) | Enterprise managed AR/financing | No App Store listing found | — | — | — | — | — | — |
| Slope | Embedded financing (US), API-only | No App Store listing; "from 1.60% Net 30" | — | — | — | — | — | — |
| Kriya (UK), Tabs, Vartana | — | No Shopify App Store presence found; Vartana acquired by Capchase Jun 2025 | — | — | — | — | — | — |

## 2. Narrative by bucket

**Direct competitors.** There was essentially nothing in this niche before 2026; then seven near-identical apps launched between April 20 and July 2, 2026 (BizCred, Net Vantage, Net Terms Tracker, Folio, Trade Credit, SmartB2B, TermShield), almost certainly triggered by Shopify's April 2, 2026 "B2B on all plans" change. Credit Guard (Sep 3) is the eighth and latest. **Every one of them has 0 reviews and none has the BFS badge except BizCred** (one pass also read the badge on Net Terms Tracker). The only credit-limit app with social proof is Upro (23 reviews, 5.0, BFS, since Oct 2024) — a $30–$299 full B2B suite whose reviews are about support, not credit.

- *Overdue as a block condition* is explicit only in Credit Guard, Net Terms Tracker and SmartB2B; Net Vantage only *warns* staff on draft orders; Folio, BizCred, Trade Credit and TermShield describe over-limit blocks only.
- *Reminders* ship in Credit Guard, Net Terms Tracker (own email), TermShield ("overdue email alerts"), and LIETL (unverifiable). Folio, BizCred, Trade Credit, Net Vantage: none.
- *Pricing tiers by company count* are the norm: TermShield 10 companies at $29, Net Vantage 50 customers at $29, Folio 10 free then $59, SmartB2B 10 free then $49. Credit Guard's flat $29 unlimited is the cheapest unlimited plan in the cohort; Net Terms Tracker Pro is also $29 unlimited with a 30-day trial.
- *Non-native (tag-based) stores* are served by Net Terms Tracker and Trade Credit. Credit Guard, Folio, TermShield, SmartB2B require Companies.
- Two claimed competitors don't exist on the store today: LIETL's listing returns 404 (its marketing site still links to it), and NET30 is a pre-launch signup page.
- Adjacent Functions apps (TermStack, Ecom Weave) automate *which* terms apply, not *whether* credit allows the order; both are Plus-only.

**B2B suites.** The big installed bases (BSS 1,146 reviews, Sami 981, Wholesale Pricing Discount 723, B2B Wholesale Hub 699, Sufio 460, SparkLayer 382, Wholesale Gorilla 313) all offer "net terms" as a checkbox but **none enforce a credit limit or block overdue buyers**; most are still customer-tag architectures. Credit Guard can only sit on top of the ones that use native payment terms (SparkLayer, NetWise, BSS, Nexora, GOAT, Upro). Review excerpts showing the pain: "wholesale customers randomly unrecognized, forced to pay instead of net terms" (Rusty Dog Coffee on Wholesale Pricing Discount, 2★, Jul 2025); "customers get checkout error about credit limits" (Stencil Expressions on Wholster, 1★, Aug 2020); "Setting default payment terms per client requires premium upgrade" (AgozTech on Sufio, 1★, May 2025); "constant malfunctions, and complete lack of customer support" (Sorellina Coffee on Wholesale Gorilla, 1★, Aug 17, 2026).

**Embedded financing / BNPL.** Different problem (removing the merchant's credit risk) at a different price (percent of GMV). On Shopify their footprint is thin: Resolve, Balance, Credit Key and Hokodo all have listings with **0 reviews**; the sector has contracted (Hokodo shut down after raising $177M; Apruve absorbed into TreviPay; Vartana acquired by Capchase). Fees where disclosed: Resolve up to 3.5% / 3.15% for Net 30; Credit Key from 1%/month after 30 days; Hokodo from 2%; Slope from 1.60%; Balance ACH 1–2%. Positioning implication: Credit Guard is for merchants who *want* to carry their own AR and need it enforced.

**Adjacent invoicing/accounting.** Sufio, Invoice Hero, Invoice Falcon, Order Printer Pro handle documents; Sufio and Invoice Hero send overdue reminders from their own infrastructure; none touch checkout. QuickBooks Online (3,299 reviews) and Xero connectors sync terms and companies, but credit limits in those ledgers never flow back to block a Shopify checkout. The App Store's "similar apps" module on Credit Guard's own listing shows QuickBooks Online, DATEV and Financify — the listing is categorised (Finances → Other) beside accounting tools, not beside the seven credit-control apps in wholesale/B2B categories.

## 3. Has Shopify shipped native credit limits, overdue blocking, or reminders?

- **Credit limits / overdue blocking: No, as of Sep 2026.** The B2B payment-terms help page lists Net 7–90, due on fulfillment, fixed date, and Plus-only deposits, with no credit-limit or blocking mechanism. Third-party analyses (Aug 11, 2026) confirm "no native mechanism to block an order when a buyer's outstanding balance crosses a threshold". Closest natives: Winter '26 (Dec 10, 2025) "rules for order review… using apps powered by Shopify Functions. Exclusive to Plus" and "Dynamic payment terms and deposits… Exclusive to Plus" — both delegated to apps; and a public DIY recipe (Joey Hoer, Dec 2, 2025) using company metafields + Flow + a validation function that does not handle overdue.
- **Automated reminders: Yes, partially, since Jan 24, 2023.** Up to five reminders with a pay-now link; timing "On due date" or N days after (up to 30); the Flow "Send payment reminder" action is Plus-only. **No native "before due date" reminder** — Credit Guard's first touchpoint. Flow docs warn to "check your Admin settings to avoid duplicate reminders", a live risk for merchants who enable both.
- **Summer '26 (Jun 17, 2026):** agency recaps say net terms with automated invoicing became native; the concrete changelog item is the Flow action "Charge vaulted payment for B2B order", which reduces overdue *occurrence* for merchants using vaulted payments.
- **B2B on all plans (Apr 2, 2026):** companies, payment terms, 3 catalogs, volume pricing, vaulted cards, ACH (US) on Basic/Grow/Advanced.

## 4. Where Credit Guard is differentiated

- The only app in the cohort combining hard over-limit **and** overdue block, per-company bypass, Shopify-sent reminders and an AR dashboard at a flat $29 with no company-count tier.
- A **pre-due** reminder touchpoint; native reminders and Flow templates fire only on/after due.
- Reminders via Shopify's own `paymentReminderSend`: no buyer email held or sent by third-party SMTP; PCD Level-1 posture none of the others advertise.
- Works on all plans; Functions-based alternatives (TermStack $99+, Ecom Weave, Mondu) are Plus-only.
- No percent-of-GMV fee and no third-party underwriting.
- Honest vocabulary ("credit hold", per-attempt blocks unobservable) — competitors claim "instant" blocks with no mention of the metafield-staleness reality they all share.

## 5. Where it is weaker

- **Zero reviews, no BFS badge, launched last** in an eight-app cohort where BizCred has the badge and Upro has 23 five-star reviews plus BFS. Net Terms Tracker offers 30 days' trial and Upro 60.
- **No free tier.** TermShield, Folio, Net Terms Tracker, SmartB2B, BizCred (dev) all have one.
- **Companies-only.** Net Terms Tracker and Trade Credit serve the large tag-based wholesale base.
- **Thinner feature surface** than several $29–$59 rivals: no PDF invoicing or buyer portal, no AR aging buckets/CSV export, no draft-order warnings, no credit scoring, no SMS, no "soft mode".
- **Reminder overlap risk** with Shopify's free native on-due/after-due reminders.
- **Discoverability:** Finances → Other, with "similar apps" pointing at accounting tools; the wholesale "Net terms" filter alone returns 278 apps.
- **Platform roadmap risk:** a native `creditLimit` on Company or an overdue-aware review rule would collapse the category; a zero-cost Flow + Validation Function recipe already exists publicly.

## Sources

Credit Guard: https://apps.shopify.com/credit-guard-b2b-net-terms
Direct competitors: https://apps.shopify.com/net-terms-tracker · https://apps.shopify.com/net-vantage · https://apps.shopify.com/folio-credit-ledger · https://apps.shopify.com/bizcred-b2b · https://apps.shopify.com/trade-credit · https://apps.shopify.com/termshield · https://apps.shopify.com/smartb2b · https://apps.shopify.com/upro-credit-limit-b2b-and-wholesale · https://netterms.app/ · https://www.net30.app/ · https://apps.shopify.com/termstack · https://apps.shopify.com/ecom-weave-payment-terms · https://apps.shopify.com/wholster · https://apps.shopify.com/b2bridge-b2b-all-in-one · https://apps.shopify.com/qikify-b2b-solution
B2B suites: https://apps.shopify.com/sparklayer · https://apps.shopify.com/wholesale-club · https://apps.shopify.com/wholesale-gorilla · https://apps.shopify.com/wholesale-pricing-discount · https://apps.shopify.com/b2b-solution-custom-pricing · https://apps.shopify.com/wholesale-sami · https://apps.shopify.com/massy-b2b-wholesale-pricing-discount · https://apps.shopify.com/netwise · https://apps.shopify.com/wholesale-discount-pro-b2b-pricing · https://apps.shopify.com/nexora-b2b-wholesale-pricing · https://apps.shopify.com/wholesale-b2b-trade-program · https://apps.shopify.com/wholesale-all-in-one · https://apps.shopify.com/effizient · https://apps.shopify.com/kuhl-wholesale · https://apps.shopify.com/charge-me-later · https://apps.shopify.com/charge-rabbit
Financing: https://apps.shopify.com/resolvepay · https://resolvepay.com/pricing/ · https://apps.shopify.com/balance · https://apps.shopify.com/credit-key-payments · https://apps.shopify.com/dev-hokodo-rhys-env · https://thepaypers.com/payments/news/hokodo-shuts-down-after-eight-years-and-usd-177-mln-raised-in-b2b-bnpl-market · https://docs.two.inc/docs/plugins/shopify/ · https://docs.mondu.ai/docs/shopify-payment-app · https://billed.app/hub/online-payments/bnpl-for-b2b/ · https://slopepay.com/blog/fiserv-slope-partnership-ai · https://www.trevipay.com/
Adjacent: https://apps.shopify.com/sufio · https://apps.shopify.com/invoice-hero · https://apps.shopify.com/invoice-falcon · https://apps.shopify.com/order-printer-pro · https://apps.shopify.com/qbconnector
Shopify native/roadmap: https://help.shopify.com/en/manual/b2b/checkout-and-orders/payment-terms · https://help.shopify.com/en/manual/b2b/getting-started/features · https://help.shopify.com/en/manual/fulfillment/managing-orders/payments/deferred-payments · https://help.shopify.com/en/manual/shopify-flow/reference/actions/send-payment-reminder · https://changelog.shopify.com/posts/increase-on-time-b2b-payments-with-payment-reminders · https://changelog.shopify.com/posts/key-b2b-features-now-available-on-non-plus-plans · https://shopify.com/news/b2b-for-all · https://shopify.com/editions/winter2026 · https://changelog.shopify.com/posts/flow-automatic-charging-for-vaulted-payment-methods · https://liquidlab.ro/en/blog/shopify-b2b-limitations-2026 · https://joeyhoer.com/b2b-company-credit-limits-using-shopify-flow-536d68da
