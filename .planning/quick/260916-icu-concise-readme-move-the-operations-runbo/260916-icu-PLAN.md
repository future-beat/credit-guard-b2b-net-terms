---
quick_id: 260916-icu
type: quick
wave: 1
autonomous: true
requirements: []
files_modified:
  - README.md
  - docs/RUNBOOK.md
  - .claude/CLAUDE.md
---

# Quick task 260916-icu — concise README, runbook moved to docs/

## Why

The README had grown to 984 lines of operations detail. The developer wants a
concise, efficient README. Nothing in the old text is disposable — the
deployment variables, probe catalogue, scope table and launch runbook are the
operating record — so it moves rather than shrinks.

## Tasks

1. **Move** `README.md` → `docs/RUNBOOK.md` with `git mv` (history preserved);
   replace its H1 and intro with a runbook header that points back to the README.
2. **Write** a new `README.md` (~110 lines): what it is, status and links, how it
   works in four steps, repository layout, quick start, deploy and operate with
   links into runbook section anchors, licence.
3. **Repoint** references: `.claude/CLAUDE.md` ("Where the real documentation
   lives" and the site bullet), any script or planning text that says
   "README" for runbook content.

## Verify

- Every runbook anchor linked from the README exists (`grep "^## \|^### " docs/RUNBOOK.md`).
- `git log --follow docs/RUNBOOK.md` shows the old README history.
- `npm test` untouched (no code changed); `git diff --stat -- app extensions prisma shopify.app.toml` empty.

## Done

README under 120 lines and readable in one screen; runbook complete and linked.
