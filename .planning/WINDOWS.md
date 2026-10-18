---
schema_version: 1
open_count: 8
waived_count: 1
fixed_count: 23
total_count: 32
last_updated: 2026-09-10T10:22:38.269Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 02 | unrun-verify | README.md |  | Empirical dev-store checks (backfill-vs-admin, A2, A7, A7b) not run — blocked by the PCD + read_all_orders Partner gates | fixed | Superseded/closed 2026-08-19: D9 backfill-vs-admin user-verified to the cent; A7 __parentId resolved from live JSONL; A7b covered by live webhook processing; A2 residual tracked as #4. | 2026-08-19T04:41:37.496Z | 2026-08-19T13:20:00.000Z |
| 2 | 02 | unrun-verify | shopify.app.toml |  | App registration not published: shopify app deploy blocked by protected-customer-data approval and the read_all_orders access request (both Partner Dashboard, browser-only) | fixed | 2026-08-19: PCD configured (Level 1, no protected customer fields) + read_all_orders granted; version credit-guard-net-terms-4 created and RELEASED; 15 topics + CF-1 scopes live. | 2026-08-19T04:41:47.915Z | 2026-08-19T13:20:00.000Z |
| 3 | 02 | deviation | app/routes/webhooks.orders.tsx |  | SessionNotFoundError on a post-uninstall delivery returns 500 and is retried by Shopify for ~48h; a named-error acknowledge-and-drop path is the follow-up | fixed | Closed 2026-08-21 (06-03): SessionNotFoundError acknowledge-and-drop on all three ingest routes (webhooks.orders/companies/payment-terms) — named-error catch logs the drop and returns 200 so Shopify stops retrying; transient failures still 500/retry. Verified in code at cc23664 by the phase verifier. | 2026-08-19T04:41:47.999Z | 2026-08-21T16:30:00.000Z |
| 4 | 02 | unmet-truth |  |  | A2 partial-pay->refund check not reproducible: partial payments are Plus-only; close on a Plus-emulation dev store before launch | waived | Accepted 2026-08-19: ICP is Basic/Grow/Advanced where partial payments are unavailable; ledger reads Shopify financial status rather than tracking payments. Pre-launch task: run A2 on a Plus-emulation dev store. | 2026-08-19T09:45:00.000Z |  |
| 5 | 02 | fixme | app/services/ledger.server.ts | 364 | purchasingEntity requires read_customers -> exposure permanently 0.0000; errors[] discarded. Remedy: company-side attribution (02-06..08) | fixed | Closed 2026-08-19 post-tap: company-driven backfill attributed 8/8 orders on the live shop; Acme 3229.95 overdue=true (past-due flip proven live), Northwind 1874.95 == admin exactly; no read_customers anywhere; verifier re-derived source guards 9/9 green. | 2026-08-19T10:15:00.000Z | 2026-08-19T13:20:00.000Z |
| 6 | 02 | skipped-test | tests/graphql-error-surfacing.test.ts |  | it.fails debt: BACKFILL_ORDERS_DOCUMENT still selects scope-trapped purchasingEntity — 02-07 removes it and flips the guard to it() | fixed | 2026-08-19 (02-07): BACKFILL_ORDERS_DOCUMENT deleted with the bulk machinery; guard flipped to a hard-green module scan. | 2026-08-19T11:58:00.000Z | 2026-08-19T12:35:00.000Z |
| 7 | 02 | skipped-test | tests/graphql-error-surfacing.test.ts |  | it.fails debt: ORDERS_UPDATED_SINCE_QUERY still selects scope-trapped purchasingEntity — 02-08 removes it and flips the guard to it() | fixed | 2026-08-19 (02-08): purchasingEntity deleted; reconciliation rebuilt on graphqlJson with attribution pass; source-guard hard-green across all three services. | 2026-08-19T11:58:00.000Z | 2026-08-19T12:58:00.000Z |
| 8 | 02 | fixme |  |  | HTTP access log (react-router-serve/morgan) prints full request URLs incl. live id_token session JWTs into Railway logs. Sentry scrubbing does not cover access logs. Same leak class as T-01-07. Fix: strip/redact query strings in the request logger (quick task). | fixed | Closed 2026-08-22 (06-03 fix, 06-07 live check): pre-boot scrubber app/access-log-redact.mjs installed FIRST in instrument.server.mjs wraps the stream morgan writes to. Live Railway log store after the drive: 17/17 id_token=[redacted], grep -Ec "id_token=eyJ" = 0, hmac/session scrubbed alongside. | 2026-08-19T12:40:00.000Z | 2026-08-22T08:20:00.000Z |
| 9 | 03 | unrun-verify | app/routes/app.companies.tsx |  | Companies page browser UAT COMPLETE (2026-08-20, user on credit-guard-demo). Confirmed live: all four companies rendered with names not GIDs (the a4a1f2c rename-fix regression check PASSES); badges correct; bypass toggle round-trips; and the limit intent set/edit/clear cycle works through the real form action (set 1500.00 -> over-limit badge, edit to 1874.95 -> within-limit at the exact at-limit boundary, clear -> observe-only). Metafields followed each change: read-back at 2026-08-20 shows all surviving companies field-matched with dirtyPublishes 0. CAVEAT: the clear/removal step was performed on Powderbound, which the user then deleted in the Shopify admin (genuine COMPANIES_DELETE webhook, processed 18:42:20.645Z), so that step rests on the human observation rather than a surviving live artifact. | fixed |  | 2026-08-19T18:05:00.000Z | 2026-08-20T00:00:00.000Z |
| 10 | 04 | fixme | app/services/reconciliation.server.ts |  | Exhaustion flip starves on the shop's NEWEST unattributable net-terms order: the cursor advances to (newest updatedAt minus the 5-minute overlap), so that order is re-paged by every sweep, its refetchedAt is refreshed, and the flip's `refetchedAt < sweepStart` gate never admits it. Observed live 2026-08-20 on order #1012 (companyless, carries Net 30): two consecutive reconcileShop runs both reported flippedNoCompany 0, pinning the shop's data_complete false until a newer order arrives. ENFORCEMENT IS UNAFFECTED - the Function deliberately does not read data_complete (D-04) - so this is observability, not a checkout risk. Pre-existing Phase-2/3 reconciliation semantics; out of scope for 04-05 (scope boundary). | fixed | Closed 2026-08-23 live (06-03 fix, first unattended cron tick on fixed code): flip gate widened with the scannedGids arm — a row the sweep's OWN scan refreshed is provably unattributable by evidence newer than its refetch. 03:30Z tick flipped #1012/#1013: attributed 15 / unresolved 0 / noCompany 2, dataComplete true (probe 09:48Z). Independently re-probed 2026-08-24 by the phase verifier: still 15/0/2, dataComplete true. | 2026-08-20T10:50:00.000Z | 2026-08-23T09:48:00.000Z |
| 11 | 04 | unrun-verify | extensions/credit-guard-validation/src/cart_validations_generate_run.ts |  | EC-1 decimal-format capture not performed: the optional checkpoint step 9 (Partner Dashboard -> Function runs -> read cart.cost.totalAmount from a real run input) was skipped by the human. EC-1's substance is proven behaviourally - a real Northwind checkout was blocked, which is impossible unless the USD currency compare matched - but the exact `amount` decimal-place format (04-RESEARCH Open Question 2) remains unobserved. cartCents normalization handles it defensively either way. | open |  | 2026-08-20T10:50:00.000Z |  |
| 12 | 04 | fixme | app/services/enforcement.server.ts |  | TOCTOU window in the validationUpdate echo-flags fix (19b5946): flags are read immediately before the write; a merchant toggling the rule in checkout settings inside that window has their toggle reverted by the echo. Platform offers no CAS on validationUpdate. Outcome is a VISIBLE reversion (status banner shows it), not silent disablement — low severity. Found by 04-VERIFICATION (W1); acknowledged nowhere in code comments — add one. | fixed | Closed 2026-08-22 (06-02): TOCTOU acknowledged at the echo site (enforcement.server.ts "WINDOWS #12 — TOCTOU, acknowledged" comment). Comment-only by design — the platform offers no CAS on validationUpdate, and the reversion stays visible in the status banner. This entry asked for exactly that acknowledgement. | 2026-08-20T11:20:00.000Z | 2026-08-22T04:00:00.000Z |
| 13 | 04 | unrun-verify |  |  | No live overdue-ONLY block was ever staged (a company overdue but under limit, blocked at a real checkout). The overdue path is proven by unit tests and real-wasm fixture runs; the live matrix covered over-limit block, bypass allow, observe-only allow, D2C. Within SC3's declared live scope per 04-VERIFICATION (W2), but a pre-launch dev-store check is cheap: make a company overdue with limit null and attempt checkout. | fixed | Closed 2026-08-22 live (06-07): BLOCK_STATE_ENTERED for Acme Supply at 07:56:59.388Z with overdue:true, exposure 5345.80 < limit 6000.00 — overdueness alone drove the hold — and the developer, logged in as Acme's contact, saw the shipped overdue message verbatim at a real net-terms checkout. Fixtures restored and probe-verified (BLOCK_STATE_EXITED + BYPASS_ENABLED, dirtyPublishes 0). | 2026-08-20T11:20:00.000Z | 2026-08-22T07:56:59.388Z |
| 14 | 05 | unrun-verify | .planning/phases/05-payment-reminders/05-02-SUMMARY.md |  | REMD-02/REMD-03 unverified: no reminder email has reached a readable inbox, so sender/branding/subject and the pay-now click-through are unproven | fixed | 2026-08-21 — closed on the delivered #1015 reminder (user-exported PDF, read by the orchestrator): DUE_SOON headline "Your payment is due in 30 days" on a pre-due invoice; sender "Credit Guard Demo" via Shopify relay with reply-to the merchant; Pay now button present. #1014 receipt also human-confirmed (body not inspected). | 2026-08-21T06:55:29.492Z | 2026-08-21T11:13:46.574Z |
| 15 | 05 | unmet-truth | .planning/phases/05-payment-reminders/05-02-SUMMARY.md |  | DUE_SOON touchpoint undecided: E2 is API-green but the default Payment reminder template copy is overdue-phrased; a delivered pre-due email is the deciding evidence for 05-03 | fixed | 2026-08-21 — closed on the delivered #1015 reminder (user-exported PDF, read by the orchestrator): DUE_SOON headline "Your payment is due in 30 days" on a pre-due invoice; sender "Credit Guard Demo" via Shopify relay with reply-to the merchant; Pay now button present. #1014 receipt also human-confirmed (body not inspected). | 2026-08-21T06:55:29.582Z | 2026-08-21T11:13:46.671Z |
| 16 | 05 | unrun-verify | .planning/phases/05-payment-reminders/05-02-SUMMARY.md |  | Inbox delivery of reminder email unproven: the dev store delivers no customer-facing mail (3 providers, order confirmations included). Verify on first production install or a paid test store: send one reminder, confirm arrival, check sender/branding/subject | fixed | 2026-08-21 — closed on the delivered #1015 reminder (user-exported PDF, read by the orchestrator): DUE_SOON headline "Your payment is due in 30 days" on a pre-due invoice; sender "Credit Guard Demo" via Shopify relay with reply-to the merchant; Pay now button present. #1014 receipt also human-confirmed (body not inspected). | 2026-08-21T08:02:27.323Z | 2026-08-21T11:13:46.787Z |
| 17 | 05 | unrun-verify | .planning/phases/05-payment-reminders/05-02-SUMMARY.md |  | REMD-02 pay-now click-through unproven: order_payment URL exists and is well-formed for both past-due and pre-due orders, but the dev store's non-removable password page returns 403. Click it on a non-dev store and confirm a payable page | fixed | 2026-08-21 — user clicked Pay now in the delivered #1015 reminder and landed on a Shopify checkout page identifying the invoice (page text: "Acme Supply", line item "The Complete Snowboard", "Total due USD $664.95"), exported as PDF and read by the orchestrator. Payment was not completable: the page reads "This store can't accept payments right now." (dev-store limitation — interpretation). Completion itself remains open as entry 18. | 2026-08-21T08:02:27.418Z | 2026-08-21T12:07:32.994Z |
| 18 | 05 | unrun-verify | .planning/phases/05-payment-reminders/05-05-SUMMARY.md |  | Pay-now PAYMENT COMPLETION unproven: the order_payment URL exists and is well-formed for pre-due and past-due orders and answers 302 when fetched in-container, but no payment has ever been completed through a reminder's Pay now link. Complete one on a store with a payment gateway before launch | open |  | 2026-08-21T11:14:02.611Z |  |
| 19 | 05 | unrun-verify | .planning/phases/05-payment-reminders/05-05-SUMMARY.md |  | Reminder-email delivery is DELAYED AND VARIABLE on the dev store, not suppressed (supersedes 05-02 N3): two reminders issued ~30s apart arrived ~3.5h (#1015) and ~5h (#1014) after send, both human-confirmed; order confirmations similarly delayed. Informational — confirm normal-latency delivery on a paid-plan store with a verified sender domain before launch | open |  | 2026-08-21T11:14:02.700Z |  |
| 20 | 05 | fixme | app/services/reminders.server.ts |  | 05-VERIFICATION W1: late retry of an outranked touchpoint — retriableRow re-claims a FAILED DUE_SOON row after DUE was already SENT on the same schedule, chasing the lower moment >=25h later (buyer gets "due in 3 days" after "due today"). No spec covers it. Fix: fence on a SENT/SENT_UNCONFIRMED higher-severity sibling and mark SUPPRESSED_STALE. | fixed | Closed 2026-08-22 (06-02): severity fence — retriableRow classifies a FAILED row outranked by a SENT/SENT_UNCONFIRMED higher-severity sibling as "outranked" and the sweep marks it SUPPRESSED_STALE instead of sending (reminders.server.ts outrankedBySentSibling + the WINDOWS #20 comment at the retire site); true-RED regression tests in tests/reminders.test.ts. Verified in code at cc23664. | 2026-08-21T15:20:00.000Z | 2026-08-22T04:00:00.000Z |
| 21 | 05 | fixme | app/services/reminders.server.ts |  | 05-VERIFICATION W2: LedgerGraphqlError narrowing is broader than its justification — graphqlJson throws on ANY top-level errors[] before reading data; a 200-with-errors INTERNAL_SERVER_ERROR on paymentReminderSend is ambiguous (may have sent) yet is treated as definitively-not-sent and retried after 25h. Damage bounded by the platform per-order 24h limit. Fix: key on extensions.code — only ACCESS_DENIED/validation-class codes are retriable; unknown codes -> SENT_UNCONFIRMED. | fixed | Closed 2026-08-22 (06-02): closed retriable-code set — only ACCESS_DENIED/validation-class extensions.code values stay retriable; unknown/ambiguous send errors land SENT_UNCONFIRMED (terminal, counts exactly as SENT for dedupe/suppression, stamps sentAt). Verified in reminders.server.ts at cc23664. | 2026-08-21T15:20:00.000Z | 2026-08-22T04:00:00.000Z |
| 22 | 05 | fixme | app/routes/app.settings.tsx |  | 05-VERIFICATION W3: merchant copy overstates eligibility — "Each unpaid invoice is chased" but only company-attributed orders are (v1 company-only choice, 05-03). Also README reminders section omits the limitation. Fix: one clause in the settings card + README. | fixed | Closed 2026-08-22 (06-02): settings card states the company-only limit verbatim ("Only net-terms orders attributed to a company in Credit Guard are chased — orders with no purchasing company aren't emailed"), README § reminders states it too, and both surfaces compose cadence copy from the shared REMINDERS_CADENCE constant. Verified at cc23664. | 2026-08-21T15:20:00.000Z | 2026-08-22T04:00:00.000Z |
| 23 | 06 | deviation | listing/screenshots/S4.png |  | Screenshot 4 on the LIVE App Store listing carries customer PII (customer name, email, street address, phone + staff name legible behind the draft-order "Unresolved business rules" modal), found 2026-08-24 after submission. Repo copy cropped at 1ee6b34 (moved screenshots/ -> listing/screenshots/ at b8b8809); uncropped file remains in git history at 57fb1a4 (private repo). UPDATE 2026-09-04: review ended — v1.0.0 approved and listed at https://apps.shopify.com/credit-guard-b2b-net-terms — so the listing is editable now. BUT the repo crop listing/screenshots/S4.png is 600×290 and the App Store requires 1600×900, so S4 must be RETAKEN at 1600×900 (PII-free framing, same shot-list position per 06-LISTING §10.3) before the swap; the PII screenshot stays live until the retake lands. First post-launch action. UPDATE 2026-09-04 (later): S4 retaken at 1600×900 and the buyer name, email, street, city and phone replaced by placeholders (commit aab1fb1, listing/screenshots/S4.png); the ONLY remaining step is uploading it to the listing in the Partner Dashboard, which the developer chose to defer. | fixed | S4 retaken at 1600×900 with all buyer fields replaced by fictitious placeholders (aab1fb1) and uploaded to the live listing by the developer on 2026-09-04; listing saved. | 2026-08-24T05:30:00.000Z | 2026-09-04T04:03:21.086Z |
| 24 | 06 | fixme | app/services/onboarding.server.ts |  | 06-07 F2: the review-prompt result code is not persisted — recordReviewPromptResult stamps reviewPromptedAt and discards the code, and the POST body is not in the access log. The app can prove it asked and never re-asked, but not what Shopify answered (success vs merchant-ineligible vs cooldown vs error). Cheap fix: nullable reviewPromptResult column or a log line; schema change, its own small plan. | open |  | 2026-08-24T05:30:00.000Z |  |
| 25 | 06 | fixme | tests/reminders.test.ts |  | Flake: "only ONE schedule per sweep" is order-dependent on a reused test DB (fails on a pristine tree too, per 06-08 Task 2 gate). Green on the 2026-08-24 phase-verification run (838/838). Wants a fixture-isolation pass; not a product defect. | open |  | 2026-08-24T05:30:00.000Z |  |
| 26 | 06 | fixme | tests/review-prompt.test.ts |  | Flake: "ask after a success moment" exceeded its 5s timeout (5259ms) when the suite ran concurrently with a build; green in isolation and on the 2026-08-24 phase-verification run. Raise the timeout or isolate; not a product defect. | open |  | 2026-08-24T05:30:00.000Z |  |
| 27 | 06 | deviation | app/routes/app._index.tsx |  | Cosmetic: the guided setup's third step renders its completion tick above rather than beside its heading (SetupRow inline-stack alignment; observed in the 06-08 asset session). Desktop listing screenshots shipped without a visible defect. Low priority. | open |  | 2026-08-24T05:30:00.000Z |  |
| 28 | 06 | skipped-test | vitest.config.ts |  | Suite is residue-sensitive on the shared creditguard_test database: several files assert EXACT call/row counts and vitest runs files serially against one DB, so rows left by an earlier session can make count assertions fail (observed 2026-08-24 by two separate agents: tests/scheduler.test.ts PUBLISH count read 4 instead of 2; identical reruns clean, no code changed). Root of the #25/#26 flake class. VERIFIED 2026-08-24: a pristine scratch DB named creditguard_test_verify runs 838/838 clean, so the code is sound and only the shared fixture DB is at fault. Note tests/helpers/webhook-hmac.test.ts guards that the suite only ever points at a DB whose name contains creditguard_test - honour that when creating scratch DBs. Fix: per-run scratch DB (or a truncate in global setup) rather than a reused creditguard_test. | open |  | 2026-08-24T08:45:00.000Z |  |
| 29 | 06 | unmet-truth | .planning/phases/06-dashboard-onboarding-launch/06-LISTING.md | 292 | Reviewer walkthrough step 6 (pasted into the Partner Dashboard App testing information) and screencast beat 5 say "Prepaying by card is deliberately still allowed — the app stops the credit, not the sale." This is FALSE: the validation Function targets $.cart and holds the whole checkout for an enforced purchasing company (decision steps 1, 7, 12 in cart_validations_generate_run.ts); the input carries no payment selection, and 04-RESEARCH §Net-Terms Path Detection already established that a terms-bearing B2B checkout collects no payment (no card choice; deposits Plus-only; Pay now is post-order). Accurate statement: the held company cannot complete a new checkout; buyers can still settle open invoices via Pay now, which clears the hold; companies paying at checkout without terms carry no exposure and are unaffected. Found 2026-09-05 by the marketing thread; the live listing copy ("can’t complete a new net-terms checkout") is already correct. To close: edit the App testing information notes in the Partner Dashboard, re-record or annotate the screencast, and reword REQUIREMENTS ENFC-01 / PROJECT.md ("prepay-by-card stays open"). | fixed | Partner Dashboard App testing information edited by the developer 2026-09-05 (card-prepay sentence removed). The screencast has NO narration, so it never carried the claim — the beat list in 06-LISTING §6 was a script that was not voiced. REQUIREMENTS ENFC-01, PROJECT.md and 06-LISTING step 6 reworded in 609b589; playbook artifact corrected the same day. Live listing copy was always correct. | 2026-09-05T07:47:11.639Z | 2026-09-05T09:46:28.231Z |
| 30 | 06 | fixme | app/services/scheduler.server.ts | 140 | Six of the seven Shop rows marked active have EXPIRED offline tokens that the app cannot refresh (expiringOfflineAccessTokens is on; Admin API answers 401 "Invalid API key or access token" — credit-guard-demo-2’s was merely expired and refreshed itself once the developer opened the app on 2026-09-10; the five reviewer stores are gone, so their refresh fails for good): the three app-review-24e52439-* automated-review stores (installed 2026-08-24), eztcd0-3u and 0j1uwb-00 (installed 2026-09-01, almost certainly the manual reviewer’s stores; eztcd0-3u placed 5 orders on terms and enabled reminders), and credit-guard-demo-2 (still delivering webhooks daily, so installed but unconsented after the write_orders scope release). None has uninstalledAt set — no app/uninstalled delivery was ever processed for any of them, and the compliance log is empty (no shop/redact ever landed). Consequences: forEachActiveShop runs the hourly publish, hourly reminder sweep and daily reconciliation against all six every cycle and each attempt fails at the first Admin call (swallowed per-shop, Sentry noise, wasted calls); retained ledger data for stores that no longer exist (eztcd0-3u: 3 companies, 5 orders, 22 enforcement events). Found 2026-09-10 while investigating the Partner Dashboard webhook-failure metric. Fix candidate (v1.0.1): treat a 401 invalid-token response from a shop’s Admin API as an uninstall signal — deactivateShop after N consecutive sweep failures — per Shopify’s guidance that a revoked token means the app is no longer installed; plus a one-off cleanup of the five dead review stores. demo-2 needs the developer to open the app once and accept the scope prompt. | fixed | Fixed in v1.0.1 by d9b6bc9 (feat(scheduler)): app/services/token-health.server.ts counts token-class failures at the admin seam (app/services/admin-client.server.ts) — refresh -> Response 500, HttpResponseError 400 invalid_subject_token, Admin API HttpResponseError 401, and NOTHING else. Strikes are time-gated to one per 30-minute window with a fixed anchor, so one hourly sweep's burst over N companies counts once (graphqlJson builds a client per call) and a live merchant cannot be deactivated by a single bad minute; three strikes in separate sweep cycles run deactivateShop + delete the session rows + clear the counter, emitting one console.log and one Sentry captureMessage tagged windows:30. Any resolved graphql() call resets the counter (including a 200 carrying GraphQL errors[] such as ACCESS_DENIED), bounded to one DELETE per shop per process. Regression tests: tests/admin-token-health.test.ts, 10 tests — 'classifies exactly the three token-class failures', 'three strikes in three separate windows deactivate the shop on the third and delete its sessions', 'repeated failures inside one sweep window count once', 'a successful Admin call resets the counter', 'confirms a shop healthy once per process', 'a non-token error never increments the counter or deactivates', 'bookkeeping never masks the original error', plus the seam source guard. POST-DEPLOY VERIFICATION STILL OWED: within three hourly sweep cycles (~2-3 h) of deploy, the 'Deactivated ... (WINDOWS #30)' line must appear for the five dead reviewer stores — one strike per cycle, never three from a single sweep — and scripts/prod-lifecycle-state.sh must show them inactive with zero sessions; credit-guard-demo-2 must reactivate when the developer opens the app. POST-DEPLOY 2026-09-10T10:1xZ: on the developer’s instruction the five reviewer stores (eztcd0-3u, 0j1uwb-00, app-review-24e52439-r75107-a0, -r75108-a0-victim, -r75108-a0-primary) were hard-deleted in production by a one-off read-then-delete script mirroring redactShop’s table order (all counts zero afterwards; only credit-guard-demo and credit-guard-demo-2 remain, both active). Shopify had already exhausted its shop/redact retries for them, so no further delivery would have triggered the fixed handler. | 2026-09-10T06:54:25.999Z | 2026-09-10T09:50:34.649Z |
| 31 | 06 | fixme | app/routes/webhooks.compliance.tsx | 27 | ROOT CAUSE FOUND 2026-09-10 (Dev Dashboard log + local reproduction). The 3/5 Sep failures are shop/redact deliveries for reviewer store eztcd0-3u answering HTTP 500 — Shopify retried 9× (first attempt 2026-09-05T19:25:18Z, attempt shown "Delivery attempt 1", 357 ms). Mechanism: app/shopify.server.ts enables future.expiringOfflineAccessTokens, so every offline session carries `expires` (~hours) and a 90-day refreshToken. The library’s authenticate.webhook calls ensureValidOfflineSession → ensureOfflineTokenIsNotExpired BEFORE the handler runs; when a session row exists, is expired, and has a refreshToken, it calls Shopify to refresh — for a store that was deleted without ever sending app/uninstalled (the reviewer stores) the refresh fails and helpers/refresh-token.mjs throws `new Response(undefined,{status:500})`. The redact handler never executes, Shopify sees a 500, retries for 48h, and the store’s data is never redacted. Reproduced locally: seeded shop + expired session with refreshToken + ledger rows, signed shop/redact → 500, rows intact; same seed without a refreshToken → 200 and rows deleted. The same path can 500 an app/uninstalled delivery whenever the stored session is already stale at uninstall time. Fix (v1.0.1 hotfix): make webhooks.compliance.tsx and webhooks.app.uninstalled.tsx validate with the library’s low-level `shopify.api.webhooks.validate({rawBody, rawRequest})` (real HMAC, no session load, no refresh) instead of authenticate.webhook — neither route needs a session — and add a regression test with an expired+refreshable session; separately (#30) treat an unrefreshable token in the sweeps as an uninstall signal so the stale session rows disappear. | fixed | Fixed in v1.0.1 by d80e362 (shop/redact) and 6c25997 (app/uninstalled). The app object does NOT expose its internal `api`, so `shopify.api.webhooks.validate` from the fix note does not exist; the sanctioned replacement is one validation-only shopifyApi() instance in app/shopify.server.ts (same env vars as the main config, logger level Warning, exported only as `validateWebhook`) behind app/services/webhook-validate.server.ts, which mirrors the library authenticator's 405/401/400 contract byte-for-byte, reads the raw body exactly once, and loads no session. Both routes now call validateWebhookRequest; neither references `authenticate` at all. @shopify/shopify-api declared direct at 13.1.0 (already present transitively; zero new integrity lines in the lockfile). Regression tests: tests/webhooks.compliance.test.ts 'answers 200 and redacts when the stored offline token is expired but refreshable (WINDOWS #31)' (RED first: 500 with rows intact), 'answers 405 to a non-POST request', 'answers 400 when the HMAC is valid but a required header is missing', 'both webhook routes verify through validateWebhookRequest, never the session-loading authenticator (WINDOWS #31)'; tests/shop-lifecycle.test.ts 'answers 200, deletes an expired refreshable session and deactivates the shop (WINDOWS #31)' and 'zeroes every counted table when the stored token is expired but refreshable'. The three forged-HMAC 401 tests (T-01-10) pass unchanged — HMAC verification is still the library's own timing-safe validator and is never mocked. POST-DEPLOY VERIFICATION STILL OWED: the next shop/redact delivery for a dead store must show 200 in the Dev Dashboard webhook log (currently 9 retried 500s for eztcd0-3u since 2026-09-05T19:25Z). POST-DEPLOY 2026-09-10T10:1xZ: on the developer’s instruction the five reviewer stores (eztcd0-3u, 0j1uwb-00, app-review-24e52439-r75107-a0, -r75108-a0-victim, -r75108-a0-primary) were hard-deleted in production by a one-off read-then-delete script mirroring redactShop’s table order (all counts zero afterwards; only credit-guard-demo and credit-guard-demo-2 remain, both active). Shopify had already exhausted its shop/redact retries for them, so no further delivery would have triggered the fixed handler. | 2026-09-10T06:54:25.999Z | 2026-09-10T09:50:34.475Z |
| 32 | 06 | fixme | app/services/shop-lifecycle.server.ts | 56 | redactShop does not delete EnforcementEvent rows, and countsFor in tests/shop-lifecycle.test.ts does not count them — exactly the two-sided redaction-contract gap the working guide warns about. Reproduced 2026-09-10: after a successful shop/redact the shop row is gone but 1 EnforcementEvent (companyGid + companyName, merchant data about a buyer relationship) remains. Fix with #31 in the same hotfix: add enforcementEvent.deleteMany to the transaction (before company rows, matching the reminderLog placement) and a counter to countsFor. | fixed | Fixed in v1.0.1 by a82997e (fix(lifecycle)). redactShop's $transaction now carries db.enforcementEvent.deleteMany immediately after reminderLog and before the ledger rows it names by GID (both are snapshot trails with no foreign key). The test side is closed too, which is the half that would have caught it: countsFor gained enforcementEvents, EMPTY_COUNTS gained enforcementEvents: 0, wipe deletes them, and seedLedger seeds a BLOCK_STATE_ENTERED row — so 'deletes every shop-keyed ledger table's rows (Phase 2 models)' now guards `before.enforcementEvents === 1` and the bystander test asserts the row survives for another shop. RED was observed first: with only the test hunks applied that test failed on enforcementEvents: 1. POST-DEPLOY VERIFICATION STILL OWED: scripts/prod-enforcement-events.sh must show 0 rows for a redacted shop (eztcd0-3u currently retains 22). | 2026-09-10T08:50:28.417Z | 2026-09-10T09:50:34.562Z |

````json
[
  {
    "id": 1,
    "kind": "unrun-verify",
    "phase": "02",
    "file": "README.md",
    "line": null,
    "description": "Empirical dev-store checks (backfill-vs-admin, A2, A7, A7b) not run — blocked by the PCD + read_all_orders Partner gates",
    "status": "fixed",
    "reason": "Superseded/closed 2026-08-19: D9 backfill-vs-admin user-verified to the cent; A7 __parentId resolved from live JSONL; A7b covered by live webhook processing; A2 residual tracked as #4.",
    "recorded_at": "2026-08-19T04:41:37.496Z",
    "resolved_at": "2026-08-19T13:20:00.000Z"
  },
  {
    "id": 2,
    "kind": "unrun-verify",
    "phase": "02",
    "file": "shopify.app.toml",
    "line": null,
    "description": "App registration not published: shopify app deploy blocked by protected-customer-data approval and the read_all_orders access request (both Partner Dashboard, browser-only)",
    "status": "fixed",
    "reason": "2026-08-19: PCD configured (Level 1, no protected customer fields) + read_all_orders granted; version credit-guard-net-terms-4 created and RELEASED; 15 topics + CF-1 scopes live.",
    "recorded_at": "2026-08-19T04:41:47.915Z",
    "resolved_at": "2026-08-19T13:20:00.000Z"
  },
  {
    "id": 3,
    "kind": "deviation",
    "phase": "02",
    "file": "app/routes/webhooks.orders.tsx",
    "line": null,
    "description": "SessionNotFoundError on a post-uninstall delivery returns 500 and is retried by Shopify for ~48h; a named-error acknowledge-and-drop path is the follow-up",
    "status": "fixed",
    "reason": "Closed 2026-08-21 (06-03): SessionNotFoundError acknowledge-and-drop on all three ingest routes (webhooks.orders/companies/payment-terms) — named-error catch logs the drop and returns 200 so Shopify stops retrying; transient failures still 500/retry. Verified in code at cc23664 by the phase verifier.",
    "recorded_at": "2026-08-19T04:41:47.999Z",
    "resolved_at": "2026-08-21T16:30:00.000Z"
  },
  {
    "id": 4,
    "kind": "unmet-truth",
    "phase": "02",
    "file": "",
    "line": null,
    "description": "A2 partial-pay->refund check not reproducible: partial payments are Plus-only; close on a Plus-emulation dev store before launch",
    "status": "waived",
    "reason": "Accepted 2026-08-19: ICP is Basic/Grow/Advanced where partial payments are unavailable; ledger reads Shopify financial status rather than tracking payments. Pre-launch task: run A2 on a Plus-emulation dev store.",
    "recorded_at": "2026-08-19T09:45:00.000Z",
    "resolved_at": null
  },
  {
    "id": 5,
    "kind": "fixme",
    "phase": "02",
    "file": "app/services/ledger.server.ts",
    "line": 364,
    "description": "purchasingEntity requires read_customers -> exposure permanently 0.0000; errors[] discarded. Remedy: company-side attribution (02-06..08)",
    "status": "fixed",
    "reason": "Closed 2026-08-19 post-tap: company-driven backfill attributed 8/8 orders on the live shop; Acme 3229.95 overdue=true (past-due flip proven live), Northwind 1874.95 == admin exactly; no read_customers anywhere; verifier re-derived source guards 9/9 green.",
    "recorded_at": "2026-08-19T10:15:00.000Z",
    "resolved_at": "2026-08-19T13:20:00.000Z"
  },
  {
    "id": 6,
    "kind": "skipped-test",
    "phase": "02",
    "file": "tests/graphql-error-surfacing.test.ts",
    "line": null,
    "description": "it.fails debt: BACKFILL_ORDERS_DOCUMENT still selects scope-trapped purchasingEntity — 02-07 removes it and flips the guard to it()",
    "status": "fixed",
    "reason": "2026-08-19 (02-07): BACKFILL_ORDERS_DOCUMENT deleted with the bulk machinery; guard flipped to a hard-green module scan.",
    "recorded_at": "2026-08-19T11:58:00.000Z",
    "resolved_at": "2026-08-19T12:35:00.000Z"
  },
  {
    "id": 7,
    "kind": "skipped-test",
    "phase": "02",
    "file": "tests/graphql-error-surfacing.test.ts",
    "line": null,
    "description": "it.fails debt: ORDERS_UPDATED_SINCE_QUERY still selects scope-trapped purchasingEntity — 02-08 removes it and flips the guard to it()",
    "status": "fixed",
    "reason": "2026-08-19 (02-08): purchasingEntity deleted; reconciliation rebuilt on graphqlJson with attribution pass; source-guard hard-green across all three services.",
    "recorded_at": "2026-08-19T11:58:00.000Z",
    "resolved_at": "2026-08-19T12:58:00.000Z"
  },
  {
    "id": 8,
    "kind": "fixme",
    "phase": "02",
    "file": "",
    "line": null,
    "description": "HTTP access log (react-router-serve/morgan) prints full request URLs incl. live id_token session JWTs into Railway logs. Sentry scrubbing does not cover access logs. Same leak class as T-01-07. Fix: strip/redact query strings in the request logger (quick task).",
    "status": "fixed",
    "reason": "Closed 2026-08-22 (06-03 fix, 06-07 live check): pre-boot scrubber app/access-log-redact.mjs installed FIRST in instrument.server.mjs wraps the stream morgan writes to. Live Railway log store after the drive: 17/17 id_token=[redacted], grep -Ec \"id_token=eyJ\" = 0, hmac/session scrubbed alongside.",
    "recorded_at": "2026-08-19T12:40:00.000Z",
    "resolved_at": "2026-08-22T08:20:00.000Z"
  },
  {
    "id": 9,
    "kind": "unrun-verify",
    "phase": "03",
    "file": "app/routes/app.companies.tsx",
    "line": null,
    "description": "Companies page browser UAT COMPLETE (2026-08-20, user on credit-guard-demo). Confirmed live: all four companies rendered with names not GIDs (the a4a1f2c rename-fix regression check PASSES); badges correct; bypass toggle round-trips; and the limit intent set/edit/clear cycle works through the real form action (set 1500.00 -> over-limit badge, edit to 1874.95 -> within-limit at the exact at-limit boundary, clear -> observe-only). Metafields followed each change: read-back at 2026-08-20 shows all surviving companies field-matched with dirtyPublishes 0. CAVEAT: the clear/removal step was performed on Powderbound, which the user then deleted in the Shopify admin (genuine COMPANIES_DELETE webhook, processed 18:42:20.645Z), so that step rests on the human observation rather than a surviving live artifact.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-19T18:05:00.000Z",
    "resolved_at": "2026-08-20T00:00:00.000Z"
  },
  {
    "id": 10,
    "kind": "fixme",
    "phase": "04",
    "file": "app/services/reconciliation.server.ts",
    "line": null,
    "description": "Exhaustion flip starves on the shop's NEWEST unattributable net-terms order: the cursor advances to (newest updatedAt minus the 5-minute overlap), so that order is re-paged by every sweep, its refetchedAt is refreshed, and the flip's `refetchedAt < sweepStart` gate never admits it. Observed live 2026-08-20 on order #1012 (companyless, carries Net 30): two consecutive reconcileShop runs both reported flippedNoCompany 0, pinning the shop's data_complete false until a newer order arrives. ENFORCEMENT IS UNAFFECTED - the Function deliberately does not read data_complete (D-04) - so this is observability, not a checkout risk. Pre-existing Phase-2/3 reconciliation semantics; out of scope for 04-05 (scope boundary).",
    "status": "fixed",
    "reason": "Closed 2026-08-23 live (06-03 fix, first unattended cron tick on fixed code): flip gate widened with the scannedGids arm — a row the sweep's OWN scan refreshed is provably unattributable by evidence newer than its refetch. 03:30Z tick flipped #1012/#1013: attributed 15 / unresolved 0 / noCompany 2, dataComplete true (probe 09:48Z). Independently re-probed 2026-08-24 by the phase verifier: still 15/0/2, dataComplete true.",
    "recorded_at": "2026-08-20T10:50:00.000Z",
    "resolved_at": "2026-08-23T09:48:00.000Z"
  },
  {
    "id": 11,
    "kind": "unrun-verify",
    "phase": "04",
    "file": "extensions/credit-guard-validation/src/cart_validations_generate_run.ts",
    "line": null,
    "description": "EC-1 decimal-format capture not performed: the optional checkpoint step 9 (Partner Dashboard -> Function runs -> read cart.cost.totalAmount from a real run input) was skipped by the human. EC-1's substance is proven behaviourally - a real Northwind checkout was blocked, which is impossible unless the USD currency compare matched - but the exact `amount` decimal-place format (04-RESEARCH Open Question 2) remains unobserved. cartCents normalization handles it defensively either way.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-20T10:50:00.000Z",
    "resolved_at": null
  },
  {
    "id": 12,
    "kind": "fixme",
    "phase": "04",
    "file": "app/services/enforcement.server.ts",
    "line": null,
    "description": "TOCTOU window in the validationUpdate echo-flags fix (19b5946): flags are read immediately before the write; a merchant toggling the rule in checkout settings inside that window has their toggle reverted by the echo. Platform offers no CAS on validationUpdate. Outcome is a VISIBLE reversion (status banner shows it), not silent disablement — low severity. Found by 04-VERIFICATION (W1); acknowledged nowhere in code comments — add one.",
    "status": "fixed",
    "reason": "Closed 2026-08-22 (06-02): TOCTOU acknowledged at the echo site (enforcement.server.ts \"WINDOWS #12 — TOCTOU, acknowledged\" comment). Comment-only by design — the platform offers no CAS on validationUpdate, and the reversion stays visible in the status banner. This entry asked for exactly that acknowledgement.",
    "recorded_at": "2026-08-20T11:20:00.000Z",
    "resolved_at": "2026-08-22T04:00:00.000Z"
  },
  {
    "id": 13,
    "kind": "unrun-verify",
    "phase": "04",
    "file": "",
    "line": null,
    "description": "No live overdue-ONLY block was ever staged (a company overdue but under limit, blocked at a real checkout). The overdue path is proven by unit tests and real-wasm fixture runs; the live matrix covered over-limit block, bypass allow, observe-only allow, D2C. Within SC3's declared live scope per 04-VERIFICATION (W2), but a pre-launch dev-store check is cheap: make a company overdue with limit null and attempt checkout.",
    "status": "fixed",
    "reason": "Closed 2026-08-22 live (06-07): BLOCK_STATE_ENTERED for Acme Supply at 07:56:59.388Z with overdue:true, exposure 5345.80 < limit 6000.00 — overdueness alone drove the hold — and the developer, logged in as Acme's contact, saw the shipped overdue message verbatim at a real net-terms checkout. Fixtures restored and probe-verified (BLOCK_STATE_EXITED + BYPASS_ENABLED, dirtyPublishes 0).",
    "recorded_at": "2026-08-20T11:20:00.000Z",
    "resolved_at": "2026-08-22T07:56:59.388Z"
  },
  {
    "id": 14,
    "kind": "unrun-verify",
    "phase": "05",
    "file": ".planning/phases/05-payment-reminders/05-02-SUMMARY.md",
    "line": null,
    "description": "REMD-02/REMD-03 unverified: no reminder email has reached a readable inbox, so sender/branding/subject and the pay-now click-through are unproven",
    "status": "fixed",
    "reason": "2026-08-21 — closed on the delivered #1015 reminder (user-exported PDF, read by the orchestrator): DUE_SOON headline \"Your payment is due in 30 days\" on a pre-due invoice; sender \"Credit Guard Demo\" via Shopify relay with reply-to the merchant; Pay now button present. #1014 receipt also human-confirmed (body not inspected).",
    "recorded_at": "2026-08-21T06:55:29.492Z",
    "resolved_at": "2026-08-21T11:13:46.574Z"
  },
  {
    "id": 15,
    "kind": "unmet-truth",
    "phase": "05",
    "file": ".planning/phases/05-payment-reminders/05-02-SUMMARY.md",
    "line": null,
    "description": "DUE_SOON touchpoint undecided: E2 is API-green but the default Payment reminder template copy is overdue-phrased; a delivered pre-due email is the deciding evidence for 05-03",
    "status": "fixed",
    "reason": "2026-08-21 — closed on the delivered #1015 reminder (user-exported PDF, read by the orchestrator): DUE_SOON headline \"Your payment is due in 30 days\" on a pre-due invoice; sender \"Credit Guard Demo\" via Shopify relay with reply-to the merchant; Pay now button present. #1014 receipt also human-confirmed (body not inspected).",
    "recorded_at": "2026-08-21T06:55:29.582Z",
    "resolved_at": "2026-08-21T11:13:46.671Z"
  },
  {
    "id": 16,
    "kind": "unrun-verify",
    "phase": "05",
    "file": ".planning/phases/05-payment-reminders/05-02-SUMMARY.md",
    "line": null,
    "description": "Inbox delivery of reminder email unproven: the dev store delivers no customer-facing mail (3 providers, order confirmations included). Verify on first production install or a paid test store: send one reminder, confirm arrival, check sender/branding/subject",
    "status": "fixed",
    "reason": "2026-08-21 — closed on the delivered #1015 reminder (user-exported PDF, read by the orchestrator): DUE_SOON headline \"Your payment is due in 30 days\" on a pre-due invoice; sender \"Credit Guard Demo\" via Shopify relay with reply-to the merchant; Pay now button present. #1014 receipt also human-confirmed (body not inspected).",
    "recorded_at": "2026-08-21T08:02:27.323Z",
    "resolved_at": "2026-08-21T11:13:46.787Z"
  },
  {
    "id": 17,
    "kind": "unrun-verify",
    "phase": "05",
    "file": ".planning/phases/05-payment-reminders/05-02-SUMMARY.md",
    "line": null,
    "description": "REMD-02 pay-now click-through unproven: order_payment URL exists and is well-formed for both past-due and pre-due orders, but the dev store's non-removable password page returns 403. Click it on a non-dev store and confirm a payable page",
    "status": "fixed",
    "reason": "2026-08-21 — user clicked Pay now in the delivered #1015 reminder and landed on a Shopify checkout page identifying the invoice (page text: \"Acme Supply\", line item \"The Complete Snowboard\", \"Total due USD $664.95\"), exported as PDF and read by the orchestrator. Payment was not completable: the page reads \"This store can't accept payments right now.\" (dev-store limitation — interpretation). Completion itself remains open as entry 18.",
    "recorded_at": "2026-08-21T08:02:27.418Z",
    "resolved_at": "2026-08-21T12:07:32.994Z"
  },
  {
    "id": 18,
    "kind": "unrun-verify",
    "phase": "05",
    "file": ".planning/phases/05-payment-reminders/05-05-SUMMARY.md",
    "line": null,
    "description": "Pay-now PAYMENT COMPLETION unproven: the order_payment URL exists and is well-formed for pre-due and past-due orders and answers 302 when fetched in-container, but no payment has ever been completed through a reminder's Pay now link. Complete one on a store with a payment gateway before launch",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-21T11:14:02.611Z",
    "resolved_at": null
  },
  {
    "id": 19,
    "kind": "unrun-verify",
    "phase": "05",
    "file": ".planning/phases/05-payment-reminders/05-05-SUMMARY.md",
    "line": null,
    "description": "Reminder-email delivery is DELAYED AND VARIABLE on the dev store, not suppressed (supersedes 05-02 N3): two reminders issued ~30s apart arrived ~3.5h (#1015) and ~5h (#1014) after send, both human-confirmed; order confirmations similarly delayed. Informational — confirm normal-latency delivery on a paid-plan store with a verified sender domain before launch",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-21T11:14:02.700Z",
    "resolved_at": null
  },
  {
    "id": 20,
    "kind": "fixme",
    "phase": "05",
    "file": "app/services/reminders.server.ts",
    "line": null,
    "description": "05-VERIFICATION W1: late retry of an outranked touchpoint — retriableRow re-claims a FAILED DUE_SOON row after DUE was already SENT on the same schedule, chasing the lower moment >=25h later (buyer gets \"due in 3 days\" after \"due today\"). No spec covers it. Fix: fence on a SENT/SENT_UNCONFIRMED higher-severity sibling and mark SUPPRESSED_STALE.",
    "status": "fixed",
    "reason": "Closed 2026-08-22 (06-02): severity fence — retriableRow classifies a FAILED row outranked by a SENT/SENT_UNCONFIRMED higher-severity sibling as \"outranked\" and the sweep marks it SUPPRESSED_STALE instead of sending (reminders.server.ts outrankedBySentSibling + the WINDOWS #20 comment at the retire site); true-RED regression tests in tests/reminders.test.ts. Verified in code at cc23664.",
    "recorded_at": "2026-08-21T15:20:00.000Z",
    "resolved_at": "2026-08-22T04:00:00.000Z"
  },
  {
    "id": 21,
    "kind": "fixme",
    "phase": "05",
    "file": "app/services/reminders.server.ts",
    "line": null,
    "description": "05-VERIFICATION W2: LedgerGraphqlError narrowing is broader than its justification — graphqlJson throws on ANY top-level errors[] before reading data; a 200-with-errors INTERNAL_SERVER_ERROR on paymentReminderSend is ambiguous (may have sent) yet is treated as definitively-not-sent and retried after 25h. Damage bounded by the platform per-order 24h limit. Fix: key on extensions.code — only ACCESS_DENIED/validation-class codes are retriable; unknown codes -> SENT_UNCONFIRMED.",
    "status": "fixed",
    "reason": "Closed 2026-08-22 (06-02): closed retriable-code set — only ACCESS_DENIED/validation-class extensions.code values stay retriable; unknown/ambiguous send errors land SENT_UNCONFIRMED (terminal, counts exactly as SENT for dedupe/suppression, stamps sentAt). Verified in reminders.server.ts at cc23664.",
    "recorded_at": "2026-08-21T15:20:00.000Z",
    "resolved_at": "2026-08-22T04:00:00.000Z"
  },
  {
    "id": 22,
    "kind": "fixme",
    "phase": "05",
    "file": "app/routes/app.settings.tsx",
    "line": null,
    "description": "05-VERIFICATION W3: merchant copy overstates eligibility — \"Each unpaid invoice is chased\" but only company-attributed orders are (v1 company-only choice, 05-03). Also README reminders section omits the limitation. Fix: one clause in the settings card + README.",
    "status": "fixed",
    "reason": "Closed 2026-08-22 (06-02): settings card states the company-only limit verbatim (\"Only net-terms orders attributed to a company in Credit Guard are chased — orders with no purchasing company aren't emailed\"), README § reminders states it too, and both surfaces compose cadence copy from the shared REMINDERS_CADENCE constant. Verified at cc23664.",
    "recorded_at": "2026-08-21T15:20:00.000Z",
    "resolved_at": "2026-08-22T04:00:00.000Z"
  },
  {
    "id": 23,
    "kind": "deviation",
    "phase": "06",
    "file": "listing/screenshots/S4.png",
    "line": null,
    "description": "Screenshot 4 on the LIVE App Store listing carries customer PII (customer name, email, street address, phone + staff name legible behind the draft-order \"Unresolved business rules\" modal), found 2026-08-24 after submission. Repo copy cropped at 1ee6b34 (moved screenshots/ -> listing/screenshots/ at b8b8809); uncropped file remains in git history at 57fb1a4 (private repo). UPDATE 2026-09-04: review ended — v1.0.0 approved and listed at https://apps.shopify.com/credit-guard-b2b-net-terms — so the listing is editable now. BUT the repo crop listing/screenshots/S4.png is 600×290 and the App Store requires 1600×900, so S4 must be RETAKEN at 1600×900 (PII-free framing, same shot-list position per 06-LISTING §10.3) before the swap; the PII screenshot stays live until the retake lands. First post-launch action. UPDATE 2026-09-04 (later): S4 retaken at 1600×900 and the buyer name, email, street, city and phone replaced by placeholders (commit aab1fb1, listing/screenshots/S4.png); the ONLY remaining step is uploading it to the listing in the Partner Dashboard, which the developer chose to defer.",
    "status": "fixed",
    "reason": "S4 retaken at 1600×900 with all buyer fields replaced by fictitious placeholders (aab1fb1) and uploaded to the live listing by the developer on 2026-09-04; listing saved.",
    "recorded_at": "2026-08-24T05:30:00.000Z",
    "resolved_at": "2026-09-04T04:03:21.086Z"
  },
  {
    "id": 24,
    "kind": "fixme",
    "phase": "06",
    "file": "app/services/onboarding.server.ts",
    "line": null,
    "description": "06-07 F2: the review-prompt result code is not persisted — recordReviewPromptResult stamps reviewPromptedAt and discards the code, and the POST body is not in the access log. The app can prove it asked and never re-asked, but not what Shopify answered (success vs merchant-ineligible vs cooldown vs error). Cheap fix: nullable reviewPromptResult column or a log line; schema change, its own small plan.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-24T05:30:00.000Z",
    "resolved_at": null
  },
  {
    "id": 25,
    "kind": "fixme",
    "phase": "06",
    "file": "tests/reminders.test.ts",
    "line": null,
    "description": "Flake: \"only ONE schedule per sweep\" is order-dependent on a reused test DB (fails on a pristine tree too, per 06-08 Task 2 gate). Green on the 2026-08-24 phase-verification run (838/838). Wants a fixture-isolation pass; not a product defect.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-24T05:30:00.000Z",
    "resolved_at": null
  },
  {
    "id": 26,
    "kind": "fixme",
    "phase": "06",
    "file": "tests/review-prompt.test.ts",
    "line": null,
    "description": "Flake: \"ask after a success moment\" exceeded its 5s timeout (5259ms) when the suite ran concurrently with a build; green in isolation and on the 2026-08-24 phase-verification run. Raise the timeout or isolate; not a product defect.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-24T05:30:00.000Z",
    "resolved_at": null
  },
  {
    "id": 27,
    "kind": "deviation",
    "phase": "06",
    "file": "app/routes/app._index.tsx",
    "line": null,
    "description": "Cosmetic: the guided setup's third step renders its completion tick above rather than beside its heading (SetupRow inline-stack alignment; observed in the 06-08 asset session). Desktop listing screenshots shipped without a visible defect. Low priority.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-24T05:30:00.000Z",
    "resolved_at": null
  },
  {
    "id": 28,
    "kind": "skipped-test",
    "phase": "06",
    "file": "vitest.config.ts",
    "line": null,
    "description": "Suite is residue-sensitive on the shared creditguard_test database: several files assert EXACT call/row counts and vitest runs files serially against one DB, so rows left by an earlier session can make count assertions fail (observed 2026-08-24 by two separate agents: tests/scheduler.test.ts PUBLISH count read 4 instead of 2; identical reruns clean, no code changed). Root of the #25/#26 flake class. VERIFIED 2026-08-24: a pristine scratch DB named creditguard_test_verify runs 838/838 clean, so the code is sound and only the shared fixture DB is at fault. Note tests/helpers/webhook-hmac.test.ts guards that the suite only ever points at a DB whose name contains creditguard_test - honour that when creating scratch DBs. Fix: per-run scratch DB (or a truncate in global setup) rather than a reused creditguard_test.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-24T08:45:00.000Z",
    "resolved_at": null
  },
  {
    "id": 29,
    "kind": "unmet-truth",
    "phase": "06",
    "file": ".planning/phases/06-dashboard-onboarding-launch/06-LISTING.md",
    "line": 292,
    "description": "Reviewer walkthrough step 6 (pasted into the Partner Dashboard App testing information) and screencast beat 5 say \"Prepaying by card is deliberately still allowed — the app stops the credit, not the sale.\" This is FALSE: the validation Function targets $.cart and holds the whole checkout for an enforced purchasing company (decision steps 1, 7, 12 in cart_validations_generate_run.ts); the input carries no payment selection, and 04-RESEARCH §Net-Terms Path Detection already established that a terms-bearing B2B checkout collects no payment (no card choice; deposits Plus-only; Pay now is post-order). Accurate statement: the held company cannot complete a new checkout; buyers can still settle open invoices via Pay now, which clears the hold; companies paying at checkout without terms carry no exposure and are unaffected. Found 2026-09-05 by the marketing thread; the live listing copy (\"can’t complete a new net-terms checkout\") is already correct. To close: edit the App testing information notes in the Partner Dashboard, re-record or annotate the screencast, and reword REQUIREMENTS ENFC-01 / PROJECT.md (\"prepay-by-card stays open\").",
    "status": "fixed",
    "reason": "Partner Dashboard App testing information edited by the developer 2026-09-05 (card-prepay sentence removed). The screencast has NO narration, so it never carried the claim — the beat list in 06-LISTING §6 was a script that was not voiced. REQUIREMENTS ENFC-01, PROJECT.md and 06-LISTING step 6 reworded in 609b589; playbook artifact corrected the same day. Live listing copy was always correct.",
    "recorded_at": "2026-09-05T07:47:11.639Z",
    "resolved_at": "2026-09-05T09:46:28.231Z"
  },
  {
    "id": 30,
    "kind": "fixme",
    "phase": "06",
    "file": "app/services/scheduler.server.ts",
    "line": 140,
    "description": "Six of the seven Shop rows marked active have EXPIRED offline tokens that the app cannot refresh (expiringOfflineAccessTokens is on; Admin API answers 401 \"Invalid API key or access token\" — credit-guard-demo-2’s was merely expired and refreshed itself once the developer opened the app on 2026-09-10; the five reviewer stores are gone, so their refresh fails for good): the three app-review-24e52439-* automated-review stores (installed 2026-08-24), eztcd0-3u and 0j1uwb-00 (installed 2026-09-01, almost certainly the manual reviewer’s stores; eztcd0-3u placed 5 orders on terms and enabled reminders), and credit-guard-demo-2 (still delivering webhooks daily, so installed but unconsented after the write_orders scope release). None has uninstalledAt set — no app/uninstalled delivery was ever processed for any of them, and the compliance log is empty (no shop/redact ever landed). Consequences: forEachActiveShop runs the hourly publish, hourly reminder sweep and daily reconciliation against all six every cycle and each attempt fails at the first Admin call (swallowed per-shop, Sentry noise, wasted calls); retained ledger data for stores that no longer exist (eztcd0-3u: 3 companies, 5 orders, 22 enforcement events). Found 2026-09-10 while investigating the Partner Dashboard webhook-failure metric. Fix candidate (v1.0.1): treat a 401 invalid-token response from a shop’s Admin API as an uninstall signal — deactivateShop after N consecutive sweep failures — per Shopify’s guidance that a revoked token means the app is no longer installed; plus a one-off cleanup of the five dead review stores. demo-2 needs the developer to open the app once and accept the scope prompt.",
    "status": "fixed",
    "reason": "Fixed in v1.0.1 by d9b6bc9 (feat(scheduler)): app/services/token-health.server.ts counts token-class failures at the admin seam (app/services/admin-client.server.ts) — refresh -> Response 500, HttpResponseError 400 invalid_subject_token, Admin API HttpResponseError 401, and NOTHING else. Strikes are time-gated to one per 30-minute window with a fixed anchor, so one hourly sweep's burst over N companies counts once (graphqlJson builds a client per call) and a live merchant cannot be deactivated by a single bad minute; three strikes in separate sweep cycles run deactivateShop + delete the session rows + clear the counter, emitting one console.log and one Sentry captureMessage tagged windows:30. Any resolved graphql() call resets the counter (including a 200 carrying GraphQL errors[] such as ACCESS_DENIED), bounded to one DELETE per shop per process. Regression tests: tests/admin-token-health.test.ts, 10 tests — 'classifies exactly the three token-class failures', 'three strikes in three separate windows deactivate the shop on the third and delete its sessions', 'repeated failures inside one sweep window count once', 'a successful Admin call resets the counter', 'confirms a shop healthy once per process', 'a non-token error never increments the counter or deactivates', 'bookkeeping never masks the original error', plus the seam source guard. POST-DEPLOY VERIFICATION STILL OWED: within three hourly sweep cycles (~2-3 h) of deploy, the 'Deactivated ... (WINDOWS #30)' line must appear for the five dead reviewer stores — one strike per cycle, never three from a single sweep — and scripts/prod-lifecycle-state.sh must show them inactive with zero sessions; credit-guard-demo-2 must reactivate when the developer opens the app. POST-DEPLOY 2026-09-10T10:1xZ: on the developer’s instruction the five reviewer stores (eztcd0-3u, 0j1uwb-00, app-review-24e52439-r75107-a0, -r75108-a0-victim, -r75108-a0-primary) were hard-deleted in production by a one-off read-then-delete script mirroring redactShop’s table order (all counts zero afterwards; only credit-guard-demo and credit-guard-demo-2 remain, both active). Shopify had already exhausted its shop/redact retries for them, so no further delivery would have triggered the fixed handler.",
    "recorded_at": "2026-09-10T06:54:25.999Z",
    "resolved_at": "2026-09-10T09:50:34.649Z"
  },
  {
    "id": 31,
    "kind": "fixme",
    "phase": "06",
    "file": "app/routes/webhooks.compliance.tsx",
    "line": 27,
    "description": "ROOT CAUSE FOUND 2026-09-10 (Dev Dashboard log + local reproduction). The 3/5 Sep failures are shop/redact deliveries for reviewer store eztcd0-3u answering HTTP 500 — Shopify retried 9× (first attempt 2026-09-05T19:25:18Z, attempt shown \"Delivery attempt 1\", 357 ms). Mechanism: app/shopify.server.ts enables future.expiringOfflineAccessTokens, so every offline session carries `expires` (~hours) and a 90-day refreshToken. The library’s authenticate.webhook calls ensureValidOfflineSession → ensureOfflineTokenIsNotExpired BEFORE the handler runs; when a session row exists, is expired, and has a refreshToken, it calls Shopify to refresh — for a store that was deleted without ever sending app/uninstalled (the reviewer stores) the refresh fails and helpers/refresh-token.mjs throws `new Response(undefined,{status:500})`. The redact handler never executes, Shopify sees a 500, retries for 48h, and the store’s data is never redacted. Reproduced locally: seeded shop + expired session with refreshToken + ledger rows, signed shop/redact → 500, rows intact; same seed without a refreshToken → 200 and rows deleted. The same path can 500 an app/uninstalled delivery whenever the stored session is already stale at uninstall time. Fix (v1.0.1 hotfix): make webhooks.compliance.tsx and webhooks.app.uninstalled.tsx validate with the library’s low-level `shopify.api.webhooks.validate({rawBody, rawRequest})` (real HMAC, no session load, no refresh) instead of authenticate.webhook — neither route needs a session — and add a regression test with an expired+refreshable session; separately (#30) treat an unrefreshable token in the sweeps as an uninstall signal so the stale session rows disappear.",
    "status": "fixed",
    "reason": "Fixed in v1.0.1 by d80e362 (shop/redact) and 6c25997 (app/uninstalled). The app object does NOT expose its internal `api`, so `shopify.api.webhooks.validate` from the fix note does not exist; the sanctioned replacement is one validation-only shopifyApi() instance in app/shopify.server.ts (same env vars as the main config, logger level Warning, exported only as `validateWebhook`) behind app/services/webhook-validate.server.ts, which mirrors the library authenticator's 405/401/400 contract byte-for-byte, reads the raw body exactly once, and loads no session. Both routes now call validateWebhookRequest; neither references `authenticate` at all. @shopify/shopify-api declared direct at 13.1.0 (already present transitively; zero new integrity lines in the lockfile). Regression tests: tests/webhooks.compliance.test.ts 'answers 200 and redacts when the stored offline token is expired but refreshable (WINDOWS #31)' (RED first: 500 with rows intact), 'answers 405 to a non-POST request', 'answers 400 when the HMAC is valid but a required header is missing', 'both webhook routes verify through validateWebhookRequest, never the session-loading authenticator (WINDOWS #31)'; tests/shop-lifecycle.test.ts 'answers 200, deletes an expired refreshable session and deactivates the shop (WINDOWS #31)' and 'zeroes every counted table when the stored token is expired but refreshable'. The three forged-HMAC 401 tests (T-01-10) pass unchanged — HMAC verification is still the library's own timing-safe validator and is never mocked. POST-DEPLOY VERIFICATION STILL OWED: the next shop/redact delivery for a dead store must show 200 in the Dev Dashboard webhook log (currently 9 retried 500s for eztcd0-3u since 2026-09-05T19:25Z). POST-DEPLOY 2026-09-10T10:1xZ: on the developer’s instruction the five reviewer stores (eztcd0-3u, 0j1uwb-00, app-review-24e52439-r75107-a0, -r75108-a0-victim, -r75108-a0-primary) were hard-deleted in production by a one-off read-then-delete script mirroring redactShop’s table order (all counts zero afterwards; only credit-guard-demo and credit-guard-demo-2 remain, both active). Shopify had already exhausted its shop/redact retries for them, so no further delivery would have triggered the fixed handler.",
    "recorded_at": "2026-09-10T06:54:25.999Z",
    "resolved_at": "2026-09-10T09:50:34.475Z"
  },
  {
    "id": 32,
    "kind": "fixme",
    "phase": "06",
    "file": "app/services/shop-lifecycle.server.ts",
    "line": 56,
    "description": "redactShop does not delete EnforcementEvent rows, and countsFor in tests/shop-lifecycle.test.ts does not count them — exactly the two-sided redaction-contract gap the working guide warns about. Reproduced 2026-09-10: after a successful shop/redact the shop row is gone but 1 EnforcementEvent (companyGid + companyName, merchant data about a buyer relationship) remains. Fix with #31 in the same hotfix: add enforcementEvent.deleteMany to the transaction (before company rows, matching the reminderLog placement) and a counter to countsFor.",
    "status": "fixed",
    "reason": "Fixed in v1.0.1 by a82997e (fix(lifecycle)). redactShop's $transaction now carries db.enforcementEvent.deleteMany immediately after reminderLog and before the ledger rows it names by GID (both are snapshot trails with no foreign key). The test side is closed too, which is the half that would have caught it: countsFor gained enforcementEvents, EMPTY_COUNTS gained enforcementEvents: 0, wipe deletes them, and seedLedger seeds a BLOCK_STATE_ENTERED row — so 'deletes every shop-keyed ledger table's rows (Phase 2 models)' now guards `before.enforcementEvents === 1` and the bystander test asserts the row survives for another shop. RED was observed first: with only the test hunks applied that test failed on enforcementEvents: 1. POST-DEPLOY VERIFICATION STILL OWED: scripts/prod-enforcement-events.sh must show 0 rows for a redacted shop (eztcd0-3u currently retains 22).",
    "recorded_at": "2026-09-10T08:50:28.417Z",
    "resolved_at": "2026-09-10T09:50:34.562Z"
  }
]
````
