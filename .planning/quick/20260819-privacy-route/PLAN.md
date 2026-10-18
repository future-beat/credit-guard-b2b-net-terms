---
type: quick
slug: 20260819-privacy-route
created: 2026-08-19
objective: Serve the committed privacy policy as readable HTML at an unauthenticated GET /privacy
---

# Quick Task: Public `/privacy` route

## Objective

Make `PRIVACY.md` (committed `5edbe87`) publicly reachable as readable HTML at
`GET /privacy`, so the Shopify app listing can carry a public privacy policy URL
and the Protected Customer Data questionnaire can be answered truthfully.

## Why

Shopify app submission requires a public privacy policy URL. The policy content
already exists; this task only publishes it.

## Approach

**Route shape — resource route, no default export.** `app/routes/privacy.tsx`
exports only a `loader` returning a `Response`. This is the same shape as
`app/routes/healthz.tsx`, and it is load-bearing beyond convention: a route with
a default export renders through `app/root.tsx`, which injects
`<link rel="stylesheet" href="https://cdn.shopify.com/...">`. Returning raw HTML
from a resource route is what makes the "no external network requests"
requirement achievable at all.

**Unauthenticated.** No import of `app/shopify.server` — direct or transitive. A
public visitor (and a Shopify reviewer) has no session token, so any
authentication turns the listing URL into a 4xx.

**Single source of truth — build-time inline of `PRIVACY.md`.**
`import privacyMarkdown from "../../PRIVACY.md?raw"` inlines the committed
Markdown into the server bundle at build time and a tiny hand-rolled renderer
converts it to HTML. Rejected alternatives:
- Hand-authoring HTML in the route → two copies of the policy that drift
  silently. Unacceptable for a legal document.
- `readFileSync` at runtime → introduces a runtime filesystem failure mode and a
  cwd assumption; a missing file becomes a 500 on the URL Shopify reviews.
- A markdown library (`marked`, `markdown-it`) → new runtime dependency, against
  the project's zero-new-deps bias and supply-chain gate. The policy uses six
  Markdown constructs; a ~70-line renderer covers them.

**Styling.** One inline `<style>` block, system font stack, no external CSS,
fonts, or CDN. No Polaris / App Bridge — this page renders outside the admin
iframe where App Bridge does not exist.

## Tasks

<task type="auto" id="1">
  <name>Add app/routes/privacy.tsx as an unauthenticated resource route</name>
  <files>app/routes/privacy.tsx</files>
  <verify>npx tsc --noEmit passes; npm run build succeeds</verify>
  <done>GET /privacy loader returns 200, Content-Type text/html; charset=utf-8, Cache-Control set, body is a complete HTML document rendered from PRIVACY.md</done>
</task>

<task type="auto" id="2">
  <name>Add tests/privacy-route.test.ts — behaviour + transitive source guard</name>
  <files>tests/privacy-route.test.ts</files>
  <verify>npm test — full suite green, count &gt; 194</verify>
  <done>Asserts 200 without auth, HTML content type, key policy content present, no raw markdown leakage, no external URLs, no default export, and no shopify.server import across the route's transitive relative-import graph</done>
</task>

## Verification

- `npm test` — full suite green, total > 194
- `npx tsc --noEmit` clean (via `npm run typecheck`)
- `npm run lint` clean
- `npm run build` succeeds (proves the `?raw` inline resolves in a production build)
- `git diff --stat` touches only `app/routes/privacy.tsx`, `tests/privacy-route.test.ts`, and `.planning/`

## Constraints

- Do NOT modify `shopify.app.toml`, `prisma/schema.prisma`, `app/services/*.server.ts`,
  or `app/routes/webhooks.*`
- Do NOT read or write `.env*`
- No new runtime dependency
- Do NOT touch ROADMAP.md; STATE.md change limited to the Quick Tasks Completed table
