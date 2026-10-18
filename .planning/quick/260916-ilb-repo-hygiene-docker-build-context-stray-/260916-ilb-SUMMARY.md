---
quick_id: 260916-ilb
status: complete
completed: 2026-09-16
---

# 260916-ilb — repo hygiene: Docker build context and stray files

- `.dockerignore` now excludes `.planning`, `listing`, `docs`, `tests`,
  `scripts`, `site`, `marketing`, `.claude`, `.git`, env files, `*.md`
  (except `PRIVACY.md`, inlined at build) and `*.mov`; `.railwayignore`
  mirrors it so the `railway up` upload shrinks too.
- Removed `extensions/.gitkeep`, the empty `.railway/` directory and local
  `.DS_Store` files.
- Validated with a production deploy (d69057d, 2026-09-16T05:24Z, SUCCESS):
  both TOML pins byte-identical after the CLI run; smoke script PASS;
  `/privacy` and `/support` 200; `ls /app` in the container shows only
  runtime files — no `.planning`, `listing`, `tests`, `scripts`, `docs`,
  `site` or Markdown besides `PRIVACY.md`.
