---
phase: 04-checkout-enforcement
plan: 04
subsystem: ui
tags: [polaris-web-components, react-router, validationUpdate, config_v1, settings, shopify-functions, tenancy]
requires:
  - phase: 04-checkout-enforcement
    provides: "04-03 ensureValidationRegistered, Shop.validationGid, DEFAULT_MESSAGES (P4-L4) and buildConfigValue (P4-L5); 04-01 the Function's messagesFrom per-field fallback and its 250-char guard"
  - phase: 03-credit-controls-metafield-publishing
    provides: "app.companies.tsx action discipline (intent whitelist, shop-from-session, seam-mocked route tests on real Postgres) and the userErrors-inside-data posture from 03-01"
provides:
  - "app/routes/app.settings.tsx — the ENFC-03 merchant surface: honest 3-state rule status plus the two editable block messages, saved to the Validation's $app/config_v1 metafield"
  - "readValidationConfig(shop) — non-throwing platform-truth read (active | disabled | unregistered) with per-field DEFAULT_MESSAGES fallback"
  - "updateValidationMessages(shop, messages) — validationUpdate writer that never throws to the route and reports userErrors as a failure"
  - "app/block-messages.ts — the client-safe half of the message contract (MAX_MESSAGE_LENGTH, validateMessage, ValidationMessages), re-exported from enforcement.server.ts"
  - "tests/settings-messages.test.ts — 32 tests; suite now 485 green across 21 files"
  - "The Settings nav slot reserved by 03-UI-SPEC is now filled; every reserved slot is consumed"
affects:
  - "04-05: EC-4 can now edit the copy in the deployed admin and prove the edited string renders at a real blocked checkout (the live half of ENFC-03)"
  - "Phase 6 (DASH-02): the enforcement event feed and the D4-02 currency-mismatch list are explicitly deferred, with the insertion point marked in app.settings.tsx"
actuals:
  tokens: 13500
  tasks: 2
  commits: 3
tech-stack:
  added: []
  patterns:
    - "Split a `.server` service when the admin UI needs its pure half: pure contract in a plain module, re-exported from the `.server` module so no caller's import path changes"
    - "Honest platform-state status (three named states read back through the Admin API) rather than an app-DB-inferred green badge"
    - "Line-ending normalization as the ONE permitted rewrite of merchant input, so a length cap counts the merchant's text and not the transport's framing"
key-files:
  created:
    - app/routes/app.settings.tsx
    - app/block-messages.ts
    - tests/settings-messages.test.ts
  modified:
    - app/services/enforcement.server.ts
    - app/routes/app.tsx
key-decisions:
  - "Status is read from the platform (validation(id:) -> enabled), never inferred from Shop.validationGid alone: a stored GID pointing at a deleted rule reports `unregistered`, not `active`"
  - "The update input carries ONLY `metafields` — writing `enable` would let a copy edit silently switch a merchant-disabled rule back on; a test pins the key set"
  - "The 250-char cap is measured in UTF-16 code units, the same measure the Function's own guard uses, so the server can never accept copy the wasm would silently replace with the default"
  - "`validation(id: $id)` (a typed root field) instead of the plan's `node(id:) on Validation` — schema-verified, non-deprecated, and avoids an inline fragment"
  - "HTML is not filtered; control characters are. Shopify renders errors[].message as plain text at $.cart, and rejecting `<` would refuse legitimate copy like `email us <ar@acme.com>`"
  - "Save failures never toast: they render as a persistent banner or field error with the merchant's typed text still on screen to correct"
patterns-established:
  - "Client-safe/server-only split: `app/block-messages.ts` holds the pure contract, `enforcement.server.ts` re-exports it — the client build is the enforcing gate"
  - "Cross-home cap lockstep test (server cap == the Function's MAX_MESSAGE_LENGTH literal), mirroring 04-03's DEFAULT_MESSAGES byte-diff"
requirements-completed: [ENFC-03]
coverage:
  - id: D1
    description: "Merchant opens Settings from the app nav and sees the two current block messages, read from config_v1 with per-field fallback to DEFAULT_MESSAGES"
    requirement: ENFC-03
    verification:
      - kind: integration
        ref: "tests/settings-messages.test.ts#shows the merchant's saved copy when config_v1 holds it"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#falls back FIELD BY FIELD when config_v1 is partly unusable"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#falls back wholesale on an absent metafield, junk JSON, or a wrong version"
        status: pass
      - kind: other
        ref: "grep -q 'app/settings' app/routes/app.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "Saving writes the full config_v1 JSON via validationUpdate through the graphqlJson transport, and a reload round-trips the saved copy"
    requirement: ENFC-03
    verification:
      - kind: integration
        ref: "tests/settings-messages.test.ts#writes the full config_v1 JSON with both messages and reports success"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#round-trips: what the mutation wrote is what a reload renders"
        status: pass
    human_judgment: false
  - id: D3
    description: "Server-side validation: each message is a non-empty plain-text string of 250 characters or fewer; over-cap, empty or non-string input is rejected with a field error and nothing is written"
    requirement: ENFC-03
    verification:
      - kind: integration
        ref: "tests/settings-messages.test.ts#accepts a message of exactly 250 characters"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#rejects 251 characters with a field error and issues NO mutation"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#rejects an empty or whitespace-only message, per field, with no mutation"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#rejects non-string form values (a file part) with no mutation"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#rejects control characters — the checkout renders plain text"
        status: pass
      - kind: unit
        ref: "tests/settings-messages.test.ts#keeps the 250-char cap in lockstep with the Function's own guard"
        status: pass
    human_judgment: false
  - id: D4
    description: "The page shows honest rule status in all three states: active, merchant-disabled in checkout settings, or not registered yet"
    requirement: ENFC-03
    verification:
      - kind: integration
        ref: "tests/settings-messages.test.ts#reports active when the shop's Validation exists and is enabled"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#reports disabled — never active — when the merchant turned the rule off"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#reports unregistered when the shop has no stored Validation GID"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#reports unregistered when the stored GID points at a deleted rule"
        status: pass
      - kind: unit
        ref: "tests/settings-messages.test.ts#names the three honest states distinctly and never says 'protected'"
        status: pass
    human_judgment: false
  - id: D5
    description: "Unknown intents answer 400 having changed nothing, and userErrors from validationUpdate are surfaced as a save failure rather than swallowed"
    requirement: ENFC-03
    verification:
      - kind: integration
        ref: "tests/settings-messages.test.ts#answers 400 to an unknown intent having written nothing"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#answers 400 to a missing intent"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#reports userErrors inside data as a FAILURE and captures them"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#reports a transport failure as a save failure, never as success"
        status: pass
    human_judgment: false
  - id: D6
    description: "Shop-scoped writes only: the validation GID comes from the authenticated shop's own row and a forged form field cannot address another merchant's rule (T-04-14)"
    requirement: ENFC-03
    verification:
      - kind: integration
        ref: "tests/settings-messages.test.ts#addresses only the authenticated shop's own Validation on save"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#ignores a validation id smuggled in through the form body"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#follows the session when the authenticated shop changes"
        status: pass
      - kind: integration
        ref: "tests/settings-messages.test.ts#refuses to save when the shop has no Validation, and issues no mutation"
        status: pass
    human_judgment: false
  - id: D7
    description: "The rendered Settings page in the embedded admin — Polaris web components lay out correctly, the character counters and field errors read well, and the status banner is legible in the three states"
    verification: []
    human_judgment: true
    rationale: "Visual/layout adequacy in the embedded Shopify admin cannot be asserted from a node test suite; the route's markup is exercised only at the loader/action seam here. Browser verification lands with 04-05's deployed-app pass."
  - id: D8
    description: "The enforcement event feed and the D4-02 currency-mismatch company list are explicitly deferred to Phase 6 (DASH-02), not half-built"
    verification:
      - kind: other
        ref: "app/routes/app.settings.tsx — the marked PHASE 6 (DASH-02) insertion-point comment; no feed code exists on the page"
        status: pass
    human_judgment: false
duration: 21 min
completed: 2026-08-20
status: complete
---

# Phase 4 Plan 4: Enforcement Settings Page Summary

**A Settings page that lets a merchant rewrite both checkout block messages into the Validation's `$app/config_v1` metafield through `validationUpdate`, behind a 250-character server-side cap, and that reports the enforcement rule's real platform state in three honest words rather than one optimistic badge.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-08-20T04:43:00Z
- **Completed:** 2026-08-20T05:04:09Z
- **Tasks:** 2
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- **The ENFC-03 merchant surface exists.** `/app/settings` reads the live Validation, shows whichever copy buyers will actually see (per-field fallback to `DEFAULT_MESSAGES` when config_v1 is absent, junk, partly junk, or the wrong version), and writes edits back as the same `{"v":1,…}` shape the Function already parses.
- **The cap is a real gate, not a textarea attribute.** `validateMessage` refuses 251 characters, empty/whitespace-only input, non-string form parts and control characters — and every refusal happens *before* any transport, so an invalid submission leaves the copy buyers see untouched (T-04-13).
- **Status is honest in all three states.** `active`, `disabled` ("the enforcement rule is turned off in checkout settings" — a merchant choice the app reports rather than overrides) and `unregistered`, all read back from the platform. A stored GID pointing at a deleted rule reports `unregistered`; a GraphQL blip degrades to `unregistered` plus a Sentry capture instead of a 500 on the page the merchant came to use.
- **Cross-shop isolation is locked by a bystander.** Every test seeds a second shop with its own Validation GID; the mutation id is only ever the authenticated shop's own row, including when one is smuggled through the form body (T-04-14).
- **Phase 6 stays Phase 6.** The event feed and the currency-mismatch list are absent by design, with the insertion point marked in the route so their absence reads as a decision.

## Task Commits

1. **Task 1: Config read/write helpers + Settings loader/page + nav** — `8ca1547` (feat)
2. **Task 2: save-messages action + tests + suite green** — `7f44c12` (test), `23edced` (fix)

**Plan metadata:** see the `docs(04-04)` commit following this SUMMARY.

## Files Created/Modified

- `app/routes/app.settings.tsx` (created, 374 lines) — loader (status + current messages), action (`save-messages` intent only, 400 on anything else), and the Polaris web-component form: status banner, two capped `s-text-area` fields with live counters, one primary save button.
- `app/block-messages.ts` (created) — the pure, client-safe half of the message contract: `MAX_MESSAGE_LENGTH`, `validateMessage`, `hasControlCharacters`, `ValidationMessages`.
- `tests/settings-messages.test.ts` (created, 32 tests) — the real loader and action against real Postgres, with only auth and the Admin GraphQL seam faked.
- `app/services/enforcement.server.ts` (modified, +267) — `READ_VALIDATION_CONFIG_QUERY`, `UPDATE_VALIDATION_MUTATION`, `parseConfigValue`, `readValidationConfig`, `updateValidationMessages`; re-exports the pure half.
- `app/routes/app.tsx` (modified) — fills the last 03-UI-SPEC-reserved nav slot with the Settings link.

## Decisions Made

- **`validation(id: $id)` instead of the plan's `node(id:) on Validation`.** The schema (`admin-2026-07.schema.json`) carries a non-deprecated typed root field; using it avoids an inline fragment and gives codegen a concrete type. Same data, fewer moving parts.
- **The update input carries only `metafields`.** `ValidationUpdateInput` also accepts `enable` and `blockOnFailure`; including either would mean a copy edit could silently re-enable a rule the merchant deliberately switched off, or move the ENFC-04 fail-open flag. A test pins the key set to exactly `["metafields"]`.
- **UTF-16 code units, not code points.** The Function measures `candidate.length`; if the server measured code points it could accept a 250-code-point message that the wasm then rejects, so the merchant would save copy the app confirmed while buyers kept reading the default.
- **Control characters rejected, HTML allowed.** Shopify renders `errors[].message` as plain text at `$.cart` (no markup path), so filtering `<` would only refuse legitimate copy like "email us <ar@acme.com>". The cap plus a C0/C1 scan is the whole plain-text policy.
- **Failures never toast.** A failed save renders a persistent banner (or a field error) with the merchant's typed text still on screen; only success toasts. Losing what someone typed to a transient error is the one outcome a settings form must never produce.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The length cap counted the transport's CRLF framing, not the merchant's text**

- **Found during:** Task 2 (the new suite's line-break test failed RED)
- **Issue:** Multipart form encoding rewrites every `\n` the merchant typed as `\r\n` on the wire. A two-line message that read 250 characters in the browser's counter therefore arrived at 255 and was rejected — for characters the merchant never typed and cannot see. Repeated save/reload cycles would also have grown a CR per round.
- **Fix:** `validateMessage` now normalizes line endings (`\r\n` and lone `\r` → `\n`) before trimming and measuring. This is the ONE rewrite the validator performs, documented as such at the call site, precisely because silently rewriting merchant input is otherwise forbidden here.
- **Files modified:** `app/block-messages.ts` (the validator, post-split)
- **Verification:** `tests/settings-messages.test.ts#keeps a deliberate line break — a textarea is a textarea` (red before, green after)
- **Committed in:** `23edced`

**2. [Rule 3 - Blocking] The client build refused the route: a `.server` module reached browser code**

- **Found during:** Task 2 (`npm run build`, after the suite was already green)
- **Issue:** The Settings page needs `MAX_MESSAGE_LENGTH` in code that ships to the browser (the field's `maxLength`, the character counters, the error copy). React Router strips only `loader`/`action` from a route's client bundle, so importing the cap from `enforcement.server.ts` failed the build outright — correctly, since the alternative is Prisma and the Admin client in a browser bundle. Tests, lint and typecheck were all green and did not catch this; only the client build did.
- **Fix:** Extracted the pure half (`MAX_MESSAGE_LENGTH`, `validateMessage`, `hasControlCharacters`, `ValidationMessages`) into `app/block-messages.ts` — no database, no transport, no secrets — and re-exported it from `enforcement.server.ts`, so every existing import path (including plan 04-03's tests) is unchanged.
- **Files modified:** `app/block-messages.ts` (new), `app/services/enforcement.server.ts`, `app/routes/app.settings.tsx`
- **Verification:** `npm run build` exits 0 (`✓ built in 1.52s`); full suite still 485 green
- **Committed in:** `23edced`

**3. [Rule 1 - Process] The Task 2 action shipped inside the Task 1 commit**

- **Found during:** Task 2
- **Issue:** `app/routes/app.settings.tsx` was written as one file in Task 1, which necessarily included the `action` the plan assigned to Task 2. The TDD RED gate for the action itself was therefore never observable — the tests met an implementation that already existed.
- **Fix:** Not retro-fixed (rewriting a pushed-branch commit to stage theatre is worse than the record). Recorded here instead. The gate was not vacuous in practice: the suite still produced a genuine RED (deviation 1) that drove a real behavioural fix, and the test commit (`7f44c12`) precedes the fix commit (`23edced`).
- **Files modified:** none
- **Verification:** `git log --oneline` shows `feat` → `test` → `fix` rather than `test` → `feat`
- **Committed in:** n/a

---

**Total deviations:** 3 (1 bug, 1 blocking, 1 process record)
**Impact on plan:** Both code deviations were necessary for correctness — one is a cap that would have insulted merchants who pressed Enter, the other a build that would not ship. The module split is additive and leaves every prior import path intact. No scope creep; the Phase 6 boundary held.

## Issues Encountered

- **The plan's `node(id:) on Validation` read was replaced** with the schema-verified `validation(id: $id)` root field (see Decisions). No behavioural difference; recorded so a reader diffing plan against code is not surprised.
- **`app/types/` is gitignored**, so `npm run graphql-codegen` was run before every typecheck/build, as the environment note requires. The new documents (`ValidationConfig`, `UpdateValidationConfig`) generate cleanly against Admin API 2026-07.
- **Scratch database** `creditguard_test_0404` was created, migrated, used for every run in this plan, and dropped at close. `creditguard_dev` and `creditguard_test` were never touched.

## Known Stubs

None. No placeholder data, no unwired components, no skipped tests.

The absence of the enforcement event feed is a scoping decision (Phase 6 / DASH-02), not a stub: no half-built feed code exists on the page, and the insertion point is marked by comment so a future reader sees a decision rather than an oversight.

## Threat Flags

None. The plan's threat register covers everything this plan introduced:

- **T-04-13** (merchant text into checkout) — mitigated: 250-char server-side cap in UTF-16 units matching the Function's own guard, control characters rejected, plain-text-only policy documented.
- **T-04-14** (forging another shop's validation) — mitigated: the GID is read only from the authenticated shop's row; four tests, with a bystander shop seeded in every case.
- **T-04-15** (silent save failures) — mitigated: userErrors inside `data` and transport throws both report `save-failed` (502) with a Sentry capture; the round-trip read is tested.

No new network endpoints, auth paths, file access or schema changes were introduced.

## Verification Results

- `npx vitest run tests/settings-messages.test.ts` — **32 passed**
- `npm test` (full suite, against `creditguard_test_0404`) — **485 passed across 21 files** (Wave 2 floor was 453/20; +32 is exactly this plan's new file, no regressions)
- `npm run lint` — clean
- `npm run typecheck` — clean
- `npm run build` — exits 0
- `grep -q 'app/settings' app/routes/app.tsx` — present
- Comment-free grep for `@shopify/polaris` in `app/routes/app.settings.tsx` — **0 matches**

## Human Checkpoints (status unknown — browser-only)

Recorded per this plan's autonomy note; none were run, all are browser work for 04-05's deployed pass:

1. **Settings page renders correctly in the embedded admin** — Polaris web-component layout, the two `s-text-area` fields, live character counters, banner tone legibility. (Coverage D7.)
2. **The three status states render as intended against the real store** — `credit-guard-demo` currently has the rule ON, so `active` is the observable state; `disabled` and `unregistered` need the merchant to toggle/delete the rule in Settings → Checkout → Checkout rules.
3. **An edited message reaches a real blocked checkout** — the live half of ENFC-03, explicitly assigned to 04-05 (EC-4).

## User Setup Required

None — no external service configuration, no new packages, no scope changes.

## Next Phase Readiness

- **04-05 can proceed.** The write path it needs to exercise end-to-end (`validationUpdate` on the shop's own Validation) is implemented and seam-tested; the deployed dev store already has the rule registered and enabled, and `write_validations` is live in `sessionScopes`.
- **Open items A3/A4 remain 04-05's** (EC-4) as scoped — this plan's `validationUpdate` path is seam-mocked and passes regardless of how they resolve. If A3 turns out to reject inline `$app` metafields on *update* as well as create, `updateValidationMessages` will report `save-failed` honestly rather than lying, and would need the same `metafieldsSet` fallback 04-03 implemented for create. That is the one live-behaviour risk this plan cannot retire from a test.
- **No blockers.** Branch `phase-04-checkout-enforcement` is pushed; not merged, no PR opened, per instructions.

---
*Phase: 04-checkout-enforcement*
*Completed: 2026-08-20*

## Self-Check: PASSED

- All three created files exist on disk (`app/routes/app.settings.tsx`, `app/block-messages.ts`, `tests/settings-messages.test.ts`).
- All three task commits are reachable in git (`8ca1547`, `7f44c12`, `23edced`).
- Every plan `<verification>` command was re-run at close: new suite 32 passed, full suite 485 passed, comment-free Polaris grep returns 0.
