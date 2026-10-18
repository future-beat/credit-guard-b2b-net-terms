---
phase: 04-checkout-enforcement
verified: 2026-08-20T11:10:00Z
status: passed
verdict: ACHIEVED
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
commit_verified: 50359cf (main, PR #2 merged 2026-08-20T10:57:04Z)
verification_basis:
  - "Independent full-suite run: 490/490 tests across 21 files, exit 0 (vitest 4.1.10, 2026-08-20)"
  - "Independent live read-backs at 11:03–11:04Z via scripts/prod-enforcement-events.sh and scripts/prod-validation-state.sh (read-only) — NOT taken from SUMMARY claims"
  - "Source-level walk of extensions/credit-guard-validation/src/cart_validations_generate_run.ts against D4-01/D4-02/D-03/F-01/F-02"
  - "Diff-level read of fix commit 19b5946"
warnings:
  - id: W1
    concern: "Echo-flags TOCTOU window in updateValidationMessages is real and unacknowledged"
    detail: "readValidationFlags → validationUpdate is read-then-write with no CAS (the platform offers none). A merchant toggling the rule in Shopify admin inside that ~1-RTT window has the toggle reverted by a concurrent copy edit. Probability is very low, the settings page's honest status makes the outcome visible, and the failure is state-reversion, not silent disablement — but the residual risk is documented nowhere (no comment, no WINDOWS entry). Recommend a one-line acknowledgment in the UPDATE_VALIDATION_MUTATION doc comment or WINDOWS."
  - id: W2
    concern: "No live overdue-only block was ever observed"
    detail: "The human matrix blocked Northwind (over-limit) live; Acme (overdue) was tested only in its bypass configuration (allow). ENFC-02's block is proven at unit level (F-01 pins) and at real-wasm level (block-overdue.json in function-runner), and SC3 explicitly scopes the live matrix to observe-only/bypass/D2C — so this is within the roadmap contract, but the overdue block message has never been seen by a human at a storefront."
  - id: W3
    concern: "Planning-doc bookkeeping lags the merge"
    detail: "REQUIREMENTS.md ENFC-01..06 checkboxes are unchecked and the traceability table still says 'Pending' for Phase 4; the PR-proposed ENFC-05 rewording ('or whose order would have been blocked') is not yet applied. Implementation flags a strict superset of the current wording, so the requirement as written is satisfied — the rewording is a maintainer decision left open, correctly surfaced in the PR body."
  - id: W4
    concern: "04-05 coverage block D8 is labelled human_judgment: false but contains a human-only observation"
    detail: "EC-3a ('draft order blocked in admin', human step 7) is observable only by a human; the block's decisive ENFC-06 evidence (event row, exposure delta) is machine-read, and the manual ref is transparently listed as kind: manual — so nothing is laundered, but the block-level flag understates the human dependency of the EC-3a half."
human_verification_already_performed:
  - test: "Checkout matrix steps 0–8 on credit-guard-demo (block, edit, re-block, three allows, draft block, draft leak)"
    performed_by: "user, 2026-08-20"
    corroborated_by: "verifier live read-backs 11:03–11:04Z: config_v1 updatedAt 09:44:20Z with non-default copy; BYPASSED_ORDER row; exposure 1924.90 = 1874.95 + 49.95; orders #1009/#1010/#1012 attributed to the expected companies"
---

# Phase 4: Checkout Enforcement — Verification Report

**Phase Goal:** Companies over their credit limit or overdue cannot place new net-terms orders, and no other checkout is ever affected.
**Verified:** 2026-08-20T11:10:00Z at commit `50359cf` (main, PR #2 merged)
**Status:** passed — **ACHIEVED**
**Re-verification:** No — initial verification

## Verdict reasoning

Both halves of the goal hold on evidence I gathered myself, not on SUMMARY narration. The blocking half: the comparator implements the locked decision order verbatim (walked line-by-line below), its two non-obvious orderings are pinned by tests I read (not just by test names), the wasm ran the same 8 fixtures under function-runner, and a real over-limit buyer was blocked at a real storefront — twice, the second time with the merchant's own edited copy, which I confirmed live on the Validation's `config_v1` (updatedAt 09:44:20Z, non-default wording). The never-affect-others half: the 9-case fail-open matrix passes in the 490-green suite I ran, `blockOnFailure: false` is live on the platform (my own read at 11:04Z), and observe-only/bypassed/D2C checkouts all completed in the human matrix. The ENFC-06 chain re-verified live end-to-end with correct arithmetic. Four warnings, none of which is a gap in the goal.

## Goal Achievement — Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Over-remaining-credit buyer cannot complete net-terms checkout; sees merchant's message; at-limit allowed (D4-01); prepay paths stay open | ✓ VERIFIED | Source step (12): `exposure + cart > limit` in integer cents; test "at-limit exactly is ALLOWED: 1400.00 + 100.00 == 1500.00"; `block-over-limit.json` blocks under real wasm (04-01 runner matrix, corroborated by the vitest fixture-verdict table I read); human step 1/3 live block. Prepay-stays-open is by-argument (Function input exposes no payment selection; terms checkout IS the net-terms path) — argued openly in the PR body, with the honest v1 limitation (a blocked company's pay-now location also blocks) stated rather than buried. |
| 2 | Overdue buyer blocked the same way — currency-independent, survives currency-mismatch limit skip (D4-02) | ✓ VERIFIED | Source: overdue at step (7), BEFORE money grammar (8) and the currency gate (10). F-01 pin read directly: `limit: "not-money" + overdue: true` → blocks with overdue copy; same payload `overdue: false` → allows. EUR-cart/USD-payload + overdue → block test at line 264. `block-overdue.json` + `block-malformed-limit-overdue.json` block under real wasm. See W2: no live overdue block was staged (within SC3's live scope). |
| 3 | D2C and malformed-metafield checkouts untouched; nine-case matrix green; observe-only/bypass/D2C pass live | ✓ VERIFIED | All 9 cases present in `tests/checkout-validation-function.test.ts` (D2C, metafield null/non-object, malformed flags, v≠1, data_complete:false→enforce, bypass-first, observe-only incl. absent-key hardening, currency mismatch, throw-proof); suite 490/490 in my own run. Live: #1009 Snowdevil (observe-only), #1010 Acme (overdue+bypass), #1012 D2C all completed (human matrix), and my live ledger read shows all three attributed/unattributed exactly as expected. |
| 4 | Merchant can edit the blocked-checkout message | ✓ VERIFIED | `app/routes/app.settings.tsx` wired to `updateValidationMessages`; 250-char cap locked to the wasm's cap by a source-diff test; DEFAULT_MESSAGES locked byte-for-byte across server/wasm (`tests/enforcement-registration.test.ts` "matches the Function's duplicated copy byte for byte"). Live: `config_v1` carries the merchant's edited copy ("settle outstanding invoices" vs default "settle open invoices"), rule still `enabled: true` — the 19b5946 fix held in a real browser. |
| 5 | Event log records every block/unblock transition with snapshot, and every leaked order flagged with order/amount/channel while still counting (ENFC-05 as re-scoped, D4-03) | ✓ VERIFIED | **Independently re-read live at 11:03Z:** 2× BLOCK_STATE_ENTERED (limit 1500.0000) and 1× EXITED (limit 5000.0000), each snapshot carrying the value that drove the flip; exactly 1× BYPASSED_ORDER (`countsByKind` confirms), order `gid://shopify/Order/7080326758633` (#1011), channel `shopify_draft_order`, amount 49.9500, pre-order snapshot 1874.9500/1500.0000/overdue false/bypass false; Northwind live exposure 1924.9000 = 1874.95 + 49.95 exactly. `blockedStateAgrees: true` for all three companies. |

**Score:** 5/5 truths verified (0 behavior-unverified)

## The hardest checks, walked

### 1. Comparator vs the locked decisions — MATCHES

Read `cart_validations_generate_run.ts` (265 lines) in full. Order implemented: (0) whole-body try/catch → allow; (1) no purchasingCompany → allow; (2) credit_v1 absent/non-object → allow; (3) v≠1 → allow; (4) non-boolean overdue/bypass → allow; **(5) bypass first** — before both rules (D-03); (6) limit null **or absent** → observe-only allow (absent-key hardening beyond the plan, safe direction); **(7) overdue block before grammar** (F-01); (8) money grammar fail-open for the limit rule only; **(9) block-all `limit: "0.00"` skips the currency gate** (F-02) — including the legal `currency: null` zero-order payload; (10) currency mismatch skips limit rule only (D4-02); (11) cart normalization, truncation-only (can only under-block); (12) `exposure + cart > limit` integer cents, at-limit allowed (D4-01), `Number.isSafeInteger` guard on the projected sum. No float touches money anywhere — string surgery only.

**Pins actually pin** (read, not trusted by name): the F-01 pair asserts opposite verdicts on `limit:"not-money"` differing only in `overdue`; the F-02 block asserts `limit:"0.00"` + `currency:null` blocks while `limit:"1500.00"` + `currency:null` allows, and that `"0.00"` vs `null` are opposite verdicts on identical carts (D-02). 04-01 additionally mutation-tested both orderings (1-red and 2-red respectively, source restored byte-identical) — a stronger guarantee than the structurally-impossible RED phase, and honestly disclosed as a TDD-gate substitution.

### 2. Fail-open completeness — HOLDS, no path relies on throwing

Every branch returns `allow()` or `block()`; the try/catch is a belt. The only member accesses that could throw are schema-non-null fields (`purchasingCompany.company`, `cart.cost.totalAmount`) — if the platform ever violated its own schema, the catch converts it to allow. `blockOnFailure: false` verified **live by my own read** (`ec4.blockOnFailureFalse: true` at 11:04Z), pinned at registration (line 464) and — post-19b5946 — echoed, never re-defaulted, on copy edits. The braces exist; nothing depends on them.

### 3. The 19b5946 fix — CORRECT, one unacknowledged residual (W1)

The defect was real and severe (a metafields-only `validationUpdate` re-defaults `enabled` — measured live: true at 05:16Z → false at 05:24Z; every merchant copy edit would have disabled enforcement silently). The fix reads live flags immediately before the write and echoes both `enable` and `blockOnFailure`. A failed flag read genuinely writes nothing: `if (!flags.ok) return` precedes the mutation, "missing" and "error" are kept distinct (`unregistered` vs `save-failed`), and the test "writes NOTHING when the current flags cannot be read" pins it. The original 04-04 intent (never re-enable a merchant-disabled rule) is preserved and its test kept its name while inverting its assertion — the honest way to fix a wrong-premise test. **Residual:** the read→write gap is a TOCTOU window with no platform CAS; a concurrent admin toggle can be reverted by a copy edit. Low probability, visible outcome, but acknowledged nowhere (W1).

### 4. ENFC-06 evidence chain — RE-VERIFIED LIVE, exactly-once holds

My own 11:03Z read: exactly one BYPASSED_ORDER (kind-count 1), order 7080326758633, channel `shopify_draft_order`, amount 49.9500, snapshot exposure 1874.9500 / limit 1500.0000 — the PRE-order state (blocked: 1874.95 > 1500), not the post-order 1924.90, so the D4-01 comparison did not count the order against itself. Arithmetic: 1874.95 + 49.95 = 1924.90 = Northwind's live exposure. Exactly-once is triple-layered in code I read: leak fires only on the transition INTO `ATTRIBUTED` (`priorRow?.attributionStatus !== "ATTRIBUTED"` — a redelivered doorbell of an attributed row is a no-op); DB unique `[shop, kind, orderGid]` as backstop; P2002 treated as success inside non-throwing `recordEnforcementEvent`. Tests cover both the redelivery path and the pre-read-miss race. NULL orderGid on transition rows never collides (two ENTERED rows coexist live — demonstrated).

### 5. Human-evidence honesty — HONEST

The matrix (steps 0–8, user, 2026-08-20) is recorded as `kind: manual`, `human_judgment: true` with rationales in coverage blocks D5/D6/D7 — not laundered into automated status. The two argue-not-test items are the PR body's own top-level section ("Two things proven by ARGUMENT, not by test — please push back if you disagree"), including the unflattering v1 limitation (blocked company's pay-now location also blocks) and the admission that P4-L2 is broader than ENFC-05's wording, with a proposed rewording left to the reviewer. One nit: D8 carries `human_judgment: false` while containing the human-only EC-3a observation (W4). The EC-2 probe is labelled a proxy in the tooling itself, with the behavioural proof (a block is impossible on a null metafield) correctly identified as the real evidence.

### 6. Suite integrity — INDEPENDENTLY CONFIRMED

Ran `npm run graphql-codegen` + `npx vitest run` against `creditguard_test` myself: **490 passed / 490, 21 files, exit 0** — exactly the claim. All 8 fixtures exist under `tests/fixtures/function-inputs/`; the equivalence gate is real: a vitest table runs the pure `run()` over the same JSON bytes function-runner executed, the corpus is locked at exactly 8, and a provenance test asserts every fixture payload carries exactly the credit_v1 key set — editing a fixture to appease the runner turns vitest red.

### 7. WINDOWS accounting and the data_complete "contradiction" — RECONCILED

#10 (exhaustion-flip starvation pinning `data_complete: false` on order #1012) and #11 (EC-1 decimal capture skipped) both recorded in WINDOWS.md and expanded in `deferred-items.md` with a suggested remedy and owner. #10's claim "enforcement unaffected because the Function doesn't read data_complete" is **verified against source**: `data_complete` appears only in a comment in the Function; the input query doesn't select behavior on it. There is no contradiction with the 9-case matrix: the matrix's data_complete case (row 5, test read directly) asserts `data_complete: false` **enforces normally** — which is precisely the D-04 decision (incomplete data can only understate exposure, which can only under-block; suppressing enforcement would be strictly worse). The code satisfies the case by never reading the field. The deferral is observability debt (AR dashboard completeness flag reads pessimistically on a quiet store), not a checkout risk — and Northwind stayed blocked live while `data_complete: false` was published, proving the point empirically.

## Required Artifacts

| Artifact | Expected | Status |
|----------|----------|--------|
| `extensions/credit-guard-validation/src/cart_validations_generate_run.ts` | Pure comparator, locked order | ✓ VERIFIED (265 lines, substantive, exported via `cartValidationsGenerateRun` bound in shopify.extension.toml) |
| `extensions/credit-guard-validation/src/cart_validations_generate_run.graphql` | Input query, namespace omitted | ✓ VERIFIED (live: omitted-namespace reads resolve for all 3 companies; behavioural proof = the block) |
| `tests/checkout-validation-function.test.ts` | 9-case matrix + F-01/F-02 pins + fixture equivalence | ✓ VERIFIED (read; pins assert the exact regressions) |
| `tests/fixtures/function-inputs/*.json` | 8-fixture runner corpus | ✓ VERIFIED (8 present, corpus + key-set locked by tests) |
| `app/services/enforcement.server.ts` | isBlockedState/wouldBlockOrder, events, registration, echo-flags update | ✓ VERIFIED (wired: recomputeCompany hook, ledger leak inference, app.tsx ensure-step, settings route) |
| `prisma/.../add_enforcement_events` | Additive migration, `@@unique([shop, kind, orderGid])` | ✓ VERIFIED (schema read; dedupe index present with NULL-distinct semantics documented) |
| `app/routes/app.settings.tsx` | Merchant message editor | ✓ VERIFIED (wired to updateValidationMessages, cap in lockstep) |
| `scripts/prod-{validation-state,enforcement-events}.{sh,mjs}` | Read-only live tooling | ✓ VERIFIED (executed by this verifier; read-only held) |
| Live Validation on credit-guard-demo | enabled, blockOnFailure false, config_v1 | ✓ VERIFIED LIVE at 11:04Z (handle/GID/appKey match; exactly 1 of ours; `otherValidations: []`) |

## Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| Function input query | credit_v1 payload | metafield(key) namespace-omitted; fixtures generated from contract bytes | ✓ WIRED (live omitted-namespace reads + real block) |
| recomputeCompany | EnforcementEvent transitions | single hook, decide-in-tx/write-after-commit | ✓ WIRED (live ENTERED/EXITED rows with snapshots) |
| Order attribution | BYPASSED_ORDER | `wouldBlockOrder` at ATTRIBUTED transition, `recordEnforcementEvent` post-commit | ✓ WIRED (live row, exactly once) |
| Settings save | Validation config_v1 | updateValidationMessages with echoed flags | ✓ WIRED (live edit at 09:44:20Z, rule stayed enabled) |
| App open | Validation registration | ensureValidationRegistered in app.tsx, blockOnFailure false | ✓ WIRED (live EC-4 booleans all true) |

## Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| ENFC-01 | ✓ SATISFIED | SC1 above; prepay parenthetical by-argument, disclosed with its v1 limitation |
| ENFC-02 | ✓ SATISFIED | SC2 above (W2: live overdue block not staged; unit + real-wasm proven) |
| ENFC-03 | ✓ SATISFIED | SC4 above; per-field fallback; byte-locked twin copies; live edited copy rendered at a real blocked checkout |
| ENFC-04 | ✓ SATISFIED | SC3 above + blockOnFailure false live + throw-proof + no code path relies on throwing |
| ENFC-05 (re-scoped 2026-08-20) | ✓ SATISFIED | SC5 above; transitions + leaked orders per D4-03. Implementation (P4-L2) flags a strict superset of the current wording; proposed further rewording pending maintainer decision (W3) |
| ENFC-06 | ✓ SATISFIED | Leak flagged with order/amount/channel AND still counted (+49.95 verified live) |

No orphaned requirements: REQUIREMENTS.md maps exactly ENFC-01..06 to Phase 4. (W3: checkboxes/traceability not yet flipped from Pending.)

## Anti-Patterns Found

None. No TODO/FIXME/XXX/placeholder markers in the phase's source files; no stub returns; no skipped tests. The one "duplicated" artifact (DEFAULT_MESSAGES in two workspaces) is deliberate, documented, and mechanically diffed by a test.

## Gaps Summary

No gaps. The phase goal is achieved and independently re-verified against the live store. Four warnings for follow-up, none blocking:

1. **W1 — acknowledge the echo-flags TOCTOU** (one comment line or a WINDOWS entry; no code change forced — the platform offers no CAS).
2. **W2 — opportunistically stage a live overdue-only block** next time the dev store fixtures are touched (e.g. flip Acme's bypass off for one checkout).
3. **W3 — planning bookkeeping**: flip ENFC checkboxes/traceability, and decide the proposed ENFC-05 rewording (accept or reject the P4-L2 breadth in the requirement text).
4. **W4 — D8 labeling nit** (EC-3a is human-only inside a human_judgment: false block) — recording here is sufficient.

---

_Verified: 2026-08-20T11:10:00Z_
_Verifier: Claude (gsd-verifier), adversarial goal-backward pass at commit 50359cf_
