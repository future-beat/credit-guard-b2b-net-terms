<!-- Hand-maintained working guide (rewritten 2026-08-25, at b8b8809). It replaced
     200 lines of pre-build stack research plus three stale placeholders. If a GSD
     doc-sync ever offers to regenerate this from CONVENTIONS.md / ARCHITECTURE.md,
     do not let it overwrite the content below — those source files do not exist. -->

# Credit Guard: B2B Net Terms — working guide

## What this app is

A Shopify public app that gives B2B merchants credit control over their net-terms
customers: per-company credit limits, a **hard checkout block** when a company is
over its limit or has overdue invoices (with a per-company bypass toggle),
Shopify-sent payment reminders on a three-touchpoint calendar, and an
accounts-receivable dashboard. It targets stores using Shopify's native B2B
features (companies, payment terms), where Shopify *records* terms but enforces
nothing. The one thing the product sells is that no B2B buyer places a new order
while over limit or overdue.

**Status:** v1.0.0, approved and listed on the Shopify App Store 2026-09-04 at
https://apps.shopify.com/credit-guard-b2b-net-terms (submitted 2026-08-24; six phases
complete, `.planning/STATE.md` → `listed`). Production runs on
Railway at `app.creditguardhq.com` with managed Postgres. Pricing is **Shopify
App Pricing** — one plan, US$29/month, 14-day trial, configured in the Partner
Dashboard with **zero billing code in this repo** (`app/routes/app.tsx` calls
`billing.check()` only, and the gate fails **open**). Node ≥20.19, React Router 7,
Prisma 6, Admin GraphQL **2026-07**.

---

## The constraint chain (read before changing anything)

Four facts, in order. Each one causes the next. Breaking any link breaks the
product, not just a test.

1. **Shopify Functions have no network access.** The `fetch` target is
   Enterprise/custom-app only. Our Cart & Checkout Validation Function
   (`extensions/credit-guard-validation/`) **cannot call the backend at checkout
   time**, ever.
2. **Therefore all credit state is pre-computed into a metafield.** The server
   writes the `$app` / `credit_v1` JSON metafield on the **Company**, and the
   Function reads it synchronously at checkout. That metafield is the *entire*
   server↔Function interface. Its payload law lives in the header of
   `app/services/metafields.server.ts` (contract home #2); home #1 is the
   `[company.metafields.app.credit_v1]` block in `shopify.app.toml`, home #3 is
   `tests/metafield-contract.test.ts`, whose fixtures are what the Function's own
   test fixtures are generated from. Breaking changes ship as a new `credit_v2`
   key published *alongside* — never a rename or an in-place retype.
   Staleness window ≈ webhook latency, bounded by an hourly publish backstop.
3. **`recomputeCompany` in `app/services/ledger.server.ts` is the SOLE writer** of
   `Company.exposure`, `overdue`, `earliestDueAt` and `blockedState`. Webhooks,
   the install backfill, the hourly overdue sweep and the daily reconciliation all
   funnel through it. It recomputes the whole company total from its stored
   `LedgerOrder` rows — **never `balance += delta`**. A second writer re-opens
   silent balance drift, which is the failure mode that blocks a paying customer.
4. **Attribution is COMPANY-SIDE.** An order keys to a Company only when its GID
   appears on Shopify's own authenticated `company(id){ orders }` connection.
   `Order.purchasingEntity` is scope-trapped behind `read_customers`, which this
   app **deliberately never requests** — Shopify nulls the field on every order
   with no error. Source-guard tests in `tests/credit-engine.test.ts` and
   `tests/graphql-error-surfacing.test.ts` fail if any GraphQL document reaches
   for it again.

**The PII posture is both a differentiator and a platform fact.** Reminders go
through `paymentReminderSend` on a `PaymentSchedule` GID the ledger already
stores; Shopify resolves the recipient, renders the merchant's own *Payment
reminder* template and sends from the merchant's authenticated sender. No email
SDK is installed, no buyer contact data enters this app, and no schema column
holds one. It is also enforced from outside: `Order.email`, `Order.customer` and
`Order.purchasingEntity` are **ACCESS_DENIED** to this app's scope set
(measured, 05-02-SUMMARY N3). `PRIVACY.md` and the Protected Customer Data
answer (Level 1, no protected fields) both rest on this.

Scopes (`shopify.app.toml`): `read_orders, read_all_orders, read_payment_terms,
read_companies, write_companies, write_validations, write_orders`.
`read_all_orders` is non-negotiable — without it Shopify silently returns only a
60-day window, which understates exposure, which lets an over-limit buyer
through.

---

## Module map

### `app/services/` — all the logic

| Module | Lines | What it owns |
|---|---|---|
| `ledger.server.ts` | 1405 | The AR engine. `recomputeCompany` (sole writer), `ingestOrderEvent` and the 3-rung attribution ladder, `upsertOrderFromSource`, and `graphqlJson` — the transport wrapper that throws `LedgerGraphqlError` on any top-level `errors[]` so a permission failure can never read as absent data. |
| `reminders.server.ts` | 1369 | The dunning calendar. Pure core (`deriveTouchpoints`, `selectEligible`) decides; the I/O half executes. Claim-then-send, per-order 24h guard, severity fence, status vocabulary. |
| `enforcement.server.ts` | 958 | `isBlockedState` / `wouldBlockOrder` predicates, the `EnforcementEvent` writer (best-effort, never throws to its caller), and `ensureValidationRegistered` / `readValidationConfig` / the `validationUpdate` echo. Re-exports the pure `block-messages` half. |
| `dashboard.server.ts` | 856 | The read model for the home page. **Zero Admin API calls** — a pure Postgres projection, so a Shopify outage cannot take the merchant's dashboard with it. Everything crossing the loader boundary is already a string. |
| `reconciliation.server.ts` | 668 | Daily 5-pass re-derivation from Shopify (cursor page → drift check → attribution → exhaustion flip → open-schedule probe). This is what makes the webhook path *allowed* to be imperfect. `runAttributionHealSweep` runs pass 3 alone every 5 minutes. |
| `backfill.server.ts` | 548 | Install-day balances. Company-driven, no age window, no status filter, one recompute path shared with the webhooks. |
| `onboarding.server.ts` | 532 | The 3-step guided setup and the Reviews API prompt bookkeeping. Only two facts are stored (`onboardingReviewedAt`, `onboardingDismissedAt`); steps 2 and 3 re-derive every load. The one Admin call on the home path lives here and only while the guide is visible. |
| `scheduler.server.ts` | 484 | node-cron loop + `SweepLease`. `forEachActiveShop` is the ONLY shop enumerator any sweep may use (a source-guard test fails if a second appears). |
| `metafields.server.ts` | 332 | `publishCompanyCreditState` — the single writer of `credit_v1`, plus the hash-skip bookkeeping (`publishedStateHash`, `publishedAt`). |
| `token-health.server.ts` | 257 | The WINDOWS #30 strike counter, in `SyncCursor` key `token-failures`. Time-gated to ONE strike per 30-minute window, so one sweep's burst over N companies counts once; three strikes in separate sweep cycles deactivate the shop and delete its sessions. Any successful GraphQL call resets it (one DELETE per shop per process). The hooks live in the admin seam. |
| `admin-client.server.ts` | 122 | The single seam to the Admin API for background code (`unauthenticated.admin`). The one module tests `vi.mock`, which is why real HMAC verification stays in the loop. Also hosts the token-health hooks — it is the only point that sees both the failure and the success signal. |
| `shop-lifecycle.server.ts` | 112 | Two-stage uninstall: `deactivateShop` retains, `redactShop` hard-deletes at T+48h, `ensureShopActive` restores on re-install. |
| `webhook-validate.server.ts` | 62 | `validateWebhookRequest` — the library authenticator's 405/401/400 contract with NO session load. Used by the compliance and uninstalled routes (WINDOWS #31). |
| `shop-currency.server.ts` | 23 | The shop's display currency — most recent ledger order's `currencyCode`. |

Cadences (`scheduler.server.ts`): hourly `0 * * * *` overdue sweep + publish
backstop; hourly `30 * * * *` reminder sweep (own lease); daily `30 3 * * *`
reconciliation; `*/5 * * * *` attribution heal.

### `app/routes/`

- `app.tsx` (210) — embedded shell. Reactivates the shop, fires the backfill and
  the validation ensure-step *unawaited*, and runs the billing gate.
- `app._index.tsx` (929) — the AR dashboard + guided setup + review prompt. Every
  string is byte-exact contract from `06-UI-SPEC.md`, held in a `COPY` const.
  Vocabulary is **"credit hold"**, never "blocked $X" — per-attempt blocks are
  unobservable on this platform, so a dollar total would be fiction.
- `app.companies.tsx` (873) — the merchant's whole control plane: per-company
  limit, bypass toggle, status badge. Shop from the session only; intents
  whitelisted; money validated by grammar then constructed as `Prisma.Decimal`.
- `app.settings.tsx` (634) — block-message editor + honest enforcement status read
  back from the Validation object (never our optimism), + the reminders switch.
- `_index/route.tsx` (~140) — the public landing page at `application_url`, what a
  reviewer sees with no `?shop`. `privacy.tsx` (270) — public policy, required by
  the listing and the PCD questionnaire.
  `support.tsx` (164) — public support/FAQ page, the listing's "Support / FAQ
  URL"; factual copy only, links relative or `mailto:`, no hostname literal (so
  it can move to the apex or a `help.` subdomain unchanged).
  `healthz.tsx` (9) — Railway probe.
  All four must **never** import `app/shopify.server` (guarded by tests).
- `webhooks.orders.tsx` (215), `webhooks.payment-terms.tsx` (181),
  `webhooks.companies.tsx` (151) — the three ledger ingest routes.
  `webhooks.compliance.tsx` (66) — the three mandatory GDPR topics. It and
  `webhooks.app.uninstalled.tsx` both verify through `validateWebhookRequest`
  and no longer use `authenticate.webhook`: they load no session, because the
  authenticator's refresh step 500s forever for a store that no longer exists
  (WINDOWS #31, fixed in 1.0.1).
  `webhooks.app.uninstalled.tsx`, `webhooks.app.scopes_update.tsx`,
  `webhooks.bulk-operations.tsx` (a deliberate registered no-op since 02-07).
- `auth.$.tsx`, `auth.login/` — template OAuth surface, unmodified.

### `extensions/credit-guard-validation/`

`src/cart_validations_generate_run.ts` — the *only* place a checkout is blocked.
Pure, dependency-free (one type-only import), so `tests/checkout-validation-function.test.ts`
imports `run` directly with no wasm runtime. Target `cart.validations.generate.run`,
`api_version = "2026-07"`, output shape `{ operations: [{ validationAdd: { errors:
[{ message, target: "$.cart" }] } }] }`. **Its 13-step decision order is locked**
and documented in the file header; reordering changes merchant-visible behaviour
and turns pinned tests red on purpose. Two orderings are load-bearing and
non-obvious: overdue is checked *before* money parsing (fail-open is per-rule, not
per-payload), and the `limit: "0.00"` block-all case skips the currency gate.

### `scripts/` — read-only production probes

Eight `prod-*.{sh,mjs}` pairs: `ledger-state`, `credit-metafields`,
`enforcement-events`, `reminder-state`, `reminder-recipients`, `validation-state`,
`billing-state`, `lifecycle-state`, plus `clear-backfill` (the one that writes).
Production Postgres is only reachable inside Railway's private network, so the
`.sh` base64-ships its `.mjs` sibling into the running container over `railway
ssh`, runs it in `/app`, and deletes it. `DATABASE_URL` never leaves the
container. Output is JSON on stdout and nothing else:

```bash
scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com | jq '.ledger'
```

Requires the railway CLI logged in with an SSH key registered — one-time setup is
in the README. Also here: `smoke-deployed.sh <host>` (healthz 200 + six
forged-HMAC surfaces answering 401, no error-suppressing fallbacks) and
`send-signed-webhook.sh`.

### `tests/`

29 suite files (31 as vitest counts them — two more live under `helpers/`).
`helpers/admin-client-mock.ts` (the Admin fake),
`helpers/webhook-hmac.ts` (real signatures — HMAC verification is never mocked),
`helpers/module-source.ts` (source-guard reader), `fixtures/` including
`function-inputs/` generated from the metafield contract.

---

## Conventions that actually emerged

**Money is never a float.** `Prisma.Decimal` server-side (`Decimal(19,4)` columns),
integer cents inside the Function (string surgery on the decimal point — never
`Number(x) * 100`). A float rounding artifact between a paying customer and a
checkout is the exact catastrophe this app exists to prevent, inverted.

**Three different limit comparisons exist, and all three are correct.** The header
of `isBlockedState` in `enforcement.server.ts` is the canonical statement; do not
"fix" one to match another:

| Where | Predicate | Question it answers |
|---|---|---|
| Companies-page badge (`app.companies.tsx`) | `exposure > limit` | "Has this company borrowed more than you allowed?" At exactly the limit, no — they used exactly what you gave them. So **at-limit reads "Within limit"**. |
| The Function (D4-01) | `exposure + cart > limit` | The per-checkout decision. At-limit-exactly with a zero cart is allowed. |
| `isBlockedState` (`blockedState` column, events) | `exposure >= limit` | "Can this company place ANY new net-terms order?" At exactly the limit, remaining credit is zero, so every positive cart fails — **zero remaining credit IS the order-blocking state**. |

Consequence, deliberately: a company sitting exactly at its limit shows "Within
limit" on the page *and* emits `BLOCK_STATE_ENTERED`. The badge reports borrowing;
the event reports blocking. Bypass is checked first in every one of them.

**Polaris WEB COMPONENTS only.** `s-page`, `s-card`, `s-badge`, `s-table`… loaded
from the App Bridge CDN. `@shopify/polaris` (React) is deprecated and **must never
be added** — only `@shopify/polaris-types@1.0.1` is installed, for types.
**Hard rule 4: the live catalog wins over any spec.** When a UI-SPEC names a tag,
prop, tone or icon, verify it against `node_modules/@shopify/polaris-types/dist/polaris.d.ts`
before writing it — several spec values had no catalog counterpart (`ToneKeyword`
has no `attention`; `s-badge` carries no `interestFor`) and the catalog won each
time.

**API version 2026-07, pinned in lockstep across three homes** —
`shopify.app.toml` `[webhooks] api_version`, `ApiVersion.July26` in
`app/shopify.server.ts` and `.graphqlrc.ts`, and
`extensions/credit-guard-validation/shopify.extension.toml`. Skew is how
`purchasingCompany` field drift gets in. **The Shopify CLI silently rewrites the
pin to the RC** (it has done so twice; 2026-10 is an unsupported RC). So the
**CF-5 byte-guard applies around every CLI invocation**: snapshot both TOMLs → run
the command → diff both → restore/re-pin `api_version = "2026-07"` and
`automatically_update_urls_on_dev = false`. `tests/scope-lockstep.test.ts` asserts
both pins so a rewrite fails the suite rather than production installs.

**Scopes live in four homes and must move together in one commit** — the TOML, the
Railway `SCOPES` service variable, the vitest env in `vitest.config.ts`, and the
guard suites (`tests/scope-lockstep.test.ts`, `tests/webhooks.b2b-events.test.ts`).
`app/shopify.server.ts` reads `process.env.SCOPES`, so a TOML change alone changes
nothing at runtime. **Never assert on `sessionScopes` literals:** Shopify returns
its canonical *granted* set with implied reads collapsed into writes
(`read_companies` disappears under `write_companies` and that is correct). Every
assertion in the suite is on the *requested* string.
Also expect a scope release to invalidate the dev store's offline token within
seconds — `ACCESS_DENIED` Sentry noise until re-consent is accepted, non-throwing,
healed by reconciliation. Do not roll back on it.

**Webhook handlers use claim-release.** `authenticate.webhook` is always the first
statement (it needs the raw signed body). The receipt id is claimed before any
work; on any throw the claim is **released** and the error rethrown so Shopify's
retry stays usable. The one exception is a named-class catch for
`SessionNotFoundError` — a post-uninstall delivery that is guaranteed to recur —
which marks the receipt processed and returns 200. Never a blanket catch, never a
message match. **The payload is a doorbell:** identifiers only, never an amount, a
status or a date; money always comes from the authenticated refetch.

**`metafieldsSet` / `validationCreate` / `validationUpdate` return `userErrors`
INSIDE `data`** with a 200 and an **empty top-level `errors[]`**. `graphqlJson`
only throws on the top-level channel, so every mutation call site must check
`data.<mutation>.userErrors` explicitly. A missing check is a silent failure.

**`validationUpdate` is NOT a partial update.** Measured live 2026-08-20: an
update carrying only `metafields` returned `userErrors: []` and flipped `enabled`
true → **false**. An omitted flag is re-defaulted, not left alone. So `enable` and
`blockOnFailure` are **echoed** from a read of the live rule immediately before the
write. There is no CAS on the platform; the TOCTOU window is acknowledged in a
comment at the echo site (WINDOWS #12) and its outcome is a visible reversion, not
silent disablement.

**Reminders are exactly-once by claim-then-send.** The `ReminderLog` row is
INSERTed with status `SENDING` *before* the mutation; the P2002 violation on
`@@unique([shop, scheduleGid, touchpoint])` **is** the dedupe. Never reorder those
two steps — crashing after the claim drops one reminder (harmless, the next
touchpoint fires), while send-then-log double-emails a real buyer. **An ambiguous
send outcome is terminal:** unknown `extensions.code` values land
`SENT_UNCONFIRMED`, which counts exactly as `SENT` for dedupe and is never
retried. Only `ACCESS_DENIED`/validation-class codes stay retriable. Shopify also
enforces an **undocumented one-reminder-per-ORDER-per-24h limit** (measured); the
sweep has a per-order guard reading `sentAt` and a retry window of 24h + 1h margin.
`Shop.remindersEnabledAt` null means OFF and is the default for every shop — the
sweep returns before it queries anything, so deploying this code cannot email
anyone until a merchant opts in.

**Transport-free modules exist for a build reason, not a style reason.**
`app/block-messages.ts`, `app/reminder-copy.ts`, `app/setup-copy.ts`,
`app/review-codes.ts` and `app/lib/money.ts` hold the pure halves that route
*components* need. Importing a `.server.ts` into client code **typechecks, passes
every unit test, and fails only at `react-router build`** ("Server-only module
referenced by client"). These files therefore import **nothing at all** — one
import here would be inherited by every route composing from them — and specs grep
them for `import` to keep it that way. The `.server` modules re-export them so
server code keeps a single import path.

**Enum-ish columns are validated by code, not by the database** —
`LedgerOrder.attributionStatus`, `EnforcementEvent.kind`, `ReminderLog.touchpoint`
and `.status`. A Postgres enum would make every new value a migration.

**Snapshots, not joins, for history.** `EnforcementEvent` and `ReminderLog` carry
`companyGid` / `companyName` / `orderGid` with **no foreign key**: the history of a
decision must outlive the company it was made about.

**Redaction contract:** every new shop-keyed model in `schema.prisma` needs a
`deleteMany` line in `redactShop` **and** a counter in `countsFor` in
`tests/shop-lifecycle.test.ts`. Present in one but not the other is a GDPR hole
nothing else catches. `EnforcementEvent` was the one that slipped (#32, fixed in
1.0.1).

---

## Testing and gates

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
npm test          # 885 tests, 31 files
```

- **Real Postgres, not a mock.** `pretest` runs `prisma migrate deploy` against
  `TEST_DATABASE_URL` (default `postgresql://$USER@localhost:5432/creditguard_test`).
  Tests must never touch `creditguard_dev`. Parallel agents get a scratch DB via
  `TEST_DATABASE_URL`. `fileParallelism: false` — every suite shares one database
  and serial files keep row-count assertions deterministic.
- **HMAC is never mocked.** `admin-client.server.ts` is the module tests replace;
  `authenticate.webhook` runs for real against a fixed committed dummy secret.
- **`npm run graphql-codegen` before `npm run typecheck`.** `app/types/` is
  gitignored (~10MB, 6.7MB of which is the pinned 2026-07 schema dump). The gate
  is *running* codegen — it validates every `#graphql` document against the schema
  and fails on a bad field — not storing its output. It **silently no-ops offline**,
  so a green typecheck after a failed codegen proves nothing.
- **`npm run build` is the ONLY gate that catches a server module imported into
  client code.** Tests and typecheck both pass on that mistake. Run it before
  claiming a route change is done.
- Also: `npm run lint`, and `scripts/smoke-deployed.sh` against the real host.

**Two known flaky tests** (both ledgered, neither a product defect):

- `tests/reminders.test.ts` → "only ONE schedule per sweep" (WINDOWS #25) —
  order-dependent on a reused test database; wants a fixture-isolation pass.
- `tests/review-prompt.test.ts` → "ask after a success moment" (WINDOWS #26) —
  exceeded its 5s timeout (5259ms) when the suite ran concurrently with a build;
  green in isolation.

---

## Where the real documentation lives

- **`.planning/`** is the project's memory and the reason source comments can be
  as terse as they are.
  - `ROADMAP.md` (6 phases), `REQUIREMENTS.md` (traceability: `LEDG-*`, `CRED-*`,
    `ENFC-*`, `REMD-*`, `DASH-*`, `LNCH-*`, `FOUND-*`), `PROJECT.md` (key
    decisions `D-01`…`D6-03`), `STATE.md` (position).
  - `WINDOWS.md` — **the cross-phase defect register. Check it first.** 32
    entries, 8 open (#11, #18, #19, #24, #25, #26, #27, #28), 1 waived (#4).
    `/gsd-ship` blocks while any are open. #23 (customer PII in screenshot 4)
    closed 2026-09-04: S4 retaken at 1600×900 with placeholder buyer data and
    swapped on the live listing.
  - `phases/NN-name/` — per phase: `NN-RESEARCH.md`, `NN-CONTEXT.md`,
    `NN-UI-SPEC.md`, `NN-VALIDATION.md`, `NN-PLAN-CHECK.md`, then `NN-MM-PLAN.md`
    / `NN-MM-SUMMARY.md` per plan, then `VERIFICATION.md`. Phase 6 also carries
    `06-LISTING.md`, `06-APP-STORE-SELF-REVIEW.md` and
    `06-DEBUG-ingest-latency.md`.
  - When a source comment says "research Pitfall 4" or "D5-01" or "T-04-13", the
    expansion is in that phase's RESEARCH / PROJECT decisions / threat model.
- **`.planning/research/MARKET-*.md`** (2026-09-05) — post-listing market
  research: `MARKET-COMPETITORS.md` (the eight-app credit-control cohort, suites,
  financing, Shopify's native roadmap), `MARKET-DEMAND.md` (B2B GMV growth,
  late-payment data, merchant quotes, TAM/SAM/SOM), `MARKET-CHANNELS.md`
  (App Store mechanics, channel ranking, pricing and retention benchmarks).
  Synthesised in the go-to-market artifact "The Credit Guard Playbook".
- **`site/`** — the static marketing page at `creditguardhq.com` (Vercel project
  `credit-guard-site`, deployed from the CLI, no coupling to the app). Copy must
  match the App Store listing; see the runbook's "Marketing site" section.
- **`README.md`** — the concise overview (what it is, how it works, layout,
  quick start). **`docs/RUNBOOK.md`** — the operations runbook: local dev,
  Railway deployment and variables, production database inspection, live
  evidence blocks, scope table, reminders proof, billing, launch runbook,
  marketing-site deploy and DNS.
- **`CHANGELOG.md`** — the release record (1.0.0, 2026-08-24).
- **`PRIVACY.md`** — served verbatim at `GET /privacy`; the listing and the PCD
  questionnaire both point at it.
- **`AGENTS.md` / root `CLAUDE.md`** — use the Shopify AI Toolkit for all Shopify
  API and platform work; do not add tooling to this repo.

**Recent repo hygiene (b8b8809, 2026-08-25):** `screenshots/` + `icon/` are now
`listing/`; `.cursor/` and `.gemini/` MCP configs were removed (unused hosts);
`LICENSE` is MIT for the code; the Credit Guard name, logo and listing assets are excluded (`TRADEMARKS.md`).

---

## Traps that already cost this project a cycle

- **`Order.purchasingEntity` is scope-trapped behind `read_customers`** — Shopify
  nulls it with no error, and it zeroed the entire ledger (every exposure
  `0.0000`) until company-side attribution replaced it. Never reach for it.
- **`validationUpdate` re-defaults omitted flags** — a copy edit that carried only
  `metafields` silently disabled the merchant's own checkout enforcement, and the
  settings page reported "disabled" honestly while nobody knew why.
- **Order attribution used to be attempted exactly once**, at webhook time, so a
  miss sat `UNRESOLVED` until the next daily cron — fixed by a rung-1 retry plus
  the 5-minute `attribution-heal` sweep.
- **`authenticate.webhook` refreshes an expired offline token BEFORE the handler
  runs** — for a store that vanished without sending `app/uninstalled`, that
  refresh fails forever and every `shop/redact` 500s, so the store's data is
  never redacted (#31). Session-free routes must use `validateWebhookRequest`.
- **`tests/helpers/module-source.ts` strips comments before a source guard runs** —
  a second definition of "what counts as a comment" would quietly blank the very
  guards that keep `purchasingEntity` and second shop-enumerators out.
- **`bypassCartValidations` does NOT exist in 2026-07** — `draftOrderComplete`
  takes `id`, `paymentGatewayId`, `sourceName` only (schema-introspected). There is
  no sanctioned merchant bypass to model; a leak is observed *after the fact* as a
  `BYPASSED_ORDER` enforcement event carrying the order's `sourceName`.
- **`shopify app dev` with `automatically_update_urls_on_dev = true`** would
  publish an ephemeral tunnel URL to the live registration and break install and
  OAuth for real merchants. Every deploy ships the TOML unconditionally now.

---

## GSD workflow enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD
command so planning artifacts and execution context stay in sync.

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly
asks to bypass it.

No project skills are defined (`.claude/skills/` does not exist); the Shopify
plugin skills come from the agent host, not this repo.
