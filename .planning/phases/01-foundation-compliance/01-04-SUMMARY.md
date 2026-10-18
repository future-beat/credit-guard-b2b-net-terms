---
phase: 01-foundation-compliance
plan: 04
subsystem: compliance
tags: [gdpr, webhooks, hmac, railway, shopify-cli, deployment, verification, postgres]

requires:
  - phase: 01-02
    provides: "Deployed Railway service at https://app.creditguardhq.com with managed Postgres and release-phase `prisma migrate deploy`"
  - phase: 01-03
    provides: "app/routes/webhooks.compliance.tsx, app/services/shop-lifecycle.server.ts, the Shop/ComplianceRequest models, and the shopify.app.toml compliance_topics block awaiting sync"
provides:
  - "Compliance code live in production — the add_shop_lifecycle migration applied to production Postgres on release"
  - "App version credit-guard-net-terms-3 released, publishing the compliance_topics subscription config to the app registration"
  - "scripts/smoke-deployed.sh — repeatable deployed gate: healthz 200 over verified TLS + forged HMAC rejected 401 on BOTH webhook endpoints"
  - "scripts/send-signed-webhook.sh — signs the exact raw body with the client secret read from the environment; prints only the HTTP status"
  - "scripts/prod-lifecycle-state.{sh,mjs} — production D-06 lifecycle state for a shop domain, queried from inside the Railway container"
  - "Deployed proof of D-06: uninstall deactivates-and-retains, shop/redact hard-deletes to zero rows, repeat redact is a 200 no-op"
  - "Shopify-originated (Shopify-signed) sample deliveries for all three GDPR topics accepted 200 by the deployed endpoint"
  - "README: deployed-verification and production-DB-inspection runbook"
affects: [phase-02, phase-03, phase-04, phase-05]

actuals:
  tokens: 3500          # chars/4 over the realized diff (13,870 chars across 5 files, .planning excluded)
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Deployed gates live in committed shell scripts under scripts/, not in throwaway one-liners, so every later phase can re-run the same assertions"
    - "Secrets are read into a process environment by piping `railway variables --json` through node — never echoed, never assigned in a committed file, never placed in an argument list"
    - "HMAC signing for verification uses node's createHmac (key from process.env), not `openssl dgst -hmac <key>`, because openssl would expose the key in a process argument list"
    - "Production database queries execute INSIDE the Railway container over `railway ssh`; DATABASE_URL never leaves Railway's private network"

key-files:
  created:
    - scripts/smoke-deployed.sh
    - scripts/send-signed-webhook.sh
    - scripts/prod-lifecycle-state.sh
    - scripts/prod-lifecycle-state.mjs
  modified:
    - README.md

key-decisions:
  - "Signing is done by node reading SHOPIFY_API_SECRET from its own environment rather than by openssl, because `openssl dgst -sha256 -hmac <key>` puts the client secret in an argv visible to `ps` — which the plan's own prohibition (T-01-16) forbids"
  - "The deployed uninstall was driven by a validly-signed app/uninstalled delivery rather than a click in the Shopify admin: the executor has no browser, production held zero sessions (the dev store is not installed from the deployed URL — 01-02 D6 is still open), and a real uninstall would have required a browser to re-install afterwards"
  - "`railway run` cannot query production Postgres (it injects variables locally, where postgres.railway.internal does not resolve) and the Postgres service has no public TCP proxy, so the query is shipped into the running container over `railway ssh`; this required registering an SSH key with Railway"
  - "A bystander shop domain was seeded before the redact so the deployed proof shows shop/redact deleting ONLY the target domain — a delete-everything bug would otherwise have passed the zero-rows assertion"
  - "`shopify app webhook trigger` is used as the CLI equivalent of the Partner dashboard's webhook test tool: the payload is signed and delivered by Shopify's own infrastructure, which is strictly stronger evidence than a locally-signed POST"

patterns-established:
  - "Every unauthenticated POST surface gets a forged-HMAC assertion in the deployed smoke, not just the compliance route"
  - "Destructive deployed verification always seeds a bystander record first and asserts it survived"
  - "shopify.app.toml is byte-diffed against a pre-CLI copy after every `shopify` invocation, not just grepped for api_version"

requirements-completed: [FOUND-01, FOUND-02, FOUND-03]

coverage:
  - id: D1
    description: "The compliance code is live in production — the add_shop_lifecycle migration was applied to production Postgres during the release and the service came back healthy"
    requirement: FOUND-01
    verification:
      - kind: integration
        ref: "railway up --service credit-guard-app --ci -> exit 0 (image sha256:4881c3a4e630794a0ebde9f19fba7c9384bf9b4c0ab11e648c892cda76d3ff64); release log: 'Applying migration `20260818132232_add_shop_lifecycle`' then 'All migrations have been successfully applied.' against postgres.railway.internal:5432"
        status: pass
      - kind: integration
        ref: "scripts/smoke-deployed.sh app.creditguardhq.com -> GET /healthz http=200 ssl_verify_result=0"
        status: pass
    human_judgment: false
  - id: D2
    description: "A forged-HMAC POST to the DEPLOYED webhook endpoints is rejected with 401, with zero side effects"
    requirement: FOUND-02
    threat: T-01-15
    verification:
      - kind: integration
        ref: "scripts/smoke-deployed.sh app.creditguardhq.com -> POST /webhooks/compliance 401, POST /webhooks/app/uninstalled 401; exit 0"
        status: pass
      - kind: integration
        ref: "Railway runtime log shows the two 401s with NO 'Received … webhook' line between them — the library threw before any handler ran; production row counts unchanged"
        status: pass
    human_judgment: false
  - id: D3
    description: "A validly-signed compliance webhook is accepted 200 by the deployed endpoint and its effect lands in production Postgres"
    requirement: FOUND-02
    verification:
      - kind: integration
        ref: "scripts/send-signed-webhook.sh app.creditguardhq.com customers/data_request credit-guard-u0vpjikx.myshopify.com -> 200; scripts/prod-lifecycle-state.sh then shows ComplianceRequest id cmsypq8sq0000pm2tdxvbzj0z topic CUSTOMERS_DATA_REQUEST receivedAt 2026-08-18T13:43:00.362Z"
        status: pass
    human_judgment: false
  - id: D4
    description: "The app registration was re-synced from shopify.app.toml, publishing the three compliance-topic subscriptions, with the API-version pin and production URL intact afterwards"
    requirement: FOUND-02
    verification:
      - kind: integration
        ref: "shopify app deploy --allow-updates -> 'New version released to users. credit-guard-net-terms-3'; shopify app versions list shows version 3 active"
        status: pass
      - kind: integration
        ref: "diff of shopify.app.toml against a pre-deploy copy is empty after every CLI invocation; api_version = \"2026-07\", application_url = https://app.creditguardhq.com, automatically_update_urls_on_dev = false all unchanged"
        status: pass
    human_judgment: false
  - id: D5
    description: "On the DEPLOYED app, app/uninstalled deactivates and RETAINS: Shop.active=false with uninstalledAt stamped, sessions gone, every compliance receipt still standing (D-06 stage one)"
    requirement: FOUND-03
    verification:
      - kind: integration
        ref: "signed app/uninstalled -> 200; scripts/prod-lifecycle-state.sh credit-guard-u0vpjikx.myshopify.com -> shopRows[0] {active:false, uninstalledAt:2026-08-18T13:46:21.121Z}, sessionCount 0, complianceRequestCount 2 (both receipts retained)"
        status: pass
    human_judgment: false
  - id: D6
    description: "On the DEPLOYED app, shop/redact hard-deletes every row for the shop and only that shop, and a repeat delivery is a 200 no-op (D-06 stage two, idempotent)"
    requirement: FOUND-03
    verification:
      - kind: integration
        ref: "signed shop/redact -> 200; production query -> shopRows [], sessionCount 0, complianceRequestCount 0 for the domain, while the bystander shop's receipt survived (wholeDatabase.complianceRequestCount 1)"
        status: pass
      - kind: integration
        ref: "second signed shop/redact -> 200; production query -> still zero rows for the domain"
        status: pass
    human_judgment: false
  - id: D7
    description: "Shopify's own infrastructure can sign and deliver all three mandatory GDPR topics to the deployed URL and receive 200, dispatching to the correct handler"
    requirement: FOUND-02
    verification:
      - kind: integration
        ref: "shopify app webhook trigger --topic {customers/data_request,customers/redact,shop/redact} --api-version 2026-07 --address https://app.creditguardhq.com/webhooks/compliance -> 'Webhook has been enqueued for delivery' x3; Railway log: 'Received CUSTOMERS_DATA_REQUEST/CUSTOMERS_REDACT/SHOP_REDACT compliance webhook for shop.myshopify.com' each followed by 'POST /webhooks/compliance 200'"
        status: pass
    human_judgment: false
  - id: D8
    description: "The client secret is never exposed while signing test webhooks — not in argv, script text, logs, or committed files (threat T-01-16)"
    requirement: FOUND-02
    threat: T-01-16
    verification:
      - kind: integration
        ref: "grep -v '^#' scripts/send-signed-webhook.sh | grep -cE 'SHOPIFY_API_SECRET[[:space:]]*=' -> 0; grep -rnE 'shpss_|shpat_|postgres(ql)?://[^\"]*:[^\"]*@' scripts/ -> no hits; the secret reaches node via the inherited environment and the body via stdin"
        status: pass
    human_judgment: false
  - id: D9
    description: "Neither deployed script can mask a failed request with an error-suppressing default"
    requirement: FOUND-02
    verification:
      - kind: integration
        ref: "grep -nE '2>/dev/null|\\|\\| *true' scripts/*.sh -> no hits; both scripts run under `set -euo pipefail` with every curl status captured into a variable and compared with test"
        status: pass
    human_judgment: false
  - id: D10
    description: "The local suite still passes with the deployed changes in place"
    requirement: FOUND-01
    verification:
      - kind: unit
        ref: "npm test -- --run -> 3 files, 31 tests passed (834 ms); npm run typecheck -> exit 0; npm run build -> exit 0; npm run lint -> exit 0"
        status: pass
    human_judgment: false
  - id: D11
    description: "Partner dashboard automated compliance checks pass, and the three compliance-topic subscriptions are visible on the app registration"
    requirement: FOUND-02
    verification:
      - kind: manual_procedural
        ref: "OUTSTANDING — browser-only. Dev Dashboard -> app 411936784385 -> Configuration/Compliance. No Shopify CLI surface lists registered compliance subscriptions (`shopify app execute` requires the app to be installed on a store, which it is not)."
        status: unknown
    human_judgment: true
    rationale: "The Partner/Dev dashboard is a browser UI with no CLI or API equivalent reachable by the executor. Every functional behaviour the checks exercise is independently proven above (401 forged / 200 signed / Shopify-signed deliveries accepted), so a red result is the A6 known false-red: re-run first, then escalate to Partner support rather than changing correct code."
  - id: D12
    description: "Install -> uninstall -> redact -> re-install on the dev store ends in a clean, working embedded shell (phase success criterion 3)"
    requirement: FOUND-03
    verification:
      - kind: manual_procedural
        ref: "OUTSTANDING — browser-only. Also carries 01-02's D6 (install from the DEPLOYED URL), which production data shows has never happened: the database held zero Session and zero Shop rows before this plan ran."
        status: unknown
    human_judgment: true
    rationale: "The embedded install path is a browser-driven OAuth flow inside the Shopify admin iframe with a human-authenticated account; no automated harness exists for it. The webhook halves of the loop (deactivate-and-retain, redact-to-zero, idempotent redelivery) ARE proven against production — what remains unproven is only the browser-side install/re-install rendering."

duration: ~35 min
completed: 2026-08-18
status: complete
---

# Phase 01 Plan 04: Deployed Compliance Sync + End-to-End Verification Summary

**The GDPR endpoints are now proven on the real URL, not just in vitest: forged posts get 401 from production, Shopify's own signed deliveries for all three mandatory topics get 200, and the full D-06 lifecycle — deactivate-and-retain, then redact to zero rows, then an idempotent repeat — was executed against the production database and verified row by row.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2
- **Commits:** 3
- **Files created/modified:** 5 (291 insertions, 0 deletions)

## Accomplishments

- **Production runs the compliance code.** `railway up` built and released it; the release log shows `20260818132232_add_shop_lifecycle` applied to production Postgres, and `/healthz` answers 200 over a verified Let's Encrypt chain.
- **Registration re-synced.** `shopify app deploy --allow-updates` released `credit-guard-net-terms-3`, publishing the `compliance_topics` block. `shopify.app.toml` is **byte-identical** to its pre-deploy copy afterwards — the CLI rewrite hazard from 01-01/01-02 did not recur.
- **FOUND-02 is now deployed-true.** Forged HMAC → 401 on both `/webhooks/compliance` and `/webhooks/app/uninstalled`; validly-signed → 200 with the effect visible in production Postgres.
- **Shopify itself delivered all three GDPR topics** to the deployed URL via `shopify app webhook trigger` — signed by Shopify's infrastructure, not by us — and each returned 200 with the correct topic dispatch in the log. This is the CLI equivalent of the Partner dashboard's webhook test tool, and the strongest available substitute for it.
- **FOUND-03 is now deployed-true.** The two-stage uninstall was executed end to end against production, with a bystander shop seeded first to prove the redact is scoped.
- **Production database left clean** — zero Shop, Session, and ComplianceRequest rows across the whole database at the end, including the rows Shopify's own sample `shop/redact` cleaned up for itself.

## Deployed Lifecycle Evidence

All row counts come from `scripts/prod-lifecycle-state.sh`, which executes inside the Railway container against the live database.

| Stage | Action | Production state for `credit-guard-u0vpjikx.myshopify.com` |
|---|---|---|
| Baseline | — | `Shop 0`, `Session 0`, `ComplianceRequest 0` (whole DB empty) |
| Signed `customers/data_request` → **200** | receipt written | `ComplianceRequest 1` (`CUSTOMERS_DATA_REQUEST`, 13:43:00.362Z) |
| Signed `customers/redact` → **200** | second receipt | `ComplianceRequest 2` |
| Forged `app/uninstalled` → **401** | nothing | unchanged; no handler log line |
| Signed `app/uninstalled` → **200** | **deactivate + RETAIN** | `Shop 1 {active:false, uninstalledAt:13:46:21.121Z}`, `Session 0`, `ComplianceRequest 2` — **both receipts survived** |
| Signed `shop/redact` #1 → **200** | **hard delete** | `Shop 0`, `Session 0`, `ComplianceRequest 0`; bystander shop's receipt still present (whole DB count 1) |
| Signed `shop/redact` #2 → **200** | idempotent no-op | still `0 / 0 / 0` |
| Bystander `shop/redact` → **200** | cleanup | bystander `0 / 0 / 0` |
| Shopify-triggered 3 topics → **200** each | dispatch + self-cleanup | `shop.myshopify.com` rows created then deleted by Shopify's own `SHOP_REDACT`; whole DB back to `0 / 0 / 0` |

Runtime log excerpt from the deployed process (topic dispatch, verbatim):

```
POST /webhooks/compliance 401 - - 13.586 ms
Received CUSTOMERS_DATA_REQUEST compliance webhook for credit-guard-u0vpjikx.myshopify.com
POST /webhooks/app/uninstalled 401 - - 6.414 ms
Received APP_UNINSTALLED webhook for credit-guard-u0vpjikx.myshopify.com
Received SHOP_REDACT compliance webhook for credit-guard-u0vpjikx.myshopify.com
Received CUSTOMERS_DATA_REQUEST compliance webhook for shop.myshopify.com
Received CUSTOMERS_REDACT compliance webhook for shop.myshopify.com
Received SHOP_REDACT compliance webhook for shop.myshopify.com
```

Note the two 401 lines have **no** `Received …` line attached: the library rejected them before any handler code ran.

## Plan Verify Commands

| Task | Command | Result |
|---|---|---|
| 1 | `bash scripts/smoke-deployed.sh "app.$CUSTOM_DOMAIN" && test "$(bash scripts/send-signed-webhook.sh "app.$CUSTOM_DOMAIN" customers/data_request "$DEV_STORE_DOMAIN")" = "200"` | **PASS** |
| 2 | `test "$(… shop/redact "$DEV_STORE_DOMAIN")" = "200"` + production row count for the domain `= 0` | **PASS** (row count 0; see deviation 3 for why the count is read via `prod-lifecycle-state.sh` rather than `railway run psql`) |

Local suite: `npm run build` 0 · `npm run typecheck` 0 · `npm test -- --run` 31/31 in 834 ms · `npm run lint` 0.

## Task Commits

1. **Task 1: deployed smoke + signed-webhook scripts** — `e3795c6` (chore)
2. **Task 2: production lifecycle-state query + hardened smoke** — `9a5c60f` (chore)
3. **Runbook documentation** — `940b267` (docs)

Production deploys made by this plan (not git artifacts): Railway image `sha256:4881c3a4…`, Shopify app version `credit-guard-net-terms-3`.

## Deviations from Plan

### Auto-fixed / discretionary

**1. [Rule 2 — Missing critical] node, not openssl, computes the HMAC**
- **Found during:** Task 1, writing `send-signed-webhook.sh`
- **Issue:** The plan says to sign "with openssl using the SHOPIFY_API_SECRET environment variable". `openssl dgst -sha256 -hmac "$SECRET"` places the client secret in openssl's argument list, where any local process can read it from `ps` — directly contradicting the plan's own prohibition and threat T-01-16 ("never appears in argv"). openssl has no stdin-key option for `dgst`.
- **Fix:** The digest is computed by `node`, which reads the key from its inherited environment and the body from stdin. Neither ever appears in an argument list. This also uses the exact same `createHmac(...).digest("base64")` construction as `tests/helpers/webhook-hmac.ts`, so the shell path and the test path cannot drift.
- **Verification:** `grep -v '^#' … | grep -cE 'SHOPIFY_API_SECRET[[:space:]]*='` → 0; signed delivery accepted 200 by production, which is only possible if the digest is correct.
- **Committed in:** `e3795c6`

**2. [Rule 3 — Blocking] The uninstall was driven by a signed webhook, not a click in the Shopify admin**
- **Found during:** Task 2
- **Issue:** The plan's step 1 says "uninstall the app from the dev store in Shopify admin". Three facts made that impossible or wrong here: (a) the executor has no browser and the user is on mobile; (b) the production database held **zero Session and zero Shop rows**, i.e. the dev store has never been installed from the deployed URL (01-02's D6 is still open) — so there was nothing to uninstall; (c) a real uninstall would have required a browser to re-install afterwards, converting a reversible check into a stuck state.
- **Fix:** The deployed `app/uninstalled` handler was driven by a validly-signed delivery to the production URL — byte-for-byte the request Shopify sends, verified by the same library code path. What this proves (handler behaviour + database effect) is exactly what the acceptance criterion asks for. What it does **not** prove — that Shopify's platform emits the delivery on a real uninstall — is recorded as outstanding human check D12.
- **Verification:** See the lifecycle table; `Shop.active=false` with `uninstalledAt` stamped and both receipts retained.

**3. [Rule 3 — Blocking] Production DB queries go over `railway ssh`, not `railway run`**
- **Found during:** Task 2
- **Issue:** `railway run` executes locally with Railway's variables injected, so `postgres.railway.internal` does not resolve — the plan's verify command could never have worked as written. The Postgres service also has no public TCP proxy (`DATABASE_PUBLIC_URL` does not exist), so `railway connect --no-ssh` fails with "Connection URL should point to the Railway TCP proxy".
- **Fix:** `scripts/prod-lifecycle-state.sh` base64-ships `prod-lifecycle-state.mjs` into the running container over `railway ssh`, runs it there against the container's own `DATABASE_URL`, and deletes it. The URL never reaches this machine. This required one-time operator setup: a new local SSH key (`~/.ssh/railway_ed25519`), `railway ssh keys add`, `ssh-keyscan ssh.railway.com >> ~/.ssh/known_hosts`, and the Railway-generated `~/.ssh/config` block. All of it is outside the repo; the README documents the setup.
- **Gotcha recorded:** the script must land in `/app`, not `/tmp` — Node resolves `@prisma/client` from the executed file's directory tree, and `/tmp/node_modules` does not exist.
- **Committed in:** `9a5c60f` (scripts), `940b267` (README)

**4. [Rule 2 — Missing critical] The smoke also asserts 401 on `/webhooks/app/uninstalled`**
- **Issue:** The plan's smoke only covered the compliance route. `/webhooks/app/uninstalled` is the app's other unauthenticated POST surface and it drives D-06 deactivation — an unguarded one would let anyone deactivate a merchant.
- **Fix:** Third assertion added to `scripts/smoke-deployed.sh`. Observed 401.
- **Committed in:** `9a5c60f`

**5. [Discretionary] `send-signed-webhook.sh` also supports `app/uninstalled`**
- The script maps the topic to its endpoint (`app/uninstalled` → `/webhooks/app/uninstalled`, everything else → `/webhooks/compliance`). Without this the deployed lifecycle proof in deviation 2 would not have been possible.

**6. [Discretionary] A bystander shop was seeded before the redact**
- `creditguard-bystander-probe.myshopify.com` received a receipt before the redact ran, so the zero-rows assertion is paired with a survived-rows assertion. A `deleteMany` with a missing `where` clause would pass the plan's criterion as written and fail this one. Cleaned up afterwards with its own signed redact.

**7. [Discretionary] `shopify app webhook trigger` used in place of the dashboard test tool**
- The plan's step 4 sends test deliveries from the Partner dashboard (browser-only). The CLI equivalent exists and is **stronger**: the payload is signed and delivered by Shopify's own infrastructure, so a signature mismatch or an unreachable endpoint would surface exactly as it would in review. Its secret was supplied via the `SHOPIFY_FLAG_CLIENT_SECRET` environment variable so it never entered argv.

**8. [Discretionary] README runbook added**
- `README.md` is outside the plan's `files_modified`. The verification path is otherwise undiscoverable — particularly the `railway ssh` requirement and the no-echo secret pipe — and an undocumented one-time SSH setup would have made these committed scripts unusable on the next machine.

---

**Total deviations:** 8 (2 missing-critical, 2 blocking, 4 discretionary). None change scope; deviations 1, 4 and 6 each close a hole the plan as written would have left open.

## Outstanding Human Checks (browser-only)

Both are `verification: backstop` must-haves in the plan. The executor has no browser and the user is on mobile, so neither could be run. **Neither is claimed as passing.**

### 1. Partner dashboard automated compliance checks (coverage D11, assumption A6)

**What to do:** open the Dev Dashboard → **Credit Guard: B2B Net Terms** (app `411936784385`, org `231459878`) → the app version `credit-guard-net-terms-3` → **Configuration / Compliance**. Confirm:
- the three compliance webhook endpoints are listed and point at `https://app.creditguardhq.com/webhooks/compliance`;
- the automated "Use HMAC verification" / mandatory-webhooks checks pass.

**If a check is red:** this is the A6 known false-red pattern. Do **not** change the code. The endpoint behaviour is already proven from three independent directions: a forged POST gets 401, a locally-signed POST gets 200 with a database effect, and a **Shopify-signed** delivery of each of the three topics gets 200 with correct dispatch. Re-run the check first (the registration was only re-synced at 13:41 UTC on 2026-08-18); if it stays red, escalate to Partner support with this evidence attached.

**Why no CLI substitute:** no Shopify CLI command lists a registration's compliance subscriptions. `shopify app execute` requires the app to be installed on a store, which it currently is not.

### 2. Install → re-install loop from the deployed URL (coverage D12, also 01-02's D6)

Production data proves the dev store has **never** been installed from the deployed URL — the database held zero `Session` and zero `Shop` rows before this plan ran. So this check now covers both halves.

**What to do:**
1. Install `https://app.creditguardhq.com` on `credit-guard-u0vpjikx.myshopify.com` **from the Dev/Partner dashboard**, not via `shopify app dev`. Confirm managed installation completes and the embedded Credit Guard shell renders with no console errors.
2. Verify a fresh active row exists: `scripts/prod-lifecycle-state.sh credit-guard-u0vpjikx.myshopify.com` → `shopRows[0].active = true`, `uninstalledAt = null`, `sessionCount ≥ 1`.
3. Uninstall from the store's Apps page. Re-run the query → `active:false`, `uninstalledAt` set, `sessionCount 0`, other rows retained.
4. Re-install and confirm the shell renders again and `active` flips back to `true`.

Steps 3's and 4's database semantics are already proven against production by signed deliveries; what only a browser can add is that Shopify **emits** the uninstall webhook on a real uninstall and that the embedded shell renders.

## Issues Encountered

- **`railway run` is the wrong tool for production DB access** and the Postgres service has no public proxy — resolved as deviation 3. Worth remembering for every later phase that needs production data.
- **Node module resolution from `/tmp`** silently breaks `@prisma/client` imports inside the container; the query file must live under `/app`.
- **`railway ssh` needs both a registered key and a trusted host key.** The first failure ("Host key verification failed") is not about the Railway key at all — it is `ssh.railway.com` missing from `known_hosts`.

## Not Done (by design)

- **STATE.md and ROADMAP.md were not touched** and nothing was pushed — per the orchestrator's instructions for this run.
- **No scopes were added** to `shopify.app.toml`. `scopes = ""` remains a Phase 2–4 decision (carried forward from 01-02).
- **The Railway region question is closed:** `railway status` now reports **US East**, matching D-02. The Amsterdam finding recorded in 01-02's Open Items no longer applies.

## Next Phase Readiness

**Phase 1 is functionally complete pending the two browser checks.** All four phase success criteria have deployed evidence except the browser-rendered install path (criterion 1 and the visual half of criterion 3), which is captured above with exact steps. Phase 2 can build on: a live production service with migrations applied on release, a proven webhook-authentication path, and the `Shop.active` scheduler contract from 01-03.

## Self-Check: PASSED

- All 4 claimed script files exist and are executable (`scripts/smoke-deployed.sh`, `scripts/send-signed-webhook.sh`, `scripts/prod-lifecycle-state.sh`, `scripts/prod-lifecycle-state.mjs`); `README.md` modified.
- All 3 claimed commits resolve: `e3795c6`, `9a5c60f`, `940b267`.
- `shopify.app.toml` re-verified after every `shopify` invocation: `api_version = "2026-07"`, `application_url = "https://app.creditguardhq.com"`, `automatically_update_urls_on_dev = false`; byte-identical to the pre-deploy copy.
- Secret-hygiene gates re-run at commit time: 0 hits for a `SHOPIFY_API_SECRET=` assignment outside comments, 0 hits for `shpss_`/`shpat_`/credentialed Postgres URLs anywhere under `scripts/`, 0 error-suppressing constructs.
- Production database confirmed clean at end of run (`0 / 0 / 0` across Shop, Session, ComplianceRequest).
