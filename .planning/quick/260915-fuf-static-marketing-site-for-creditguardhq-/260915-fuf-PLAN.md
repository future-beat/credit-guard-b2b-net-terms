---
quick_id: 260915-fuf
type: quick
wave: 1
autonomous: true
requirements: [LNCH-03]
files_modified:
  - site/index.html
  - site/vercel.json
  - .gitignore
  - README.md
  - .claude/CLAUDE.md
---

# Quick task 260915-fuf — static marketing site for creditguardhq.com

## Source

`marketing/drafts/2026-09-15-build-request-landing-page.md` (marketing thread,
approved by Hesam 15 Sep 2026). Copy in its §5 is verbatim and owned by
marketing; §6 hard constraints and §7 acceptance criteria are the contract.

## Decisions

- **Host:** Vercel, a NEW project `credit-guard-site` rooted at `site/` in this
  repo, deployed from the CLI. Zero coupling to the Railway app: no shared
  build, env, domain or process. Breaking the site cannot touch the app.
- **Why in this repo:** one place for the copy's version history next to the
  listing copy it must match; the Vercel project uploads only `site/`.
- **DNS:** Shopify-managed DNS can EDIT the root A record (not remove it) and
  add records. Vercel apex = A `76.76.21.21`; `www` = CNAME
  `cname.vercel-dns.com`. Shopify's AAAA record at the root must be removed or
  Vercel reports a conflicting configuration. These are the developer's manual
  steps in the Shopify admin after the deploy is verified on its `vercel.app`
  URL; the demo store keeps `credit-guard-demo.myshopify.com`.
- **Redirect:** `www` → apex (301) via `vercel.json`; Vercel also does this
  when both domains are attached.
- **No external requests:** system font stack only, inline CSS, inline SVG
  favicon as a data URI, no scripts, no analytics. Page weight target < 20 KB.
- **Themes:** light and dark via `prefers-color-scheme`; both painted explicitly.

## Tasks

### Task 1 — the page (auto)

**Files:** `site/index.html`, `site/vercel.json`

**Action:** Write the single page with §5 copy byte-for-byte (headings: "What it
does", "What it does not do", "Who it is for", "Pricing", "Setup"; primary
button text "View on the Shopify App Store" linking to the listing; footer
lines). No forms, inputs, buttons other than the one anchor, scripts, external
stylesheets, fonts, images or trackers. `vercel.json`: `cleanUrls`, a 301 from
`www.creditguardhq.com` to `https://creditguardhq.com/$1`, and conservative
security headers (no CSP that would need tuning later; `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`).

**Verify:** a scratchpad script extracts the §5 strings from the request file
and asserts each appears verbatim in the HTML's text; `grep -c "<script\|<form\|<input\|<button\|fonts.googleapis\|http://" site/index.html` = 0;
`wc -c site/index.html` < 100000; no em dash (U+2014) in the copy;
none of "instant", "blocked $", "card" appear.

**Done:** the page renders the request's copy and nothing else.

### Task 2 — deploy and attach the domains (orchestrator)

**Action:** `vercel project add credit-guard-site`; from `site/`: `vercel link
--yes --project credit-guard-site`, `vercel deploy --prod --yes`; screenshot the
production `vercel.app` URL at 375 px wide (no horizontal scroll) and desktop;
`vercel domains add creditguardhq.com` and `www.creditguardhq.com` to the
project; capture the DNS values Vercel prints. Do NOT change DNS (developer's
step in the Shopify admin). `site/.vercel/` is git-ignored.

**Verify:** `curl -sI https://<prod>.vercel.app` → 200, `content-length` under
100 KB, no `set-cookie`; page text matches Task 1's check when fetched live.

### Task 3 — record (auto)

**Files:** `.gitignore`, `README.md`, `.claude/CLAUDE.md`, this dir's SUMMARY.md

**Action:** ignore `site/.vercel/`; README gets a short "Marketing site"
section (where it lives, how to deploy, the DNS values, the rule that copy is
owned by `marketing/` and must match the listing); CLAUDE.md "Where the real
documentation lives" gets one bullet for `site/`. Commit
`feat(site): static marketing page for creditguardhq.com (Vercel)`.

**Verify:** `git status --porcelain` empty after commit; nothing under `app/`,
`extensions/`, `shopify.app.toml`, `prisma/` changed.
