# Phase 5: Payment Reminders - Research

**Researched:** 2026-08-20
**Domain:** Dunning emails for Shopify B2B net-terms orders — recipient resolution, pay-now links, scheduling, idempotence, deliverability
**Confidence:** HIGH on the Admin API surface (byte-verified local 2026-07 schema + live shopify.dev mutation docs); MEDIUM on the exact behavior of Shopify's reminder email (content/plan-gating — flagged for one dev-store empirical pass before the send path ships)

> **Requirement numbering note:** This file uses `.planning/REQUIREMENTS.md` as canonical:
> **REMD-01** = due−3/due/overdue touchpoints, idempotent via email log, stops on payment; **REMD-02** = pay-now link; **REMD-03** = app-owned authenticated sending domain (SPF/DKIM/DMARC), merchant branding, Reply-To. (The phase brief circulated a different 01/02/03 split; the IDs below follow REQUIREMENTS.md.)

## Summary

The phase's assumed architecture — app fetches the buyer's email, renders a react-email template, and sends it through Resend from `creditguardhq.com` — collides with two hard walls and turns out to be unnecessary. Wall one: **there is no email address available to this app.** `CompanyContact` carries no email or name fields at all (byte-verified: its only person-shaped edge is `customer: Customer!`, which needs the deliberately-excluded `read_customers`), and `Order.email` is a **Level 2 protected-customer-data field** — Partner-Dashboard field-level approval plus encrypted backups, access logs, DLP, incident-response policy, and a rewrite of PRIVACY.md §2/§3, whose "we store no customer emails" posture is currently a selling point and a review asset. Wall two: even the pay-now link is contaminated — `Order.statusPageUrl` is itself PCD-Level-2 gated per Shopify's changelog, and no PaymentTerms/PaymentSchedule field carries an invoice URL (byte-verified field lists below).

The platform already solved this. The Admin API 2026-07 schema contains **`paymentReminderSend(paymentScheduleId: ID!)`** — "Sends an email payment reminder for a payment schedule." Shopify resolves the recipient server-side (the B2B company's **main contact**, per the Shopify Flow "Send payment reminder" action doc), sends the shop's own customizable "Payment reminder" notification template **containing a pay-now link**, from the shop's own authenticated sender. The app supplies only the schedule GID — which Phase 2 already stores in `LedgerSchedule.scheduleGid` for every net-terms order. Requires one new scope, `write_orders` (verified on live 2026-07 docs), and zero PII ever touches the app. Shopify also ships *native* scheduled reminders (Settings → Notifications, up to five) — but those fire only **on the due date or 1–30 days after**; the pre-due "due−3" touchpoint, per-company credit context, the exactly-once email log, and the unified AR story remain Credit Guard's differentiation.

**Primary recommendation:** Architecture A — a third hourly sweep (own lease, existing `SWEEP_SCHEDULE` registry) walks `LedgerSchedule` rows crossing due−3d / due / due+3d thresholds, claims a `ReminderLog` row per (schedule × touchpoint) via unique-constraint insert (at-most-once), refetches the schedule live to confirm it is still unpaid, then calls `paymentReminderSend`. REMD-03 as written ("app-owned authenticated domain") must be **amended by the user** — Shopify's sender IS the merchant's authenticated identity, which beats an app-owned domain on both deliverability and buyer trust. That amendment is gray-area decision #1.

## Phase Requirements

<phase_requirements>

| ID | Description (REQUIREMENTS.md) | Research Support |
|----|-------------------------------|------------------|
| REMD-01 | App sends automated reminder emails at due−3 days, due date, and overdue (idempotent via email log; stops on payment) | Touchpoint thresholds computed from `LedgerSchedule.dueAt` (already ingested, indexed `@@index([shop, dueAt])`); `ReminderLog` unique constraint = idempotence; `completedAt` locally + live refetch before send = stop-on-payment; sweep runs on the Phase-2 scheduler with its own lease (§ Architecture Patterns) |
| REMD-02 | Reminder emails include a pay-now link to the order's payment page | `paymentReminderSend` sends Shopify's "Payment reminder" notification template, which embeds a pay-now link (Shopify Help + changelog); B2B buyers can also Pay now in customer accounts. App-constructed links are a PCD trap (`statusPageUrl` is Level-2 gated) — don't build one |
| REMD-03 | Emails send from an app-owned authenticated domain (SPF/DKIM/DMARC) with merchant branding and Reply-To | **Conflict surfaced:** Architecture A sends via Shopify's notification infra (merchant's own sender/branding — SPF/DKIM handled by Shopify, replies naturally go to the shop). Satisfies the intent (deliverability + branding + merchant replies), fails the letter. Needs user amendment or Architecture B (Resend + PCD Level 2). § Gray-Area Decision 1 |

</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Deciding WHEN a reminder is due (touchpoints, catch-up, suppression) | API/Backend (reminder sweep over `LedgerSchedule`) | — | Only the app knows due−3 semantics, the email log, and per-shop enablement; Shopify's native scheduler can't do pre-due |
| Resolving WHO receives it + composing/sending the email | Shopify (via `paymentReminderSend`) | — | Recipient (company main contact) and template live entirely in Shopify; app deliberately holds no customer PII |
| Pay-now link | Shopify (embedded in its reminder template + customer accounts Pay now) | — | App-side link construction requires PCD-L2 fields; Shopify's link is canonical |
| Exactly-once bookkeeping (email log) | API/Backend (Postgres `ReminderLog`) | — | Unique-constraint insert is the idempotence primitive, same discipline as `WebhookReceipt`/`EnforcementEvent` |
| Stop-on-payment | API/Backend (skip `completedAt != null`) | Shopify (refuses/soft-fails reminders for completed schedules — empirical check E3) | Local check is fast; live refetch closes the sweep-tick→send race |
| Merchant visibility ("reminder sent" feed) | API/Backend + embedded admin UI (Phase 6 dashboard reads `ReminderLog`) | — | LNCH-02's "first reminder sent" success moment reads this table |
| Reminder template branding | Merchant's Shopify admin (Settings → Notifications → Payment reminder template) | App onboarding copy pointing at it | The template is shop-owned Liquid; the app cannot and should not inject per-send copy in v1 |

## Standard Stack

### Core — **no new runtime dependencies**

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Admin GraphQL `paymentReminderSend` | API 2026-07 (mutation exists since 2023-01) | The send. One GID in, `{ success, userErrors }` out | Platform-native recipient resolution + branded template + pay link; zero PII in app [VERIFIED: local schema + live docs] |
| `node-cron` (already installed) | 4.x (in repo) | Hourly reminder sweep tick | Same scheduler the Phase-2 sweeps use; `SWEEP_SCHEDULE` registry explicitly reserves a slot: "Phase 5 appends its reminder sweep here with its OWN lease name" [VERIFIED: app/services/scheduler.server.ts:319-333] |
| Prisma (already installed) | 6.x (in repo) | `ReminderLog` model + unique-claim idempotence | Existing migration/session stack |
| `@shopify/shopify-app-react-router` unauthenticated/offline session client (already in repo) | 1.2.x | Offline-token GraphQL calls from the sweep | Same pattern the reconciliation sweep already uses |

**Installation:** none. The recommended architecture adds **zero packages** — the entire Resend/react-email row of the stack research becomes Architecture-B-only.

**New scope required:** `write_orders` (both `paymentReminderSend` and `orderInvoiceSend` list "Requires `write_orders` access scope" on live 2026-07 docs [CITED: shopify.dev/docs/api/admin-graphql/2026-07/mutations/paymentReminderSend]). Scope-change mechanics: append to the TOML `scopes` string **and** the Railway `SCOPES` variable **and** the vitest env — the TOML header warns these must stay in lockstep and two suites guard it (`tests/scope-lockstep.test.ts`, `tests/webhooks.b2b-events.test.ts`) [VERIFIED: shopify.app.toml, scopes comment block: "Keep this string in lockstep with the Railway SCOPES variable and the test env in vitest.config.ts"]. Managed installation prompts the merchant to re-consent on next app open. Keep `read_orders` in the string for explicitness even though write conventionally implies read (04-RESEARCH A4 proved the convention live for `write_validations`).

### Supporting (Architecture B fallback only — do not install unless the user picks B)

| Library | Version (npm, verified 2026-08-20) | Purpose | When to Use |
|---------|-----------------------------------|---------|-------------|
| `resend` | 6.20.0 — **not** the `^4.x` in .claude/CLAUDE.md (stale) | Send from `creditguardhq.com` | Only if user chooses app-sent emails (B) |
| `react-email` | 6.9.2 | Template preview/dev | Only with B |
| `@react-email/components` | 1.0.12 — **npm-deprecated**: "Package no longer supported." | — | **Do not use**; if B is chosen, re-research the current react-email component packaging first |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| A: `paymentReminderSend` (recommended) | B: Resend + `Order.email` | B gives full copy control per touchpoint, but costs: `read_customers` NOT needed (Order.email comes under order scopes) yet the **field** is PCD Level 2 → Partner approval + encrypted backups/access-log/DLP/incident-response obligations + PRIVACY.md §2/§3 rewrite (its "no customer emails" claim is currently load-bearing) + review friction; plus DNS/DKIM setup and deliverability ownership. ~Days of compliance work for a solo dev, and the app's cleanest differentiator (no PII) dies |
| A | C: merchant-facing digest ("3 invoices due this week — open Shopify to send reminders") sent to the merchant only | Zero customer PII and REMD-03 literally satisfiable (merchant emails are already in the Session table), but customers are no longer "automatically chased" — fails the phase goal; keep as v2 add-on, not a substitute |
| App-triggered `paymentReminderSend` | Shopify native scheduled reminders (Settings → Notifications, up to 5) | Native cannot fire before the due date (options are "on due date" or 1–30 days after [CITED: help.shopify.com deferred-payments]), has no app-visible log, and gives Credit Guard nothing to show on the dashboard. Native is the *duplicate-send risk*, not the solution (Pitfall 2) |
| `paymentReminderSend` | `orderInvoiceSend` | Invoice-send emails a checkout link too, but its `from`/`bcc` must be store/staff emails, it's order- not schedule-scoped, and semantically it (re)issues the invoice rather than reminding — wrong tool for touchpoints 2 and 3, and its EmailInput `to` override would require knowing an email we don't have |

## Package Legitimacy Audit

Recommended architecture installs nothing. Audit covers Architecture-B candidates only:

| Package | Registry | Latest publish | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `resend` | npm | 2026-08-13 (v6.20.0) | 8.4M/wk | github.com/resend/resend-node | [SUS: seam "too-new" — latest release <7d old; package itself long-established, downloads/repo healthy] | B-only; if B chosen, pin a release ≥2 weeks old and add `checkpoint:human-verify` before install |
| `react-email` | npm | 2026-08-07 (v6.9.2) | 3.1M/wk | github.com/resend/react-email | [SUS: same "too-new" signal] | B-only, same gate |
| `@react-email/components` | npm | 2026-04-09 (v1.0.12) | 4.5M/wk | github.com/resend/react-email | [SUS: **deprecated** on npm] | REMOVED from any recommendation |

**Packages removed due to verdict:** `@react-email/components` (deprecated).
**Flagged [SUS]:** `resend`, `react-email` — only relevant if Architecture B is chosen; planner must gate installs behind `checkpoint:human-verify`.

## Gray-Area Decisions for the User (planner: route these to discuss-phase)

1. **Recipient architecture + REMD-03 amendment (THE decision).** Recommend **A** (`paymentReminderSend`): app stays PII-free, PRIVACY.md stays true, pay-now link is Shopify's own, one new scope (`write_orders`). Cost: emails are the shop's "Payment reminder" template — same copy at all three touchpoints, customized only by the merchant editing their notification template; and REMD-03/ROADMAP success-criterion 4 must be rewritten to "reminders are delivered through Shopify's authenticated notification infrastructure with the merchant's own branding and sender" (arguably stronger than the original intent). Alternatives B (Resend + PCD L2) and C (merchant digest) with real costs are tabled above. **If the user insists on REMD-03 as written, this phase grows by PCD approval lead time + compliance work — surface that explicitly.**
2. **Default on or off + install-blast suppression.** A fresh install backfills months of overdue schedules; the first sweep would email every delinquent customer of the store at once. Recommend: per-shop `remindersEnabledAt` (default **off**, merchant flips it in settings — mirrors CRED-04's observe-first philosophy); on enable, touchpoints whose threshold crossed before `remindersEnabledAt` are written as `SUPPRESSED`, and only the single most-severe eligible touchpoint per schedule ever sends.
3. **Overdue touchpoint offset.** "Once overdue" needs a concrete instant. Recommend `dueAt + 72h` (gives the due-date email room to work; ledger's checkout block still flips strictly-past-due per D-04 — enforcement and dunning cadences are independent). Alternatives: strictly-past-due (same hour as the block) or merchant-set offset (that's REMD-04, v2).
4. **Timezone semantics.** Recommend instant math on `dueAt` (due−3d = `dueAt − 72h`, hourly sweep → sends land within the hour of crossing). `dueAt` is an exact timestamp Shopify computed; shop-calendar-day semantics (`Shop.ianaTimezone` exists if ever needed [VERIFIED: schema — `ianaTimezone`]) adds DST math for no merchant-visible benefit in v1.
5. **Duplicate-reminder posture.** If the merchant also configured Shopify's native reminders, buyers can get two emails. No API reads notification settings (schema sweep found only the `paymentReminderSend` family — no query surface). Recommend: settings-page copy telling the merchant to disable native payment reminders (or ours), and dev-store verification of what the native default is (E5).

## Architecture Patterns

### System Architecture Diagram

```
                     (hourly, own lease "reminder-sweep")
  node-cron tick ──► runExclusive ──► forEachActiveShop(shop)
                                            │  gate: shop.remindersEnabledAt != null
                                            ▼
                            LedgerSchedule query (indexed [shop, dueAt]):
                            completedAt IS NULL, dueAt != NULL,
                            order.cancelledAt IS NULL, order.hasPaymentTerms,
                            company ATTRIBUTED
                                            │ per schedule: compute most-severe
                                            │ eligible touchpoint (DUE_SOON/DUE/OVERDUE)
                                            ▼
                            ReminderLog claim: INSERT (shop, scheduleGid, touchpoint)
                            status=SENDING  ── unique violation? ──► already handled, skip
                                            │ claimed
                                            ▼
                            LIVE REFETCH  nodes(ids:[scheduleGid]) → PaymentSchedule
                            completedAt still null?  ──no──► mark SUPPRESSED_PAID, stop
                                            │ yes
                                            ▼
                            Admin GraphQL: paymentReminderSend(paymentScheduleId)
                               │ success:true            │ success:false / userErrors
                               ▼                         ▼
                            mark SENT, sentAt=now     mark FAILED (attempts++, bounded retry
                                            │           next sweep while attempts < 3)
                                            ▼
        Shopify resolves recipient (company main contact), renders the shop's
        "Payment reminder" notification template (merchant branding + PAY-NOW LINK),
        sends from the shop's authenticated sender ──► buyer pays via link or
        customer-accounts "Pay now" ──► orders/paid webhook ──► existing ledger
        refetch sets LedgerSchedule.completedAt ──► all later touchpoints skip
```

### Recommended additions to project structure

```
app/services/
├── reminders.server.ts      # touchpoint math, eligibility, claim/send/mark — the whole feature
└── scheduler.server.ts      # +1 entry in SWEEP_SCHEDULE (REMINDER_SWEEP_LEASE, "30 * * * *")
prisma/
└── schema.prisma            # +ReminderLog model, +Shop.remindersEnabledAt
app/routes/
└── app.settings.tsx (existing settings surface) # reminders on/off toggle + native-reminder warning copy
tests/
└── reminders.test.ts        # touchpoint boundaries, claim idempotence, stop-on-payment race
```

### Pattern 1: Touchpoint eligibility — "latest crossed threshold only"

**What:** For each open schedule compute thresholds `DUE_SOON = dueAt − 72h`, `DUE = dueAt`, `OVERDUE = dueAt + 72h`. The *eligible* touchpoint is the most severe threshold ≤ now. Earlier touchpoints that were never sent are logged `SUPPRESSED_STALE`, not sent late.
**When to use:** every sweep tick; it makes catch-up after downtime safe by construction (a 5-day outage produces one email, not three).
**Why:** REMD-01 says each touchpoint "at most once" — it never says "guaranteed once." At-most-once is the correct failure direction for dunning (Pitfall 3).

### Pattern 2: Claim-then-send (at-most-once email idempotence)

**What:** `ReminderLog` has `@@unique([shop, scheduleGid, touchpoint])`. The sweep INSERTs the row with `status=SENDING` *before* calling the mutation; a P2002 unique violation means another pass (or the pre-crash previous run) owns it — skip silently. Only after a `success: true` response does the row flip to `SENT`.
**Why this order:** crash-after-send-before-log double-emails a customer (embarrassing, trust-destroying); crash-after-claim-before-send silently drops one reminder (harmless — the next touchpoint still fires). Same "insert IS the dedupe" discipline as `WebhookReceipt` [VERIFIED: prisma/schema.prisma — WebhookReceipt "the insert itself is the dedupe"; EnforcementEvent `@@unique([shop, kind, orderGid])`].
**Failure handling:** `success:false`/`userErrors` (`PAYMENT_REMINDER_SEND_UNSUCCESSFUL` is the only error code in the schema) → `status=FAILED`, `attempts++`; sweep may re-claim FAILED rows while `attempts < 3`, then `status=DEAD` + Sentry.

### Pattern 3: Live refetch before send (the REMD-01 stop race)

**What:** After claiming, refetch the schedule (`nodes(ids: [...])` — `PaymentSchedule` implements `Node` [VERIFIED: schema — "PaymentSchedule interfaces: Node"]) and skip if `completedAt != null`. Read is covered by existing `read_payment_terms`.
**Why:** a payment landing between the sweep's DB query and the send would otherwise dun a customer who just paid — the project's canonical worst failure mode transplanted to email. Local DB state can lag webhook delivery by seconds-to-minutes; the refetch shrinks the race to the mutation's own latency, and Shopify's server-side state is checked once more inside the mutation itself (empirical check E3 verifies it refuses completed schedules).

### Pattern 4: Sweep registration exactly as the scheduler header prescribes

Own lease name (`"reminder-sweep"`), own `SWEEP_SCHEDULE` entry, `noOverlap: true`, offset cron (`"30 * * * *"`) so it never queues behind the minute-0 overdue sweep. The scheduler module's four rules apply verbatim — especially rule 2: *"`runExclusive` exists to stop Railway's deploy-overlap window … from … in Phase 5, double-sending merchant-visible email — not to make the writes safe. Never reason 'the lease held, therefore this can skip its idempotency.'"* [VERIFIED: app/services/scheduler.server.ts:42-48, 69-72: "Phase 5 adds its own name here rather than sharing one of these — two different sweeps behind one lease would let a slow reconciliation suppress reminder emails."]

### Anti-Patterns to Avoid

- **Fetching or storing any buyer email/name** — breaks PRIVACY.md §3 ("Credit Guard does **not** store any personal data about a merchant's customers … no customer names, email addresses" [VERIFIED: PRIVACY.md §3]) and drags in PCD Level 2.
- **Constructing a pay-now URL by hand** (order status URL patterns, checkout recovery URLs) — `Order.statusPageUrl` is PCD-Level-2 gated by changelog; `OrderPaymentCollectionDetails.additionalPaymentCollectionUrl` is for *additional* payment collection (order edits), not the terms balance [VERIFIED: schema — "additionalPaymentCollectionUrl: URL — The URL to use for collecting an additional payment on the order."]. The link inside Shopify's template is the product.
- **Send-then-log** — see Pattern 2.
- **Summing `LedgerSchedule.balanceDueAmount` across orders for email copy** — schema comment forbids it: schedule money is "MoneyV2 of unspecified currency … NEVER summed" [VERIFIED: prisma/schema.prisma LedgerSchedule header].
- **Driving touchpoints off the `payment_schedules/due` webhook** — it's already subscribed but is a doorbell at best (delivery not guaranteed, and it covers only the due instant, not due−3/overdue). The sweep is the source of truth; webhooks may at most trigger an early per-shop pass.
- **Writing `Company.overdue` or any ledger state from the reminder sweep** — ledger rule 3: `recomputeCompany` is the sole writer.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recipient resolution (who at Northwind gets the email?) | CompanyContact→customer traversal + contact-role heuristics | `paymentReminderSend` (Shopify picks the company main contact) | Needs `read_customers` + PCD L2; Shopify already encodes the merchant-visible convention |
| Pay-now link | URL construction from order tokens | The link inside Shopify's reminder template + customer-accounts Pay now | `statusPageUrl` is PCD-gated; token formats are undocumented and rotate |
| Email rendering/deliverability (SPF/DKIM/DMARC, bounces, template branding) | Resend + react-email + DNS + bounce webhooks | Shopify's notification pipeline | Shopify sends from the merchant's already-authenticated identity; bounce handling, unsubscribe posture and CAN-SPAM identification are Shopify's problem |
| Distributed cron locking | pg advisory locks, Redis, BullMQ | Existing `SweepLease` + `runExclusive` | Already built, tested, and documented for exactly this phase |
| Exactly-once email bookkeeping | In-memory sent-sets, time-window dedupe | `ReminderLog` unique constraint | Survives restarts and deploy overlap; queryable for the Phase-6 dashboard and LNCH-02's "first reminder sent" trigger |

**Key insight:** every hard sub-problem of "send a dunning email" (identity, address, template, deliverability, pay link) is merchant-context Shopify already owns. The app's actual job is only the part Shopify *can't* do: the credit-aware calendar and the exactly-once log.

## Common Pitfalls

### Pitfall 1: The install blast
**What goes wrong:** first enabled sweep on a store with backfilled history emails every overdue customer at once.
**Why:** LEDG-01 backfills all open schedules; OVERDUE eligibility has no upper time bound.
**How to avoid:** default-off + `remindersEnabledAt` watermark; thresholds crossed before it → `SUPPRESSED_PREEXISTING`. Also add a per-shop-per-sweep send cap (e.g., 50) as a circuit breaker; log `DEFERRED` beyond it.
**Warning signs:** first sweep after enable produces >n sends for a mature store.

### Pitfall 2: Double-dunning via Shopify's native reminders
**What goes wrong:** merchant configured Settings → Notifications payment reminders (or Flow); buyer receives ours *and* theirs.
**Why:** no API exposes notification/reminder settings (schema sweep: only the `paymentReminderSend` mutation family exists), so the app cannot detect the overlap.
**How to avoid:** explicit settings-page copy; onboarding checklist item; E5 empirically checks whether native reminders are on by default (believed off — merchant must add them).

### Pitfall 3: Treating reminders as at-least-once
**What goes wrong:** retry loops or send-then-log turn one touchpoint into 2+ emails; a customer chased twice for a paid invoice is an uninstall.
**How to avoid:** Pattern 2 (claim-then-send), bounded FAILED retries, and the live refetch (Pattern 3). Accept that a crash can eat one reminder — the next touchpoint covers it.

### Pitfall 4: Believing the Flow doc's "Requires Shopify Plus"
**What goes wrong:** concluding `paymentReminderSend`/payment schedules are Plus-only and abandoning the architecture (or shipping and failing on Basic).
**Why:** help pages predate the 2026-04-02 B2B-on-all-plans rollout; multiple 2026 sources confirm net terms + B2B payment workflows (incl. payment reminders) on all paid plans, with Plus remainders being deposits/partial payments, >3 catalogs, expansion stores [CITED: bizspice.com, mastroke.com, uncap.com 2026 B2B-vs-Plus write-ups]. Dev stores can't prove non-Plus behavior (they have Plus-tier features) — see Open Question 2.
**How to avoid:** keep the sweep architecture send-mechanism-agnostic (one `sendReminder(scheduleGid)` seam) so a plan-gating surprise swaps the transport, not the phase.

### Pitfall 5: PCD contamination creep
**What goes wrong:** an innocent-looking field (`Order.email`, `statusPageUrl`, `customer { … }`) added to a GraphQL query for email copy quietly obligates PCD approval; on non-dev stores the field silently returns null/errors, or review flags the app.
**How to avoid:** the reminder query touches only `PaymentSchedule { id dueAt completedAt }` and existing ledger fields. Add a code-review check: no new fields on Order/Customer/CompanyContact in this phase.

### Pitfall 6: Same-template blindness
**What goes wrong:** merchant expects "due in 3 days" vs "overdue" copy; Shopify's single "Payment reminder" template is identical for all three touchpoints, and a confused merchant blames the app.
**How to avoid:** settings/onboarding copy explains the template is edited in Shopify admin (Liquid); dashboard log labels each send with its touchpoint so the merchant sees the cadence working. Per-touchpoint copy is REMD-04 (v2) or Architecture B territory.

## Code Examples

### The send (verbatim schema shapes)

```graphql
# [VERIFIED: app/types/admin-2026-07.schema.json — extracted this session]
# Mutation.paymentReminderSend : PaymentReminderSendPayload
#   "Sends an email payment reminder for a payment schedule."
#   arg paymentScheduleId: ID!
# PaymentReminderSendPayload { success: Boolean, userErrors: [PaymentReminderSendUserError!]! }
# sole error code: PAYMENT_REMINDER_SEND_UNSUCCESSFUL
mutation SendReminder($id: ID!) {
  paymentReminderSend(paymentScheduleId: $id) {
    success
    userErrors { field message }
  }
}
```

### Live pre-send refetch (PaymentSchedule implements Node)

```graphql
# read_payment_terms covers this; no PCD fields touched
query ScheduleStillOpen($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on PaymentSchedule { id dueAt completedAt }
  }
}
```

### ReminderLog model sketch

```prisma
/// One row per (schedule × touchpoint) attempt — the REMD-01 email log.
/// The unique constraint IS the idempotence (claim-then-send).
model ReminderLog {
  id          String    @id @default(cuid())
  shop        String
  scheduleGid String
  orderGid    String    // snapshot for dashboard display, no FK (EnforcementEvent precedent)
  companyGid  String?
  companyName String?   // snapshot; NEVER buyer contact data (T-03-07 discipline)
  touchpoint  String    // DUE_SOON | DUE | OVERDUE  (code-enforced, like attributionStatus)
  status      String    // SENDING | SENT | FAILED | DEAD | SUPPRESSED_PAID | SUPPRESSED_STALE | SUPPRESSED_PREEXISTING | DEFERRED
  attempts    Int       @default(0)
  sentAt      DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@unique([shop, scheduleGid, touchpoint])
  @@index([shop, createdAt])   // dashboard feed + LNCH-02 "first reminder" query
}
```

Plus `Shop.remindersEnabledAt DateTime?` (null = off; doubles as the suppression watermark). Include `ReminderLog` in `redactShop`'s deletion set (shop/redact) and gate the sweep on `Shop.active` via `forEachActiveShop` (structural).

### Sweep registration

```ts
// scheduler.server.ts — the registry the module reserves for this phase
export const REMINDER_SWEEP_LEASE = "reminder-sweep";
export const REMINDER_SWEEP_CRON = "30 * * * *"; // offset from minute-0 overdue sweep
// SWEEP_SCHEDULE.push? No — add a third literal entry, noOverlap: true, run: reminderSweep
```

## State of the Art

| Old Approach (stack research, .claude/CLAUDE.md) | Current Approach (this research) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Resend ^4.x + react-email ^3.x as the reminder pipeline | `paymentReminderSend` (Shopify-native); Resend demoted to Architecture-B fallback (and is now v6.20.0; `@react-email/components` deprecated) | verified 2026-08-20 | No new deps, no DNS, no PII, no PCD |
| "Reminder emails (due−3d, due date, overdue)" assumed app-composed | App decides *when*; Shopify composes/sends/links | — | REMD-03 wording needs user amendment |
| Buyer email assumed obtainable | CompanyContact has no email field; Order.email + statusPageUrl are PCD-L2 | byte-verified + changelog | Architecture B is a compliance project, not a feature |
| No native competition assumed for reminders | Shopify native scheduled reminders exist (due-date/overdue only, no pre-due, no log, no credit context) | shipped by Shopify (changelog "Increase on-time B2B payments with payment reminders") | Differentiation = due−3 + exactly-once log + AR dashboard integration |

**Deprecated/outdated:** `@react-email/components` (npm-deprecated); `.claude/CLAUDE.md` Resend version row; PRIVACY.md §2 "exactly four read-only scopes / no write scopes" — already false since Phases 3–4 added `write_companies`/`write_validations`, and Phase 5 adds `write_orders`. **A PRIVACY.md §2 update is a required task this phase regardless of architecture choice** (it can honestly keep §3's "no customer personal data stored" under Architecture A).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `paymentReminderSend` sends the same "Payment reminder" notification template as native scheduled reminders, pay-now link included | Requirements, Patterns | REMD-02 unmet → fall back to `orderInvoiceSend` for the link or Architecture B. Checked by E1 [ASSUMED — help docs confirm the template + link for *native* reminders; the mutation→template binding is inferred] |
| A2 | The mutation sends pre-due (due−3) — Flow doc only requires terms to be "in effect" (post order creation) | Patterns | Due−3 touchpoint impossible via A → due-soon email becomes merchant-digest (C) or B; due/overdue unaffected. Checked by E2 [ASSUMED] |
| A3 | The mutation refuses or no-ops on a completed schedule | Pattern 3 | Race window widens to webhook latency only — live refetch still guards; treat `success:false` as benign. Checked by E3 [ASSUMED] |
| A4 | `paymentReminderSend`/payment schedules work on non-Plus plans post 2026-04-02 B2B rollout | Pitfall 4 | Reminder feature silently Plus-only → transport swap behind the `sendReminder` seam; positioning hit. Community-corroborated, not officially confirmed [ASSUMED, MEDIUM] |
| A5 | Recipient = company main contact (Flow action doc); resolution for company-less net-terms orders unknown | Responsibility Map | Non-B2B terms orders may email order.email or fail — v1 scopes reminders to ATTRIBUTED-company schedules anyway. Checked by E4 [CITED: help.shopify.com Flow send-payment-reminder] |
| A6 | Adding `write_orders` needs only re-consent + review justification (no PCD, since no protected fields are queried) | Standard Stack | If review pushes back, justification text cites the two mutations; worst case C. [ASSUMED, consistent with PCD docs being field-level] |
| A7 | Dunning reminders are CAN-SPAM "transactional or relationship" content (invoice payment reminders explicitly cited as transactional; no unsubscribe required) — moot under A since Shopify sends | Compliance | Only matters for B; add unsubscribe/identification there [CITED: FTC business-guidance summaries via socketlabs/monkeypod] |

## Open Questions (empirical dev-store pass — do this as the phase's first plan, ~30 min)

1. **E1 (A1):** On credit-guard-demo, pick an open `LedgerSchedule.scheduleGid`, run `paymentReminderSend` via GraphiQL with `write_orders` granted. Inspect the email at the company main contact's inbox: template? pay-now link present? Click it — does it reach a payable page for a net-terms order (pre-due and overdue)? Record the URL shape (do NOT persist it in code).
2. **E2 (A2):** Same call on a schedule >3 days before `dueAt` — does it send?
3. **E3 (A3):** Same call on a `completedAt != null` schedule — `success:false`? error message?
4. **E4 (A5):** A net-terms draft order without a purchasing company — who (if anyone) receives it?
5. **E5 (Pitfall 2):** Fresh dev store: are native payment reminders configured by default under Settings → Notifications? What does the default "Payment reminder" template look like?
6. **Plan-gating (A4):** Cannot be proven on a dev store (Plus-tier features enabled). Mitigation: seam the transport; optionally ask Shopify partner support or test on a Basic trial store before listing copy promises reminders on all plans.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node/npm/vitest/Prisma/Postgres (Railway) | everything | ✓ (in repo/CI since Phase 1) | Node 22 image / Prisma 6 | — |
| Dev store with B2B fixtures (credit-guard-demo: Northwind/Acme/Snowdevil, live schedules) | E1–E5 | ✓ (Phase 4 verified live) | — | — |
| `write_orders` scope | the send mutation | ✗ (not yet requested) | — | none — TOML+Railway+vitest lockstep change + merchant re-consent (standard flow) |
| Resend account + creditguardhq.com DNS (Shopify-managed domain admin supports TXT/CNAME) | Architecture B only | ✗ | free tier: 3,000/mo, 100/day, 1 domain | not needed under A |

**Missing with no fallback:** none for Architecture A beyond the scope addition, which is routine.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (repo standard; 20 suites in `tests/`) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/reminders.test.ts` |
| Full suite command | `npm test` (`vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REMD-01 | Touchpoint boundary math (72h thresholds, strictly-crossed), latest-only eligibility, catch-up suppression | unit | `npx vitest run tests/reminders.test.ts -t touchpoint` | ❌ Wave 0 |
| REMD-01 | Claim-then-send idempotence: concurrent claims → one send; FAILED retry bound; redelivery no-op | unit (mocked GraphQL) | `npx vitest run tests/reminders.test.ts -t idempot` | ❌ Wave 0 |
| REMD-01 | Stop-on-payment: local `completedAt` skip + live-refetch race suppression | unit | `npx vitest run tests/reminders.test.ts -t stop` | ❌ Wave 0 |
| REMD-01 | Sweep registration: own lease, cron, noOverlap, `forEachActiveShop` gating, disabled-shop skip | unit | extend `tests/scheduler.test.ts` (registry is data — asserted by value per its design) | ✅ extend |
| REMD-02 | Pay-now link present and functional | manual-only (email content lives in Shopify) | E1 procedure; record in VERIFICATION.md | — |
| REMD-03 | Sender/branding posture per amended wording | manual-only | E1 inspection of received headers/branding | — |
| scope lockstep | `write_orders` present in TOML/env/test env | unit | `npx vitest run tests/scope-lockstep.test.ts` | ✅ extend |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/reminders.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** full suite green + E1–E5 evidence before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/reminders.test.ts` — REMD-01 units (fixtures can reuse `tests/helpers` DB harness)
- [ ] scheduler/scope-lockstep test extensions

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (existing) | Offline session tokens via `@shopify/shopify-app-react-router`; sweep uses stored offline sessions only for active shops |
| V3 Session Management | no new surface | — |
| V4 Access Control | yes | `forEachActiveShop` is the background-work authorization gate (T-02-17 precedent); reminders additionally gated on `remindersEnabledAt` — an uninstalled or disabled shop must never generate email |
| V5 Input Validation | yes | GraphQL response shapes narrowed by generated types; `touchpoint`/`status` enums code-validated (repo convention) |
| V6 Cryptography | n/a | no new crypto; no PII handled |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Email flood (bug or backfill) dunning a merchant's whole customer base | DoS / reputation | Default-off, enablement watermark, per-shop-per-sweep cap, at-most-once log (Pitfall 1/3) |
| Cross-shop send (schedule GID from shop A sent with shop B's session) | Elevation | Reminder query and claim are keyed by `shop`; GID only ever read from that shop's own `LedgerSchedule` rows (T-03-06 discipline) |
| Unauthorized processing post-uninstall | Privacy | `forEachActiveShop` + `ReminderLog` added to `shop/redact` deletion set |
| PII creep into logs/Sentry | Info disclosure | App never receives an address under A; ReminderLog stores GIDs + company-name snapshot only; keep existing Sentry scrubbing |
| Scope creep optics (`write_orders` on a "read-only" app) | Review risk | PRIVACY.md §2 rewrite + review justification: write scope used exclusively for the two send mutations; app never creates/edits orders |

## Project Constraints (from CLAUDE.md)

- Shopify AI Toolkit for Shopify platform work; no tooling added to the repo (AGENTS.md) — respected: this phase adds no packages.
- Admin GraphQL only, pinned 2026-07 in lockstep across TOML/webhooks (repo TOML header) — reminder queries/mutations use the same version.
- Timeline 2–4 weeks solo / cheap infra / flat pricing — Architecture A is the only option with zero new infra and zero compliance lead time.
- App-review compliance (GDPR webhooks, Polaris web components, App Bridge latest) — settings toggle UI must use Polaris web components; `ReminderLog` joins the redact path.
- Treat `.claude/CLAUDE.md` stack claims as MEDIUM — done; its Resend rows were verified stale and demoted.
- GSD workflow enforcement — this file is the phase's research artifact; no source changes made.

## Sources

### Primary (HIGH confidence)
- `app/types/admin-2026-07.schema.json` (local, byte-authoritative) — `paymentReminderSend`/payload/error-code shapes; `orderInvoiceSend` + `EmailInput`; `CompanyContact` full field list (no email/name); `Order.email`/`statusPageUrl`/`paymentCollectionDetails` descriptions; `PaymentSchedule` fields (`amount` deprecated in favor of `balanceDue`/`totalBalance`), `Node` interface; `Shop.ianaTimezone`; schema-wide sweep: no reminder query/settings surface
- Repo files read this session: `prisma/schema.prisma`, `app/services/scheduler.server.ts` (full), `app/services/ledger.server.ts` (schedule ingest lines 85–90, 259–264, 368–456, 746–757), `shopify.app.toml`, `PRIVACY.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`
- [paymentReminderSend — Admin GraphQL 2026-07](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/paymentReminderSend) — "Requires `write_orders` access scope" (fetched live)
- [orderInvoiceSend — Admin GraphQL 2026-07](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/orderInvoiceSend) — `write_orders`; from/bcc = store/staff emails (fetched live)
- [Protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data) — email is Level 2; L2 requirement list; dev-store exemption (fetched live)
- npm registry (`npm view`, 2026-08-20): resend 6.20.0, react-email 6.9.2, @react-email/components 1.0.12 **deprecated** ("Package no longer supported.")

### Secondary (MEDIUM confidence)
- [Managing orders with deferred payments](https://help.shopify.com/en/manual/fulfillment/managing-orders/payments/deferred-payments) — native reminders: up to five, "on due date" or up to 30 days after; invoice email = checkout link (fetched live)
- [Flow action: Send payment reminder](https://help.shopify.com/en/manual/shopify-flow/reference/actions/send-payment-reminder) — recipient = B2B company main contact; "after terms take effect"; stale-looking Plus note (fetched live)
- [B2B payment terms](https://help.shopify.com/en/manual/b2b/checkout-and-orders/payment-terms) — customer-accounts Pay now; post-due shows Overdue (fetched live)
- Changelog titles (search-verified, pages 404 on direct fetch): "Send payment reminders via email to customers with the paymentReminderSend endpoint" (2023-01 API); "Level 2 protected customer data requirements are now needed to access the order.statusPageUrl field"; "Increase on-time B2B payments with payment reminders" (pay-now link in reminder template)
- 2026 B2B plan comparisons (bizspice.com, mastroke.com, uncap.com, fyresite.com) — net terms + payment workflows on all paid plans post 2026-04-02; Plus remainders exclude payment terms
- Resend pricing/DNS (wpmailsmtp.com, nuntly.com, resend.com/docs) — free 3,000/mo, 100/day, 1 domain, DKIM/SPF/DMARC on free tier
- FTC CAN-SPAM business guidance (via socketlabs.com, monkeypod.helpscoutdocs.com summaries) — invoice payment reminders = transactional/relationship content; primary-purpose test caveat

### Tertiary (LOW confidence)
- Flow doc's "Requires Shopify Plus" note — treated as stale, contradicted by 2026 sources (Pitfall 4 / A4)

## Metadata

**Confidence breakdown:**
- Recipient problem & PCD walls: HIGH — byte-verified schema + live PCD docs
- `paymentReminderSend` existence/args/scope: HIGH — schema + live docs
- Reminder email content (template, pay link) & pre-due send: MEDIUM — help docs + changelog for native reminders; mutation binding inferred, E1/E2 close it
- Non-Plus availability: MEDIUM — community-corroborated, not provable on a dev store
- Scheduling/idempotence design: HIGH — builds on read, tested, in-repo primitives designed for this phase

**Research date:** 2026-08-20
**Valid until:** 2026-09-20 (2026-10 API RC lands ~October; re-check mutation docs if the pin moves)

## Addendum 2026-08-21: template Liquid + dev-store delivery

**Researched:** 2026-08-21 · **Scope:** two documentary questions only; no source changes. Provenance tags follow the main document's convention.

### Q1 — Is the default "Payment reminder" template state-adaptive?

**Answer: YES — the default template branches on due state.** It is not unconditionally overdue-phrased. The "Your payment is 3 days overdue" seen in the dev-store admin preview is the `{% else %}` branch rendered against Shopify's sample data, which happens to be overdue.

**Source obtained.** help.shopify.com does not publish the template body (the variables reference page links to it only by variable name), and `shopify.dev/docs/api/liquid/objects/payment_schedule` / `payment_terms` 404 on direct fetch. The default source was obtained from two independent public mirrors that agree byte-for-byte on the branching block:

1. `github.com/maizzle/shopify-notification-templates` — "All 52 default Shopify notification email templates, organized by category", file `customer-notifications/payments/payment_reminder.html`, last pushed 2026-07-30 `[VERIFIED: gh api, file fetched and read this session]`
2. `github.com/snowdiamonds/react-email-shopify-liquid` — `examples/emails/PaymentReminder.tsx` (April 2024), a react-email re-implementation of the same Liquid with identical conditions and copy `[VERIFIED: gh api, file read this session]`

Neither is a Shopify-owned repo, so the tag is **MEDIUM** (third-party scrape, cross-corroborated across two years and two authors), not HIGH. The decisive check is trivial and must be done before build (see Implication below).

**Default template Liquid, verbatim** (maizzle mirror, lines 80–112):

```liquid
{% if payment_schedule.overdue? and payment_schedule.number_of_days_overdue == 0 %}
  <h2>Your payment is due today</h2>
{% elsif payment_schedule.due_later? and payment_schedule.due_in_days == 0 %}
  <h2>Your payment is due today</h2>
{% elsif payment_schedule.overdue? and payment_schedule.number_of_days_overdue == 1 %}
  <h2>Your payment was due yesterday</h2>
{% elsif payment_schedule.due_later? and payment_schedule.due_in_days == 1 %}
  <h2>Your payment is due tomorrow</h2>
{% elsif payment_schedule.due_later? and payment_schedule.due_in_days > 1 %}
  <h2>Your payment is due in {{ payment_schedule.due_in_days}} days</h2>
{% else %}
  <h2>Your payment is {{ payment_schedule.number_of_days_overdue }} days overdue</h2>
{% endif %}
{% if custom_message != blank %}
  <p>{{ custom_message }}</p>
{% else %}
  {% if payment_schedule.overdue? and payment_schedule.number_of_days_overdue == 0 %}
    <p>This is a reminder that you have a payment of {{ payment_schedule.amount_due | money_with_currency }} due today for order {{ name }}.</p>
  {% elsif payment_schedule.due_later? %}
    <p>This is a reminder that your payment of {{ payment_schedule.amount_due | money_with_currency }} for order {{ name }} is due on {{ payment_schedule.due_at | date: '%B %e, %Y' }}.</p>
  {% else %}
    <p>This is a reminder that your payment of {{ payment_schedule.amount_due | money_with_currency }} for order {{ name }} was due on {{ payment_schedule.due_at | date: '%B %e, %Y' }}.</p>
  {% endif %}
  <p>Thank you.</p>
{% endif %}
{% if checkout_payment_collection_url %}
  ... <a href="{{ checkout_payment_collection_url }}" class="button__text">Pay now</a> ...
```

Three findings that matter for Phase 5 beyond the yes/no:

- **DUE_SOON (N > 1 days out) renders "Your payment is due in N days" + "is due on <date>"** — exactly the copy we want, with no merchant action.
- **`custom_message` replaces the body paragraph entirely** (headline is kept). The `paymentReminderSend` mutation does not expose a custom-message argument in the 2026-07 schema (main doc, Standard Stack); this variable is fed by the admin/Flow "Send payment reminder" UI. So the app cannot inject copy — and does not need to.
- **The "Pay now" button is conditional on `checkout_payment_collection_url`**, consistent with the main doc's finding that pre-due/checkout-link availability is what E1/E2 must observe.

**Variables available for a merchant-edited template** (actionable if a merchant wants different copy) `[CITED: help.shopify.com/en/manual/fulfillment/setup/notifications/email-variables, "Payment schedule properties", fetched live 2026-08-21]`: `payment_schedule.amount_due`, `payment_schedule.due_at`, `payment_schedule.due_in_days` ("The number of days until the due date if the payment schedule is still due (unpaid)"), `payment_schedule.due_later?`, `payment_schedule.overdue?`, `payment_schedule.number_of_days_overdue?`. Same page: "SMS notifications cannot transmit payment reminder notifications."

**Residual uncertainty:** a merchant who has previously edited their Payment reminder template may have removed the branching. The app cannot read notification templates via the Admin API (no such surface; main doc's schema sweep). Mitigation: the DUE_SOON settings help-text should say "uses your store's Payment reminder template, which by default reads 'due in N days' before the due date — preview it under Settings → Notifications."

### Q2 — Do development stores deliver customer-facing notification emails?

**Answer: UNDOCUMENTED as a dev-store limitation; community evidence says dev stores DO send, and the observed wall on credit-guard-demo is not explained by any published rule.** Confidence that "dev stores suppress customer email" is a real, documented policy: **LOW** (no source found after targeted search of help.shopify.com dev-store pages, Partner docs, shopify.dev, and community threads).

What the documentation does say:

- Dev-store limitations page (`shopify.dev` dev-stores doc, fetched live) lists, verbatim: "Dev stores are intended for development and testing only. They can't be used for production and can't process real transactions"; "Real transactions through active payment providers, Store Credit, and Gift Cards aren't supported."; "You can't remove the password page or show a custom password page."; "Dev stores can't be transferred to a client." — **nothing about email or notifications** `[CITED: shopify.dev/docs/api/development-stores (resolved page), fetched live]`.
- Partner "Testing orders in development stores" page, verbatim: "By placing a test order, you can make sure that your ... settings for order processing, inventory, shipping, **email notifications**, and taxes are all correct." and a troubleshooting block beginning "If you're not receiving order confirmation emails from Shopify Payments test mode transactions, then try the following troubleshooting steps" → check template, check email settings, "Emails might get sent to your spam or junk folder" `[CITED: help.shopify.com/en/partners/dashboard/managing-stores/test-orders-in-dev-stores, fetched live]`. This positively implies dev stores are expected to send customer notifications.
- Customer-notifications and store-notifications help pages: no mention of development/trial stores, no "customer notifications off by default" toggle for dev stores `[CITED: help.shopify.com/en/manual/fulfillment/setup/notifications/customer-notifications; .../setup/notifications, both fetched live]`. Only Plus merchants can have Support disable required notifications (order confirmation is mandatory on standard plans) `[CITED: search-summarised help pages; MEDIUM]`.
- Password page / transfer-disabled status: no document links either to notification delivery. `[ASSUMED: no effect]` — A-Q2-1 below.

Community evidence:

- "I do not receive emails development store" (community.shopify.com/t/205216): no staff reply; community answer "It's unlikely that the issue with receiving emails is due to your Shopify store being in development mode or not being on a current payment plan"; OP's resolution was a server-side spam folder. `[CITED, fetched live]`
- "Why aren't my customer email notifications working properly?" (t/315916) and "Order notifications via email not working" (t/342028): generic DNS/SPF/DKIM/spam advice, no dev-store angle, no staff reply. `[CITED, fetched live]`
- "Records of the actual notifications/emails sent to customers" (t/190495): Shopify staff confirm there is no merchant-visible per-recipient delivery log ("Shopify doesn't offer email Hosting and Servers which would be necessary to store all the emails"); the timeline "sent" entry is a send-attempt record, not a delivery receipt. `[CITED, fetched live]` Third-party guides (shopexperts.com) reference a newer Settings → Notifications → Email logs view showing sent/bounced; not confirmed on help.shopify.com this session `[ASSUMED]` — A-Q2-2.
- Store-level **suppression**: community guidance (t/342028 thread family, egnition/klaviyo summaries) says a store can be placed on a Shopify-side suppression list (bounces, spam complaints, provider flags), that the timeline still records "sent", and that "the only way to check ... is to contact Shopify support, and only they can remove you." `[CITED: WebSearch summaries; MEDIUM]`

**Best-fit explanation for the observed wall (inference, not documentation):** timeline "sent" + staff/owner mail arriving + zero customer mail across three providers including junk is the signature of **sender-pool / store-level suppression or reputation throttling on a brand-new, never-warmed, unauthenticated dev store**, not of a dev-store policy. Staff notifications and customer notifications are sent from different pools/paths (staff alerts go to the store owner address; customer notifications go out "from" the store's sender address via Shopify's shared relay with no SPF/DKIM for a `.myshopify.com`/unverified sender). This is consistent with every thread above but is `[ASSUMED]` — A-Q2-3.

### Implication for DUE_SOON

**GREEN — build DUE_SOON.** The default Payment reminder template branches on `payment_schedule.due_later?` / `due_in_days` and renders "Your payment is due in N days" / "is due on <date>" before the due date, "due today" on the day, and "N days overdue" after; the overdue preview was an artefact of sample data. No merchant template edit is required for correct pre-due copy, so no "edit your template" instruction and no default-off-per-touchpoint hedge is needed. Two guardrails carry into the plan: (1) **a 60-second confirmation step before the DUE_SOON tasks execute** — open Settings → Notifications → Payment reminder → Edit code on the dev store and grep for `due_later?`; the mirror is third-party (MEDIUM) and this check upgrades it to VERIFIED; (2) settings help-text should state that DUE_SOON uses the store's Payment reminder template and what the default says, because a merchant-customised template could have dropped the branching and the app cannot read templates via the API.

### Implication for E1/E2 delivery proof

**The dev-store wall is NOT documented.** No Shopify page states that development stores suppress, hold, or throttle customer notification email; the Partner test-orders page expressly lists "email notifications" among the things a dev-store test order verifies, and the only community thread on the topic resolved as a spam-folder issue. Therefore E1/E2 cannot be closed as "expected dev-store behaviour", and the non-delivery must be treated as either store-level suppression/reputation (fixable only via Shopify Support) or an unverified-sender deliverability problem. Pre-launch verification should be: (a) on the dev store, check Settings → Notifications → Email logs (if present) for bounce/suppression status, and open a Partner-support ticket asking whether `credit-guard-demo.myshopify.com` is on a suppression list — this is the only authoritative channel; (b) set a verified sender address with SPF/DKIM (`v=spf1 include:shops.shopifyemail.com ~all`) on the store and re-run one order confirmation to a Gmail address; (c) the real proof must run on a **paid-plan store with a verified sender domain** (the launch/demo store for app review qualifies) — record the `paymentReminderSend` timeline entry plus an actual inbox screenshot for the pre-due and overdue cases. Until (c) passes, the Phase 5 plan should gate the "customer received the email" acceptance criterion behind a `checkpoint:human-verify`, while everything up to the timeline "sent" entry (mutation success, idempotence, scheduling) remains automatable on the dev store.

### Assumptions added by this addendum

| # | Claim | Risk if wrong |
|---|-------|---------------|
| A-Q2-1 | Storefront password / transfer-disabled status has no effect on notification delivery | Low — if wrong, dev-store proof is impossible and (c) above is the only path anyway |
| A-Q2-2 | A merchant-visible "Email logs" view exists under Settings → Notifications on current admin | Low — if absent, skip step (a)'s first half and go straight to Support |
| A-Q2-3 | Observed wall is suppression/reputation, not policy | Medium — if some unpublished dev-store rule exists, Support ticket in (a) surfaces it |

### Sources added

- github.com/maizzle/shopify-notification-templates — `customer-notifications/payments/payment_reminder.html` (pushed 2026-07-30) — MEDIUM (third-party mirror of defaults)
- github.com/snowdiamonds/react-email-shopify-liquid — `examples/emails/PaymentReminder.tsx` (2024-04) — MEDIUM (independent corroboration)
- help.shopify.com/en/manual/fulfillment/setup/notifications/email-variables — payment_schedule properties — HIGH (official, fetched live)
- shopify.dev dev-stores limitations page — no email limitation listed — HIGH (official, fetched live)
- help.shopify.com/en/partners/dashboard/managing-stores/test-orders-in-dev-stores — email notifications testable on dev stores — HIGH (official, fetched live)
- community.shopify.com t/205216, t/315916, t/342028, t/190495 — community/staff threads — MEDIUM/LOW
- store.orderlyemails.com "Shopify's new Payment reminder email added" — confirms template exists; no source shown — LOW
