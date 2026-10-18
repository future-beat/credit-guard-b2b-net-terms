# Phase 5 Context — Payment Reminders

**Gathered:** 2026-08-20 (post-research; five gray areas locked by user)

## Locked Decisions

### D5-01: Architecture A — Shopify sends via `paymentReminderSend`
The app supplies only `LedgerSchedule.scheduleGid`; Shopify resolves the
recipient (company main contact), composes its branded "Payment reminder"
template with the canonical pay-now link, and sends from the merchant's own
authenticated sender. Zero customer PII enters the app — PRIVACY.md's
"no customer emails" posture stays TRUE and load-bearing. No Resend, no
react-email, no DNS work. New scope: `write_orders` (keep read_orders in the
string for explicitness). REMD-03 and ROADMAP SC-4 REWORDED to: "reminders are
delivered through Shopify's authenticated notification infrastructure with the
merchant's own branding and sender." Architectures B (Resend + PCD L2) and C
(merchant digest) rejected; C noted as a possible v2 add-on.

### D5-02: Default OFF + suppression watermark
Per-shop `remindersEnabledAt`, default off; merchant enables in settings
(mirrors CRED-04 observe-first). On enable: touchpoints whose threshold
crossed before `remindersEnabledAt` are written as SUPPRESSED; at most the
single most-severe eligible touchpoint per schedule ever sends. No
install-day blast.

### D5-03: Overdue touchpoint at dueAt + 72h
Due-date email gets room to work. Enforcement (checkout block) stays
strictly-past-due per D-04 — dunning and enforcement cadences are independent.
Merchant-set offset deferred to v2 (REMD-04 material).

### D5-04: Instant math on dueAt
due−3d = dueAt − 72h·... exactly: dueAt − 3×24h; hourly sweep sends land
within the hour of crossing. No shop-calendar/DST arithmetic in v1
(Shop.ianaTimezone exists if ever needed).

### D5-05: Native-reminder duplicate posture
No API surface reads notification settings. Settings-page copy instructs the
merchant to keep only one reminder system enabled; dev-store empirical check
(E5) records the native default. Not solvable in code — documented, not hidden.

## Research corrections binding on the planner
- Touchpoint model: (schedule × {due-3, due, overdue}) with
  ReminderLog @@unique([shop, scheduleGid, touchpoint]) claim-then-send
  (at-most-once); live nodes() refetch before send closes the paid race
  (REMD-02); completedAt != null skips locally first.
- Third hourly sweep on the EXISTING lease registry slot
  (scheduler.server.ts reserves it) — own lease name, no new cron infra.
- E1–E5 empirical checks are the phase's first proving ground (recommended
  first plan): email content + pay-link click-through, pre-due send,
  completed-schedule refusal, company-less order recipient, native default.
- PRIVACY.md §2 is ALREADY STALE ("four read-only scopes, no write scopes" —
  false since Phase 3). Must be corrected this phase regardless of
  architecture; with D5-01 the "no customer emails" section stays true.
- Stack-research rows for resend/react-email are Architecture-B-only and now
  stale (resend is 6.x not ^4.x; @react-email/components is npm-DEPRECATED).
  Install NOTHING this phase.
- Scope lockstep: TOML + Railway SCOPES + vitest env + the two guard suites;
  re-consent is a browser-only human step (registry version bump) — plan it
  as a relayed checkpoint like 03-02/04-03.
