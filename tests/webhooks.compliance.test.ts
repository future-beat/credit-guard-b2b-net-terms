import { afterAll, beforeEach, describe, expect, it } from "vitest";

import prisma from "../app/db.server";
import { expiredRefreshableSession } from "./helpers/offline-session";
import { forgedWebhookRequest, signedWebhookRequest } from "./helpers/webhook-hmac";

/**
 * FOUND-02 — the three mandatory GDPR webhooks.
 *
 * HMAC verification is real here and is never mocked: the 401-on-bad-HMAC
 * behaviour app review checks for belongs to the library, and a mocked
 * validator would prove nothing. `validateWebhook` in shopify.server.ts (the
 * validation-only API instance the route reaches through
 * `validateWebhookRequest`) is the library's own validator. These requests are
 * signed exactly as Shopify signs them.
 *
 * Nothing in this suite touches a session object — at `shop/redact` time the app
 * was uninstalled 48 hours earlier and no session exists (research Pitfall 3).
 */
const SHOP = "compliance-test.myshopify.com";
const OTHER_SHOP = "compliance-bystander.myshopify.com";
const ENDPOINT = "https://app.creditguard.test/webhooks/compliance";

async function complianceAction(request: Request) {
  const { action } = await import("../app/routes/webhooks.compliance");
  return action({ request, params: {}, context: {} } as never);
}

/** Returns the thrown Response for rejected requests instead of throwing. */
async function complianceResponse(request: Request): Promise<Response> {
  try {
    return await complianceAction(request);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

function compliancePayload(shop: string) {
  return { shop_id: 99, shop_domain: shop };
}

async function wipe(...domains: string[]) {
  await prisma.session.deleteMany({ where: { shop: { in: domains } } });
  await prisma.complianceRequest.deleteMany({ where: { shop: { in: domains } } });
  await prisma.shop.deleteMany({ where: { domain: { in: domains } } });
}

async function countsFor(domain: string) {
  return {
    shops: await prisma.shop.count({ where: { domain } }),
    complianceRequests: await prisma.complianceRequest.count({
      where: { shop: domain },
    }),
  };
}

beforeEach(async () => {
  await wipe(SHOP, OTHER_SHOP);
});

afterAll(async () => {
  await wipe(SHOP, OTHER_SHOP);
  await prisma.$disconnect();
});

describe("invalid HMAC (threat T-01-10)", () => {
  it("answers 401 and performs no side effect", async () => {
    const response = await complianceResponse(
      forgedWebhookRequest(
        ENDPOINT,
        "shop/redact",
        SHOP,
        compliancePayload(SHOP),
      ),
    );

    expect(response.status).toBe(401);
  });

  it("does not let a forged shop/redact delete anything", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: false } });
    await prisma.complianceRequest.create({
      data: { shop: SHOP, topic: "CUSTOMERS_REDACT" },
    });

    const response = await complianceResponse(
      forgedWebhookRequest(
        ENDPOINT,
        "shop/redact",
        SHOP,
        compliancePayload(SHOP),
      ),
    );

    expect(response.status).toBe(401);
    // The library rejects before handler code runs — nothing was deleted.
    expect(await countsFor(SHOP)).toEqual({ shops: 1, complianceRequests: 1 });
  });

  it("does not let a forged customers/data_request write a receipt", async () => {
    const response = await complianceResponse(
      forgedWebhookRequest(
        ENDPOINT,
        "customers/data_request",
        SHOP,
        compliancePayload(SHOP),
      ),
    );

    expect(response.status).toBe(401);
    expect((await countsFor(SHOP)).complianceRequests).toBe(0);
  });
});

describe("customers/data_request", () => {
  it("returns 200 and records a receipt", async () => {
    const response = await complianceResponse(
      signedWebhookRequest(
        ENDPOINT,
        "customers/data_request",
        SHOP,
        compliancePayload(SHOP),
      ),
    );

    expect(response.status).toBe(200);

    const rows = await prisma.complianceRequest.findMany({
      where: { shop: SHOP },
    });
    expect(rows).toHaveLength(1);
    // Confirmed library normalisation: topic header -> UPPER_SNAKE (A1).
    expect(rows[0].topic).toBe("CUSTOMERS_DATA_REQUEST");
  });
});

describe("customers/redact", () => {
  it("returns 200 and records a receipt", async () => {
    const response = await complianceResponse(
      signedWebhookRequest(
        ENDPOINT,
        "customers/redact",
        SHOP,
        compliancePayload(SHOP),
      ),
    );

    expect(response.status).toBe(200);

    const rows = await prisma.complianceRequest.findMany({
      where: { shop: SHOP },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].topic).toBe("CUSTOMERS_REDACT");
  });
});

describe("shop/redact (threat T-01-14)", () => {
  it("hard-deletes every row for the shop", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: false } });
    await prisma.complianceRequest.createMany({
      data: [
        { shop: SHOP, topic: "CUSTOMERS_DATA_REQUEST" },
        { shop: SHOP, topic: "CUSTOMERS_REDACT" },
      ],
    });
    await prisma.session.create({
      data: {
        id: `offline_${SHOP}`,
        shop: SHOP,
        state: "",
        isOnline: false,
        accessToken: "stale-token",
      },
    });

    const response = await complianceResponse(
      signedWebhookRequest(
        ENDPOINT,
        "shop/redact",
        SHOP,
        compliancePayload(SHOP),
      ),
    );

    expect(response.status).toBe(200);
    expect(await countsFor(SHOP)).toEqual({ shops: 0, complianceRequests: 0 });
    expect(await prisma.session.count({ where: { shop: SHOP } })).toBe(0);
  });

  it("answers 200 and redacts when the stored offline token is expired but refreshable (WINDOWS #31)", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    await prisma.complianceRequest.create({
      data: { shop: SHOP, topic: "CUSTOMERS_REDACT" },
    });
    await prisma.session.create({ data: expiredRefreshableSession(SHOP) });

    const response = await complianceResponse(
      signedWebhookRequest(
        ENDPOINT,
        "shop/redact",
        SHOP,
        compliancePayload(SHOP),
      ),
    );

    expect(response.status).toBe(200);
    expect(await countsFor(SHOP)).toEqual({ shops: 0, complianceRequests: 0 });
    expect(await prisma.session.count({ where: { shop: SHOP } })).toBe(0);
  });

  it("returns 200 on redelivery for an already-redacted shop", async () => {
    const request = () =>
      signedWebhookRequest(
        ENDPOINT,
        "shop/redact",
        SHOP,
        compliancePayload(SHOP),
      );

    expect((await complianceResponse(request())).status).toBe(200);
    expect((await complianceResponse(request())).status).toBe(200);

    expect(await countsFor(SHOP)).toEqual({ shops: 0, complianceRequests: 0 });
  });

  it("leaves other shops untouched", async () => {
    await prisma.shop.create({ data: { domain: OTHER_SHOP } });
    await prisma.complianceRequest.create({
      data: { shop: OTHER_SHOP, topic: "CUSTOMERS_REDACT" },
    });

    await complianceResponse(
      signedWebhookRequest(
        ENDPOINT,
        "shop/redact",
        SHOP,
        compliancePayload(SHOP),
      ),
    );

    expect(await countsFor(OTHER_SHOP)).toEqual({
      shops: 1,
      complianceRequests: 1,
    });
  });
});

describe("request contract (mirrors the library authenticator)", () => {
  it("answers 405 to a non-POST request", async () => {
    const response = await complianceResponse(
      new Request(ENDPOINT, { method: "GET" }),
    );

    expect(response.status).toBe(405);
  });

  it("answers 400 when the HMAC is valid but a required header is missing", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: false } });

    const signed = signedWebhookRequest(
      ENDPOINT,
      "shop/redact",
      SHOP,
      compliancePayload(SHOP),
    );
    const headers = new Headers(signed.headers);
    headers.delete("X-Shopify-Webhook-Id");
    // Same body, so the signature is still valid — only a header is absent.
    const request = new Request(ENDPOINT, {
      method: "POST",
      headers,
      body: await signed.text(),
    });

    const response = await complianceResponse(request);

    expect(response.status).toBe(400);
    expect((await countsFor(SHOP)).shops).toBe(1);
  });

  it("both webhook routes verify through validateWebhookRequest, never the session-loading authenticator (WINDOWS #31)", async () => {
    const { sourceWithoutComments } = await import("./helpers/module-source");

    for (const path of [
      "app/routes/webhooks.compliance.tsx",
      "app/routes/webhooks.app.uninstalled.tsx",
    ]) {
      const code = sourceWithoutComments(path);

      expect(code.length).toBeGreaterThan(200);
      expect(code).toContain("validateWebhookRequest");
      expect(code).not.toMatch(/\bauthenticate\b/);
    }
  });
});

describe("route and subscription wiring", () => {
  it("never dereferences a session — none exists 48h post-uninstall", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../app/routes/webhooks.compliance.tsx", import.meta.url),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

    expect(code).not.toMatch(/\bsession\b/);
  });

  it("declares all three compliance topics on /webhooks/compliance", async () => {
    const { readFile } = await import("node:fs/promises");
    const toml = await readFile(
      new URL("../shopify.app.toml", import.meta.url),
      "utf8",
    );

    expect(toml).toContain("compliance_topics");
    expect(toml).toContain('"customers/data_request"');
    expect(toml).toContain('"customers/redact"');
    expect(toml).toContain('"shop/redact"');
    expect(toml).toContain('uri = "/webhooks/compliance"');
    // Version pin must not drift to the 2026-10 release candidate.
    expect(toml).toContain('api_version = "2026-07"');
  });
});
