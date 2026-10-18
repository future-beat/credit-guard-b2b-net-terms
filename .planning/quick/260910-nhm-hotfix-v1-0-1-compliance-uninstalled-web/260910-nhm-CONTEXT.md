# 260910-nhm — verified facts that override the brief (orchestrator, 2026-09-10)

These were checked against node_modules AFTER the planner was dispatched. The
plan-checker and executor must treat them as locked.

## The app object does NOT expose `shopify.api`

`shopifyApp()` (node_modules/@shopify/shopify-app-react-router/dist/esm/server/shopify-app.mjs
lines ~62–90) returns `{ sessionStorage, addDocumentResponseHeaders,
registerWebhooks, authenticate: {...}, unauthenticated: {...}, login, ... }`.
The internal `api` (built by `deriveApi(appConfig)` → `shopifyApi({...appConfig,
hostName, hostScheme, ...})`) is held in closure `params` and is not returned.
So `shopify.api.webhooks.validate` cannot be used. The brief's suggestion is
withdrawn.

## The sanctioned replacement: a validation-only `shopifyApi` instance

- `@shopify/shopify-api` **13.1.0** is already installed transitively
  (package-lock `node_modules/@shopify/shopify-api`). Add it as a DIRECT
  dependency at exactly that version (`npm install @shopify/shopify-api@13.1.0
  --save-exact`, no other dependency changes; lockfile diff must be that one
  entry moving to `dependencies`). The react-router package only re-exports
  `ApiVersion, BillingInterval, BillingReplacementBehavior, DeliveryMethod,
  LogSeverity, Session` — not `shopifyApi` — so the direct import is required.
- In `app/shopify.server.ts`, construct ONE extra instance for HMAC validation
  only, mirroring `deriveApi`: `shopifyApi({ apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "", apiVersion:
  ApiVersion.July26, scopes: process.env.SCOPES?.split(","), hostName: new
  URL(process.env.SHOPIFY_APP_URL || "").host, hostScheme: "https",
  isEmbeddedApp: true, isCustomStoreApp: false, logger: { level: ... } })` — read
  deriveApi for the exact keys and keep the same env sources the main config
  uses so the secret can never diverge (tests set SHOPIFY_API_SECRET in
  vitest.config.ts). Export a single function, e.g.
  `export const validateWebhook = (args: { rawBody: string; rawRequest: Request }) => validationApi.webhooks.validate(args)`.
- `validate()` (node_modules/@shopify/shopify-api/dist/esm/lib/webhooks/validate.mjs)
  returns `{ valid: true, webhookType, topic: topicForStorage(header) /* SHOP_REDACT
  form */, domain, webhookId, apiVersion, ... }` or `{ valid: false, reason }`
  with `reason` from `WebhookValidationErrorReason` (InvalidHmac, MissingHmac,
  MissingHeaders, MissingBody, ...). Mirror authenticate.mjs: 405 for non-POST;
  `InvalidHmac` → throw `new Response(undefined, { status: 401, statusText:
  "Unauthorized" })`; any other invalid → 400. Body read exactly once via
  `await request.text()` before validation.
- The `shopify.server.ts` module is server-only and already imported by both
  routes; the public routes' import-graph guards (landing/privacy/support) are
  unaffected because those routes import nothing from it.

## Token-refresh path for #30 (confirmed)

`unauthenticated.admin(shop)` → `node_modules/.../server/unauthenticated/admin/factory.mjs`
line 9 → `ensureValidOfflineSession(params, shop)` → `ensureOfflineTokenIsNotExpired`
→ `refreshToken()` which throws `new Response(undefined, {status: 500})` on any
failure except `InvalidJwtError` / `HttpResponseError` 400 `invalid_subject_token`
(those are rethrown as-is). So at the admin seam, token-class failures are:
(1) a thrown `Response` with status 500 from the seam call itself (before any
GraphQL runs), (2) `HttpResponseError` with `response.code === 400` and
`response.body?.error === "invalid_subject_token"`, (3) `HttpResponseError` with
`response.code === 401`. Anything else is not token-class.
