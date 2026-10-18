import "@shopify/shopify-app-react-router/adapters/node";
import { LogSeverity, shopifyApi } from "@shopify/shopify-api";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

/**
 * A SECOND, validation-only Shopify API instance — HMAC verification and
 * nothing else (WINDOWS #31).
 *
 * Why it exists: `shopifyApp()` above returns only
 * `{ sessionStorage, addDocumentResponseHeaders, registerWebhooks,
 * authenticate, unauthenticated, login }`. The `api` object it builds
 * internally (via `deriveApi`) is held in a closure and is NOT exposed, so
 * `shopify.api.webhooks.validate` does not exist. The webhook routes that must
 * verify a signature WITHOUT loading a session — `/webhooks/compliance` and
 * `/webhooks/app/uninstalled` — therefore need their own instance.
 *
 * Why a session must not be loaded there: `authenticate.webhook` calls
 * `ensureValidOfflineSession` AFTER the HMAC check, which refreshes an expired
 * offline token before the handler runs. For a store that vanished without
 * sending `app/uninstalled`, that refresh fails forever and the library
 * collapses the failure into a bare `Response(500)` — so `shop/redact` 500s on
 * every retry and the store's data is never redacted (WINDOWS #31, observed on
 * reviewer store eztcd0-3u).
 *
 * The config mirrors `deriveApi` key-for-key and reads the SAME env vars as the
 * main config above, so the two secrets can never diverge (vitest.config.ts
 * pins SHOPIFY_API_SECRET to a committed dummy for tests). `logger.level` is
 * raised to Warning so constructing the second instance prints nothing.
 *
 * Only the bound `validateWebhook` function is exported — never the instance —
 * so no other module can reach its config or its credentials.
 */
const validationAppUrl = new URL(process.env.SHOPIFY_APP_URL || "");

const validationApi = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY ?? "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  hostName: validationAppUrl.host,
  hostScheme: validationAppUrl.protocol === "http:" ? "http" : "https",
  isEmbeddedApp: true,
  isCustomStoreApp: false,
  future: {},
  _logDisabledFutureFlags: false,
  logger: { level: LogSeverity.Warning },
});

/**
 * Verify a webhook's HMAC over the raw body. Reads no session, touches no
 * database. `app/services/webhook-validate.server.ts` is its only caller.
 */
export const validateWebhook = (args: {
  rawBody: string;
  rawRequest: Request;
}) => validationApi.webhooks.validate(args);

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
