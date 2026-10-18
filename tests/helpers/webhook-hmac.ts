import { createHmac } from "node:crypto";

/**
 * Signed-webhook test helper (Wave 0, 01-VALIDATION.md).
 *
 * Shopify signs the EXACT raw request body with the app's client secret and
 * sends the base64 HMAC-SHA256 in `X-Shopify-Hmac-Sha256`
 * (`@shopify/shopify-api` -> `validateHmacFromRequestFactory`, HashFormat.Base64).
 * The library also requires the topic, shop-domain, api-version and webhook-id
 * headers to be present, so real deliveries are reproduced header-for-header.
 *
 * The secret defaults to `SHOPIFY_API_SECRET`, which vitest.config.ts pins to a
 * committed dummy value — no real secret is ever read, logged, or signed with.
 */

/** Base64 HMAC-SHA256 of the raw body, exactly as Shopify computes it. */
export function webhookHmac(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

export interface SignedWebhookOptions {
  /** Replace the computed digest — used to build the invalid-HMAC case. */
  hmac?: string;
  /** Defaults to the project's pinned stable version. */
  apiVersion?: string;
  webhookId?: string;
}

/**
 * Build a Fetch Request indistinguishable (to the library) from a real Shopify
 * webhook delivery. Pass it straight into a route `action({ request })`.
 */
export function signedWebhookRequest(
  url: string,
  topic: string,
  shopDomain: string,
  payload: unknown,
  secret: string = process.env.SHOPIFY_API_SECRET ?? "",
  options: SignedWebhookOptions = {},
): Request {
  const rawBody =
    typeof payload === "string" ? payload : JSON.stringify(payload);

  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Topic": topic,
      "X-Shopify-Shop-Domain": shopDomain,
      "X-Shopify-API-Version": options.apiVersion ?? "2026-07",
      "X-Shopify-Webhook-Id": options.webhookId ?? "test-webhook-id",
      "X-Shopify-Hmac-Sha256": options.hmac ?? webhookHmac(rawBody, secret),
      "X-Shopify-Triggered-At": new Date().toISOString(),
    },
    body: rawBody,
  });
}

/**
 * Same shape as a real delivery, but the signature is garbage — the case app
 * review requires to answer 401 (FOUND-02, threat T-01-10).
 */
export function forgedWebhookRequest(
  url: string,
  topic: string,
  shopDomain: string,
  payload: unknown,
): Request {
  return signedWebhookRequest(url, topic, shopDomain, payload, "", {
    hmac: "bm90LWEtdmFsaWQtaG1hYy1hdC1hbGw=",
  });
}
