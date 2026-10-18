# Phase 3: Credit Controls & Metafield Publishing - Context

**Gathered:** 2026-08-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Merchant-facing credit controls (per-company limit CRUD + bypass toggle on a Companies settings page in the embedded admin) and publishing each company's credit state to `$app` Company metafields — the ONLY server↔Function interface, which Phase 4 reads at checkout. Observe-only default (CRED-04) until a merchant sets a limit. NO checkout Function (Phase 4), NO emails (Phase 5), NO dashboard/billing (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Settings UX Model
- **D-01:** One Companies page: Polaris index table with per-row inline editing — columns: company, exposure, limit (inline editable), utilization, overdue badge, bypass toggle. NO per-company detail pages in v1 (deferred). Matches the guided-setup flow "review balances → set first limit" in one click; ICP has 5–50 companies. Uses the reserved "Companies" nav slot from the Phase 1 UI contract.

### Zero-Limit Semantics
- **D-02:** `limit = 0` is VALID and means "no new net-terms credit — block every net-terms checkout for this company". `limit = null` (never set / cleared) means observe-only. The UI must render the difference unambiguously ("No limit" vs "$0.00"); the metafield contract must carry the distinction (null vs 0). — **Reversibility:** costly — semantics propagate into the Phase 4 Function and merchant expectations; changing after launch changes what $0 means on live stores.

### Bypass Presentation
- **D-03:** Label: **"Bypass enforcement"** (not "Trusted"/"Exempt"). A bypassed company KEEPS showing exposure, utilization, and overdue badge, plus a distinct "Enforcement bypassed" indicator — visibility without enforcement. Same wording flows into Phase 4's enforcement event log ("allowed — enforcement bypassed").

### Metafield Contract
- **D-04:** The `$app` credit metafield set includes a **`data_complete` boolean** — false whenever the company has ANY order in `UNRESOLVED` attribution status — plus `computed_at`. Phase 4 decides fail-open-vs-conservative on incomplete data WITHOUT a contract change. — **Reversibility:** one-way once Phase 4's Function ships to merchant checkouts — the deployed Function parses this contract; removing/renaming fields breaks live checkout validation. Namespace/key naming + versioning strategy: researcher prescribes, planner locks.
- **D-05:** Metafield writes consume `recomputeCompany` output ONLY (it remains the sole writer of exposure/overdue/earliestDueAt — Phase 2 verification carry-forward). Publishing is a projection of the ledger, never a second computation.

### Claude's Discretion
- Everything technical: metafield namespace/key/type choices and versioning, write-scope verification (`write_companies`? metafield-specific? — researcher MUST verify the minimal scope for metafieldsSet on Company and flag the re-consent + version-release consequence), publish-on-change wiring (recompute hook vs outbox), rate-limit handling, settings-form validation, optimistic UI vs reload, test design.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 2 outputs (the data this phase projects)
- `.planning/phases/02-ar-ledger-credit-engine/02-VERIFICATION.md` — carry-forwards: recomputeCompany sole-writer contract, UNRESOLVED ≠ NO_COMPANY semantics, open WINDOWS #3/#8
- `.planning/phases/02-ar-ledger-credit-engine/02-06-SUMMARY.md` — attributionStatus semantics, graphqlJson transport (in ledger.server.ts), resolution ladder
- `.planning/phases/02-ar-ledger-credit-engine/02-08-SUMMARY.md` — live-proven exposure/overdue behavior, prod verification tooling patterns

### Contracts and prior UI
- `.planning/phases/01-foundation-compliance/01-UI-SPEC.md` — design system foundations (Polaris web components, copy tone, reserved "Companies" nav slot) — Phase 3 needs its own UI-SPEC via /gsd-ui-phase 3; this is the inherited base
- `.planning/research/SUMMARY.md` — metafield-sync architecture (backend precomputes → Function compares), reserved `$app` namespace note
- `shopify.app.toml` — api_version 2026-07 pinned; scope changes trigger re-consent + version release (CF-5: CLI rewrites; byte-guard after every CLI call)
- `prisma/schema.prisma` — Company model gains limit/bypass fields (migration required, both local DBs)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/services/ledger.server.ts` — recomputeCompany (hook point for publish-on-change), graphqlJson transport (ALL GraphQL through it — includes error surfacing), Company upsert patterns
- `app/routes/app._index.tsx` / `app.tsx` — embedded page + nav patterns (add "Companies" nav item, replacing the reserved slot)
- `tests/` — creditguard_test isolation, signed-webhook helper, mutation-test conventions
- `scripts/prod-ledger-state.*` — extend for metafield verification (railway ssh pattern)

### Established Patterns
- TDD red-first with mutation-testing where green-first; source-guard tests for banned selections
- Service module conventions (contract-doc headers, $transaction, shop-domain keying)
- Webhook/scheduler must not regress: scheduler gates on Shop.active; publishing must respect the same

### Integration Points
- recomputeCompany → metafield publish (the new seam; keep sole-writer invariant)
- Phase 4 Function will READ the metafield contract defined here — contract doc must live somewhere durable (research: where? plan decides)
- Settings mutations → recompute → publish → (Phase 4 reads)

</code_context>

<specifics>
## Specific Ideas

- Success criterion 3 is a LATENCY promise: "updates its $app credit metafields within seconds" — publish must be synchronous-ish with changes, not batched to the hourly sweep.
- Roadmap note: "the metafield contract must be verifiable on real Company records before Phase 4 starts" — end-of-phase verification should inspect actual metafields on the dev store via GraphQL.

</specifics>

<deferred>
## Deferred Ideas

- Per-company detail pages (history, notes) — v2
- Bulk limit editing / CSV import — v2
- Configurable enforcement thresholds (warn at 80% etc.) — Phase 6+ territory

</deferred>

---

*Phase: 3-Credit Controls & Metafield Publishing*
*Context gathered: 2026-08-19*
