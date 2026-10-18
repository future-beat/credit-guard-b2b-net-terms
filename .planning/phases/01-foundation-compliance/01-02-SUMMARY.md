---
phase: 01-foundation-compliance
plan: 02
subsystem: infra
tags: [sentry, railway, postgres, custom-domain, tls, docker, shopify-cli, error-tracking]

requires:
  - phase: 01-01
    provides: "React Router 7 scaffold, linked Partner app (client_id e3646af7…), Prisma/Postgres session storage, unauthenticated GET /healthz"
provides:
  - "Always-on Railway service `credit-guard-app` with attached managed Postgres, migrations applied on every release via `npm run docker-start`"
  - "Custom domain https://app.creditguardhq.com with Let's Encrypt auto-TLS (ssl_verify_result=0)"
  - "Sentry server SDK loaded before the app via NODE_OPTIONS --import, verified live in the deployed Railway process"
  - "Sentry browser SDK with a real DSN inlined into the deployed client bundle"
  - "Shopify app registration pointing at the production URL (app version credit-guard-net-terms-2)"
  - "railway.json config-as-code (start command, healthcheck path, restart policy)"
  - "README Deployment section documenting every Railway setting and variable name"
affects: [01-03, 01-04, phase-02, phase-03, phase-04, phase-05]

actuals:
  tokens: 6100          # chars/4 over the realized diff (24,285 chars, lockfile excluded)
  tasks: 3
  commits: 6

tech-stack:
  added:
    - "@sentry/react-router 10.70.0 (lockfile-resolved; sha512-L9x1mUOQleKC4+hwaFygxvavpnjoSG4KyoGiap2T3sLTqUc2ojG0SXICjltD5AyOny+pgAupCSPDzge7VuaAEA==)"
    - "@railway/cli (global, ~/.npm-global prefix)"
  patterns:
    - "Sentry server init via NODE_OPTIONS='--import ./instrument.server.mjs' on BOTH dev and start — never inside app code"
    - "Deploy-time config as committed code (railway.json), not dashboard-only state"
    - "Any variable the BUILD needs must be a Dockerfile ARG — Railway does not inject service variables into Dockerfile builds"
    - "Sentry events carry stack traces only: sendDefaultPii off, beforeSend strips body/cookies/headers and redacts credential query params"

key-files:
  created:
    - instrument.server.mjs
    - app/entry.client.tsx
    - react-router.config.ts
    - railway.json
  modified:
    - Dockerfile
    - shopify.app.toml
    - app/entry.server.tsx
    - vite.config.ts
    - package.json
    - README.md

key-decisions:
  - "`automatically_update_urls_on_dev` set to false — the Shopify CLI removed `include_config_on_deploy` (config is now ALWAYS published on deploy), so a tunnel URL written into shopify.app.toml by `shopify app dev` would reach the live registration and break install/OAuth"
  - "Added `ARG SENTRY_DSN` / `ENV SENTRY_DSN` to the Dockerfile: the deployed client bundle was compiling to `Sentry.init({ dsn: void 0 })` because Railway does not pass service variables into a Dockerfile build without a matching ARG"
  - "SENTRY_AUTH_TOKEN must stay a build-only ARG (never promoted to ENV) when source-map upload is enabled, or the secret is baked into an image layer"
  - "The temporary probe route carried a second, constant-time operator-token gate alongside authenticate.admin — the admin gate is only reachable from a browser inside the Shopify admin iframe, which no automated check can drive"
  - "Kept the three CLI-standard redirect_urls rather than only /auth/callback, so a later `shopify app dev`/`deploy` produces no diff and no install path can fail on a missing redirect URL"

patterns-established:
  - "Post-deploy Sentry smoke check with no Sentry UI access: fetch /assets/entry.client-*.js and assert the init is not `dsn:void 0`; fetch / and decode the `baggage` meta tag — a real `sentry-public_key` + `org_id` proves the SERVER SDK parsed a live DSN at runtime"
  - "API-version drift guard: re-grep `api_version = \"2026-07\"` after every `shopify` CLI invocation (it survived this deploy, but the CLI rewrote it once during 01-01)"
  - "Never print secret values: `railway variable set --stdin` to write, `--kv | cut -d= -f1` to list names only"

requirements-completed: [FOUND-01]

coverage:
  - id: D1
    description: "Sentry server + client SDKs wired with PII collection off; build green with the Sentry Vite plugin active"
    requirement: FOUND-01
    verification:
      - kind: integration
        ref: "npm run build && grep -q 'instrument.server.mjs' package.json && grep -q 'NODE_OPTIONS' package.json && ! grep -rqE 'sendDefaultPii[[:space:]]*:[[:space:]]*true' instrument.server.mjs app/entry.client.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "App runs always-on at https://app.creditguardhq.com over valid TLS with Postgres attached and prisma migrate deploy running on every release"
    requirement: FOUND-01
    verification:
      - kind: integration
        ref: "curl https://app.creditguardhq.com/healthz -> http=200 ssl_verify_result=0; Railway release log shows 'prisma migrate deploy' then 'No pending migrations to apply.' against postgres.railway.internal:5432"
        status: pass
    human_judgment: false
  - id: D3
    description: "Shopify app registration points at the production URL and has been synced; API version pin and D-05 identity survived the CLI run"
    requirement: FOUND-01
    verification:
      - kind: integration
        ref: "shopify app deploy --allow-updates -> released version credit-guard-net-terms-2; grep -q 'application_url = \"https://app.' shopify.app.toml; api_version still 2026-07; name/handle unchanged"
        status: pass
    human_judgment: false
  - id: D4
    description: "The deployed client bundle initializes the browser SDK with a real DSN (not undefined) — the Dockerfile build-arg fix"
    requirement: FOUND-01
    verification:
      - kind: integration
        ref: "fetch https://app.creditguardhq.com/assets/entry.client-*.js -> init is dsn:\"https://<32-hex>@…sentry.io/…\"; 'dsn:void 0' absent (was present before the fix)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The Sentry SERVER SDK is loaded and holds a live DSN inside the deployed Railway process, and a deliberate server-side error was thrown there"
    requirement: FOUND-01
    verification:
      - kind: integration
        ref: "Railway runtime log: process started as NODE_OPTIONS='--import ./instrument.server.mjs' react-router-serve ./build/server/index.js"
        status: pass
      - kind: integration
        ref: "SSR HTML baggage meta decodes to sentry-org_id=4511930712588288, 32-char sentry-public_key, sentry-environment=production, sentry-sample_rate=0.1 — only an initialized server SDK with a parsed DSN emits these"
        status: pass
      - kind: integration
        ref: "GET /debug/sentry-check with the operator token -> HTTP 500 'Unexpected Server Error' (deliberate throw reached); no stack trace in the Railway log, consistent with Sentry's handleError owning it (logErrors: false)"
        status: pass
      - kind: manual_procedural
        ref: "CONFIRMED by user 2026-08-18 — Sentry UI shows the 'sentry-server-capture-check' issue, environment=production"
        status: pass
    human_judgment: true
    rationale: "Every link in the chain is proven locally except the last one — actual delivery of the event to Sentry's ingest endpoint. That is only observable in the Sentry UI, which the executor has no access to. The automated evidence proves the SDK is initialized with a valid DSN and that the error was thrown and handled by Sentry's handleError; it cannot prove the outbound POST succeeded."
  - id: D6
    description: "Merchant installs from the DEPLOYED URL on the dev store and lands in the embedded Credit Guard shell (FOUND-01 deployed half)"
    requirement: FOUND-01
    verification:
      - kind: manual_procedural
        ref: "OUTSTANDING — install https://app.creditguardhq.com on credit-guard-u0vpjikx.myshopify.com from the Partner dashboard, not via `shopify app dev`"
        status: unknown
    human_judgment: true
    rationale: "Requires a browser-driven Shopify OAuth flow inside the admin iframe with a human-authenticated Shopify account; no automated harness exists for the embedded install path. Deferred to end-of-phase by the plan itself."
  - id: D7
    description: "Zero secrets committed — SHOPIFY_API_SECRET and SENTRY_DSN exist only as Railway service variables and in the gitignored local .env"
    requirement: FOUND-01
    verification:
      - kind: integration
        ref: "git grep -IlE 'shpss_|shpat_' -> 0 hits; git grep -IlE 'ingest\\.[a-z0-9.]*sentry\\.io' -> 0 hits; git ls-files '^\\.env' -> only .env.example"
        status: pass
    human_judgment: false
  - id: D8
    description: "The temporary debug probe route exists nowhere in the repo or in production"
    requirement: FOUND-01
    verification:
      - kind: integration
        ref: "test ! -f app/routes/debug.sentry-check.tsx; GET https://app.creditguardhq.com/debug/sentry-check -> 404 after final deploy"
        status: pass
    human_judgment: false

duration: ~2 days elapsed across sessions (Task 3 session ~35 min)
completed: 2026-08-18
status: complete
---

# Phase 01 Plan 02: Production Deploy — Sentry, Railway, Custom Domain Summary

**The walking skeleton now runs always-on at https://app.creditguardhq.com behind valid TLS with the Shopify registration pointed at it, and Sentry is live on both sides — including a client-side DSN that was silently compiling to `undefined` until the Dockerfile was taught to pass build variables.**

## Performance

- **Duration:** ~2 days elapsed across sessions; Task 3 session ~35 min
- **Tasks:** 3
- **Files modified:** 11 (excluding `package-lock.json`)
- **Realized diff:** 372 insertions / 52 deletions

## Accomplishments

- **Production is real.** `https://app.creditguardhq.com/healthz` returns 200 with `ssl_verify_result=0` (Let's Encrypt, `CN=app.creditguardhq.com`). Phase success criterion 4 is now true, so every later webhook and compliance criterion is testable against a real URL.
- **Shopify registration points at production.** `application_url` and `[auth] redirect_urls` moved off the `shopify.dev` placeholder; released as app version `credit-guard-net-terms-2`. The `api_version = "2026-07"` pin survived this CLI run and D-05 identity is intact.
- **Server-side Sentry proven live on Railway**, which is the whole point of D-03 — client-only Sentry is research Pitfall 5's documented failure mode. The runtime log shows the process starting as `NODE_OPTIONS='--import ./instrument.server.mjs' react-router-serve …`, and the SSR HTML's `baggage` meta tag decodes to a real Sentry `org_id` and 32-character public key, which only an initialized server SDK holding a parsed DSN can emit.
- **Found and fixed a silent client-side Sentry outage.** The deployed bundle contained `Sentry.init({ dsn: void 0 })`. See deviation 2 — this would not have surfaced until the first browser error went missing in Phase 3.
- **Release-phase migrations confirmed working:** `prisma generate && prisma migrate deploy` runs on every deploy against `postgres.railway.internal:5432` before the server starts.
- **Zero secrets in git**, verified by pattern search across all tracked files.

## Task Commits

1. **Task 1: Sentry server + client wiring (D-03)** — `1276222` (feat)
2. **Task 2: Railway service + Postgres + custom domain** — `8e005e5` (chore)
3. **Task 3: Point registration at production** — `4ee083b` (chore)
   - **Task 3 deviation fix:** `01fdebc` (fix) — Dockerfile `SENTRY_DSN` build arg
   - **Task 3 probe (added):** `f7ce381` (chore)
   - **Task 3 probe (deleted):** `136490d` (chore)

## Files Created/Modified

- `Dockerfile` — `ARG SENTRY_DSN` / `ENV SENTRY_DSN` before `npm run build`, plus a warning that `SENTRY_AUTH_TOKEN` must never be promoted to `ENV`
- `shopify.app.toml` — production `application_url` + `redirect_urls`; `automatically_update_urls_on_dev = false`
- `README.md` — Dockerfile ARG requirement, the post-deploy `dsn:void 0` check, corrected region row
- `instrument.server.mjs`, `app/entry.client.tsx`, `app/entry.server.tsx`, `vite.config.ts`, `react-router.config.ts`, `package.json` — Sentry wiring (Task 1)
- `railway.json` — start command, healthcheck path, restart policy (Task 2)

## Decisions Made

See `key-decisions` frontmatter. The two load-bearing ones:

**`include_config_on_deploy` no longer exists.** The Shopify CLI removed it during this deploy with the message "all apps must now include configuration on deploy." That silently raises the stakes on `automatically_update_urls_on_dev`: with it `true`, `shopify app dev` rewrites `application_url` in `shopify.app.toml` to an ephemeral tunnel URL, and the next `shopify app deploy` would publish that tunnel URL to the live registration — breaking install and OAuth for real merchants. Set to `false`, so the CLI prompts instead of acting silently.

**Railway + Dockerfile means build variables are opt-in.** Service variables are injected at *runtime*; a Dockerfile build only sees variables it declares as `ARG`. Anything Vite inlines at build time therefore needs an explicit `ARG`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `automatically_update_urls_on_dev` left at `true` would leak tunnel URLs to production**
- **Found during:** Task 3, while editing `shopify.app.toml`
- **Issue:** The plan changed `application_url` to production but left the dev-time auto-rewrite on. Combined with the CLI's new always-publish-config behavior, a single `shopify app dev` run followed by any `shopify app deploy` would push a dead tunnel URL to the live app registration. D-04 rates URL changes as costly-to-reverse.
- **Fix:** Set `automatically_update_urls_on_dev = false` with an explanatory comment.
- **Verification:** `shopify app deploy` succeeded and published the production URL; the flag persisted through the CLI run.
- **Committed in:** `4ee083b`

**2. [Rule 1 - Bug] Client-side Sentry was compiling to `dsn: undefined` in production**
- **Found during:** Task 3, gathering automatable evidence for the Sentry check
- **Issue:** The deployed bundle `/assets/entry.client-C7J8SvMi.js` contained `dI({dsn:void 0,environment:"production",…})`. Railway builds this service from the repo `Dockerfile`, and Dockerfile builds do **not** receive Railway service variables unless the Dockerfile declares a matching `ARG`. So `vite.config.ts`'s `envPrefix: ["VITE_", "SENTRY_DSN"]` had nothing to inline. Setting `SENTRY_DSN` in Railway (which the orchestrator had just done) triggered a rebuild but could not fix this. Server-side capture was unaffected — it reads `process.env` at runtime, which Railway does inject.
- **Why it mattered:** This is a *silent* failure. Every browser error in Phases 2–5 would have been dropped with no signal, and the D-03 acceptance gate ("SENTRY_DSN appears in .env.example") would still have passed.
- **Fix:** `ARG SENTRY_DSN` + `ENV SENTRY_DSN=$SENTRY_DSN` immediately before `RUN npm run build`. Documented the constraint and a post-deploy check in the README, including the warning that `SENTRY_AUTH_TOKEN` must stay a build-only `ARG` so the secret is not baked into an image layer.
- **Verification:** After redeploy, `/assets/entry.client-D4nF-yqo.js` contains a real `dsn:"https://<32-hex>@…sentry.io/…"` and `dsn:void 0` is gone.
- **Committed in:** `01fdebc`

**3. [Rule 3 - Blocking] The probe route needed a second gate to be triggerable at all**
- **Found during:** Task 3
- **Issue:** The plan specifies the probe sits behind `authenticate.admin` (threat T-01-09) and is loaded "on the DEPLOYED app (embedded admin)". `authenticate.admin` is only satisfiable from a browser inside the Shopify admin iframe. Confirmed empirically: anonymous and wrong-token requests both received **HTTP 410** — a thrown `Response`, not an `Error`, so no Sentry event is produced. The required proof was therefore unreachable by any automated means, and the plan also requires the route to be deleted before the plan ends, which would leave the human unable to trigger it later either.
- **Fix:** Kept `authenticate.admin` as the gate for all merchant-facing traffic and added a second gate: a 64-hex-character operator token compared in constant time (`node:crypto` `timingSafeEqual`) against a `SENTRY_CHECK_TOKEN` Railway variable created for this one verification. Anonymous traffic satisfies neither gate.
- **Threat impact:** T-01-09's mitigation is preserved and arguably strengthened — during the probe's lifetime the route was unreachable *even to an authenticated merchant admin* without the token, and the route existed in production for roughly 15 minutes.
- **Verification:** Anonymous → 410; wrong token → 410; correct token → 500 with the deliberate throw. Token variable deleted from Railway and the local copy destroyed; route deleted; production now returns 404.
- **Committed in:** `f7ce381` (add), `136490d` (delete)

**4. [Rule 1 - Bug] README documented a region the service is not in**
- **Found during:** Task 3
- **Issue:** The README's Deployment table claimed "Railway default (US)". `railway status` reports the service is in `ams` (Amsterdam / `europe-west4`). The documentation was factually wrong, and it deviates from D-02.
- **Fix:** Corrected the README row to state the actual region and flag the D-02 deviation. The region itself was **not** changed — see Open Items below.
- **Committed in:** `01fdebc`

---

**Total deviations:** 4 auto-fixed. Deviation 2 is the one that mattered: it fixed a production defect that every automated gate in the plan would have passed over.

## Outstanding Human Checks

Two items cannot be closed by the executor. Both are `verification: backstop` must-haves.

### 1. Confirm the Sentry event arrived (D5)

**Everything except delivery is proven.** What is confirmed automatically:

| Link in the chain | Evidence | Status |
|---|---|---|
| `--import` flag survived npm → docker-start → start on Railway | Runtime log: `NODE_OPTIONS='--import ./instrument.server.mjs' react-router-serve ./build/server/index.js` | proven |
| Server SDK initialized with a parsed, live DSN | SSR `baggage` meta → `sentry-org_id=4511930712588288`, 32-char `sentry-public_key`, `sentry-environment=production` | proven |
| Deliberate error thrown in the deployed process | `GET /debug/sentry-check` → **HTTP 500**, Railway log line `GET /debug/sentry-check 500 - - 37.049 ms` | proven |
| Sentry's `handleError` owned the error | No stack trace in the Railway log, which is exactly what `logErrors: false` produces; React Router's default handler would have printed one | proven |
| Event POSTed to and accepted by Sentry ingest | — | **NOT OBSERVABLE — needs the Sentry UI** |

**What a human must do:** open the Sentry project → **Issues** → filter `environment:production`, time range covering **2026-08-18 11:29:37 UTC**. Expect one issue titled **`sentry-server-capture-check`** with a **server** (Node) runtime, not browser.

- **If it is there:** D-03 is fully closed; mark D5 `pass`. No code change needed.
- **If it is NOT there:** the DSN value in the Railway `SENTRY_DSN` variable is wrong or points at a deleted project (the SDK no-ops silently on an unparseable DSN — but note the baggage tag proves it *did* parse, so a wrong-project DSN is the likeliest cause). Check the DSN against the Sentry project's Client Keys page. The `logErrors: true` fallback described in the plan is **not** needed — the log already confirms the error was thrown and handled.

Note on the `sentry-sampled=false` / trailing `-0` in the `sentry-trace` tag: that is **trace** sampling at `tracesSampleRate: 0.1`. Error events are always captured regardless of trace sampling — do not read it as "the error was dropped."

### 2. Install from the deployed URL (D6, FOUND-01 deployed half)

Install `https://app.creditguardhq.com` on `credit-guard-u0vpjikx.myshopify.com` **from the Partner dashboard**, not via `shopify app dev`, and confirm the embedded Credit Guard shell renders with no console errors. The plan defers this to end-of-phase.

## Open Items / Deferred

**Railway region is `europe-west4` (Amsterdam), not the US region D-02 specified.** Discovered in Task 3; it originates in Task 2. Not corrected here — changing region means recreating the service *and* the Postgres volume, which is out of this task's scope. **The cost of this only goes up:** with zero install base it is a rebuild; after merchants exist it is a migration. Shopify's webhook infrastructure is US-based, so every `orders/create` round trip in Phase 2 pays transatlantic latency. Recommend deciding before Phase 2 ships. Logged in `deferred-items.md`.

**Open Question 1 (dev-config variant) is UNRESOLVED.** The plan asked which dev-config file the CLI creates once `application_url` points at production. `shopify app dev` was not run in this session (it needs an interactive tunnel), so the CLI created no variant file. The protection put in place instead is `automatically_update_urls_on_dev = false`. **Before the next `shopify app dev`**, run `shopify app config link` against a separate development app to produce a `shopify.app.<name>.toml`, then use `shopify app dev --config=<name>`. Do not let the dev loop write into `shopify.app.toml` — it is now the production registration.

**`scopes = ""` in `shopify.app.toml`.** No access scopes are requested yet. The real set must be decided once Phase 2–4 Admin API needs are known (companies, payment terms, orders, metafields). Requesting scopes the app does not use is an app-review liability, so this must be set deliberately rather than by copying an example.

## Resolved Assumptions

- **A2 (PORT):** Confirmed. `react-router-serve` honours Railway's injected `PORT` — the runtime log shows `[react-router-serve] http://localhost:8080`. No explicit `PORT` variable needed; do not set one.
- **A3 (DATABASE_URL reference syntax):** Confirmed. `${{Postgres.DATABASE_URL}}` resolves to `postgresql://…@postgres.railway.internal:5432/railway`, visible in the release log's Prisma datasource line.
- **Open Question 1:** unresolved — see Open Items.

## Carry-Forward Notes for Later Plans

1. **Deploying:** `railway up --service credit-guard-app --ci` from the repo root, with `export PATH="$HOME/.npm-global/bin:$PATH"` first. **The private GitHub repo is NOT connected to Railway** — pushing to `main` deploys nothing. Every deploy is a local upload.
2. **`SENTRY_DSN` must exist at BUILD time, not just runtime.** Vite inlines it into the client bundle via `envPrefix`. Because Railway builds from the `Dockerfile`, this requires the `ARG SENTRY_DSN` / `ENV SENTRY_DSN` lines now in the Dockerfile. Adding any other build-time variable later needs the same treatment — and `SENTRY_AUTH_TOKEN` must be `ARG`-only, never `ENV`.
3. **`SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` are unset.** Builds log `[Sentry] Source map generation is disabled` and `No auth token provided. Will not create release.` **Both are expected, not errors.** Error capture works without source maps; only stack-trace readability suffers.
4. **Every `shopify` CLI invocation can rewrite `shopify.app.toml`.** It rewrote `api_version` to the 2026-10 RC once during 01-01 and removed `include_config_on_deploy` during this plan. **Always re-grep `api_version = "2026-07"` and the D-05 `name`/`handle` after any `shopify` command**, and diff the file before committing.
5. **`scopes` is `""`.** Decide the real set from actual Phase 2–4 API needs; unused scopes are an app-review liability.
6. **Never run Shopify's "Reset DNS settings"** on `creditguardhq.com` — it deletes the `CNAME app` record and takes production offline. The domain is registered through Shopify inside the dev store and is transfer-locked until ~mid-Oct 2026; do not delete that dev store.
7. **Secret hygiene with the Railway CLI:** `railway variable set <KEY> --stdin` to write without echoing, `railway variables --kv | cut -d= -f1` to list names only. `--kv` and `--json` print raw values — never pipe them to output.

## Next Phase Readiness

**Ready.** Plans 01-03 (webhooks + GDPR compliance) and 01-04 are unblocked: error tracking is live for the handlers 01-03 adds, and the production URL Shopify will call is registered and serving. The two outstanding human checks are backstop verifications and do not block 01-03 work.

## Self-Check: PASSED

All 12 claimed files exist; all 6 claimed commits resolve in git; the probe route is absent from the repo and returns 404 in production; the Dockerfile `ARG`/`ENV SENTRY_DSN` pair is present; the only deletion across this plan's commits is the intentional probe-route removal. Two coverage items (D5 Sentry-UI confirmation, D6 deployed install) are recorded `status: unknown` with `human_judgment: true` — not claimed as passing.
