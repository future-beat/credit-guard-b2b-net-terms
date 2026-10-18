---
quick_id: 260915-fuf
status: complete
completed: 2026-09-15
---

# 260915-fuf — static marketing site for creditguardhq.com

Built `site/index.html` (8.4 KB, system fonts, inline CSS, inline SVG favicon,
no scripts/forms/trackers, light + dark) carrying the marketing thread's
2026-09-15 copy verbatim (23/23 copy lines present; the 24th "line" is the
button text + URL, both present), plus `site/vercel.json` (www → apex 301,
nosniff / referrer / permissions / frame headers).

Deployed to Vercel project `credit-guard-site` (created 2026-09-15, owner
future-beat / hesams-projects); production alias
https://credit-guard-site.vercel.app answers 200, content-length 8439, no
cookies. Verified at 375 px: no horizontal scroll (scrollWidth == innerWidth).
Domains `creditguardhq.com` and `www.creditguardhq.com` attached to the project;
Vercel reports "not configured" until DNS changes (developer's step in the
Shopify admin): root A → 76.76.21.21, remove root AAAA, www → CNAME
cname.vercel-dns.com (or A 76.76.21.21).

Acceptance criteria 3–8 met now; 1 (apex serves over TLS) and 2 (demo store
unaffected) complete once DNS is switched — the demo store keeps its
myshopify.com host regardless. Not done by design: no listing URL change, no
analytics, no demo on the page (request §8).

## Deploy gotcha found on the second deploy (recorded in README)

Deploys run from inside the git tree came back `readyState: BLOCKED`,
`seatBlock.blockCode: TEAM_ACCESS_REQUIRED`, reason "the commit author doesn't
have permission to create deployments for this project" — the CLI attaches
the repo's commit author once the files are committed, and the Hobby team
rejects an author email that is not on the Vercel account. The CLI shows this
only as an endless "Building…"; the API exposes the real state. Fix: deploy
from a copy of `site/` outside the git tree (README "Marketing site"). Final
production deployment: credit-guard-site-1v8g42uaz (Ready, 1s), 7,976 bytes.

## DNS switched 2026-09-15 (developer, Shopify admin) — all acceptance criteria met

Authoritative zone: root A 76.76.21.21, root AAAA removed, www CNAME
cname.vercel-dns.com; `app` CNAME (Railway), `account` CNAME (Shopify customer
accounts), MX and the mail/verification TXT records untouched. Vercel issued
certificates for both hosts within a minute of propagation
(cert_ho1LulV4… apex, cert_urD8gOgx… www). Verified: https://creditguardhq.com →
200 with a valid certificate and the page copy; https://www.creditguardhq.com →
308 to the apex; app.creditguardhq.com/healthz 200 and the demo store
unaffected throughout. Public resolvers (8.8.8.8, 1.1.1.1, 9.9.9.9) all answer
76.76.21.21; local caches of the old 24h-TTL record clear on their own.

## Follow-up 2026-09-16 — app icon on the site

Per the developer: the App Store icon (`listing/icon/credit-guard-icon-main.png`)
now serves as the header mark (`/icon-64.png` at 28 px), favicon (`/icon-32.png`,
`/icon-64.png`), apple-touch icon and og:image (`/icon-180.png`); page accent
moved to the icon's indigo (#3a37a3 light / #9d9cf2 dark). Sizes made with sips;
total page weight ≈ 52 KB with all three icons, HTML 7.9 KB. Copy unchanged
(23/23 verbatim lines, no violations). Deployed credit-guard-site-izpad1hy1
(Ready, 2s); all four paths answer 200 on the apex.
