# Market Research — Acquisition Channels, Pricing and Launch Playbooks

**Project:** Credit Guard: B2B Net Terms (solo founder, US$29/mo flat, 14-day trial, no ad budget, Perth; category Finances → Other, locked)
**Researched:** 2026-09-05
**Method:** all figures sourced; where the public record has nothing reliable, it says so. Reddit blocked; apps.shopify.com intermittently failed DNS (LIETL listing and the Shopify Partners Staff Picks post fetched via syndicated copies).
**Companion documents:** `MARKET-COMPETITORS.md`, `MARKET-DEMAND.md`; synthesised in the playbook artifact "The Credit Guard Playbook" (2026-09-05).

## 0. The reframing finding

The net-terms credit niche is a 2026 land-rush and nobody has reviews yet. Every direct competitor except SparkLayer/Upro is a 2026 launch with 0–1 reviews (see `MARKET-COMPETITORS.md`). Shopify itself still does not enforce credit limits. **Implication: the ranking race is decided by who reaches ~15 reviews first, not by feature depth. The window is measured in months.**

## 1. Shopify App Store discovery mechanics (2026)

### 1.1 Search ranking
- Scale: 17,891 active apps, 584 new/month, average 45 reviews/app, 1,443 Built for Shopify apps, 98% of featured apps are BFS (AppJubilee, May 2026: https://www.appjubilee.io/shopify-app-store-report-2026).
- ~60% of installs start with search; merchants "decide within the first screen" (https://prys.io/learn/shopify-app-store-ranking-factors ; https://www.bigmoves.marketing/blog/shopify-app-store-ranking-algorithm-overview-of-shopify-app-store-ranking-factors).
- Ranking factors (third-party observers; Shopify publishes none): keyword relevance with title keywords front-loaded; install volume and velocity; listing conversion rate; review count, average and recency; retention/uninstall rate; category correctness. Bigmoves: June 2023 update weights reviews by depth, recency and reviewer tenure — "review quality outweighs raw volume". AppJubilee: "review velocity beats total reviews".
- Official listing rules: app name max 30 chars, lead with brand; up to 5 search terms; up to 25 structured features; up to 6 integrations (only apps you directly integrate with); Shopify recommends a 14-day trial (https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices).
- Visitor-to-install by review count: under 25 reviews 1–2%; 200+ reviews 5–8% (https://weekonelabs.com/blog/shopify-app-revenue-benchmarks-2026/).

### 1.2 Category placement
Finances holds 276 apps. No public data isolates browse-vs-search traffic by category; Sicard characterises the App Store as "a conversion surface, not a discovery engine" (https://taylorsicard.com/blog/shopify-app-distribution-playbook-2026). Competitors are split across Invoices/Accounting/Wholesale, so search terms matter more than category. The Wholesale category's "Net terms" feature filter is unreachable from Finances → Other.

### 1.3 Shopify App Store Ads (still exists)
- Live program: search (4 desktop/3 mobile slots), category and homepage placements; CPC, first-price auction; Partners only (https://shopify.dev/docs/apps/launch/marketing/advertising). No minimum budget published.
- Observed CPCs: platform-recommended "$7 to $35 for typical terms", $25–$60 for high-relevance terms (https://modo25.com/blog/news-insights/what-they-dont-tell-you-about-shopify-app-store-ads/). A founder in Sep 2026: "14 clicks and zero installs, at $6.57/click" (https://www.indiehackers.com/post/we-got-our-shopify-app-approved-in-72-days-now-were-stuck-at-distribution-and-people-keep-offering-us-paid-reviews-df8505401d).
- At $29/mo and 1–2% zero-review listing conversion, $7 CPC implies ~$350–700 per install — not viable until reviews exist.

### 1.4 Built for Shopify
- Benefits: higher search ranking, BFS filter, eligibility for homepage/category recommendations and the admin "Picked for you" modal, priority review queue; annual re-review (https://shopify.dev/docs/apps/launch/built-for-shopify). Merchant-utility thresholds shown in the Partner Dashboard: 50 net installs on paid plans, 5 reviews, 4+ stars (confirmed on Credit Guard's Distribution page, 2026-09-04).
- Measured effects: Seguno +14% installs and page-one ranking within six days (https://ecommercefastlane.com/how-seguno-propelled-their-success-on-the-shopify-app-store-with-built-for-shopify/); ezApps ~8 → ~19 installs/week, +35% sustained (https://ezapps.io/blogs/is-built-for-shopify-worth-it).

### 1.5 Reviews API and review velocity
- Reviews API shipped 2025-08-04; in-admin modal; at most 3 showings per merchant per 365 days; merchant must have had the app ≥24 hours; request at the end of a successful workflow (https://shopify.dev/changelog/request-app-reviews-in-admin-with-the-new-reviews-api). Credit Guard's prompt already uses it (fires after the first success moment).
- Thresholds reported by founders: 15 reviews is where "the organic install curve changed" (Indie Hackers, Sep 2026); ~50 reviews is the credibility threshold (Sicard); 10 five-star reviews was the floor for a Staff Pick (https://www.indiehackers.com/post/how-to-get-768-new-customers-for-your-shopify-app-c7caef0a09). ~1 in 20 users leaves a rating (https://baremetrics.com/blog/top-10-business-metrics-for-shopify-app-developers). Paid/incentivised reviews get apps delisted; expect DMs offering them within days of listing.

### 1.6 Staff Picks / featuring
Editorial; scheduled ~3 months ahead; best timing March/April or pre-Q4; required ≥10 five-star reviews; one feature produced 768 new customers, 29% funnel conversion (Ampd); HulkApps ~4x daily installs during feature week, obtained by making work "known to your partner director" (https://www.hulkapps.com/blogs/topics/spilling-out-the-beans-on-getting-featured-on-the-shopify-app-store-staff-picks). Ease of onboarding and a demo video are selection criteria.

### 1.7 How 0-review apps get first installs (founder write-ups)
- Sep 2026 thread (loyalty app): highest-converting tactic was personalised email to merchants who left 1–2 star reviews on competitors naming their complaint — "thirty stores, eleven installs, three weeks"; Shopify Community answering (no pitch) got 71% engagement vs 9% in Facebook groups; founder-led setup calls produced both installs and reviews; realistic first target "~15 conversations" (https://www.indiehackers.com/post/we-got-our-shopify-app-approved-in-72-days-now-were-stuck-at-distribution-and-people-keep-offering-us-paid-reviews-df8505401d).
- DropCommerce ($78K CAD MRR): "organic traffic from Shopify was everything"; paid ads and email "poor ROI"; single 1-star reviews "cut our daily installs in half" (demand-heavy category, weak analogue).
- Common failure: "the founder ships the app, gets 20 to 50 installs from initial outreach, sees underwhelming conversion, and stops investing time" (Week One Labs).

## 2. Non-App-Store channels

### 2.1 Shopify Community (highest-intent, already contested)
Live threads in the last 60 days with the exact problem: 654028 (Jul 22, 2026; "one retailer had 3 unpaid May orders yet placed a 4th order"; 6 replies, 260 views); 669115 (Aug 21, 2026; posted by an app founder, duedesk; competitor UprightApps replied); 673341 (Aug 27, 2026; disclosed content marketing by UprightApps); 397619 (long-running, updated Apr 2026; TermsPilot founder posted). Wholesale-tag threads run 120–260 views / 6–12 replies. Tone that worked: answer-first with disclosure.

### 2.2 Reddit
Not verifiable in this environment; founders cite r/shopify as a place merchants post specific problems. Verify manually.

### 2.3 Agencies and partner programs
- Sicard: agencies are "the most underused channel" (an agency with 50 clients is a path to 50 merchants) but budget 6–12 months for consistent referrals.
- B2B-specialist agencies (2026 roundups): Shero Commerce (Plus Premier Partner, $10K+ minimum), Uncap ("only Shopify Platinum partner dedicated exclusively to B2B"), Elogic, Atwix, BlueSwitch, Folio3, Wholesale Helper (https://www.blackbeltcommerce.com/top-shopify-plus-agencies-in-2026-ranked-by-specialty/ ; https://www.uncap.com/post/top-shopify-b2b-agencies-partners). Agencies already publishing "credit limits" content and fielding the question: Optimum7, i95Dev, Kensium, Uncap.
- SparkLayer's partner program: "300 agencies and technology partners", 10% referral commission; public partner directory (https://www.sparklayer.io/partners/) — a ready-made list of agencies doing Shopify B2B.
- Shopify Partner Directory is not for app developers (Plus-tier agencies only). Shopify Partners Slack: 35,000+ members, invite via Partner Dashboard. Perth Shopify Meetup exists; Melbourne and Sydney meetups run on Meetup.

### 2.4 Xero / QuickBooks ecosystems
Both app stores require an actual integration; Credit Guard has none, so closed until one exists. Competitors do integrate (Net Terms Tracker exports; LIETL syncs Xero/QuickBooks/Sage).

### 2.5 Finding Shopify B2B stores for outbound
- StoreLeads tracks installed apps and flags wholesale via /wholesale or /trade pages; SparkLayer is on 4,924 stores, +38.5% YoY, 32.4% US, 14.2% UK, **10.1% Australia (496 stores)** (https://storeleads.app/reports/shopify/app/sparklayer); Wholesale Lock Manager on 5,311 stores. No tool detects native Shopify B2B (company accounts) directly; wholesale-app installs and /wholesale pages are the proxy.
- Outbound benchmarks (vendor, optimistic): Shopify email lists 3.4–10.7% response; LinkedIn 1–3% reply. Only founder-reported number for personalised outreach: 11 installs from 30 emails.

### 2.6 Content/SEO
No reliable search volumes for "shopify net terms" / "shopify b2b credit limit". The SERP is owned by agencies (Optimum7, i95Dev, Kensium, Uncap, Liquidlab) and by Net Terms Tracker/LIETL sites; Sicard budgets 6–12 months and ~12 targeted articles. Apex domain transfer eligible 17 Oct 2026.

### 2.7 YouTube
Net Terms Tracker has an 8-part setup series; no evidence YouTube drives installs for B2B apps. A sub-60s demo video is a Staff Pick and ads prerequisite.

### 2.8 Cross-promotion
Integration-based distribution is Sicard's highest-leverage channel but needs 3–6 months per partner. Natural complements that do not enforce credit: SparkLayer, NetWise ($24.95, 25 reviews), Xero/QuickBooks connectors, AReceivables. No formal co-marketing program for solo developers found.

## 3. Pricing benchmarks
- Direct competitor entry range: $19–$99 (LIETL $19, Net Terms Tracker $29, Net Vantage $29, Upro $30, NetWise $24.95, SparkLayer $49); TermStack $99–$499 outlier; most tier by customer/company count. **$29 flat is at the mode.**
- General 2026: flat pricing is rare (Judge.me $15 flat, PageFly as exceptions); healthy app spend 1–3% of revenue; stores under $1M spend $50–300/mo on apps (https://taylorsicard.com/blog/shopify-app-pricing-benchmarks-2026 ; https://eightx.co/blog/average-ecommerce-shopify-app-spend-by-revenue-band-2026).
- Flat vs tiered conversion: no reliable Shopify-app-specific figure. Week One Labs: the $2K–$20K MRR middle is "focused single-feature apps that do one thing well".
- Trial length: Shopify recommends 14 days; AppJubilee reports 14-day trials "outperforming free plans"; competitors run 14 (Net Vantage, TermStack, SparkLayer), 30 (Net Terms Tracker), 60 (Upro). A B2B credit app needs at least one order cycle inside the trial.
- "Free for partners and developers" flag places the app in the Partner Friendly collection (455 apps) and is the precondition for agencies trialling on client builds. Credit Guard has it enabled.

## 4. Retention and onboarding benchmarks
- Install-to-paid: 8–18% with strong onboarding, 2–5% weak; "first value within 5 minutes" (Week One Labs). SpurIT: day-1 churn 20–25% for good apps, 40–45% struggling, 60–70% poor.
- Trial-to-paid (single founder datapoint): Picture It 37% in Q1 2025, historically ~50%, drop attributed to onboarding friction.
- Monthly churn: 5–12% typical; low end for apps in critical functions (Week One Labs). Month-1 churn for Shopify apps specifically: no reliable public figure.
- First-7-day uninstall triggers (Aug 2026 community thread, 60,278 reviews analysed): late complaints dominated by billing (19.2%), bugs (13.9%), setup confusion (4.4%), no support response (3.9%); "praise comes early, anger comes late"; median 1-star reviewer had used the app 90 days (https://community.shopify.com/t/whats-the-biggest-reason-merchants-uninstall-a-shopify-app/660762).
- Personal onboarding: founder-led setup calls "produced both installs and reviews" — a first-fifty tactic, not permanent.

## 5. Lessons from competing net-terms/credit apps
- **Net Terms Tracker** (May 2026): Free + $29 Pro, 30-day trial, 0 reviews four months in; marketing is App Store + 8-part YouTube series + SEO copy. Lesson: a long trial has not produced reviews on its own.
- **Net Vantage** (May 2026): $29/$59/$99 by customer count, 0 reviews; positions on warn-vs-block.
- **TermStack** (Mar 2026): $99–$499, free on dev stores, 1 review in six months. Lesson: premium pricing without reviews stalls.
- **LIETL**: freemium, accounting integrations, credit scoring; unsourced "reduce overdue invoices by up to 40%" claim.
- **Upright Net Terms / duedesk / TermsPilot**: three founders actively seeding the Shopify Community in Jul–Aug 2026. Lesson: the forum is the contested channel; being more useful (and the only one with a Function-level hard block and no PII) still wins the thread.
- **Upro** (Oct 2024): 23 five-star reviews in ~23 months with a 60-day trial and BFS — roughly one review/month.
- **SparkLayer** (2021): 382 reviews in 5.3 years (~6/month), 4,924 installs, 10% in Australia; growth via direct sales, a 300-agency partner network with 10% commission, multi-platform listings, VC backing. Lesson: the one scaled player grew through agencies, not the App Store alone.

## Channels ranked by expected yield (solo founder, no ad budget, Perth)

1. **Shopify Community net-terms threads, answer-first with disclosure.** Cost: hours. Yield: first 5–15 installs plus listing vocabulary.
2. **Personalised outbound to identifiable wholesale stores + founder setup calls.** StoreLeads (SparkLayer/Wholesale Lock Manager installs, /wholesale pages; 496 Australian SparkLayer stores), and 1–2★ reviews on wholesale apps mentioning overdue/credit. Benchmark 11 installs / 30 emails. Setup calls double as review requests at the first success moment. Target: 15 reviews.
3. **Listing optimisation now.** Front-load "Net Terms" / "Credit Limit" in name and search terms; mirror forum vocabulary; add a <60s demo video; keep 14-day trial.
4. **Partner-friendly flag (done) + the B2B agency list** with a one-page proposal: Shero, Uncap, Elogic, Atwix, BlueSwitch, Folio3, Kubix, Haslo, the SparkLayer partner directory, Optimum7/i95Dev/Kensium. Expect 6–12 months.
5. **Built for Shopify** at 50 paid installs + 5 reviews + 4★.
6. **Complementary-app co-marketing / a real Xero integration** (opens the Xero App Store too). Slow; highest leverage per Sicard.
7. **Staff Pick pitch** at ~10 five-star reviews, via partner manager, 3 months ahead.
8. **Content/SEO on the apex** after 17 Oct 2026. Compounds over quarters.
9. LinkedIn outbound (1–3% reply). 10. YouTube walkthroughs (needed for Staff Pick/ads anyway). 11. Trade associations (skip until case studies). 12. **App Store Ads last**: revisit at 15+ reviews with $1–$5 research bids only.

Not viable today: Shopify Partner Directory; Xero/QuickBooks app stores (need an integration); Product Hunt/Hacker News (no B2B-Shopify success evidence).

## Sources
See inline links. Principal: appjubilee.io 2026 report · prys.io · bigmoves.marketing · taylorsicard.com (distribution playbook; pricing benchmarks) · shopify.dev (best practices; advertising; built-for-shopify; reviews API; app pricing) · modo25.com · ecommercefastlane.com (Seguno; Staff Picks) · ezapps.io · hulkapps.com · indiehackers.com (Sep 2026 distribution thread; Ampd; DropCommerce) · weekonelabs.com · community.shopify.com threads 654028, 669115, 673341, 397619, 660762 · sparklayer.io/partners · storeleads.app (SparkLayer, Wholesale Lock Manager) · blackbeltcommerce.com · uncap.com · optimum7.com · i95dev.com · eightx.co · spur-i-t.com · baremetrics.com · startupfounderstories.com (Picture It; RotateProduct).
