---
phase: 03-credit-controls-metafield-publishing
plan: 05
subsystem: infra
tags: [railway, prisma, shopify-admin-api, metafields, verification-tooling, deployment]

# Dependency graph
requires:
  - phase: 03-01
    provides: "serializeCreditState / publishCompanyCreditState — the contract whose live bytes this plan reads back, and the add_company_credit_controls migration this release applies"
  - phase: 03-02
    provides: "registry version credit-guard-net-terms-5 (write_companies + the $app credit_v1 definition), already released and consented"
  - phase: 03-03
    provides: "the Companies page settings path whose column writes this plan drives from below the UI"
  - phase: 03-04
    provides: "publishBackstop inside the hourly OVERDUE_SWEEP lease — the fleet-publish this plan proves live"
  - phase: 02-05
    provides: "the railway-ssh base64-ship script pattern, smoke-deployed.sh, and the signed-webhook sender"
provides:
  - "scripts/prod-credit-metafields.{sh,mjs} — live $app/credit_v1 read-back per Company with a field-by-field match report against the DB row it projects"
  - "prod-ledger-state additive credit keys: creditLimit / bypassEnforcement / publishedAt / dirty per company, plus top-level dirtyPublishes and dataComplete"
  - "Production release of the Phase 3 code with add_company_credit_controls applied to production Postgres"
  - "MEASURED live proof of the credit_v1 contract on four real Company records — the ROADMAP gate Phase 4 reads"
  - "Fix: credit_v1 publishes no longer rename companies to their gids (a live data-corruption defect the proof itself surfaced)"
affects: [04-checkout-validation-function, 05-reminders, ship]

actuals:
  tokens: 7995
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Verification tooling authenticates through the app's OWN seam (unauthenticated.admin) rather than reading Session.accessToken — correct under rotating offline tokens and stronger on token hygiene"
    - "Library loggers are routed to stderr in JSON-only scripts so a startup banner cannot break a jq contract"
    - "Live proof of a merchant action driven below the UI: the same column write + the app's real signed doorbell, so the production publish path is exercised end to end without a browser"

key-files:
  created:
    - scripts/prod-credit-metafields.mjs
    - scripts/prod-credit-metafields.sh
  modified:
    - scripts/prod-ledger-state.mjs
    - app/services/ledger.server.ts
    - app/routes/webhooks.companies.tsx
    - tests/webhooks.b2b-events.test.ts
    - README.md
    - .planning/WINDOWS.md

key-decisions:
  - "The read-back goes through unauthenticated.admin(shop), not a hand-built X-Shopify-Access-Token header: the app runs with future.expiringOfflineAccessTokens, so the stored token expires hourly and a raw read 401s (measured)"
  - "The merchant's browser save was substituted by its two real halves — the identical shop-scoped Company column write, then a genuine signed orders/updated doorbell that made the DEPLOYED app run recomputeCompany -> publishCompanyCreditState. Nothing about the publisher or the payload was simulated; only the form POST was"
  - "The gid fallback for Company.name is CREATE-only. A nameless companies/update must never rename an existing company — publishing credit_v1 makes Shopify send exactly that delivery"
  - "Money is emitted at full Decimal(19,4) precision AND compared through the contract's own toFixed(2) inside the script, so a mismatch is reported rather than rounded away"
  - "Nothing was weakened to make a check pass: the one contract-vs-reality disagreement found (the name clobber) was fixed in code, redeployed, and re-proven live"

patterns-established:
  - "Read-back verification: for any state this app publishes outward, the gate is reading it back from the platform and diffing it against the row it projects — not asserting the writer ran"
  - "Live proof surfaces integration defects fixtures cannot: the platform's own reaction to our write (a companies/update echo) is invisible to every unit test"

requirements-completed: [CRED-01, CRED-02, CRED-03, CRED-04]

coverage:
  - id: D1
    description: "prod-credit-metafields.{sh,mjs} — in-container per-company DB row plus live $app/credit_v1 GraphQL read-back, JSON-only stdout, access token never read into the script"
    requirement: "CRED-03"
    verification:
      - kind: automated
        ref: "node --check scripts/prod-credit-metafields.mjs && comment-filtered grep for accessToken/suppression fallbacks"
        status: pass
      - kind: e2e
        ref: "bash scripts/prod-credit-metafields.sh credit-guard-demo.myshopify.com (four live companies resolved)"
        status: pass
    human_judgment: false
  - id: D2
    description: "prod-ledger-state additive credit keys: creditLimit/bypassEnforcement/publishedAt/dirty per company, top-level dirtyPublishes and dataComplete; the .sh wrapper and existing keys byte-unchanged"
    requirement: "CRED-03"
    verification:
      - kind: e2e
        ref: "bash scripts/prod-ledger-state.sh | node (typeof dirtyPublishes === number && typeof dataComplete === boolean)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Production release: add_company_credit_controls applied to production Postgres via the container release phase, deployed app healthy, all six unauthenticated surfaces still 401 forged HMACs"
    requirement: "CRED-03"
    verification:
      - kind: e2e
        ref: "railway logs: 'Applying migration `20260819160906_add_company_credit_controls`' + 'All migrations have been successfully applied.'"
        status: pass
      - kind: e2e
        ref: "bash scripts/smoke-deployed.sh app.creditguardhq.com (healthz 200 over valid TLS, six forged-HMAC 401s)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A real Company record carries a parseable credit_v1 whose limit is the exact decimal string set — live, byte-shape identical to the contract snapshot"
    requirement: "CRED-01"
    verification:
      - kind: e2e
        ref: "Northwind Trading live payload {\"v\":1,\"limit\":\"2500.00\",\"exposure\":\"1874.95\",\"currency\":\"USD\",\"overdue\":false,\"bypass\":false,\"data_complete\":true,\"computed_at\":\"2026-08-19T17:53:14.418Z\"} — key order and types identical to tests/metafield-contract.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Publish-on-change within seconds: a settings change reached the live metafield in 647 ms (doorbell 17:53:13.967Z -> publishedAt 17:53:14.614Z, metafield updatedAt 17:53:14Z)"
    requirement: "CRED-03"
    verification:
      - kind: e2e
        ref: "cg-merchant-sim ring (signed orders/updated, HTTP 200) + prod-credit-metafields read-back 22s later"
        status: pass
    human_judgment: false
  - id: D6
    description: "A company whose limit was never set publishes limit null on the live store — JSON null, not \"0.00\", not absent"
    requirement: "CRED-04"
    verification:
      - kind: e2e
        ref: "Powderbound and Snowdevil live payloads: {\"v\":1,\"limit\":null,\"exposure\":\"0.00\",...}"
        status: pass
    human_judgment: false
  - id: D7
    description: "The bypassed company's live payload carries bypass true while exposure and overdue stay populated — visibility without enforcement"
    requirement: "CRED-02"
    verification:
      - kind: e2e
        ref: "Acme Supply live payload: bypass true, exposure \"3229.95\", overdue true, limit null"
        status: pass
    human_judgment: false
  - id: D8
    description: "After the top-of-hour sweep every company of the shop has a parseable credit_v1 and dirtyPublishes is 0; the already-fresh company was hash-skipped rather than rewritten"
    requirement: "CRED-03"
    verification:
      - kind: e2e
        ref: "18:01:51Z read-back: 4/4 found, dirtyPublishes 0 in both scripts; Northwind metafield updatedAt still 17:53:14Z through the 18:00 sweep"
        status: pass
    human_judgment: false
  - id: D9
    description: "credit_v1 publishes no longer rename companies to their gids (live data-corruption defect found and fixed during the proof)"
    verification:
      - kind: integration
        ref: "tests/webhooks.b2b-events.test.ts#keeps the stored name when an update carries none (03-05 live defect)"
        status: pass
      - kind: integration
        ref: "tests/webhooks.b2b-events.test.ts#still names a NEWLY created company after its gid when the payload has none"
        status: pass
      - kind: e2e
        ref: "post-fix live: three publishes at 18:00 produced three companies/update echoes; all four names intact at 18:01:51Z"
        status: pass
    human_judgment: false
  - id: D10
    description: "Companies page end-of-phase UAT in the dev-store admin: real companies render with correct badges, the limit and bypass round-trip visibly through the real form action, and the four 03-03 UI backstop checks"
    verification: []
    human_judgment: true
    rationale: "The embedded admin iframe cannot be driven from this harness. 03-05 proved the publisher and the payload by driving the state change BELOW the UI (the same shop-scoped column write plus a real signed doorbell), so the route/action layer — value-echo CAS, the 404/409 split, badge rendering, integer-cents boundary — remains unexercised live. Tracked as WINDOWS #9."
  - id: D11
    description: "The re-consent screen listed companies write access"
    verification: []
    human_judgment: true
    rationale: "A one-time browser screen already dismissed in 03-02; its wording cannot be re-read after acceptance. The granted result IS verified — the offline session authenticates company reads and metafield writes against the live store — but what the merchant saw is a human recollection."

# Metrics
duration: 40min
completed: 2026-08-19
status: complete
---

# Phase 3 Plan 5: Production Release and Live Contract Proof Summary

**The `credit_v1` contract is now proven on four real Company records of a live Shopify store — exact limit string, `null` for never-configured, bypass visible without hiding exposure, money as decimal strings, whole fleet published with a zero dirty count — and the proof itself caught a defect that was silently renaming the merchant's companies to their GIDs on every publish.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-08-19T17:27Z
- **Completed:** 2026-08-19T18:05Z
- **Tasks:** 3 of 3
- **Files modified:** 8 (2 created)

## Accomplishments

- **The ROADMAP gate is met.** Phase 4's Function can be built against a payload shape that has been read back off `credit-guard-demo.myshopify.com` and diffed field-by-field against the database rows it projects — not against a fixture.
- **Production carries the Phase 3 schema.** `20260819160906_add_company_credit_controls` applied in the container release phase; healthz 200 over a valid TLS chain; all six unauthenticated webhook surfaces still answer 401 to a forged HMAC.
- **The latency promise is a measurement, not a claim:** 647 ms from doorbell to a committed `metafieldsSet`.
- **A live data-corruption defect was found and fixed.** Writing a company's `credit_v1` makes Shopify send a real `companies/update` back ~1.5 s later with no `name` in the payload; the handler's gid fallback then overwrote the stored name. Every credit publish was renaming the merchant's own company to `gid://shopify/Company/…` in the dashboard.

## Task Commits

1. **Task 1: Verification tooling — metafield read-back + dirty count** — `9b01de5` (chore)
2. **Task 2: Production release — code + migration** — `931ca56` (docs; the release itself is a deploy, not a commit)
3. **Task 1 correction found by the live run** — `35a58e0` (fix)
4. **Live defect found by the proof** — `a4a1f2c` (fix)
5. **Task 3: Live contract proof recorded** — `0dcdad6` (docs)

## Files Created/Modified

- `scripts/prod-credit-metafields.mjs` — reads each Company's live `$app`/`credit_v1` through `unauthenticated.admin(shop)` and prints it next to the DB row plus a per-field `match` block
- `scripts/prod-credit-metafields.sh` — railway-ssh base64-ship wrapper, cloned from `prod-ledger-state.sh`
- `scripts/prod-ledger-state.mjs` — additive credit keys; existing output keys and the `.sh` wrapper byte-unchanged
- `app/services/ledger.server.ts` — `upsertCompanyRow`/`upsertCompany` take `string | null`; the gid fallback is create-only
- `app/routes/webhooks.companies.tsx` — `companyNameFrom` returns `null` rather than the gid
- `tests/webhooks.b2b-events.test.ts` — two regression tests for the rename defect
- `README.md` — runbook entry for the new script, the live evidence block, token-rotation and scope-collapse notes
- `.planning/WINDOWS.md` — #9: Companies page browser UAT still unrun

## The Live Evidence (Phase 4 reads this)

Shop `credit-guard-demo.myshopify.com`, read back 2026-08-19T18:01:51Z. `dataComplete: true`, `dirtyPublishes: 0`, all four companies `found: true`, `type: "json"`.

| Company | live `credit_v1` bytes | `match` |
|---|---|---|
| Northwind Trading | `{"v":1,"limit":"2500.00","exposure":"1874.95","currency":"USD","overdue":false,"bypass":false,"data_complete":true,"computed_at":"2026-08-19T17:53:14.418Z"}` | all true |
| Acme Supply | `{"v":1,"limit":null,"exposure":"3229.95","currency":"USD","overdue":true,"bypass":true,"data_complete":true,"computed_at":"2026-08-19T18:00:00.223Z"}` | all true |
| Powderbound | `{"v":1,"limit":null,"exposure":"0.00","currency":"USD","overdue":false,"bypass":false,"data_complete":true,"computed_at":"2026-08-19T13:32:38.530Z"}` | all true |
| Snowdevil | `{"v":1,"limit":null,"exposure":"0.00","currency":"USD","overdue":false,"bypass":false,"data_complete":true,"computed_at":"2026-08-19T13:32:38.518Z"}` | all true |

Key order is `v, limit, exposure, currency, overdue, bypass, data_complete, computed_at` on the wire — identical to `tests/metafield-contract.test.ts`. Money is decimal strings in every payload; `limit: null` is JSON null on the two companies nobody configured and a string on the one that was configured. **These are the fixture bytes Phase 4 should generate from.**

Three details worth carrying forward:

1. **`computed_at` is the state instant, not the publish instant.** Powderbound's metafield was WRITTEN at 18:00:00Z but carries `computed_at: 13:32:38Z` — the `recomputedAt` of the state being published. A reader can therefore distinguish stale state from a stale write. This is the documented rule (metafields.server.ts), now visible in live bytes.
2. **The hash-skip is real.** Northwind was published at 17:53:14Z and the 18:00 sweep enumerated it again — its metafield `updatedAt` is still `17:53:14Z`. Zero redundant `metafieldsSet` calls (T-03-11).
3. **`exposure` in every payload equals the production DB row to the cent** (`match.exposure` true on all four), and `data_complete` equals the shop-scoped L-01 predicate computed independently by the script.

### Evidence chain (runs, in order)

| # | when | what it shows |
|---|---|---|
| 0 | 17:37:24Z | baseline: 4/4 `found: false`, `dirtyPublishes: 4` — nothing published yet, so everything after is causally attributable |
| 1 | 17:43:32Z | limit set to `1500.00` → published 189 ms later; payload `limit: "1500.00"`, all match flags true |
| 2 | 17:48:15Z | bypass set on Acme → payload `bypass: true` with `exposure: "3229.95"`, `overdue: true` intact |
| 3 | 17:53:14Z | limit changed `1500.00` → `2500.00`; **647 ms** doorbell-to-publish; metafield `updatedAt` 17:53:14Z |
| 4 | 18:01:51Z | after the 18:00 sweep: 4/4 found, `dirtyPublishes: 0`, untouched companies `limit: null`, Northwind hash-skipped |

## Decisions Made

- **How the merchant's save was substituted.** The plan's `user_setup` (click the Companies page) is browser-only and outside an executor's reach. Rather than skip the SC3 proof, the save was decomposed into its two real halves: (a) the identical shop-scoped `Company.creditLimit` / `bypassEnforcement` write the `set-limit` / `set-bypass` action performs, applied in-container via Prisma; (b) a genuine HMAC-signed `orders/updated` delivery to the deployed app, which ran `ingestOrderEvent → refetchOrderAndRecompute → recomputeCompany → publishCompanyCreditState` — the same `recomputeCompany` call `republish()` makes from the action. **The publisher, the serialization, the Admin API write and the metafield are all the real production ones; only the form POST and the CAS/validation layer above it were bypassed.** That layer is the one thing still unproven live (D10, WINDOWS #9).
- **Verification authenticates through the app's own seam.** See deviation 1 — this is a correctness requirement under rotating tokens, not a style choice.
- **Both scales of money are emitted.** The DB values print at full `Decimal(19,4)`; the comparison against the payload runs through the contract's own `toFixed(2)` inside the script. Nothing is rounded on the way to a verdict.
- **The one contract-vs-reality disagreement was fixed, not narrated.** The rename defect was in shipped app code and was triggered by the very feature under proof; leaving it documented-but-live would have handed Phase 4 a store whose company names were GIDs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The read-back script's own authentication was wrong**
- **Found during:** Task 3 (first live run)
- **Issue:** Task 1 built the reader per the plan's wording — read `Session.accessToken`, set `X-Shopify-Access-Token`. Every company came back **HTTP 401**. The app sets `future.expiringOfflineAccessTokens`, so the offline token expires (~hourly) and is rotated via the stored refresh token; the run happened 2 m 20 s after the stored token's `expires` (17:35:04Z vs a 17:37:24Z read).
- **Fix:** the read-back now goes through `shopify.unauthenticated.admin(shop)` — the same seam `admin-client.server.ts` gives the ledger — so it is authenticated exactly like every production call. Side benefit: the token is no longer read into the script at all, which is *stronger* on T-03-12 than the plan's design.
- **Files modified:** `scripts/prod-credit-metafields.mjs`
- **Commit:** `35a58e0`

**2. [Rule 1 - Bug] The library's startup banner broke the JSON-only contract**
- **Found during:** Task 3
- **Issue:** `shopifyApp()` logs `[shopify-api/INFO] version 13.1.0…` to **stdout**, making the document unparseable by `jq` and by the plan's own verify gate.
- **Fix:** a custom `logger.log` routes error/warning severities to stderr and drops the rest.
- **Files modified:** `scripts/prod-credit-metafields.mjs`
- **Commit:** `35a58e0`

**3. [Rule 1 - Bug] Publishing `credit_v1` was renaming companies to their GIDs**
- **Found during:** Task 3 (this is what the live proof was for)
- **Issue:** Writing a Company metafield makes Shopify emit a real `companies/update` webhook back ~1.5 s later, and that payload carries **no `name`**. `companyNameFrom()` fell back to the gid, and `upsertCompanyRow`'s `update: { name }` overwrote the stored value. Measured twice: `Company/7766245609` renamed at 17:43:34.155Z (1.63 s after its publish at 17:43:32.525Z) and `Company/7766278377` at ~17:48:3xZ. Both companies' DB names became `gid://shopify/Company/…` while the live store still held "Northwind Trading" / "Acme Supply". Every company a merchant configures would show as a GID in the app's own dashboard.
- **Fix:** `companyNameFrom` returns `string | null`; `upsertCompanyRow`/`upsertCompany` take `string | null` and treat the gid as a **CREATE-only** fallback — a nameless delivery leaves an existing name alone. `upsertOrderFromSource` passes `attribution.companyName` through as null instead of substituting the gid.
- **Blast radius on the contract:** none. No name has ever entered `credit_v1` (T-03-07), so the Phase 4 payload is unaffected; the damage was confined to the merchant-facing display name.
- **Files modified:** `app/services/ledger.server.ts`, `app/routes/webhooks.companies.tsx`, `tests/webhooks.b2b-events.test.ts` (2 regression tests)
- **Commit:** `a4a1f2c` — redeployed, then the two clobbered names were restored through the real `companies/update` path (signed delivery carrying the true name, HTTP 200 each) and the fix was re-proven live: three publishes at 18:00 produced three `companies/update` echoes and all four names survived.

### Plan-text corrections (no code impact)

- Task 2's verify snippet ends `git status --porcelain shopify.app.toml | wc -l | grep -qx '0'`. BSD `wc` pads with leading spaces, so that gate fails on macOS regardless of the TOML's state. Asserted equivalently (`| tr -d ' '`): porcelain output empty, `api_version = "2026-07"` present exactly once, `shopify.app.toml` untouched by this plan.
- Task 1's spec called for `{ shop, dataComplete, dirtyPublishes, companies: […] }`. The emitted document is a superset — it adds `queriedAt`, `apiVersion`, `sessionScopes`, `sessionTokenExpires`, `companyCount`, a per-company `db.dirty`, `metafield.liveName`, and a per-company `match` block. Additive only; every key the plan named is present with the named meaning.

## Findings (not defects)

- **`read_companies` vanishes from `.sessionScopes` after a token refresh, and that is correct.** The stored scope string went from the five requested scopes to `read_all_orders,read_orders,read_payment_terms,write_companies`. Shopify returns its canonical granted set with implied read scopes collapsed — `write_companies` implies `read_companies`. Company reads demonstrably still work (the read-back resolves live company names on that exact string). A literal five-scope assertion against `.sessionScopes` would be the thing that is wrong; recorded in the README so it is not "repaired" later.
- **Rotating offline tokens are now live for this app.** `Session.expires` moves ~hourly and `refreshToken` is populated (`refreshTokenExpires` 2026-11-17). Any future tool that reads the raw token will 401 intermittently — always go through `unauthenticated.admin(shop)`.

## Phase 4 Readiness

**The gate is met. Phase 4 may start.**

The ROADMAP condition — *"the metafield contract must be verifiable on real Company records before Phase 4 starts"* — is satisfied by measurement, not by inference:

- ✅ **The contract is live.** Four real Company records on `credit-guard-demo.myshopify.com` carry `$app`/`credit_v1` of type `json`, parseable, with the canonical key order and byte shape of `tests/metafield-contract.test.ts`.
- ✅ **Money is decimal strings on the wire** (`"2500.00"`, `"3229.95"`, `"1874.95"`, `"0.00"`) — never JSON numbers. The `$0.01`-phantom-block failure mode the contract exists to prevent cannot occur through this channel.
- ✅ **`limit: null` and `"0.00"` are byte-distinct live** (D-02): two companies publish JSON `null` because nobody configured them; the configured one publishes a string.
- ✅ **`bypass: true` coexists with populated `exposure`/`overdue`** (D-03) — the Function can see the numbers and still be told to stand down.
- ✅ **`data_complete` is honest** — `true`, matching a shop-scoped L-01 predicate the verification script computes independently (`attribution.unresolved` is 0 on this shop).
- ✅ **Freshness is bounded on both ends:** a settings change lands in 647 ms, and the hourly backstop drives `dirtyPublishes` to 0 across the fleet with hash-gated writes.
- ✅ **The publish path does not corrupt anything else** — after the rename fix, a three-company publish burst left all names intact.

What Phase 4 must still assume rather than know:

- The **Companies page UI** has not been exercised in a browser (D10, WINDOWS #9). This does not touch the payload — the settings path's DB write and republish are proven — but the CAS/validation layer above it is unverified live.
- `computed_at` can legitimately be **hours older** than the metafield's `updatedAt` (Powderbound: state 13:32Z, write 18:00Z). A Function that treats `computed_at` as a write timestamp will misjudge staleness.
- Only **one** company currently carries a non-null limit, and it sits **within** it (`exposure 1874.95 < limit 2500.00`). **No live over-limit state exists yet** — the block case Phase 4 is built to produce has no live fixture. Create one by setting Northwind's limit below `1874.95`; the overdue-and-bypassed case is already live on Acme (`3229.95`, `overdue: true`, `bypass: true`).

## Outstanding Human Checks

Both are browser-only and were not attempted (`status: unknown`).

1. **Companies page UAT** — `credit-guard-demo.myshopify.com` admin → Apps → Credit Guard → Companies. Verify: all four companies render with their names (**not** GIDs — this is the live regression check for `a4a1f2c`); Northwind shows a `2500.00` limit and Acme shows Bypass ON; badges reflect over-limit/overdue correctly; editing a limit and saving round-trips visibly; a stale save (edit the same row in two tabs) surfaces the 409 path; the four 03-03 UI backstop checks.
2. **Re-consent screen wording** — already accepted in 03-02; the screen listed companies write access. Unverifiable after the fact, and the granted capability *is* verified (metafield writes succeed against the live store).

## Self-Check

- `scripts/prod-credit-metafields.mjs` — FOUND
- `scripts/prod-credit-metafields.sh` — FOUND
- `.planning/phases/03-credit-controls-metafield-publishing/03-05-SUMMARY.md` — FOUND
- Commits `9b01de5`, `931ca56`, `35a58e0`, `a4a1f2c`, `0dcdad6` — FOUND
- Suite 337 passed (17 files); `typecheck`, `lint`, `build` clean; `shopify.app.toml` untouched
- STATE.md and ROADMAP.md deliberately untouched (orchestrator owns them); nothing pushed

## Self-Check: PASSED
