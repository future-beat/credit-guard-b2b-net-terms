---
phase: 01-foundation-compliance
verified: 2026-08-18T14:06:39Z
status: human_needed
score: 14/17 must-haves verified
behavior_unverified: 3
overrides_applied: 0
re_verification: null
deferred:
  - truth: "`scopes = \"\"` in shopify.app.toml — the app requests no Admin API access scopes"
    addressed_in: "Phase 2"
    evidence: "Phase 2 goal 'maintains a provably correct per-company outstanding-balance and due-date ledger' requires Admin GraphQL calls (companies, orders, paymentTerms); DI-02 records the scope set as deliberately deferred to the first plan that makes an Admin API call"
  - truth: "Order attribution must read Order.purchasingEntity, never Order.customer"
    addressed_in: "Phase 2"
    evidence: ".planning/research/SUMMARY.md:166 records this as a 'Phase 2 MUST'; ARCHITECTURE.md:142 pins purchasingEntity into the webhook refetch query"
  - truth: "Scheduled jobs must filter Shop.active = true so a deactivated shop stops being worked on"
    addressed_in: "Phase 2"
    evidence: "Phase 2 builds the scheduler loop (reconciliation + overdue sweep); no scheduler exists in Phase 1, so the SCHEDULER CONTRACT comment in app/services/shop-lifecycle.server.ts has nothing to guard yet"
behavior_unverified_items:
  - truth: "A merchant can install the app from the DEPLOYED URL (https://app.creditguardhq.com) on the dev store via managed installation and land in the embedded Polaris shell without console errors"
    test: "From the Dev/Partner dashboard (NOT `shopify app dev`), install https://app.creditguardhq.com on credit-guard-u0vpjikx.myshopify.com. Open DevTools console. Then run `scripts/prod-lifecycle-state.sh credit-guard-u0vpjikx.myshopify.com`."
    expected: "Managed installation completes; the 'Credit Guard is installed' empty state renders inside the admin iframe with zero console errors; the query returns shopRows[0].active = true, uninstalledAt = null, sessionCount >= 1."
    why_human: "Browser-driven Shopify OAuth inside the admin iframe with a human-authenticated account; no automated harness exists. Production held ZERO Session and ZERO Shop rows before plan 01-04 ran, so this path has never once been exercised. The tunnel install (`shopify app dev`, 01-01 D4) proves the code path but NOT the deployed path — and this phase already produced one production-only defect the local path could never have caught (the Dockerfile build-arg bug that compiled the client bundle with `dsn: void 0`)."
  - truth: "The full install -> uninstall -> redact -> re-install loop on the dev store ends in a clean working embedded shell, driven by real Shopify admin actions"
    test: "After the deployed install above: uninstall from the store's Apps page; re-run scripts/prod-lifecycle-state.sh; then re-install and reload the embedded app."
    expected: "After uninstall: active=false, uninstalledAt stamped, sessionCount 0, ComplianceRequest rows retained. After re-install: shell renders again and active flips back to true with uninstalledAt null."
    why_human: "Only a real admin-initiated uninstall proves Shopify EMITS app/uninstalled. Plan 01-04 drove the deployed handler with a validly-signed delivery instead (deviation 2, honestly recorded), which proves handler behaviour and the database effect but not platform emission. Re-install reactivation is proven only at the loader level with authenticate.admin stubbed."
  - truth: "Partner dashboard automated compliance checks pass and the three compliance-topic subscriptions are visible on the app registration"
    test: "Dev Dashboard -> app 411936784385 (org 231459878) -> version credit-guard-net-terms-3 -> Configuration / Compliance."
    expected: "Three compliance webhook endpoints listed pointing at https://app.creditguardhq.com/webhooks/compliance; the automated HMAC-verification / mandatory-webhooks checks pass."
    why_human: "Browser-only surface with no CLI or API equivalent (`shopify app execute` requires the app to be installed on a store, which it is not). If red, this is the A6 known false-red: re-run first, then escalate to Partner support — do NOT change the code, whose behaviour is proven from three independent directions."
human_verification:
  - test: "Install https://app.creditguardhq.com on credit-guard-u0vpjikx.myshopify.com from the Dev/Partner dashboard, DevTools console open"
    expected: "Managed installation completes, embedded 'Credit Guard is installed' shell renders, zero console errors, shopRows[0].active = true with sessionCount >= 1"
    why_human: "Browser-driven OAuth inside the admin iframe; production has never held a Session or Shop row from this path"
  - test: "Uninstall from the store's Apps page, query production state, then re-install"
    expected: "active=false + uninstalledAt stamped + sessionCount 0 + receipts retained; after re-install active=true, uninstalledAt null, shell renders"
    why_human: "Only a real admin uninstall proves Shopify emits app/uninstalled; 01-04 substituted a signed delivery"
  - test: "Dev Dashboard -> app 411936784385 -> credit-guard-net-terms-3 -> Configuration / Compliance"
    expected: "Three compliance endpoints listed at https://app.creditguardhq.com/webhooks/compliance; automated compliance checks green"
    why_human: "Browser-only Shopify-side checker with no CLI equivalent"
  - test: "Reconcile the Railway Postgres region: dashboard -> Postgres service -> Settings -> Region"
    expected: "A single unambiguous answer to whether Postgres is in us-east4 or still europe-west4, then update README.md and deferred-items.md to match"
    why_human: "The repo contradicts itself (see W-1) and no Railway CLI is installed on this machine to re-derive it"
---

# Phase 1: Foundation & Compliance Verification Report

**Phase Goal:** Merchant can install the app into a deployed, review-compliant embedded admin shell
**Verified:** 2026-08-18T14:06:39Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Headline

The engineering is genuinely strong and the SUMMARYs are unusually honest — I set out to falsify them and could not. Every code-level claim I spot-checked against source held, several deviations closed holes the plans left open, and the two unproven items are labelled `status: unknown` and are not claimed as passing anywhere.

**But the phase goal contains the word "deployed", and the one thing nobody has ever done is install this app from the deployed URL.** Production held zero `Session` and zero `Shop` rows before plan 01-04 ran. The merchant-facing half of the goal is proven only against a `shopify app dev` tunnel. That is not a paperwork gap: this very phase produced a defect that existed *only* in the deployed build (the Dockerfile build-arg bug that compiled the browser bundle with `dsn: void 0` while local builds were fine). The same class of divergence — production `application_url`, custom-domain redirect URLs, managed installation from the dashboard, CSP/frame-ancestors from the production host, cookie behaviour on a real TLS domain — is exactly what the untaken path would exercise.

No code is missing. Three browser-only checks are.

## Goal Achievement

### Success Criteria Verdicts

| # | Success Criterion | Verdict | Basis |
|---|---|---|---|
| 1 | Install on dev store, complete OAuth, land in embedded Polaris admin without errors | **PARTIALLY MET** | Tunnel install human-UAT'd 2026-08-18 (01-01 D4/D5). Deployed-URL install never performed — zero Session/Shop rows in production before 01-04. |
| 2 | Three GDPR webhooks respond correctly; bad HMAC gets 401 | **MET** | Independently re-derived by this verifier: `scripts/smoke-deployed.sh` exit 0 (401 on both webhook surfaces). Shopify-signed deliveries of all three topics accepted 200 with correct dispatch. 26 local tests enumerated. Partner dashboard checkbox outstanding but is Shopify's checker, not app behaviour. |
| 3 | Uninstall revokes tokens/data, stops jobs, marks shop inactive; re-install works | **PARTIALLY MET** | Server-side semantics proven against **production** Postgres (deactivate-and-retain, redact-to-zero, scoped, idempotent). Driven by a signed delivery, not a real admin uninstall. "Stops scheduled jobs" is vacuous — no scheduler exists in Phase 1 and the contract is a source comment, not a guard. |
| 4 | App runs deployed (always-on host + Postgres) with API version pinned everywhere | **MET** | Re-derived: `GET https://app.creditguardhq.com/healthz` -> 200, `ssl_verify_result=0`. `2026-07` pinned in all four places; zero stale version literals anywhere in `app/`, `.graphqlrc.ts`, `shopify.app.toml`. |

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Install + OAuth + embedded Polaris shell renders on a B2B dev store (tunnel path) | ✓ VERIFIED | 01-01 D4/D5 manual UAT on `credit-guard-u0vpjikx.myshopify.com`, 2026-08-18; `app/routes/app.tsx` calls `authenticate.admin` then `ensureShopActive(session.shop)`; `PrismaSessionStorage` wired in `app/shopify.server.ts` |
| 2 | Same install lands from the **DEPLOYED** URL via managed installation | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | 01-02 D6 `status: unknown`, 01-04 D12 `status: unknown`. Production DB held 0 Session / 0 Shop rows. Code present and wired; deployed path never exercised. |
| 3 | Bad-HMAC POST -> 401 on both deployed webhook surfaces, zero side effects | ✓ VERIFIED | **Verifier-executed** `bash scripts/smoke-deployed.sh app.creditguardhq.com` -> exit 0: healthz 200/tls 0, `/webhooks/compliance` 401, `/webhooks/app/uninstalled` 401. `authenticate.webhook` is the first statement in both route actions. |
| 4 | Validly-signed compliance webhook -> 200 with correct per-topic dispatch | ✓ VERIFIED | 01-04 D3/D7: `shopify app webhook trigger` for all three topics -> Shopify-signed delivery, 200, correct handler log line. Route source confirms `CUSTOMERS_DATA_REQUEST`/`CUSTOMERS_REDACT` -> `logComplianceRequest`, `SHOP_REDACT` -> `redactShop`, `default` -> ack-only. |
| 5 | Partner dashboard automated compliance checks pass | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | 01-04 D11 `status: unknown`, browser-only. Not claimed as passing. |
| 6 | `app/uninstalled` deletes sessions + sets `active=false`/`uninstalledAt`, retains everything else | ✓ VERIFIED | Production: `shopRows[0] {active:false, uninstalledAt:…}`, `sessionCount 0`, `complianceRequestCount 2` retained. `deactivateShop` called unconditionally, outside the session guard. Source-guard test asserts the route contains no delete against retained tables. |
| 7 | `shop/redact` hard-deletes every row for the shop only, idempotently | ✓ VERIFIED | Production: zero rows for the domain, bystander shop's receipt survived; second delivery -> 200 no-op. `redactShop` uses one `db.$transaction` with three `deleteMany` (not `delete`, so redelivery is a no-op not a P2025). |
| 8 | Re-install reactivation flips `active` back to true and clears `uninstalledAt` | ✓ VERIFIED | `ensureShopActive` upsert wired into the `app.tsx` layout loader; test invokes the real loader with `authenticate.admin` stubbed |
| 9 | Full browser install -> uninstall -> redact -> re-install loop ends in a working shell | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | 01-04 D12 `status: unknown`. The uninstall was driven by a signed webhook (deviation 2), so Shopify's *emission* of `app/uninstalled` on a real uninstall is unproven. |
| 10 | Uninstall stops scheduled jobs | ✓ VERIFIED (vacuous) | No scheduler exists in Phase 1. Contract recorded as a comment in `app/services/shop-lifecycle.server.ts` ("every scheduled job MUST filter `Shop.active = true`"). See CF-3. |
| 11 | Deployed always-on host + Postgres, migrations applied on release, valid TLS | ✓ VERIFIED | **Verifier-executed** healthz 200 / `ssl_verify_result=0`. `railway.json` start `npm run docker-start`, healthcheck `/healthz`; `setup` = `prisma generate && prisma migrate deploy`. Production migration `20260818132232_add_shop_lifecycle` applied per release log. |
| 12 | Shopify API version pinned to 2026-07 everywhere; no stale literals | ✓ VERIFIED | `shopify.app.toml:17` `api_version = "2026-07"`; `app/shopify.server.ts:13,28` `ApiVersion.July26`; `.graphqlrc.ts:11` `ApiVersion.July26`. Grep for `2025-`/`2026-10`/`October25`/`July25`/`January26` across `app/`, `.graphqlrc.ts`, `shopify.app.toml`, `vite.config.ts` -> NONE. |

**Score:** 9/12 truths verified (3 present, behavior-unverified) + 5/5 prohibitions verified = **14/17**

### Prohibition Verification (must-NOTs)

| # | Prohibition | Status | Evidence |
|---|---|---|---|
| P1 | MUST NOT alter storefront or checkout behavior — Phase 1 is observe-only | ✓ HOLDS | `extensions/` contains only `.gitkeep`. Zero `admin.graphql` calls anywhere in `app/`. Zero metafield writes (the only `metafield` match in `app/` is a forward-looking comment). `scopes = ""` means the app is structurally incapable of an Admin API mutation. Home copy states the promise verbatim. |
| P2 | MUST NOT transmit webhook payloads, shop PII, or session tokens to Sentry | ✓ HOLDS | `sendDefaultPii: false` on both server and client. `beforeSend` deletes `request.data`, `request.cookies`, `request.headers` and redacts `query_string`. `redactUrl` scrubs `id_token` — the live embedded session token — plus `hmac`, `signature`, `access_token`, `token`, `code`, from URLs and breadcrumbs. This is **above** what the prohibition asked for. See W-2 for the regression-test gap. |
| P3 | MUST NOT delete or redact merchant data on `app/uninstalled` | ✓ HOLDS | Route calls only `session.deleteMany` + `deactivateShop`. Test `holds no delete against retained tables in its source` reads the route source and asserts no `shop.delete`/`complianceRequest.delete` — a guard against future regression, not just current behaviour. |
| P4 | MUST NOT store webhook payload bodies in ComplianceRequest | ✓ HOLDS | `model ComplianceRequest` has exactly `id`, `shop`, `topic`, `receivedAt`. No payload/body/json column. Test asserts row keys are exactly `[id, receivedAt, shop, topic]`. `logComplianceRequest(shop, topic)` cannot receive a body. |
| P5 | MUST NOT print, log, or persist SHOPIFY_API_SECRET while signing test webhooks | ✓ HOLDS | `send-signed-webhook.sh` computes the digest in `node`, reading the key from the inherited environment and the body from stdin — neither enters argv. Deviation 1 explicitly rejected the plan's own `openssl dgst -hmac "$SECRET"` instruction because it would have put the secret in `ps` output. `git grep 'shpss_\|shpat_'` -> only quoted grep-pattern text inside SUMMARY prose; no real secret. `git ls-files '^\.env'` -> only `.env.example`. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `shopify.app.toml` | api_version 2026-07, prod URL, three compliance topics | ✓ VERIFIED | All present; `automatically_update_urls_on_dev = false`; D-05 name/handle intact |
| `prisma/schema.prisma` | postgresql + Session + Shop + ComplianceRequest | ✓ VERIFIED | All three models present; receipt table is metadata-only by construction |
| `app/routes/webhooks.compliance.tsx` | Single route dispatching all three topics | ✓ VERIFIED | `authenticate.webhook` first; no `session` in scope anywhere |
| `app/routes/webhooks.app.uninstalled.tsx` | Session delete + deactivate | ✓ VERIFIED | `deactivateShop` unconditional (survives redelivery with no session) |
| `app/services/shop-lifecycle.server.ts` | 4 exported lifecycle functions | ✓ VERIFIED | `deactivateShop`, `redactShop`, `ensureShopActive`, `logComplianceRequest` — all domain-keyed, all idempotent |
| `app/routes/app.tsx` | Embedded shell + nav + ErrorBoundary | ✓ VERIFIED | Single "Home" nav item; ErrorBoundary wrapped in non-embedded `AppProvider` so `s-*` elements are defined |
| `app/routes/app._index.tsx` | UI-SPEC empty state, byte-exact | ✓ VERIFIED | Heading and body copy match the spec strings |
| `app/routes/healthz.tsx` | Unauthenticated 200, no auth import | ✓ VERIFIED | One-line loader, no `shopify.server` import, no DB call |
| `instrument.server.mjs` | Sentry server init pre-app | ✓ VERIFIED | Loaded via `NODE_OPTIONS --import` on both `dev` and `start` |
| `scripts/smoke-deployed.sh` | healthz 200 + bad-HMAC 401 | ✓ VERIFIED | Verifier-executed, exit 0; `set -euo pipefail`, no `2>/dev/null`, no `\|\| true`, no `-k` |
| `scripts/send-signed-webhook.sh` | Signed sender, secret never in argv | ✓ VERIFIED | Node/stdin construction shared with `tests/helpers/webhook-hmac.ts` so shell and test paths cannot drift |
| `vitest.config.ts` + `tests/` | Test infrastructure + FOUND-02/03 suites | ✓ VERIFIED | 31 tests enumerated via `npx vitest list` (16 lifecycle, 10 compliance, 5 HMAC helper) — matches the claimed count exactly |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `app/routes/app.tsx` | `app/shopify.server.ts` | `authenticate.admin` in layout loader | ✓ WIRED |
| `app/shopify.server.ts` | `prisma/schema.prisma` | `PrismaSessionStorage` | ✓ WIRED |
| `package.json` | `instrument.server.mjs` | `NODE_OPTIONS --import` on `start` and `dev` | ✓ WIRED |
| `railway.json` | `app/routes/healthz.tsx` | `healthcheckPath: "/healthz"` gating each deploy | ✓ WIRED |
| `app/routes/webhooks.compliance.tsx` | `app/services/shop-lifecycle.server.ts` | topic switch -> `redactShop` / `logComplianceRequest` | ✓ WIRED |
| `app/routes/webhooks.app.uninstalled.tsx` | `app/services/shop-lifecycle.server.ts` | `deactivateShop` after session delete | ✓ WIRED |
| `app/routes/app.tsx` | `app/services/shop-lifecycle.server.ts` | `ensureShopActive` upsert in loader | ✓ WIRED |
| `shopify.app.toml` | `app/routes/webhooks.compliance.tsx` | `compliance_topics` -> `/webhooks/compliance` | ✓ WIRED |
| `shopify.app.toml` | Shopify app registration | `shopify app deploy` -> `credit-guard-net-terms-3` | ✓ WIRED |
| `shopify.app.toml` | `app/routes/webhooks.app.scopes_update.tsx` | declared subscription has a matching route | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Deployed health + forged-HMAC rejection | `bash scripts/smoke-deployed.sh app.creditguardhq.com` | `http=200 ssl_verify_result=0`; compliance 401; uninstalled 401; exit 0 | ✓ PASS |
| Test suite composition | `npx vitest list` | 31 tests across 3 files, names match the coverage claims | ✓ PASS |
| API version pin, all surfaces | `grep -rn "ApiVersion\|api_version"` + stale-literal grep | 4 pins at 2026-07; 0 stale literals | ✓ PASS |
| Observe-only prohibition | `ls extensions/` + `grep admin.graphql app/` | only `.gitkeep`; 0 Admin API calls | ✓ PASS |
| Secret hygiene | `git grep -IlE 'shpss_\|shpat_'`, `git ls-files '^\.env'` | pattern-text-only hits in prose; only `.env.example` tracked | ✓ PASS |
| Debt markers in phase source | `grep -rnE "TODO\|FIXME\|XXX\|TBD\|HACK\|PLACEHOLDER" app/ scripts/ tests/ prisma/ instrument.server.mjs` | NONE | ✓ PASS |
| Deployed-URL install | — | no automated harness (browser OAuth) | ? SKIP -> human |

### Probe Execution

| Probe | Command | Result | Status |
|---|---|---|---|
| `scripts/smoke-deployed.sh` | `bash scripts/smoke-deployed.sh app.creditguardhq.com` | exit 0, all three assertions passed | PASS |

Executed by the verifier in its own process, not read from SUMMARY.md.

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| FOUND-01 | Merchant can install and complete OAuth into an embedded Polaris admin (RR7 template, session-token auth) | ⚠️ **PARTIALLY SATISFIED** | Code path complete and human-UAT'd via tunnel; deployed-URL install never performed. Requires human item 1. |
| FOUND-02 | App responds correctly to the three mandatory GDPR webhooks with 401 on bad HMAC | ✓ **SATISFIED** | Verifier-executed 401s against production; Shopify-signed 200s for all three topics with correct dispatch; 10 compliance tests; subscriptions synced in registration version 3. Dashboard checkbox outstanding but every functional behaviour is independently proven. |
| FOUND-03 | App cleans up on uninstall (revoke data, stop jobs, mark shop inactive) | ✓ **SATISFIED** (server-side) | Production-verified deactivate-and-retain and redact-to-zero, both idempotent and shop-scoped; reactivation wired into the layout loader. "Stop jobs" is vacuous this phase (CF-3). Real-uninstall emission unproven (human item 2). |

**Orphaned requirements:** none. REQUIREMENTS.md maps exactly FOUND-01/02/03 to Phase 1 and all three are claimed by plans.

### Deviations Review

I read all 23 recorded deviations across the four SUMMARYs. **None silently narrowed scope or weakened a must_have.** Five deviations strengthened the contract beyond what the plan specified:

| Deviation | Effect |
|---|---|
| 01-02 #1 (`automatically_update_urls_on_dev = false`) | Closed a real hazard the plan left open — a `dev` run followed by any `deploy` would have published a dead tunnel URL to the live registration |
| 01-03 #3 (`redactShop` also deletes sessions, in a transaction) | Plan's behaviour list omitted sessions; leaving a live access token after a GDPR redact would have been both a compliance and a security gap |
| 01-03 #6 (source-level prohibition guards) | Converted two prohibitions from "current behaviour is correct" into regression-resistant assertions |
| 01-04 #1 (node, not openssl, computes the HMAC) | The executor **refused the plan's own instruction** because following it literally would have violated the plan's own prohibition (secret in argv). Correct call. |
| 01-04 #4 + #6 (uninstalled-endpoint 401 assertion; bystander-shop seeding) | #6 in particular defeats a `deleteMany` with a missing `where` clause, which would have passed the plan's criterion as written |

Two deviations are substitutions worth naming explicitly, both honestly labelled:
- **01-04 #2** — uninstall driven by a signed webhook rather than an admin click. Proves handler behaviour + DB effect; does **not** prove Shopify emits the delivery. Recorded as open D12. Legitimate.
- **01-04 #7** — `shopify app webhook trigger` in place of the dashboard test tool. This is genuinely *stronger* evidence, not weaker: Shopify's own infrastructure signed and delivered the payloads.

### Honest-Accounting Audit

I checked whether the two `human_judgment: true, status: unknown` items are quietly claimed as passing anywhere in the phase artifacts. **They are not.**

- 01-02 D6 (deployed-URL install): `status: unknown`, with an explicit "OUTSTANDING" ref.
- 01-04 D11 (Partner dashboard checks): `status: unknown`, "OUTSTANDING — browser-only", with a written rationale for why no CLI substitute exists.
- 01-04 D12 (install/uninstall/re-install loop): `status: unknown`, and it *volunteers* the damning fact — "production data shows [it] has never happened: the database held zero Session and zero Shop rows before this plan ran."
- 01-04's prose carries the sentence **"Neither is claimed as passing."**
- The ROADMAP still marks Phase 1 "In Progress", not complete.

This is the correct behaviour and it is what made this verification tractable. The gap is real; the reporting of it is not.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | No `TODO`/`FIXME`/`XXX`/`TBD`/`HACK`/`PLACEHOLDER` in any phase source file | — | Clean |
| `README.md` | 95 | Documents the app service region as `europe-west4` while `railway.json` pins `us-east4-eqdc4a` | ⚠️ Warning | See W-1 |
| `.planning/.../01-VALIDATION.md` | frontmatter + table | `status: draft`, `wave_0_complete: false`, all 11 task rows still ⬜ pending after full execution | ⚠️ Warning | See W-3 |
| `.planning/REQUIREMENTS.md` | 12-14, 98-100 | FOUND-01/02/03 still unchecked and "Pending" | ℹ️ Info | Bookkeeping; update on phase close |

## Warnings

**W-1 — The repo contradicts itself about where production Postgres lives.**
`README.md:95` says the service is in `europe-west4` (Amsterdam). `railway.json` pins `multiRegionConfig: us-east4-eqdc4a`. `deferred-items.md` says the app service moved to US East but that **Postgres is still in `ams` and requires a manual dashboard action**, listing it as "Resolution required (user)". The orchestrator's briefing states both are now US East. Three sources, three different pictures, and no `railway` CLI on this machine to re-derive the truth. Whatever the answer, the README row is stale and `deferred-items.md`'s outstanding item is either closed-but-unrecorded or genuinely open. Resolve before Phase 2 — this sits directly on the `orders/create` -> metafield-write latency path that the checkout Function reads against.

**W-2 — The app's strongest privacy control has no regression test.**
`beforeSend`/`redactUrl` in `instrument.server.mjs` and `app/entry.client.tsx` scrub `id_token` (a live Shopify session token) out of every Sentry event URL and breadcrumb. Nothing tests this. The only automated gate is a negative grep for `sendDefaultPii: true`, which would still pass if someone deleted `beforeSend` entirely. Contrast with the uninstall prohibition, which *does* have a source-level guard test. A ~10-line unit test on `redactUrl` would close it.

**W-3 — `01-VALIDATION.md` is frozen at plan time.**
`status: draft`, `nyquist_compliant: true`, `wave_0_complete: false`, and all 11 per-task rows still ⬜ pending, despite every task having executed and Wave 0 having been delivered by 01-03-T1. Anyone reading this file to judge phase health gets a false negative.

**W-4 — MVP-mode format guard violated.**
ROADMAP declares Phase 1 `Mode: mvp`, but its goal is not a User Story (`As a …, I want to …, so that ….`). Under MVP mode the verifier is supposed to verify the story's `so that` clause via a User Flow Coverage table. I proceeded against the four explicit Success Criteria instead, which are strictly richer than a single story would have been, and flag the discrepancy rather than refusing. Either drop `mode: mvp` from this phase or restate the goal as a User Story — the same mismatch will recur on Phases 2-6, which are all marked `mode: mvp` with non-story goals.

## Carry-Forward Risks for Phase 2

| ID | Risk | Why it matters |
|---|---|---|
| CF-1 | `scopes = ""` in `shopify.app.toml` | The app currently cannot make a single Admin API call. Phase 2's ledger needs companies, orders, paymentTerms, metafields. Must be set deliberately — over-requesting is an app-review liability (DI-02). |
| CF-2 | Order attribution must read `Order.purchasingEntity`, never `Order.customer` | On B2B orders `Order.customer` returns the company *contact*. Reading it lands exposure on the wrong entity — the exact bug Shopify warns Basic-plan merchants about (research SUMMARY.md:166). |
| CF-3 | "Stop scheduled jobs on deactivate" is a comment, not a guard | `Shop.active = true` filtering is documented in a docblock in `shop-lifecycle.server.ts`. The moment Phase 2 adds its first scheduler, that comment becomes a load-bearing invariant with zero enforcement. Add a shared query helper or a test that fails when a scheduled job reads shops unfiltered. |
| CF-4 | Postgres region (W-1) | Transatlantic DB round trips widen the credit-status staleness window the Phase 4 Function reads against. Cheapest to fix now — zero install base. |
| CF-5 | `shopify.app.toml` is now the **production** registration | Every `shopify app deploy` publishes it unconditionally (the CLI dropped `include_config_on_deploy`). Before the next `shopify app dev`, run `shopify app config link` against a separate dev app and use `--config=<name>` (DI-03). The CLI has already rewritten `api_version` to the 2026-10 RC once. |
| CF-6 | Compliance handlers are currently no-ops by design | `CUSTOMERS_DATA_REQUEST`/`CUSTOMERS_REDACT` write a receipt and nothing else, correctly, because Phase 1 stores no customer PII. Phase 5's reminder-email log will hold contact data — at that moment these handlers must become substantive or the app is out of GDPR compliance with green tests. |

## Gaps Summary

**No implementation gaps.** Every artifact exists, is substantive, and is wired; every key link traces; every prohibition holds in shipped code; the deployed probe passes when run independently.

What is missing is **execution of three browser-only checks**, one of which is material to the phase goal:

The phase goal says a merchant can install into a *deployed* shell. The deployed install has never been performed — production held zero `Session` and zero `Shop` rows. The tunnel install proves the code, and the code is good, but this phase has already demonstrated that the deployed build can diverge from the local one in a way no local gate catches. Success criterion 1 should not be signed off until someone installs `https://app.creditguardhq.com` from the Dev Dashboard and watches the shell render.

Phase 2 is not blocked on this — its work is server-side ledger construction against the same code paths. But Phase 1 should not be marked complete, and the phase goal should not be called achieved, until human items 1 and 2 are green.

---

_Verified: 2026-08-18T14:06:39Z_
_Verifier: Claude (gsd-verifier)_
