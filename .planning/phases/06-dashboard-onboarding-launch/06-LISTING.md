# Credit Guard — App Store listing package (LNCH-03)

**Drafted:** 2026-08-21 (plan 06-06, Task 1)
**Live-drive verified:** 2026-08-22 (plan 06-07 — see §8 for what the drive changed)
**For:** the Partner Dashboard listing session and the app-review submission form.
**How to use:** every block below is copy-paste ready. Character counts are stated
next to each length-limited field and were computed against the exact text in the
fenced block, so what you paste is what was counted.

> **The honesty rule this document is written under.** Every claim here has to be
> provable from the shipped code or from live evidence on `credit-guard-demo`.
> Shopify requirement 1.1 ("apps that falsify data") and 4.3 (truthful listing)
> are the two most common rejection reasons for a listing that oversells. Two
> specific temptations are refused throughout:
>
> 1. **No dollar total of "orders we stopped".** Per-checkout-attempt refusals are not
>    observable — validation Function runs are not webhooked and 2026-07 exposes
>    no trace of a refused checkout. The app can only count *credit holds* and
>    the orders that went through *during* one. The vocabulary is **"credit
>    hold"** everywhere, matching the in-app copy (D6-02).
> 2. **No delivery promises for reminders.** Shopify sends the email; the app
>    supplies the payment-schedule id and the timing. "Sent" means Shopify
>    accepted the send, never that a mailbox received it.
>
> Two scope limits are stated *in the listing itself*, not buried: reminders v1
> chases only net-terms orders attributed to a company, and orders completed
> from a draft (or with bypass on) are not checked at checkout. Both are counted
> and surfaced in the app, which is what makes disclosing them safe.

---

## 1. Listing content

### 1.1 App name

```
Credit Guard: B2B Net Terms
```

`[27 chars]` — leads with the job, carries the two search ideas ("credit",
"net terms"). Must not contain "Shopify".

### 1.2 App introduction (limit: 100 characters, benefit-led)

```
Credit limits, checkout credit holds and payment reminders for your B2B net-terms customers
```

`[91/100 chars]`

### 1.3 App details (limit: 500 characters, functional, no testimonials, no guarantees)

```
Shopify records payment terms but doesn't enforce them. Credit Guard tracks what each B2B company owes across its net-terms orders and shows it on one dashboard: outstanding balances, overdue companies and upcoming due dates.

Set a credit limit per company. A company over its limit or with an overdue balance goes on credit hold and its buyers can't complete a new net-terms checkout — until you clear the balance or turn on bypass for that company.
```

`[451/500 chars]` — measured on the exact text above, blank line included.

Adding the reminder sentence ("Reminders are sent by Shopify from your own store
address.") pushes it to **511 characters and the field rejects it**, which is why
the reminder claim lives in the feature bullets (§1.4, bullet 4) instead. Do not
paste a longer variant without re-counting.

### 1.4 Feature bullets (limit: 80 characters each)

```
Set a credit limit for each B2B company from one table
Companies over limit or overdue go on credit hold at net-terms checkout
Per-company bypass toggle when you want to let an order through
Payment reminders 3 days before the due date, on it, and 3 days after
Dashboard: outstanding, overdue companies, and what's due in 30 days
Works with Shopify's native B2B companies and payment terms
```

Counts: `54`, `71`, `63`, `69`, `68`, `59` — all ≤ 80.

**Why each is defensible**

| Bullet | Proof |
|---|---|
| Credit limit per company | `Company.creditLimit`, set from `/app/companies` (Phase 3) |
| Credit hold at net-terms checkout | Cart & Checkout Validation Function reading the `credit_v1` metafield (Phase 4); "net-terms checkout" is exact — the prepay path stays open |
| Bypass toggle | `Company.bypassEnforcement`, checked first in the decision (D-03) |
| Reminder cadence | `REMINDERS_CADENCE` — `dueAt−72h`, `dueAt`, `dueAt+72h` (Phase 5). Deliberately "3 days after", not "when it's overdue" |
| Dashboard | `loadDashboard` KPI tiles + the two tables (Phase 6) |
| Native B2B | reads Shopify companies / payment terms; writes only its own metafield |

**Deliberately NOT claimed:** "works on every Shopify plan" (native B2B is on
paid plans since April 2026 — a claim about *Shopify's* packaging that can
change under us), any dollar figure of prevented risk, any delivery guarantee,
and any "protects you from bad debt" outcome promise.

### 1.5 Search terms (5, one idea each)

```
b2b credit limit
net terms
accounts receivable
payment reminders
wholesale credit control
```

### 1.6 Categories / structured features

- Primary category: **Selling products → Wholesale and B2B** (fall back to
  *Store management → Finances* if the B2B category is unavailable at submission).
- Structured feature tags to tick, if offered: *B2B*, *Wholesale*, *Credit
  limits*, *Payment terms*, *Accounts receivable*, *Automated reminders*,
  *Checkout validation*, *Reporting/dashboard*.
- Works with: **Shopify B2B**, **Checkout**.

### 1.7 Demo store URL

```
credit-guard-demo.myshopify.com
```

Storefront password and reviewer access are handled in §4.

### 1.8 Privacy policy URL

```
https://app.creditguardhq.com/privacy
```

`/privacy` is an unauthenticated resource route that already ships
(`app/routes/privacy.tsx`, content mirrors `PRIVACY.md`).

### 1.9 Support

| Field | Value |
|---|---|
| Support email | `support@creditguardhq.com` (already the contact in PRIVACY.md) |
| Support / FAQ URL | **Update 2026-09-04: `https://app.creditguardhq.com/support` is live (B2 shipped, commit b4c7dbe) — enter it in the Partner Dashboard.** Original at submission: **Not supplied — see §9.5.** `https://creditguardhq.com/support` was found to redirect to the demo store's password wall, so no URL is shipped; support is the email above |
| App URL | `https://app.creditguardhq.com` |

Neither the email nor any URL may contain the word "Shopify" (4.5.6).

---

## 2. Pricing section

**Status: DONE — configured and verified live on 2026-08-22.** One public plan:
monthly, **US$29**, **14-day free trial**, welcome link `/app`, display name
**Credit Guard**, plan handle `credit-guard`. No yearly plan. No usage tiers.
Flat pricing is part of the positioning.

Verified two ways on the same day: the store-side plan page rendered the card
under a **"Free to test"** heading (`$29 / 30 days` struck through, **`$0 / 30
days`**, 14 trial days), and after approval `scripts/prod-billing-state.sh`
reported an **ACTIVE** subscription named `Credit Guard`, `trialDays: 14`,
`test: false`, priced `0.0 USD / EVERY_30_DAYS`.

### 2.1 Pricing display name

```
Credit Guard
```

### 2.2 Plan feature bullets — **no field for these exists (observed 2026-08-22)**

The current Partner Dashboard plan form offers a **display name and no
top-features field**. Nothing below gets pasted into the plan; the plan card
renders from the display name and price alone, and it rendered correctly that
way. Keep these as **listing-description material** (they overlap §1.4) and
re-check the form at submission — if a features field reappears, this is the
text for it:

```
Credit limit for every B2B company
Credit hold at net-terms checkout when over limit or overdue
Per-company bypass toggle
Payment reminders before, on, and after the due date
Accounts-receivable dashboard
14-day free trial
```

> The locale rule still matters even without a features field: a plan renders to
> merchants only in a language the listing publishes. English listing + English
> store admin is what made the E-4 plan-page check pass first try (no 404, no
> private-plan fallback needed).

### 2.2a "Free for partners and developers" — re-verify before submitting

The demo store is in the **same Partner organisation** as the app, so it gets
every plan at $0 regardless of that checkbox. The observed `$0 / Free to test`
card therefore proves same-org behaviour, **not** the checkbox state. **An app
reviewer's store is a DIFFERENT organisation**, and there the checkbox is the
only thing standing between the reviewer and a real US$29 charge — which is a
rejection, not an inconvenience. 06-08's pre-submission checklist must open the
plan and confirm the box is ticked explicitly.

### 2.3 What to say about billing in the reviewer notes

- There is exactly **one plan**; upgrade/downgrade paths do not exist, so
  requirement 1.2.3's plan-change rules are satisfied vacuously.
- Cancellation is handled natively by Shopify App Pricing from the store's app
  charges page — the app contains **zero billing code** and no cancel UI.
- The plan is marked free for partner and development stores, so a reviewer on
  their own dev store selects it at **$0**.

---

## 3. `read_all_orders` justification (requirement 3.2.1)

Paste into the protected-data / scope justification field:

```
Credit Guard's entire function is a company's outstanding net-terms balance. Shopify's default order query returns only the last 60 days, so any unpaid invoice older than that would be silently excluded — and an understated balance is worse than no balance at all: it would let a company that is genuinely over its credit limit pass the checkout credit hold. read_all_orders is used only to read order totals, financial status and payment schedules during the initial backfill and the reconciliation sweep, so that every open net-terms invoice counts toward exposure regardless of age. The app does not read, store or transmit customer names, email addresses or contact details, and it does not request read_customers.
```

Note for the form: **the access request for `read_all_orders` is already
granted** for this app (protected customer data, Level 1). Applying for
protected customer data is not possible while an app is under review, so nothing
further is submitted here — the justification is informational.

---

## 4. Testing instructions and reviewer access (4.5.3 / 4.5.4 / 4.5.5)

> **Fill in the bracketed values at submission time. Do not write credentials
> into this repository.** Every `[…]` below is a placeholder for a value that
> lives only in the Partner Dashboard form.

### 4.0 Before you paste these instructions — one-time staging (developer)

1. In `credit-guard-demo` admin → **Customers → Companies**, create a company
   named **Reviewer Test Co** with a location on **Net 30** terms and **add a
   company contact whose mailbox you control**. The B2B customer-account login
   is a one-time code emailed to a company contact, so a contact at an address
   you cannot read is a login you cannot demonstrate.

   **Not because the existing companies are unreachable — they aren't.** Acme
   Supply's contact is a live iCloud address that receives mail today (a
   delivered OVERDUE reminder for order #1014 was read from that mailbox on
   2026-08-22). The reason for a dedicated company is **credential hygiene**:
   the login you hand to an app reviewer should be one you can revoke without
   touching the fixtures the screenshots and the demo store depend on.
2. Create one net-terms order for that company (draft order → payment terms Net
   30 → complete), so it has a balance the moment a reviewer looks.
3. In Credit Guard → **Companies**, set **Reviewer Test Co**'s credit limit
   *below* its outstanding balance, so it is already **on credit hold** when the
   reviewer arrives, and confirm its bypass toggle is **off**.
4. Confirm the storefront password and note it for the form.
5. Confirm **Payment reminders** are turned on in Settings if you want the
   reminder activity table populated in the reviewer's screenshots.
6. **Do not ask a reviewer to pay an invoice, and do not script a payment into
   the screencast.** On `credit-guard-demo` the order-payment page for a
   net-terms order answers **"This store can't accept payments right now."** —
   verbatim, and *still* with Shopify's "(for testing) Bogus Gateway"
   activated (verified 2026-08-22, §8). Nothing in the reviewer instructions or
   the screencast may depend on a payment completing on a development store.
   The paid-off path is demonstrable only on a store with a real gateway.

### 4.1 Access fields

| Field | What to enter |
|---|---|
| Demo store URL | `credit-guard-demo.myshopify.com` |
| Storefront password | `[storefront password]` |
| Staff / collaborator access | `[the invitation you sent, or the staff account you created for review]` |
| B2B buyer login | `[the Reviewer Test Co contact email you created in §4.0]` — one-time code, no password |
| Where the code arrives | `[mailbox you monitor]` — say plainly that you will forward the code on request if the reviewer cannot receive it |

### 4.2 Track A — the demo store (fastest; everything is already staged)

Paste as-is, then fill the brackets:

```
TRACK A — our demo store (5 minutes, everything is pre-loaded)

Store: credit-guard-demo.myshopify.com
Storefront password: [password]
Admin access: [collaborator/staff invitation details]

1. Open the store admin, then Apps > Credit Guard: B2B Net Terms.
2. The home page is the accounts-receivable dashboard. Note the tiles:
   total outstanding, overdue companies, companies on credit hold, and
   what is due in the next 7 days.
3. Open Companies. "Reviewer Test Co" shows an outstanding balance, a
   credit limit lower than that balance, and an "On credit hold" badge.
4. Open the storefront in a private window, enter the storefront password,
   and log in to the customer account with [B2B contact email]. Shopify
   emails a one-time code to that address; ask us and we will forward it
   within one business day if you cannot receive it.
5. Add any product to the cart and go to checkout as that company.
6. At checkout the net-terms payment option is refused with the message
   "Your company has reached its credit limit with us. To place this
   order, please contact us or settle open invoices to free up available
   credit." **Correction 2026-09-05 (WINDOWS #29): the sentence that stood
   here — "Prepaying by card is deliberately still allowed" — is false; the
   hold applies to the whole checkout of that company. Edit the Partner
   Dashboard testing notes to match.**
7. Back in the admin, in Credit Guard > Companies, turn ON the bypass
   toggle for Reviewer Test Co.
8. Retry the checkout. It now completes on net terms.
9. Return to the app home page. The order that went through during the
   hold is listed under "Credit holds and bypasses", together with the
   hold and bypass events.
10. Settings shows the two checkout messages (both editable) and the
    payment-reminder switch.
```

### 4.3 Track B — the reviewer's own development store

```
TRACK B — set up on your own development store (about 15 minutes)

Credit Guard reads Shopify's native B2B objects, so a store needs at least
one company with payment terms before there is anything to show. On a fresh
development store:

1. Install Credit Guard. On install it imports your existing net-terms
   orders; the home page tells you while that is still running.
2. Admin > Customers > Companies > Create company. Add a location and set
   its payment terms to Net 30. Add a company contact.
3. Admin > Orders > Create order (draft). Add a product, assign the order
   to that company, choose the Net 30 payment terms, and complete it as a
   payment-terms order. That gives the company an outstanding balance.
4. Open Credit Guard. The company and its balance appear on the dashboard
   and in Companies (within seconds — the order webhook drives it).
5. In Companies, set that company's credit limit BELOW its outstanding
   balance and save. The badge changes to "On credit hold".
6. Log in to the storefront customer account as that company contact
   (Shopify emails a one-time code), add a product, and attempt checkout
   on net terms. Checkout refuses the net-terms option with the message
   shown in Credit Guard > Settings.
7. Turn ON the bypass toggle for that company in Credit Guard > Companies
   and retry: the order now completes.

Billing: there is a single plan (US$29/month, 14-day free trial). It is
marked free for partner and development stores, so selecting it on your
development store creates a $0 subscription. Cancellation is handled by
Shopify from the store's app charges page; the app has no billing code and
no cancellation screen of its own.

Scope of enforcement, stated plainly: the checkout credit hold applies to
net-terms checkouts. An order completed from a draft order in the admin, or
placed while a company's bypass toggle is on, is not checked — but it is
still counted against the company's balance and listed on the dashboard
under "Credit holds and bypasses" so the merchant can see it happened.

Payment reminders: the app never sends email itself. It asks Shopify to send
Shopify's own "Payment reminder" notification, from your store's sending
address, using your notification template. Version 1 chases only net-terms
orders that are attributed to a company. Reminders are OFF until a merchant
turns them on in Settings.
```

### 4.4 Emergency and API contact fields (names only — fill at submission)

| Field | Value to supply |
|---|---|
| Emergency developer contact — name | `[full name]` |
| Emergency developer contact — email | `[email; must not contain "shopify"]` |
| Emergency developer contact — phone | `[phone with country code]` |
| API contact email | `[email; must not contain "shopify"]` |
| Listing contact email (reviewer correspondence lands here) | `[email]` — allow-list `noreply@shopify.com` before submitting |

---

## 5. Screenshots (3–6 required; 5 planned)

Specification for every shot: **1600 × 900 px, 16:9, PNG**, browser chrome
cropped out, **no PII**, **no pricing**, **no reviews**, **no outcome
guarantees**, one focal point each. Capture at a browser width that renders the
embedded admin at full width, then crop to 1600×900.

| # | Shot | Fixture state needed | Alt text |
|---|---|---|---|
| S1 | **Dashboard, populated** — the four KPI tiles, the setup guide at 2 of 3 complete, and the top of "Overdue companies" | ≥1 overdue company, ≥1 company on credit hold, setup guide not yet dismissed (`onboardingDismissedAt` null, one step outstanding). **⚠ No longer capturable on `credit-guard-demo`** — the guide was completed and dismissed there on 2026-08-22T07:56:08Z and dismissal is deliberately irreversible in the UI (BFS 4.2.2 #6). **Use a second, fresh development store** (§8) — **done: shot on `credit-guard-demo-2`, §9.4** | "Credit Guard dashboard showing total outstanding, overdue companies and companies on credit hold" |
| S2 | **Companies table** — balances, credit limits, utilisation and the "On credit hold" / "Enforcement bypassed" badges | at least one company of each badge state; limits set | "Company list with outstanding balances, credit limits and credit-hold badges" |
| S3 | **Settings → checkout messages** — the two editable messages (over-limit and overdue) and the checkout-rule status | validation registered and enabled | "Settings page showing the two editable checkout messages a buyer sees" |
| S4 | **Storefront checkout showing the credit-hold message** — the buyer's view when the net-terms option is refused | a company on credit hold with a reachable buyer login (§4.0). **Both message variants are now proven live** (§8): over-limit via Northwind, overdue-only via the Acme recipe (bypass **off**, limit **above** exposure — restore both afterwards) | "Checkout showing the merchant's message when a company is over its credit limit" |
| S5 | **Payment reminders** — the dashboard reminder activity table with sent rows, or Settings' reminder card with the cadence sentence | reminders enabled; ≥2 `SENT` rows | "Payment reminder activity showing when each company was reminded" |

**Before uploading, check each shot for:** company names that belong to a real
merchant, any email address, any order that identifies a person, and the
Shopify admin's own account menu. Rename demo companies if any of them read as a
real business.

**App icon (separate asset):** 1200 × 1200 px, JPEG or PNG, square with padding,
no text, no screenshots, no Shopify marks.

**Feature media:** either the screencast below (2–3 minutes, screencast limited
to 25% of the video) or one 1600 × 900 feature image with a single focal point
and 4.5:1 contrast. If you ship only one asset, ship the video.

---

## 6. Screencast script (2–4 minutes, English)

Requirement 4.5.3: demonstrate onboarding **and** the features as described in
the listing, with clear step-by-step narration, in English or with English
subtitles. Record at 1600×900 or larger. **Show no pricing.**

| # | Beat | On screen | Narration (say roughly this) |
|---|---|---|---|
| 0 | 0:00–0:12 | App home, freshly installed | "This is Credit Guard. It gives a B2B merchant credit control over customers who buy on net terms — something Shopify records but doesn't enforce." |
| 1 | 0:12–0:30 | Install → the guided setup at 0 of 3, balances importing banner | "On install it imports your existing net-terms orders. The guide has three steps: review your balances, set your first credit limit, and confirm enforcement is on." |
| 2 | 0:30–0:50 | Dashboard tiles and the overdue table | "Here's what every company owes: total outstanding, which companies are overdue, which are on credit hold, and what's due in the next seven days. Every number comes from your own orders." |
| 3 | 0:50–1:05 | Companies table | "Companies come from Shopify's native B2B objects. Each one shows its balance and, once you set one, its credit limit." |
| 4 | 1:05–1:20 | Set a limit below the balance; badge flips | "I'll give this company a limit below what it currently owes. It goes straight on credit hold." |
| 5 | 1:20–1:45 | Storefront checkout as that company's buyer; net-terms option refused with the merchant's message | "Now the buyer. At checkout, the net-terms option is refused with the message the merchant wrote. Paying by card is still allowed — we stop the credit, not the sale." |
| 6 | 1:45–2:05 | A **second** company that is **overdue but under its limit** goes on hold; show its different message | "A company doesn't have to be over its limit. This one is inside its limit but has an overdue invoice, so it's on hold too — with the overdue message." |
| 7 | 2:05–2:20 | Bypass toggle on; retry checkout; it completes | "When you want to let one order through, flip bypass for that company. The order completes." |
| 8 | 2:20–2:35 | Dashboard "Credit holds and bypasses" showing that order | "The app records that the order went through during a hold, so nothing slips past you quietly. Orders completed from a draft aren't checked either — they're listed here too." |
| 9 | 2:35–2:55 | Settings → turn payment reminders on; read the cadence line | "Reminders are off until you turn them on. When you do, Shopify sends its own payment reminder from your store's address — 3 days before the due date, on the due date, and 3 days after." |
| 10 | 2:55–3:10 | Dashboard reminder activity table | "And every reminder shows up here: when it went, which company, which order, and which of the three moments it was." |
| 11 | 3:10–3:20 | Dashboard at 3 of 3, press "Done" | "Once setup is done, the guide gets out of the way and the page is just your receivables." |

**Beat 6 is the #13 check, and it is now PROVEN LIVE** (2026-08-22, §8) —
it is no longer a claim being staged for the first time on camera. To re-stage
it for the recording: Acme Supply, bypass **off**, credit limit **6000**
(above its `5345.80` exposure, so only overdueness can be holding it), then
restore **limit → cleared** and **bypass → on** the moment the beat is in the
can. The buyer sees exactly this, verbatim — narrate it, don't paraphrase it:

> Your account has overdue invoices. New orders on payment terms are paused
> until the balance is settled — please contact us to arrange payment.

**Beat 9/10 need reminders switched on first** (`remindersEnabledAt` is `null`
on the demo store). **No beat may show an invoice being paid** — see §4.0 item 6.

---

## 7. Pre-submission checklist

### 7.1 Automated checks (run them in the Partner Dashboard review page)

- [ ] App URLs contain no "Shopify" — app URL, support URL, contact emails.
- [ ] Mandatory compliance webhooks declared (`customers/data_request`,
      `customers/redact`, `shop/redact`) — already in `shopify.app.toml`.
- [ ] Latest App Bridge loaded from the CDN (via `AppProvider`; unversioned URL).
- [ ] Privacy policy URL resolves: `https://app.creditguardhq.com/privacy`.
- [ ] App icon 1200×1200; 3–6 screenshots at 1600×900.
- [ ] Emergency developer contact (email **and** phone) filled.
- [ ] Pricing plan created and visible before submission.

### 7.2 Common rejection reasons, mapped

| Reason | Our exposure | What closes it |
|---|---|---|
| Pricing in the listing doesn't match what's charged | Single plan, no tiers | The plan card and §2 say the same thing: US$29/month, 14-day trial |
| Reviewer can't select the plan | Reviewer's store is in a different Partner org | "Free for partners and developers" ticked; stated in the reviewer notes |
| Install fails / no immediate OAuth redirect | Managed installation | Re-run uninstall → reinstall on the demo store before submitting |
| App flips between embedded and non-embedded | Only the error boundary renders non-embedded | The billing gate fails **open**, so a billing error can never throw into it |
| 404 / 500 / broken UI | New dashboard + gate | Full suite green; open the app in incognito once before submitting |
| No testing instructions / credentials / screencast | The B2B-specific risk: a fresh store has no companies | §4's two tracks + the buyer login staged in §4.0 |
| Untruthful listing (4.3) / falsified data (1.1) | Any dollar total of stopped orders, or any delivery claim | The vocabulary rules at the top of this document |
| Review solicitation (1.3.1) | In-app Reviews API prompt | Neutral language, no incentive, never wired to a button — it fires once after a genuine success moment |

### 7.3 Policy constraints to keep true after launch

- **1.3.1** — asking for reviews must use neutral language; incentives and
  feature-withholding are forbidden. The app uses Shopify's own Reviews API
  modal; the app writes none of that copy.
- **4.3** — the listing must stay truthful as the app changes. If the reminder
  cadence, the company-only reminder scope, or the enforcement scope ever
  changes, §1.4 and §4.3's scope paragraph change in the same release.

---

## 8. What the live drive changed (06-07, 2026-08-22)

The whole listing was drafted before the deployed build had been driven on a
real store. It has now been driven end to end on `credit-guard-demo` (plan
06-07). Four facts below alter what can be photographed, narrated or promised;
everything else in this document survived the drive unchanged.

| # | Live fact | What it changes here |
|---|---|---|
| L1 | The **overdue-only** credit hold works at a real checkout — a company inside its limit but with an overdue invoice is refused with the overdue message, verbatim as shipped (`BLOCK_STATE_ENTERED`, `overdue: true`, `exposure 5345.80 < limit 6000`, `bypass false`, 2026-08-22T07:56:59Z) | §6 beat 6 is now a demonstration, not a first attempt; §5 S4 has a proven recipe for both message variants |
| L2 | The demo store **cannot take a payment**: the order-payment page for net-terms order #1015 answers **"This store can't accept payments right now."** even with the Bogus Gateway activated | §4.0 item 6 — no reviewer instruction and no screencast beat may depend on an invoice being paid |
| L3 | The **guided setup is dismissed** on `credit-guard-demo` (`onboardingReviewedAt` 07:55:33Z, `onboardingDismissedAt` 07:56:08Z) and dismissal is irreversible by design | §5 S1 cannot be shot on this store — see the recommendation below |
| L4 | The **review prompt has fired** on this store (`reviewPromptedAt` 2026-08-22T07:16:54Z; the developer saw Shopify's modal and submitted a rating) and correctly never re-asked on any later open, desktop or phone | Nothing in the listing changes; it is the 1.3.1 evidence behind §7.2's last row — the prompt fires once, off a genuine success moment, with no copy of ours |

### Shooting S1 — use a second development store (recommended)

The hero screenshot wants the setup guide **visible at 2 of 3**, and that state
no longer exists on `credit-guard-demo`. Two ways to get it back:

1. **Create a second development store, install the app, and shoot S1 there
   while the guide is still live.** ✅ Recommended. A fresh install reproduces
   the exact state a new merchant sees, needs no production write, and leaves
   the demo store — the one a reviewer will open — untouched.
2. Reset `onboardingReviewedAt` / `onboardingDismissedAt` to `null` for this
   shop with an audited one-row update inside the container. ❌ Not recommended:
   it is a write to production data for a cosmetic reason, it falsifies the
   demo store's own history, and the ad-hoc in-container script transport is
   denied by the execution sandbox in any case (06-06). Only worth revisiting
   if a second store cannot be staged in time.

Shot S1 needs the second store to have companies with balances, so stage it the
way §4.0 stages Reviewer Test Co: one company, one net-terms order, one limit.

---

## 9. What the Partner Dashboard actually asked for (2026-08-23 session)

§§1–8 were drafted from the documented requirements. The live form asked for
five things the package did not carry, and refused two things it did. This
section is the reconciliation, written during the listing session so the record
matches what a reviewer will see.

### 9.1 Required fields the package was missing

| Field | Value entered | Note |
|---|---|---|
| **App card subtitle** | `Credit limits and checkout holds for B2B net-terms customers` | `[60 chars]`. A separate, shorter field from §1.2's introduction — it renders on the app card in search results. Same honesty rules: no outcome claim, no dollar figure. |
| **Sales channel requirements** | **Requires Shopify Online Store** | The buyer-facing half of the app is a storefront checkout, so a store with no online sales channel cannot exercise the credit hold. |
| **Screenshot alt text** | ≤ 64 characters each (see 9.2) | The form caps alt text well below the descriptive alts drafted in §5; those are now the long-form intent, and 9.2 holds the strings that fit. |
| **Staff/collaborator access wording** | `Request collaborator access to credit-guard-demo.myshopify.com from the Partner Dashboard and we approve within one business day.` | §4.1 assumed an invitation could be pre-sent to a named reviewer. It cannot — the reviewer is unknown at submission time, so the instruction has to be a request-and-approve loop. |
| **App capabilities** | **Embedded app only** | The "Checkout UI extension" capability was ticked and then **corrected to unticked**: Credit Guard ships a *Cart and Checkout Validation Function*, which is server-side logic, not a checkout UI surface. Claiming a capability the app does not ship is a 4.3 truthfulness problem, not a formality. |
| **Test account requirement** | **"My app doesn't require an account"** — ticked | Correct: Credit Guard has no login of its own. Admin access is Shopify's; the B2B buyer login is Shopify's customer account. Ticking "requires an account" would promise credentials the app does not issue. |

### 9.2 Screenshot alt text as entered (≤ 64 characters)

```
S1  Credit Guard dashboard: outstanding, overdue and on-hold tiles
S2  Company list with balances, credit limits and hold badges
S3  Settings page with the two editable checkout messages
S4  Checkout refusing net terms with the merchant's message
S5  Reminder activity showing when each company was chased
```

Counts: `62`, `57`, `53`, `55`, `54` — all ≤ 64.

### 9.3 What the form refused

| Package item | What the form allowed | Resolution |
|---|---|---|
| §1.4 — **six** feature bullets | **Five** | Dropped *"Works with Shopify's native B2B companies and payment terms"* — and for a better reason than the one predicted here: **it contains the word "Shopify", which requirement 4.5.6 forbids in listing copy.** The same bullet was independently the weakest (it restated §1.6's structured "Works with" field). |
| §1.6 — primary category *Wholesale and B2B* | Not offered | Fell back to **Finances → Other**, the fallback §1.6 already named. |
| §2.2 — plan top-features | A field exists after all, capped at **40 characters** | Rewritten to fit and entered: `Checkout hold when over limit or overdue` `[40]` and `Reminders before, on and after due date` `[39]`. Neither names Shopify (4.5.6); both restate claims already proven in §1.4. |

### 9.4 Assets as produced

| Asset | File | Dimensions | Spec |
|---|---|---|---|
| App icon | `credit-guard-icon-main.png` (source: `credit-guard-icon-original.png`) | 1200 × 1200 | ✅ square, padded, no text |
| Screenshot 1 — `credit-guard-demo-2` dashboard + guided setup at "All set" | `screenshots/S1.png` | 1600 × 900 | ⚠ see 9.4a |
| Screenshot 2 — Companies table, all four badge states | `screenshots/S2.png` | 1600 × 900 | ✅ matches §5 S2 exactly |
| Screenshot 3 — Settings: both checkout messages + reminder card | `screenshots/S3.png` | 1600 × 900 | ✅ matches §5 S3 exactly |
| Screenshot 4 — `credit-guard-demo` dashboard: credit-hold banner, KPIs, overdue, due-in-30, closest-to-limit | `screenshots/S4.png` | 1600 × 900 | ⚠ **not** §5's S4 — see 9.4a |
| Screenshot 5 — credit-holds feed + reminder activity (6 Sent) | `screenshots/S5.png` | 1600 × 900 | ✅ covers §5 S5 |
| Feature media | the screenshots/feature image | — | **No screencast** — see 9.6 |

### 9.4a Where the five shots differ from §5's plan

Audited image by image on 2026-08-23 before upload. **Every compliance rule
holds**: five shots (3–6 required), all exactly 1600 × 900, browser chrome
cropped, no PII (all company names are fixtures), no email addresses, no
pricing, no reviews, no outcome claims, no admin account menu. Two *content*
departures are recorded because they change what a reviewer can see:

| Departure | Detail | Consequence |
|---|---|---|
| **The buyer-facing credit hold is not illustrated.** §5's S4 was to be the storefront checkout refusing the net-terms option. The shot in that slot is a second dashboard view instead. | Combined with 9.6 (no screencast), **the app's headline claim — bullet 2 of §1.4 — has no visual evidence anywhere in the listing.** A reviewer's only route to it is following Track A or Track B by hand. | The single largest reviewer-experience risk in the submission. Cheap to close: Reviewer Test Co is on credit hold right now (841.65 outstanding / 500.00 limit) with a contact mailbox the developer controls — one storefront login and one checkout attempt is the shot. |
| **The hero is an empty dashboard carrying the incompleteness banner.** Screenshot 1 shows `credit-guard-demo-2` with `$0.00` outstanding, `0` overdue, `0` on credit hold, "No overdue companies", and the "Some balances may be incomplete" banner — it was taken *before* the attribution heal converged that store at 10:52Z. | Truthful, but it is the weakest possible first impression, and the banner's "A few net-terms orders couldn't be matched to a company yet" can read to a reviewer as a defect rather than as the honesty feature it is. | Also cheap to close: that store is now `dataComplete: true` with Snowdevil at `973.75` against a `900.00` limit, so a re-shoot today yields a populated dashboard, no banner, and the guided setup still undismissed (`onboardingDismissedAt` is null there). |

A third, cosmetic note: in screenshot 1 the setup guide's third step renders its
completion tick on its own line above the heading "Enforcement is on", where
steps 1 and 2 render tick and heading inline. Not a rejection reason; logged for
a later fix.

**S1 was shot on a second development store, `credit-guard-demo-2`** (§8's
recommended path), not by resetting production stamps. It shows the guide at
**3 of 3 rather than 2 of 3**: setting the first credit limit completed steps 2
and 3 in one action, because registering the validation is what step 3 reads.
That is the app behaving correctly, not a staging error — and a completed guide
with its **Done** affordance visible is arguably the better BFS 4.2.2 evidence,
since the requirement being satisfied is *"onboarding UI can be removed once
complete"*.

### 9.5 Support URL — resolved as B1

`https://creditguardhq.com/support` was found on 2026-08-22 to redirect to
`https://credit-guard-demo.myshopify.com/password`: the apex domain is attached
to the demo store, so every path under it lands on the storefront password wall.
`https://app.creditguardhq.com/support` is a 404. **Resolution: the support URL
field is left per option B1** — support is the email address alone
(`support@creditguardhq.com`), which resolves and is monitored. A static support
page on the apex is a post-submission item, not a blocker. §1.9's "must resolve
before submission" is satisfied by not shipping a link that cannot.

**Update 2026-09-04 — B2 shipped.** After approval, a public unauthenticated
`GET /support` page (FAQ + contact, same pattern as `/privacy`) was added in
commit b4c7dbe and deployed; `https://app.creditguardhq.com/support` answers
200. The listing's Support URL field can now be filled with it. The apex itself
still points at the demo store; serving the page from `creditguardhq.com`
needs a DNS decision (Squarespace DNS has no CNAME flattening, so the root
cannot CNAME to Railway — root forwarding or a `help.` subdomain instead).

### 9.6 The screencast — recorded after all, 4.5.3 satisfied

The go/no-go was presented on the basis that the screencast was skipped and
that requirement 4.5.3 would be knowingly waived. **The Partner Dashboard
settled it instead: the App testing information section requires a screencast
URL**, so one was recorded to §6's beat list and uploaded unlisted.

**4.5.3 is therefore satisfied, not waived**, and the compensating argument in
this section's earlier draft is moot. What stood in for it — Track A's
pre-staged demo store, Track B's from-zero setup, and five screenshots — now
supplements it rather than substituting for it.

The lesson worth keeping: the form was the authority on what was mandatory, and
it disagreed with both the drafted package and the research. Three of the five
fields in 9.1 and this requirement were all discovered the same way — by opening
the form, not by reading about it.

### 9.7 Live facts since §8

| # | Live fact | What it changes |
|---|---|---|
| L5 | **Order/company ingest latency was root-caused and fixed** (`06-DEBUG-ingest-latency.md`): attribution was attempted once at the first webhook and, if Shopify had not yet indexed the order on the company edge, never retried until the daily 03:30Z reconciliation. Fix: re-attribution on later doorbells plus a 5-minute `attribution-heal` sweep on its own lease. | **§4.3 Track B was failing deterministically** — a reviewer creating a company and a net-terms order would have seen nothing appear "within seconds" as promised, for hours. Track B's step 4 is now truthful. Proven on `credit-guard-demo-2`: `attributed 0 / unresolved 2 / dataComplete false` → `attributed 2 / unresolved 0 / dataComplete true` at 10:52Z, unattended. |
| L6 | **WINDOWS #10 closed live.** The 2026-08-23T03:30Z reconciliation — the first tick on the fixed code — flipped `credit-guard-demo` to `attributed 15 / unresolved 0 / noCompany 2`, `dataComplete: true`. | §5's caveat that every screenshot would carry the *"Some balances may be incomplete"* banner is **void for `credit-guard-demo`** — screenshots 2–5 are clean. Screenshot 1 still carries it, because it was taken on `credit-guard-demo-2` before that store's own heal converged (9.4a). |
| L7 | **Reminders were switched ON on `credit-guard-demo`** at 2026-08-23T05:37:37Z and left on, so the reviewer's Track A sees a populated reminder activity table (§4.0 item 5). | No email blast followed: `ReminderLog` went 12 → 18 rows, and all six new rows are `SUPPRESSED_PREEXISTING`. Six `SENT` rows total, unchanged. |
| L8 | **Reviewer Test Co is staged and on credit hold**: exposure `841.65`, credit limit `500.00`, bypass off, not overdue — an *over-limit* hold, order #1017. | §4.2 Track A step 3 is live-true as written. |

---

## 10. As submitted — 2026-08-24

**Credit Guard: B2B Net Terms was submitted for Shopify App Store review on
2026-08-24** (reported immediately after the developer clicked Submit; the exact
minute was not recorded). This section is the record of what went in.

### 10.1 Submission record

| Field | Value |
|---|---|
| Submitted | **2026-08-24** |
| App | Credit Guard: B2B Net Terms (handle `credit-guard-net-terms`) |
| Build under review | `f1032f0` — deployed to Railway and smoke-verified; production and the branch tip are the same code |
| Suite at submission | **838 passing / 28 files** |
| Demo store | `credit-guard-demo.myshopify.com` (`dataComplete: true`, reminders on, Reviewer Test Co on credit hold) |
| Plan | one plan, US$29/month, 14-day free trial, free for partner and development stores (verified) |
| Privacy policy | `https://app.creditguardhq.com/privacy` (200) |
| Support | `support@creditguardhq.com`; no support URL shipped (§9.5) |
| Feature media | 5 screenshots (1600 × 900), 1200 × 1200 icon, unlisted screencast |
| Automated checks | green |
| AI self-review | 26 ✅ / 0 ❌ / 5 ⚠️ / 71 skipped — `06-APP-STORE-SELF-REVIEW.md` |

### 10.2 The last two changes before Submit

1. **Screenshots 1 and 4 were retaken** (commit `57fb1a4`), closing both gaps
   raised at the go/no-go. Screenshot 1 is now `credit-guard-demo-2` with real
   data — `$973.75` outstanding, one company on credit hold, no incompleteness
   banner, guided setup visible with its Done affordance. Screenshot 4 now shows
   an actual credit-hold refusal.
2. **The template landing page was replaced** (commit `f1032f0`). The AI
   self-review found that bare `/` still served the Shopify template's
   placeholder marketing page *and a shop-domain login form* — a 1.1.4 / 2.3.1
   finding, and the only ❌-class problem the whole review surfaced. It is now a
   factual static page with no shop input, covered by `tests/landing-route.test.ts`
   and verified live by `curl` after deploy.

### 10.3 ⚠ Screenshot 4 carries customer PII — fix this first

**Found by this executor at 12:30Z on 2026-08-24, after submission.** The
retaken screenshot 4 is the admin's draft-order *"Unresolved business rules"*
modal — which does evidence the credit hold — but the page behind the modal is a
live draft order, and its right-hand panel is legible:

- a customer name and a customer email address
- a full street address and a phone number
- the staff member's name in the page header

This violates §5's own rule ("no PII"), Shopify's screenshot guidance ("crop out
browser chrome and sensitive information… avoid PII"), and the posture the app
has held since Phase 2 — that it touches no customer contact data at all.

| Where it exists | State | Action |
|---|---|---|
| **The live App Store listing** | **Uncropped image is public-facing and in front of the reviewer now** | **Replace it in the Partner Dashboard immediately.** Either re-shoot the storefront checkout refusal (§5 S4's original intent, and the stronger asset), or re-shoot the same modal with the customer panel scrolled out of frame. |
| Working tree | **Redacted** — cropped to the modal alone (commit `1ee6b34`) | done |
| Git history | Uncropped image remains at `57fb1a4` | Repo is private; left for the orchestrator to decide whether it is worth a rewrite |

The listing replacement is the single highest-priority post-submission action —
above everything in the waiting list below. Editing screenshots during review is
permitted and is far cheaper than a reviewer citing PII.

### 10.4 Expected timeline

Official guidance in reviewer emails is "up to 2 weeks"; community reports in
2026 describe 3+ weeks before a reviewer is even assigned; older guidance said
5–10 business days (06-RESEARCH A9, `[ASSUMED — community sources only]`).

**Plan for 10–15 business days plus one resubmission round.** Every failed round
forces a full resubmit, and consecutive failures after two exchanges can trigger
a temporary submission suspension — which is why the go/no-go spent its budget
on removing rejection reasons rather than on speed.

Reviewer correspondence arrives at the **listing contact email**, with
`noreply@shopify.com` allow-listed.

### 10.5 While waiting

| # | Item | Why now |
|---|---|---|
| 1 | **Replace screenshot 4** (10.3) | PII, public, in front of a reviewer |
| 2 | **A real support page** (§9.5 option B2) | Support is email-only today; a static page on the apex or a `help.` subdomain removes the weakest listing field |
| 3 | **WINDOWS #18 / #19 — a launch store with a real gateway** | A development store refuses to transact even with the Bogus Gateway, so "reminder → pay-now → balance drops" is the one loop never demonstrated end to end. Both close on the first paid store; #19 also wants normal-latency delivery confirmed (dev-store reminders arrived 3.5–5 h late) |
| 4 | **WINDOWS #11 — EC-1 decimal capture** | Optional. Read `cart.cost.totalAmount` from a real Function run in the Partner Dashboard. Behaviourally proven already; `cartCents` normalises either way |
| 5 | **06-07 F2 — persist the review-prompt result code** | Today the app can prove it *asked* and never re-asked, but not whether the modal was *shown*. A nullable column, its own small plan |
| 6 | **`@shopify/shopify-app-react-router` 2.x** | Deferred to v1.1 deliberately: Node 22 image, and 2.0 removes the `AppProvider embedded` prop `app.tsx` uses. Not worth touching a build under review |
| 7 | **First production install** | Confirm reminder delivery at normal latency and the billing gate on a store outside our Partner org — the two behaviours a same-org dev store structurally cannot prove |
| 8 | **Watch Sentry** for billing-check fail-open captures | The gate fails open by design; a burst means Shopify's billing API, not our logic |
| 9 | **Two test flakes** | `tests/reminders.test.ts` "only ONE schedule per sweep" is order-dependent on a reused DB (fails on a pristine tree too); `tests/review-prompt.test.ts` "ask after a success moment" exceeded its 5 s timeout under parallel load, green in isolation. Neither is a product defect; both want a fixture-isolation pass |
| 10 | **Mobile KPI row gap** | Fixed, then reverted at the developer's request (`d1f60ce`) — the defect persisted on both devices and was judged low priority. All five listing screenshots are desktop, so nothing shipped with it |
