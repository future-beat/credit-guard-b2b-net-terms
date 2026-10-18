# Deferred Items — Phase 01 Foundation & Compliance

Out-of-scope discoveries logged during execution. Not fixed in the plan that found them.

---

## DI-01: Railway service is in `europe-west4` (Amsterdam), not a US region

- **Found during:** plan 01-02, Task 3 (originates in Task 2)
- **Decision it contradicts:** D-02 — "default US region ... Shopify webhook infra is US-based"
- **Evidence:** `railway status` → `region: ams`. The README claimed "Railway default (US)"; that row has been corrected to state the actual region.
- **Why deferred:** Changing region requires recreating the app service *and* the Postgres volume. That is architectural (deviation Rule 4) and outside plan 01-02 Task 3's scope boundary.
- **Cost curve:** cheap now (zero install base, DB holds only the init migration), expensive later (data migration + re-verifying webhooks/OAuth against a new service).
- **Impact if left:** every Shopify webhook round trip in Phase 2+ (`orders/create`, `orders/paid`) pays transatlantic latency. The credit-status metafield write is on that path, so it widens the staleness window the Function reads against.
- **Recommended action:** decide before Phase 2 ships. Either move to a US region or record an explicit ADR superseding D-02.

---

## DI-02: `scopes = ""` in `shopify.app.toml`

- **Found during:** plan 01-02, Task 3
- **Why deferred:** The correct scope set is not knowable until Phase 2–4 Admin API needs are concrete (companies, payment terms, orders, metafields).
- **Impact if left:** the app cannot call the Admin API for anything beyond the current shell. Requesting scopes the app does not use is an app-review liability, so this must be filled deliberately rather than copied from an example.
- **Recommended action:** set as part of the first plan that makes an Admin GraphQL call.

---

## DI-03: `shopify app dev` has no separate dev config

- **Found during:** plan 01-02, Task 3 (research Open Question 1, unresolved)
- **Why deferred:** `shopify app dev` needs an interactive tunnel and was not run in that session, so the CLI created no dev-config variant file.
- **Mitigation in place:** `automatically_update_urls_on_dev = false` in `shopify.app.toml`, so the CLI prompts rather than silently overwriting the production `application_url`.
- **Recommended action:** before the next `shopify app dev`, run `shopify app config link` against a separate development app to create `shopify.app.<name>.toml`, then `shopify app dev --config=<name>`. `shopify.app.toml` is now the production registration and must not be written by the dev loop.

## Railway region — app moved, Postgres pending (2026-08-18)

**Status:** `credit-guard-app` is now in **US East (us-east4-eqdc4a)**, pinned in `railway.json`
(`deploy.multiRegionConfig`). Domain, TLS, and private networking survived the move unchanged —
Railway docs confirm region changes preserve them for services without volumes.

**Outstanding:** the `Postgres` service is still in `ams` (europe-west4). It carries a 500 MB volume
(`postgres-volume`, 50 MB used), and volumes are region-locked:
- `serviceInstanceUpdate(input: { region: "us-east4-eqdc4a" })` returns `true` but does not move a
  volume-backed service; a redeploy does not trigger migration either.
- `railway volume update` supports only `--mount-path` and `--name` — no region.
- `railway config` (IaC) requires adding the Railway TypeScript SDK as a repo dependency.

**Resolution required (user, Railway dashboard):** Postgres service → Settings → region →
`us-east4 (Virginia, USA)`. Railway migrates the volume with brief downtime. Safe now: the database
holds only `_prisma_migrations` and an empty `Session` table, and there are no merchants.

**Impact while split:** functional but slower — verified the app reaches the Amsterdam DB from US East
(deploy ran `prisma migrate deploy` successfully and passed its healthcheck). Every DB round trip
crosses the Atlantic until Postgres moves, so resolve before Phase 2's webhook-driven ledger work.

### RESOLVED 2026-08-18 — Postgres region migration complete

Both services are now in **US East**, confirmed via `railway service list`:
`credit-guard-app` → US East, `Postgres` → US East.

The volume migrated intact: a post-move deploy ran `prisma migrate deploy` and reported
`1 migration found` → `No pending migrations to apply.`, proving `_prisma_migrations` and the
`Session` schema survived (volume grew 50 MB → 101 MB from Railway's fresh base image + WAL,
not a wipe). Health verified after the move: `https://app.creditguardhq.com/healthz` → 200,
`ssl_verify_result=0`. Domain, TLS, and private networking were preserved through both region
changes, as Railway documents for services without volumes.

Carry-forward CF-4 is closed. No action remains.
