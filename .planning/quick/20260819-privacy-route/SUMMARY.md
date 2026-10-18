---
type: quick
slug: 20260819-privacy-route
subsystem: compliance
tags: [privacy, gdpr, app-review, react-router, resource-route, markdown]

requires:
  - phase: 01-foundation
    provides: unauthenticated resource-route pattern (app/routes/healthz.tsx), source-guard test style
provides:
  - Public, unauthenticated privacy policy at GET /privacy
  - Markdown-subset renderer that keeps PRIVACY.md the single source of truth
  - Transitive import-graph source guard reusable for any future public route
affects: [app submission, Protected Customer Data questionnaire, app listing URLs]

actuals:
  tokens: 4984
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Public pages are resource routes (loader only, no default export) so they bypass app/root.tsx and its cdn.shopify.com stylesheet"
    - "Documentation shipped to users is inlined at build time via Vite ?raw, never duplicated in code"
    - "Source guards walk the transitive relative-import graph, not just the entry file"

key-files:
  created:
    - app/routes/privacy.tsx
    - tests/privacy-route.test.ts
  modified:
    - .planning/STATE.md

key-decisions:
  - "Build-time ?raw inline of PRIVACY.md over hand-authored HTML or runtime readFileSync"
  - "Hand-rolled ~70-line Markdown-subset renderer over adding marked/markdown-it — zero new runtime dependency"
  - "Resource route with no default export, so the page never enters the React render path"
  - "Cache-Control: public, max-age=3600"

patterns-established:
  - "Transitive-import source guard: comment-strip, walk relative imports, assert no shopify.server anywhere in the graph"

requirements-completed: []

coverage:
  - id: D1
    description: "GET /privacy returns 200 with text/html; charset=utf-8 and no authentication"
    verification:
      - kind: unit
        ref: "tests/privacy-route.test.ts#returns 200 with no authentication of any kind"
        status: pass
      - kind: unit
        ref: "tests/privacy-route.test.ts#serves HTML with an explicit charset"
        status: pass
      - kind: e2e
        ref: "curl -i http://127.0.0.1:3199/privacy against production build (npx react-router-serve ./build/server/index.js) -> HTTP/1.1 200, content-type: text/html; charset=utf-8, cache-control: public, max-age=3600"
        status: pass
    human_judgment: false
  - id: D2
    description: "Route imports nothing from app/shopify.server, directly or transitively"
    verification:
      - kind: unit
        ref: "tests/privacy-route.test.ts#never imports app/shopify.server, directly or transitively"
        status: pass
      - kind: unit
        ref: "tests/privacy-route.test.ts#never calls authenticate()"
        status: pass
    human_judgment: false
  - id: D3
    description: "Rendered content matches PRIVACY.md with a single source of truth"
    verification:
      - kind: unit
        ref: "tests/privacy-route.test.ts#renders every top-level section heading from the Markdown"
        status: pass
      - kind: unit
        ref: "tests/privacy-route.test.ts#leaves no raw Markdown syntax in the output"
        status: pass
      - kind: integration
        ref: "grep -c 'What Credit Guard does not store' build/server/index.js -> 1 (policy inlined at build time); grep -c readFileSync build/server/index.js -> 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "Page renders with no external network request and no Polaris/App Bridge"
    verification:
      - kind: unit
        ref: "tests/privacy-route.test.ts#references no external origin at all"
        status: pass
      - kind: unit
        ref: "tests/privacy-route.test.ts#loads no stylesheet, script, font, or image"
        status: pass
      - kind: e2e
        ref: "grep -o 'https?://' on the curl-served body -> 0 unique matches"
        status: pass
    human_judgment: false
  - id: D5
    description: "Typography and layout are readable on mobile and desktop"
    verification: []
    human_judgment: true
    rationale: "Visual legibility of the served page at real viewport widths — including the dark-scheme variant and the horizontally-scrolling scope table on a phone — is an aesthetic judgment no assertion in this suite makes. The HTML and CSS were inspected, but nobody has looked at it in a browser."

duration: 11 min
completed: 2026-08-19
status: complete
---

# Quick Task: Public `/privacy` route Summary

**`GET /privacy` serves the committed `PRIVACY.md` as a self-contained 11 KB HTML document — unauthenticated resource route, build-time `?raw` inline, hand-rolled Markdown-subset renderer, zero new dependencies.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-08-19T06:15:00Z
- **Completed:** 2026-08-19T06:26:00Z
- **Tasks:** 2
- **Files created:** 2 (plus STATE.md and this planning directory)

## Accomplishments

- `GET /privacy` returns HTTP 200 with `text/html; charset=utf-8` and
  `Cache-Control: public, max-age=3600`, verified over real HTTP against the
  production build with no session token, cookie, or `shop` parameter — the
  exact request a Shopify reviewer sends. Once deployed this is
  `https://app.creditguardhq.com/privacy`, unblocking the app listing's privacy
  policy URL and the Protected Customer Data questionnaire.
- The policy has exactly **one** source of truth. `PRIVACY.md` is inlined into
  the server bundle at build time; the deployed bundle contains the policy text
  and calls `readFileSync` zero times.
- Suite grew **194 -> 210 tests** (12 files), all green. Typecheck, lint, and
  production build clean.

## Task Commits

1. **Task 1: Add `app/routes/privacy.tsx`** - `09b3675` (feat)
2. **Task 2: Add `tests/privacy-route.test.ts`** - `4396bb8` (test)

**Plan metadata:** final `docs(privacy)` commit.

## Files Created/Modified

- `app/routes/privacy.tsx` - resource route: `?raw` import of `PRIVACY.md`, a
  Markdown-subset renderer (headings, thematic breaks, pipe tables, bullet
  lists, paragraphs, inline bold/code), an inline stylesheet, and a `loader`
  returning the prerendered document.
- `tests/privacy-route.test.ts` - 16 tests: response contract, content fidelity
  against `PRIVACY.md`, self-containment, and source guards.
- `.planning/STATE.md` - added the Quick Tasks Completed table (first entry).

## Decisions Made

### 1. Build-time `?raw` inline over hand-authored HTML or runtime file read

**Chosen:** `import privacyMarkdown from "../../PRIVACY.md?raw"`, rendered at
module load.

The task allowed either "convert `PRIVACY.md`" or "hand-author the HTML" and
asked for whichever preserves a single source of truth. Hand-authoring loses
that immediately: two copies of a *legal* document, drifting silently, with the
HTML copy being the one the regulator and the reviewer actually read. Rejected.

Among conversion strategies, runtime `readFileSync` was rejected too. It works —
the Dockerfile does `COPY . .` and `WORKDIR /app`, so the file is present — but
it buys a cwd assumption and a runtime failure mode: a missing or unreadable
file becomes a 500 on the one URL Shopify reviews. Build-time inlining has
neither. Verified in the shipped artifact:

```
grep -c "What Credit Guard does not store" build/server/index.js  -> 1
grep -c readFileSync build/server/index.js                        -> 0
```

### 2. Hand-rolled renderer over a Markdown dependency — no new dependency added

**No package was installed, so the supply-chain gate never had to be opened.**
The project's zero-new-deps bias and the task's explicit preference for "a tiny
hand-rolled renderer or a build-time inline" both point the same way, and
`PRIVACY.md` uses only six constructs: ATX headings, `---` breaks, pipe tables,
`- ` bullets, paragraphs, and inline `**bold**` / `` `code` ``. That is ~70
lines of renderer versus a transitive tree for a document that changes twice a
year.

The renderer escapes HTML **before** applying inline markup, so policy text can
never inject markup; the tags it adds afterwards are the only markup in the
output.

One subtlety worth recording. `PRIVACY.md` is hard-wrapped at ~78 columns, so
line breaks inside a paragraph are the wrapper's, not the author's, and must be
joined with a space — otherwise the bold span straddling the line break in
section 1 ("the **merchant is the data / controller**") renders as literal
asterisks. But two places *do* carry deliberate breaks: the metadata header
(Last updated / Application / Provider / Contact) and the closing signature,
which would otherwise read as run-on lines. Both are structurally identifiable —
the author's breaks land exactly where a line starts with `**` mid-paragraph or
the previous line ends with `**`, and no wrapper break does. Confirmed by grep
over the whole file before committing to the rule: lines starting with `**` are
3-6 (the header) and 51/55/60/63/68 (all paragraph-initial, so unaffected); the
only line ending with `**` is 202, the contact line, whose successor is
`Hesam Labs`. Exactly the two intended cases, zero false positives.

### 3. Resource route (no default export) — load-bearing, not stylistic

A route module *with* a default export renders through `app/root.tsx`, which
injects `<link rel="stylesheet" href="https://cdn.shopify.com/static/fonts/...">`.
Requirement 4 forbids external CSS/font/CDN requests, so returning raw HTML from
the loader is what makes that requirement achievable at all — this page is not
merely *allowed* to skip the React render path, it *must*. A test asserts the
absence of a default export, with the reason in the failure message, so a future
edit that adds a component fails loudly instead of silently reintroducing the
CDN fetch.

The same route also renders outside the admin iframe, where App Bridge does not
exist and every `s-*` Polaris element would be an unstyled unknown tag — hence
the separate assertion that none appear.

### 4. `Cache-Control: public, max-age=3600`

The content changes only on deploy, and the URL sits on an app listing fetched
by reviewers and crawlers. An hour is free and still lets a corrected policy
propagate the same day.

## Verification Evidence

| Gate | Result |
|---|---|
| `npm test` | 210 passed / 12 files (baseline 194 / 11) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | succeeds; server bundle 82.36 kB |
| Real HTTP `curl -i /privacy` (production build, port 3199, no auth) | `HTTP/1.1 200`, `content-type: text/html; charset=utf-8`, `cache-control: public, max-age=3600`, 11170-byte body |
| External origins in served body | 0 |
| `git diff --stat` on `shopify.app.toml`, `prisma/schema.prisma`, `app/services/`, `app/routes/webhooks.*` | empty - byte-unchanged |

The served document was also read end-to-end: all 13 numbered sections, both
tables (scopes and sub-processors), the "What Credit Guard does not store"
subsection, every bullet list, and the contact signature render correctly, with
scope names as `<code>` and no leftover Markdown syntax.

## Deviations from Plan

None - plan executed exactly as written. No deviation rules were triggered; no
bug, missing-critical, or blocking issue arose.

## Issues Encountered

None affecting the task.

**One unrelated observation, recorded because it predates this work and should
not be attributed to it:** the repository snapshot taken at session start listed
an untracked `Shopify Partners.pdf` at the repo root. It was already absent when
this task's first command ran (`git status --short` returned empty before any
edit), and no command in this task removed it - no `git clean`, `git reset`, or
`git checkout` was run at any point, and the only `rm` calls targeted `/tmp`
scratch files and a temporary `tests/__dump.test.ts` scaffold. As the file was
never tracked, git cannot recover it. Flagged purely so it is not mistaken later
for collateral of this change.

## User Setup Required

None for the code. **One deploy-time action remains before submission:** deploy
so that `https://app.creditguardhq.com/privacy` is live, then paste that URL
into the Partner Dashboard app listing's privacy policy field. Deployment was
explicitly out of scope here and nothing was pushed.

## Next Steps

- Deploy and confirm the public URL resolves.
- Add the URL to the app listing and to the Protected Customer Data
  questionnaire.
- Optional follow-up: the D5 human-judgment item - open the page on a phone and
  a desktop, light and dark, and confirm the scope table scrolls cleanly.

## Self-Check: PASSED

- `app/routes/privacy.tsx` - FOUND
- `tests/privacy-route.test.ts` - FOUND
- `.planning/quick/20260819-privacy-route/PLAN.md` - FOUND
- Commit `09b3675` - FOUND
- Commit `4396bb8` - FOUND

---
*Quick task: 20260819-privacy-route*
*Completed: 2026-08-19*
