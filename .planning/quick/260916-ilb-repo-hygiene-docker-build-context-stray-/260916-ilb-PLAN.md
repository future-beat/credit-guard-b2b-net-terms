---
quick_id: 260916-ilb
type: quick
wave: 1
autonomous: true
requirements: []
files_modified: [.dockerignore, .railwayignore, extensions/.gitkeep]
---

# 260916-ilb — repo hygiene: Docker build context and stray files

Review of the repository layout (2026-09-16) found the tree itself tidy — 28
root files, all with a job — but the **deploy artefact was not**: `.dockerignore`
listed only `node_modules`, `.cache` and `build`, so `COPY . .` shipped
`.planning/` (3 MB of planning record), `listing/` (5 MB of screenshots),
`tests/`, `scripts/`, `docs/`, `site/` and every root Markdown file into the
production image. `railway up` honours `.gitignore`, so `marketing/`, `.env`
and the 38 MB screencast were never uploaded, but nothing else was filtered.

Tasks: (1) `.dockerignore` covering everything the runtime does not need
(keeping `PRIVACY.md`, which `privacy.tsx` inlines at build); (2) a matching
`.railwayignore` so the upload shrinks too; (3) delete `extensions/.gitkeep`
(the extension exists), the empty `.railway/` directory and local `.DS_Store`
files. Verify: `npm run build` unaffected (no code change); a production deploy
builds and `scripts/smoke-deployed.sh` passes; the image no longer contains
`.planning` (checked over `railway ssh -- ls /app`).
