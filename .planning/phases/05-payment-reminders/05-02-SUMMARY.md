---
phase: 05-payment-reminders
plan: 02
subsystem: infra
tags: [reminders, paymentReminderSend, empirical-check, deliverability, rfc2606, dev-store-limits, order-timeline, rate-limit, privacy, railway]
requires:
  - phase: 05-payment-reminders
    plan: 01
    provides: "SEND_REMINDER_MUTATION document shape, ReminderLog/remindersEnabledAt schema, scripts/prod-reminder-state.{sh,mjs}, write_orders released as registry version 7"
  - phase: 04-checkout-enforcement
    provides: "the railway-ssh base64 in-container probe channel (prod-validation-state) and the T-04-17 read-only-tooling contract"
provides:
  - "E3 ANSWERED: paymentReminderSend on a completed schedule returns success:null (NOT false) with code PAYMENT_REMINDER_SEND_UNSUCCESSFUL, message 'Payment schedule is already completed' — idempotent, no state change"
  - "E4 ANSWERED: the mutation ACCEPTS a company-less net-terms schedule and resolves to the ORDER's own customer (fingerprint-identical to that order's confirmation) — never a refusal"
  - "E5 ANSWERED: native scheduled payment reminders are OFF until a merchant configures them; the default template's copy is overdue-phrased"
  - "N1 (NEW, binding on 05-03): a hard platform limit of ONE payment reminder per ORDER per 24 hours, surfaced as a userError — per-order, NOT per-company"
  - "N2 (NEW, SETTLED): the reminder recipient is SNAPSHOTTED PER ORDER at creation. Editing a contact's email does NOT redirect reminders for orders already placed — old orders kept the old address on a fresh send, while orders created after the edit carried the new one"
  - "N3 (NEW, decisive): the DEV STORE delivers no customer-facing email to any provider — three recipient domains, first-party order confirmations included, all recorded as sent and none received. Inbox verification of ANY notification is impossible on credit-guard-demo"
  - "The evidence standard this forces for E1/E2: success:true + a payment_reminder_sent timeline event + recipient fingerprint == the order's own confirmation fingerprint. Proves our side of the contract; proves nothing about delivery"
  - "Structural pay-now evidence: Order.paymentCollectionDetails.additionalPaymentCollectionUrl exists and is well-formed for BOTH past-due and pre-due orders (identical shape), satisfying the structural half of F-04"
  - "scripts/prod-reminder-recipients.{sh,mjs} — read-only deliverability probe answering 'can these orders receive mail at all?' without ever learning an address"
  - "scripts/prod-reminder-state.mjs fixtures block — every schedule classified into the E-categories with an emptyCategories shopping list"
affects:
  - "05-03: the 24h-per-ORDER limit (N1) breaks the assumption that a per-(schedule,touchpoint) claim is sufficient — an order with two schedules can legitimately attempt two sends in one sweep and the second WILL be refused; retry backoff must be >24h, not minutes"
  - "05-04: D5-05 settings copy now has the native-default answer and the overdue-phrased template observation"
  - "Phase 6 / merchant docs: N2 means a merchant who fixes a contact's email still sees dunning go to the old address for every order already on the books"
  - "REMD-02/REMD-03: UNVERIFIABLE on a dev store; logged to WINDOWS for the first production install or a paid test store"
  - "05-03 DUE_SOON: BLOCKED pending the default template's Liquid — needs a research agent with help.shopify.com access, or a merchant reading the template editor"
actuals:
  tokens: 15400
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns:
    - "Prove deliverability BEFORE proving behaviour: a green mutation plus a timeline 'email was sent' event are both fully compatible with nothing arriving"
    - "Compare identities without learning them: hash the address in-container to a fingerprint and report only fingerprint + bare domain, so equality is answerable and the address is not"
    - "Use the cheapest available call as the probe: the send itself, on a fixture whose loss costs nothing, rather than reaching for a protected field to pre-check"
key-files:
  created:
    - scripts/prod-reminder-recipients.mjs
    - scripts/prod-reminder-recipients.sh
  modified:
    - scripts/prod-reminder-state.mjs
    - README.md
key-decisions:
  - "Did NOT query Order.email, Order.customer or Company.mainContact.customer.email to pre-check the recipient, even though it would have answered the question directly: Shopify records protected-customer-data field access per app, and spending the app's PCD posture on a diagnostic would turn D5-01's whole no-PII story into a compliance project (Pitfall 5). The send itself was used as the probe instead."
  - "The mutating probe stayed in the session scratchpad and was never added to scripts/ (T-05-08); only the read-only deliverability probe was committed."
  - "E4's delivery half was left unproven by explicit user choice — its API behaviour and recipient resolution are settled, and v1 only duns ATTRIBUTED schedules anyway."
patterns-established:
  - "Read-only deliverability probe per notification feature: scripts/prod-<feature>-recipients.{sh,mjs}, fingerprint + domain only, run BEFORE any human inbox check"
  - "RFC 2606 reserved domains (example.com/.test/.invalid/.localhost) are treated as a named failure state (allRecipientsUndeliverable), not as ordinary data"
requirements-completed: []
coverage:
  - id: D1
    description: "E3: the mutation's exact refusal shape on a completed schedule, which calibrates 05-03's just-paid race handling"
    requirement: REMD-01
    verification:
      - kind: other
        ref: "live paymentReminderSend on gid://shopify/PaymentSchedule/47618097385 (order #1001, PAID) — success:null, code PAYMENT_REMINDER_SEND_UNSUCCESSFUL, 'Payment schedule is already completed'; repeated twice, identical, no state change"
        status: pass
    human_judgment: false
  - id: D2
    description: "E2 API half ONLY: the mutation does not refuse a send 30 days before dueAt — assumption A2 holds at the API boundary. Says nothing about the email's copy"
    requirement: REMD-01
    verification:
      - kind: other
        ref: "live paymentReminderSend on gid://shopify/PaymentSchedule/47651782889 (order #1010, dueAt 2026-09-19, 716h out) — success:true, userErrors []"
        status: pass
    human_judgment: false
  - id: D3
    description: "E4: recipient resolution for a net-terms order with no purchasing company"
    verification:
      - kind: other
        ref: "live send on gid://shopify/PaymentSchedule/47661646057 (order #1013, no company) — success:true; payment_reminder_sent recipient fingerprint identical to that order's own confirmation recipient"
        status: pass
    human_judgment: false
  - id: D4
    description: "N1: one payment reminder per ORDER per 24 hours is a hard platform limit, and it is per-order rather than per-company"
    requirement: REMD-01
    verification:
      - kind: other
        ref: "re-send on order #1007 at 06:51:40Z (17.4h after its first) refused: 'You cannot send more than 1 payment reminders for the same order in a 24hour period'; a send on Acme's OTHER order #1002 one minute later succeeded"
        status: pass
    human_judgment: false
  - id: D5
    description: "Deliverability probe: every notification this store has ever emitted went to an RFC 2606 reserved domain"
    verification:
      - kind: other
        ref: "scripts/prod-reminder-recipients.sh credit-guard-demo.myshopify.com -> allRecipientsUndeliverable:true, 20/20 notifications to example.com, 3 distinct recipients"
        status: pass
    human_judgment: false
  - id: D6
    description: "E-fixture inventory in the committed read-only state probe"
    verification:
      - kind: other
        ref: "scripts/prod-reminder-state.sh credit-guard-demo.myshopify.com -> fixtures.counts all non-zero, emptyCategories []"
        status: pass
    human_judgment: false
  - id: D7
    description: "E1 email content, branding, sender and a clicked pay-now link reaching a payable page"
    requirement: REMD-02
    verification:
      - kind: manual_procedural
        ref: "human inbox pass — BLOCKED: the dev store delivers no customer-facing email to any provider (3 domains tried, order confirmations included). Logged to WINDOWS for the first production install or paid test store"
        status: unknown
    human_judgment: true
    rationale: "Email rendering and pay-link behaviour live entirely inside Shopify; only a human reading a delivered message can verify them, and no message can be delivered on this store."
  - id: D9
    description: "N3: the dev store delivers no customer-facing email — the failure is upstream of this app entirely"
    verification:
      - kind: other
        ref: "3 recipient domains (example.com/icloud.com/gmail.com), distinct fingerprints, first-party order confirmations recorded as mail_sent and never received; official Dev-stores Limitations page silent on email, help.shopify.com 403 from this environment"
        status: pass
    human_judgment: false
  - id: D10
    description: "Structural pay-now evidence: a payment-collection URL exists and is well-formed for both a past-due and a PRE-DUE order"
    requirement: REMD-02
    verification:
      - kind: other
        ref: "Order.paymentCollectionDetails.additionalPaymentCollectionUrl on #1014 and #1015 — identical shape <store>/<digits>/order_payment/<digits>?secret=...; fetched in-container, 403 51-byte stub consistent with the dev store's non-removable password page"
        status: pass
    human_judgment: false
    rationale: "PROXY for the link inside the email, never proof — the email's button is rendered by the notification template's own Liquid."
  - id: D11
    description: "E2 COPY: whether the default Payment reminder template branches on due state or is unconditionally overdue-phrased"
    requirement: REMD-01
    verification:
      - kind: other
        ref: "BLOCKED — help.shopify.com 403 from this environment; shopify.dev carries API reference only; no Admin API read surface for notification templates exists in the 2026-07 schema"
        status: unknown
    human_judgment: true
    rationale: "Decides whether 05-03 builds DUE_SOON at all. Needs a research agent with help.shopify.com access, or a merchant reading the template editor."
  - id: D8
    description: "E5: native payment reminders are off by default; default template copy recorded for 05-04"
    requirement: REMD-01
    verification:
      - kind: manual_procedural
        ref: "human read of Settings -> Notifications on credit-guard-demo"
        status: pass
    human_judgment: true
    rationale: "A notification-settings default has no API read surface (05-RESEARCH: schema sweep found none), so a human reading the admin is the only instrument."
duration: 2 sessions
completed: 2026-08-21
status: user_setup
---

# Phase 5 Plan 02: E1–E5 Empirical Proving Summary

**`paymentReminderSend` works exactly as designed, and no email it sends can be received on this store at all — the dev store delivers no customer-facing mail to any provider, order confirmations included. E3, E4, E5, N1 and N2 are conclusively answered; E1/E2 are proven at the API and recipient-resolution layers and are UNPROVABLE at the inbox layer here; the DUE_SOON copy question is UNDETERMINED and blocked on a document this environment cannot reach.**

## The central finding: the dev store does not deliver customer email

The mutation returned `success: true` with empty `userErrors`. Shopify wrote a `payment_reminder_sent` event onto each order's timeline, attributed to **Credit Guard: B2B Net Terms**, reading "Payment reminder email was sent to …". Every signal the API offers was green. Nothing was ever received.

This was diagnosed in two stages, and the first diagnosis was wrong-but-useful:

**Stage 1 — the fixture defect (real, and fixed).** Every customer on the store was a Shopify seeded sample contact on `example.com`, which RFC 2606 reserves and which has no mail exchanger. That fully explained the first round of silence, and it was a genuine defect: `scripts/prod-reminder-recipients.sh` now measures it in one command.

**Stage 2 — the store itself.** After the contacts were corrected, mail still did not arrive, across **three providers**:

| Recipient domain | Fingerprint | Notifications Shopify recorded as sent | Received |
|---|---|---|---|
| `example.com` (RFC 2606 reserved) | `4ca200bf67e1` | confirmations + 3 reminders | no — expected |
| `icloud.com` (real) | `1fae3633e7d0` | confirmations + 2 reminders (#1014, #1015) | **no** |
| `gmail.com` (real) | `63c475459040` | confirmation (#1016) | **no** |

The decisive detail is the **order confirmations**. Those are first-party Shopify notifications with no involvement from this app whatsoever, and they do not arrive either. The failure is therefore upstream of `paymentReminderSend`, upstream of `write_orders`, and upstream of anything this project controls.

**Status of the hypothesis: empirically strong, documentation-unconfirmed.** The official [Dev stores → Limitations](https://shopify.dev/docs/api/development-stores.md) page says dev stores "are intended for development and testing only… can't be used for production and can't process real transactions", and notably that "You can't remove the password page" — but it makes **no statement about notification email**. The page that would settle it lives on `help.shopify.com`, which returns **HTTP 403 to every request from this environment**, browser user-agent included. It was not circumvented. **Recommend routing the documentary confirmation to a research agent with web access.**

### What "sent" means, and the evidence standard this forces

The official [paymentReminderSend](https://shopify.dev/docs/api/admin-graphql/latest/mutations/paymentReminderSend.md) docs define `success` as "Whether the payment reminder email was successfully sent." This plan establishes empirically that **`success: true` means Shopify accepted the send and enqueued it — not that a mailbox received it.** No API surface distinguishes the two.

So for E1/E2 the honest evidence standard on this store is the conjunction of three signals:

1. `paymentReminderSend` returns `success: true` with empty `userErrors`;
2. a `payment_reminder_sent` event appears on the order timeline, attributed to this app;
3. that event's recipient fingerprint **equals the fingerprint of the order's own confirmation** — i.e. Shopify resolved the same mailbox it uses for first-party mail.

**This proves:** the app targets the right schedule, holds sufficient scope, and Shopify resolves a recipient and accepts the send. Our side of the contract is complete.

**This does not prove:** that a human receives a message, what the sender/branding/subject look like, or that the pay-now link reaches a payable page. Those are REMD-02/REMD-03 and they remain open, logged to WINDOWS for verification on the first production install or a paid test store.

## Evidence table

| Check | Question | Verdict | Evidence |
|-------|----------|---------|----------|
| **E1** | Does an open past-due schedule send, with the merchant's template and a working pay-now link? | **API + resolution PROVEN; content/link UNPROVABLE on this store** | `success:true, userErrors:[]` on #1007, #1002, #1014. #1014's `payment_reminder_sent` (07:22:54Z) resolved to the real `icloud.com` mailbox, fingerprint identical to that order's own confirmation. Nothing received — see the central finding. |
| **E2** | Does it send more than 3 days before `dueAt`? (A2, the riskiest unknown) | **API half PROVEN and NOT escalated; COPY UNDETERMINED** | `success:true, userErrors:[]` on #1010 (716h out) and #1015 (**720h / 30 days** before `dueAt`), the latter recipient-matched to its own confirmation. The mutation does not gate on proximity to `dueAt`. Whether the resulting email *reads* sensibly pre-due is unresolved — see below. |
| **E3** | What happens on a `completedAt != null` schedule? | **ANSWERED** | `success: **null**` (not `false`) + `userErrors:[{code: PAYMENT_REMINDER_SEND_UNSUCCESSFUL, field: null, message: "Payment schedule is already completed"}]`. Called twice — identical. No state change. |
| **E4** | Who receives a net-terms order with no purchasing company? | **ANSWERED** | `success:true` on #1013 (no company, Net 30). Its `payment_reminder_sent` recipient fingerprint is **identical to that order's own confirmation recipient** → falls back to the ORDER's customer. Never a refusal. |
| **E5** | Are native payment reminders on by default? | **ANSWERED — off** | Human read of Settings → Notifications: off until configured. Template preview: subject "Payment reminder for order #9999", headline "Your payment is 3 days overdue", a blue "Pay now" button, store branding present, footer offering the merchant's own reply address. |

### New findings the plan did not anticipate

| # | Finding | Why it matters |
|---|---------|----------------|
| **N1** | **One reminder per ORDER per 24 hours**, enforced by the platform: `"You cannot send more than 1 payment reminders for the same order in a 24hour period"` (same `PAYMENT_REMINDER_SEND_UNSUCCESSFUL` code, `success:null`). Proven per-**order**, not per-company: #1007 was refused while Acme's other order #1002 sent freely one minute later. | **Binding on 05-03.** Our claim primitive is `@@unique([shop, scheduleGid, touchpoint])` — per *schedule*. An order carrying two schedules can legitimately attempt two sends in one sweep, and the second **will be refused**. Retry backoff must exceed 24h; a minutes-scale retry of a FAILED row is guaranteed to fail again. |
| **N2** | **The recipient is snapshotted per order at creation.** After the contact's email was changed, a fresh send on an OLD order (#1002) still resolved to the old `example.com` address, while NEW orders (#1014/#1015, placed after the edit) resolved to the real `icloud.com` mailbox — a different fingerprint. | **Merchant-facing surprise, now proven.** A merchant who corrects a contact's email will still see every order already on the books dunned at the old address. Nothing in our code can change this — the app passes only a schedule GID (D5-01) — so it belongs in settings/help copy (05-04) rather than in the sweep. |
| **N3** | `Order.purchasingEntity`, `Order.email` and `Order.customer` are **ACCESS_DENIED** to this app. | The D5-01 no-PII posture is enforced by the platform, not merely by our discipline. It also means we cannot pre-check a recipient without buying into PCD — which we declined to do. |
| **N4** | `PaymentSchedule.amount` is **deprecated** in 2026-07 (`balanceDue` / `totalBalance` replace it). | No exposure: `ledger.server.ts` and `reconciliation.server.ts` already select `balanceDue`. |
| **N5** | The mutation has **no state-flip side effect**: `dueAt`, `completedAt` and `balanceDue` were re-read after every call and never moved. | Unlike `validationUpdate`, `paymentReminderSend` can be treated as a pure side-effecting send. |
| **N6** | Order #1012 ("Due on receipt" terms, no company) has **zero** payment schedules on Shopify's side. | "Due on receipt" produces no `PaymentSchedule`, so such an order can never be dunned — there is no GID to pass. The ledger's empty schedule list mirrors Shopify faithfully; it is not an ingestion bug. |

## Pay-now link: structural evidence, no click

`Order.paymentCollectionDetails.additionalPaymentCollectionUrl` ("The URL to use for collecting an additional payment on the order") was read for both new fixtures, and **fetched inside the Railway container** so the bearer URL never crossed the ssh boundary into a terminal or this file (T-05-07).

| Order | State | Pay URL present | Shape | GET |
|---|---|---|---|---|
| #1014 | past-due | **yes** | `<store>.myshopify.com/<11-digit>/order_payment/<13-digit>?secret=…` | 403, 51 bytes |
| #1015 | **due 2026-09-20 (pre-due)** | **yes** | identical shape | 403, 51 bytes |

Two things follow. First, **a pre-due order has a payment-collection URL of exactly the same form as a past-due one** — which is the structural half of the F-04 criterion: there is a real invoice/payment surface for an order whose payment is not yet due. Second, the 403 is a 51-byte stub from the store's own domain, which is consistent with the dev store's password page — the same docs that describe dev-store limits state "You can't remove the password page" — and **not** with a broken or expired link.

This is a **proxy, not proof**, recorded with the same discipline as 04-05's EC-2 namespace proxy: the button inside the reminder email is rendered by the notification template's own Liquid, and only a delivered message can show which URL it carries.

## Template analysis: BLOCKED, and this is the DUE_SOON blocker

The plan needed the default "Payment reminder" notification template's Liquid to answer whether its copy adapts to due state. It could not be obtained:

- **`help.shopify.com` returns HTTP 403** to every path from this environment, with and without a browser user-agent. Not circumvented.
- **`shopify.dev` is reachable** (and its `.md` variants are machine-readable — the `paymentReminderSend` and Dev-stores pages quoted above came from there) but carries **API reference only**; its sitemap contains no notification-template page.
- **There is no Admin API read surface for notification templates.** A sweep of the 2026-07 schema finds only `GiftCardSendNotification*` types and the `NotificationUsage` enum — confirming 05-RESEARCH's finding that notification settings and templates have no query surface.

What is on record is the merchant's own admin preview (E5): subject *"Payment reminder for order #9999"*, headline *"Your payment is 3 days overdue"*, body *"This is a reminder that your payment of $0.00 USD for order #9999 was due on August 17, 2026."*, a blue **Pay now** button, store branding present. That preview renders **sample data in which the order is overdue**, so it shows the template *can* say "overdue" — it does **not** show whether the Liquid branches on due state.

**Therefore DUE_SOON is neither green nor refuted.** The risk is unchanged and unquantified: if the copy is unconditional, a pre-due reminder tells a buyer their payment is overdue up to 30 days early, which is worse than sending nothing.

## Task commits

1. **Task 1: E-fixture inventory in the read-only state probe** — `f4d2fdb` (feat)
2. **Diagnosis: read-only deliverability probe** — `5033e62` (feat)
3. **This SUMMARY** — final metadata commit

Task 3's sends produced **no committed files by design**: every mutating probe ran from the session scratchpad over `railway ssh` and was never added to `scripts/` (T-05-08). `git status` stayed clean of probe files throughout.

## Deviations from Plan

**1. [Rule 3 — Blocking] Task 2's checkpoint was short-circuited, and that was a mistake**

- **Found during:** Task 1 → Task 3 transition
- **Issue:** Task 1's inventory reported `emptyCategories: []` — every E-fixture already existed — so the browser checkpoint appeared to have nothing to ask for. Its **step 1** (confirm the main contact is a readable inbox) was skipped along with it, on the strength of a relayed assertion that the contacts were the developer's own test inboxes. That assertion was false.
- **Cost:** four sends into an unreachable domain and one wasted human verification round.
- **Fix:** `scripts/prod-reminder-recipients.sh` now makes the check a one-command measurement instead of a human's recollection, and the README states the rule: run it *before* asking anyone to check an inbox.

**2. [Rule 3 — Blocking] The E4 fixture had to be created mid-flight**

- The store's only company-less payment-terms order (#1012) used "Due on receipt" and therefore had no schedule to send against (N6). A Net-30 company-less order (#1013) was requested from the developer and used instead.

**3. [Rule 2 — Missing critical capability] Recipient pre-check added as committed tooling**

- The plan had no artifact for "can this store receive mail?". Given it is the failure that invalidated the entire first verification round, it was added as a read-only probe rather than left as tribal knowledge.

**4. Probe ordering changed: E3 was run first, as the consent canary**

- The plan's precondition required proving the `write_orders` re-consent before Task 3. E3 (a completed schedule, expected to refuse and send nothing) was used as that canary: a clean userError instead of `ACCESS_DENIED` proved consent while emailing nobody. E1/E2 followed only after.

## Privacy posture

No email address, contact name or pay-now URL appears in any committed file. Event messages name their recipient in prose, so the probes mask every address before it can reach a terminal; the committed script reduces addresses to `sha256(per-run salt + address)` truncated to 12 hex characters plus the bare domain, which answers "same mailbox?" and "deliverable?" while leaving the address unrecoverable from a saved output. `Order.email` and friends were deliberately never queried (see key-decisions).

## Outstanding — what this plan did NOT prove

**REMD-02 and REMD-03 cannot be verified on this store at all.** Five reminders were accepted and recorded as sent across three recipient domains; none was received, and neither were the first-party order confirmations. Sender identity, branding, subject and the pay-now click-through all require a delivered message. Both are logged to `.planning/WINDOWS.md` as `unrun-verify` with their pre-launch procedures.

**The DUE_SOON touchpoint is not cleared yet.** E2 proved the API accepts a pre-due send; it did **not** prove the resulting email reads sensibly. The default template's headline is *"Your payment is 3 days overdue"* — if that copy is not state-varying, a DUE_SOON reminder would tell a buyer their payment is overdue up to 30 days **before** it is due, which is worse than sending nothing. **Only a delivered E2 email settles this**, and it is the deciding evidence for whether 05-03 builds DUE_SOON at all.

**The DUE_SOON copy question is UNDETERMINED, and it is the one thing blocking a clean Wave-3 go.** See "Template analysis" below.

## Self-Check: PASSED

- `scripts/prod-reminder-recipients.mjs` — FOUND
- `scripts/prod-reminder-recipients.sh` — FOUND
- `scripts/prod-reminder-state.mjs` — FOUND (fixtures block returns valid JSON against the live store)
- commit `f4d2fdb` — FOUND
- commit `5033e62` — FOUND
- `npm test` — 517 passed across 22 files (at floor; no source changes in this plan)
- `git status` — clean of probe files
