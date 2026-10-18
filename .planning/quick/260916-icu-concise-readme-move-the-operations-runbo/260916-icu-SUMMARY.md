---
quick_id: 260916-icu
status: complete
completed: 2026-09-16
---

# 260916-icu — concise README, runbook moved to docs/

- `README.md` (984 lines) moved with `git mv` to `docs/RUNBOOK.md` (history
  preserved); its H1/intro replaced by a runbook header pointing back to the
  README. All operating content kept verbatim.
- New `README.md`, 104 lines: overview, status/links (v1.0.1, listing, website,
  changelog), "How it works" in four steps, repository layout, quick start,
  deploy-and-operate with nine links into runbook anchors (all verified to
  exist), licence.
- Repointed: eight `scripts/prod-*.sh` header comments ("see README §
  Production database inspection" → `docs/RUNBOOK.md`), `.claude/CLAUDE.md`
  documentation map and site bullet.
- No code changed; `app/`, `extensions/`, `prisma/`, `shopify.app.toml` untouched.
