---
quick_id: 260904-dty
phase: quick-260904-dty
plan: 01
type: quick
status: planned
created: 2026-09-04
wave: 1
depends_on: []
autonomous: true
requirements: [LNCH-03]
files_modified:
  - .planning/STATE.md
  - .planning/REQUIREMENTS.md
  - .planning/WINDOWS.md
  - CHANGELOG.md
  - README.md
  - .claude/CLAUDE.md
  - .planning/quick/260904-dty-record-app-store-approval-and-public-lis/260904-dty-SUMMARY.md

estimate:
  tokens: 35000
  raw_tokens: 35000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Every top-level project record (STATE, REQUIREMENTS, CHANGELOG, README, CLAUDE.md) says v1.0.0 is approved and listed on the Shopify App Store as of 2026-09-04 and carries the listing URL https://apps.shopify.com/credit-guard-b2b-net-terms"
    - "No top-level record still describes the app as pending, submitted-and-waiting, or under review (historical mentions inside .planning/phases/ are untouched)"
    - "WINDOWS #23 stays OPEN and its note says why it is still open after approval: the repo crop of S4 is 600×290, the App Store needs 1600×900, so a retake precedes the swap"
    - "The WINDOWS ledger still parses with the shipped tool and reports 9 open / 1 waived / 18 fixed / 28 total"
    - "STATE.md frontmatter is valid YAML with status listed, 6/6 phases and 35/35 plans, and the body no longer describes Phase 6 as in progress"
    - "Nothing under shopify.app.toml, app/, extensions/, tests/, prisma/ or listing/ changed"
  artifacts:
    - ".planning/STATE.md"
    - ".planning/REQUIREMENTS.md"
    - ".planning/WINDOWS.md"
    - "CHANGELOG.md"
    - "README.md"
    - ".claude/CLAUDE.md"
  key_links:
    - "WINDOWS.md is regenerated through parseLedger/renderLedger from ~/.claude/gsd-core/bin/lib/broken-windows.cjs (round-trip is byte-identical today) so the frontmatter counts and the JSON block cannot drift from the table"
    - "STATE.md Quick Tasks row links to this task's SUMMARY.md path"
---

<objective>
Record, in every top-level project record, that Credit Guard: B2B Net Terms v1.0.0
(build f1032f0, git tag v1.0.0; submitted 2026-08-24) was approved and is live on the
Shopify App Store at https://apps.shopify.com/credit-guard-b2b-net-terms as of
2026-09-04 (App Store visibility currently "limited"). Docs-only; one commit.

Purpose: `.planning/` is the project's memory. STATE.md, REQUIREMENTS.md (LNCH-03),
CHANGELOG.md, README.md and `.claude/CLAUDE.md` all still describe the app as
pending review, and STATE.md's frontmatter is stale (5/6 phases, 27 plans, a
malformed line). WINDOWS #23 (customer PII visible in screenshot 4 on the live
listing) said "replace immediately on approval" — approval has happened, but the
repo crop `listing/screenshots/S4.png` is 600×290 and the App Store requires
1600×900, so the entry must say a retake comes first rather than imply the swap is
one upload away.

Output: six edited records + this task's SUMMARY.md, in a single commit
`docs(launch): record App Store approval and public listing (2026-09-04)`.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/WINDOWS.md
@.claude/CLAUDE.md

Facts established at plan time (do not re-derive):
- `git tag v1.0.0` → f1032f0. `listing/screenshots/S4.png` is 600 x 290 (sips-verified).
- `.planning/WINDOWS.md` today: 28 entries, open 9 (#11 #18 #19 #23 #24 #25 #26 #27 #28), waived 1 (#4), fixed 18; `last_updated: 2026-08-24T09:00:00.000Z`. `renderLedger(parseLedger(raw)) === raw` is TRUE on the current file, so regenerating through the module produces no spurious diff.
- `~/.claude/gsd-core/bin/lib/broken-windows.cjs` exports `parseLedger(raw: string) -> ledger` and `renderLedger(ledger) -> string`. A ledger is `{ schema_version, open_count, waived_count, fixed_count, total_count, last_updated, entries[] }`; each entry has `id, kind, phase, file, line, description, status, reason, recorded_at, resolved_at`. `renderLedger` writes the counts it is given (it does not recount) and rejects nothing itself; `parseLedger` validates kind/status on read. A 4-backtick run anywhere in a text field corrupts the JSON fence, and a pipe character would break the markdown table row.
- Pre-existing hits of the pending-review vocabulary outside `.planning/phases/`: `.planning/STATE.md:7`, `.planning/REQUIREMENTS.md:124`, `.claude/CLAUDE.md:20` (the hyphenated status token) and README.md:12, CHANGELOG.md:5, STATE.md:11/42/54 (prose "submitted"). README's Launch runbook (lines ~903-935) has no pending-review phrasing; only the intro sentence at line 12 does.
- `.claude/CLAUDE.md` lines 322-325 are stale twice over: they say "27 entries, 8 open" (ledger has 28 / 9 — #28 was appended 2026-08-24T08:45Z) and claim "#23 still cites `screenshots/S4.png`" (commit 30ab08f already repointed the entry to `listing/screenshots/S4.png`).
- STATE.md Quick Tasks table exists at lines 95-100; STATE.md Session Continuity block (lines 102-106) still points at Phase 3 and is stale.
- Constraint: do NOT touch `shopify.app.toml`, `app/`, `extensions/`, `tests/`, `prisma/`, `listing/`. Historical mentions under `.planning/phases/` must stay as they are.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Bring STATE.md and REQUIREMENTS.md to "listed"</name>
  <files>.planning/STATE.md, .planning/REQUIREMENTS.md</files>
  <action>
Use scoped replacements (Edit tool or an equivalent line-targeted sed); never rewrite either file wholesale.

STATE.md frontmatter (lines 1-17):
- Line 7 `status:` → `status: listed`.
- Delete line 8 outright — it is the stray parenthesised must-haves residue ending in `next: plan-phase 6"`, not a `key: value` pair, and breaks YAML parsing.
- `last_updated` → the run's current UTC time from `date -u +"%Y-%m-%dT%H:%M:%S.000Z"`, quoted as today.
- `last_activity: 2026-09-04`; `last_activity_desc: v1.0.0 approved and listed on the Shopify App Store (https://apps.shopify.com/credit-guard-b2b-net-terms); post-launch backlog = open WINDOWS items`.
- `progress:` → `completed_phases: 6`, `total_plans: 35`, `completed_plans: 35` (`total_phases: 6` unchanged). 35 is the sum of the By Phase table (4+8+5+5+5+8) and matches the velocity line.

STATE.md body:
- Line 26 `**Current focus:**` → "Post-launch. v1.0.0 approved and listed on the Shopify App Store 2026-09-04 — https://apps.shopify.com/credit-guard-b2b-net-terms (visibility currently limited). Backlog is the open WINDOWS items (#11, #18, #19, #23, #24, #25, #26, #27, #28); #23 (S4 retake at 1600×900, then swap) is first."
- Replace the whole `## Current Position` block (lines 30-35) with five lines: Phase: 6 of 6 (Dashboard, Onboarding & Launch) — COMPLETE; all six phases complete and verified. Plan: 35 of 35 complete. Status: v1.0.0 (build f1032f0, tag v1.0.0) submitted 2026-08-24, approved and listed 2026-09-04 — https://apps.shopify.com/credit-guard-b2b-net-terms. Last activity: 2026-09-04 — developer confirmed approval and the live listing; records updated (quick 260904-dty). Progress bar: ten filled blocks, `100% (6 of 6 phases complete)`.
- Line 42 velocity bullet: extend to "… → 2026-08-24 (submitted) → 2026-09-04 (approved and listed) — 11 days to submission, 11 days in review".
- Line 54 By Phase row `06-dashboard-onboarding-launch` notes cell → "dashboard, billing, listing; approved and listed 2026-09-04".
- Line 61 `*Updated at milestone close, 2026-08-24*` → `*Updated 2026-09-04 — App Store listing recorded*`.
- `## Quick Tasks Completed` table: append one row. Date `2026-09-04`; Task `[260904-dty](quick/260904-dty-record-app-store-approval-and-public-lis/260904-dty-SUMMARY.md) — record App Store approval + public listing`; Commits: the commit subject `docs(launch): record App Store approval and public listing (2026-09-04)` written as text (a single commit cannot carry its own hash — do not amend to insert one); Outcome: "STATE → listed, LNCH-03 approved, WINDOWS #23 re-noted (S4 needs a 1600×900 retake before the swap), CHANGELOG/README/CLAUDE.md carry the listing URL. No code changes."
- `## Session Continuity` block: Last session → the same ISO timestamp used for `last_updated`; Stopped at → "v1.0.0 listed 2026-09-04; next: WINDOWS #23 — retake S4 at 1600×900 (PII-free), then swap it on the live listing"; Resume file → `.planning/WINDOWS.md`.

Leave the Decisions, Pending Todos, Blockers/Concerns and Deferred Items sections untouched (they are dated history).

REQUIREMENTS.md:
- Line 124, LNCH-03 traceability row → `| LNCH-03 | Phase 6 | Approved and listed 2026-09-04 — https://apps.shopify.com/credit-guard-b2b-net-terms |`.
- Line 56: flip the LNCH-03 checkbox from unchecked to `- [x]` — the requirement text is "App passes Shopify app review", which is now true; leaving it unchecked beside an "Approved" traceability row would be self-contradictory.

After editing, confirm the STATE.md frontmatter parses: a node one-liner that slices the text between the first two `---` lines and checks every non-empty line is either a `key: value` pair or an indented `key: value` under `progress:`.
  </action>
  <verify>
    <automated>cd "/Users/hesamabbaszadi/Documents/Projects/Credit Guard" && grep -q '^status: listed$' .planning/STATE.md && ! grep -q 'PLACEHOLDER_KEEP' .planning/STATE.md && [ "$(grep -c 'completed_phases: 6\|total_plans: 35\|completed_plans: 35' .planning/STATE.md)" = 3 ] && grep -q '260904-dty-SUMMARY.md' .planning/STATE.md && grep -q '100% (6 of 6 phases complete)' .planning/STATE.md && grep -q '^| LNCH-03 | Phase 6 | Approved and listed 2026-09-04 — https://apps.shopify.com/credit-guard-b2b-net-terms |$' .planning/REQUIREMENTS.md && grep -q '^- \[x\] \*\*LNCH-03\*\*' .planning/REQUIREMENTS.md && node -e "const t=require('fs').readFileSync('.planning/STATE.md','utf8');const fm=t.split('\n---')[0].split('\n').slice(1);const bad=fm.filter(l=>l.trim()&&!/^\s*[A-Za-z_]+:\s?.*$/.test(l));if(bad.length){console.error('bad frontmatter lines',bad);process.exit(1)}" && echo TASK1-OK</automated>
  </verify>
  <done>STATE.md frontmatter reads status listed / 6 of 6 phases / 35 of 35 plans with no malformed line; Current focus, Current Position, velocity, By Phase, Quick Tasks and Session Continuity all describe v1.0.0 as approved and listed 2026-09-04 with the URL; REQUIREMENTS.md LNCH-03 is checked and its traceability row reads "Approved and listed 2026-09-04 — URL"; the TASK1-OK gate prints.</done>
</task>

<task type="auto">
  <name>Task 2: Re-note WINDOWS #23 through the ledger module (status stays open)</name>
  <files>.planning/WINDOWS.md</files>
  <action>
Do not hand-edit WINDOWS.md — the table row and the JSON block would drift. Write a throwaway script to the scratchpad directory (`/private/tmp/claude-501/-Users-hesamabbaszadi-Documents-Projects-Credit-Guard/9e9dc707-a1b2-47fc-9465-f225477a9585/scratchpad/renote-23.cjs`) that: requires `~/.claude/gsd-core/bin/lib/broken-windows.cjs` (resolve `$HOME` explicitly); reads `.planning/WINDOWS.md`; calls `parseLedger`; asserts the pre-state (`open_count` 9, `waived_count` 1, `fixed_count` 18, `total_count` 28, entry 23 `status` "open") and exits non-zero otherwise; sets entry 23 `description` to the text below verbatim; leaves entry 23 `status`, `reason`, `recorded_at`, `resolved_at`, `kind`, `file` untouched; sets `ledger.last_updated` to the run's UTC ISO timestamp; calls `renderLedger`; re-parses the rendered string as a self-check (counts unchanged, entry 23 still open); writes it back to `.planning/WINDOWS.md`. Run it with node, then delete the script.

New #23 description (verbatim — contains no pipe character and no backtick run; keep the × glyph):

Screenshot 4 on the LIVE App Store listing carries customer PII (customer name, email, street address, phone + staff name legible behind the draft-order "Unresolved business rules" modal), found 2026-08-24 after submission. Repo copy cropped at 1ee6b34 (moved screenshots/ -> listing/screenshots/ at b8b8809); uncropped file remains in git history at 57fb1a4 (private repo). UPDATE 2026-09-04: review ended — v1.0.0 approved and listed at https://apps.shopify.com/credit-guard-b2b-net-terms — so the listing is editable now. BUT the repo crop listing/screenshots/S4.png is 600×290 and the App Store requires 1600×900, so S4 must be RETAKEN at 1600×900 (PII-free framing, same shot-list position per 06-LISTING §10.3) before the swap; the PII screenshot stays live until the retake lands. First post-launch action.

The description names the PII categories only (as the original did); it must never reproduce an actual customer name, email, address or phone. The only diff against the committed file must be the #23 table row, the #23 JSON `description`, and the `last_updated` frontmatter line — `git diff --stat .planning/WINDOWS.md` should show one file with a handful of changed lines, not a rewrite.
  </action>
  <verify>
    <automated>cd "/Users/hesamabbaszadi/Documents/Projects/Credit Guard" && node -e "const m=require(process.env.HOME+'/.claude/gsd-core/bin/lib/broken-windows.cjs');const raw=require('fs').readFileSync('.planning/WINDOWS.md','utf8');const l=m.parseLedger(raw);const e=l.entries.find(x=>x.id===23);const ok=l.open_count===9&&l.waived_count===1&&l.fixed_count===18&&l.total_count===28&&l.entries.length===28&&e.status==='open'&&e.file==='listing/screenshots/S4.png'&&e.description.includes('600×290')&&e.description.includes('1600×900')&&e.description.includes('https://apps.shopify.com/credit-guard-b2b-net-terms')&&m.renderLedger(l)===raw&&l.last_updated.startsWith('2026-09-04');if(!ok){console.error('WINDOWS check failed',{open:l.open_count,waived:l.waived_count,fixed:l.fixed_count,total:l.total_count,status:e.status,last:l.last_updated});process.exit(1)}console.log('TASK2-OK')" && [ "$(git diff --numstat .planning/WINDOWS.md | awk '{print $1}')" -le 4 ]</automated>
  </verify>
  <done>WINDOWS.md parses through the shipped module, still reports 9 open / 1 waived / 18 fixed / 28 total, entry 23 is open with the 600×290 → 1600×900 retake note and the listing URL, the file round-trips byte-identically through renderLedger, last_updated is 2026-09-04, and the diff is confined to the #23 row, the #23 JSON description and the frontmatter timestamp.</done>
</task>

<task type="auto">
  <name>Task 3: CHANGELOG, README, CLAUDE.md, then the no-pending-review gate and the single commit</name>
  <files>CHANGELOG.md, README.md, .claude/CLAUDE.md, .planning/quick/260904-dty-record-app-store-approval-and-public-lis/260904-dty-SUMMARY.md</files>
  <action>
CHANGELOG.md — in the `## 1.0.0 — 2026-08-24` entry, keep the existing "Submitted for Shopify App Store review." sentence (it is release history) and insert a new standalone paragraph immediately after the intro paragraph (after line 7, before `### Added`): "**Approved and listed on the Shopify App Store on 2026-09-04** — https://apps.shopify.com/credit-guard-b2b-net-terms (App Store visibility currently limited; build f1032f0, tag v1.0.0)."

README.md — two scoped edits. (a) Lines 12-13 `**Status:**` sentence → "**Status:** v1.0.0, **approved and listed on the Shopify App Store** on **2026-09-04** — https://apps.shopify.com/credit-guard-b2b-net-terms (submitted 2026-08-24; App Store visibility currently limited)." The following sentence about Shopify App Pricing stays. (b) In `## Launch runbook`, after the first paragraph (the one ending "make the browser session mechanical."), add a one-sentence paragraph: "v1.0.0 went through this runbook, was submitted 2026-08-24 and was approved and listed on 2026-09-04 at https://apps.shopify.com/credit-guard-b2b-net-terms; the steps below remain the release procedure for every later version." Grep the file first for `submitted`, `under review`, `awaiting` and confirm line 12 was the only pending-review phrasing (plan-time grep says so; the "reviewer sees" sentence in the billing section is design rationale and stays).

.claude/CLAUDE.md — two scoped edits. (a) Lines 19-21: replace the first sentence of the Status paragraph — everything from `**Status:**` up to and including the closing parenthesis that precedes "Production runs on" — with: "**Status:** v1.0.0, approved and listed on the Shopify App Store 2026-09-04 at https://apps.shopify.com/credit-guard-b2b-net-terms (submitted 2026-08-24; six phases complete, `.planning/STATE.md` → `listed`)." Re-wrap so the paragraph keeps its ~80-column shape. (b) Lines 320-325 in "Where the real documentation lives": change `STATE.md` (position; partly stale on metrics) to `STATE.md` (position), and rewrite the WINDOWS.md bullet to: "`WINDOWS.md` — **the cross-phase defect register. Check it first.** 28 entries, 9 open (#11, #18, #19, #23, #24, #25, #26, #27, #28), 1 waived (#4). `/gsd-ship` blocks while any are open. #23 (customer PII in screenshot 4 on the live listing) became actionable when review ended 2026-09-04, but `listing/screenshots/S4.png` is a 600×290 crop and the App Store requires 1600×900 — retake first, then swap." Drop the trailing sentence about #23 and the pre-move `screenshots/` path; commit 30ab08f already repointed the ledger entry to `listing/screenshots/S4.png`, so that caveat is now false.

Gate, then commit:
- Run the required verification grep (in the verify block) — it must print nothing and exit 1. If it prints a line, fix that file; do not touch anything under `.planning/phases/`.
- `git status --porcelain` must list only the six records plus this task's PLAN.md/SUMMARY.md under `.planning/quick/260904-dty-…/`; nothing under shopify.app.toml, app/, extensions/, tests/, prisma/, listing/.
- Write `260904-dty-SUMMARY.md` (per the summary template) into the quick directory, then make ONE commit containing the six records and the quick-task PLAN + SUMMARY with subject exactly `docs(launch): record App Store approval and public listing (2026-09-04)`. Use `gsd_run query commit "docs(launch): record App Store approval and public listing (2026-09-04)" --files <the eight paths>`; if the helper is unavailable, `git add` the same eight paths and `git commit -m` with that subject. Do not amend afterwards.
  </action>
  <verify>
    <automated>cd "/Users/hesamabbaszadi/Documents/Projects/Credit Guard" && ! grep -rn "awaiting-external-review\|awaiting Shopify review" .planning/*.md README.md CHANGELOG.md .claude/CLAUDE.md && for f in CHANGELOG.md README.md .claude/CLAUDE.md .planning/STATE.md .planning/REQUIREMENTS.md .planning/WINDOWS.md; do grep -q 'https://apps.shopify.com/credit-guard-b2b-net-terms' "$f" || { echo "URL missing in $f"; exit 1; }; done && grep -q 'approved and listed on the Shopify App Store' README.md && grep -q 'Approved and listed on the Shopify App Store on 2026-09-04' CHANGELOG.md && grep -q '`.planning/STATE.md` → `listed`' .claude/CLAUDE.md && grep -q '28' .claude/CLAUDE.md && grep -q '9 open (#11, #18, #19, #23, #24, #25, #26, #27, #28)' .claude/CLAUDE.md && ! grep -q 'still cites' .claude/CLAUDE.md && [ -z "$(git status --porcelain)" ] && [ "$(git log -1 --format=%s)" = "docs(launch): record App Store approval and public listing (2026-09-04)" ] && [ -z "$(git show --stat --format= HEAD -- shopify.app.toml app extensions tests prisma listing)" ] && echo TASK3-OK</automated>
  </verify>
  <done>The pending-review grep across `.planning/*.md`, README.md, CHANGELOG.md and `.claude/CLAUDE.md` returns nothing; all six records carry the listing URL; CLAUDE.md's Status sentence and WINDOWS paragraph are accurate (28 entries, 9 open, #23 retake note, no stale path claim); the working tree is clean after exactly one commit with the required subject, and that commit touches nothing under shopify.app.toml, app/, extensions/, tests/, prisma/ or listing/.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| repo → public readers of README/CHANGELOG/PRIVACY | These files are shipped in the repository and mirrored in listing copy; anything written here is public-facing. |
| WINDOWS.md ledger → gsd-tools | The ledger is machine-parsed; a malformed regeneration silently breaks `/gsd-ship` gating. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-QT-01 | Information disclosure | WINDOWS #23 note, CLAUDE.md WINDOWS bullet | medium | mitigate | The re-note names PII categories only, exactly as the original entry did; Task 2 forbids reproducing any actual customer name, email, address or phone. |
| T-QT-02 | Tampering | WINDOWS.md regeneration | medium | mitigate | Task 2 goes through parseLedger/renderLedger with pre- and post-assertions on counts and entry 23 status, plus a byte-identical re-render check and a diff-size cap. |
| T-QT-03 | Tampering | STATE.md frontmatter | low | mitigate | Task 1 removes the malformed line and runs a key:value shape check on the frontmatter before finishing. |
| T-QT-04 | Tampering | application code / listing assets | low | mitigate | Task 3's commit gate asserts the commit touches nothing under shopify.app.toml, app/, extensions/, tests/, prisma/, listing/. |
| T-QT-SC | Tampering | npm/pip/cargo installs | low | accept | No package is installed by this task; the only script executed is a local throwaway that requires the already-installed gsd-core module. |
</threat_model>

<verification>
- `grep -rn "awaiting-external-review\|awaiting Shopify review" .planning/*.md README.md CHANGELOG.md .claude/CLAUDE.md` → no output, exit 1.
- `grep -rn "awaiting Shopify review\|awaiting-external-review" .planning/phases/ | wc -l` → unchanged from before the task (historical mentions preserved).
- `node -e` parse of `.planning/WINDOWS.md` through broken-windows.cjs → 9/1/18/28, entry 23 open, byte-identical re-render.
- `git log -1 --format=%s` → `docs(launch): record App Store approval and public listing (2026-09-04)`; `git status --porcelain` empty.
</verification>

<success_criteria>
All three TASK-OK gates print; one commit with the required subject; every top-level record says v1.0.0 is approved and listed 2026-09-04 with the URL; WINDOWS #23 remains open with the 1600×900 retake precondition; nothing outside the six records and the quick-task artifacts changed.
</success_criteria>

<output>
Create `.planning/quick/260904-dty-record-app-store-approval-and-public-lis/260904-dty-SUMMARY.md` when done, and include it in the single commit.
</output>
