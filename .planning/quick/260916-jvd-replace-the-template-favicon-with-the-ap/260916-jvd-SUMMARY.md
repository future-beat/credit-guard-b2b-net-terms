---
quick_id: 260916-jvd
status: complete
completed: 2026-09-16
---

# 260916-jvd — replace the template favicon with the app icon

`public/favicon.ico` is now an ICO container with the 32 px and 64 px PNG
renditions of the App Store icon (9.6 KB); `public/apple-touch-icon.png` (180 px)
added. No markup or test changes — the public pages stay `<link>`-free and
browsers pick both files up by convention. Deployed and verified live (see the
commit that follows this summary).
