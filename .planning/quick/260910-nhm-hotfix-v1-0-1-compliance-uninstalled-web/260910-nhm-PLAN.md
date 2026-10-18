---
quick_id: 260910-nhm
phase: quick-260910-nhm
plan: 01
type: quick
mode: quick-full
wave: 1
depends_on: []
autonomous: true
requirements: [FOUND-02, FOUND-03, LEDG-05]
windows: [30, 31, 32]
files_modified:
  - package.json
  - package-lock.json
  - app/shopify.server.ts
  - app/services/webhook-validate.server.ts
  - app/services/token-health.server.ts
  - app/services/admin-client.server.ts
  - app/services/shop-lifecycle.server.ts
  - app/routes/webhooks.compliance.tsx
  - app/routes/webhooks.app.uninstalled.tsx
  - tests/helpers/offline-session.ts
  - tests/webhooks.compliance.test.ts
  - tests/shop-lifecycle.test.ts
  - tests/admin-token-health.test.ts
  - CHANGELOG.md
  - .claude/CLAUDE.md
  - .planning/WINDOWS.md

estimate:
  tokens: 130000
  raw_tokens: 130000
  tasks: 4
  confidence: low   # estimate-calibration: 0 samples, factor 1

must_haves:
  truths:
    - "A signed shop/redact for a shop whose only stored offline session is EXPIRED and carries a refreshToken answers 200 and leaves zero rows in Session, ComplianceRequest, ReminderLog, EnforcementEvent, LedgerSchedule, LedgerOrder, Company, WebhookReceipt, SyncCursor and Shop — with no network call to Shopify (WINDOWS #31, #32)."
    - "A signed app/uninstalled under that same stale session answers 200, deletes the shop's session rows, sets Shop.active=false and uninstalledAt, and retains every other row (D-06)."
    - "Both routes still answer 401 with zero side effects on a forged HMAC, 405 on a non-POST, and 400 when the HMAC is valid but a required X-Shopify header is missing — exactly the library authenticator's contract, without its session load."
    - "At the admin seam, token-class failures (refresh → thrown Response 500; HttpResponseError 400 invalid_subject_token; Admin API HttpResponseError 401) are counted as STRIKES time-gated to one per TOKEN_FAILURE_WINDOW_MS (30 min, anchor fixed at strike time) — a burst inside one sweep cycle (one hourly sweep constructing a client per company via graphqlJson) counts once; the third strike, i.e. three separate sweep cycles (≥ ~2 h at the hourly cadence) with no successful GraphQL call in between, deactivates the shop, deletes its sessions, clears the counter and logs one line; a successful GraphQL call resets the counter with one DELETE per shop per process (not per call); network errors, Shopify 5xx, other 4xx, SessionNotFoundError and GraphQL-level errors never count (WINDOWS #30)."
    - "package.json and both root version fields of package-lock.json read 1.0.1; CHANGELOG.md carries the 1.0.1 entry; WINDOWS #30, #31, #32 are fixed (8 open); npm test, graphql-codegen+typecheck, lint and build are green; both api_version = \"2026-07\" pins are byte-identical to HEAD."
  artifacts:
    - "app/shopify.server.ts — exports validateWebhook (validation-only shopifyApi instance, CONTEXT §2)"
    - "app/services/webhook-validate.server.ts — validateWebhookRequest(request): 405/401/400 contract, body read once"
    - "app/services/token-health.server.ts — classifyConstructionFailure, classifyRequestFailure, recordTokenFailure (time-gated by TOKEN_FAILURE_WINDOW_MS), clearTokenFailures (no-op once a shop is in the module-level healthy set), TOKEN_FAILURE_KEY, TOKEN_FAILURE_THRESHOLD, TOKEN_FAILURE_WINDOW_MS"
    - "app/services/admin-client.server.ts — getAdminContext wraps unauthenticated.admin and the returned graphql with the token-health hooks"
    - "app/services/shop-lifecycle.server.ts — redactShop deletes enforcementEvent"
    - "tests/helpers/offline-session.ts — expiredRefreshableSession(shop)"
    - "tests/admin-token-health.test.ts — the #30 suite"
  key_links:
    - "app/shopify.server.ts validateWebhook → webhook-validate.server.ts → webhooks.compliance.tsx AND webhooks.app.uninstalled.tsx (neither imports authenticate any more)"
    - "admin-client.server.ts getAdminContext → token-health.server.ts recordTokenFailure → shop-lifecycle.deactivateShop + db.session.deleteMany; every sweep and webhook reaches Shopify only through this seam, so the counter sees every construction and every GraphQL call"
    - "tests keep HMAC verification real: only shopify.server's unauthenticated.admin / authenticate.admin are vi.mock'ed; the seam module itself is NOT mocked in the #30 suite"
---

# Quick task 260910-nhm — hotfix v1.0.1: GDPR/uninstall webhooks without a session load, EnforcementEvent redaction, dead-token auto-deactivation

<objective>
Ship v1.0.1 closing WINDOWS #31, #32 and #30 with regression tests, on main, no push, no deploy.

Purpose: reviewer store eztcd0-3u's `shop/redact` has answered 500 nine times since 2026-09-05T19:25Z because `authenticate.webhook` tries to refresh an expired offline token before the handler runs (library `ensureValidOfflineSession → ensureOfflineTokenIsNotExpired → refreshToken`, which throws a bare `Response(500)` for a store that no longer exists). The store's data is never redacted — a live GDPR failure. The same path can 500 `app/uninstalled`. Separately `redactShop` leaks `EnforcementEvent` rows (#32), and six of seven "active" production shops have dead tokens the hourly sweeps hammer every cycle (#30).

Output: two webhook routes validating HMAC through a validation-only `shopifyApi` instance (no session load, no refresh); `redactShop` covering `EnforcementEvent`; a time-gated token-health strike counter at the admin seam that deactivates a shop after three separate sweep cycles of token-class failures (one strike per 30-minute window, so one sweep's burst counts once); version 1.0.1 + CHANGELOG + guide + ledger; four conventional commits ending in `release: v1.0.1`.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/quick/260910-nhm-hotfix-v1-0-1-compliance-uninstalled-web/260910-nhm-CONTEXT.md
@.planning/WINDOWS.md
@.claude/CLAUDE.md
@app/shopify.server.ts
@app/routes/webhooks.compliance.tsx
@app/routes/webhooks.app.uninstalled.tsx
@app/services/shop-lifecycle.server.ts
@app/services/admin-client.server.ts
@app/services/scheduler.server.ts
@tests/webhooks.compliance.test.ts
@tests/shop-lifecycle.test.ts
@tests/helpers/webhook-hmac.ts
@tests/helpers/module-source.ts
@prisma/schema.prisma
@CHANGELOG.md
</context>

## Locked facts (from 260910-nhm-CONTEXT.md — verified against node_modules, override the brief)

- **CONTEXT §1:** `shopifyApp()` returns `{ sessionStorage, addDocumentResponseHeaders, registerWebhooks, authenticate, unauthenticated, login }`. The internal `api` lives in closure `params` and is NOT exposed. `shopify.api.webhooks.validate` does not exist; the brief's suggestion is withdrawn.
- **CONTEXT §2:** the sanctioned replacement is ONE extra validation-only `shopifyApi()` instance in `app/shopify.server.ts`, built from the same env vars as the main config, exported as a single function `validateWebhook({ rawBody, rawRequest })`. `@shopify/shopify-api` **13.1.0** is already installed transitively; add it as a DIRECT dependency at exactly that version. Installed library versions (re-checked this session): `@shopify/shopify-app-react-router` 1.2.1 (depends on `@shopify/shopify-api ^13.1.0`), `@shopify/shopify-api` 13.1.0. The react-router package re-exports only `ApiVersion, BillingInterval, BillingReplacementBehavior, DeliveryMethod, LogSeverity, Session, AppDistribution, LoginErrorType, boundary, shopifyApp, SessionNotFoundError` — not `shopifyApi`, `HttpResponseError` or `WebhookValidationErrorReason`.
- **CONTEXT §3:** token-class failures at the seam are exactly (1) a thrown `Response` with `status === 500` from `unauthenticated.admin(shop)` itself, (2) `HttpResponseError` with `response.code === 400` and `response.body?.error === "invalid_subject_token"`, (3) `HttpResponseError` with `response.code === 401` thrown by `admin.graphql()`. Nothing else.

## Library facts the executor relies on (verified this session; do not re-derive)

- `node_modules/@shopify/shopify-app-react-router/dist/esm/server/authenticate/webhooks/authenticate.mjs`: order is non-POST → `Response 405 "Method not allowed"`; `const rawBody = await request.text()`; `api.webhooks.validate({ rawBody, rawRequest: request })`; `!check.valid && check.reason === WebhookValidationErrorReason.InvalidHmac` → `Response 401 "Unauthorized"`; any other invalid → `Response 400 "Bad Request"`; THEN `ensureValidOfflineSession(params, check.domain)` (the 500 source). Both `Webhooks` and `Events` result shapes carry `topic`, `domain`, `webhookId`, `apiVersion`.
- `node_modules/@shopify/shopify-api/dist/esm/lib/webhooks/validate.mjs`: returns `{ valid: true, webhookType, hmac, topic: topicForStorage(header) /* "SHOP_REDACT" */, domain, apiVersion, webhookId, ... }` or `{ valid: false, reason }` where `WebhookValidationErrorReason = { MissingHeaders: "missing_headers", MissingBody: "missing_body", InvalidHmac: "invalid_hmac", ... }`. HMAC via `validateHmacFromRequestFactory` (timing-safe, threat T-01-10). Reads no session.
- `shopifyApi(config)` (`lib/config.mjs`) requires non-empty `apiSecretKey`, `hostName`, `apiVersion`, `apiKey`; `isEmbeddedApp: boolean` is required by the type; `hostScheme?: "http" | "https"`; `_logDisabledFutureFlags?: boolean` is typed (base-types.d.ts:131). Construction logs `version 13.1.0, environment ...` at Info — pass `logger: { level: LogSeverity.Warning }` so the second instance is silent. `deriveApi` in shopify-app.mjs uses `hostName: appUrl.host`, `hostScheme: appUrl.protocol.replace(":", "")`, `isEmbeddedApp: true`, `isCustomStoreApp: false`, `_logDisabledFutureFlags: false`.
- `helpers/refresh-token.mjs`: rethrows `InvalidJwtError` and `HttpResponseError` 400 `invalid_subject_token` as-is; EVERY other refresh error (including network errors) becomes `new Response(undefined, { status: 500, statusText: "Internal Server Error" })`. Class (1) therefore also absorbs a refresh-time network blip — the time-gated 3-strike rule (one strike per 30-minute window, three separate sweep cycles to deactivate, reset on any success) is the mitigation (threat T-Q30-06).
- `helpers/ensure-offline-token-is-not-expired.mjs`: refresh fires only when `future.expiringOfflineAccessTokens && session.isExpired(5 min) && session.refreshToken` — which is why the regression seed needs `expires` in the past AND a `refreshToken`.
- `unauthenticated/admin/factory.mjs`: `ensureValidOfflineSession` → no session → throws `SessionNotFoundError` (NOT token-class); else `adminClientFactory({ params, session })` with no `handleClientError`, so `clients/admin/graphql.mjs` rethrows the raw error from `client.request` — an HTTP 401 surfaces as `HttpResponseError` with `response.code === 401` (`throwFailedRequest` default branch in `lib/clients/common.mjs`). Success returns `new Response(JSON.stringify(apiResponse))`.
- `@shopify/shopify-api` exports at top level: `shopifyApi`, `LogSeverity`, `HttpResponseError` (constructor `{ message, code, statusText, body?, headers? }`), `WebhookValidationErrorReason`, `ShopifyError`.
- Placement evidence for #30 (why the SEAM, not `forEachActiveShop`'s catch): `publishCompanyCreditState` (metafields.server.ts:325) swallows every error into Sentry, and the reminder refetch (reminders.server.ts:1319) swallows into a claim resolution — so a dead token in the hourly overdue sweep or the reminder sweep NEVER reaches `forEachActiveShop`'s catch; only reconciliation rethrows (daily). A counter in that catch would see one failure a day and, if "fn resolved" counted as success, would be reset hourly by the publish backstop's silent failure — it could never reach 3. Every construction and every GraphQL call passes through `getAdminContext`, so the seam is the only place with both the failure and the success signal. The CF-3 source guard (`tests/scheduler.test.ts` "CF-3 source guard — one shop enumerator, and it filters") checks only `scheduler.server.ts`/`reconciliation.server.ts` for `.shop.(findMany|findFirst|findUnique|...|count|...)`; token-health reads `SyncCursor` and calls `deactivateShop` (an upsert in shop-lifecycle) — untouched.
- `gsd-tools windows fixed <id>` takes only the id (no reason flag) and rewrites the whole WINDOWS.md from the JSON block; set the entry's `"reason"` in the JSON block BEFORE running it.
- `tests/helpers/module-source.ts` exports `sourceWithoutComments(repoRelativePath)`.

## Reference shapes (executor copies verbatim)

`tests/helpers/offline-session.ts` — the seed that reproduces #31 (expired + refreshable):

```ts
/** An offline session whose token is expired but refreshable — the WINDOWS #31 seed. */
export function expiredRefreshableSession(shop: string) {
  return {
    id: `offline_${shop}`,
    shop,
    state: "",
    isOnline: false,
    scope:
      "read_orders,read_all_orders,read_payment_terms,read_companies,write_companies,write_validations,write_orders",
    expires: new Date(Date.now() - 60 * 60 * 1000),
    accessToken: "expired-offline-token",
    refreshToken: "refresh-token-shopify-will-reject",
    refreshTokenExpires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
}
```

`seedLedger` addition for #32 (after the `reminderLog.create`, in `tests/shop-lifecycle.test.ts`):

```ts
  // The Phase-4 enforcement trail: which company was held, at what exposure.
  // Snapshot columns, no FK — exactly the kind of row a redact must chase down.
  await prisma.enforcementEvent.create({
    data: {
      shop: domain,
      companyGid: `gid://shopify/Company/${suffix}`,
      companyName: `Company ${suffix}`,
      kind: "BLOCK_STATE_ENTERED",
      exposure: "500.0000",
      limit: "400.0000",
      overdue: false,
      bypass: false,
    },
  });
```

Token-class error constructors for `tests/admin-token-health.test.ts`:

```ts
import { HttpResponseError } from "@shopify/shopify-api";
import { SessionNotFoundError } from "@shopify/shopify-app-react-router/server";

const refreshFailure = () =>
  new Response(undefined, { status: 500, statusText: "Internal Server Error" });
const invalidSubjectToken = () =>
  new HttpResponseError({
    message: "invalid_subject_token",
    code: 400,
    statusText: "Bad Request",
    body: { error: "invalid_subject_token" },
  });
const unauthorized = () =>
  new HttpResponseError({
    message: "Received an error response (401 Unauthorized) from Shopify",
    code: 401,
    statusText: "Unauthorized",
    body: { errors: "[API] Invalid API key or access token (unrecognized login or wrong password)" },
  });
const adminThatThrows = (error: unknown) => ({
  session: {},
  admin: { graphql: vi.fn().mockRejectedValue(error) },
});
const adminThatSucceeds = () => ({
  session: {},
  admin: {
    graphql: vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { shop: { id: "gid://shopify/Shop/1" } } })),
    ),
  },
});
const PROBE = "query Probe { shop { id } }";
```

`SyncCursor` counter row (key/value, `@@unique([shop, key])`; compound-unique input name is `shop_key`): key `"token-failures"`, value `JSON.stringify({ count, lastAt, lastReason })` with `lastReason` one of `"refresh-failed" | "invalid-subject-token" | "unauthorized"`. `lastAt` is the ISO timestamp of the STRIKE that set `count` — the window anchor. A failure inside the window (`now - lastAt < TOKEN_FAILURE_WINDOW_MS`) updates `lastReason` only, never `count` or `lastAt`, so the window cannot slide: `runAttributionHealSweep` (reconciliation.server.ts) reaches the seam every 5 minutes for a shop with an UNRESOLVED net-terms order, and a sliding window would starve such a dead-token shop of its second strike forever; with the anchor fixed it accrues one strike per 30 minutes and is deactivated after three.

Test-side clock helpers for `tests/admin-token-health.test.ts` (the seam calls `recordTokenFailure` with the real clock, so seam-driven tests age the stored anchor instead of faking timers — Prisma keeps its own timers and must not see a fake clock):

```ts
const T0 = Date.parse("2026-09-10T12:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms);
const MIN = 60_000;

/** Age the stored strike anchor so the next failure lands in a new window. */
async function backdateFailureRecord(shop: string, ms: number) {
  const record = await failureRecord(shop);
  if (!record) throw new Error(`no token-failure record for ${shop}`);
  await prisma.syncCursor.update({
    where: { shop_key: { shop, key: TOKEN_FAILURE_KEY } },
    data: {
      value: JSON.stringify({
        ...record,
        lastAt: new Date(Date.now() - ms).toISOString(),
      }),
    },
  });
}
```

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: End-to-end "shop/redact answers 200 on an expired refreshable token" — one path only (WINDOWS #31)</name>
  <files>package.json, package-lock.json, app/shopify.server.ts, app/services/webhook-validate.server.ts, app/routes/webhooks.compliance.tsx, tests/helpers/offline-session.ts, tests/webhooks.compliance.test.ts</files>
  <read_first>
    - .planning/quick/260910-nhm-hotfix-v1-0-1-compliance-uninstalled-web/260910-nhm-CONTEXT.md (all three sections — locked)
    - node_modules/@shopify/shopify-app-react-router/dist/esm/server/authenticate/webhooks/authenticate.mjs (the contract to mirror, lines 1-35)
    - node_modules/@shopify/shopify-app-react-router/dist/esm/server/shopify-app.mjs lines 100-130 (deriveApi — the config keys to mirror)
    - app/shopify.server.ts, app/routes/webhooks.compliance.tsx, tests/webhooks.compliance.test.ts, tests/helpers/webhook-hmac.ts
  </read_first>
  <precondition>Network access for one `npm install`; Postgres reachable at TEST_DATABASE_URL (default postgresql://$USER@localhost:5432/creditguard_test) — `npm test` refuses to run against anything else and must never touch creditguard_dev.</precondition>
  <behavior>
    - RED first: add the fixture helper and the regression test below, run `npm test -- tests/webhooks.compliance.test.ts`, and observe the new test FAIL (the old route's session refresh makes a real token-endpoint round-trip for the fake shop — that round-trip IS the bug; the GREEN run is hermetic). EITHER outcome counts as RED: a 500 response (refresh-token.mjs collapses most refresh failures into Response 500) OR a thrown `HttpResponseError` with code 400 `invalid_subject_token` (which refresh-token.mjs rethrows as-is, so vitest reports the thrown error instead of a status). Only a 200 with the counts at zero is GREEN.
    - Test (add inside `describe("shop/redact (threat T-01-14)")`): `it("answers 200 and redacts when the stored offline token is expired but refreshable (WINDOWS #31)")` — seed `prisma.shop.create({ data: { domain: SHOP, active: true } })`, `prisma.complianceRequest.create({ data: { shop: SHOP, topic: "CUSTOMERS_REDACT" } })`, `prisma.session.create({ data: expiredRefreshableSession(SHOP) })`; send `signedWebhookRequest(ENDPOINT, "shop/redact", SHOP, compliancePayload(SHOP))` through `complianceResponse`; expect status 200, `countsFor(SHOP)` toEqual `{ shops: 0, complianceRequests: 0 }`, `prisma.session.count({ where: { shop: SHOP } })` toBe 0.
    - Every existing test in the file stays green unchanged — in particular the three "invalid HMAC (threat T-01-10)" tests (401, no side effect) and "never dereferences a session".
  </behavior>
  <action>
    1. Dependency (CONTEXT §2): run `npm install @shopify/shopify-api@13.1.0 --save-exact`. Then confirm with `git diff --stat package.json package-lock.json` that package.json gained exactly one `dependencies` line and the lockfile gained the same entry under the root package (`packages[""].dependencies`) — no new `resolved`/`integrity` lines (`git diff package-lock.json | grep -c '^+.*integrity'` must print 0) and `node_modules/@shopify/shopify-api/package.json` still reports 13.1.0. If the diff is larger, `git checkout package.json package-lock.json` and instead add the line by hand in package.json (alphabetical, `"@shopify/shopify-api": "13.1.0"`) and run `npm install --package-lock-only` to sync the lockfile, then re-check.

    2. `app/shopify.server.ts` — construct the validation-only instance AFTER the existing `shopifyApp({...})` call so an empty/invalid SHOPIFY_APP_URL still fails with the library's own message first. Add `import { LogSeverity, shopifyApi } from "@shopify/shopify-api";`. Parse `const appUrl = new URL(process.env.SHOPIFY_APP_URL || "")` once; build `const validationApi = shopifyApi({ apiKey: process.env.SHOPIFY_API_KEY ?? "", apiSecretKey: process.env.SHOPIFY_API_SECRET || "", apiVersion: ApiVersion.July26, scopes: process.env.SCOPES?.split(","), hostName: appUrl.host, hostScheme: appUrl.protocol === "http:" ? "http" : "https", isEmbeddedApp: true, isCustomStoreApp: false, future: {}, _logDisabledFutureFlags: false, logger: { level: LogSeverity.Warning } })`. Export ONE function: `export const validateWebhook = (args: { rawBody: string; rawRequest: Request }) => validationApi.webhooks.validate(args);`. Do not export the instance. Header comment: why a second instance exists (CONTEXT §1 — the app object hides its `api`; this instance verifies signatures only and never loads a session), and that its secret comes from the SAME env var as the main config so the two can never diverge (vitest.config.ts pins SHOPIFY_API_SECRET for tests).

    3. New `app/services/webhook-validate.server.ts` — `export async function validateWebhookRequest(request: Request): Promise<{ shop: string; topic: string; webhookId: string; apiVersion: string }>`. Mirror the library authenticator byte-for-byte in behaviour: `request.method !== "POST"` → `throw new Response(undefined, { status: 405, statusText: "Method not allowed" })`; `const rawBody = await request.text()` exactly once, before validation; `const check = await validateWebhook({ rawBody, rawRequest: request })`; `!check.valid` and `check.reason === WebhookValidationErrorReason.InvalidHmac` (import the constant from `@shopify/shopify-api`) → `throw new Response(undefined, { status: 401, statusText: "Unauthorized" })` with NO side effect; any other invalid → `throw new Response(undefined, { status: 400, statusText: "Bad Request" })`; return `{ shop: check.domain, topic: check.topic, webhookId: check.webhookId, apiVersion: check.apiVersion }` (if TypeScript rejects a field on the valid-result union, narrow on `check.webhookType` rather than casting). Never hand-roll the HMAC comparison (threat T-01-10) — the library's `validateHmacFromRequestFactory` is the comparison. Header comment: which two routes use it and why they must not load a session (WINDOWS #31: the session-loading authenticator refreshes an expired offline token before the handler runs and 500s when Shopify refuses — for a deleted store, forever). The module must contain no `session` identifier in code (comments are fine) so the compliance route's existing guard reasoning carries over.

    4. `app/routes/webhooks.compliance.tsx` — replace the `authenticate` import with `import { validateWebhookRequest } from "../services/webhook-validate.server";` and the first statement with `const { shop, topic } = await validateWebhookRequest(request);`. Leave the switch, the receipts, `redactShop(shop)` and the default branch untouched. Rewrite the header paragraph that currently credits the library authenticator with the HMAC check: name `validateWebhookRequest`, state that it throws 401 before a single line below runs, that the body is read once inside it, and that the reason for not using the session-loading authenticator is WINDOWS #31 (its refresh step, described above). Keep the "no session in scope" paragraph — it is now literally true.

    5. `tests/helpers/offline-session.ts` — the `expiredRefreshableSession` shape from "Reference shapes" verbatim.

    6. `tests/webhooks.compliance.test.ts` — import `expiredRefreshableSession`; add the regression test from `<behavior>`; update the file header comment ("`authenticate.webhook` is deliberately NOT mocked here" → HMAC verification is real — `validateWebhook` in shopify.server.ts is the library's own validator and is never mocked). No other assertion changes.

    Commit: `fix(webhooks): shop/redact verifies HMAC without loading the offline session (WINDOWS #31)` — files: package.json, package-lock.json, app/shopify.server.ts, app/services/webhook-validate.server.ts, app/routes/webhooks.compliance.tsx, tests/helpers/offline-session.ts, tests/webhooks.compliance.test.ts.
  </action>
  <verify>
    <automated>export PATH="$HOME/.npm-global/bin:$PATH" && cd "/Users/hesamabbaszadi/Documents/Projects/Credit Guard" && npm test -- tests/webhooks.compliance.test.ts && grep -c '"@shopify/shopify-api": "13.1.0"' package.json && git diff --quiet ba3a180 HEAD -- shopify.app.toml extensions/ prisma/schema.prisma && git log -1 --format=%s | grep -q '^fix(webhooks)'</automated>
  </verify>
  <done>The new WINDOWS #31 test passes hermetically (no token-endpoint round-trip); all pre-existing tests in tests/webhooks.compliance.test.ts pass unchanged, including the three forged-HMAC 401 tests; package.json declares @shopify/shopify-api 13.1.0 exactly with no new integrity lines in the lockfile; app/shopify.server.ts exports validateWebhook and nothing else new; the compliance route no longer imports from shopify.server at all; one fix(webhooks) commit exists on main.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Expand — app/uninstalled on the same validator, 405/400 contract tests, source guard, and EnforcementEvent redaction (WINDOWS #31 + #32)</name>
  <files>app/routes/webhooks.app.uninstalled.tsx, app/services/shop-lifecycle.server.ts, tests/shop-lifecycle.test.ts, tests/webhooks.compliance.test.ts</files>
  <read_first>
    - app/routes/webhooks.app.uninstalled.tsx (the `if (session)` guard is what goes away)
    - app/services/shop-lifecycle.server.ts (redactShop transaction order; REDACTION CONTRACT header)
    - tests/shop-lifecycle.test.ts (wipe, countsFor, EMPTY_COUNTS, seedLedger, the "app/uninstalled webhook route" describe and its source assertions)
    - tests/helpers/module-source.ts (sourceWithoutComments signature)
    - prisma/schema.prisma `model EnforcementEvent` (required: shop, companyGid, companyName, kind, exposure, overdue, bypass)
  </read_first>
  <behavior>
    - tests/shop-lifecycle.test.ts, in `describe("app/uninstalled webhook route")`: `it("answers 200, deletes an expired refreshable session and deactivates the shop (WINDOWS #31)")` — seed `prisma.shop.create({ data: { domain: SHOP } })`, one `complianceRequest` (topic "CUSTOMERS_DATA_REQUEST"), `prisma.session.create({ data: expiredRefreshableSession(SHOP) })`; `uninstallAction(uninstallRequest())` → 200; `countsFor(SHOP)` has `sessions: 0`, `shops: 1`, `complianceRequests: 1`; the shop row has `active === false` and `uninstalledAt` instanceof Date.
    - tests/shop-lifecycle.test.ts, new `describe("shop/redact route with a stale offline session (WINDOWS #31)")` with helper `redactAction(request)` that dynamically imports `../app/routes/webhooks.compliance` and calls `action({ request, params: {}, context: {} } as never)`: `it("zeroes every counted table when the stored token is expired but refreshable")` — seed shop (active: false), `seedLedger(SHOP, "1")`, one complianceRequest, `expiredRefreshableSession(SHOP)`; guard `expect((await countsFor(SHOP)).enforcementEvents).toBe(1)` before; signed `shop/redact` via `signedWebhookRequest(`${APP_URL}/webhooks/compliance`, "shop/redact", SHOP, { shop_id: 99, shop_domain: SHOP })` → 200; `countsFor(SHOP)` toEqual `EMPTY_COUNTS`.
    - tests/shop-lifecycle.test.ts #32: `countsFor` gains `enforcementEvents: await prisma.enforcementEvent.count({ where: { shop: domain } })`; `EMPTY_COUNTS` gains `enforcementEvents: 0`; `wipe` gains `prisma.enforcementEvent.deleteMany({ where: { shop: { in: domains } } })` (first line, it has no FK); `seedLedger` gains the EnforcementEvent row from "Reference shapes"; the existing test "deletes every shop-keyed ledger table's rows (Phase 2 models)" gains `expect(before.enforcementEvents).toBe(1)`; the bystander expectation in "leaves a bystander shop's ledger completely intact" gains `enforcementEvents: 1`. RED: with only the test changes applied, "deletes every shop-keyed ledger table's rows" fails on `enforcementEvents: 1` — that is #32 reproduced; then fix `redactShop`.
    - tests/webhooks.compliance.test.ts, new `describe("request contract (mirrors the library authenticator)")`: `it("answers 405 to a non-POST request")` — `new Request(ENDPOINT, { method: "GET" })` through `complianceResponse` → 405; `it("answers 400 when the HMAC is valid but a required header is missing")` — build `signedWebhookRequest(ENDPOINT, "shop/redact", SHOP, compliancePayload(SHOP))`, copy its headers into `new Headers(...)`, `delete("X-Shopify-Webhook-Id")`, rebuild `new Request(ENDPOINT, { method: "POST", headers, body: await signed.text() })` (same body ⇒ signature still valid) → 400, and a pre-seeded `prisma.shop` row for SHOP is still counted 1 afterwards; `it("both webhook routes verify through validateWebhookRequest, never the session-loading authenticator (WINDOWS #31)")` — for each of `app/routes/webhooks.compliance.tsx` and `app/routes/webhooks.app.uninstalled.tsx`, `const code = sourceWithoutComments(path)`; `expect(code.length).toBeGreaterThan(200)`; `expect(code).toContain("validateWebhookRequest")`; `expect(code).not.toMatch(/\bauthenticate\b/)`.
  </behavior>
  <action>
    1. `app/routes/webhooks.app.uninstalled.tsx` — swap the `authenticate` import for `validateWebhookRequest` (same path as Task 1) and destructure `{ shop, topic }` from it. Delete the `if (session)` guard: run `await db.session.deleteMany({ where: { shop } })` unconditionally (deleteMany is a no-op on redelivery), then `await deactivateShop(shop)` unconditionally as now, then `return new Response()`. Comment at the deleteMany: the sessions are dead the moment the app is uninstalled AND this route deliberately never loads one — the library authenticator would try to refresh an already-stale token here and 500 the delivery (WINDOWS #31), leaving a live merchant marked active for 48 h of retries. Keep the D-06 retain paragraph. The existing source assertions must stay true: no `shop.delete`, no `complianceRequest.delete`, `deactivateShop` present.

    2. `app/services/shop-lifecycle.server.ts` — in `redactShop`'s `$transaction` array add `db.enforcementEvent.deleteMany({ where: { shop: domain } })` immediately after the `reminderLog.deleteMany` line and before `ledgerSchedule` (WINDOWS #32: it carries `companyGid`/`companyName` snapshots with no FK, so it must go before the ledger rows it describes, matching the reminderLog placement). Extend the comment block above reminderLog to name both trails. In the REDACTION CONTRACT header paragraph add one sentence: `EnforcementEvent` was the model that slipped through (#32, fixed 1.0.1) — the counter in `countsFor` is what would have caught it.

    3. `tests/shop-lifecycle.test.ts` — apply every change in `<behavior>` (import `expiredRefreshableSession` from `./helpers/offline-session`; the `redactAction` helper; `wipe`/`countsFor`/`EMPTY_COUNTS`/`seedLedger`/two existing-test edits; the two new tests). The file's `vi.mock("../app/shopify.server", ...)` factory spreads `...actual`, so the new `validateWebhook` export and the default export stay real — do not touch the mock.

    4. `tests/webhooks.compliance.test.ts` — add the `request contract` describe with its three tests; import `sourceWithoutComments` from `./helpers/module-source`.

    Commits (two, per concern): `fix(webhooks): app/uninstalled verifies HMAC without loading the offline session; 405/400 contract tests (WINDOWS #31)` — files: app/routes/webhooks.app.uninstalled.tsx, tests/shop-lifecycle.test.ts (route-related hunks), tests/webhooks.compliance.test.ts; then `fix(lifecycle): redact EnforcementEvent rows on shop/redact (WINDOWS #32)` — files: app/services/shop-lifecycle.server.ts, tests/shop-lifecycle.test.ts (#32 hunks). If splitting the test file's hunks across two commits is impractical, commit the whole test file with the second commit and say so in the first commit body.
  </action>
  <verify>
    <automated>export PATH="$HOME/.npm-global/bin:$PATH" && cd "/Users/hesamabbaszadi/Documents/Projects/Credit Guard" && npm test -- tests/shop-lifecycle.test.ts tests/webhooks.compliance.test.ts && grep -c "enforcementEvent.deleteMany" app/services/shop-lifecycle.server.ts && git log -2 --format=%s | grep -q '^fix(lifecycle)'</automated>
  </verify>
  <done>Both new #31 route tests and all three request-contract tests pass; `redactShop` deletes EnforcementEvent and `countsFor`/`EMPTY_COUNTS`/`seedLedger`/`wipe` all know the model (the two-sided redaction contract is closed on both sides); every pre-existing test in both files passes unchanged; the source guard proves neither route references the session-loading authenticator; two commits (fix(webhooks), fix(lifecycle)) exist on main.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Token-health at the admin seam — three time-gated token-class strikes across separate sweep cycles deactivate the shop (WINDOWS #30)</name>
  <files>app/services/token-health.server.ts, app/services/admin-client.server.ts, tests/admin-token-health.test.ts</files>
  <read_first>
    - .planning/quick/260910-nhm-hotfix-v1-0-1-compliance-uninstalled-web/260910-nhm-CONTEXT.md §3 (the closed list of token-class failures)
    - app/services/admin-client.server.ts (the seam; its header explains why other modules must never import a wrapper from it)
    - app/services/scheduler.server.ts `forEachActiveShop` (the per-shop swallow-but-log that must stay intact) and the "Placement evidence" bullet above
    - app/services/reconciliation.server.ts `runAttributionHealSweep` (the 5-minute caller of the seam — the reason the strike window is anchored at strike time, not sliding)
    - app/services/ledger.server.ts `graphqlJson` (~line 206: `getAdminContext(shop)` per GraphQL call — the reason strikes are time-gated at all)
    - app/services/shop-lifecycle.server.ts `deactivateShop`
    - tests/shop-lifecycle.test.ts lines 1-35 (the `vi.mock("../app/shopify.server", ...)` pattern to copy, swapping `authenticate.admin` for `unauthenticated.admin`)
    - tests/scheduler.test.ts lines 745-800 (the CF-3 source guard this task must keep green)
    - prisma/schema.prisma `model SyncCursor` and `model Session`
  </read_first>
  <precondition>Tasks 1–2 committed (this suite imports tests/helpers/offline-session.ts and app/shopify.server.ts with validateWebhook present).</precondition>
  <behavior>
    New file `tests/admin-token-health.test.ts`. Mock ONLY `unauthenticated.admin` (hoisted `vi.fn()` via the shop-lifecycle pattern: `vi.mock("../app/shopify.server", async (importOriginal) => ({ ...actual, unauthenticated: { ...actual.unauthenticated, admin: unauthenticatedAdmin } }))`); the seam module `app/services/admin-client.server.ts` is imported for real. `import prisma from "../app/db.server"` — the SAME client the app uses, so a `vi.spyOn(prisma.syncCursor, "deleteMany")` sees the seam's DELETEs (`vi.spyOn(prisma.enforcementEvent, "create")` in tests/enforcement-events.test.ts is the precedent). Constants `SHOP = "token-health.myshopify.com"`, `OTHER_SHOP = "token-health-bystander.myshopify.com"`, `NO_ROW_SHOP = "token-health-norow.myshopify.com"`. `wipe` deletes syncCursor (`key: "token-failures"`), session, complianceRequest and shop rows for all THREE — NO_ROW_SHOP included, because `deactivateShop` upserts a `Shop{active:false}` row on the third strike of the never-masks test and it must not leak past `afterAll`. `failureRecord(shop)` reads the SyncCursor row and returns the parsed JSON or null. The `T0`/`at`/`MIN`/`backdateFailureRecord` helpers from "Reference shapes". `beforeEach` resets the mock and wipes; `afterAll` wipes and disconnects. Use the constructors from "Reference shapes".
    - `it("classifies exactly the three token-class failures")` — pure: `classifyConstructionFailure(refreshFailure())` → "refresh-failed"; `classifyConstructionFailure(invalidSubjectToken())` → "invalid-subject-token"; `classifyRequestFailure(unauthorized())` → "unauthorized"; and null for every one of: `classifyConstructionFailure(new Error("ECONNRESET"))`, `classifyConstructionFailure(new HttpResponseError({ message: "x", code: 500, statusText: "Internal Server Error" }))`, `classifyConstructionFailure(new HttpResponseError({ message: "x", code: 400, statusText: "Bad Request", body: { error: "invalid_grant" } }))`, `classifyConstructionFailure(new Response(undefined, { status: 502 }))`, `classifyConstructionFailure(new SessionNotFoundError("none"))`, `classifyConstructionFailure(unauthorized())` (a 401 never surfaces from construction — refresh-token.mjs collapses it), `classifyRequestFailure(refreshFailure())`, `classifyRequestFailure(new HttpResponseError({ message: "x", code: 403, statusText: "Forbidden" }))`, `classifyRequestFailure(new Error("timeout"))`.
    - `it("three strikes in three separate windows deactivate the shop on the third and delete its sessions")` — seed SHOP active with `expiredRefreshableSession(SHOP)` and one complianceRequest; seed OTHER_SHOP active with `expiredRefreshableSession(OTHER_SHOP)`; `unauthenticatedAdmin.mockRejectedValue(refreshFailure())`. Strike 1: `await expect(getAdminContext(SHOP)).rejects.toBeInstanceOf(Response)`; `failureRecord(SHOP)` is `{ count: 1, lastReason: "refresh-failed", lastAt: <ISO string> }`, shop `active === true`, sessions 1. Same-window burst: two more immediate `getAdminContext(SHOP)` rejections → `count` still 1 and `lastAt` byte-identical to strike 1 (the anchor did not slide — this is the hourly-sweep-over-N-companies case). `await backdateFailureRecord(SHOP, 31 * MIN)`; strike 2: rejects → count 2, shop active, sessions 1. `await backdateFailureRecord(SHOP, 31 * MIN)`; strike 3: rejects again (the original error is rethrown, not swallowed); then shop `active === false`, `uninstalledAt` instanceof Date, `session.count` 0, `failureRecord(SHOP)` null (counter cleared so a reinstall starts fresh), complianceRequest count 1 and shop count 1 (deactivate, never delete — D-06); OTHER_SHOP still active with 1 session and no record.
    - `it("repeated failures inside one sweep window count once")` — drives `recordTokenFailure` directly with explicit clocks (seed SHOP active with `expiredRefreshableSession(SHOP)` first): `recordTokenFailure(SHOP, "refresh-failed", at(0))`, `at(1_000)` and `at(2_000)` each return `{ count: 1, deactivated: false }` and afterwards `failureRecord(SHOP)` equals `{ count: 1, lastAt: at(0).toISOString(), lastReason: "refresh-failed" }`; a fourth at `at(31 * MIN)` returns `{ count: 2, deactivated: false }` with `lastAt === at(31 * MIN).toISOString()`; a fifth at `at(31 * MIN + 1_000)` with reason `"unauthorized"` returns count 2 and the record now reads `lastReason: "unauthorized"` with `lastAt` unchanged (in-window: reason only); a sixth at `at(62 * MIN)` returns `{ count: 3, deactivated: true }` — shop inactive, sessions 0, record null. Also assert `TOKEN_FAILURE_WINDOW_MS === 30 * MIN` and `TOKEN_FAILURE_THRESHOLD === 3`.
    - `it("an invalid_subject_token refresh rejection counts as a token failure")` — `const error = invalidSubjectToken(); unauthenticatedAdmin.mockRejectedValue(error)`; `await expect(getAdminContext(SHOP)).rejects.toBe(error)`; record `{ count: 1, lastReason: "invalid-subject-token" }`.
    - `it("an Admin API 401 thrown by the client counts as a token failure")` — `const error = unauthorized(); unauthenticatedAdmin.mockResolvedValue(adminThatThrows(error))`; `const client = await getAdminContext(SHOP)`; `await expect(client.graphql(PROBE)).rejects.toBe(error)`; record `{ count: 1, lastReason: "unauthorized" }`.
    - `it("a successful Admin call resets the counter")` — one refresh failure, `backdateFailureRecord(SHOP, 31 * MIN)`, a second refresh failure (count 2); then `unauthenticatedAdmin.mockResolvedValue(adminThatSucceeds())`; `const client = await getAdminContext(SHOP); const body = await (await client.graphql(PROBE)).json()`; expect `body.data.shop.id` to be "gid://shopify/Shop/1"; `failureRecord(SHOP)` null; then `mockRejectedValue(refreshFailure())` once more → count 1 (not 3), shop still active, sessions 1.
    - `it("confirms a shop healthy once per process — a second success issues no second DELETE")` — seed SHOP active with `expiredRefreshableSession(SHOP)`; one `refreshFailure()` rejection first (count 1 — and `recordTokenFailure` removes SHOP from the healthy set, which makes this test independent of whichever earlier test last touched SHOP); `unauthenticatedAdmin.mockResolvedValue(adminThatSucceeds())`; `const spy = vi.spyOn(prisma.syncCursor, "deleteMany")` (restored in `finally`); first `await getAdminContext(SHOP)` + `graphql(PROBE)` → `failureRecord(SHOP)` null and `spy` called exactly once with `{ where: { shop: SHOP, key: TOKEN_FAILURE_KEY } }`; a NEW `await getAdminContext(SHOP)` (exactly what `graphqlJson` does on every call) + `graphql(PROBE)` → `spy` still called once; then `mockRejectedValue(refreshFailure())` → rejects, count 1; `mockResolvedValue(adminThatSucceeds())` → new context + `graphql` → `spy` now called twice (a recorded failure re-arms the DELETE).
    - `it("a non-token error never increments the counter or deactivates")` — three rejections each of `new Error("ECONNRESET")`, `new HttpResponseError({ message: "x", code: 500, statusText: "Internal Server Error" })`, `new HttpResponseError({ message: "x", code: 400, statusText: "Bad Request", body: { error: "invalid_grant" } })` and `new SessionNotFoundError("none")` at construction, plus three `adminThatThrows(new HttpResponseError({ message: "x", code: 403, statusText: "Forbidden" }))` at request time — twelve-plus rethrows in total; throughout: `failureRecord(SHOP)` null, shop active, sessions 1.
    - `it("bookkeeping never masks the original error")` — `unauthenticatedAdmin.mockRejectedValue(refreshFailure())` for NO_ROW_SHOP (no Shop row, no session): still rejects with the Response (recordTokenFailure's upsert works without a Shop row); drive it to the third strike with `backdateFailureRecord(NO_ROW_SHOP, 31 * MIN)` between calls and assert the third call STILL rethrows the Response while `deactivateShop`'s upsert leaves a `Shop{active:false}` row — a row `wipe` removes in `beforeEach`/`afterAll` because NO_ROW_SHOP is in its list.
    - `it("admin-client.server.ts is the only module that constructs an unauthenticated admin client (source guard)")` — for every file under `app/services` and `app/routes` (readdirSync, `.ts`/`.tsx`) except `app/services/admin-client.server.ts`: `expect(sourceWithoutComments(path)).not.toMatch(/unauthenticated\s*\.\s*admin/)`; and the seam's own stripped source matches it exactly once.
  </behavior>
  <action>
    1. New `app/services/token-health.server.ts` (imports: `db` from "../db.server", `deactivateShop` from "./shop-lifecycle.server", `HttpResponseError` from "@shopify/shopify-api" — a direct dependency since Task 1; `instanceof` is safe because exactly one copy of the package is installed and the react-router library throws from that same copy). Exports: `TOKEN_FAILURE_KEY = "token-failures"`, `TOKEN_FAILURE_THRESHOLD = 3`, `TOKEN_FAILURE_WINDOW_MS = 30 * 60 * 1000` (declared on the line after the threshold; 30 minutes is inside one hourly sweep cadence and outside two), `type TokenFailureReason = "refresh-failed" | "invalid-subject-token" | "unauthorized"`, `classifyConstructionFailure(error: unknown): TokenFailureReason | null` (Response with `status === 500` → "refresh-failed"; `HttpResponseError` with `response.code === 400 && response.body?.error === "invalid_subject_token"` → "invalid-subject-token"; else null), `classifyRequestFailure(error: unknown): TokenFailureReason | null` (`HttpResponseError` with `response.code === 401` → "unauthorized"; else null), `recordTokenFailure(shop: string, reason: TokenFailureReason, now = new Date()): Promise<{ count: number; deactivated: boolean }>` and `clearTokenFailures(shop: string): Promise<void>`. Module-level, not exported: `const healthyShops = new Set<string>()` — shops confirmed healthy (one successful GraphQL call) since process start.
       `recordTokenFailure`: FIRST `healthyShops.delete(shop)` (re-arms the next success's DELETE); then `db.syncCursor.findUnique({ where: { shop_key: { shop, key: TOKEN_FAILURE_KEY } } })` and parse the JSON value defensively (malformed or absent → `{ count: 0, lastAt: null }`). TIME GATE: if a prior record exists with a parseable `lastAt` and `now.getTime() - Date.parse(lastAt) < TOKEN_FAILURE_WINDOW_MS`, this failure is inside the current strike's window — upsert the row with `count` and `lastAt` UNCHANGED and only `lastReason: reason`, and return `{ count: prior.count, deactivated: false }` (the anchor never slides; the SyncCursor note under "Reference shapes" explains why — the 5-minute heal sweep). Otherwise it is a new strike: `count = prior.count + 1`; if `count >= TOKEN_FAILURE_THRESHOLD`: `await deactivateShop(shop)`, `await db.session.deleteMany({ where: { shop } })` (so a later shop/redact needs no refresh — and so does the app/uninstalled route, though Task 2 already made it session-free), `await db.syncCursor.deleteMany({ where: { shop, key: TOKEN_FAILURE_KEY } })`, then exactly ONE `console.log` line of the form `Deactivated <shop> after <count> unrefreshable-token strikes in separate sweep cycles (last: <reason>) — treating the revoked token as an uninstall (WINDOWS #30)`; return `{ count, deactivated: true }`; otherwise upsert the row with `value: JSON.stringify({ count, lastAt: now.toISOString(), lastReason: reason })` and return `{ count, deactivated: false }`.
       `clearTokenFailures`: `if (healthyShops.has(shop)) return;` then `await db.syncCursor.deleteMany({ where: { shop, key: TOKEN_FAILURE_KEY } })` and only THEN `healthyShops.add(shop)` (a DELETE that throws is retried on the next success). Bound, stated in the header: one DELETE per shop per process lifetime, plus one more after any recorded failure — never one per GraphQL call (`graphqlJson` constructs a client per call, so without the set an hourly sweep would issue one DELETE per company).
       Header comment: the WINDOWS #30 story; the closed classification list with the source of each (refresh-token.mjs / throwFailedRequest); the explicit NEVER list (network errors, timeouts, Shopify 5xx, throttling, other 4xx, GraphQL userErrors, LedgerGraphqlError, SessionNotFoundError); why class (1) also swallows a refresh-time network blip; the STRIKE model — strikes are time-gated to one per TOKEN_FAILURE_WINDOW_MS because `graphqlJson` constructs a client per GraphQL call, so one hourly sweep over N companies during a transient token-endpoint hiccup would otherwise deliver N strikes within seconds and deactivate a LIVE merchant (silently stopping its overdue flip, publish backstop, reminders and reconciliation — the exact failure the product exists to prevent); why the anchor is fixed at strike time rather than sliding (the 5-minute heal sweep would otherwise starve a dead-token shop of its second strike forever); that deactivation therefore needs three separate sweep cycles (≥ ~2 h at the hourly cadence, ≥ ~1 h for a shop the heal sweep touches) with no successful call in between, and is reversible by `ensureShopActive` on the merchant's next authenticated load (D-06); the healthy-set DELETE bound; that the counter lives in SyncCursor to avoid a schema migration in a hotfix; and that the read-modify-write is not atomic — two overlapping processes (deploy overlap) inside the same window agree on the same anchor and write the same count, so the race is at worst an undercount, never a false extra strike from a single failure.

    2. `app/services/admin-client.server.ts` — keep the module's export surface identical (`LedgerAdminClient`, `getAdminContext`) so every suite's `vi.mock` factory still works. Inside `getAdminContext`: wrap `await unauthenticated.admin(shop)` in try/catch — on throw, `const reason = classifyConstructionFailure(error)`; if non-null, `await recordTokenFailure(shop, reason)` inside its own try/catch that only `console.error`s a bookkeeping failure (bookkeeping must never mask or replace the original error); always rethrow the original error. Return a thin object implementing `LedgerAdminClient` whose `graphql(query, options)` calls the library client, and: on success, `await clearTokenFailures(shop)` (a no-op once the shop is in token-health's process-level healthy set, so this costs one DELETE per shop per process — no per-instance flag is kept, because `graphqlJson` builds a new instance per call and a per-instance flag would still mean one DELETE per call), then return the response; on throw, `classifyRequestFailure(error)` → if non-null, `recordTokenFailure` under the same never-mask rule; always rethrow. Update the header: the seam now also hosts the WINDOWS #30 token-health hooks precisely BECAUSE it is the single place every construction and every GraphQL call passes through (cite the placement evidence: metafields.server.ts:325 and reminders.server.ts:1319 swallow before `forEachActiveShop` could see anything), and the seam's own behaviour toward callers is unchanged — every error is rethrown, so `forEachActiveShop`'s per-shop swallow-but-log path and the webhook routes' `SessionNotFoundError` named-class catch are untouched. No Sentry import here (the caller already tags the rethrown error).

    3. `tests/admin-token-health.test.ts` — implement every test in `<behavior>` with those exact names. Import `getAdminContext` from "../app/services/admin-client.server", the four token-health exports from "../app/services/token-health.server", `expiredRefreshableSession` from "./helpers/offline-session", `sourceWithoutComments` from "./helpers/module-source", `HttpResponseError` from "@shopify/shopify-api", `SessionNotFoundError` from "@shopify/shopify-app-react-router/server".

    4. Confirm the untouched guards: `npm test -- tests/scheduler.test.ts` (CF-3 source guard — scheduler.server.ts is not modified by this task) and `npm test -- tests/reconciliation.test.ts tests/reminders.test.ts` (the seam is mocked there; WINDOWS #25's flaky "only ONE schedule per sweep" is pre-existing — rerun once in isolation if it flakes, do not "fix" it here).

    Commit: `feat(scheduler): deactivate a shop after three sweep cycles of unrefreshable-token failures at the admin seam (WINDOWS #30)` — files: app/services/token-health.server.ts, app/services/admin-client.server.ts, tests/admin-token-health.test.ts.
  </action>
  <verify>
    <automated>export PATH="$HOME/.npm-global/bin:$PATH" && cd "/Users/hesamabbaszadi/Documents/Projects/Credit Guard" && npm test -- tests/admin-token-health.test.ts tests/scheduler.test.ts && grep -c "classifyConstructionFailure\|classifyRequestFailure" app/services/admin-client.server.ts && git diff --quiet HEAD~1 HEAD -- app/services/scheduler.server.ts prisma/schema.prisma && git log -1 --format=%s | grep -q '^feat(scheduler)'</automated>
  </verify>
  <done>All ten token-health tests pass against real Postgres with real HMAC-free seam construction; the third time-gated strike (three separate 30-minute windows, i.e. three sweep cycles) deactivates (active=false, uninstalledAt set, sessions 0, counter cleared, one log line) while a burst inside one window counts once, a success resets the counter with one DELETE per shop per process, and non-token errors never count; tests/scheduler.test.ts (CF-3 source guard) is green with scheduler.server.ts and schema.prisma untouched; the seam's export surface is unchanged; one feat(scheduler) commit exists on main.</done>
</task>

<task type="auto">
  <name>Task 4: Release plumbing, ledger closure, full gates, `release: v1.0.1`</name>
  <files>package.json, package-lock.json, CHANGELOG.md, .claude/CLAUDE.md, .planning/WINDOWS.md</files>
  <read_first>
    - CHANGELOG.md lines 1-12 (heading style is `## 1.0.0 — 2026-08-24` with `### Added` / `### Fixed` — the brief's bracketed form is NOT the existing format; match the existing one)
    - .claude/CLAUDE.md — locate every edit target by SEARCHING for its anchor text, never by line number (the guide moves): the module-map table (rows are ordered by descending line count — the new rows slot in where their counts fall), the routes bullet containing "webhooks.compliance.tsx", the paragraph beginning "**Redaction contract:**", the tests line "28 files." and the fence line "npm test          # 838 tests, 28 files", the ledger continuation line containing "entries, 11 open (#11, #18, #19, #24, #25, #26, #27, #28, #30, #31, #32), 1 waived (#4)." (the line before it ends in "32"), and the bullet list under "## Traps that already cost this project a cycle"
    - .planning/WINDOWS.md JSON block entries `"id": 30`, `"id": 31`, `"id": 32`
  </read_first>
  <precondition>Tasks 1–3 committed; working tree clean apart from this task's edits.</precondition>
  <action>
    1. Version: run `npm version 1.0.1 --no-git-tag-version` (updates package.json and BOTH root version fields of package-lock.json — top-level and `packages[""]` — and nothing else). Verify `grep -c '"version": "1.0.1"' package-lock.json` prints 2 and `git diff --stat` for the two files is tiny.

    2. `CHANGELOG.md` — insert above `## 1.0.0 — 2026-08-24`, in the existing format: heading `## 1.0.1 — 2026-09-10`, one-line intro ("Hotfix. Closes WINDOWS #30, #31 and #32. No schema change, no scope change, no Function change."), then `### Fixed` with three bullets in the house style (bold lead, one paragraph each): (a) **WINDOWS #31** — `shop/redact` and `app/uninstalled` no longer answer 500 when the stored offline token cannot be refreshed; both verify the HMAC through a validation-only `@shopify/shopify-api` instance and never load a session (live evidence: reviewer store eztcd0-3u, nine retried 500s from 2026-09-05T19:25Z, data never redacted); (b) **WINDOWS #32** — `EnforcementEvent` rows are now deleted on `shop/redact`, and the redaction-contract test counts them; (c) **WINDOWS #30** — the hourly sweeps auto-deactivate a shop after three consecutive hourly sweep cycles with an unrefreshable token (refresh → 500, `invalid_subject_token`, Admin API 401; strikes are time-gated to one per 30-minute window, so one sweep's burst across many companies counts once), deleting its session rows so a later `shop/redact` needs no refresh; a single successful Admin call resets the count; network errors, Shopify 5xx, throttling and GraphQL errors never count, and a merchant who opens the app is reactivated as before. Then `### Changed` with one bullet: `@shopify/shopify-api` is now a declared dependency (13.1.0, exact) — it was already installed transitively.

    3. `.claude/CLAUDE.md` — scoped `Edit`s only, exactly these SIX and nothing else (find each by searching for the anchor text named in `<read_first>`, never by line number): (a) module map: add two rows, each slotted where its line count falls in the table's descending order — `webhook-validate.server.ts` (`validateWebhookRequest` — the library authenticator's 405/401/400 contract with NO session load; used by the compliance and uninstalled routes; WINDOWS #31) and `token-health.server.ts` (WINDOWS #30 strike counter in SyncCursor `token-failures`, time-gated to one strike per 30-minute window so one sweep's burst counts once; three strikes across separate sweep cycles deactivate the shop and delete its sessions; any successful GraphQL call resets it, one DELETE per shop per process; the hooks live in the admin seam); (b) routes: in the bullet naming `webhooks.compliance.tsx` and at the `webhooks.app.uninstalled.tsx` mention, note that both now verify through `validateWebhookRequest` and no longer use `authenticate.webhook` (no session load); (c) the "**Redaction contract:**" paragraph: append "`EnforcementEvent` was the one that slipped (#32, fixed in 1.0.1)."; (d) Traps: add ONE bullet — `authenticate.webhook` refreshes an expired offline token BEFORE the handler runs; for a store that vanished without `app/uninstalled` the refresh fails forever and every `shop/redact` 500s (#31) — session-free routes must use `validateWebhookRequest`; (e) tests section: "28 files." → "29 files." and the `npm test          # 838 tests, 28 files` fence line → the totals printed by the full run in step 5; (f) ledger counts: search for `entries, 11 open (#11, #18, #19, #24, #25, #26, #27, #28, #30, #31, #32), 1 waived (#4).` (the continuation of a line that wraps after "32") and replace with `entries, 8 open (#11, #18, #19, #24, #25, #26, #27, #28), 1 waived (#4).` so the two lines read `32 entries, 8 open (#11, #18, #19, #24, #25, #26, #27, #28), 1 waived (#4).`. NOT touched: the Status line, the existing `shop-lifecycle`/`admin-client` rows, the claim-release paragraph, any `app/shopify.server.ts` mention — CHANGELOG carries the release story; the guide only gains what a future reader needs to find the new code.

    4. WINDOWS ledger: for each of 31, 32, 30 — `Edit` the entry's `"reason": ""` in the JSON block of `.planning/WINDOWS.md` to a closure note naming the fix commit(s) (short SHAs from `git log`), the regression test names, and the post-deploy verification still owed (for #31: the next `shop/redact` for a dead store shows 200 in the Dev Dashboard webhook log; for #30: the `Deactivated … (WINDOWS #30)` log line appears for the five dead reviewer stores within three hourly sweep cycles (≈2–3 h) of deploy — one strike per cycle, never three from one sweep — and demo-2 reactivates when the developer opens the app; for #32: `scripts/prod-enforcement-events.sh` shows 0 rows for a redacted shop). THEN run `node "$HOME/.claude/gsd-core/bin/gsd-tools.cjs" windows fixed 31`, `… fixed 32`, `… fixed 30` (the tool rewrites the file from the JSON block, carrying the reason into the table). Verify `node … windows status --pick ledger.open_count` prints 8.

    5. Gates, in this order, all from the repo root with `export PATH="$HOME/.npm-global/bin:$PATH"`: guard the database (`case "${TEST_DATABASE_URL:-creditguard_test}" in *creditguard_test*) ;; *) echo "refusing: TEST_DATABASE_URL must point at creditguard_test"; exit 1;; esac`); `npm test` (record the totals for CLAUDE.md step 3f; WINDOWS #25/#26 flakes: rerun the single file in isolation once, do not modify them); `npm run graphql-codegen` then `npm run typecheck` (codegen must actually run — a silent offline no-op makes typecheck meaningless; check it printed generated-file output); `npm run lint`; `npm run build` (the ONLY gate that catches a `.server` module imported into client code — `webhook-validate.server.ts` and `token-health.server.ts` are server-only and imported only by routes' server code and the seam). Pins: `grep -c 'api_version = "2026-07"' shopify.app.toml extensions/credit-guard-validation/shopify.extension.toml` → 1 each, and `git status --porcelain shopify.app.toml extensions/ prisma/schema.prisma app/services/ledger.server.ts listing/ marketing/` → empty (nothing in the do-not-touch list changed across the whole task set; `git diff --stat ba3a180 HEAD -- shopify.app.toml extensions/ prisma/ app/services/ledger.server.ts listing/` must also be empty — ba3a180 (`docs(guide): ledger counts 32/11 open`) is the pre-hotfix HEAD).

    6. Commits: `docs(ledger): close WINDOWS #30 #31 #32 — fixed in v1.0.1 (8 open)` — file .planning/WINDOWS.md; then the final `release: v1.0.1` — files package.json, package-lock.json, CHANGELOG.md, .claude/CLAUDE.md. Body of the release commit: the three WINDOWS ids and the four gate results. No tag, no push, no deploy.
  </action>
  <verify>
    <automated>export PATH="$HOME/.npm-global/bin:$PATH" && cd "/Users/hesamabbaszadi/Documents/Projects/Credit Guard" && test "$(grep -c '"version": "1.0.1"' package-lock.json)" = "2" && grep -q '"version": "1.0.1"' package.json && grep -q '^## 1.0.1 — 2026-09-10' CHANGELOG.md && test "$(node "$HOME/.claude/gsd-core/bin/gsd-tools.cjs" windows status --pick ledger.open_count)" = "8" && test "$(grep -c 'api_version = "2026-07"' shopify.app.toml)" = "1" && test "$(grep -c 'api_version = "2026-07"' extensions/credit-guard-validation/shopify.extension.toml)" = "1" && git diff --quiet ba3a180 HEAD -- shopify.app.toml extensions/ prisma/ app/services/ledger.server.ts listing/ && git log -1 --format=%s | grep -qx 'release: v1.0.1' && test -z "$(git status --porcelain)" && npm run lint && npm run graphql-codegen && npm run typecheck && npm run build</automated>
  </verify>
  <done>package.json and both root lockfile fields read 1.0.1; CHANGELOG.md has the 1.0.1 entry in the existing format with the three Fixed bullets and the Changed bullet; .claude/CLAUDE.md reflects the new modules, the two session-free routes, the closed redaction gap, the real test counts, the 8-open ledger line and the new trap; WINDOWS #30/#31/#32 are `fixed` with reasons and open_count is 8; npm test, graphql-codegen+typecheck, lint and build are all green; both api_version pins are byte-identical; nothing in shopify.app.toml, extensions/, prisma/, ledger.server.ts, listing/ or marketing/ changed; HEAD is `release: v1.0.1` on main with a clean tree and nothing pushed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Shopify → `/webhooks/compliance`, `/webhooks/app/uninstalled` | Unauthenticated POSTs; the HMAC over the raw body is the only proof of origin. A forged `shop/redact` is a data-destruction primitive. |
| Shopify token endpoint / Admin API → admin seam | Error responses now DRIVE a state change (deactivation). Misclassification is the risk. |
| Test process → shopify.server | `vi.mock` replaces only `unauthenticated.admin` / `authenticate.admin`; HMAC verification is never mocked. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-Q31-01 | Spoofing | validateWebhookRequest (both routes) | critical | mitigate | Library `validateHmacFromRequestFactory` (timing-safe) via the validation-only instance; 401 thrown before any statement with a side effect; forged-HMAC tests for shop/redact and customers/data_request stay in the suite; the secret is the same `SHOPIFY_API_SECRET` the main instance uses so the two cannot diverge (T-01-10). |
| T-Q31-02 | Denial of service | validateWebhookRequest | medium | mitigate | Valid HMAC but missing required header → 400 with no side effect; non-POST → 405; body read exactly once (`request.text()`) before validation, never `request.json()`; contract tests in Task 2. |
| T-Q31-03 | Information disclosure | second `shopifyApi` instance | low | mitigate | `logger.level = Warning`, `_logDisabledFutureFlags: false`; the instance is not exported (only `validateWebhook`), so nothing else can reach its config; no secret is logged. |
| T-Q31-04 | Tampering | webhooks.app.uninstalled (unconditional session delete) | low | accept | The delete is keyed on the HMAC-verified shop domain from the validator, not on an unverified header; a redelivery is a no-op deleteMany. |
| T-Q30-05 | Denial of service (self-inflicted) | token-health at the seam | high | mitigate | Closed classifier — only Response 500 from construction, HttpResponseError 400 `invalid_subject_token`, HttpResponseError 401; explicit never-list tested (network error, 5xx, other 4xx, SessionNotFoundError, request-time Response); strikes time-gated to one per TOKEN_FAILURE_WINDOW_MS (30 min, anchor fixed at strike time) so one sweep's burst over N companies (`graphqlJson` constructs a client per call) is ONE strike and deactivation needs three separate sweep cycles with no successful GraphQL call in between; reset on any success; deactivation is reversible by `ensureShopActive` on the merchant's next authenticated load (D-06) and retains every non-session row. |
| T-Q30-06 | Tampering | class (1) absorbs refresh-time network blips (library collapses them into Response 500) | low | accept | Documented in token-health.server.ts; bounded by the time-gated 3-strike rule and reset-on-success: a burst of refresh failures inside one 30-minute window — e.g. one hourly sweep constructing a client per company through `graphqlJson` during a transient token-endpoint hiccup — is ONE strike, so a live merchant is deactivated only after refresh failures in three separate sweep cycles (≥ ~2 h at the hourly cadence, ≥ ~1 h for a shop the 5-minute heal sweep touches) with zero successful calls in between, and one app open restores them. |
| T-Q30-07 | Repudiation | deactivation decision | medium | mitigate | One structured console.log line per deactivation (shop, count, last reason, WINDOWS #30); the SyncCursor record carries the strike anchor `lastAt` and the most recent `lastReason` until the third strike; the original error still reaches Sentry via `forEachActiveShop`. |
| T-Q30-08 | Elevation of privilege | token-health bookkeeping inside the seam | medium | mitigate | Bookkeeping runs in its own try/catch and never replaces the thrown error; `getAdminContext`'s export surface is unchanged so every `vi.mock` factory keeps isolating the seam; source guard test proves the seam is the only constructor of `unauthenticated.admin`. |
| T-Q-SC | Tampering | npm install `@shopify/shopify-api@13.1.0` | high | mitigate | [VERIFIED] Official `@shopify` scope; already present in package-lock.json at 13.1.0 with its integrity hash as a dependency of `@shopify/shopify-app-react-router@1.2.1` (`^13.1.0`); the install adds no bytes to node_modules — Task 1 asserts zero new `integrity` lines in the lockfile diff and the installed version is unchanged. No `[ASSUMED]`/`[SUS]` package is introduced, so no legitimacy checkpoint is required. |
</threat_model>

<verification>
- `npm test` green (real Postgres `creditguard_test`, real HMAC), including the new suites: tests/webhooks.compliance.test.ts (+4), tests/shop-lifecycle.test.ts (+2, plus the #32 counter in every redact assertion), tests/admin-token-health.test.ts (+10).
- `npm run graphql-codegen && npm run typecheck`, `npm run lint`, `npm run build` green.
- Both `api_version = "2026-07"` pins unchanged; `shopify.app.toml`, `extensions/`, `prisma/schema.prisma`, `app/services/ledger.server.ts`, `listing/`, `marketing/` untouched across all commits.
- Commit sequence on main: `fix(webhooks)…` ×2, `fix(lifecycle)…`, `feat(scheduler)…`, `docs(ledger)…`, `release: v1.0.1`. Nothing pushed, nothing deployed.
- Post-deploy verification owed (recorded in the WINDOWS reasons, not performed here): Dev Dashboard shows 200 for the next dead-store `shop/redact`; `Deactivated … (WINDOWS #30)` lines for the five reviewer stores; `scripts/prod-lifecycle-state.sh` shows them inactive with no sessions.
</verification>

<success_criteria>
- A `shop/redact` or `app/uninstalled` delivery can no longer be blocked by the state of the stored offline token — neither route loads a session at all, and the regression seeds (expired + refreshToken) answer 200 hermetically.
- `redactShop` deletes every shop-keyed model including `EnforcementEvent`, and the two-sided redaction contract (deleteMany ↔ countsFor) is closed on both sides.
- The admin seam deactivates a shop on its third time-gated token-class strike (three separate 30-minute windows — three sweep cycles — never a burst inside one sweep) and on nothing else; a success resets the counter with one DELETE per shop per process; the CF-3 enumerator guard and the per-shop swallow-but-log behaviour are untouched.
- Version 1.0.1 is recorded in package.json, package-lock.json, CHANGELOG.md and the working guide; WINDOWS #30/#31/#32 are fixed (8 open); all gates green; HEAD is `release: v1.0.1`.
</success_criteria>

<output>
Create `.planning/quick/260910-nhm-hotfix-v1-0-1-compliance-uninstalled-web/260910-nhm-SUMMARY.md` when done — include the final test totals, the six commit SHAs, and the post-deploy verification checklist copied from the WINDOWS reasons.
</output>
