# Phase 5 Plan Check — Payment Reminders

**Checked:** 2026-08-20 against commit f41f58c
**Checker basis:** goal-backward from "chased at the right moments, exactly once per moment, never after paying" + REMD-01..03 (REMD-03 as reworded per D5-01), verified against 05-RESEARCH.md, 05-CONTEXT.md, and real code on main (scheduler.server.ts, ledger.server.ts, prisma/schema.prisma, shopify.app.toml, vitest.config.ts, tests/, scripts/).

**Verdict: ISSUES FOUND — 2 blockers, 2 warnings, 2 info.**

| Plan | Verdict |
|------|---------|
| 05-01 | PASS |
| 05-02 | ISSUES (F-04, warning) |
| 05-03 | ISSUES (F-01 blocker, F-02 blocker shared with 05-05, F-03 warning, F-06 info) |
| 05-04 | PASS |
| 05-05 | ISSUES (F-02 blocker, shared with 05-03) |

## Verified-good foundations (no findings)

- **Requirement coverage:** REMD-01 (05-01/03/05), REMD-02 (05-02/05), REMD-03 (05-01/02/05) — all three requirement IDs appear in plan frontmatter and have concrete tasks. REMD-03 tested against its REWORDED text in REQUIREMENTS.md:44 — 05-02 Task 4 item 1 and 05-05 LP-5 verify exactly the reworded criterion (merchant sender/branding via Shopify infra + canonical pay-now link, no customer email in app).
- **Integration claims are real:** `SWEEP_SCHEDULE` registry + "Phase 5 appends its reminder sweep here with its OWN lease name" reservation exists at scheduler.server.ts:334-349; `forEachActiveShop` (CF-3) at :109; `runExclusive` rule-2 comment at :38-43 quoted accurately by the plans. `graphqlJson` exists (ledger.server.ts:201). `LedgerSchedule` has `completedAt`, `@@unique([shop, scheduleGid])`, `@@index([shop, dueAt])` (schema:169-184). `completedAt` is populated by the orders/paid → `refetchOrderAndRecompute` → schedule upsert path (ledger.server.ts:753, 963, 1044) — the LP-4/stop-on-payment dependency is real, and the E3 platform-refusal backstop for a lagging webhook is explicitly planned (05-02 E3 → 05-03 "E3-calibrated benign refusal").
- **Paid-before-any-touchpoint:** eligibility query filters `completedAt: null` locally; a paid schedule never enters derivation. The refetch→send residual window is acknowledged as "shrinks to mutation latency" (05-03 truth 5) plus the E3 backstop — correct and honest.
- **Deploy-overlap / replicas:** correctness rests on the unique-constraint claim, not the lease (scheduler rule 2 restated in 05-01/05-03/05-05); no silent single-replica assumption — 05-05 explicitly tolerates live cron ticks during the drive.
- **E2 escalation wiring:** 05-02 has a binding escalation rule with three documented options; 05-03 (Wave 3) carries a precondition that HALTS on DECISION ESCALATED; 05-04's copy degrades gracefully ("due date and once overdue" wording if escalated). Due−3 is not stranded in code — 05-03 simply doesn't execute as written until the decision resolves.
- **Scope/release mechanics:** current TOML string verified (`read_orders,read_all_orders,read_payment_terms,read_companies,write_companies,write_validations` — shopify.app.toml:50); plans append `write_orders` correctly across all four homes + Railway in one commit, `--skip-deploys` so scope+code release together in 05-01 Task 3; re-consent is user_setup relayed at the Wave 1→2 boundary per CONTEXT; "never assert on sessionScopes literals" (04 A4 lesson) is carried. PRIVACY.md §2 rewrite covers all seven scopes with real whys for all three writes and keeps §3's no-customer-PII claim true.
- **Process:** no new npm packages anywhere; CF-5 byte-guard on every CLI call; suite floor 490/21 stated in every executing plan; STATE/ROADMAP executor prohibition in every plan; PR-only ending in 05-05; `TEST_DATABASE_URL` override confirmed in vitest.config.ts:17.
- **Scope sanity:** 2–3 tasks per plan, files_modified 2–12, estimates 40–60k tokens (confidence: low — uncalibrated, treat as rough). Within budget; advisory only.
- **Dependency graph:** 01 → 02 → {03, 04} → 05; acyclic, waves consistent, 03/04 file ownership disjoint by explicit rule.

---

## F-01 — BLOCKER — 05-03: bounded retry of ambiguous send failures can double-email (violates "exactly once per moment")

**Quote (05-03 truths):** "FAILED rows retry on later sweeps while attempts < 3, then flip DEAD … a crash can eat one reminder (at-most-once is the correct failure direction), never duplicate one."
**Quote (05-03 Task 2 behavior):** "refetch transport failure -> FAILED (not SENT, not thrown), attempts incremented" and "retry bounds: FAILED row re-claims on a later sweep while attempts < 3".

**Defect:** The plan treats every non-success as one retriable FAILED class. But send failures split into two categories with opposite safe handling:
1. **Definite refusal** — a parsed response with `success:false`/userErrors. Shopify did not send. Retry is safe.
2. **Ambiguous transport failure** — timeout/socket error/5xx on the `paymentReminderSend` call itself, where Shopify may have accepted and sent before the response was lost. Retrying this is a second email to a real buyer — exactly the "chased twice" uninstall scenario the phase exists to prevent.

The plan retries both. Note the asymmetry it already half-sees: a crash between claim and markSent leaves a `SENDING` row that is (implicitly, correctly) never retried — but the same "maybe it sent" ambiguity via a transport error gets retried. Also unstated: that orphaned `SENDING` rows are terminal (no re-claim path exists for them — confirm this is intentional and say so).

**Fix:** In 05-03 Task 2 behavior + truths: (a) only definite refusals (parsed `success:false` response) are retriable FAILED; (b) transport-level failure of SEND_REMINDER_MUTATION (no parseable response) marks the row terminal — e.g. `DEAD` with a distinct reason, or a `SENT_UNCONFIRMED` status — never re-claimed, Sentry-tagged; (c) refetch transport failures remain retriable (nothing was sent — safe); (d) state explicitly that orphaned `SENDING` rows are terminal by design (research Pattern 2's "harmless drop"). Add one spec per category.

## F-02 — BLOCKER — 05-03 + 05-05: SUPPRESSED_STALE vs SUPPRESSED_PREEXISTING precedence undefined; LP-2's expected status is wrong as written

**Quote (05-03 Task 1 behavior):** "watermark: any touchpoint whose instant is before enabledAt classifies SUPPRESSED_PREEXISTING, including the most severe one".
**Quote (05-05 LP-2):** "asserts exactly ONE new SENT row with touchpoint DUE for that schedule and a SUPPRESSED_STALE DUE_SOON sibling".

**Defect:** Trace LP-2's own fixture: the human enables reminders (watermark = T), then creates a "Due on receipt" order at T+minutes. Its `dueAt ≈ T+minutes`, so DUE_SOON's instant is `dueAt − 72h ≈ T − 72h` — **before the watermark**. By 05-03's rule that touchpoint classifies SUPPRESSED_PREEXISTING; by 05-05's assertion it must be SUPPRESSED_STALE. Both conditions (pre-watermark AND less-severe-than-eligible) hold simultaneously and no plan defines which classification wins. As written, either the unit matrix or the LP-2 live assertion fails — the live drive checkpoint will red on a status-name mismatch even though behavior (no email) is correct. Same ambiguity affects the 05-01 tracer's "threshold crossed before watermark" path once 05-03 expands it.

**Fix:** Define precedence explicitly in 05-03 Task 1 (recommend: watermark check first — a pre-watermark instant is always SUPPRESSED_PREEXISTING regardless of severity ranking; STALE applies only to post-watermark crossed-but-outranked touchpoints), add a both-conditions unit spec, and correct 05-05 LP-2 to expect `SUPPRESSED_PREEXISTING` for the DUE_SOON sibling (or assert `SUPPRESSED_*` and record the exact status as evidence). Either way the two plans must agree.

## F-03 — WARNING — 05-03: FAILED re-claim is not specified as atomic

**Quote:** "FAILED row re-claims on a later sweep while attempts < 3".

**Defect:** The initial claim's atomicity comes from the unique-constraint INSERT. A *re*-claim is an UPDATE on an existing row — no constraint protects it. 05-05 deliberately runs on-demand sweeps concurrently with live cron ("its ticks must be tolerated"); two passes reading the same FAILED row can both flip it to SENDING and both send. The claim-race spec in Task 2 covers only the INSERT path.

**Fix:** Specify the re-claim as a conditional atomic update — `updateMany({ where: { id, status: 'FAILED', attempts: { lt: 3 } }, data: { status: 'SENDING', attempts: { increment: 1 } } })` and proceed only when affected-count === 1; add a concurrent re-claim spec mirroring the insert-race spec. (Interacts with F-01: after that fix, only definite-refusal FAILED rows reach this path.)

## F-04 — WARNING — 05-02: pre-due pay-now pass criterion undefined; E2's link is never clicked

**Quote (Task 4 item 2):** "did a second reminder email arrive for the Net-60 order (due >3 days out)? Yes/no, and does it look identical in template to E1's?"

**Defect:** Research E1 asks for click-through "pre-due and overdue"; the plan clicks only E1 (past-due). For a net-terms order 60 days out, the pay page may legitimately show a not-yet-payable state — without a defined pass criterion, the human checkpoint can't distinguish "REMD-02 satisfied" from "link broken", and 05-03's green-light for DUE_SOON rests partly on this.

**Fix:** Add to Task 4 item 2: click E2's pay-now link too; PASS = the link resolves to a page identifying the invoice where payment is or will be possible ("payment not due yet" on a valid invoice page is a PASS — record the observed state verbatim as evidence).

## F-05 — INFO — ROADMAP.md phase-list one-liner is stale

Line 20 still reads "…pay-now links from an authenticated domain", contradicting the D5-01 rewording applied to REMD-03 and the Phase-5 detail section (which were correctly updated in f41f58c). Executors are prohibited from touching ROADMAP.md, so this must be fixed at the planning level, not left for execution.

## F-06 — INFO — 05-03: cap fairness needs a deterministic eligibility order

The 50-send cap defers overflow; starvation is structurally unlikely (SENT rows remove prior winners from eligibility), but the eligibility query specifies no ordering, so DEFERRED handling is nondeterministic across sweeps. Recommend `orderBy: { dueAt: 'asc' }` (oldest obligations first) stated in Task 2, matching the deterministic-order precedent in publishBackstop.

---

## Required revision

- 05-03: F-01 (send-failure taxonomy + terminal SENDING statement + specs), F-02 (classification precedence + spec), F-03 (atomic re-claim + spec), F-06 (one line: ordering).
- 05-05: F-02 (LP-2 expected status).
- 05-02: F-04 (E2 click + pass criterion).
- Planner-level: F-05 (ROADMAP one-liner).

No structural changes to waves, dependencies, scope mechanics, or task shape are needed — all findings are semantic tightenings within existing tasks. One revision pass should clear this.
