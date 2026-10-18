---
phase: 03-credit-controls-metafield-publishing
verified: 2026-08-20T02:25:00Z
verified_at_commit: 3ad562437467257640ed1c8868505277b54064b8
status: verified
verdict: ACHIEVED
score: 4/4 success criteria verified (2 live-proven at execution; 2 closed by user UAT 2026-08-20 — see Post-verification resolution)
behavior_unverified: 0
overrides_applied: 0
behavior_unverified_items:
  - truth: "SC1 — Merchant can set, edit, and remove a credit limit from the Companies page in the embedded admin"
    test: "In the dev-store admin, open Credit Guard -> Companies. Set a limit on a company, edit it, then clear the field and save (remove). Reload between each step."
    expected: "Each save round-trips visibly; removed limit renders 'No limit' + 'Observe only'; a concurrent-edit conflict shows the staleness toast and refreshes the row"
    why_human: "The embedded admin iframe cannot be driven from the test harness. The route action (CAS, 404/409, grammar, null-sentinel) is behaviorally proven against real Postgres by 44 tests, but the browser rendering/fetcher layer — badges, edit mode, toasts, Polaris web components inside App Bridge — has never been exercised live (WINDOWS #9)."
  - truth: "SC2 — Merchant can flip a per-company bypass toggle and see its state reflected immediately"
    test: "On the Companies page, flip 'Bypass enforcement' on and off for a company; watch the row while the request is in flight"
    expected: "Switch disables in flight, flips optimistically, settles to server state; 'Enforcement bypassed' badge appears/disappears; exposure and overdue badge remain visible while bypassed"
    why_human: "Same WINDOWS #9 surface: the set-bypass action is behaviorally proven (real DB, last-write-wins, strict literal coercion), and a bypass=true payload is live on Acme Supply — but that value was written below the UI. The 'see its state reflected immediately' clause is a browser-rendering claim no automation here can observe."
human_verification:
  - test: "Companies page end-of-phase UAT (WINDOWS #9): drive set/edit/remove limit and the bypass toggle through the real form action in the dev-store admin; check the five status renderings, edit-mode layout, toast copy, and the integer-cents boundary (limit == exposure -> Within limit; +0.01 exposure -> Over limit)"
    expected: "All 03-03 backstop checks pass; value-echo CAS staleness surfaces as the row-12 toast; no clipped badges at narrow width"
    why_human: "Embedded admin iframe is browser-only; four 03-03 must-have items were declared 'verification: backstop' (visual UAT) from the start"
  - test: "D11 — none required beyond recollection; the write_companies grant RESULT is machine-verified (live metafield writes succeed). No action needed unless a re-consent screen is shown again"
    expected: "n/a — informational"
    why_human: "One-time browser screen already dismissed; wording unrecoverable"
gaps: []
deferred:
  - truth: "Function-side reader semantics (fail-open vs conservative on data_complete=false; bypass precedence in enforcement logic; currency-mismatch behavior; staleness policy for computed_at)"
    addressed_in: "Phase 4"
    evidence: "D-04 (03-CONTEXT.md): 'Phase 4 decides fail-open-vs-conservative on incomplete data WITHOUT a contract change'; ROADMAP Phase 4 SC3: 'missing or malformed credit metafields proceed untouched — the seven-case fail-open matrix'. See 'Phase 4 Contract Sufficiency' below for the four concrete questions the Phase 4 planner must answer."
---

# Phase 3: Credit Controls & Metafield Publishing — Verification Report

**Phase Goal:** Merchant can configure per-company credit, and each company's credit state is published where checkout can read it
**Verified:** 2026-08-20T02:25Z at `3ad5624` (main)
**Status:** human_needed — verdict **ACHIEVED_WITH_GAPS**
**Re-verification:** No — initial verification

The gaps are of the **unverified** kind, not the **broken** kind. Nothing observed in this verification suggests any Phase 3 code is wrong; two success criteria simply have a browser-only layer no automation here can reach, and it has not been reached by a human either.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Merchant can set, edit, and remove a credit limit on any B2B company from a settings page in the embedded admin | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (action layer VERIFIED; browser layer human-pending) | Route `app/routes/app.companies.tsx` (868 lines, substantive): intent-dispatched action with value-echo CAS (`updateMany WHERE {id, shop, creditLimit: previous}` → 409 on count 0), `MONEY_GRAMMAR /^\d{1,13}(\.\d{1,2})?$/` server-side, empty string → null sentinel (remove == never-set). Nav wired in `app/routes/app.tsx:56`. 44 tests in `tests/companies-settings.test.ts` invoke the **real action against real Postgres** (only `authenticate.admin` and the GraphQL seam stubbed — confirmed by reading the harness). Browser round-trip unrun: WINDOWS #9. |
| 2 | Merchant can flip a per-company bypass toggle and see its state reflected immediately | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (action layer VERIFIED; browser layer human-pending) | `set-bypass` intent: strict `"true"/"false"` literal coercion, last-write-wins per UI-SPEC, shop in WHERE. Live payload on Acme Supply carries `bypass:true` with exposure/overdue still populated (03-05 D7) — but that state was written below the UI. The "reflected immediately" (optimistic flip + revalidate) clause is browser-only. |
| 3 | Any change to balance, limit, overdue status, or bypass updates its $app credit metafields within seconds (GraphQL-verifiable) | ✓ VERIFIED (live-proven) | Wiring: `recomputeCompany` → `publishCompanyCreditState` at `app/services/ledger.server.ts:799` (outside transaction, non-throwing); settings action → `republish` → same chain (`app.companies.tsx:260`); hourly `publishBackstop` at `app/services/scheduler.server.ts:291-312`. **Measured live:** 647 ms doorbell→committed `metafieldsSet` (03-05 D5); read-back via GraphQL matched DB field-by-field on 4 real companies; hash-skip proven (Northwind untouched through the 18:00 sweep); `dirtyPublishes: 0` post-sweep (D8). |
| 4 | A fresh install enforces nothing: every company is observe-only until the merchant sets its limit | ✓ VERIFIED (live-proven) | `creditLimit Decimal?` with **no default** in `prisma/schema.prisma:73` — null IS observe-only. Contract: `limit: null` byte-distinct from `"0.00"` (locked in `tests/metafield-contract.test.ts`, raw-substring assertions). **Live:** Powderbound and Snowdevil — never configured — publish `"limit":null` on the real store (03-05 D6). No enforcement mechanism exists until Phase 4, and the encoding that keeps observe-only true is the proven default. |

**Score:** 2/4 fully verified; 2/4 present + action-layer-proven, browser behavior unverified.

### Required Artifacts (levels 1–4)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/services/metafields.server.ts` | Contract header (payload law), serializer, hash, publisher | ✓ VERIFIED | 314 lines. 9-rule payload law in header (contract-home #2). `serializeCreditState` uses `Decimal.toFixed(2)` — money never JSON numbers. Publisher: Shop.active gate, shop-scoped row read, hash-skip with `publishedAt >= recomputedAt` rider, userErrors-inside-data trap handled, never throws (Sentry + dirty marker). No float parsing anywhere in the file. |
| `tests/metafield-contract.test.ts` | Byte-exact contract lock, Phase 4 fixture source | ✓ VERIFIED | 188 lines, byte-exact string assertions plus raw-substring checks (`"limit":null` vs `"limit":"0.00"`), pinned sha256 hash constant, exact-key-set lock (PII guard), stable key order. |
| `app/routes/app.companies.tsx` | Loader + action + inline-edit table | ✓ VERIFIED | Loader reads `db.company.findMany` + `shopDataComplete` — real DB data flows to render (no static/hollow props). Action substantive per SC1/SC2 rows above. |
| `app/routes/app.tsx` | Companies nav item | ✓ WIRED | `<s-link href="/app/companies">` at line 56. |
| `app/services/scheduler.server.ts` | Publish backstop in hourly sweep | ✓ VERIFIED | `publishBackstop` after recompute loop, deterministic `companyGid asc` order, per-company isolation via publisher's own swallow, `forEachActiveShop` remains sole enumerator. |
| `prisma/schema.prisma` + migration | creditLimit/bypassEnforcement/publishedStateHash/publishedAt | ✓ VERIFIED | Columns present; migration `20260819160906_add_company_credit_controls` exists and was applied to production Postgres (railway release logs, 03-05 D3). |
| `shopify.app.toml` | write_companies + credit_v1 definition | ✓ VERIFIED | Five-scope string at line 38; `[company.metafields.app.credit_v1]` type json, `access.admin = "merchant_read"`. Deployed as registry version and consented (live writes succeed — the strongest proof of grant). |
| `tests/scope-lockstep.test.ts` | Three-place scope drift alarm | ✓ VERIFIED | Locks TOML (exact, once) and vitest env (`vitest.config.ts:45` matches); api_version pin asserted. |
| `scripts/prod-credit-metafields.{sh,mjs}` | Live read-back tooling | ✓ VERIFIED | Present; used to produce the 03-05 evidence; authenticates via `unauthenticated.admin` (no raw token handling). |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `ledger.server.ts` (recomputeCompany) | `metafields.server.ts` | `publishCompanyCreditState` call at line 799, post-commit, outside transaction | ✓ WIRED |
| `app.companies.tsx` action | `ledger.server.ts` | `republish` → `recomputeCompany` after each DB write (both intents) | ✓ WIRED |
| `scheduler.server.ts` overdueSweep | `metafields.server.ts` | `publishBackstop` per-company loop | ✓ WIRED |
| `metafields.server.ts` | GraphQL transport | `graphqlJson(..., label: "PublishCompanyCredit")` — T-02-27 honored, no direct admin-context call | ✓ WIRED |
| `app.companies.tsx` loader | `metafields.server.ts` | `shopDataComplete` for the incomplete marker — same L-01 flag the payload carries | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite (run once, myself — not trusted from SUMMARY) | `npm run graphql-codegen && DATABASE_URL=...creditguard_test npx vitest run` | **337 passed, 17 files, 0 failures** (8.8 s) — matches the claimed count exactly | ✓ PASS |
| Contract bytes vs live bytes | Compared `tests/metafield-contract.test.ts` expected strings against the four live payloads recorded in 03-05 | Key order, types, null-vs-string-limit identical | ✓ PASS |
| Live proof (recorded, plausibility-checked) | 03-05 D4–D8 read-backs; `computed_at` on Powderbound (13:32Z state, 18:00Z write) confirms state-instant semantics live | Internally consistent; a defect (gid name-clobber) was found and fixed BY the proof — evidence it was a real run, not narrative | ✓ ACCEPTED |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| CRED-01 | Set/edit/remove credit limit per company | ✓ SATISFIED (action layer) / ? browser UAT pending | SC1 row; live Northwind `"limit":"2500.00"` equals the exact string set |
| CRED-02 | Per-company bypass toggle | ✓ SATISFIED (action layer) / ? browser UAT pending | SC2 row; live Acme `bypass:true` with exposure/overdue visible |
| CRED-03 | Publish credit state to $app metafields on change | ✓ SATISFIED | SC3 row — measured 647 ms, backstop + hash-skip live-proven |
| CRED-04 | Observe-only default; enforcement per company once limit set | ✓ SATISFIED | SC4 row — null default schema + live null payloads on never-configured companies |

No orphaned requirements: REQUIREMENTS.md maps exactly CRED-01..04 to Phase 3, and all four are claimed across the five plans.

### Anti-Patterns Found

| File | Pattern | Severity |
|------|---------|----------|
| — | No TBD/FIXME/XXX/TODO/HACK/placeholder markers in any phase-modified source file | none |

Prohibition checks (from PLAN frontmatter): no `parseFloat`/float money in the publisher or route (grammar → `Prisma.Decimal` only); no PII fields in the payload (exact-key-set test); no `@shopify/polaris` React imports; no second shop enumerator; no long-form `app--{id}` namespace (literal `$app` everywhere). All held.

## Phase 4 Contract Sufficiency — the load-bearing question

**Is the published payload sufficient and unambiguous for a Function to make a correct block/allow decision with no other source of truth?**

**Answer: the payload is SUFFICIENT — every decision input is representable and live-proven — but four reader-side semantics are not yet decided or not recorded where Phase 4 will look. None is a Phase 3 defect; two were explicitly deferred by decision D-04; two have no recorded decision at all and must be answered at Phase 4 plan time.**

Point-by-point against the interrogation list:

1. **`limit: null` vs a set limit — UNAMBIGUOUS.** JSON null = never configured = observe-only; `"0.00"` = block-all. Byte-distinct by construction, locked by raw-substring contract tests, live-proven on the same store simultaneously (Northwind string, Powderbound/Snowdevil null). No gap.

2. **`data_complete: false` — DECIDABLE FROM PAYLOAD, DECISION DEFERRED BY DESIGN.** D-04 (03-CONTEXT.md line 26) says verbatim: "Phase 4 decides fail-open-vs-conservative on incomplete data WITHOUT a contract change." The flag's *meaning* is precisely documented (header rule 4: shop-scoped, false iff any UNRESOLVED net-terms order). What's missing: the metafields.server.ts contract header does not point readers at the D-04 deferral, so a Phase 4 implementer reading only the contract homes would not know the decision is theirs to make. **Concrete question for the Phase 4 planner:** *"When `data_complete` is false, exposure may UNDERSTATE the true balance. Does the Function still enforce against the (possibly low) exposure, or suppress enforcement for the shop until complete? Note fail-open-on-incomplete means a genuinely over-limit company checks out during backfill; enforcing means blocking on numbers you know are partial. D-04 assigned this decision to you — record it in the Function's source and the ENFC fail-open matrix."*

3. **Decimal strings — COMPARABLE WITHOUT FLOATS, GUIDANCE UNWRITTEN.** The format is guaranteed exactly-2dp (`Decimal.toFixed(2)`, contract-test-locked — `"5000"` can never appear, only `"5000.00"`), which makes integer-cents comparison trivial: `split(".")` → `BigInt/number` cents, no float ever needed. But no contract home says "compare as integer cents." **Concrete question:** *"Phase 4 Function must compare exposure + cart total against limit as integer cents derived from the fixed-2dp strings (and the cart's amount, which Shopify delivers as a decimal string too). Write this into the Function and add a fixture where float parsing would give the wrong answer (e.g. limit `"0.10"`, exposure `"0.00"`, cart `0.10` — classic 0.1+0.2 territory)."*

4. **Currency — REPRESENTABLE, MISMATCH BEHAVIOR UNDECIDED. The strongest open item.** The payload's `currency` is the store currency of the ledger rows (rule 5, D-07); `null` only co-occurs with exposure `"0.00"`. The Function input's cart cost carries its own currencyCode, which for presentment-currency carts may differ from the published currency. The mismatch is *detectable* from the two payloads — but no document anywhere in Phase 3 (or the ROADMAP) says what the Function should do about it, and unlike data_complete there is no recorded deferral. This is the finding closest in class to Phase 2's `purchasingEntity` trap: everything passes until a EUR-presentment cart meets a USD limit. **Concrete question for the Phase 4 planner:** *"Which currency does `cart.cost.totalAmount` carry in the validation Function input for a B2B checkout (presentment vs store), and what does the Function do when it differs from the payload's `currency` — fail open (consistent with ENFC's malformed-payload posture), or compare against a store-currency amount if the input exposes one? Verify empirically on the dev store (multi-currency if enabled) before writing the comparison, and add the mismatch case to the seven-case fail-open matrix."*

5. **`overdue` + `bypass` precedence — UNAMBIGUOUS IN INTENT, NOT IN A CONTRACT HOME.** D-03 and the prisma schema comment (schema.prisma:74-76) state it plainly: bypass true → "Phase 4's Function lets the checkout through regardless of limit/overdue." So yes, bypass overrides overdue as well as over-limit. But the contract header's field table says only "bypass — Company.bypassEnforcement", and neither the TOML block nor the contract test states precedence. **Concrete item:** *"Phase 4: encode `if (bypass) allow` as the FIRST check, cite D-03, and (additively — allowed under rule 3) consider restating precedence in the metafields.server.ts header so the contract homes carry it."*

6. **Staleness — EXPOSED, THRESHOLD UNDEFINED.** `computed_at` semantics are precise and live-demonstrated (state instant, not publish instant — Powderbound carried 13:32Z through an 18:00Z write, so a reader CAN distinguish stale state from stale write). Nothing anywhere says how stale is too stale. Architecturally, staleness is bounded by webhook latency (seconds) plus the hourly sweep, so the honest v1 answer is probably "informational only — never block or unblock on age." **Concrete question:** *"Phase 4: is `computed_at` informational-only in v1, or is there an age beyond which the Function treats the payload as malformed (fail-open)? Decide, record, and add the ancient-computed_at case to the fail-open matrix either way."*

**Severity ruling:** items 2 and 4 are the expensive ones, and both are Phase 4 *planning inputs*, not Phase 3 payload defects — the payload carries everything needed to implement either answer. Item 4 (currency) is the only one with no recorded decision or deferral anywhere; it is flagged in the deferred section so the Phase 4 planner cannot miss it.

## Known Gaps — severity assessment (not re-reports)

- **WINDOWS #9 (Companies page browser UAT unrun) — WARNING, drives the human_needed status.** Honest judgment on whether SC1/SC2 can be called achieved on unit tests + source reading alone: **almost, but not fully.** The tests are stronger than "unit tests" — they invoke the real route action against real Postgres with only auth and the GraphQL seam stubbed, so set/edit/remove persistence, CAS staleness, the 404/409 split, grammar rejection, cross-shop zero-row isolation, and the null-sentinel are behaviorally proven, and the publisher those actions trigger is live-proven from below. What is NOT proven by anything: that the page loads and round-trips inside the real admin iframe (App Bridge + Polaris web components + fetcher lifecycle), badge rendering, edit-mode layout, and the four items 03-03 itself declared `verification: backstop` (visual UAT). The route lives inside a shell whose embedding was proven in Phases 1–2 and uses the established patterns, so the residual risk is moderate-low — but "Merchant can set... from a settings page in the embedded admin" is a merchant-facing claim, and no merchant-shaped agent has done it. Verdict: **unverified, not broken**. This is the single item between ACHIEVED_WITH_GAPS and ACHIEVED.
- **D11 (re-consent wording is recollection) — INFO.** The grant RESULT is machine-verified: live metafield writes succeed under the offline session. Nothing actionable.
- **WINDOWS #3 (SessionNotFoundError retry loop) and #8 (access-log id_token leak) — out of scope.** Open Phase 1/2 defects; neither touches any Phase 3 truth. Noted so they are not silently absorbed: they remain open in WINDOWS.md.

## Gaps Summary

No broken artifacts, no stub code, no unwired links, no failed truths. The phase goal is achieved at every layer automation can reach, with two live-proven criteria (SC3, SC4) and a live-proven contract payload on four real companies — including a defect (`companies/update` gid name-clobber) that the live proof itself caught and fixed, which is the behavior of a real verification gate, not a narrated one.

Outstanding before the phase can be called fully ACHIEVED:
1. **Human:** run the WINDOWS #9 Companies-page UAT in the dev-store admin (SC1/SC2 browser layer + the four 03-03 visual backstops).
2. **Carry to Phase 4 planning:** the four concrete contract questions above (data_complete behavior, integer-cents comparison rule, **currency mismatch — highest priority, no recorded decision exists**, staleness policy) plus the bypass-precedence restatement.

---

_Verified: 2026-08-20T02:25Z_
_Verifier: Claude (gsd-verifier), at commit 3ad5624_


---

## Post-verification resolution (2026-08-20)

The single gap this report held open — SC1/SC2 unproven at the browser layer
(WINDOWS #9) — was closed by user UAT on `credit-guard-demo`:

- All four companies rendered with **names, not GIDs** — the live regression
  check for `a4a1f2c`, the rename defect 03-05 found. PASSES.
- Badges render correctly; the bypass toggle round-trips through the real form
  action (exercising auth -> intent dispatch -> value-echo CAS -> write ->
  revalidation).
- The **limit** intent's own path was exercised set -> edit -> clear:
  1500.00 produced an over-limit badge, 1874.95 (exactly the exposure) read as
  **within** limit — the integer-cents at-limit boundary — and clearing
  returned the company to observe-only.

Metafields followed each change. Live read-back 2026-08-20: three surviving
companies, every field matched against the DB row it projects,
`dirtyPublishes: 0`, `dataComplete: true`.

**Caveat, recorded rather than smoothed over:** the clear/removal step was
performed on Powderbound, which the user subsequently deleted in the Shopify
admin (a genuine `COMPANIES_DELETE` delivery, processed 18:42:20.645Z — the app
has no delete control of its own and the settings action only ever runs
`updateMany` on `creditLimit`). That step therefore rests on the human
observation, not a surviving live artifact. The coverage item was
`human_judgment: true` in any case.

**Verdict revised: ACHIEVED.** The four contract-reader questions for Phase 4
(currency mismatch first) remain carried in ROADMAP.md Phase 4 — they are
Phase 4 planning inputs, not Phase 3 gaps.

Incidental: Northwind now sits at exposure 1874.95 against a 1500.00 limit —
**over limit**, the block-case fixture Phase 4 needs, which did not exist before.
