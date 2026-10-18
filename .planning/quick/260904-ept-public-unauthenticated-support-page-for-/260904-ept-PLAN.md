---
quick_id: 260904-ept
phase: quick-260904-ept
plan: 01
type: quick
status: planned
created: 2026-09-04
wave: 1
depends_on: []
autonomous: true
requirements: [LNCH-03]
files_modified:
  - app/routes/support.tsx
  - tests/support-route.test.ts
  - app/routes/_index/route.tsx
  - tests/landing-route.test.ts
  - .claude/CLAUDE.md
  - .planning/quick/260904-ept-public-unauthenticated-support-page-for-/260904-ept-SUMMARY.md

estimate:
  tokens: 85000
  raw_tokens: 85000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "An anonymous GET /support (no session, no ?shop) returns 200, text/html; charset=utf-8, Cache-Control public, max-age=3600, and a complete standalone HTML document"
    - "The page states the support address support@creditguardhq.com with a one-business-day (AEST) reply promise, the four things to include in a support email, a three-item 'Where things are in the app' pointer (Home / Companies / Settings), and six FAQ answers whose every claim matches the shipped behaviour in app/services and extensions/credit-guard-validation"
    - "The rendered HTML and the route module contain no hostname literal other than inside the support@creditguardhq.com address, and no absolute URL of any scheme; every link is relative (/, /privacy) or mailto:"
    - "The route is a resource route (no default export) that never reaches the Shopify app server module or the Shopify app library, directly or transitively, and never calls authenticate — guarded by tests/support-route.test.ts the same way tests/landing-route.test.ts guards GET /"
    - "The landing page footer links to /support next to Privacy policy and tests/landing-route.test.ts stays green (and now asserts the link)"
    - ".claude/CLAUDE.md names support.tsx as the fourth public route that must never import the Shopify app server module"
    - "npm test, npm run graphql-codegen + npm run typecheck, npm run lint and npm run build all pass; one commit with subject 'feat(support): public /support page for the listing's support URL' carries the code, the tests, the doc edit and this task's PLAN + SUMMARY"
  artifacts:
    - "app/routes/support.tsx"
    - "tests/support-route.test.ts"
    - "app/routes/_index/route.tsx"
    - "tests/landing-route.test.ts"
    - ".claude/CLAUDE.md"
  key_links:
    - "app/routes/support.tsx is discovered by flatRoutes() (app/routes.ts) purely by filename — support.tsx maps to GET /support with no registration step"
    - "The loader IS the response (resource route); tests/support-route.test.ts calls loader() directly, exactly the path an anonymous request takes"
    - "tests/support-route.test.ts imports stripComments from tests/helpers/module-source.ts (the single tokenizer-aware definition) and copies only the relative-import walker from tests/landing-route.test.ts"
    - "npm run build is the only gate that catches a server module imported into client code; it must run even though the route has no client half"
---

<objective>
Ship a public, unauthenticated GET /support page (`app/routes/support.tsx`) that
becomes the App Store listing's "Support / FAQ URL" — the one listing field that
shipped empty (06-LISTING §1.9 / §9.5: the apex domain is attached to the demo
store, so support went out email-only). Copy is factual only (App Store 1.1.4)
and every claim is grounded in behaviour this repo actually implements. Add a
Support link to the landing footer, name the new route in `.claude/CLAUDE.md`,
and guard it with `tests/support-route.test.ts` modelled on
`tests/landing-route.test.ts`.

Purpose: the app is live as of 2026-09-04; a real support page removes the
weakest listing field (06-LISTING §9.5 option B2) and gives merchants answers
to the six questions the product actually raises. Because the same page may
later be served from the apex or a `help.` subdomain, it carries no hostname
anywhere.

Output: `app/routes/support.tsx`, `tests/support-route.test.ts`, a one-line
footer change in `app/routes/_index/route.tsx` plus its test assertion, the
CLAUDE.md route-map edit, this task's SUMMARY.md — in ONE commit
`feat(support): public /support page for the listing's support URL`. No deploy
and no Partner Dashboard change in this task (the orchestrator does both).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.claude/CLAUDE.md
@app/routes/_index/route.tsx
@app/routes/privacy.tsx
@tests/landing-route.test.ts
@tests/helpers/module-source.ts

Facts established at plan time (do not re-derive; cite them in the SUMMARY):
- Routing is `flatRoutes()` (`app/routes.ts`): a file named `app/routes/support.tsx` IS the `/support` route. No registration anywhere.
- `_index/route.tsx` and `privacy.tsx` are both resource routes: the loader returns a `Response` holding a complete HTML document rendered once at module load; no default export; inline system-font `STYLES`; light palette `#1a1a1a` on `#ffffff` with links `#1f5eff`, dark palette `#e8e8e8` on `#16181a`, `hr` `#33383d`, links `#7aa2ff`; headers `Content-Type: text/html; charset=utf-8` and `Cache-Control: public, max-age=3600`. `privacy.tsx` additionally styles `h2` (1.3rem, margin 2.5rem 0 0.75rem), `h3` (1.05rem, margin 1.75rem 0 0.5rem) and `p` (margin 0 0 1rem). The privacy loader takes no arguments (`export const loader = () => new Response(...)`); the landing loader takes `{ request }` only for its `?shop=` admin redirect, which /support does not need.
- `tests/landing-route.test.ts` and `tests/privacy-route.test.ts` each carry a private regex `stripComments` plus `relativeImportsOf` / `resolveModule` / `transitiveSources`. Both predate the 260822-2h1 fix that made `tests/helpers/module-source.ts` the single tokenizer-aware `stripComments` (the regex version has a documented defect: a `/*`-like run inside a `//` comment swallows code). Its docstring says a second copy "is a second definition of what counts as a comment" and requires callers to pair it with a non-triviality anchor. Discretion call for this task: the new suite IMPORTS `stripComments` from `./helpers/module-source` and copies only the three import-graph walker helpers from the landing suite. The two older suites are left as they are (out of scope).
- In-app names, verified against the routes: the home page is `s-page heading="Credit Guard"` (`app._index.tsx` `COPY.pageTitle`), reached from nav links `Companies` (`/app/companies`) and `Settings` (`/app/settings`) in `app.tsx`. `app.companies.tsx`: page heading `Companies`; column `Credit limit`; switch label `Bypass enforcement`; status strings `Within limit`, `Over limit`, `Overdue`, `Enforcement bypassed`; toasts `Credit limit updated` / `Credit limit removed`. `app.settings.tsx`: page heading `Settings`; sections `Checkout block messages` and `Payment reminders`; its copy already says reminders use "your Payment reminder notification template, edited under Settings > Notifications > Payment reminder". The home dashboard has overdue, upcoming, closest-to-limit, activity-feed and reminders sections.
- Behaviour the FAQ must match. Function decision order (`extensions/credit-guard-validation/src/cart_validations_generate_run.ts` header, LOCKED): 5 `bypass === true` → allow; 6 `limit null/absent` → allow (observe-only, CRED-04); 7 `overdue === true` → BLOCK; 12 `exposure + cart > limit` → BLOCK. Consequence: a company with NO limit set is never held, even when overdue; an overdue company IS held regardless of how high its limit is. Reminders (`reminders.server.ts`): `DUE_SOON_LEAD_MS = 72h`, `OVERDUE_OFFSET_MS = 72h`, `Shop.remindersEnabledAt` null = OFF by default, Shopify's measured limit is one reminder per ORDER per 24h (`PER_ORDER_GUARD_MS = 25h`), sent via `paymentReminderSend` from the merchant's own sender — the app never holds a recipient. Balances: order + payment-terms webhooks → `recomputeCompany` (seconds); rung-1 attribution retry on later doorbells plus the `*/5 * * * *` attribution-heal sweep (≤5 min); hourly overdue sweep + publish backstop; daily reconciliation re-derives from Shopify. Lifecycle (`shop-lifecycle.server.ts`): `deactivateShop` on uninstall (retain, sweeps skip inactive shops), `redactShop` hard-deletes on `shop/redact` at ~T+48h, `ensureShopActive` restores on reinstall before that. Billing: Shopify App Pricing, one plan, zero billing code; price and trial live on Shopify's plan page — never quote them.
- `tests/landing-route.test.ts` copy assertions that the footer edit must keep true: contains `href="/privacy"` and `support@creditguardhq.com`; must NOT contain `myshopify.com`, `/auth/login`, `<form`, `<input`, `<button`, `Log in`, any `<link`/`<script`/`<img`, any absolute URL, `$` + digit, `per month`/`/mo`/`USD`, `\d+%`.
- `.claude/CLAUDE.md` lines 117-120 today read: "- `_index/route.tsx` (139) — the public landing page at `application_url`, what a / reviewer sees with no `?shop`. `privacy.tsx` (270) — public policy, required by / the listing and the PCD questionnaire. `healthz.tsx` (9) — Railway probe. / All three must **never** import `app/shopify.server` (guarded by tests)."
- Gates: `npm test` runs `pretest` = `prisma migrate deploy` against `TEST_DATABASE_URL` (default `postgresql://$USER@localhost:5432/creditguard_test`); suites share one DB, `fileParallelism: false`. Two ledgered flakes exist: `tests/reminders.test.ts` "only ONE schedule per sweep" (WINDOWS #25) and `tests/review-prompt.test.ts` "ask after a success moment" (WINDOWS #26) — if ONLY those fail, re-run those two files in isolation; anything else is a real failure. `npm run graphql-codegen` silently no-ops offline, so check it printed generated-document output before trusting `npm run typecheck`. `npm run build` is the only gate for a server module leaking into client code.
- Do NOT touch: `shopify.app.toml`, `prisma/`, `extensions/`, `app/services/`, `listing/`, `PRIVACY.md`, `README.md`, `.planning/STATE.md` (the orchestrator records the quick task).
</context>

<page_copy>
Use this markup VERBATIM as the `<main>` body of `app/routes/support.tsx`
(inside the template literal, after `<body>`). Do not add, remove or reword a
claim; typographic tweaks only if a test in this plan demands one. Every
sentence below was checked against the code facts in `<context>`.

```html
<main>
<h1>Support</h1>
<p class="lead">Help and frequently asked questions for Credit Guard: B2B Net Terms.</p>

<h2>Contact</h2>
<p>Email <a href="mailto:support@creditguardhq.com">support@creditguardhq.com</a>. We reply within one business day (AEST).</p>
<p>So we can answer in one reply, please include:</p>
<ul>
<li>your store's .myshopify.com domain</li>
<li>the company name, as it appears on the Companies page</li>
<li>the order number, if your question is about a particular order</li>
<li>a screenshot, if you have one</li>
</ul>

<h2>Where things are in the app</h2>
<ul>
<li><strong>Home</strong> (the page headed Credit Guard) — the accounts-receivable dashboard: overdue and upcoming invoices, the companies closest to their limit, and recent credit-hold and reminder activity.</li>
<li><strong>Companies</strong> — each company's credit limit, its Bypass enforcement switch, and its status: Within limit, Over limit, Overdue, or Enforcement bypassed.</li>
<li><strong>Settings</strong> — the Checkout block messages buyers see when an order is held, the current enforcement status, and the Payment reminders switch.</li>
</ul>

<h2>Frequently asked questions</h2>

<h3>Why did a buyer see a credit hold at checkout?</h3>
<p>Credit Guard holds an order on payment terms only when all of these are true: the buyer's company has a credit limit set in Credit Guard, the company's Bypass enforcement switch is off, and either the company's outstanding balance plus the new order would go over that limit, or the company has an overdue invoice. Companies with no credit limit set are never held.</p>
<p>To lift a hold, open the Companies page and either raise the company's limit (or remove it, which switches enforcement off for that company) or turn on Bypass enforcement. If the hold is because of an overdue invoice, record the payment in Shopify; raising the limit alone does not clear an overdue hold. Balances recompute automatically — there is nothing to refresh. The wording buyers see is yours to edit on the Settings page, under Checkout block messages.</p>

<h3>How quickly do balances update?</h3>
<p>Credit Guard listens to Shopify's order and payment-terms webhooks and recomputes a company's balance as they arrive, usually within seconds of the change in Shopify. An order that cannot be matched to its company straight away is retried within five minutes. An hourly check catches anything that was missed, and once a day every balance is re-derived from Shopify's records.</p>

<h3>How do payment reminders work?</h3>
<p>Reminders are off by default; you turn them on from the Settings page. Once on, each net-terms invoice attributed to a company is chased at up to three moments: 72 hours before the due date, on the due date, and 72 hours after it. Shopify sends the emails from your store's own email address using your Payment reminder notification template (edited in your Shopify admin under Settings, then Notifications), so the wording is yours, and Credit Guard never sees the recipient. At most one reminder is sent per order in any 24-hour period.</p>

<h3>What data does Credit Guard store?</h3>
<p>Company names and identifiers, order identifiers, amounts, due dates and payment status — what is needed to work out each company's outstanding balance. Credit Guard never stores buyer contact details: no names, email addresses, phone numbers or postal addresses. See the <a href="/privacy">privacy policy</a> for the full list, including where the data is hosted.</p>

<h3>What happens when I uninstall?</h3>
<p>Processing stops straight away: balances are no longer recomputed, no reminders are sent, and checkout holds stop. All data Credit Guard holds for your store is deleted when Shopify sends its shop/redact request, about 48 hours after uninstall. If you reinstall before then, your settings are restored; after that, the app starts fresh.</p>

<h3>How is Credit Guard billed?</h3>
<p>Through Shopify. There is one plan, charged on your Shopify bill; the current price and any free trial are shown on Shopify's plan page when you install. Uninstalling the app ends the subscription.</p>

<hr />
<footer>
<p><a href="/">Credit Guard home</a> · <a href="/privacy">Privacy policy</a></p>
<p>Support: <a href="mailto:support@creditguardhq.com">support@creditguardhq.com</a></p>
</footer>
</main>
```

Head: `<title>Support — Credit Guard: B2B Net Terms</title>` and
`<meta name="description" content="Support and frequently asked questions for Credit Guard: B2B Net Terms." />`,
plus the same `charset` and `viewport` metas as the landing page.
</page_copy>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: GET /support end-to-end — route module plus its guard suite</name>
  <files>app/routes/support.tsx, tests/support-route.test.ts</files>
  <behavior>
    tests/support-route.test.ts (vitest, modelled on tests/landing-route.test.ts; four describe blocks):
    - Response: loader() status 200; Content-Type exactly "text/html; charset=utf-8"; Cache-Control exactly "public, max-age=3600"; body starts with doctype html (case-insensitive after trimStart), contains '<html lang="en">', '<meta name="viewport"', "<title>Support — Credit Guard: B2B Net Terms</title>", "</html>".
    - Factual copy: contains "<h1>Support</h1>"; contains 'href="mailto:support@creditguardhq.com"' and "within one business day (AEST)"; contains each of the four include-in-email bullets ("your store's .myshopify.com domain", "the company name, as it appears on the Companies page", "the order number, if your question is about a particular order", "a screenshot, if you have one"); contains "<h2>Where things are in the app</h2>" and "<strong>Home</strong>", "<strong>Companies</strong>", "<strong>Settings</strong>"; contains all six FAQ headings verbatim as <h3> elements ("Why did a buyer see a credit hold at checkout?", "How quickly do balances update?", "How do payment reminders work?", "What data does Credit Guard store?", "What happens when I uninstall?", "How is Credit Guard billed?"); contains the load-bearing claims "Companies with no credit limit set are never held.", "raising the limit alone does not clear an overdue hold", "72 hours before the due date, on the due date, and 72 hours after it", "At most one reminder is sent per order in any 24-hour period.", "never stores buyer contact details", "about 48 hours after uninstall"; contains 'href="/privacy"' and 'href="/"'.
    - No outcome claim / no price: with the <style> block removed, copy does not match /\$\s?\d/, /\bper month\b|\/mo\b|\bUSD\b/i, /\b\d+%/.
    - Relative links only: html with every occurrence of "support@creditguardhq.com" removed does not contain "creditguardhq.com"; html does not match /https?:\/\//; does not contain "cdn.shopify.com"; every href attribute matches /^(\/[^"']*|mailto:[^"']+)$/ (extract with a global regex over href="..." and assert each).
    - Self-contained: no <link, <script, <img (case-insensitive), contains "<style>"; no /<s-[a-z]/ and no "app-bridge"; no <form, <input, <button, no "/auth/login" (requirement 2.3.1 kept on this page too).
    - Source guards on app/routes/support.tsx: comment-stripped source (stripComments imported from ./helpers/module-source) contains "export const loader" (non-triviality anchor the helper's contract requires) and does not match /export\s+default\b/; the RAW module source with every "support@creditguardhq.com" removed does not contain "creditguardhq.com" and does not match /https?:\/\//; transitiveSources(ROUTE_FILE) has the route file and, for every reachable file, the stripped source does not match /shopify\.server/, /@shopify\/shopify-app-react-router/, or /\bauthenticate\s*[.(]/.
  </behavior>
  <action>
Write the failing suite first, then the route (RED then GREEN, one commit at the end of Task 3 — do not commit here).

`tests/support-route.test.ts`: start from `tests/landing-route.test.ts`. Keep its imports of `readFile`, `path`, `fileURLToPath`, vitest, and its `REPO_ROOT` / `ROUTE_FILE` constants (ROUTE_FILE → `app/routes/support.tsx`). Import `{ loader }` from `../app/routes/support`. REPLACE the private regex comment stripper with `import { stripComments } from "./helpers/module-source";` (the repo's single tokenizer-aware definition — a third regex copy would re-open the swallowed-block defect that helper's header documents) and copy `relativeImportsOf`, `resolveModule` and `transitiveSources` verbatim so the walker still strips each file before scanning its imports. Because the helper contract demands it, add the non-triviality anchor assertion on `export const loader` before any negative source assertion. `renderPage` is `await loader().text()` (the loader takes no request — there is no admin redirect on this route); keep `renderCopy` (style block stripped) for the price/percent assertions. Write every assertion listed in `<behavior>`. File header comment: explain the three assertion classes (behaviour, factual copy, source guards) and why the hostname rule exists (the page may move to the apex or a help subdomain without a code change). Do not put any absolute URL or bare hostname in that comment — the raw-source guard reads comments too.

`app/routes/support.tsx`: a resource route in the exact shape of `app/routes/privacy.tsx`'s tail — `const STYLES`, `const SUPPORT_HTML` rendered once at module load, and `export const loader = () => new Response(SUPPORT_HTML, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" } })`. No default export, no imports at all (nothing from react-router is needed when the loader takes no arguments). STYLES = the landing page's STYLES block with `main { max-width: 42rem; ... }` and the `h2`, `h3` and `p` rules copied from privacy.tsx so headings space correctly; same light and dark palette values as the landing page (listed in `<context>`). Body markup is the `<page_copy>` block verbatim; head carries the title and meta description given under it. Header comment (mirror the landing page's numbered-properties style): (1) UNAUTHENTICATED — like the landing, privacy and healthz routes it never imports the Shopify app server module, guarded by tests/support-route.test.ts; (2) RESOURCE ROUTE, no default export, because a default export renders through app/root.tsx and its CDN stylesheet; (3) FACTUAL COPY ONLY (1.1.4) — each FAQ maps to code: the Function's decision order for holds, `recomputeCompany` + the 5-minute attribution heal + hourly/daily sweeps for balance freshness, the 72h/72h touchpoints and per-order 24h limit for reminders, `redactShop` at ~48h for uninstall, Shopify App Pricing for billing; (4) NO HOSTNAME, RELATIVE LINKS ONLY — the page may later be served from the apex or a help subdomain, so the module and its output carry no host and no absolute URL; the only occurrence of the domain is inside the support email address. Keep that comment free of any URL and of the bare domain.

Run the two suites named in verify. Expected: the new suite fully green; the landing and privacy suites unchanged and green.
  </action>
  <verify>
    <automated>cd "/Users/hesamabbaszadi/Documents/Projects/Credit Guard" && export PATH="$HOME/.npm-global/bin:$PATH" && case "${TEST_DATABASE_URL:-postgresql://$USER@localhost:5432/creditguard_test}" in *creditguard_test*) ;; *) echo "TEST_DATABASE_URL must point at creditguard_test"; exit 1;; esac && (set -o pipefail; npm test -- tests/support-route.test.ts tests/landing-route.test.ts tests/privacy-route.test.ts 2>&1 | tail -12) && grep -q 'from "./helpers/module-source"' tests/support-route.test.ts && grep -q '"Cache-Control": "public, max-age=3600"' app/routes/support.tsx && grep -q '<title>Support — Credit Guard: B2B Net Terms</title>' app/routes/support.tsx && [ "$(grep -c '^import ' app/routes/support.tsx)" = 0 ] && echo TASK1-OK</automated>
  </verify>
  <done>tests/support-route.test.ts exists, imports stripComments from the shared helper, and passes in full against app/routes/support.tsx; the route module has zero imports, no default export, the exact title, headers and page copy; landing and privacy suites still pass; TASK1-OK prints.</done>
  <reversibility rating="reversible">A new public route plus its test; deleting both files restores the previous state with no data or platform side effect.</reversibility>
</task>

<task type="auto">
  <name>Task 2: Landing footer Support link, its assertion, and the CLAUDE.md route map</name>
  <files>app/routes/_index/route.tsx, tests/landing-route.test.ts, .claude/CLAUDE.md</files>
  <action>
`app/routes/_index/route.tsx`: in the `<footer>` of `LANDING_HTML`, change the privacy line to `<p><a href="/privacy">Privacy policy</a> · <a href="/support">Support</a></p>` (a middle-dot separator, same as the new page's own footer). Leave the following `Support: <a href="mailto:...">` line exactly as it is — the landing test asserts the address. Nothing else in the file changes; in particular do not add a hostname, a form, an input, a button, or the string "myshopify.com" (all negatively asserted by the landing suite).

`tests/landing-route.test.ts`: in the test "links the privacy policy and the support address", add `expect(html).toContain('href="/support"');` after the existing privacy-link assertion. No other change — its private stripper stays as it is (out of scope for this task; noted in the SUMMARY as a follow-up candidate).

`.claude/CLAUDE.md`: use Edit (scoped) on the four-line bullet quoted in `<context>` (lines 117-120). New text, hard-wrapped like its neighbours:
"- `_index/route.tsx` (~140) — the public landing page at `application_url`, what a reviewer sees with no `?shop`. `privacy.tsx` (270) — public policy, required by the listing and the PCD questionnaire. `support.tsx` (N) — public support/FAQ page, the listing's "Support / FAQ URL"; factual copy only, links relative or `mailto:`, no hostname literal (so it can move to the apex or a `help.` subdomain unchanged). `healthz.tsx` (9) — Railway probe. All four must **never** import `app/shopify.server` (guarded by tests)."
Replace `N` with the real line count of app/routes/support.tsx (`wc -l`). Also update the `tests/` line further down that says "28 files" to "29 files" only if `find tests -name '*.test.ts' | wc -l` reports 29 after your new file is added AND the number printed there is currently 28 — otherwise leave that sentence alone and mention the discrepancy in the SUMMARY.
  </action>
  <verify>
    <automated>cd "/Users/hesamabbaszadi/Documents/Projects/Credit Guard" && export PATH="$HOME/.npm-global/bin:$PATH" && grep -q '<p><a href="/privacy">Privacy policy</a> · <a href="/support">Support</a></p>' app/routes/_index/route.tsx && grep -q "href=\"/support\"" tests/landing-route.test.ts && grep -q 'All four must \*\*never\*\* import `app/shopify.server` (guarded by tests)' .claude/CLAUDE.md && grep -q '`support.tsx` ([0-9]*) — public support/FAQ page' .claude/CLAUDE.md && ! grep -q 'All three must' .claude/CLAUDE.md && (set -o pipefail; npm test -- tests/landing-route.test.ts tests/support-route.test.ts 2>&1 | tail -8) && echo TASK2-OK</automated>
  </verify>
  <done>The landing footer carries the /support link beside Privacy policy; the landing suite asserts it and passes; CLAUDE.md's public-route bullet names support.tsx with its line count and says "All four must never import"; TASK2-OK prints.</done>
</task>

<task type="auto">
  <name>Task 3: Full gates, SUMMARY, single commit</name>
  <files>.planning/quick/260904-ept-public-unauthenticated-support-page-for-/260904-ept-SUMMARY.md</files>
  <precondition>A local Postgres is reachable at TEST_DATABASE_URL (default postgresql://$USER@localhost:5432/creditguard_test) and that URL contains "creditguard_test"; the network is up so `npm run graphql-codegen` can validate documents rather than silently no-op.</precondition>
  <action>
Run every gate from the repo root with `export PATH="$HOME/.npm-global/bin:$PATH"` first, in this order, and record each result (pass/fail, test and file counts, wall time) for the SUMMARY:
1. `npm test` — must exit 0. Expected: the pre-existing suite plus `tests/support-route.test.ts`, 0 failed. If the ONLY failures are the two ledgered flakes (WINDOWS #25 "only ONE schedule per sweep" in tests/reminders.test.ts, WINDOWS #26 "ask after a success moment" in tests/review-prompt.test.ts), re-run `npm test -- tests/reminders.test.ts` and `npm test -- tests/review-prompt.test.ts` in isolation and treat green there as the gate result, saying so in the SUMMARY. Any other failure is real: fix it or stop.
2. `npm run graphql-codegen` — confirm its output shows documents being validated/generated (a silent, instant exit means it no-op'd offline and the next gate proves nothing); then `npm run typecheck`.
3. `npm run lint`.
4. `npm run build` — the only gate that catches a server module imported into client code.
Then `git status --porcelain` must list exactly: app/routes/support.tsx, tests/support-route.test.ts, app/routes/_index/route.tsx, tests/landing-route.test.ts, .claude/CLAUDE.md, and the quick directory's PLAN.md (untracked until now) — nothing under shopify.app.toml, prisma/, extensions/, app/services/, listing/, and NO change to either TOML's `api_version` (no Shopify CLI command was run, so none is expected; check anyway with `git diff --stat -- shopify.app.toml extensions/`).

Write `260904-ept-SUMMARY.md` per the summary template: what shipped, the discretion call (shared tokenizer stripper vs the landing suite's private copy), the FAQ-to-code mapping used to keep 1.1.4 true (especially the no-limit-never-held fact from Function step 6 before step 7), gate results, and the follow-ups that belong to the orchestrator, not this task: deploy to Railway; set the listing's "Support / FAQ URL" in the Partner Dashboard to the /support path on the production host; update 06-LISTING §1.9 / §9.5 from B1 to B2; consider migrating tests/landing-route.test.ts and tests/privacy-route.test.ts to the shared stripper; STATE.md quick-task row.

Make ONE commit containing exactly those five source/doc files plus this task's PLAN.md and SUMMARY.md, subject exactly `feat(support): public /support page for the listing's support URL`, via `gsd_run query commit "feat(support): public /support page for the listing's support URL" --files <the seven paths>` (fall back to `git add` of the same seven paths and `git commit -m` if the helper is unavailable). Do not amend, do not push, do not deploy.
  </action>
  <verify>
    <automated>cd "/Users/hesamabbaszadi/Documents/Projects/Credit Guard" && [ -f .planning/quick/260904-ept-public-unauthenticated-support-page-for-/260904-ept-SUMMARY.md ] && [ -z "$(git status --porcelain)" ] && [ "$(git log -1 --format=%s)" = "feat(support): public /support page for the listing's support URL" ] && [ "$(git show --stat --format= HEAD | grep -c '|')" = 7 ] && git show --stat --format= HEAD | grep -q 'app/routes/support.tsx' && git show --stat --format= HEAD | grep -q 'tests/support-route.test.ts' && git show --stat --format= HEAD | grep -q '260904-ept-PLAN.md' && [ -z "$(git show --stat --format= HEAD -- shopify.app.toml prisma extensions app/services listing)" ] && grep -q 'api_version = "2026-07"' shopify.app.toml extensions/credit-guard-validation/shopify.extension.toml && echo TASK3-OK</automated>
  </verify>
  <done>All four gates passed and are recorded in the SUMMARY; the working tree is clean after exactly one commit with the required subject touching the seven expected paths and nothing under shopify.app.toml, prisma/, extensions/, app/services/ or listing/; both API-version pins still read 2026-07; TASK3-OK prints.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| anonymous internet → GET /support | Unauthenticated public page fetched by merchants, reviewers and crawlers; whatever it says is a public product claim (App Store 1.1.4). |
| route module → app server code | A public route must never pull the Shopify app server module or call authenticate; doing so turns the listing URL into a 4xx. |
| page → external origins | The page must render with zero external requests; any absolute URL is a tracking/availability dependency the reviewer will see. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-QT-01 | Information disclosure | page copy | medium | mitigate | Copy is fixed verbatim in `<page_copy>`, contains no merchant, buyer, store or order data, and states only behaviour verified against the code facts in `<context>`; the suite pins every load-bearing claim so a later edit cannot drift silently. |
| T-QT-02 | Elevation of privilege | route module | high | mitigate | Resource route with zero imports; `tests/support-route.test.ts` walks the transitive import graph and fails on the Shopify app server module, the app library, or any authenticate call, and rejects a default export. |
| T-QT-03 | Tampering | rendered HTML | medium | mitigate | Tests reject any absolute URL, any `link`/`script`/`img` element, Polaris tags and App Bridge; every href must be relative or mailto. |
| T-QT-04 | Spoofing | hostname portability | low | mitigate | No hostname literal in module or output (only inside the support address), so serving from the apex or a help subdomain cannot leave a stale host in the page. |
| T-QT-05 | Denial of service | public GET | low | accept | Constant string rendered at module load, `Cache-Control: public, max-age=3600`; no per-request work, no database access. |
| T-QT-SC | Tampering | npm/pip/cargo installs | low | accept | No package is installed by this task; only existing repo scripts run. |
</threat_model>

<verification>
- `npm test -- tests/support-route.test.ts tests/landing-route.test.ts tests/privacy-route.test.ts` green (Task 1/2).
- `npm test`, `npm run graphql-codegen` + `npm run typecheck`, `npm run lint`, `npm run build` all exit 0 (Task 3).
- `git log -1 --format=%s` = `feat(support): public /support page for the listing's support URL`; working tree clean; commit touches nothing under shopify.app.toml, prisma/, extensions/, app/services/, listing/.
</verification>

<success_criteria>
All three TASK-OK gates print; GET /support renders the plan's copy verbatim with the required headers, no hostname, no absolute URL, no auth and no default export; the landing footer links to it; CLAUDE.md names it as the fourth guarded public route; one commit with the required subject; no deploy performed.
</success_criteria>

<output>
Create `.planning/quick/260904-ept-public-unauthenticated-support-page-for-/260904-ept-SUMMARY.md` when done, and include it (with this PLAN.md) in the single commit.
</output>
