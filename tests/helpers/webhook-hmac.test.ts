import { describe, expect, it } from "vitest";

import {
  forgedWebhookRequest,
  signedWebhookRequest,
  webhookHmac,
} from "./webhook-hmac";

/**
 * Self-test for the signed-webhook helper. If the digest here ever drifts, every
 * FOUND-02 webhook test becomes meaningless (a broken signer would "prove" 401s
 * that the library was going to return anyway), so the vector is pinned.
 */
describe("webhook HMAC helper", () => {
  const VECTOR_SECRET = "hmac-vector-secret";
  const VECTOR_BODY = JSON.stringify({
    shop_domain: "vector-test.myshopify.com",
    shop_id: 1,
  });
  const VECTOR_DIGEST = "FluwCr89bj+Um30QFdCM/3HGk/lRFZOkT4RrzEh2GHg=";

  it("computes the known base64 HMAC-SHA256 vector", () => {
    expect(webhookHmac(VECTOR_BODY, VECTOR_SECRET)).toBe(VECTOR_DIGEST);
  });

  it("signs the exact raw body it sends", async () => {
    const request = signedWebhookRequest(
      "https://app.creditguard.test/webhooks/compliance",
      "shop/redact",
      "vector-test.myshopify.com",
      { shop_domain: "vector-test.myshopify.com", shop_id: 1 },
      VECTOR_SECRET,
    );

    expect(request.method).toBe("POST");
    expect(await request.text()).toBe(VECTOR_BODY);
    expect(request.headers.get("X-Shopify-Hmac-Sha256")).toBe(VECTOR_DIGEST);
  });

  it("sends every header a real Shopify delivery carries", () => {
    const request = signedWebhookRequest(
      "https://app.creditguard.test/webhooks/compliance",
      "customers/redact",
      "vector-test.myshopify.com",
      {},
      VECTOR_SECRET,
    );

    expect(request.headers.get("X-Shopify-Topic")).toBe("customers/redact");
    expect(request.headers.get("X-Shopify-Shop-Domain")).toBe(
      "vector-test.myshopify.com",
    );
    expect(request.headers.get("X-Shopify-API-Version")).toBe("2026-07");
    expect(request.headers.get("X-Shopify-Webhook-Id")).toBeTruthy();
    expect(request.headers.get("Content-Type")).toBe("application/json");
  });

  it("produces a digest that does not match the body for forged requests", () => {
    const payload = { shop_domain: "vector-test.myshopify.com" };
    const forged = forgedWebhookRequest(
      "https://app.creditguard.test/webhooks/compliance",
      "shop/redact",
      "vector-test.myshopify.com",
      payload,
    );

    expect(forged.headers.get("X-Shopify-Hmac-Sha256")).not.toBe(
      webhookHmac(JSON.stringify(payload), VECTOR_SECRET),
    );
  });

  it("isolates the suite to the creditguard_test database", () => {
    expect(process.env.DATABASE_URL).toContain("creditguard_test");
    expect(process.env.DATABASE_URL).not.toContain("creditguard_dev");
  });
});
