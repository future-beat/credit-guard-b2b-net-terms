---
phase: quick-260910-nhm
verified: 2026-09-10T10:02:02Z
status: passed
quick_status: ACHIEVED
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
range: ba3a180..c26354d
human_verification:
  - test: "Post-deploy (#31): watch the Dev Dashboard webhook log for the next shop/redact delivery to a dead store (eztcd0-3u currently shows 9 retried 500s since 2026-09-05T19:25Z)"
    expected: "HTTP 200; scripts/prod-lifecycle-state.sh no longer lists the store"
    why_human: "Requires the deployed host and Shopify's own delivery — nothing pre-deploy can exercise it"
  - test: "Post-deploy (#30): within ~2-3 h of deploy, grep Railway logs / Sentry (tag windows:30) for 'Deactivated ... (WINDOWS #30)' lines"
    expected: "One line per dead reviewer store, appearing one strike per hourly cycle — never three from a single sweep; scripts/prod-lifecycle-state.sh shows them inactive with zero sessions; credit-guard-demo-2 reactivates when the developer opens the app"
    why_human: "Needs real token-endpoint refusals against production shops over multiple sweep cycles"
  - test: "Post-deploy (#32): scripts/prod-enforcement-events.sh for a redacted shop"
    expected: "0 rows (eztcd0-3u currently retains 22)"
    why_human: "Needs a real shop/redact delivery against production Postgres"
---

# Quick task 260910-nhm — hotfix v1.0.1 Verification Report

**Goal:** Ship v1.0.1 on main closing WINDOWS #31 (GDPR/uninstall webhooks 500 on an unrefreshable offline token), #32 (`EnforcementEvent` survives `shop/redact`) and #30 (dead-token shops swept forever), with regression tests, before deployment.
**Verified:** 2026-09-10T10:02:02Z
**Status:** ACHIEVED (pre-deploy). Three post-deploy checks remain owed and are listed under Human Verification; they are outside this task's scope by design.
**Re-verification:** No — initial verification.

Verification method: every claim below was checked against the code at HEAD `c26354d` (range `ba3a180..HEAD`), the installed library sources in `node_modules`, and by running the suites and gates in this session. SUMMARY.md claims were treated as hypotheses, not evidence.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Signed `shop/redact` for a shop whose only offline session is expired + refreshable answers 200, leaves zero rows in all ten shop-keyed tables incl. `EnforcementEvent`, no network call | VERIFIED | `app/services/webhook-validate.server.ts` contains no session access at all; `webhooks.compliance.tsx` imports only `validateWebhookRequest` + lifecycle (no `shopify.server`). `redactShop` transaction now has `db.enforcementEvent.deleteMany` (line 74). Tests `tests/webhooks.compliance.test.ts` "answers 200 and redacts when the stored offline token is expired but refreshable (WINDOWS #31)" and `tests/shop-lifecycle.test.ts` "zeroes every counted table when the stored token is expired but refreshable" both pass (run this session, hermetic: 8 files in 2.83 s). |
| 2 | Signed `app/uninstalled` under the same stale session answers 200, deletes session rows, sets `active=false` + `uninstalledAt`, retains every other row | VERIFIED | `webhooks.app.uninstalled.tsx` lines 7/19/29: `validateWebhookRequest` -> unconditional `session.deleteMany` -> `deactivateShop`. Test "answers 200, deletes an expired refreshable session and deactivates the shop (WINDOWS #31)" passes. Independently reproduced by the verifier's own probe (below): status 200, active=false, sessions=0. |
| 3 | Both routes: forged HMAC -> 401 with zero side effects; non-POST -> 405; valid HMAC + missing header -> 400; body read once; no hand-rolled compare (T-01-10) | VERIFIED | `webhook-validate.server.ts` lines 39-54 mirror `node_modules/@shopify/shopify-app-react-router/.../webhooks/authenticate.mjs` lines 11-35 order-for-order (405 -> `request.text()` once -> `InvalidHmac` 401 -> else 400) and stop before `ensureValidOfflineSession`. `validate.mjs` consumes the passed `rawBody` and never re-reads the request. Comparison is the library's `validateHmacFromRequestFactory` -> `safeCompare` (`lib/utils/hmac-validator.mjs:48,53`). Compliance route: three forged-401 tests + 405 + 400 tests pass. Uninstall route: no forged-HMAC unit test exists in the repo (see Finding 1), so the verifier drove the route directly: 401 with shop still active/session intact (`bodyUsed=true`), 405 on GET, 400 on missing `X-Shopify-Webhook-Id` with no side effect. |
| 4 | Token health at the seam: closed 3-class classifier; strikes time-gated to one per 30-min window with a fixed anchor; deactivate only on strike 3 (deactivateShop + session.deleteMany + counter cleared + one log line + Sentry `windows:30`); any resolved `graphql()` resets; `healthyShops` bounds DELETEs; live merchant safe under a <60-min outage; seam mock and enumerator guards intact | VERIFIED | `token-health.server.ts`: `classifyConstructionFailure` returns non-null only for `Response.status===500` or `HttpResponseError` 400 + `body.error==="invalid_subject_token"` (lines 117-133); `classifyRequestFailure` only for `HttpResponseError` 401 (140-148) — matches `refresh-token.mjs` lines 13-22 exactly. Time gate lines 200-210 (`now - anchor < WINDOW` -> reason-only write, count/anchor untouched). Strike-3 branch lines 214-235: `deactivateShop`, `session.deleteMany`, `syncCursor.deleteMany`, one `console.log`, `Sentry.captureMessage(..., tags:{windows:"30", shop})`. `admin-client.server.ts` line 117 calls `clearTokenFailures` after ANY resolved `graphql()` (before `graphqlJson` inspects `errors[]`). `healthyShops` set lines 111/193/251-256; test "confirms a shop healthy once per process" proves one DELETE per shop per process via `vi.spyOn(prisma.syncCursor,"deleteMany")`. Outage bound: strike 1 at t0, strike 2 earliest t0+30 min, strike 3 earliest t0+60 min -> a contiguous outage under 60 min yields at most 2 strikes. Export surface unchanged (`LedgerAdminClient`, `getAdminContext`); full suite 885/885 with all 17 suites that `vi.mock` the seam green; `tests/scheduler.test.ts` CF-3 source guard green; seam source guard "admin-client.server.ts is the only module that constructs an unauthenticated admin client" green. |
| 5 | Release plumbing: 1.0.1 in package.json + both lockfile root fields; CHANGELOG 1.0.1 entry in house style; WINDOWS #30/#31/#32 fixed with reasons; ledger 8 open / 1 waived / 23 fixed / 32 total; guide count line matches; gates green; both api_version pins byte-identical | VERIFIED | `node -p` on package.json / lockfile root / `packages[""]`: `1.0.1 1.0.1 1.0.1`. CHANGELOG: `## 1.0.1 — 2026-09-10` + `### Fixed` (3 bullets) + `### Changed` (1 bullet) matching the `## 1.0.0 — 2026-08-24` style. `gsd-tools windows status`: open 8, waived 1, fixed 23, total 32; #30/#31/#32 `fixed` with reasons naming commits, test names and owed post-deploy checks. Guide line 336 reads `entries, 8 open (#11, #18, #19, #24, #25, #26, #27, #28), 1 waived (#4).` Gates run this session: `npm test` 885/885 (31 files), `npm run lint` clean, `npm run graphql-codegen` genuinely generated both `app/types` outputs, `npm run typecheck` clean, `npm run build` 44 modules / 230.54 kB. Pins: `shopify.app.toml:81` and `shopify.extension.toml:7` both `api_version = "2026-07"`, `automatically_update_urls_on_dev = false` intact. |

**Score:** 5/5 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/shopify.server.ts` | exports `validateWebhook` from a validation-only `shopifyApi` instance built from the same env as the main config | VERIFIED | Lines 56-79. Same env sources as `shopifyApp()` above it: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `ApiVersion.July26`, `SCOPES`, `SHOPIFY_APP_URL` (host + scheme). Mirrors `deriveApi` (`shopify-app.mjs:117-129`): `isEmbeddedApp:true`, `isCustomStoreApp:false` (= `distribution !== ShopifyAdmin`), `_logDisabledFutureFlags:false`, `logger.level=Warning` (confirmed silent: only the main instance's INFO line printed during the probe). Constructed after `shopifyApp()`, so an empty/invalid app URL still fails with the library's `ShopifyError` first. Instance itself not exported. |
| `app/services/webhook-validate.server.ts` | `validateWebhookRequest`: 405/401/400, body read once | VERIFIED | 62 lines; wired into both routes. |
| `app/services/token-health.server.ts` | classifiers, `recordTokenFailure`, `clearTokenFailures`, constants | VERIFIED | 257 lines; all exports present; wired into the seam. `TOKEN_FAILURE_WINDOW_MS === 30*60*1000`, `TOKEN_FAILURE_THRESHOLD === 3` (asserted by test). |
| `app/services/admin-client.server.ts` | `getAdminContext` wraps construction and `graphql` with the hooks; export surface unchanged | VERIFIED | Bookkeeping in its own try/catch (`noteTokenFailure`), original error always rethrown (test "bookkeeping never masks the original error" passes). |
| `app/services/shop-lifecycle.server.ts` | `redactShop` deletes `enforcementEvent` | VERIFIED | Line 74, placed after `reminderLog` and before the ledger rows. Test side (`countsFor`, `EMPTY_COUNTS`, `wipe`, `seedLedger`) closed too. |
| `tests/helpers/offline-session.ts` | `expiredRefreshableSession(shop)` | VERIFIED | `expires` 1 h in the past + `refreshToken` — the exact condition `ensure-offline-token-is-not-expired.mjs` refreshes on. |
| `tests/admin-token-health.test.ts` | the #30 suite | VERIFIED | 10 tests, all pass; mutation non-vacuity was the executor's claim, but the tests' assertions (anchor byte-identical after burst; spy call counts) are load-bearing on inspection. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app/shopify.server.ts` `validateWebhook` | `webhook-validate.server.ts` | import | WIRED | Line 2 of the validator. |
| `webhook-validate.server.ts` | `webhooks.compliance.tsx`, `webhooks.app.uninstalled.tsx` | import; neither references `authenticate` in code | WIRED | Only comment mentions of `authenticate.webhook` remain; source guard (comment-stripped) passes. |
| `admin-client.server.ts` `getAdminContext` | `token-health.server.ts` -> `deactivateShop` + `db.session.deleteMany` | hooks in construction catch / graphql catch / graphql success | WIRED | `ledger.server.ts:206` (`graphqlJson`) is the only caller of `getAdminContext`; every background Admin call passes through the seam. |
| Test seam | only `shopify.server`'s `unauthenticated.admin` / `authenticate.admin` are mocked; HMAC never mocked | `vi.mock` factories | WIRED | `admin-token-health.test.ts` spreads `...actual`; `shop-lifecycle.test.ts` and `backfill.test.ts` spread `...actual` so the new `validateWebhook` export stays real; the 8 suites that mock `shopify.server` without spreading only import routes that use `authenticate.admin`, and the full run is green. |

### Data-Flow Trace (Level 4)

Not applicable — no rendered values. The one stateful flow (strike record in `SyncCursor` key `token-failures`) was traced: `recordTokenFailure` reads by `shop_key` compound unique, writes JSON `{count,lastAt,lastReason}`; all other `SyncCursor` readers in `app/` (`reconciliation.server.ts:320`, `backfill.server.ts:138/161/199/207/342`) select by their own keys, so the new row cannot be mistaken for a cursor. `redactShop` deletes it with the shop (line 79).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Hotfix suites + guards | `npx vitest run tests/webhooks.compliance.test.ts tests/shop-lifecycle.test.ts tests/admin-token-health.test.ts tests/scheduler.test.ts tests/landing-route.test.ts tests/privacy-route.test.ts tests/support-route.test.ts tests/scope-lockstep.test.ts` | 8 files, 135/135 in 2.83 s | PASS |
| Full suite (once) | `npm test` (creditguard_test) | 31 files, 885/885, 15.45 s, no flakes | PASS |
| Uninstall route contract (verifier probe, scratchpad script via `vite-node`, test DB) | forged HMAC / GET / valid-HMAC-missing-header / signed with stale refreshable session | 401 + no side effect; 405; 400 + no side effect; 200 + sessions 0 + active=false | PASS |
| Duplicate library copies | `find node_modules -path '*@shopify/shopify-api'` + `npm ls @shopify/shopify-api` | exactly one copy, 13.1.0, deduped under react-router and both session-storage packages (so `instanceof HttpResponseError` is safe) | PASS |
| Lockfile hygiene | `git diff ba3a180..HEAD -- package.json package-lock.json` | one direct-dependency line + version bumps only; 0 new `integrity` lines | PASS |
| `npm run lint` / `graphql-codegen` / `typecheck` / `build` | as named | all clean; codegen emitted both `app/types` files; build 44 modules | PASS |
| Do-not-touch list | `git diff --stat ba3a180..HEAD -- shopify.app.toml extensions/ prisma/schema.prisma app/services/ledger.server.ts listing/ marketing/` | empty (`marketing/` is git-ignored) | PASS |
| Working tree after gates | `git status --short` | clean | PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes exist in this repo; `scripts/smoke-deployed.sh` targets the deployed host and is a post-deploy check (it asserts 401 on forged POSTs to `/webhooks/compliance` and `/webhooks/app/uninstalled`, which this change preserves).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FOUND-02 | 260910-nhm | Mandatory GDPR webhooks | SATISFIED | `shop/redact` can no longer be blocked by token state; `EnforcementEvent` now redacted. |
| FOUND-03 | 260910-nhm | Two-stage uninstall (D-06) | SATISFIED | `app/uninstalled` session-free; retain semantics preserved and tested. |
| LEDG-05 | 260910-nhm | Sweeps only touch active shops | SATISFIED | Dead-token shops are now deactivated after three cycles; `forEachActiveShop` remains the sole enumerator (CF-3 guard green). |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/TODO/HACK/placeholder markers in any file touched by this task | — | — |

### Findings (non-blocking)

1. **Coverage note (Warning): no forged-HMAC unit test for `/webhooks/app/uninstalled`.** The compliance route has three; the uninstall route inherits the identical `validateWebhookRequest` path and the verifier's probe proved 401/405/400 with no side effect, and `scripts/smoke-deployed.sh` asserts the forged-401 live. Still, the route's 401 contract is not pinned by the repo's own suite. Suggested follow-up (not required for this release): add a forged-HMAC 401 test in the `app/uninstalled webhook route` describe of `tests/shop-lifecycle.test.ts`.
2. **Design observation (Info): strikes never expire on their own.** Only a resolved `graphql()` clears the counter. A live merchant's daily reconciliation always issues at least one Admin call, so a stale partial count survives at most about a day; the hourly publish backstop may issue none (hash-skip). This is consistent with the plan's stated rule ("no successful call in between") and does not weaken the sub-60-minute guarantee.
3. **Scope observation (Info): the five ledger-ingest routes still use `authenticate.webhook`.** For a dead store they can 500 on refresh until #30's third strike deletes the sessions (after which the existing `SessionNotFoundError` catch answers 200). Correct per the plan — those routes need a session — and #30 is the intended mitigation.
4. **SUMMARY accuracy:** every gate figure and file count in the SUMMARY was reproduced (885/31, 230.54 kB, 44 modules, 20 files in range, 6 commits resolving). The documented deviations (lockfile grep, file-count wording, module-map line counts, STATE.md fold-in) are all accurate; the guide's new line counts (257/122/112/62/66) match `wc -l`.

### Human Verification Required

Post-deploy only — see frontmatter `human_verification`. Nothing pre-deploy is outstanding.

### Gaps Summary

None. All five must-have truths are verified against the code, the installed library, and by execution. The phase goal — v1.0.1 on main closing #30/#31/#32 with regression tests, gates green, nothing else touched, not deployed — is achieved.

---

_Verified: 2026-09-10T10:02:02Z_
_Verifier: Claude (gsd-verifier)_
