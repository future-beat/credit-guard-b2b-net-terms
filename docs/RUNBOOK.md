# Credit Guard — operations runbook

The long-form operating reference for Credit Guard: B2B Net Terms. The
project overview lives in the top-level [`README.md`](../README.md); this file
holds everything an operator needs — architecture detail, local development,
Railway deployment and variables, production probes, scopes, enforcement and
reminder verification, billing, the launch runbook and the marketing site.
Section anchors below are linked from the README.

## Architecture

**One platform constraint dictates the whole design.** A checkout is blocked by
a **Shopify Function** — the Cart and Checkout Validation API, target
`cart.validations.generate.run`, in `extensions/credit-guard-validation/`. That
Function runs in a deterministic wasm sandbox with **no network access**: the
`fetch` target is limited to custom apps on Enterprise, so a public app's
Function cannot call its own backend at checkout time. Everything the decision
needs must already be *on the record the Function can read*. That is why credit
state is **pre-published to a metafield** instead of served from an endpoint.

```
Shopify webhook (doorbell)
      │
      ├─► refetch the order from the Admin API
      │
      ▼
Postgres ledger  ──►  recomputeCompany()          ← the ONLY writer of
      (LedgerOrder,       (ledger.server.ts)         Company.exposure / overdue
       LedgerSchedule)         │                     / earliestDueAt
                               ▼
                    publishCompanyCreditState()   ← the ONLY writer of the
                        (metafields.server.ts)       server↔Function contract
                               │
                               ▼
              $app / credit_v1  JSON metafield on the Company
                               │
   [ net-terms checkout ]      ▼
              Validation Function reads it synchronously, no network
                               │
                     ┌─────────┴─────────┐
                   allow            credit hold
```

**Webhooks are doorbells, never deltas.** Fifteen order-, payment-terms- and
company-shaped topics land on four routes (`shopify.app.toml` `[webhooks]`).
A delivery says only "order X moved"; the handler refetches the order from the
Admin API and re-derives the company's whole total. There is no `balance +=
delta` anywhere — incremental arithmetic drifts silently, and a wrong balance
blocks a paying customer.

**Attribution comes from Shopify's own company→orders edge.** An order keys to a
company only when its GID appears on `company(id){ orders }`. Never the buyer
contact (on a B2B order that resolves to the person, not the company that owes
the money), and never `Order.purchasingEntity` — that union is scope-trapped
behind `read_customers`, which this app deliberately does not request, so
Shopify nulls it on every order.

**`credit_v1` is the entire server↔Function contract.** Namespace `$app`, key
`credit_v1`, type `json`, owner Company. Money is **decimal strings, never JSON
numbers** — a float rounding artifact would phantom-block a paying customer,
which is this app's failure inverted. `limit: null` (observe-only, the default)
is byte-distinct from `"0.00"` (block-all). The payload law lives in the header
of `app/services/metafields.server.ts` and is locked by
`tests/metafield-contract.test.ts`, whose fixtures are the source the Function's
own fixtures are generated from.

**The Function's decision order is locked** (`cart_validations_generate_run.ts`),
and every unrecognised or malformed input fails **open**: no purchasing company →
allow (a D2C checkout is never touched); no `credit_v1` → allow; `bypass: true` →
allow, and it is the *first* enforcement check, outranking both rules; `limit`
null → allow (a fresh install enforces nothing until a merchant sets a limit);
`overdue: true` → **block**; `exposure + cart > limit` → **block**. At-limit
exactly is allowed. `blockOnFailure` is pinned `false` at registration, so a
crash or timeout in our own code can never stop a real sale.

**Staleness is bounded by webhook latency**, plus an hourly publish backstop.
Four sweeps run in-process (`node-cron`, `app/services/scheduler.server.ts`),
each claiming its **own** named row in `SweepLease` with a single atomic
`UPDATE` — sharing a lease would let a slow pass suppress an unrelated one:

| Sweep | Cadence | Lease | What it is for |
| ----- | ------- | ----- | -------------- |
| `overdueSweep` | hourly, `0 * * * *` | `overdue-sweep` | Nothing in Shopify fires a webhook because time passed. Flips companies into and out of overdue, then runs the hash-skipped `credit_v1` publish backstop — the retry channel for a failed metafield write. |
| `reminderSweep` | hourly, `30 * * * *` | `reminder-sweep` | The dunning calendar. Minute 30 so it never queues behind the ledger pass. |
| `runAttributionHealSweep` | every 5 min, `*/5 * * * *` | `attribution-heal` | Ceiling on how long a new B2B order can sit outside its company's exposure. Gated on one indexed read per shop, so a clean shop makes zero API calls. |
| `runReconciliationSweep` | daily, `30 3 * * *` | `reconciliation` | Full re-derivation from Shopify. |

`forEachActiveShop` is the **only** shop enumerator: `Shop.active = false` means
the merchant uninstalled, and background work for them would be unauthorised
processing, so the gate lives in the iteration primitive where it cannot be
forgotten.

**Reminders are sent by Shopify, not by this app.** One mutation —
`paymentReminderSend(paymentScheduleId)` — asks Shopify to resolve the recipient
and send the merchant's own *Payment reminder* notification from the merchant's
authenticated sender. The app supplies a payment-schedule ID and the timing, and
nothing else. There is no email SDK, no sending domain, no deliverability
surface of ours, and **no buyer email address anywhere in the app or the
database** — which is what keeps [`PRIVACY.md`](PRIVACY.md) §3's no-customer-PII
claim true.

**The dashboard is a pure projection of Postgres.** There is no Admin API call
anywhere in `dashboard.server.ts`, so a Shopify outage cannot break the
merchant's home page. Every value crosses the loader boundary already formatted
as a string, so server-rendered and hydrated markup cannot disagree.

**What is deliberately not measured.** Per-checkout-attempt refusals are **not
observable**: Function runs are not webhooked and API 2026-07 exposes no trace of
a refused checkout. So the app counts what it *can* see — `BLOCK_STATE_ENTERED` /
`BLOCK_STATE_EXITED` transitions and `BYPASSED_ORDER` rows (an order that landed
while its company was on hold, carrying the order's `sourceName`) — and never a
dollar total of checkouts it stopped, which would be fiction. The dashboard,
listing and in-app copy all say "credit hold" for the same reason (06-LISTING §1
honesty rule, D6-02).

## Repository layout

| Path | Contents |
| ---- | -------- |
| `app/` | The React Router 7 app. `routes/` (embedded admin pages, the webhook routes, `/healthz`, the public landing and privacy pages) and `services/*.server.ts` — `ledger`, `metafields`, `enforcement`, `reminders`, `reconciliation`, `backfill`, `dashboard`, `onboarding`, `scheduler`. UI is Polaris **web components** via the App Bridge CDN; `@shopify/polaris` React is not installed. |
| `extensions/credit-guard-validation/` | The Cart and Checkout Validation Function. `src/cart_validations_generate_run.ts` is pure and dependency-free so the root Vitest suite imports it directly and exercises every branch without a wasm runtime; `dist/function.wasm` is the built artifact. |
| `prisma/` | `schema.prisma` (11 models — sessions, shops, companies, the order/schedule ledger, webhook receipts, sync cursors, sweep leases, compliance requests, enforcement events, reminder log) and migrations. |
| `scripts/` | Production probes, one per subsystem (`prod-*.sh`, each a thin wrapper over a `.mjs` uploaded and executed inside the running container), plus `smoke-deployed.sh` and `send-signed-webhook.sh`. All read-only except `prod-clear-backfill.sh`, which resets one sync cursor. Catalogued under [Verifying the deployed app](#verifying-the-deployed-app). |
| `tests/` | The Vitest suite, run against a local `creditguard_test` Postgres. Includes source-guard tests that fail the build on scope drift, a second writer of `Company.exposure`, or a second shop enumerator. |
| `listing/` | App Store listing assets — `listing/icon/`, `listing/screenshots/`. |
| `.planning/` | GSD planning artifacts: `ROADMAP.md`, `REQUIREMENTS.md`, `WINDOWS.md` (the open-defect ledger), and per-phase plans, summaries and verifications. Not shipped. |

## Local development

**Prerequisites**

- Node `>=20.19 <22 || >=22.12` (see `package.json` `engines`).
- A local **PostgreSQL** — this app does not run on SQLite. The Prisma
  datasource is `postgresql` and the code uses Postgres-specific SQL (the sweep
  lease claim is a raw `UPDATE … lockedUntil < now()`).
- The **Shopify CLI**, installed globally. On this machine it lives under an
  `~/.npm-global` prefix, so prepend `export PATH="$HOME/.npm-global/bin:$PATH"`
  before any `shopify` command.

**Setup and run**

```shell
npm install
cp .env.example .env          # then fill it in; .env is gitignored
npm run dev                   # = shopify app dev, with the Sentry server SDK imported
```

`automatically_update_urls_on_dev = false` is set in `shopify.app.toml` on
purpose: `application_url` points at production, and with that flag true the CLI
would silently rewrite it to an ephemeral tunnel URL — which every
`shopify app deploy` now publishes unconditionally, breaking install and OAuth
for real merchants. Local dev prompts for the URL swap instead.

**The byte-guard, around every `shopify` CLI invocation (CF-5).** The CLI
rewrites config files it did not ask you about — most often re-pinning
`api_version` from the stable `2026-07` to the `2026-10` release candidate. So:
snapshot `shopify.app.toml` **and**
`extensions/credit-guard-validation/shopify.extension.toml`, run the command,
diff both, and restore or re-pin (`api_version = "2026-07"`,
`automatically_update_urls_on_dev = false`) if either moved. This has caught a
real rewrite more than once; it is not theatre.

**Tests**

```shell
export PATH="$HOME/.npm-global/bin:$PATH"
npm test                      # vitest run; `pretest` applies migrations first
```

The suite needs a running Postgres and uses `creditguard_test` — never
`creditguard_dev`. Prisma will not fall back to the OS user the way `psql` does,
so the URL always carries an explicit role; override wholesale with
`TEST_DATABASE_URL` when the local role differs:

```shell
TEST_DATABASE_URL="postgresql://<role>@localhost:5432/creditguard_test" npm test
```

Files run serially (`fileParallelism: false`) because every suite shares one
database and several assert exact row counts. The test env in `vitest.config.ts`
pins `SCOPES` to the shipped string, so the suite exercises the configuration
that ships.

**Everything else**

```shell
npm run typecheck             # react-router typegen && tsc --noEmit
npm run lint
npm run build
npm run graphql-codegen       # Admin types into app/types/, from admin-2026-07.schema.json
```

Codegen is worth keeping current: the Admin documents are typed against the
committed 2026-07 schema, which is what turns a mistyped field on the AR queries
into a build error rather than a silently-null value. `.graphqlrc.ts` also picks
up each extension's own `schema.graphql` automatically. The Function has its own
`npm run typegen` / `build` inside its workspace.

## Deployment (Railway)

Production runs as a single always-on Railway service with an attached managed
Postgres. There is no staging environment (D-01); local `shopify app dev`
tunnelling to the dev store is the pre-production loop.

Deploy-time settings live in `railway.json` (config-as-code, committed) so they
survive dashboard edits and are reproducible:

| Setting             | Value                  | Why                                                                                                   |
| ------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Start command       | `npm run docker-start` | `= npm run setup && npm run start` — runs `prisma generate && prisma migrate deploy` on every release, then serves. **Never** replace with a raw `react-router-serve` call: the `NODE_OPTIONS='--import ./instrument.server.mjs'` flag that loads the Sentry **server** SDK lives inside the `start` npm script, and bypassing npm silently downgrades error tracking to client-only. |
| Health check path   | `/healthz`             | Unauthenticated 200; gates every deploy                                                                |
| Health check timeout| `300` s                | Railway default                                                                                        |
| Restart policy      | `ON_FAILURE`, 10 retries | Crash-loop containment                                                                               |
| Builder             | Dockerfile (`/Dockerfile`) | Auto-detected from the template's Dockerfile; `EXPOSE 3000` is ignored at runtime — the app binds Railway's injected `PORT`. **Because the builder is a Dockerfile, Railway does not inject service variables into the build** — any variable the *build* needs must be declared as an `ARG` in the Dockerfile (see `SENTRY_DSN` below) |
| Region              | `us-east4-eqdc4a` (Virginia, USA) — satisfies D-02 | Shopify's webhook infrastructure is US-based and Phase 2's ledger is webhook-driven, so a EU region would pay transatlantic latency on the enforcement-critical metafield-write path. Both `credit-guard-app` and `Postgres` were moved from `ams` to US East on 2026-08-18; app region is pinned in `railway.json` (`deploy.multiRegionConfig`). |

### Railway resources

| Resource         | Name                | Notes                                              |
| ---------------- | ------------------- | -------------------------------------------------- |
| Project          | `credit-guard`      |                                                    |
| App service      | `credit-guard-app`  | Deployed from the local directory via `railway up` |
| Database service | `Postgres`          | Managed Postgres, private networking               |

### Service variables

Names only — values live solely in Railway and in the gitignored local `.env`;
none are ever committed.

| Variable              | Value / source                                                                 |
| --------------------- | ------------------------------------------------------------------------------ |
| `SHOPIFY_APP_URL`     | `https://app.creditguardhq.com`                                                  |
| `SHOPIFY_API_KEY`     | Partner app client ID (`shopify app env show`)                                   |
| `SHOPIFY_API_SECRET`  | Partner app client secret — **secret variable**, never echoed                    |
| `DATABASE_URL`        | Reference variable `${{Postgres.DATABASE_URL}}`, resolves to `postgresql://…@postgres.railway.internal:5432/railway` |
| `SENTRY_DSN`          | Sentry project client key (public, write-only ingest key — not a secret). **Needed at BUILD time as well as runtime**: the browser DSN is inlined into the client bundle by Vite (`envPrefix: ["VITE_", "SENTRY_DSN"]`). Two things must both hold, or client-side capture is silently dead while the server side keeps working: (1) the variable exists in Railway *before* the build, and (2) the Dockerfile declares `ARG SENTRY_DSN` / `ENV SENTRY_DSN=$SENTRY_DSN` before `RUN npm run build`. Verify after any deploy by fetching `/assets/entry.client-*.js` and confirming the init is **not** `dsn:void 0`. |
| `NODE_ENV`            | `production`                                                                     |
| `PORT`                | Injected by Railway — do **not** set manually. `react-router-serve` honours it (verified: bound `:8080` on first deploy). |

Optional, unset at MVP: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.
Without them the build logs `[Sentry] Source map generation is disabled` —
expected, not an error. Error capture works without source maps; only
stack-trace readability suffers. When these are eventually set they must also be
added as Dockerfile `ARG`s to reach the build — but `SENTRY_AUTH_TOKEN` is a real
secret, so consume it as a build-only `ARG` and never promote it to `ENV`, which
would bake it into an image layer.

### Custom domain

`app.creditguardhq.com` (subdomain, not apex — apex CNAMEs are not portable and
the root must keep pointing at Shopify). `creditguardhq.com` was purchased
*through Shopify*, so DNS is administered at **store admin → Settings → Domains
→ creditguardhq.com → DNS settings → Add custom record**, not at a registrar
panel. Required record:

| Type    | Name  | Value                     |
| ------- | ----- | ------------------------- |
| `CNAME` | `app` | `viiq1oza.up.railway.app` |

Never use Shopify's **"Reset DNS settings"** — it deletes the CNAME records for
all subdomains and would take the deployed app offline. `mail.` and the root
carry no app records: reminders are sent by Shopify from the merchant's own
authenticated sender (D5-01), so this app never needed a sending domain.

### Deploying

```shell
railway up --service credit-guard-app --ci
railway logs --service credit-guard-app --lines 100   # confirm `prisma migrate deploy` ran
```

The Shopify CLI is installed under an `~/.npm-global` prefix, so prepend
`export PATH="$HOME/.npm-global/bin:$PATH"` before any `shopify` command.

### Verifying the deployed app

```shell
scripts/smoke-deployed.sh app.creditguardhq.com     # healthz 200 + forged HMAC -> 401
                                                    # on all SIX webhook endpoints

export SHOPIFY_API_SECRET="$(railway variables --service credit-guard-app --json \
  | node -e 'let c="";process.stdin.on("data",d=>c+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(c).SHOPIFY_API_SECRET))')"
scripts/send-signed-webhook.sh app.creditguardhq.com shop/redact <shop>.myshopify.com
scripts/send-signed-webhook.sh app.creditguardhq.com orders/delete <shop>.myshopify.com 5001
```

The ledger topics (`orders/create`, `orders/updated`, `orders/delete`,
`refunds/create`) are supported too. Note which of them need a granted scope to
answer 200: everything except `orders/delete` refetches the order from the Admin
API first, so before the scope grant those return **500** with
`Access denied for order field` in the log — and, by design, leave **no**
webhook receipt behind, so Shopify's redelivery is still real work.
`orders/delete` acts on local rows only and is therefore the ingest probe that
works at any stage.

`send-signed-webhook.sh` prints only the HTTP status. Never pass the secret as a
command argument and never echo it — read it into the environment as above.
Shopify can also sign and deliver sample payloads itself, which is the closest
CLI equivalent of the Partner dashboard's webhook test tool:

```shell
export SHOPIFY_FLAG_CLIENT_SECRET="$(railway variables ... )"   # same pipe as above
shopify app webhook trigger --topic shop/redact --api-version 2026-07 \
  --delivery-method http --address https://app.creditguardhq.com/webhooks/compliance
```

### Inspecting the production database

Production Postgres listens only on `postgres.railway.internal`, so it is
unreachable from a laptop and `railway run` does not help (it injects the
variables locally, where that hostname does not resolve). Query it by executing
inside the running container instead:

```shell
railway ssh keys add                                   # one-time, per machine
ssh-keyscan -t ed25519 ssh.railway.com >> ~/.ssh/known_hosts
scripts/prod-lifecycle-state.sh <shop>.myshopify.com   # JSON lifecycle state
```

The script uploads its query into `/app` (not `/tmp` — Node resolves
`@prisma/client` from the executed file's directory tree), runs it, and deletes
it. Set `RAILWAY_SSH_KEY` if the key is not at `~/.ssh/railway_ed25519`.

> **Intermittent `REMOTE HOST IDENTIFICATION HAS CHANGED!`** — `ssh.railway.com`
> is served by a fleet whose members present **different** host keys, while
> `known_hosts` pins only the one you first keyscanned. The same command can fail
> and then succeed unchanged (observed 2026-08-19). **Retry first.** Do not
> "fix" it by deleting the pinned line or re-running `ssh-keyscan` blindly —
> that is exactly the action a real man-in-the-middle needs you to take. If it
> persists, verify the offered fingerprint against Railway's published host keys
> before appending it.

`scripts/prod-ledger-state.sh` is the Phase 2 sibling and takes the same
arguments. It prints per-company exposures, ledger row counts, webhook receipts,
the backfill/reconciliation cursors and the scheduler leases:

```shell
scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com | jq '.ledger.companies'
scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com | jq -e '.backfill.status == "completed"'
```

Two fields are worth knowing by name:

- `webhooks.unprocessedReceiptCount` — deliveries claimed but never finished.
  Steady-state this is **0**; a growing number means ingest is failing after the
  claim. (A failed delivery releases its claim so Shopify's redelivery still
  works, so a stuck row here is a genuine anomaly, not normal churn.)
- `backfill` — the parsed `SyncCursor[shop, "backfill"]` value
  (`status: running | completed | failed`, plus counts). `absent` means the shop
  has never opened the embedded app since installing.

Phase 3 added three keys to the same output: per company `creditLimit`
(JSON `null` is the observe-only default and is deliberately **not** rendered as
a zero), `bypassEnforcement`, `publishedAt` and a derived `dirty`; plus
top-level `dirtyPublishes` (companies that owe Shopify a `credit_v1` write) and
`dataComplete` (the shop-scoped L-01 flag every published payload carries).

`scripts/prod-credit-metafields.sh` is the Phase 3 sibling — it is the one that
leaves the database and asks **Shopify** what the company actually holds:

```shell
scripts/prod-credit-metafields.sh credit-guard-demo.myshopify.com \
  | jq '.companies[] | {name, limit: .metafield.payload.limit, match}'
scripts/prod-credit-metafields.sh credit-guard-demo.myshopify.com \
  | jq -e '.dirtyPublishes == 0'
```

For every Company row it runs the read-back query
`company(id){ metafield(namespace: "$app", key: "credit_v1") }` with the shop's
own offline token and prints the live payload next to the DB row it projects,
plus a `match` block comparing them field by field through the contract's own
`toFixed(2)` rendering. `match.limit` false with a populated payload means the
metafield is stale, not that the number is a rounding artifact.

The access token is read inside the container, used only as the
`X-Shopify-Access-Token` header, and never appears in the output; the session's
`scope` string is printed because a missing `write_companies` is the first thing
to check when a publish failed (`APP_NOT_AUTHORIZED`). Every query is read-only.

`scripts/prod-validation-state.sh` is the Phase 4 sibling for the **enforcement
rule itself** — it asks Shopify what the shop's cart-and-checkout Validation
actually holds and lines it up against the `Shop.validationGid` we stored:

```shell
scripts/prod-validation-state.sh credit-guard-demo.myshopify.com | jq '.ec4'
scripts/prod-validation-state.sh credit-guard-demo.myshopify.com \
  | jq -e '.ours.blockOnFailure == false'
```

The `ec4` block is the whole registration contract as booleans:
`validationFound`, `enabledTrue`, **`blockOnFailureFalse`** (the ENFC-04
fail-open half — the literal `false`, never an omitted default),
`handleMatches`, `gidMatchesDatabase`, `configPresent` / `configVersionIsOne` /
`configCarriesBothMessages` (the ENFC-03 copy buyers will read), and
`duplicateOurValidations` (T-04-12: two concurrent app-opens can each create one;
anything above 1 is visible here and removable in checkout settings).

`matchesRegistrationDefaults` is **diagnostic only** and is `false` by design
once a merchant edits the copy on the Settings page. The canonical
`DEFAULT_MESSAGES` home is `app/services/enforcement.server.ts`, byte-diffed
against the Function's duplicate by `tests/enforcement-registration.test.ts`.

Two further things the same output settles:

- `a4.verdict` — whether **`write_validations` alone satisfies the
  `Query.validations` READ** (research assumption A4). `accessDenied: true` would
  mean a read scope has to be added in a four-home lockstep commit plus another
  re-consent. Measured on `credit-guard-demo` 2026-08-20: it holds.
- `ec2Proxy` / `namespaceProbe` — the Function's input query reads
  `metafield(key: "credit_v1")` with the **namespace omitted**, relying on
  Shopify's documented "if omitted, the app-reserved namespace is used". The
  Admin schema documents that argument identically, so the script asks for every
  company's metafield **both** ways — explicit `$app` and omitted — and compares
  the payloads. This is a *proxy on a different schema*: the behavioural proof is
  a real blocked checkout, since a block is impossible on a null metafield. An
  omitted-namespace `null` here is the signal to switch the input query to the
  literal `namespace: "$app"` (both forms are schema-legal) and redeploy.

`scripts/prod-enforcement-events.sh` prints the **EnforcementEvent log** —
`BLOCK_STATE_ENTERED` / `BLOCK_STATE_EXITED` transitions (ENFC-05),
`BYPASSED_ORDER` leaks with their `channel` and pre-order snapshot (ENFC-06), and
the bypass audit rows — newest first, alongside each company's current
enforcement state:

```shell
scripts/prod-enforcement-events.sh credit-guard-demo.myshopify.com \
  | jq '.events[] | {kind, companyName, orderGid, channel, amount, createdAt}'
scripts/prod-enforcement-events.sh credit-guard-demo.myshopify.com 20 \
  | jq -e '.countsByKind.BYPASSED_ORDER > 0'
```

It takes an optional row cap (default 200, max 1000) as its second argument. The
`companies` block carries `blockedState` next to a `derivedBlockedState`
recomputed from the stored exposure/limit/overdue/bypass through the same P4-L1
predicate, plus `blockedStateAgrees` — the one thing a single boolean column
cannot tell you about itself. Money (`amount`, `exposure`, `limit`) is printed at
full `Decimal(19,4)` precision and a null `limit` stays JSON `null`, because
observe-only and a `0.00` ceiling are different merchant decisions (D-02).

This script makes **no Admin API call at all** — the event log is entirely ours —
so it reads no access token and needs no scope.

`scripts/prod-reminder-state.sh` is the Phase 5 sibling for **payment
reminders**. It prints the applied migrations by NAME (so "did the release phase
run `add_reminder_log`?" is answered by evidence, not by a green aggregate),
whether any shop has `remindersEnabledAt` set, the newest `ReminderLog` rows with
their touchpoint and status, and the sweep leases — including `reminder-sweep`
once its first tick has claimed one:

```shell
scripts/prod-reminder-state.sh | jq '{migrations, enabled: .shops.remindersEnabled}'
scripts/prod-reminder-state.sh credit-guard-demo.myshopify.com \
  | jq '.reminderRows[] | {touchpoint, status, sentAt, companyName}'
```

The shop domain is optional and only filters the reminder rows. Like the event
log, this makes no Admin API call, and it is **read-only by construction**: there
is no path in it that can set `remindersEnabledAt`, because the merchant's own
settings action is that column's only writer (D5-02).

It also carries the **`fixtures` inventory** — every stored schedule classified
against `now` into the states plan 05-02's empirical checks need (open past-due
and company-attributed, open more than the 72h lead before `dueAt`, completed,
and payment-terms orders with no company attached), plus `emptyCategories`, the
list of states the store does *not* currently hold:

```shell
scripts/prod-reminder-state.sh credit-guard-demo.myshopify.com \
  | jq '{counts: .fixtures.counts, missing: .fixtures.emptyCategories}'
scripts/prod-reminder-state.sh credit-guard-demo.myshopify.com \
  | jq '.fixtures.E1_open_past_due_attributed[] | {orderName, companyName, dueAt, balanceDue}'
```

Beside the inventory it carries the **`touchpointPlan`** — the three instants of
every dunnable schedule, which of them are already crossed, which already carry a
`ReminderLog` row, and `nextInstantAfterWatermark`: the earliest moment strictly
after the merchant's watermark, the `now` a live drive would inject for it, and
any *tie* within five minutes that would make one drive cross two moments. An
optional third argument supplies a provisional watermark, so the plan is readable
before the switch is ever flipped. See § Payment reminders for the full usage.


`emptyCategories` is the point: it turns "does the demo store have a paid
schedule to test against?" into an answer instead of a guess, and every entry in
it is a fixture a human has to create in the admin before that check can run.
The inventory prints GIDs, order names, company names, money and dates —
**never a buyer, contact or customer field**, because none is stored (D5-01) and
this probe must not be the first place one appears.

`scripts/prod-reminder-recipients.sh` answers the question that sits *underneath*
every reminder test: **can these orders receive email at all?** It reads each
order's timeline and reports every notification Shopify recorded — order
confirmations, invoices, and `payment_reminder_sent` — as a recipient
**fingerprint plus bare domain**, never an address:

```shell
scripts/prod-reminder-recipients.sh credit-guard-demo.myshopify.com | jq '.verdict'
scripts/prod-reminder-recipients.sh credit-guard-demo.myshopify.com \
  | jq '.orders[] | select(.reminderSent) | {orderName, notifications}'
```

Run it **before** asking a human to check an inbox. Plan 05-02 learned why the
hard way: `paymentReminderSend` answered `success: true` with no userErrors,
the order timeline recorded "Payment reminder email was sent to …" attributed to
this app, and **nothing arrived** — because every seeded customer on the demo
store lives on `example.com`, a domain RFC 2606 reserves for documentation and
which has no mail exchanger. `verdict.allRecipientsUndeliverable: true` is that
state named out loud, and it costs one command instead of a verification round.

The fingerprint is `sha256(per-run salt + address)`, so two notifications can be
compared *within a run* ("did the reminder go to the same mailbox as the order
confirmation?" — for #1007 and #1010, yes) while the address itself is
unrecoverable from a saved output and never reaches a terminal or a summary. The
app holds no customer scopes, so `Order.email`, `Order.customer` and
`Order.purchasingEntity` are ACCESS_DENIED to it by design (D5-01, Pitfall 5);
the timeline is a merchant-facing surface `read_orders` already covers.

## Access scopes

```
read_orders,read_all_orders,read_payment_terms,read_companies,write_companies,write_validations,write_orders
```

The four CF-1 read scopes plus three write scopes:

| Write scope | Added | Why |
| ----------- | ----- | --- |
| `write_companies` | Phase 3 (CRED-03) | `metafieldsSet` on Company requires the owner-type write scope — no metafield-specific scope exists — so publishing the `$app` `credit_v1` credit-state metafield needs it. |
| `write_validations` | Phase 4 (ENFC-01/02) | `validationCreate` binds the deployed checkout-validation Function to the merchant's checkout. App-managed registration spares merchants the Settings → Checkout → Checkout rules hunt, and it is the only way the app can pin `blockOnFailure: false` itself (ENFC-04) instead of inheriting a hand-made rule's default. |
| `write_orders` | Phase 5 (REMD-01, D5-01) | `paymentReminderSend` is gated on it. That single mutation IS the reminder feature — Shopify resolves the recipient and sends its own branded "Payment reminder" email — so the app writes no order, ever. `read_orders` stays in the string beside it: write conventionally implies read, but explicitness is the CF-1 posture. |

A write scope is requested only when a phase actually writes (T-02-23) — that
rule, not a scope budget, is why the list is this short.

This exact string must be identical in **four** places or the app will behave
differently from what it declares — and all four change in ONE commit, never
partially:

| Where | Why |
| ----- | --- |
| `shopify.app.toml` `[access_scopes]` | what the merchant is asked to grant |
| Railway service variable `SCOPES` | `app/shopify.server.ts` reads `process.env.SCOPES` at boot |
| `vitest.config.ts` test env | keeps the suite exercising the shipped configuration |
| the guard tests' `EXPECTED_SCOPES` | the drift alarm itself (see below) |

A dedicated source guard (`tests/scope-lockstep.test.ts`) asserts the TOML value
and the test env agree — and that no write scope silently disappears from
either; `tests/webhooks.b2b-events.test.ts` additionally asserts the write set is
exactly `write_companies,write_validations,write_orders`, so a FOURTH write scope
has to turn the build red before it can ship. Set the Railway side with
`--skip-deploys`, so the single `railway up` of the plan carries scope and code
together rather than redeploying the previous image mid-change:

```shell
railway variables --service credit-guard-app --skip-deploys \
  --set "SCOPES=read_orders,read_all_orders,read_payment_terms,read_companies,write_companies,write_validations,write_orders"
```

**`read_companies` disappears from `.sessionScopes` after a token refresh, and
that is correct.** The stored session initially records the scopes the app
requested; once the rotating offline token is refreshed, Shopify returns its
**canonical granted set** with implied read scopes collapsed —
`read_all_orders,read_orders,read_payment_terms,write_companies`, because
`write_companies` implies `read_companies`. Company reads keep working
(`prod-credit-metafields` resolves live company names on that exact string,
measured 2026-08-19T17:41Z). Do not "repair" this by re-granting; a literal
assertion of the requested string against `.sessionScopes` is the thing that is
wrong — never assert on `.sessionScopes` literals, only on the requested string.
Expect the same collapsing around the later write scopes.

Relatedly, the offline access token **expires** (the app sets
`future.expiringOfflineAccessTokens`) and is rotated via the stored refresh
token. Any tool that reads `Session.accessToken` straight out of the database
and builds its own `X-Shopify-Access-Token` header will 401 as soon as it runs
past that expiry — go through `unauthenticated.admin(shop)` instead, which is
what `scripts/prod-credit-metafields.mjs` does.

Releasing a version with a widened scope set **invalidates existing offline
tokens within seconds** (observed on the 02-05 release): webhook refetch and
reconciliation for an installed store fail `ACCESS_DENIED` (Sentry noise,
non-throwing) until the merchant re-accepts the permissions prompt in admin.
Expected, not a defect — the ledger heals via reconciliation after acceptance.

**Two Partner Dashboard approvals gate this scope set, and both block
`shopify app deploy` outright — not just launch.** Until they are granted, no new
app version can be created, so the scopes and the ledger webhook topics cannot
reach the live registration at all (measured 2026-08-19, see
`.planning/phases/02-ar-ledger-credit-engine/02-05-SUMMARY.md`):

| Gate | Symptom when missing | Where to file |
| ---- | -------------------- | ------------- |
| **Protected customer data, Level 1** | `Version couldn't be created. • This app is not approved to subscribe to webhook topics containing protected customer data` — one line per order-shaped/company topic | Dev Dashboard → app `411936784385` → API access → Protected customer data |
| **`read_all_orders` access request** | `Version couldn't be created. app_access → Validation errors • scopes: read_all_orders` | Dev Dashboard → app `411936784385` → API access → Access requests → "Read all orders" |

Level 1 is sufficient for the whole shipped app: it stores company ids, money
amounts and dates, and reads no customer name, email, phone or address anywhere.
Payment reminders did not change that — Shopify resolves the recipient and sends
the mail itself (D5-01) — so Level 2 has never been requested and there is no
reason to. `payment_terms/*` and `bulk_operations/finish` are **not** PCD-gated;
the orders-shaped and `companies/*` topics are.

## Checkout enforcement registration

A deployed Function does nothing on its own. What makes it run at checkout is a
**Validation object** binding the function handle to the shop. Credit Guard
creates that itself — `ensureValidationRegistered` in
`app/services/enforcement.server.ts`, fired not-awaited from the embedded app
shell loader on every authenticated load, exactly like the install backfill.

| Property | Value | Why |
| -------- | ----- | --- |
| `functionHandle` | `credit-guard-validation` | the extension in `extensions/` |
| `enable` | `true` | "live on the merchant checkout" |
| `blockOnFailure` | **`false`** | Shopify: validation *errors* always block; this flag controls whether runtime *exceptions* (a crash, a timeout) also block. False = our failure never stops a real sale (ENFC-04) |
| `title` | `Credit Guard: net-terms credit check` | what the merchant sees in Settings → Checkout → Checkout rules |
| `$app`/`config_v1` metafield | the two default block messages | ENFC-03; the Function falls back to its own copies if it is missing |

Idempotence is **by platform state, not by our bookkeeping**: every call re-reads
`validations(first: 50)` and matches our handle client-side (`Query.validations`
has no functionHandle filter), so a merchant who deletes the rule gets it back on
the next app-open and a stale stored `Shop.validationGid` can never suppress a
needed create. A merchant who turns the rule **off** keeps it off — the app
records that state and never issues `validationUpdate` to override it.

The step is non-throwing by contract. Between a scope release and the merchant
accepting the re-consent prompt it fails `ACCESS_DENIED`, which lands in Sentry
as a **warning** and leaves the admin page intact; the merchant's acceptance is
itself an app-open, so enforcement arms on the very next load with no further
action.

## Payment reminders

**Shopify sends the email; the app decides when.** `paymentReminderSend(paymentScheduleId)`
is the whole transport: Shopify resolves the recipient (the company's main
contact), renders the merchant's own "Payment reminder" notification template
with its canonical pay-now link, and sends from the merchant's authenticated
sender. Credit Guard supplies one value — the `LedgerSchedule.scheduleGid` it
already stores. **No new packages, no DNS, no buyer email address anywhere in
the app** (which is what keeps PRIVACY.md §3's no-customer-PII claim true).

Three moments per invoice, each at most once: **DUE_SOON** at `dueAt − 72h`,
**DUE** at `dueAt`, **OVERDUE** at `dueAt + 72h` — fixed millisecond offsets, no
calendar arithmetic and no shop timezone. Of the moments a sweep finds crossed,
only the **most severe** sends and the rest are recorded `SUPPRESSED_STALE`, so
a five-day outage owes a buyer one message rather than a three-message backlog.

**Only net-terms orders attributed to a company are chased (v1).**
`eligibleSchedules` filters on `attributionStatus = ATTRIBUTED` **and** a
non-null `companyId`, so an order that carries net terms but has no purchasing
company is never emailed. That is a product choice, not a platform limit —
05-02's E4 experiment proved Shopify happily accepts a send for a company-less
net-terms schedule and resolves the recipient from the order itself. v1 dunns
exactly the accounts whose credit this app manages, because the ledger, the
dashboard and the enforcement story are all company-framed and a reminder for an
account the merchant cannot see in this app would have no home in the UI.
Extending to company-less net terms is a v2 **filter change** in
`eligibleSchedules`, not an architecture change. The Settings card states this
limitation to the merchant in the same words (WINDOWS #22).

| Piece | Where | Note |
| ----- | ----- | ---- |
| Sweep | third `SWEEP_SCHEDULE` entry, lease `reminder-sweep`, cron `30 * * * *` | Its OWN lease — sharing the overdue lease would let a slow ledger pass suppress a merchant's dunning email. Minute 30 so it never queues behind the minute-0 sweep. |
| Idempotence | `ReminderLog @@unique([shop, scheduleGid, touchpoint])` | Claim-then-send: the INSERT happens BEFORE the mutation, so a crash drops one reminder rather than double-emailing a customer. At-most-once is the correct failure direction for dunning. |
| Master switch | `Shop.remindersEnabledAt` | `null` = OFF, and off is the default for every shop. The sweep returns before it queries a single schedule, so a release cannot email anyone until a merchant opts in. |
| Merchant control | **Apps → Credit Guard → Settings → Payment reminders** | The only writer of `remindersEnabledAt`. Enabling always stamps a FRESH `now()`, including on re-enable, so a merchant who pauses for a fortnight does not fire a fortnight of dunning on resuming. |
| Install-blast guard | same column, as a watermark | A touchpoint whose threshold was crossed BEFORE the merchant enabled reminders is claimed `SUPPRESSED_PREEXISTING` and never sent. The watermark is checked *first* and beats severity. |
| Per-order limit (N1) | `PER_ORDER_GUARD_MS = 25h` | Shopify allows **one payment reminder per ORDER per 24 hours** (measured, not documented). An order carrying two schedules would otherwise earn a guaranteed refusal on the second; the guard skips it without writing a row, so the moment is re-derived once the window clears. |
| Circuit breaker | `SEND_CAP_PER_SWEEP = 50` | Whatever bug or backfill ever makes a whole order history look eligible at once costs 50 messages, not 5,000. The remainder is `DEFERRED`, oldest first. |
| Success test | `success === true` **and** empty `userErrors` | `success: false` with an EMPTY `userErrors[]` is a FAILURE — the same inside-`data` failure shape that burned `metafieldsSet` (03-01) and `validationUpdate` (04-05). A false `SENT` permanently consumes the touchpoint's claim, so the customer would never be chased at all. |

### What counts as proof that a reminder was sent

`success: true` means **Shopify accepted and enqueued the send**, not that a
mailbox received it — no API surface distinguishes the two, and 05-02 proved the
difference the hard way (five accepted sends, three recipient domains, nothing
received; the store's own order confirmations do not arrive either). So a
reminder is treated as SENT only on the conjunction of three signals:

1. `paymentReminderSend` returns `success: true` with empty `userErrors`;
2. a `payment_reminder_sent` event appears on the order's timeline, attributed
   to **Credit Guard: B2B Net Terms**;
3. that event's recipient fingerprint **equals the fingerprint of the order's
   own confirmation** — Shopify resolved the same mailbox it uses for its
   first-party mail.

That proves our side of the contract completely and proves nothing about
delivery, which is a deliberate and permanent distinction rather than a
temporary gap in the tooling.

### Pre-launch inbox procedure (the half a dev store cannot answer)

Sender identity, branding, subject line and the pay-now click-through require a
**delivered** message, and a development store delivers no customer-facing email
at all. Before launch, and not on `credit-guard-demo`:

1. Ask Partner support to confirm/clear any notification suppression on
   `credit-guard-demo.myshopify.com`, so the finding above is documented rather
   than inferred.
2. On a **paid-plan** store with a **verified sender domain** (the app-review
   demo store qualifies), install the app and enable reminders.
3. Send **one pre-due (DUE_SOON) and one overdue** reminder to a mailbox you can
   read.
4. Keep the inbox screenshots: sender, subject, branding, and a Pay-now click
   that reaches a payable page. Those screenshots are the evidence for REMD-02
   and REMD-03; until they exist, both are recorded `human_judgment: true /
   status: unknown` rather than passed.

Run `scripts/prod-reminder-recipients.sh` **before** asking anyone to check an
inbox. It answers "can these orders receive mail at all?" in one command, and
skipping it once already cost a full verification round (05-02).

### Reading the live state

```sh
# migrations by NAME, the switch, every reminder row, the sweep leases
scripts/prod-reminder-state.sh credit-guard-demo.myshopify.com \
  | jq '{migrations, enabled: .shops.remindersEnabled, rows: .reminderRowCount}'

# the touchpoint plan: three instants per dunnable schedule, what is crossed,
# and the earliest moment after the watermark — the instant a live drive injects
scripts/prod-reminder-state.sh credit-guard-demo.myshopify.com \
  | jq '.touchpointPlan | {expectedSuppressedPreexisting, nextInstantAfterWatermark}'

# the same plan BEFORE a merchant has enabled anything, against a provisional
# watermark (third argument; read-only — it moves no row, only the measurement)
scripts/prod-reminder-state.sh credit-guard-demo.myshopify.com credit-guard-app \
  2026-08-21T09:30:00Z | jq '.touchpointPlan.nextInstantAfterWatermark'

# N1 clearance + the evidence standard's signals 2 and 3, per order
scripts/prod-reminder-recipients.sh credit-guard-demo.myshopify.com \
  | jq '.orders[] | {orderName, reminderSent, notifications}'
```

| Tool | Answers | Mutates? |
| ---- | ------- | -------- |
| `scripts/prod-reminder-state.sh [domain] [service] [after-iso]` | Which migrations ran, whether any shop has reminders on, every `ReminderLog` row, the per-schedule touchpoint plan, the next instant after the watermark (with a tie warning), the last send per order | **No** — SELECTs only, and it deliberately has no code path that can set `remindersEnabledAt`. The merchant's own settings action is the only writer (D5-02). |
| `scripts/prod-reminder-recipients.sh [domain]` | Whether these orders can receive mail at all; per order, every notification Shopify recorded, its `action`, the app that caused it, and a per-run recipient **fingerprint** + bare domain | **No** — read-only, and it never learns an address: recipients are hashed in-container with a per-run salt, so "same mailbox?" is answerable and the address is not. |

`nextInstantAfterWatermark` also reports **ties** — any other moment within five
minutes of the chosen one. A tie means an injected-`now` drive would cross two
moments instead of one, which is the difference between proving "exactly once"
and merely observing it.

**Injected-`now` drives are a development-store verification technique only.**
`reminderSweep(now)` takes its instant by injection so a driven sweep behaves
exactly like a cron tick — including the 25h guard and the retry backoff, which
key on the injected instant. Driving it against a live merchant's store would
send real dunning at a fabricated time; the technique belongs to
`credit-guard-demo` and to nothing else.

## Empirical dev-store checks

The ledger's numbers are only trustworthy if they match what the merchant sees
in Shopify admin — internal consistency is not the bar (phase success
criterion 1). The flow below closes WINDOWS.md defect 5 on
`credit-guard-demo.myshopify.com`; re-run it after any change to the exposure
definition, since the checkout Function enforces against exactly these numbers.

**What the executor already verified (no human needed):**

- Reconciliation, backfill and the webhook ladder all run inside the granted
  CF-1 scope set — no ledger GraphQL document selects `purchasingEntity` or any
  customer field (source-guard tests, hard-green across all three services).
- The deployed release applied the `add_order_attribution` migration, all six
  unauthenticated surfaces still 401 forged HMACs
  (`scripts/smoke-deployed.sh app.creditguardhq.com`), and the offline session
  holds exactly `read_all_orders,read_companies,read_orders,read_payment_terms`
  (`.sessionScopes` in prod-ledger-state).
- The dev shop's backfill cursor was cleared
  (`scripts/prod-clear-backfill.sh credit-guard-demo.myshopify.com`), so the
  next embedded app-open re-runs the company-driven backfill against the
  already-correct B2B test data.

**THE ONE HUMAN STEP:** open the Credit Guard app once in the dev-store admin
(phone is fine) — `credit-guard-demo.myshopify.com` admin → Apps → Credit
Guard. The embedded loader re-triggers the company-driven backfill within
seconds; there is nothing else to click.

**Post-tap verification (any machine, later):**

```shell
bash scripts/prod-ledger-state.sh credit-guard-demo.myshopify.com \
  | jq '{backfill: .backfill.status, attribution, companies: .ledger.companies}'
```

Expected: `backfill` reads `completed`; `attribution.unresolved` is `0`;
**Acme Supply** and **Northwind Trading** show nonzero exposure with
`overdue: true` — each holds an open net-terms order past due since
2026-08-17. Then the D9 check itself (LEDG-01, success criterion 1): for every
B2B company, compare `.exposure` against the company's outstanding balance in
admin (Customers → Companies → the company → orders with payment terms). They
must be equal to the cent. A ledger number that is *lower* than admin is the
dangerous direction: it lets an over-limit buyer through. **Once this check
passes, WINDOWS.md defect 5 can be marked fixed.**

**A2 — refund on a partially-paid net-terms order (LEDG-03) — still gated,
unchanged (02-05 addendum).** The dev store emulates Basic, whose admin offers
no partial-payment control, so the partial-pay→refund sequence cannot be
exercised there — by design of Shopify's plan tiers, not by misconfiguration.
`partially_paid` handling is covered against fixtures in the correctness
matrix; close this pre-launch on a second dev store with Plus plan emulation.
When it becomes runnable: compare the company's ledger exposure against the
order's admin-shown **balance due** after the refund. Exact equality is
expected — a divergence invalidates the D-01/D-07 exposure definition and is a
stop-and-investigate, not a tolerance to widen.

## Live `credit_v1` contract proof

ROADMAP Phase 3 gates Phase 4 on this: *the metafield contract must be
verifiable on real Company records before Phase 4 starts.* Run
`scripts/prod-credit-metafields.sh credit-guard-demo.myshopify.com` — it reads
the LIVE metafield off each Company through the Admin API and compares it with
the database row it projects. Measured on `credit-guard-demo` 2026-08-19:

| Company | live `credit_v1` payload | proves |
| ------- | ------------------------ | ------ |
| Northwind Trading | `{"v":1,"limit":"2500.00","exposure":"1874.95","currency":"USD","overdue":false,"bypass":false,"data_complete":true,"computed_at":"2026-08-19T17:53:14.418Z"}` | the merchant's exact decimal string round-trips (CRED-01/CRED-03) |
| Acme Supply | `{"v":1,"limit":null,"exposure":"3229.95","currency":"USD","overdue":true,"bypass":true,"data_complete":true,...}` | bypass is visible WITHOUT hiding exposure/overdue (CRED-02, D-03) |
| Powderbound / Snowdevil | `{"v":1,"limit":null,"exposure":"0.00",...}` | a company nobody configured publishes `limit: null` — JSON null, not `"0.00"`, not absent (CRED-04, D-02) |

Latency: a settings change reached the live metafield in **647 ms**
(doorbell 17:53:13.967Z → `publishedAt` 17:53:14.614Z), and the metafield's own
`updatedAt` came back as `17:53:14Z`. That is the CRED-03 "within seconds"
promise, measured rather than asserted.

Fleet: after the 18:00 sweep tick every company carried a parseable payload and
**`dirtyPublishes` read 0** in both scripts. Northwind's metafield `updatedAt`
stayed at 17:53:14Z through that sweep — the hash-skip did its job and the
backstop made zero redundant `metafieldsSet` calls (T-03-11).

Note `computed_at` on the untouched companies: `2026-08-19T13:32:38Z`, hours
before the 18:00 write. That is correct and deliberate — `computed_at` is the
`recomputedAt` of the state being published, not the publish instant, so a
reader can tell stale state from a stale write.

**Watch for this when you publish:** writing a Company metafield makes Shopify
send a real `companies/update` webhook back ~1.5 s later, and its payload
carries no `name`. See `webhooks.companies.tsx` — a nameless delivery must never
rename the company. It did, once, live (2026-08-19), turning "Acme Supply" into
`gid://shopify/Company/7766278377` in the dashboard on every credit publish.

## Billing (App Pricing)

**One plan, zero billing code.** Credit Guard bills through **Shopify App
Pricing** (what used to be called Managed Pricing), so the plan lives in the
Partner Dashboard listing, not in this repo. There is no `billing` config in
`app/shopify.server.ts`, no `billing.require()`, no charge-creation mutation and
no cancellation screen — Shopify owns all of it.

| Fact | Value | Set where |
| ---- | ----- | --------- |
| Price | **US$29 / month** | Partner Dashboard → listing → Pricing content → Public plans |
| Interval | monthly only (no yearly plan) | same |
| Free trial | **14 days** | same |
| Development stores | **"Free for partners and developers" ticked** | same |
| Welcome link | `/app` | same — Shopify appends `?plan_handle=…` |
| Display name | `Credit Guard` | same — a plan with no description in the current language does not render |
| App handle in the plan URL | `credit-guard-net-terms` | `shopify.app.toml` line 5, re-exported as `APP_HANDLE` |

**Where the gate lives.** `app/routes/app.tsx`'s loader, as its *tail*:
`authenticate.admin` → the side effects (`ensureShopActive`, `startBackfill`,
`ensureValidationRegistered`) → **then** one uncached `billing.check()`. Running
the side effects first means a merchant who is still on the plan-selection page
already has their order backfill running, so the dashboard has data the moment
they arrive.

**It fails open, deliberately.** The redirect is issued only when
`hasActivePayment === false` — a *successful* negative. Any throw, timeout or
unrecognised shape is captured to Sentry and the app renders normally. A
fail-closed billing gate that misfires during app review is a redirect loop the
reviewer sees instead of the app, and that is a rejection; an unpaid render is a
recoverable revenue leak. `tests/billing-gate.test.ts` pins both directions.

**Reading the live subscription state (the E-1 instrument):**

```sh
# exactly what billing.check() sees, from inside the container — read-only
scripts/prod-billing-state.sh credit-guard-demo.myshopify.com \
  | jq '{wouldPassGate, subscriptions, pricingPlansUrl, migrations}'
```

`wouldPassGate` is the gate's decision, computed from the same Admin query the
loader runs. **Run this before deploying any change to the gate.** If it reports
`false` for a store that has already selected a plan, the deployed gate would
bounce that merchant to Shopify's plan page on every load — deploy nothing until
it reads `true`. The same output lists applied migrations by name, which is how
a release is verified (below).

## Launch runbook

The full listing package — app name, introduction, details, feature bullets,
`read_all_orders` justification, reviewer instructions with the B2B buyer-login
staging, screenshot shot list and the screencast script — is drafted in
[`.planning/phases/06-dashboard-onboarding-launch/06-LISTING.md`](.planning/phases/06-dashboard-onboarding-launch/06-LISTING.md).
It is copy-paste ready; the Partner Dashboard has no API for listings or plans,
so that document exists to make the browser session mechanical.

v1.0.0 went through this runbook, was submitted 2026-08-24 and was approved and
listed on 2026-09-04 at https://apps.shopify.com/credit-guard-b2b-net-terms; the steps
below remain the release procedure for every later version.

Release order, and it is an order rather than a list:

```sh
# 1. GATE — never deploy on a false. The demo store must already be subscribed.
scripts/prod-billing-state.sh credit-guard-demo.myshopify.com | jq .wouldPassGate

# 2. Deploy the working tree (branch releases are the Phase 4/5 precedent)
railway up --service credit-guard-app --ci

# 3. Assert the migration landed, BY NAME
scripts/prod-billing-state.sh credit-guard-demo.myshopify.com \
  | jq -r '.migrations[].migration_name'

# 4. Smoke the real host: /healthz 200 + every forged-HMAC surface 401
scripts/smoke-deployed.sh app.creditguardhq.com
```

Post-deploy checks before asking anyone to look at the app:

- `scripts/prod-ledger-state.sh <shop> | jq '{dataComplete, attribution}'` —
  `dataComplete: false` means the dashboard shows its "some balances may be
  incomplete" banner to the merchant, so it is a launch-visible fact.
- `scripts/prod-validation-state.sh <shop>` — the checkout rule is registered
  and enabled.
- `scripts/prod-reminder-state.sh <shop> | jq '.shops.remindersEnabled'` —
  reminders stay **off** until a merchant opts in; a release must never flip it.
- Open the embedded app once and confirm it renders the **dashboard**, not
  Shopify's plan-selection page.

## Resources

The platform surfaces this app actually stands on:

- [Cart and Checkout Validation Function API](https://shopify.dev/docs/api/functions/latest/cart-and-checkout-validation) — the enforcement mechanism, and the only server-side one available on all plans
- [Shopify Functions](https://shopify.dev/docs/api/functions) — runtime limits and the network-access restriction that shapes the architecture above
- [`@shopify/shopify-app-react-router`](https://shopify.dev/docs/api/shopify-app-react-router) — token exchange, webhook HMAC verification, `billing.check()`
- [Polaris web components](https://shopify.dev/docs/api/app-home/polaris-web-components) and [App Bridge](https://shopify.dev/docs/api/app-bridge-library) — the admin UI; `@shopify/polaris` React is deprecated and is not used here
- [Managed/App Pricing](https://shopify.dev/docs/apps/launch/billing/managed-pricing) — where the single plan is configured
- [Offline access tokens: expiring vs non-expiring](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens#expiring-vs-non-expiring-offline-tokens) — why any tool that reads `Session.accessToken` straight out of the database will eventually 401

## Licence

Code: MIT, see [`LICENSE`](../LICENSE). The Credit Guard name, logo and listing assets are excluded and reserved.

## Marketing site (`site/`)

`creditguardhq.com` is a single static page, hosted on Vercel as project
`credit-guard-site`, entirely separate from the app: no shared build, env,
domain or process, so deploying or breaking it cannot touch Railway. Source is
`site/index.html` + `site/vercel.json` (www → apex 301, security headers). The
copy is owned by `marketing/` (build request of 2026-09-15) and must stay
verbatim and consistent with the App Store listing; no forms, scripts, fonts
or trackers, page weight under 10 KB.

Deploy (Vercel CLI, logged in as the project owner). Deploy from a copy of
`site/` OUTSIDE this git tree: inside it the CLI attaches the repo's commit
author, and the Hobby team blocks any deployment whose commit author email is
not on the Vercel account (`readyState: BLOCKED`, `TEAM_ACCESS_REQUIRED`, shown
by the CLI only as an endless "Building…"):

```bash
D="$(mktemp -d)" && cp site/index.html site/vercel.json "$D/" && (cd "$D" && vercel link --yes --project credit-guard-site && vercel deploy --prod --yes)
```

DNS (Shopify-managed domain, edited in the demo store's admin → Settings →
Domains → DNS settings): root `A` → `76.76.21.21` (Vercel), remove the root
`AAAA`, `www` `CNAME` → `cname.vercel-dns.com` (Vercel also accepts an `A`
record for `www`). The domain stays registered with Shopify until it becomes
transferable on 2026-10-17; the demo store keeps `credit-guard-demo.myshopify.com`.

### DNS zone snapshot for the registrar transfer (captured 2026-10-17)

Recreate these at the new DNS host before or immediately after the transfer
completes. Everything the app, the site and the support mailbox depend on is
here; nothing else existed in the zone.

| Type | Host | Value | Purpose |
|---|---|---|---|
| A | `@` | `76.76.21.21` | creditguardhq.com → Vercel (marketing site) |
| CNAME | `www` | `cname.vercel-dns.com` | www → Vercel, 308 to apex |
| CNAME | `app` | `viiq1oza.up.railway.app` | the app (Railway) |
| TXT | `_railway-verify.app` | `railway-verify=b1db76f65751ba9138990b0f61db458e99a5060a8b6f18524a15f7b126103b8a` | Railway domain ownership |
| MX | `@` | `1 smtp.google.com` | Google Workspace mail |
| TXT | `@` | `v=spf1 include:_spf.google.com ~all` | SPF |
| TXT | `@` | `google-site-verification=Gndg6Hazt4ozPAAKCZpqo8c7jGzsgspOe66pD5HRc_Y` | Google verification |
| TXT | `google._domainkey` | `v=DKIM1;k=rsa;p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDdGv3R6fC/is5zpj63kBSLSv2ehyRlSuPzHuXSETn08uEiNiuZR7hP1/YQPGKJfxk9Jn5suLgp3egpcpOvcaac9SVfoGz+xdvoA5iA4AgZ8RRA4r3wAnXa93/H38K9MKR8S2HbcH2FbdNoX5tLAh7+ut18v6ZjkYWAlGATzwzXXQIDAQAB` | DKIM (1024-bit; regenerate at 2048 in Workspace admin after the move) |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:support@creditguardhq.com; adkim=r; aspf=r` | DMARC |

Deliberately NOT carried over: `account` CNAME → `shops.myshopify.com` (the demo
store's customer-accounts host; the demo store keeps its myshopify.com address)
and `_provider` TXT `shopify` (Shopify's own marker). No AAAA record.
