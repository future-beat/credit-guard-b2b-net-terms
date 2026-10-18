---
quick_id: 260910-nhm
phase: quick-260910-nhm
plan: 01
type: quick
subsystem: webhooks, lifecycle, scheduler
tags: [gdpr, webhooks, hmac, token-health, redaction, hotfix, release]
status: complete
requirements: [FOUND-02, FOUND-03, LEDG-05]
windows: [30, 31, 32]

dependency_graph:
  requires:
    - "@shopify/shopify-api 13.1.0 (already installed transitively; now declared direct)"
    - "app/shopify.server.ts — the main shopifyApp() config, unchanged"
  provides:
    - "validateWebhook — HMAC verification with no session load (app/shopify.server.ts)"
    - "validateWebhookRequest — the 405/401/400 route contract (app/services/webhook-validate.server.ts)"
    - "classifyConstructionFailure / classifyRequestFailure / recordTokenFailure / clearTokenFailures (app/services/token-health.server.ts)"
    - "expiredRefreshableSession — the WINDOWS #31 regression seed (tests/helpers/offline-session.ts)"
  affects:
    - "app/routes/webhooks.compliance.tsx, app/routes/webhooks.app.uninstalled.tsx — neither loads a session any more"
    - "app/services/admin-client.server.ts — every background Admin call now passes through the token-health hooks"
    - "app/services/shop-lifecycle.server.ts — redactShop covers EnforcementEvent"

tech_stack:
  added:
    - "@shopify/shopify-api@13.1.0 (exact, direct — zero new bytes in node_modules)"
  patterns:
    - "A second, validation-only shopifyApi() instance: the app object built by shopifyApp() does not expose its internal `api`, so HMAC-without-session needs its own instance built from the SAME env vars."
    - "Strike counter with a FIXED time-window anchor, stored as JSON in SyncCursor — a hotfix must not carry a schema migration."
    - "Process-level healthy set to bound a per-call DELETE down to one per shop per process."

key_files:
  created:
    - app/services/webhook-validate.server.ts
    - app/services/token-health.server.ts
    - tests/helpers/offline-session.ts
    - tests/admin-token-health.test.ts
  modified:
    - app/shopify.server.ts
    - app/routes/webhooks.compliance.tsx
    - app/routes/webhooks.app.uninstalled.tsx
    - app/services/admin-client.server.ts
    - app/services/shop-lifecycle.server.ts
    - tests/webhooks.compliance.test.ts
    - tests/shop-lifecycle.test.ts
    - package.json
    - package-lock.json
    - CHANGELOG.md
    - .claude/CLAUDE.md
    - .planning/WINDOWS.md

decisions:
  - "The route validator mirrors the library authenticator byte-for-byte in behaviour (405 -> read body once -> 401 on InvalidHmac -> 400 otherwise) and stops exactly where the session load began. Anything more clever would be a second definition of the app's HMAC contract."
  - "Token-health lives at the admin seam, not in forEachActiveShop's catch: metafields.server.ts:325 and reminders.server.ts:1319 swallow their errors, so a dead token in the hourly sweeps never reaches that catch. The seam is the only place with BOTH the failure and the success signal."
  - "Strike windows are anchored at strike time and never slide. A sliding window would starve a genuinely dead shop of its second strike forever, because runAttributionHealSweep reaches the seam every 5 minutes."
  - "Any RESOLVED graphql() call resets the counter — including a 200 carrying GraphQL errors[] such as ACCESS_DENIED after a scope release. That is a consent problem, not a token problem."
  - "The deactivation decision emits a Sentry captureMessage tagged windows:30 as well as a console.log, because Railway retains logs for the current deployment only."

metrics:
  duration: "~35 min"
  completed: 2026-09-10
  tasks: 4
  commits: 6

actuals:
  tokens: 47000
  tasks: 4
  commits: 6
---

# Quick task 260910-nhm: hotfix v1.0.1 Summary

Two GDPR/lifecycle webhook routes now verify their HMAC through a
validation-only `shopifyApi` instance and never load a session — so an
unrefreshable offline token can no longer 500 a `shop/redact` forever — plus
`EnforcementEvent` redaction and an admin-seam strike counter that treats a
revoked token as the uninstall it always was.

## What shipped

**WINDOWS #31 — the live GDPR failure.** `authenticate.webhook` calls
`ensureValidOfflineSession` *after* the HMAC check and *before* the handler. For
a store that was deleted without ever sending `app/uninstalled`, the refresh
fails and `helpers/refresh-token.mjs` collapses it into a bare `Response(500)`.
Reviewer store eztcd0-3u's `shop/redact` had answered 500 nine times since
2026-09-05T19:25Z and its data was never redacted.

The fix could not use the low-level validator the ledger entry proposed:
`shopifyApp()` returns only `{ sessionStorage, addDocumentResponseHeaders,
registerWebhooks, authenticate, unauthenticated, login }` and keeps its internal
`api` in a closure, so `shopify.api.webhooks.validate` does not exist. Instead
`app/shopify.server.ts` builds one extra validation-only `shopifyApi()` instance
from the same env vars (so the two secrets cannot diverge) and exports only the
bound `validateWebhook`. `app/services/webhook-validate.server.ts` wraps it in
the library authenticator's exact contract — 405 on non-POST, one
`request.text()` before validation, 401 on `InvalidHmac`, 400 on anything else —
and stops where the session load used to begin.

**WINDOWS #32 — the redaction hole.** `EnforcementEvent` carries `companyGid`
and `companyName` snapshots with no foreign key, so it survived every redact
silently. Both sides of the two-sided contract are now closed: the `deleteMany`
in `redactShop` and the counter in `countsFor`.

**WINDOWS #30 — dead-token shops swept forever.** A revoked token that cannot be
refreshed IS an uninstall nobody told us about. `app/services/token-health.server.ts`
counts token-class failures at the admin seam against a closed list (refresh →
`Response` 500, `HttpResponseError` 400 `invalid_subject_token`, Admin API
`HttpResponseError` 401) and nothing else. Three strikes in separate 30-minute
windows deactivate the shop (D-06 retain), delete its session rows and clear the
counter.

The time gate is the whole safety argument: `graphqlJson` constructs a client
per GraphQL call, so one hourly sweep over N companies during a transient
token-endpoint hiccup would otherwise deliver N strikes in seconds and
deactivate a **live** merchant — silently stopping their overdue flip, publish
backstop, reminders and reconciliation, which is the exact failure the product
exists to prevent. The anchor is fixed rather than sliding for the mirror-image
reason: `runAttributionHealSweep` reaches the seam every 5 minutes, and a
sliding window would starve a genuinely dead shop of its second strike forever.

## Commits

| # | SHA | Subject |
|---|-----|---------|
| 1 | `d80e362` | fix(webhooks): shop/redact verifies HMAC without loading the offline session (WINDOWS #31) |
| 2 | `6c25997` | fix(webhooks): app/uninstalled verifies HMAC without loading the offline session; 405/400 contract tests (WINDOWS #31) |
| 3 | `a82997e` | fix(lifecycle): redact EnforcementEvent rows on shop/redact (WINDOWS #32) |
| 4 | `d9b6bc9` | feat(scheduler): deactivate a shop after three sweep cycles of unrefreshable-token failures at the admin seam (WINDOWS #30) |
| 5 | `0478234` | docs(ledger): close WINDOWS #30 #31 #32 — fixed in v1.0.1 (8 open) |
| 6 | *(this commit)* | release: v1.0.1 |

## Gate results

| Gate | Result |
|------|--------|
| `npm test` | **885 passed / 885, 31 files** — zero failures, no flakes (WINDOWS #25 and #26 both green in the full run) |
| `npm run graphql-codegen` | Green, and genuinely ran — emitted `app/types/admin.types.d.ts` and `app/types/admin.generated.d.ts`, so every `#graphql` document was validated against the pinned 2026-07 schema |
| `npm run typecheck` | Green (exit 0) |
| `npm run lint` | Green (exit 0) |
| `npm run build` | Green — 44 modules, `build/server/index.js` 230.54 kB. This is the gate that would have caught either new `.server` module leaking into client code |
| API version pins | `shopify.app.toml` 1 × `api_version = "2026-07"`, `shopify.extension.toml` 1 × — byte-identical to ba3a180 |
| Do-not-touch list | `git diff ba3a180 HEAD -- shopify.app.toml extensions/ prisma/ app/services/ledger.server.ts listing/` empty; `marketing/` clean |

Test growth: 869 → 885 (+16). New/changed suites: `tests/admin-token-health.test.ts`
(+10), `tests/webhooks.compliance.test.ts` (+4), `tests/shop-lifecycle.test.ts` (+2).

## TDD gates observed

- **Task 1 (tracer), WINDOWS #31 — RED observed.** The new test failed with
  `expected 500 to be 200` and took 1267 ms doing a real token-endpoint
  round-trip. GREEN runs in 199 ms, hermetically.
- **Task 2, WINDOWS #32 — RED observed.** With only the test hunks applied,
  "deletes every shop-keyed ledger table's rows (Phase 2 models)" failed on
  `enforcementEvents: 1`, alongside the two new #31 route tests and the source
  guard: 4 failed / 31 passed.
- **Task 3, WINDOWS #30 — see the deviation below.** RED could not be observed
  in the usual way (the module did not exist, so the suite could not run at
  all), so non-vacuity was proved by mutation instead.

## Deviations from plan

**1. [Rule 1 — Plan defect] Task 4's lockfile version check is wrong.**
The plan asserts `grep -c '"version": "1.0.1"' package-lock.json` equals 2. It
returns **20**: eighteen unrelated transitive packages happen to sit at 1.0.1.
Verified the real requirement precisely instead — `package-lock.json` root
`version` and `packages[""].version` both read `1.0.1`, and the whole lockfile
diff for the bump is exactly those two lines. No code change; the plan's
assertion was simply not a test of the thing it named.

**2. [Rule 1 — Plan defect] Task 4 step 3e's file count was derived from a stale
guide claim.** The plan says `28 files.` → `29 files.` and the fence line → the
totals actually printed. But `npm test` prints **31** files, not 29: two suites
live under `tests/helpers/` and vitest's `tests/**/*.test.ts` include picks them
up, so the guide's fence line was already wrong before this change. Writing "29"
next to a command that prints "31" would have manufactured a contradiction, so
the prose line now reads "29 suite files (31 as vitest counts them — two more
live under `helpers/`)" and the fence line reads the true `885 tests, 31 files`.

**3. [Rule 1 — Bug] Two module-map line counts became false and were corrected,
despite the plan marking those rows "NOT touched".** This change took
`admin-client.server.ts` from 53 to 122 lines and `shop-lifecycle.server.ts`
from 107 to 112. The table is explicitly ordered by descending line count — the
plan itself relies on that invariant to place the new rows — so leaving `53`
would have both stated a false number and broken the ordering the plan was
following. Both counts were updated and `admin-client.server.ts` moved above
`shop-lifecycle.server.ts`, with one clause added to its description pointing at
the token-health hooks. No other prose in the guide was touched.

**4. [Deviation — TDD gate] Task 3's RED was proved by mutation, not by a failing
first run.** `tests/admin-token-health.test.ts` tests a module that did not
exist, so a pre-implementation run fails at import rather than on an assertion —
which proves nothing about the assertions. Instead the implementation was
written first and the suite's non-vacuity was then demonstrated directly: with
`healthyShops.delete(shop)` removed and the time-gate condition forced to
`false`, **3 of the 10 tests fail** ("three strikes in three separate windows
deactivate…", "repeated failures inside one sweep window count once", "confirms
a shop healthy once per process…"). The mutation was reverted and the file
restored before committing. The two behaviours that carry the entire safety
argument are therefore load-bearing in the suite, not decorative.

**5. [Deviation — commit granularity, anticipated by the plan] The Task 2 test
hunks were not split across the two commits.** `tests/shop-lifecycle.test.ts`
carries interleaved #31 route hunks and #32 contract hunks; splitting them would
have produced two non-green trees. Per the plan's own fallback the whole file
ships with the `fix(lifecycle)` commit, and the `fix(webhooks)` commit body says
so.

**6. [Deviation — scope] `.planning/STATE.md` was added to the release commit.**
The orchestrator's file list for `release: v1.0.1` did not name it, but the
project records every quick task in STATE.md's quick-task table and a separate
follow-up commit would have taken HEAD off `release: v1.0.1`. Folded in as one
table row plus the `last_activity` fields.

**7. [Plan-checker warnings, folded in as instructed]** (a) the deactivation
branch emits `Sentry.captureMessage(..., { level: "warning", tags: { windows:
"30", shop } })` alongside its single `console.log`, using the app's existing
`import * as Sentry from "@sentry/react-router"` (threat T-Q30-07 — Railway logs
do not survive a deploy, and this decision determines whether a paying merchant
is still being swept); (b) the token-health header states explicitly that ANY
resolved `graphql()` call — including a 200 carrying GraphQL-level `errors[]`
such as `ACCESS_DENIED` after a scope release — is a healthy call that resets
the counter, and that only the three token-class throws are strikes; (c) Task 4
touched the guide only in the scoped locations (see deviation 3 for the one
correction beyond the six).

No auth gates were hit. No architectural (Rule 4) decisions were required.

## Known stubs

None. Every module shipped is wired to its callers and covered by tests.

## Post-deploy verification checklist (owed — NOT performed here)

Nothing was pushed, deployed or tagged. Carried verbatim from the WINDOWS
closure reasons:

- [ ] **#31** — the next `shop/redact` delivery for a dead store shows **200**
      in the Dev Dashboard webhook log (currently 9 retried 500s for eztcd0-3u
      since 2026-09-05T19:25Z).
- [ ] **#30** — within three hourly sweep cycles (≈2–3 h) of deploy, the
      `Deactivated … (WINDOWS #30)` line appears for the five dead reviewer
      stores — **one strike per cycle, never three from a single sweep** — and
      `scripts/prod-lifecycle-state.sh` shows them inactive with zero sessions.
      `credit-guard-demo-2` must reactivate when the developer opens the app.
- [ ] **#32** — `scripts/prod-enforcement-events.sh` shows **0 rows** for a
      redacted shop (eztcd0-3u currently retains 22).

## WINDOWS ledger after closure

32 entries — **8 open** (#11, #18, #19, #24, #25, #26, #27, #28), 23 fixed,
1 waived (#4). #30, #31 and #32 are `fixed` with reasons naming their fix
commits, their regression tests and the verification still owed.

## Self-Check: PASSED

All four created files present on disk; all six commits resolve in `git log`;
`ba3a180..HEAD` touches exactly 20 files (+1928 / −59), none of them in the
do-not-touch list. Working tree clean, HEAD is `release: v1.0.1`, nothing
pushed, nothing tagged.
