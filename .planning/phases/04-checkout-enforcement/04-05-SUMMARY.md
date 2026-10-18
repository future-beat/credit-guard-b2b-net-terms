---
phase: 04-checkout-enforcement
plan: 05
subsystem: live-verification
tags: [empirical-checks, shopify-functions, validationUpdate, railway, reconciliation, enforcement-events, pull-request]
requires:
  - phase: 04-checkout-enforcement
    provides: "04-01 the credit-guard-validation Function; 04-02 EnforcementEvent + blockedState transitions + leak inference; 04-03 write_validations, registry v6, ensureValidationRegistered, Shop.validationGid; 04-04 the Settings page and updateValidationMessages"
  - phase: 03-credit-controls-metafield-publishing
    provides: "the 03-05 railway-ssh read-back tooling pattern (unauthenticated.admin, JSON-only stdout) and the signed-doorbell drive technique"
provides:
  - "scripts/prod-validation-state.{sh,mjs} — live Validation read-back (EC-4 as booleans), the A4 verdict, and the EC-2 namespace-omission probe"
  - "scripts/prod-enforcement-events.{sh,mjs} — the EnforcementEvent log newest-first, with blockedState beside a derivedBlockedState recomputed from the row's own inputs"
  - "EC-1..EC-5 evidence on a real store, with a real human at a real storefront"
  - "The enable-preservation fix: validationUpdate is not a partial update, so both flags are echoed"
  - "PR #2 — phase-04-checkout-enforcement -> main, OPEN and unmerged"
affects:
  - "Phase 5+: the two read-back scripts are the standing way to ask the platform what the enforcement rule holds"
  - "REQUIREMENTS.md: ENFC-05's literal wording is narrower than the shipped P4-L2 predicate — a rewording is proposed in the PR for the reviewer to accept or reject"
  - "Reconciliation (Phase 2 lineage): WINDOWS #10 — the exhaustion flip starves on a shop's newest unattributable order"
actuals:
  tokens: 61000
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns:
    - "Pre-test a platform write path below the UI before asking a human to exercise it in a browser — a probe that costs one minute can save a whole checkpoint round and stop a misdiagnosis"
    - "Run the app's OWN scheduled code path on demand (vite-node against the real source inside the container) instead of waiting for its cron or hand-rolling the equivalent"
    - "Report a stored boolean beside the same boolean recomputed from its own inputs — the one thing a single column cannot tell you about itself"
key-files:
  created:
    - scripts/prod-validation-state.mjs
    - scripts/prod-validation-state.sh
    - scripts/prod-enforcement-events.mjs
    - scripts/prod-enforcement-events.sh
    - .planning/phases/04-checkout-enforcement/deferred-items.md
  modified:
    - app/services/enforcement.server.ts
    - tests/settings-messages.test.ts
    - README.md
    - .planning/WINDOWS.md
key-decisions:
  - "validationUpdate is NOT a partial update: enable and blockOnFailure are ECHOED from a read taken immediately before the write, so an edit leaves the rule exactly as it found it in either direction"
  - "A failed flag read is a save failure — nothing is written blind, because writing blind is what disabled a live rule"
  - "readValidationFlags is deliberately NOT readValidationConfig: the loader degrades a blip to `unregistered` so the page renders, but here 'the rule is gone' and 'we could not ask' must stay distinct"
  - "The EC-2 Admin-API probe is labelled a PROXY in the tooling itself — the behavioural proof of the Function's own omitted-namespace read is a real blocked checkout, since a block is impossible on a null metafield"
  - "The reconciliation exhaustion-flip starvation was LOGGED, not fixed: pre-existing Phase-2/3 semantics, no enforcement impact (D-04), and fixing it under a live-proof plan is scope creep"
  - "matchesRegistrationDefaults in the read-back tooling is diagnostic only and false by design once a merchant edits their copy — the canonical DEFAULT_MESSAGES home stays enforcement.server.ts"
patterns-established:
  - "Deliberate fixture mutations for a live drive mirror the production action's exact shape (shop-scoped updateMany with the previous value as a CAS guard) and are restored and verified restored"
  - "Ad-hoc in-container probes ship over the same base64/railway-ssh channel as the committed tooling, but stay uncommitted when they mutate — the committed scripts remain read-only by contract (T-04-17)"
requirements-completed: [ENFC-01, ENFC-02, ENFC-03, ENFC-04, ENFC-05, ENFC-06]
coverage:
  - id: D1
    description: "EC-4: the Validation exists live with enabled true, blockOnFailure FALSE, handle credit-guard-validation, config_v1 present, GID matching Shop.validationGid, exactly one of ours"
    requirement: ENFC-04
    verification:
      - kind: e2e
        ref: "scripts/prod-validation-state.sh credit-guard-demo.myshopify.com -> ec4 all true, duplicateOurValidations 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "Research A4 settled: write_validations alone satisfies the Query.validations read"
    verification:
      - kind: e2e
        ref: "prod-validation-state .a4.verdict -> 'write_validations satisfies Query.validations (A4 holds)', accessDenied false"
        status: pass
    human_judgment: false
  - id: D3
    description: "Research A3 settled: inline $app + json metafields are accepted on validation mutations live"
    verification:
      - kind: e2e
        ref: "idempotent echo probe on validationUpdate -> userErrors [], value round-trips byte-identical"
        status: pass
    human_judgment: false
  - id: D4
    description: "ENFC-05: BOTH transition kinds driven on the deployed app from real state flips, seeded deterministically, fixtures restored"
    requirement: ENFC-05
    verification:
      - kind: e2e
        ref: "prod-enforcement-events -> BLOCK_STATE_ENTERED (limit 1500.0000) / BLOCK_STATE_EXITED (limit 5000.0000) / BLOCK_STATE_ENTERED (limit 1500.0000), each with exposure 1874.9500"
        status: pass
      - kind: e2e
        ref: "prod-ledger-state + prod-credit-metafields -> Northwind creditLimit 1500.0000, bypass false, live credit_v1 limit '1500.00'"
        status: pass
    human_judgment: false
  - id: D5
    description: "ENFC-01/EC-1/EC-2: a real over-limit B2B buyer is blocked at a real storefront checkout with the configured message"
    requirement: ENFC-01
    verification:
      - kind: manual
        ref: "human matrix step 1 on credit-guard-demo, 2026-08-20 — Northwind blocked with the over-limit copy"
        status: pass
    human_judgment: true
    rationale: "Only a human in a real storefront session can produce this; no simulation substitutes for it (plan prohibition). A block is also impossible on a null metafield or a currency mismatch, so this single observation carries EC-1 and EC-2 behaviourally."
  - id: D6
    description: "ENFC-03 live: an edited block message reaches the next blocked checkout"
    requirement: ENFC-03
    verification:
      - kind: manual
        ref: "human matrix steps 2-3, 2026-08-20 — edit saved, rule stayed active, re-block showed the human's own wording"
        status: pass
      - kind: e2e
        ref: "prod-validation-state -> config_v1 updatedAt 09:44:20Z, matchesRegistrationDefaults false, enabled true"
        status: pass
    human_judgment: true
    rationale: "The copy a buyer actually reads at checkout is observable only in a browser; the metafield read-back corroborates it but cannot see the checkout."
  - id: D7
    description: "ENFC-04/EC-5: observe-only, bypassed-overdue and D2C checkouts complete with zero visible difference"
    requirement: ENFC-04
    verification:
      - kind: manual
        ref: "human matrix steps 4-6, 2026-08-20 — #1009 (Snowdevil), #1010 (Acme), #1012 (D2C) all completed normally"
        status: pass
    human_judgment: true
    rationale: "The absence of a visible difference at checkout is a judgment only a human at that checkout can make."
  - id: D8
    description: "EC-3 + ENFC-06: a draft order for a blocked company is blocked in admin; completing it with 'Ignore all checkout rules' produces an order flagged BYPASSED_ORDER with channel shopify_draft_order and the pre-order snapshot — and still counted"
    requirement: ENFC-06
    verification:
      - kind: manual
        ref: "human matrix steps 7-8, 2026-08-20 — draft blocked, then leaked as #1011"
        status: pass
      - kind: e2e
        ref: "prod-enforcement-events -> BYPASSED_ORDER orderGid 7080326758633, channel shopify_draft_order, amount 49.9500, snapshot exposure 1874.9500 / limit 1500.0000 / overdue false / bypass false"
        status: pass
      - kind: e2e
        ref: "prod-ledger-state -> Northwind exposure 1874.95 -> 1924.90 (+49.95, the leaked order counts)"
        status: pass
    human_judgment: false
  - id: D9
    description: "The enable-preservation regression: a copy edit no longer disables the merchant's rule, in either direction"
    requirement: ENFC-03
    verification:
      - kind: unit
        ref: "tests/settings-messages.test.ts#never DISABLES an enabled rule on a copy edit — the live 04-05 regression"
        status: pass
      - kind: unit
        ref: "tests/settings-messages.test.ts#never re-enables a merchant-disabled rule on a copy edit"
        status: pass
      - kind: unit
        ref: "tests/settings-messages.test.ts#writes NOTHING when the current flags cannot be read"
        status: pass
      - kind: e2e
        ref: "live echo probe post-deploy -> enabled stays true; human step 2 edit at 09:44:20Z left the rule active"
        status: pass
    human_judgment: false
  - id: D10
    description: "The phase ends with an open, reviewable PR to main and main untouched by Phase 4 source"
    verification:
      - kind: other
        ref: "gh pr view -> https://github.com/future-beat/credit-guard/pull/2, state OPEN, base main, head phase-04-checkout-enforcement"
        status: pass
    human_judgment: false
metrics:
  duration: "5h 47m elapsed (~1h 45m executor time; ~4h parked at the human checkpoint)"
  tasks: 3
  files: 9
  completed: 2026-08-20
status: complete
---

# Phase 4 Plan 05: Live Proof and PR Summary

**Every ENFC requirement demonstrated against the deployed registry version on a real store — a real over-limit buyer blocked with the merchant's own edited wording, three allowed checkouts untouched, a real draft-order leak flagged and still counted — and one severe defect caught below the UI on the way: a message edit was silently switching the merchant's enforcement rule off.**

## Performance

- **Duration:** 5h 47m elapsed (~1h 45m executor time; ~4h parked at the human checkpoint)
- **Started:** 2026-08-20T05:05:00Z
- **Completed:** 2026-08-20T10:52:00Z
- **Tasks:** 3
- **Files modified:** 9 (5 created, 4 modified)
- **Suite:** 490 green across 21 files (floor was 485/21; +5 net new specs, zero regressions)

## The defect this plan exists to have caught

**A merchant editing their block message was silently switching their own checkout enforcement OFF.**

`validationUpdate` is **not** a partial update. An input carrying only `metafields` — exactly what 04-04 shipped — returns `userErrors: []` and re-defaults the flags it was not told about. Measured on the live store below the UI:

| When | What | `enabled` |
|---|---|---|
| 05:16Z | `prod-validation-state` read-back | `true` |
| 05:23Z | one metafields-only `validationUpdate` (the deployed shape) | — |
| 05:24Z | `prod-validation-state` read-back | **`false`** |

04-04 omitted `enable` deliberately — *"writing it would let a copy edit silently switch a merchant-disabled rule back on"*. The intent is right and is preserved. Its premise, that an omitted field is left alone, is not how the platform behaves.

The fix inverts the mechanism: read the live flags immediately before the write and **echo** them, so an edit leaves the rule exactly as it found it in either direction — stated rather than assumed. A failed flag read is now a save failure; nothing is written blind, because writing blind is precisely what disabled a live rule.

**Why it was found at all:** the plan's checkpoint asked a human to edit a message in a browser. Rather than let the browser discover whether that write path worked, the update was pre-tested below the UI with an idempotent echo (the same bytes written back). That probe cost about a minute. Without it, the human's step 3 would have reported "no block" and the investigation would have gone straight to EC-2 and the metafield — the wrong contingency entirely, on a store whose rule had been silently turned off by step 2.

**Proven fixed live, by the merchant, in a browser:** the human's step-2 edit landed at 09:44:20Z, after the fix deployed, through the real Settings route. The rule read back `enabled: true` afterwards, and step 3 blocked again with the human's own wording.

## The human checkout matrix (credit-guard-demo, 2026-08-20)

Reported by the user, verbatim outcome per step:

| Step | What | Result |
|---|---|---|
| 0 | Preflight | Fixtures confirmed; rule listed and ON |
| 1 | **BLOCK** — Northwind storefront checkout | **Blocked** with the configured over-limit message |
| 2 | Edit message on the Settings page | Saved; **rule stayed active** (the fix held in the browser) |
| 3 | **RE-BLOCK** | Blocked again, now showing the user's own text |
| 4 | Snowdevil (observe-only) | Completed normally — order **#1009** |
| 5 | Acme (overdue + bypass) | Completed normally — order **#1010** |
| 6 | D2C, no company | Completed normally — order **#1012** |
| 7 | Draft order for Northwind | **Blocked** in admin |
| 8 | Draft + "Ignore all checkout rules" | Order created — **#1011** |
| 9 | Function-run input JSON (optional) | Not captured — logged as WINDOWS #11 |

Creation order was #1009, #1010, **#1011**, #1012 — the leak preceded the D2C order, not the other way round.

## Evidence closure

### The leak (ENFC-06)

```json
{ "kind": "BYPASSED_ORDER",
  "companyName": "Northwind Trading",
  "orderGid": "gid://shopify/Order/7080326758633",   // #1011
  "amount": "49.9500",
  "channel": "shopify_draft_order",
  "exposure": "1874.9500", "limit": "1500.0000",     // PRE-order snapshot
  "overdue": false, "bypass": false }
```

Exactly one row (the dedupe held), the channel is the draft-order channel, and the snapshot is Northwind's blocked pre-order state — `1874.95`, not the post-order `1924.90`, which is what makes it the D4-01 comparison rather than the order counted against itself.

**And it still counts** (ENFC-06's first half): Northwind exposure `1874.95 → 1924.90`, exactly +49.95.

### Ledger reconciliation of the matrix orders

| Order | Company | Status | Effect |
|---|---|---|---|
| #1009 | Snowdevil | ATTRIBUTED | exposure `0.00 → 712.45`, fresh `credit_v1` published |
| #1010 | Acme Supply | ATTRIBUTED | exposure `3229.95 → 4015.90` |
| #1011 | Northwind Trading | ATTRIBUTED | exposure `1874.95 → 1924.90` + the BYPASSED_ORDER row |
| #1012 | — (none) | UNRESOLVED | contributes to no company's exposure ✓ |

All three live `credit_v1` payloads agree with their database rows field for field (`allMatch: true`), `dirtyPublishes: 0`.

**The four orders arrived UNRESOLVED and needed the healer.** The `orders/create` deliveries carried no company hint, so ingest took rung 3 and persisted them unattributed — documented behaviour, healed by the daily reconciliation sweep. That sweep is cron'd at 03:30 and the orders were created between 09:46 and 10:23, so rather than wait ~17h the app's **own** `reconcileShop` was invoked on demand via `vite-node` against the real source inside the container. It attributed 3 of 4 and the leak fired from the real code path. Nothing was hand-attributed.

### EC-4 / A3 / A4 / EC-2

- **EC-4:** `enabled: true`, **`blockOnFailure: false`**, handle `credit-guard-validation`, GID matches `Shop.validationGid`, `config_v1` live and parseable, `duplicateOurValidations: 1` — the T-04-12 double-create 04-03 flagged did not occur.
- **A4 settled — it holds.** `Query.validations` answered under `write_validations` alone. No read-scope lockstep cycle, no second re-consent.
- **A3 settled — inline `$app` + `json` metafields are accepted** on validation mutations live (`userErrors: []`, value round-trips byte-identical). Which branch won on the original *create* is recorded only in Sentry, for which this executor holds no read credential; the end state — the config metafield live on the Validation — is what the phase needed and it is proven.
- **EC-2 green.** The omitted-namespace `metafield(key: "credit_v1")` read resolves to the `$app` container for all three companies, payloads byte-identical to the explicit read. The tooling labels this a *proxy* on the Admin schema; the behavioural proof is step 1's block, which is impossible on a null metafield. **No contingency was needed** — the input query still omits the namespace, unchanged.

### ENFC-05 transitions

```
05:20:37Z  BLOCK_STATE_ENTERED   exposure 1874.9500  limit 1500.0000   (seed)
05:21:50Z  BLOCK_STATE_EXITED    exposure 1874.9500  limit 5000.0000
05:22:33Z  BLOCK_STATE_ENTERED   exposure 1874.9500  limit 1500.0000   (restore)
```

Each snapshot carries the value that drove that flip. Two ENTERED rows coexist, which also demonstrates live that the `@@unique([shop, kind, orderGid])` index does not collide on NULL-orderGid transition rows.

**F-03's revision was vindicated empirically.** The pre-drive read showed Northwind's stored `blockedState: false` while its own inputs derived `true`, with `eventCount: 0` — nothing had recomputed that company since the migration default. Had the drive assumed the stored state, its first leg would have been an EXIT from a state never entered, and no ENTERED row would exist. Seeding with a genuine signed doorbell first, and asserting ENTERED before driving any exit, is what made the evidence real. The `derivedBlockedState` / `blockedStateAgrees` fields added to `prod-enforcement-events` earned their place on their first run.

**Fixtures restored and verified restored:** Northwind `creditLimit 1500.0000`, `bypassEnforcement false`, live `credit_v1` limit `"1500.00"`; Acme and Snowdevil untouched by the drive.

## Task Commits

1. **Task 1: read-back tooling + EC-4 + the transition drive** — `a400544` (feat)
2. **Deviation fix (found during Task 1's A3 probe)** — `19b5946` (fix)
3. **Task 3: evidence closure + PR** — this SUMMARY's `docs(04-05)` commit; the PR itself is a platform action

## Files Created/Modified

- `scripts/prod-validation-state.{sh,mjs}` (created) — the live Validation read-back: `ec4` as booleans, the `a4` verdict, the `ec2Proxy` namespace probe, duplicate detection, and the DB↔platform GID diff.
- `scripts/prod-enforcement-events.{sh,mjs}` (created) — the event log newest-first with every column, plus each company's `blockedState` beside a `derivedBlockedState` recomputed from that row's own inputs through P4-L1.
- `app/services/enforcement.server.ts` (modified) — `readValidationFlags`, `blockOnFailure` in the read query, the echoed update input.
- `tests/settings-messages.test.ts` (modified) — the 04-04 contract test kept its name and lost its assumption; four specs added around it (32 → 37).
- `README.md` (modified) — usage and the `ec4` / `a4` / `ec2Proxy` field guide.
- `.planning/phases/04-checkout-enforcement/deferred-items.md`, `.planning/WINDOWS.md` (#10, #11) — the two logged-not-fixed findings.

## Decisions Made

- **Echo the flags, do not omit them.** `enable` and `blockOnFailure` are both written from a read taken immediately before the update. Echoing `blockOnFailure` rather than pinning `false` keeps the app from moving the ENFC-04 flag on a copy edit in either direction; the literal `false` is pinned exactly once, at registration, where the app owns that decision.
- **A read failure is a save failure.** `readValidationFlags` is deliberately not `readValidationConfig`: the loader degrades a transport blip to `unregistered` so the settings page still renders, but here "the rule is gone" (actionable: re-open the app) and "we could not ask" (not a licence to write anyway) must stay distinct.
- **The EC-2 probe is labelled a proxy in the tooling itself.** It queries a different schema than the Function does. Calling it proof would have been the comfortable lie; the block is the proof.
- **Run the app's own healer rather than wait or improvise.** `reconcileShop` via `vite-node` against the container's real source. Not a re-implementation, not a hand-attribution, not a 17-hour wait.
- **Log the reconciliation starvation, do not fix it here.** Pre-existing Phase-2/3 semantics, no enforcement impact, and a live-proof plan is the wrong place to change reconciliation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `validationUpdate` re-defaults omitted flags: a copy edit disabled the merchant's rule**

- **Found during:** Task 1, in an A3-on-update probe run before parking at the checkpoint (04-04 carry-forward: "A3-on-update untested live").
- **Issue:** An input carrying only `metafields` returned `userErrors: []` and set `enabled` from `true` to `false` on the live store. Every merchant message edit would have turned that merchant's checkout enforcement off, with the settings page then honestly reporting `disabled` and nothing connecting it to the edit. ENFC-01/02 would have lasted until the merchant's first rewording.
- **Fix:** read the live flags immediately before the write and echo them (`enable`, `blockOnFailure`); a failed read writes nothing and reports `save-failed`.
- **Files modified:** `app/services/enforcement.server.ts`, `tests/settings-messages.test.ts`
- **Verification:** 5 net new specs (490 green); redeployed; live restore + echo probe → `enabled` stays `true`; and the human's own browser edit at 09:44:20Z left the rule active.
- **Commit:** `19b5946`

**2. [Rule 3 - Blocking] The matrix orders needed the daily healer before the leak could be proven**

- **Found during:** Task 3a — `prod-enforcement-events` showed no `BYPASSED_ORDER` and no exposure movement.
- **Issue:** All four orders were `UNRESOLVED`: the `orders/create` payloads carried no company hint, so ingest took rung 3 as designed. Leak inference fires on the transition *into* ATTRIBUTED, so it had not run. The healer is cron'd at 03:30, ~17h away.
- **Fix:** invoked the app's own exported `reconcileShop` on demand inside the container via `vite-node`. Attribution healed 3 of 4 (#1012 has no company on any edge) and the `BYPASSED_ORDER` fired from the real code path.
- **Files modified:** none — this was an invocation, not a change.
- **Verification:** `attributed: 3`; BYPASSED_ORDER present with the correct channel, amount and pre-order snapshot; exposures moved by exactly the order amounts.
- **Commit:** n/a

---

**Total deviations:** 2 (1 bug — severe, 1 blocking-invocation).
**Impact on plan:** The bug fix is the most valuable output of the phase; it is additive, keeps 04-04's stated intent, and every prior import path is unchanged. Neither deviation altered the plan's scope.

## Issues Encountered

- **Northwind's stored `blockedState` disagreed with its own inputs** (`false` while derived `true`, `eventCount: 0`) before the drive — exactly the condition F-03's revision anticipated. Not a defect: nothing had recomputed the company since the migration default, and the seeding doorbell converged it.
- **`read_customers` is absent by design**, so the executor could not enumerate company contacts for the checkpoint preflight; the platform refused the field. Reported to the human as a known gap rather than worked around. The app storing no customer PII is a Phase-2 stance the platform confirmed here.
- **All three company locations report `catalogsCount: 0`** — flagged to the human as a possible "buyer sees no products" blocker before the matrix. It did not materialise; all three storefront checkouts ran.
- **`gsd-tools windows append` refused to write** (`Ledger entry 3 has invalid kind: "gap"` — a pre-existing entry the tool's schema rejects). Per the best-effort contract this did not block; both entries were appended by hand in the ledger's own table + JSON-mirror format.
- **Scratch database** `creditguard_test_0405` was created, migrated, used for every run and dropped at close. `creditguard_dev` and `creditguard_test` were never touched.

## Known Stubs

None. No placeholder values, no unwired paths, no skipped tests.

Two items are logged as open in `.planning/WINDOWS.md` and `deferred-items.md` — a pre-existing reconciliation behaviour (#10) and one optional observation the human skipped (#11). Neither is a stub in this plan's code, and neither affects enforcement.

## Threat Notes

- **T-04-16 (block misfiring on allowed checkouts):** mitigated and proven — steps 4, 5 and 6 all completed normally on the real storefront.
- **T-04-17 (verification tooling mutating prod state):** the two committed scripts are read-only. The deliberate limit drive mirrored the production action's shape (shop-scoped `updateMany` with the previous value as a CAS guard) and was restored and verified restored. Two further deliberate mutations happened and are recorded honestly: the A3 probe (which caused the regression above) and the restore that undid it.
- **T-04-18 (tokens/PII in output):** every Admin call rides `unauthenticated.admin`; no access token is read, printed or stored by either script. The event log carries company names, GIDs and money only.
- **T-04-SC:** no new packages.

## Next Phase Readiness

- **PR is open and unmerged:** https://github.com/future-beat/credit-guard/pull/2 (base `main`, head `phase-04-checkout-enforcement`, 26 commits, `MERGEABLE`). The merge is the developer's decision after review; nothing here touched `main`.
- **The PR body carries the two argue-not-test items** the reviewer must weigh: ENFC-01's "prepay-by-card stays open" parenthetical (with the documented v1 limitation that a blocked company's pay-now location also blocks — 04-RESEARCH Q3, not solved), and the P4-L2 leak predicate being deliberately broader than ENFC-05's literal wording, with a proposed rewording.
- **Live state left canonical:** Northwind over limit and blocked, Acme overdue + bypassed, Snowdevil observe-only; rule enabled with the merchant's edited copy; `dirtyPublishes: 0`.
- **One open flag for whoever picks up reconciliation:** WINDOWS #10 pins `data_complete: false` on this shop until a newer order arrives. It cannot affect a checkout decision — the Function deliberately does not read that field (D-04) — which is a decision that paid for itself live today.

---
*Phase: 04-checkout-enforcement*
*Completed: 2026-08-20*

## Self-Check: PASSED

- All five created files present on disk (`scripts/prod-validation-state.{mjs,sh}`, `scripts/prod-enforcement-events.{mjs,sh}`, `deferred-items.md`).
- Both task commits reachable in git (`a400544`, `19b5946`).
- Plan `<verification>` re-run at close-out: `prod-validation-state | grep '"blockOnFailure": false'` PASS; `prod-enforcement-events` carries `BLOCK_STATE_ENTERED`, `BLOCK_STATE_EXITED` **and** `BYPASSED_ORDER`; `npm test` 490 passed across 21 files; `npm run lint` and `npm run typecheck` clean; `gh pr view` reports `"state":"OPEN"` on base `main`.
