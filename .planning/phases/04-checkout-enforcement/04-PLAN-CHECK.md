# Phase 4 Plan Check — Checkout Enforcement

**Checked:** 2026-08-20 · plans at commit eb31ef0 · checker: gsd-plan-checker
**Phase goal:** Companies over their credit limit or overdue cannot place new net-terms orders, and no other checkout is ever affected.

## Verdicts

| Plan | Verdict | Findings |
|------|---------|----------|
| 04-01 | ISSUES | 2 SHOULD-FIX, 2 NOTE |
| 04-02 | PASS | 2 NOTE |
| 04-03 | PASS | 1 NOTE |
| 04-04 | PASS | — |
| 04-05 | ISSUES | 1 SHOULD-FIX, 1 NOTE |

No MUST-FIX findings. Requirement coverage ENFC-01..06 is complete across the set (04-01: 01-04 unit; 04-02: 05/06; 04-03: registration/platform half; 04-04: 03 editable half; 04-05: all six live). All plans honor D4-01/D4-02/D4-03 and every binding research correction (no bypassCartValidations, namespace omitted in the Function query, blockOnFailure:false, operations/validationAdd/$.cart shape). Dependency graph valid (waves 1,1,2,3,4; no cycles). Executing these plans as revised below will achieve the phase goal.

## Scrutiny trace (orchestrator's 8 points)

1. **P4-L1 vs D4-01 — CONSISTENT.** Three predicates exist and cannot silently disagree: Function `exposure+cart > limit` (04-01, D4-01 verbatim); state `exposure >= limit` (04-02 P4-L1 — coherent: zero remaining credit means every positive cart blocks, so it is a fair company-level "blocked state"); leak `exposure_pre + outstanding > limit` (P4-L2 — the exact D4-01 comparison). The at-limit boundary is tested on all three (04-01 Task 2 boundary case: sum==limit allow; 04-02 Task 1: exposure==limit IS blocked state — divergence from the Companies-page badge is explicitly documented in the predicate doc comment, where verifier and Phase 6 will look). P4-L2 also fires when the company was NOT yet in blocked state but the order itself exceeds remaining credit — broader than ENFC-05's "while its company was blocked" wording but strictly more faithful to "the comparison the Function would have made"; 04-02 states this explicitly (Task 2 case 2). No silent disagreement found.

2. **9-case fail-open walk (per the PLAN's decision order, 04-01 Task 2 action):** D2C(1)→allow; no metafield(2)→allow; malformed(2/3/4/8/10 gates)→allow; v≠1(3)→allow; data_complete false→enforce (field never read); bypass(5)→allow FIRST; currency mismatch(9)→limit rule skipped; overdue(7)→block; throw→caught at (0). Nothing in the specified logic relies on blockOnFailure (whole-body try/catch is task-mandated and matrix row 9 tests a throwing proxy input). Two deviations found — F-01 and F-02 below.

3. **Ordering/precedence — CORRECT.** bypass is step 5, before overdue (7) and limit compare (11) — overrides both; the Acme fixture (overdue+bypass+over-limit→allow) locks it, and 04-05 checkpoint step 5 proves it live. Overdue (7) sits BEFORE the currency gate (9), so the mismatch skip cannot short-circuit ENFC-02; 04-01 case 8 tests exactly (payload USD, cart EUR, overdue true → block).

4. **Scope lockstep — SAFE.** 04-03 Task 1 touches all four homes (TOML, Railway SCOPES, vitest env, tests/scope-lockstep.test.ts) plus the fifth copy in tests/webhooks.b2b-events.test.ts (~545 and ~598) in one commit. Verified against the actual test files: every assertion is on the REQUESTED string (TOML text / process.env.SCOPES), never on Shopify's granted session scope — so the 03-05 read-collapse behavior (read_companies vanishing under write_companies in the grant) cannot break any planned assertion; no read_validations is requested, so there is nothing for write_validations to collapse. A4 (write-implies-read for Query.validations) is correctly deferred to 04-05 EC-4 with a named STOP-and-lockstep fallback, not improvised.

5. **P4-L2 leak predicate — SOUND.** Fires at attribution time after company resolution (create-as-ATTRIBUTED or transition-to-ATTRIBUTED, pre-read inside the transaction); dedupes via unique [shop, kind, orderGid] with the pre-read as first line and the constraint as backstop, tolerating the duplicate-key race inside non-throwing recordEnforcementEvent; prepaid orders excluded (hasPaymentTerms false → no row, tested); partial payment understates outstanding → under-flags only (conservative, documented). Event write deliberately outside the ledger transaction so an event blip can never roll back ledger work. Reconciliation-path late attribution documented as an honest approximation of "at ingest".

6. **Re-consent parking — CLEAN.** 04-03 parks via user_setup exactly like 03-02 (Task 3 explicitly attempts zero gated calls). 04-04 runs entirely at the mocked seam ("passes regardless"). 04-05 Task 1 carries an explicit precondition re-checking the consent happened (prod-ledger-state clean + no fresh ACCESS_DENIED in Sentry). Nothing silently assumes the tap.

7. **PR flow — COMPLIANT.** Every plan mandates branch phase-04-checkout-enforcement; 04-05 ends with `gh pr create` and a no-merge prohibition; registry (`shopify app deploy`) and Railway releases from the branch are explicitly called out in 04-03 as user-mandated. Gap: no rollback story for prod running two branch migrations while main lacks them — see F-05 (NOTE; both migrations are additive so main stays deployable, but say so).

8. **Suite integrity — COMPLIANT.** 337-green floor asserted in 04-01/02/03/04 and at the 04-05 PR head; each plan names its new test file; run() is specified as a pure module importable by root vitest without the wasm toolchain (04-01 Task 1 explicitly quarantines runtime glue); function-runner gates present in 04-01 Tasks 1 AND 3 (all six fixtures, runner-vs-vitest equivalence, instruction count recorded). Verify commands audited: no `^`-anchored package-manager greps, no `2>/dev/null || echo` swallowed-error comparisons; the `grep -c … | grep -q '^0$'` pipelines behave correctly on zero matches; the 337 count carries provenance (04-RESEARCH: 337 tests / 17 files at phase start).

## Findings

### F-01 [SHOULD-FIX] 04-01 — overdue-before-grammar ordering deviates from the research skeleton and is untested in the direction it changes
- **Plan line (04-01 Task 2 action):** "(7) overdue true → block … placed before money parsing so a malformed limit string on a configured company cannot silence ENFC-02; (8) limit/exposure grammar-check … malformed → allow"
- **Defect:** The binding research skeleton (04-RESEARCH §Code Examples) checks money grammar BEFORE overdue, so `limit:"garbage" + overdue:true` → allow there but → BLOCK under this plan. The matrix-row-3 fixtures all carry `overdue:false` (contract-byte default), so no planned test pins the changed behavior — a future refactor back to the skeleton order would silently flip an ENFC-02 outcome with the suite still green. The deviation itself is defensible (overdue is an independently well-formed boolean; blocking is arguably correct), but it is an undocumented reinterpretation of ENFC-04's "malformed metafield → fail open" and currently unlocked by any test.
- **Fix:** Add one explicit case to Task 2's behavior list: `limit "not-money" (non-null, bad grammar) + overdue true → block with overdue message` — plus a one-line must_haves truth naming the deliberate ENFC-04 interpretation (malformed MONEY fields fail open for the limit rule only; a well-formed overdue boolean still enforces).

### F-02 [SHOULD-FIX] 04-01 — block-all (`limit:"0.00"`) is silently unenforced when payload `currency` is null
- **Plan line (04-01 Task 2 action step 9):** "payload.currency non-string or !== cart currencyCode → allow"
- **Defect:** The contract (metafields.server.ts rule 5 / contract test "zero-order company") makes `currency:null` a legal payload — a shop with zero ledger orders. A merchant on a fresh install who sets `limit:"0.00"` (block-all, D-02) gets `{limit:"0.00", exposure:"0.00", currency:null}` → step 9 allows → block-all does nothing until the first order lands. The planned block-all test fixture derives from contract bytes with `currency:"USD"`, so this hole is untested and invisible. It cannot false-block (fail-open direction) but it breaks D-02's block-all promise in exactly the onboarding scenario where a merchant would test it.
- **Fix:** Add a currency-independent special case before step 9: if `limit_cents === 0 && exposure_cents >= 0`, block any positive cart (0 remaining credit + non-negative exposure exceeds in ANY currency — no conversion involved, mathematically exact). Add fixtures: `{limit:"0.00", exposure:"0.00", currency:null}` + positive cart → block; and `{limit:"1500.00", …, currency:null}` → allow (general null-currency still skips the limit rule per D4-02 posture).

### F-03 [SHOULD-FIX] 04-05 Task 1 — the transition-event drive assumes Northwind's blockedState is already true, which nothing guarantees
- **Plan line (04-05 Task 1 action):** "set Northwind's creditLimit to 5000.00 … → BLOCK_STATE_EXITED; then restore 1500.00 … → BLOCK_STATE_ENTERED … Also expect (and record) the phase's FIRST ENTERED event: … the initial post-deploy recompute/sweep should have written one"
- **Defect:** Verified against the code: the 04-02 migration defaults `blockedState=false`; the hourly sweep (scheduler.server.ts) only REPUBLISHES, and the daily reconciliation sweep skips companies with `!anyUnresolved && localCount === ordersCount` (reconciliation.server.ts:395) — so no recompute of Northwind is guaranteed between the 04-03 Railway release and this drive. If none ran, stored=false when the drive starts: the limit→5000 doorbell computes nowBlocked=false, stored=false → NO EXITED event, and the "first ENTERED" expectation is also unmet. The `grep BLOCK_STATE` verify still passes on the later ENTERED alone, so the plan's own gate would green-light incomplete evidence. Secondary: if Northwind carries `overdue:true` (which checkpoint step 1 explicitly allows for), the limit change cannot exit blocked state at all (P4-L1's overdue arm holds) and the EXITED leg is impossible as designed.
- **Fix:** (a) Seed first: before the EXITED leg, send one doorbell at limit 1500.00 and assert an ENTERED row (or blockedState already true) — this replaces the soft "should have been written" expectation with a deterministic step. (b) Precondition the drive on Northwind `overdue === false` (check via prod-ledger-state); if overdue, drive the EXITED leg via the bypass toggle instead (BYPASS_ENABLED + EXITED pair, already proven in 04-02 Task 3) and restore. (c) Tighten the verify to require BOTH kinds: `grep -q 'BLOCK_STATE_ENTERED' && grep -q 'BLOCK_STATE_EXITED'`.

### F-04 [NOTE] 04-01 — hardcoded wasm artifact path in verify
`wc -c < extensions/credit-guard-validation/dist/function.wasm` guesses the scaffold's output path; recent templates sometimes emit a different dist name. If the path differs, the verify fails spuriously — executor should read the extension TOML's build output path and adjust, not skip the size gate. Same task: `ls … | wc -l | grep -q '6'` also matches 16/60; harmless at this fixture count but `grep -qx '6'` is exact.

### F-05 [NOTE] 04-03 — state the migration/rollback story for prod-on-branch
Railway runs branch code with `add_enforcement_events` and `add_validation_registration` applied while main lacks both. Both are additive (new table, two nullable/defaulted columns), so main's code remains deployable against the migrated DB if the PR stalls — true, but unstated. Add one sentence to 04-03 Task 3 (or its SUMMARY requirements) recording that both migrations are additive and main stays deployable, so the reviewer of the PR doesn't have to derive it.

### F-06 [NOTE] 04-02 — ENFC-05 wording vs P4-L2 breadth
P4-L2 flags orders that themselves exceed remaining credit even when the company was not yet in blocked state — broader than REQUIREMENTS.md ENFC-05's "while its company was blocked". This is the better behavior (it is the Function's own comparison) and 04-02 documents it, but the phase verifier should not treat the extra events as false positives; consider a one-line REQUIREMENTS.md touch-up in the PR ("or whose order would have been blocked").

### F-07 [NOTE] ENFC-01 parenthetical "(prepay-by-card stays open)" is proven by argument, not by test
Per the binding CONTEXT correction, terms-bearing checkout IS the net-terms path and prepay remains via merchant-side paths; the known v1 limitation (a blocked company's pay-now location also blocks) lives only in RESEARCH Q3. No plan test or live step exercises a pay-now B2B company. Acceptable as user-locked scope; record the limitation in the 04-05 SUMMARY/PR body so it's not rediscovered as a bug.

## Suite/verify audit summary
- All `<automated>` verifies runnable, no watch modes, no full-E2E; sampling ≥2/3 verified tasks per wave.
- Fixture-from-contract-bytes discipline (contract-home #3) correctly mandated in 04-01 (JSON.parse of the two locked serializations, type-preserving overrides).
- Estimates present (60k/65k/55k/40k/45k, confidence low — uncalibrated, informational only); task counts 3/3/3/2/3 within budget.
