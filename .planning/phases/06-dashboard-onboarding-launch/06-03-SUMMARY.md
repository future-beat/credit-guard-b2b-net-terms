---
phase: 06-dashboard-onboarding-launch
plan: 03
subsystem: infra
tags: [webhooks, shopify-app-react-router, sentry, logging, privacy, reconciliation, prisma, vitest]

requires:
  - phase: 02-ar-ledger
    provides: "webhook claim-release receipt contract (02-03/02-05), healAttribution + exhaustion flip (02-08), getAdminContext seam"
  - phase: 01-foundation
    provides: "app/sentry-redact.mjs CREDENTIAL_QUERY_PARAMS + the NODE_OPTIONS='--import ./instrument.server.mjs' pre-boot hook"
provides:
  - "Named-error acknowledge-and-drop for post-uninstall webhook deliveries on all three ledger ingest routes (WINDOWS #3)"
  - "app/access-log-redact.mjs — pre-boot stdout/stderr scrubber that keeps id_token session JWTs out of the host log store (WINDOWS #8)"
  - "Reconciliation exhaustion flip that admits the sweep's own cursor-scanned gids, so the newest unattributable order converges (WINDOWS #10)"
affects: [06-06 live reconciliation drive, 06-07 listing submission / Railway log grep, any future webhook ingest route]

actuals:
  tokens: 9341
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Named-error acknowledge-and-drop: `instanceof SessionNotFoundError` -> markWebhookProcessed + 200, everything else keeps release+rethrow"
    - "Stream-level log redaction installed from the --import hook, sharing ONE credential-parameter list with the Sentry scrubber (W-2 lineage)"
    - "Flip gates that ask 'is the licensing evidence newer than this row?' rather than 'was this row touched during the sweep?'"

key-files:
  created:
    - app/access-log-redact.mjs
    - tests/access-log-redact.test.ts
  modified:
    - app/routes/webhooks.orders.tsx
    - app/routes/webhooks.companies.tsx
    - app/routes/webhooks.payment-terms.tsx
    - app/services/reconciliation.server.ts
    - instrument.server.mjs
    - tests/webhooks.orders.test.ts
    - tests/reconciliation.test.ts

key-decisions:
  - "The drop branch keys on the SessionNotFoundError CLASS, never a message or a blanket catch — the transient-failure spec guards the rethrow path (T-06-12)"
  - "Sentry.captureMessage(..., 'warning') for the drop, not console.warn — matches the Phase-4 ACCESS_DENIED precedent for expected-but-notable states"
  - "The access-log scrubber is a regex substitution, not URL parsing: an access-log line (or a stack frame) is not a URL, and re-serialising one risks mangling text that was fine"
  - "installAccessLogRedaction fails SOFT on a non-stream — it runs in the --import hook, where throwing kills the server before boot"
  - "webhooks.companies.tsx gets the branch even though it never calls the Admin API: the rule is a property of the ingest surface, not of one route's current query set"
  - "The #10 flip gate keeps its no-race arm, narrowed to rows refreshed mid-sweep by SOMETHING ELSE; the sweep's own scan is not a race because the enumeration that licenses the flip runs after it"

patterns-established:
  - "Pattern: one CREDENTIAL_QUERY_PARAMS list, N consumers — adding a name in sentry-redact.mjs protects every scrubber with no second edit, enforced by a source guard"
  - "Pattern: comment-stripped source guards hold sibling routes to a shared rule (all three webhook routes asserted together)"

requirements-completed: [LNCH-03]

coverage:
  - id: D1
    description: "WINDOWS #3 — a post-uninstall delivery (SessionNotFoundError) is acknowledged with 200 and a processed receipt on all three ledger ingest routes, while every other error still releases the claim and rethrows"
    requirement: "LNCH-03"
    verification:
      - kind: integration
        ref: "tests/webhooks.orders.test.ts#answers 200 with a processed receipt and writes nothing to the ledger"
        status: pass
      - kind: integration
        ref: "tests/webhooks.orders.test.ts#dedupes Shopify's redelivery of a dropped id — no second Admin attempt"
        status: pass
      - kind: integration
        ref: "tests/webhooks.orders.test.ts#still releases and rethrows a NON-session failure (the drop is not a blanket catch)"
        status: pass
      - kind: unit
        ref: "tests/webhooks.orders.test.ts#app/routes/webhooks.{orders,companies,payment-terms}.tsx drops on the NAMED error only"
        status: pass
    human_judgment: false
  - id: D2
    description: "WINDOWS #8 — credential query values (id_token, hmac, signature, code, token, access_token, session) are replaced by [redacted] in every stdout/stderr line before it leaves the process, without breaking JSON records or error stacks"
    verification:
      - kind: unit
        ref: "tests/access-log-redact.test.ts (22 specs: morgan lines, JSON records, error stacks, name-collision safety, Buffer passthrough, backpressure/callback forwarding, source guards)"
        status: pass
      - kind: integration
        ref: "node --import ./instrument.server.mjs -e \"console.log('GET /app?...&id_token=eyJLIVE.tok.sig...'); console.error('... ?id_token=eyJLIVE.tok.sig')\" -> both lines print id_token=[redacted]"
        status: pass
    human_judgment: false
  - id: D3
    description: "WINDOWS #10 — the exhaustion flip admits UNRESOLVED rows this sweep's own cursor scan refetched, so the newest unattributable order converges to NO_COMPANY in one sweep, while rows refreshed mid-sweep by an in-flight webhook still wait"
    verification:
      - kind: integration
        ref: "tests/reconciliation.test.ts#flips a row THIS sweep's own cursor scan refetched, in the same sweep (WINDOWS #10)"
        status: pass
      - kind: integration
        ref: "tests/reconciliation.test.ts#converges the shop's NEWEST unattributable order instead of starving it (WINDOWS #10, live #1012)"
        status: pass
      - kind: integration
        ref: "tests/reconciliation.test.ts#still leaves a row refetched mid-sweep by an IN-FLIGHT webhook for the next cycle"
        status: pass
      - kind: integration
        ref: "tests/reconciliation.test.ts#recovers a NO_COMPANY row the moment its order appears on a company's edge (W-2 — never sticky)"
        status: pass
    human_judgment: false
  - id: D4
    description: "WINDOWS #8 LIVE — the deployed Railway access log shows id_token=[redacted] (and no JWT fragment) after a real embedded app open"
    verification: []
    human_judgment: true
    rationale: "Requires a deployed build plus a human opening the embedded app; scheduled as 06-07 Task 2 (`railway logs` grep). Nothing in this repo can assert what the host's log store received."
  - id: D5
    description: "WINDOWS #10 LIVE — an in-container reconcileShop on credit-guard-demo flips order #1012 to NO_COMPANY and lifts dataComplete to true"
    verification: []
    human_judgment: true
    rationale: "Needs the real shop's data and a deployed container; scheduled as 06-06 Task 3 with before/after prod-ledger-state attribution counts."

duration: 32 min
completed: 2026-08-21
status: complete
---

# Phase 6 Plan 3: Gap Closure B — WINDOWS #3, #8, #10 Summary

**Post-uninstall webhook deliveries are now acknowledged-and-dropped on a named error, session JWTs are scrubbed out of stdout/stderr by a pre-boot stream wrapper, and the reconciliation exhaustion flip stopped starving the shop's newest unattributable order — each pinned by a regression spec that fails on the pre-fix code.**

## Performance

- **Duration:** 32 min
- **Started:** 2026-08-21T17:04:00Z
- **Completed:** 2026-08-21T17:36:00Z
- **Tasks:** 3
- **Files modified:** 9 (2 created, 7 modified)

## WINDOWS Closure

| # | File | Change | Regression spec | RED evidence (pre-fix) |
|---|------|--------|-----------------|------------------------|
| **3** — post-uninstall 500 retry loop | `app/routes/webhooks.orders.tsx`, `webhooks.companies.tsx`, `webhooks.payment-terms.tsx` | `if (error instanceof SessionNotFoundError)` in each catch, BEFORE the release: `markWebhookProcessed(webhookId)` + `Sentry.captureMessage(..., "warning")` + `return new Response()` (200). Every other error keeps release-and-rethrow. | 7 specs in `tests/webhooks.orders.test.ts` (200 + processed receipt + empty ledger; single warning at level `warning`; redelivery dedupe with one `getAdminContext` call; non-session failure still rethrows; comment-stripped source guard across all three routes) | `6 failed \| 22 passed` on the pre-fix tree — only the "still releases and rethrows a NON-session failure" spec passed, which is exactly the behaviour that had to survive. GREEN: `3 files, 58 passed` across orders + b2b-events + chaos suites. |
| **8** — id_token session JWTs in the access log | `app/access-log-redact.mjs` (new), `instrument.server.mjs` | `redactLogLine(line)` — one `g` regex built from the SHARED `CREDENTIAL_QUERY_PARAMS`, matching `[?&]name=` and consuming the value up to `&`, whitespace, quote or backslash. `installAccessLogRedaction(stream)` wraps `write()` idempotently (Symbol marker), scrubs string chunks, forwards Buffers/encoding/callback/return value verbatim. Installed on `process.stdout` and `process.stderr` at the top of `instrument.server.mjs`, before `Sentry.init`. | 22 specs in `tests/access-log-redact.test.ts` (new file) | Import-time failure on the pre-fix tree (`Tests no tests`, module absent) — the strongest possible RED for a new module. GREEN: 22/22, plus a raw-Node end-to-end proof through the real `--import` hook (below). |
| **10** — exhaustion-flip starvation on the newest order | `app/services/reconciliation.server.ts` | `reconcileShop` step 1 collects `scannedGids: Set<string>` and threads it into `healAttribution(shop, now, sweepStart, scannedGids)`. The flip's where-clause becomes `{ shop, attributionStatus: "UNRESOLVED", OR: [{ refetchedAt: { lt: sweepStart } }, { orderGid: { in: [...scannedGids] } }] }`, with the OR member omitted when the scan returned nothing. | `tests/reconciliation.test.ts`: the spec at ~650 that ENCODED the starvation was rewritten to expect `NO_COMPANY`/`flippedNoCompany 1`; a two-sweep convergence regression modelled on live #1012 was added; the race it was really protecting got its own explicit in-flight spec. | `2 failed \| 22 passed` on the pre-fix tree — both new/rewritten flip expectations returned `UNRESOLVED`; the in-flight race spec passed pre- and post-fix, proving the narrowing did not weaken it. GREEN: 24/24. |

**No WINDOWS/STATE/ROADMAP file was touched** (executor prohibition) — this table is the closure evidence.

### Live checks that still follow

| # | Where | What it proves |
|---|-------|----------------|
| **10** | 06-06 Task 3 | In-container `reconcileShop` on credit-guard-demo, with before/after `prod-ledger-state` attribution counts: order #1012 flips to `NO_COMPANY` and the shop's `dataComplete` reads `true`. |
| **8** | 06-07 Task 2 | `railway logs` grepped for `id_token=[redacted]` after the human opens the embedded app on the deployed build — the only place that can prove what the host's log store actually received. |

## Accomplishments

- **#3 closed without weakening the retry contract.** The drop is gated on the `SessionNotFoundError` class imported from `@shopify/shopify-app-react-router/server` — verified present at `dist/esm/server/index.mjs:7` and re-exported at type level via `export * from './errors'`. The existing 02-03 transient-failure spec is untouched and still green, which is the guarantee that a real Admin API blip still costs a redelivery rather than a delivery.
- **#8 closed at the only layer that can see the leak.** `react-router-serve` hard-wires `app.use(morgan("tiny"))` with no option or env var, so the line cannot be intercepted upstream without a custom server or a logging dependency — both prohibited. The `--import` hook already runs before the server module graph, so wrapping the stream there catches morgan's line and any error stack that quotes a URL, with zero dependencies.
- **#10 closed by fixing the gate's question, not by removing it.** The old gate asked "was this row touched during the sweep?"; the new one asks "is the enumeration that licenses the flip newer than this row's evidence?". Both arms answer yes; a row refreshed by an unseen in-flight webhook still answers no.
- **Suite grew from 587/22 to 618/23**, all green: +7 webhook specs, +22 scrubber specs, +2 net reconciliation specs.

## Task Commits

1. **Task 1: #3 — acknowledge-and-drop SessionNotFoundError on the three ledger ingest routes** — `7627a4c` (fix)
2. **Task 2: #8 — scrub credential query values out of the access log before they reach stdout** — `c9e3a3f` (fix)
3. **Task 3: #10 — let the sweep's own cursor scan feed the exhaustion flip** — `729fc5d` (fix)

## Files Created/Modified

- `app/access-log-redact.mjs` *(new)* — `redactLogLine` + `installAccessLogRedaction`; plain ESM, one import (the shared `CREDENTIAL_QUERY_PARAMS`), loadable by raw Node 20.
- `tests/access-log-redact.test.ts` *(new)* — 22 specs including both source guards (instrument wiring; single-import/no-drift rule).
- `app/routes/webhooks.orders.tsx` — Sentry + `SessionNotFoundError` imports; the drop branch with the full rationale comment (including the accepted I-03 reinstall-window drop).
- `app/routes/webhooks.companies.tsx` — same branch, comment noting it is a uniform ingest-surface rule rather than a live path there today.
- `app/routes/webhooks.payment-terms.tsx` — same branch, comment tied to `refetchOrderAndRecompute`'s Admin dependency.
- `app/services/reconciliation.server.ts` — `scannedGids` collection in step 1; `healAttribution` signature + OR'd flip gate; rewritten doc comment naming the live #1012 observation.
- `instrument.server.mjs` — installs the scrubber on stdout and stderr before `Sentry.init`.
- `tests/webhooks.orders.test.ts` — the `post-uninstall delivery — acknowledge-and-drop (WINDOWS #3)` describe block.
- `tests/reconciliation.test.ts` — rewritten flip spec + two new specs.

## Verification

| Check | Result |
|-------|--------|
| `npx vitest run tests/webhooks.orders.test.ts tests/access-log-redact.test.ts tests/reconciliation.test.ts` | 3 files, **74 passed** |
| `npm test` (full suite) | **23 files, 618 passed** (floor was 587/22) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | built, `build/server/index.js` 162.32 kB |
| Raw-Node module load (plan's Task 2 command) | `GET /app?shop=s.myshopify.com&id_token=[redacted]&host=h 200 - 3 ms` |
| Real pre-boot hook, both streams | `node --import ./instrument.server.mjs -e "console.log(...); console.error(...)"` → stdout line and stderr stack both show `id_token=[redacted]`, no JWT fragment |
| `package.json` start script | unchanged — already `NODE_OPTIONS='--import ./instrument.server.mjs' react-router-serve ...`, so #8 needed no shared-file edit and no HALT |
| New dependencies | none (`package.json` / `package-lock.json` untouched) |

## Decisions Made

- **Warning channel: Sentry, not console.** The drop is an expected-but-notable state, and the Phase-4 ACCESS_DENIED precedent (`Sentry.captureMessage(msg, "warning")`) is the codebase's established shape for exactly that. `console.warn` would be invisible in the place someone actually looks after a reviewer reports 500s.
- **Regex over `new URL()` for the log scrubber.** `sentry-redact.mjs` parses because it is handed a URL. A log line is a method + path-with-query + status + duration, and a stack frame is less URL-shaped still; finding and re-serialising an embedded URL risks damaging text that was fine. The substitution edits exactly the credential — which is also what keeps a JSON record parseable (the value match stops at the quote).
- **The scrubber fails soft, unlike `redactUrl`.** `redactUrl` fails closed (returns `[redacted]`) because dropping a diagnostic beats leaking a token into Sentry. `installAccessLogRedaction` cannot take that posture: it runs inside the `--import` hook, so throwing takes the server down before boot. Its only reachable failure is a caller passing a non-stream, which is a programming error, not a credential.
- **Buffers pass through unscrubbed.** Node's console and morgan both write strings; decoding arbitrary Buffers would risk corrupting genuinely binary output for no practical coverage gain. Recorded here so the boundary is explicit rather than accidental.
- **The `in: []` trap was designed out.** An empty cursor page must not widen the predicate into `orderGid: { in: [] }` — the OR member is only appended when `scannedGids.size > 0`, so an empty sweep behaves exactly as before.

## Deviations from Plan

None — plan executed exactly as written. The plan's contingency (`if package.json's start script genuinely needs a change for #8, HALT`) did not trigger: the `start` script already carries `--import ./instrument.server.mjs`, verified by reading `package.json` before Task 2 and re-confirmed by the raw-Node hook run.

## Issues Encountered

- **Worktree had no `node_modules` and no generated `app/types/`.** Resolved per the autonomy brief: `npm ci --offline` from the committed lockfile (964 packages, no new dependencies, `package.json`/`package-lock.json` unmodified) and the three `app/types/` codegen artifacts copied from the parent checkout. Both are gitignored build inputs; neither appears in any commit.
- **Scratch database.** `creditguard_test_0603` created and migrated; every run used `TEST_DATABASE_URL` pointed at it. Dropped at close-out.
- **eslint reports `'process' is not defined` when `instrument.server.mjs` is linted by explicit path.** Pre-existing and not introduced here: the `.eslintrc.cjs` Node override matches `**/*.server.{js,ts}`, not `.mjs`, and `eslint .` (the `lint` script) does not pick up `.mjs` at all — the same errors fire on the pre-change file's existing `process.env.SENTRY_DSN` lines. `npm run lint` is clean. Logged, not fixed: widening the eslint config is out of this plan's file ownership.

## Next Phase Readiness

- All three code-addressable WINDOWS items outside the reminder engine are closed and test-pinned; nothing here blocks the other wave-1 plans (no shared files touched — `package.json`, `app/routes/app*.tsx`, `prisma/`, reminders/enforcement/settings and `scripts/` are all untouched).
- Branch `worktree-agent-a1545948f03744fc6`, three commits on top of `4de4599`. Not pushed, not merged.
- Two live confirmations remain, both already scheduled: #10 in 06-06 Task 3, #8 in 06-07 Task 2. Neither is a code change.

## Self-Check: PASSED

- All 10 claimed files present on disk (2 created, 7 modified, 1 SUMMARY).
- All 3 task commits present in `git log`: `7627a4c`, `c9e3a3f`, `729fc5d`.
- Plan `<verification>` re-run at close-out: targeted 3-file run 74 passed; full suite 23 files / 618 passed; typecheck, lint and build clean.

---
*Phase: 06-dashboard-onboarding-launch*
*Completed: 2026-08-21*
