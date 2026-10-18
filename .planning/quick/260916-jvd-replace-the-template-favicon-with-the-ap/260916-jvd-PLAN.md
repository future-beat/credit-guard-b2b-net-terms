---
quick_id: 260916-jvd
type: quick
wave: 1
autonomous: true
requirements: []
files_modified: [public/favicon.ico, public/apple-touch-icon.png]
---

# 260916-jvd — replace the template favicon with the app icon

`public/favicon.ico` was the scaffold's placeholder icon, served on every
public page (`/`, `/privacy`, `/support`) because browsers request
`/favicon.ico` by default. The developer deleted the folder on 2026-09-16.

Constraint: the three public routes are self-contained by contract — their
tests assert no `<link>` tag at all — so the fix must be a static asset, not
markup. Browsers and iOS fetch `/favicon.ico` and `/apple-touch-icon.png`
unprompted, which is exactly what is needed.

Tasks: (1) write `public/favicon.ico` as an ICO container holding the 32 px and
64 px PNG renditions of `listing/icon/credit-guard-icon-main.png` (PNG-in-ICO
is supported by every current browser); (2) add `public/apple-touch-icon.png`
(180 px). No code, no test changes. Verify: `file public/favicon.ico` reports an
icon; after deploy `curl -I https://app.creditguardhq.com/favicon.ico` → 200
`image/x-icon` and `/apple-touch-icon.png` → 200 `image/png`; smoke passes.
