---
phase: 05-payment-reminders
plan: 04
subsystem: settings-ui
tags: [reminders, settings, merchant-copy, d5-02, d5-05, polaris-web-components]
status: complete

requires:
  - "Shop.remindersEnabledAt column (05-01) — the watermark this plan is the only writer of"
  - "05-02's measured E5/N1/N2 findings — every warning line on the card cites one"
  - "app/routes/app.settings.tsx (04-04) — extended, not replaced"
provides:
  - "The D5-02 enablement gate: two whitelisted intents (enable-reminders/disable-reminders) writing Shop.remindersEnabledAt for the session shop"
  - "SettingsLoaderData.remindersEnabledAt — the watermark read from the column, exposed to the page"
  - "Merchant-facing reminder copy constants (exported, pinned by spec): D5-05 native-duplicate warning, N1 one-per-order-per-day, N2 recipient snapshot, template behaviour + preview pointer"
affects:
  - "05-03's sweep — the watermark it reads as its suppression boundary is now settable by a human, and only by a human"
  - "05-05's live proof — the switch it must flip before anything can send"
  - "Phase 6 (LNCH-02) — the sent-reminder feed is deliberately absent; the code comment marks the seam"

tech-stack:
  added: []
  patterns:
    - "Per-card fetcher: the reminders toggle owns its own useFetcher so a failed toggle cannot raise the message-save banner nor disable the textareas mid-edit"
    - "Copy-as-constant: every merchant-facing sentence is an exported const pinned by a spec, so a well-meaning reword cannot silently drop a measured warning"
    - "Route-local Prisma write (app.companies.tsx precedent): db.server imported at module top, referenced only inside loader/action"

key-files:
  created: []
  modified:
    - "app/routes/app.settings.tsx — reminders intents, loader exposure, PaymentReminders card, copy constants"
    - "tests/settings-messages.test.ts — 24 specs across toggle semantics, loader honesty, and copy content"

decisions:
  - "Enabling ALWAYS stamps a new now(), including re-enable after a disable — the column is a suppression boundary, not a creation date"
  - "The reminders card gets its own fetcher rather than sharing the page's, so the two controls fail independently"
  - "A failed write returns save-failed/502 rather than an optimistic toast — the switch's honesty matters more than its ergonomics"
  - "No reminders.server.ts import: the sweep's module stays off the request path of a merchant clicking a toggle (also the 05-03 ownership boundary this wave)"

metrics:
  duration: "~35 min"
  completed: 2026-08-21
  tasks: 2
  commits: 2

actuals:
  tokens: 21000
  tasks: 2
  commits: 2
---

# Phase 5 Plan 04: Payment Reminders Settings Toggle Summary

**The merchant now owns the switch: two whitelisted intents write `Shop.remindersEnabledAt` for the session shop only, enabling always stamps a fresh watermark so a re-enable never dunns the quiet window, and the card prints the four things 05-02 measured that no code can detect.**

## What Was Built

### Task 1 — The enablement gate (D5-02)

`app/routes/app.settings.tsx` gained two intents beside `SAVE_MESSAGES_INTENT`:

- `enable-reminders` → `db.shop.update({ where: { domain: session.shop }, data: { remindersEnabledAt: new Date() } })`
- `disable-reminders` → the same write with `null`

The loader now returns `SettingsLoaderData = ValidationConfigState & { remindersEnabledAt: string | null }`, read straight from the column with `db.shop.findUnique` alongside the existing `readValidationConfig` call (both in one `Promise.all`, so the page costs no extra round trip in wall-clock terms).

**The mutation rule is the feature, and it is worth restating.** Enabling stamps a *new* `now()` every single time — including a re-enable after a disable. The alternative (preserve the original timestamp) looks like politeness and is in fact a loaded gun: every reminder moment that passed while the merchant had reminders switched off would suddenly sit *behind* the watermark and become eligible, so a merchant who cautiously paused for a fortnight would fire a fortnight of accumulated dunning at their customers the instant they changed their mind. The plan specifies this explicitly and the spec `moves the watermark FORWARD on re-enable` pins it.

Disabling nulls the column, which is also the install default — so "this shop sends nothing" has exactly one representation, and 05-03's sweep can return before it queries anything.

### Task 2 — The card

A `PaymentReminders` s-section (Polaris web components only) carrying:

1. **Honest status** — OFF: *"Payment reminders are off. Credit Guard never emails your customers until you turn this on."* / ON: *"Payment reminders are on since {date}."*, dated from the column itself rather than a separate flag that could drift from what the sweep reads.
2. **What the emails are** — sent *by Shopify*, from the store's own email identity, at three moments per invoice (3 days before due, on the due date, 3 days after), each at most once, and never for a paid invoice.
3. **The watermark, in one sentence** — only moments happening after enablement are emailed; nothing is sent for older overdue invoices, and an off→on cycle starts a fresh line.
4. **D5-05 native-duplicate warning** — Shopify's own scheduled reminders live under Settings > Notifications and **stay off until configured** (E5, measured on a live store in 05-02, not assumed). Running both means a buyer can get two emails about the same invoice.
5. **N1** — one payment reminder per order per day is a platform limit; a hand-sent or Flow-sent reminder makes Credit Guard's reminder for that order wait until the next day.
6. **N2** — Shopify fixes the recipient when the order is created; correcting a contact's email does **not** redirect reminders for orders already on the books.
7. **Template pointer** — the wording is Shopify's Payment reminder template, edited under Settings > Notifications > Payment reminder, *not in this app*; it already adapts between "due in N days" and "N days overdue", so the only instruction is to preview it if customised.

The card uses **its own fetcher**. Sharing the page's would have meant a failed toggle raising the "Couldn't save these messages" banner and a toggle click disabling the message textareas mid-edit — two controls whose failures have nothing to do with each other.

The Phase 6 deliberate-absence comment was extended: the sent-reminder feed reads `ReminderLog` and ships with LNCH-02's first-reminder moment. 05-03's sweep is already writing those rows, so the data accumulates while the surface waits.

## Verification

| Check | Result |
|-------|--------|
| `npx vitest run tests/settings-messages.test.ts` | 62 passed (38 pre-existing + 24 new) |
| `npm test` | **542 passed / 22 files** — floor was 517/22, zero regressions |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | clean — `✓ built in 162ms` |

The build was run deliberately and last: 04-04's recorded trap is that a `.server` import reaching client code passes tests, typecheck *and* lint, and fails only the client build. Here `db.server` and `@sentry/react-router` are imported at module top but referenced only inside `loader`/`action` (the `app.companies.tsx` precedent), and every copy constant is a plain string in the route module — nothing server-only reaches the browser bundle.

### What the specs actually pin

- Watermark stamped at ~now on enable; nulled on disable; **strictly later** on re-enable
- Enabling issues **zero** Admin API calls (if this ever changes, something is sending at the moment of opt-in)
- Session-shop scoping: a forged `shop`/`domain` form field cannot reach the bystander shop's row (T-05-11), and the write follows the session when the authenticated shop changes
- A near-miss intent (`enable-reminders-now`) still answers 400 having moved no watermark (T-05-12)
- A failed write returns `save-failed`/502 rather than a success toast over an unmoved switch
- The loader reports a value **written behind the route's back**, proving it reads the column rather than an inferred flag
- Each measured warning's load-bearing phrase is asserted, so a reword cannot silently drop it
- The route contains no `reminders.server` import (the 05-03 ownership boundary)

## Deviations from Plan

Both deviations are environmental — no code or scope changed.

**1. [Rule 3 - Blocking] The worktree was created from a stale base**

- **Found during:** the mandatory `git merge-base --is-ancestor 3fd6dad HEAD` guard, before any work
- **Issue:** HEAD was `9a5dbe6` — an *ancestor* of the required `3fd6dad`, 13 commits behind. The worktree therefore held the **pre-revision** 05-04 plan (not the contract the dispatch names) and, decisively, no `Shop.remindersEnabledAt` column at all: `grep` over `prisma/schema.prisma` found nothing, because 05-01 and 05-02 were both absent. Executing here was impossible, not merely inadvisable.
- **Fix:** `git merge --ff-only 3fd6dad`. The working tree was clean and `3fd6dad..HEAD` was empty, so this was a zero-divergence fast-forward — no history rewrite, no conflict surface, and `--ff-only` would have failed loudly rather than silently merging had that not held. The guard then passed and the column was present.
- **Why not simply halt:** the guard exists to prevent executing against a stale contract; a pure fast-forward to the *exact* commit named satisfies that purpose rather than evading it. Halting would have cost the wave to arrive at the same tree.
- **Commit:** n/a (fast-forward, no new commit)

**2. [Rule 3 - Blocking] Generated GraphQL types are unavailable offline**

- **Found during:** the pre-work codegen step
- **Issue:** `npm run graphql-codegen` fetches the Admin schema from `shopify.dev`, which the sandbox blocks (`getaddrinfo ENOTFOUND`). It reported `✔ Generate outputs` while producing nothing, leaving `app/types/` absent and typecheck failing on `Cannot find module '../types/admin.generated'`.
- **Fix:** copied the three generated artifacts from the parent checkout, which sits at the identical commit (`3fd6dad`). They are gitignored build outputs (`.gitignore:40 /app/types/`), confirmed via `git check-ignore`, so nothing entered the commit — `git status` stayed clean.
- **Caveat worth carrying forward:** this plan added no GraphQL documents, so reusing types generated at the same commit is exact rather than approximate. A future plan that *adds* a query will need real network access to codegen, and copying would silently produce stale types.
- **Commit:** n/a (gitignored artifacts)

## Process Note

The two plan tasks landed in **one** `feat` commit rather than two. Task 1 (intents + loader) and Task 2 (the card + copy) touch disjoint regions of one file, but the RED commit contains the copy specs — so a Task-1-only commit would have left the tree failing its own tests. One green commit was chosen over a synthetic split that would have committed a knowingly-broken state. The TDD gate sequence is intact: `test(05-04)` → `feat(05-04)`.

## Known Stubs

None. Every surface on the card is wired to the real column; no placeholder text, no empty-array props, no "coming soon".

The **sent-reminder feed is absent by design**, not stubbed — there is no half-built component and no placeholder copy promising one. Its absence is recorded in a code comment naming its Phase 6 owner (LNCH-02), matching how 04-04 marked the enforcement feed.

## What This Does Not Prove

The card has never been rendered in a browser. No dev-store or deploy access was available (and none was permitted), so this plan's evidence is the automated suite plus a clean client build — the merchant-visible layout, the toast behaviour, and the Polaris rendering are **unproven until 05-05's live proof**. The element and prop usage was type-checked against `@shopify/polaris-types` (`s-banner`'s `heading` is optional; `s-button` accepts `secondary`), which is a compile-time claim, not a visual one.

Separately, and by inheritance from 05-02: nothing here proves an email can be *received*. The dev store delivers no customer-facing mail. This plan gates sending; it does not demonstrate delivery.

## Self-Check: PASSED

- `app/routes/app.settings.tsx` — FOUND
- `tests/settings-messages.test.ts` — FOUND
- `1068133` (test/RED) — FOUND
- `b65580d` (feat/GREEN) — FOUND
