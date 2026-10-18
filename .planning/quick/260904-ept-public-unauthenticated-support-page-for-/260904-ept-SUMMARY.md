---
quick_id: 260904-ept
phase: quick-260904-ept
plan: 01
type: quick
subsystem: ui
tags: [react-router, resource-route, app-store-listing, support, faq, public-route]

requires:
  - phase: 06-launch
    provides: "06-LISTING §1.9 / §9.5 — the Support / FAQ URL field, which shipped empty (email-only) because the apex domain is attached to the demo store"
provides:
  - "GET /support — a public, unauthenticated support/FAQ page suitable for the listing's Support / FAQ URL"
  - "tests/support-route.test.ts — behaviour, factual-copy, relative-link and transitive source guards for the new route"
  - "A Support link in the landing footer, asserted by tests/landing-route.test.ts"
  - "support.tsx named in .claude/CLAUDE.md as the fourth guarded public route"
affects: [06-launch listing fields, future public-route work, landing/privacy source-guard migration]

actuals:
  tokens: 6491
  tasks: 3
  commits: 1

tech-stack:
  added: []
  patterns:
    - "Fourth zero-import resource route on the public surface, guarded transitively like _index and privacy"
    - "New source-guard suites import stripComments from tests/helpers/module-source rather than carrying a private regex copy"
    - "Hostname-free public page: every link relative or mailto:, so the page can be re-hosted with no code change"

key-files:
  created:
    - app/routes/support.tsx
    - tests/support-route.test.ts
  modified:
    - app/routes/_index/route.tsx
    - tests/landing-route.test.ts
    - .claude/CLAUDE.md

key-decisions:
  - "tests/support-route.test.ts imports the shared tokenizer-aware stripComments instead of copying the landing suite's private regex — a third definition of 'what counts as a comment' would re-open the swallowed-block defect that helper documents"
  - "Every negative source assertion is preceded by an `export const loader` non-triviality anchor, as the helper's contract requires"
  - "The route module carries zero imports: the loader takes no arguments, so nothing from react-router is needed"
  - "No hostname literal anywhere in module or output except inside the support address, so the page can later move to the apex or a help subdomain unchanged"
  - "The FAQ never quotes a price or trial length — Shopify App Pricing owns both, and a figure here would only drift"

patterns-established:
  - "Public-route guard suite shape: BEHAVIOUR + FACTUAL COPY + RELATIVE-LINKS/NO-HOSTNAME + SELF-CONTAINED + SOURCE GUARDS, with the shared stripper"

requirements-completed: [LNCH-03]

coverage:
  - id: D1
    description: "GET /support returns 200 text/html; charset=utf-8, Cache-Control public, max-age=3600, and a complete standalone HTML document"
    requirement: LNCH-03
    verification:
      - kind: unit
        ref: "tests/support-route.test.ts#GET /support — response"
        status: pass
    human_judgment: false
  - id: D2
    description: "Page copy is factual only: contact promise, four include-in-email bullets, three in-app pointers, six FAQ answers each grounded in shipped behaviour"
    requirement: LNCH-03
    verification:
      - kind: unit
        ref: "tests/support-route.test.ts#GET /support — factual copy (requirement 1.1.4)"
        status: pass
    human_judgment: false
  - id: D3
    description: "No hostname literal outside the support address, no absolute URL of any scheme, every href relative or mailto:"
    verification:
      - kind: unit
        ref: "tests/support-route.test.ts#GET /support — relative links only, no hostname"
        status: pass
    human_judgment: false
  - id: D4
    description: "Resource route with no default export that never reaches the Shopify app server module or the app library, directly or transitively, and never authenticates"
    verification:
      - kind: unit
        ref: "tests/support-route.test.ts#GET /support — source guards"
        status: pass
      - kind: integration
        ref: "npm run build (the only gate that catches a server module in client code)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The landing footer links to /support beside Privacy policy, and the landing suite asserts it"
    verification:
      - kind: unit
        ref: "tests/landing-route.test.ts#links the privacy policy and the support address"
        status: pass
    human_judgment: false
  - id: D6
    description: "The rendered page reads well to a merchant and a Shopify reviewer once served from the production host"
    verification: []
    human_judgment: true
    rationale: "Prose tone, visual layout in both colour schemes, and whether the six questions are the ones merchants actually ask are judgements no assertion can make; the page has not yet been deployed."

duration: 16min
completed: 2026-09-04
status: complete
---

# Quick 260904-ept: Public /support page for the listing's support URL Summary

**GET /support now serves a hostname-free, zero-import public support/FAQ page whose every load-bearing claim is pinned to the behaviour this repo actually implements — closing the one App Store listing field that shipped empty.**

## Performance

- **Duration:** ~16 min
- **Tasks:** 3/3
- **Commits:** 1

## Accomplishments

- **`app/routes/support.tsx` (164 lines).** A resource route in the shape of `privacy.tsx`'s tail: `STYLES`, a `SUPPORT_HTML` constant rendered once at module load, and `export const loader = () => new Response(...)` with `Content-Type: text/html; charset=utf-8` and `Cache-Control: public, max-age=3600`. **Zero imports** — the loader takes no arguments, so unlike the landing page it needs nothing from react-router. No default export, so it never renders through `app/root.tsx` and its CDN stylesheet link. Discovered by `flatRoutes()` purely by filename; there was no registration step.
- **`tests/support-route.test.ts` (366 lines, 16 tests).** Five describe blocks: response headers and document shape; factual copy (every bullet, every FAQ heading, every load-bearing sentence); relative-links/no-hostname; self-containment and the 2.3.1 no-install-path rule carried over from the landing page; and transitive source guards.
- **Landing footer.** `<p><a href="/privacy">Privacy policy</a> · <a href="/support">Support</a></p>`, with the existing `Support: mailto:` line untouched (the landing suite asserts the address). `tests/landing-route.test.ts` now asserts `href="/support"`.
- **`.claude/CLAUDE.md`.** The public-route bullet now names `support.tsx` (164) with its portability rule and reads "All four must **never** import `app/shopify.server` (guarded by tests)."

## Discretion call: the shared comment stripper

`tests/landing-route.test.ts` and `tests/privacy-route.test.ts` each carry a **private regex** `stripComments`, both predating the 260822-2h1 fix that made `tests/helpers/module-source.ts` the single tokenizer-aware definition. That regex has a documented defect: it strips block comments before line comments, so a `/*`-like run inside a `//` comment opens a phantom block that swallows code until the next close — and every guard on the swallowed region passes against an empty string.

The new suite therefore **imports `stripComments` from `./helpers/module-source`** and copies only the three import-graph walkers (`relativeImportsOf`, `resolveModule`, `transitiveSources`) from the landing suite. Per that helper's contract, every negative source assertion is preceded by a non-triviality anchor (`expect(source).toContain("export const loader")`), so a stripper defect can never satisfy a guard with `""`.

The two older suites were left as they are — out of scope for this task, and listed under follow-ups.

## FAQ-to-code mapping (how 1.1.4 stays true)

| FAQ answer | Grounded in |
|---|---|
| "a limit set … Bypass off … over limit **or** overdue" and **"Companies with no credit limit set are never held."** | The Function's LOCKED decision order in `extensions/credit-guard-validation/src/cart_validations_generate_run.ts`: step 5 bypass → allow, **step 6 `limit` null/absent → allow (observe-only, CRED-04) BEFORE** step 7 overdue → BLOCK. Because the no-limit allow is checked first, an unlimited company is never held even when overdue — the single most counter-intuitive fact on the page, and the reason the ordering is stated as a sentence rather than implied. |
| "raising the limit alone does not clear an overdue hold" | Step 7 blocks on `overdue === true` regardless of the limit; only step 12 (`exposure + cart > limit`) is limit-sensitive. |
| "within seconds … retried within five minutes … hourly … once a day" | `recomputeCompany` on the order and payment-terms webhooks; the rung-1 attribution retry plus the `*/5 * * * *` attribution-heal sweep; the hourly overdue sweep and publish backstop; the daily reconciliation's 5-pass re-derivation. |
| "off by default … 72 hours before the due date, on the due date, and 72 hours after it" | `Shop.remindersEnabledAt` null = OFF; `DUE_SOON_LEAD_MS` and `OVERDUE_OFFSET_MS` both 72h in `reminders.server.ts`. |
| "At most one reminder is sent per order in any 24-hour period." | Shopify's measured, undocumented one-reminder-per-ORDER-per-24h limit; `PER_ORDER_GUARD_MS = 25h`. |
| "Shopify sends the emails from your store's own email address … Credit Guard never sees the recipient" / "never stores buyer contact details" | `paymentReminderSend` on a stored `PaymentSchedule` GID; no email SDK, no schema column for a contact detail, and `Order.email` / `Order.customer` / `Order.purchasingEntity` are ACCESS_DENIED to this scope set. |
| "about 48 hours after uninstall … reinstall before then restores your settings" | `shop-lifecycle.server.ts`: `deactivateShop` on uninstall, `redactShop` on `shop/redact` at ~T+48h, `ensureShopActive` on re-install. |
| "one plan, charged on your Shopify bill; the current price and any free trial are shown on Shopify's plan page" | Shopify App Pricing, zero billing code in the repo. **No figure is quoted** — the price would drift from Shopify's own page and the test asserts no `$`, no `USD`, no `per month`, no percentage. |

## Gate results

| Gate | Result |
|---|---|
| `npm test` | **PASS** — 30 files, **869 tests passed, 0 failed**, 14.05s. Both ledgered flakes (WINDOWS #25 `reminders.test.ts` "only ONE schedule per sweep", #26 `review-prompt.test.ts` "ask after a success moment") passed on the first run; no isolation re-run was needed. |
| `npm run graphql-codegen` | **PASS** — not a silent no-op: the run reported "Load GraphQL schemas ✔ / Load GraphQL documents ✔ / Generate ✔" for both `admin.types.d.ts` and `admin.generated.d.ts`, so every `#graphql` document was validated against the pinned 2026-07 schema. |
| `npm run typecheck` | **PASS** — exit 0 (`react-router typegen && tsc --noEmit`). |
| `npm run lint` | **PASS** — exit 0, no findings. |
| `npm run build` | **PASS** — exit 0, 42 modules transformed, `build/server/index.js` 225.34 kB, `routes/support` present in the SSR bundle. This is the only gate that would catch a server module reaching client code. |
| Forbidden paths | `git diff --stat -- shopify.app.toml extensions/` empty; nothing touched under `prisma/`, `app/services/`, `listing/`, `PRIVACY.md`, `README.md`, `.planning/STATE.md`. |
| API version pins | Both byte-identical: `shopify.app.toml:81` and `extensions/credit-guard-validation/shopify.extension.toml:7` read `api_version = "2026-07"`. No Shopify CLI command was run. |

## Deviations from Plan

None affecting behaviour. Two recorded judgement calls:

1. **The "28 files" line in `.claude/CLAUDE.md` was left alone,** exactly as the plan's conditional instructed. The plan said to change it to "29 files" only if `find tests -name '*.test.ts' | wc -l` reported **29 after** the new file was added. It reported **29 before** and **30 after** — the doc's counts (`838 tests, 28 files`, line 286, and "28 files" at line 161) were already stale before this task. Actual today: **30 files, 869 tests**. Flagged as a follow-up rather than fixed mid-task, since the discrepancy predates this change and correcting it silently would hide how stale the number had become.
2. **CLAUDE.md hard wrapping.** The plan's replacement text was re-wrapped so that `` `support.tsx` (164) — public support/FAQ page `` and `All four must **never** import ...` each sit on a single line — the task's own verify greps are line-oriented and a wrap through either phrase would have failed them. Wording is otherwise verbatim; `_index/route.tsx` is labelled `(~140)` as the plan specified (it is still 139 lines).

## Notes

- **`.myshopify.com` appears once in the page copy** ("your store's .myshopify.com domain", the first include-in-email bullet). This is verbatim from the plan's `<page_copy>` block and is a *buyer-supplied* identifier, not a deployment hostname — the portability rule the tests enforce is specifically about *our* host, so the assertions target `creditguardhq.com` and any absolute URL. Note that the landing suite negatively asserts `myshopify.com`; the support suite deliberately does not, because 2.3.1 forbids *asking for* the domain in a form, not naming it in a support checklist. The support page has no form, input or button, and that is asserted.
- The route header comment is itself free of any URL and of the bare domain, because one source guard reads the **raw** file (comments included): a host left in a comment is a host the next editor copies into markup.

## Known Stubs

None. No placeholder copy, no TODO/FIXME, no unwired data path — the page is a constant string with no data source.

## Follow-ups (orchestrator's, not this task's)

1. Deploy to Railway.
2. Set the listing's **Support / FAQ URL** in the Partner Dashboard to the `/support` path on the production host.
3. Update `06-LISTING` §1.9 / §9.5 from option B1 (email-only) to B2 (support page).
4. Consider migrating `tests/landing-route.test.ts` and `tests/privacy-route.test.ts` off their private regex strippers onto `tests/helpers/module-source`, each paired with a non-triviality anchor.
5. Refresh the stale test counts in `.claude/CLAUDE.md` (lines ~161 and ~286: "28 files" / "838 tests, 28 files" → **30 files, 869 tests**).
6. Record the quick-task row in `.planning/STATE.md`.

## Self-Check: PASSED
