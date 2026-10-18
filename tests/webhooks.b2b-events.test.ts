import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import { createMockAdmin, type MockAdminClient } from "./helpers/admin-client-mock";
import {
  FIXTURE_COMPANY_GID,
  FIXTURE_COMPANY_NAME,
  FIXTURE_DUE_AT,
  FIXTURE_ORDER_GID,
  makeCompanyOrdersResponse,
  makeOrderForLedgerResponse,
} from "./fixtures/order-fixtures";
import { forgedWebhookRequest, signedWebhookRequest } from "./helpers/webhook-hmac";

/**
 * LEDG-02 — the B2B event surface: payment-terms edits and company lifecycle.
 *
 * Same discipline as tests/webhooks.orders.test.ts: `authenticate.webhook` is NOT
 * mocked, so every delivery below goes through real HMAC verification and a real
 * route into real Postgres rows. The ONLY seam replaced is
 * `admin-client.server.ts`, which stands in for the Shopify Admin API.
 */
const getAdminContext = vi.hoisted(() => vi.fn());

vi.mock("../app/services/admin-client.server", () => ({ getAdminContext }));

const SHOP = "b2b-events-test.myshopify.com";
const OTHER_SHOP = "b2b-events-bystander.myshopify.com";
const ORDERS_ENDPOINT = "https://app.creditguard.test/webhooks/orders";
const TERMS_ENDPOINT = "https://app.creditguard.test/webhooks/payment-terms";
const COMPANIES_ENDPOINT = "https://app.creditguard.test/webhooks/companies";

/** A due date one month later than the fixture default — the "merchant edit". */
const MOVED_DUE_AT = "2026-09-30T00:00:00.000Z";

let admin: MockAdminClient;

async function runAction(
  modulePath: "orders" | "payment-terms" | "companies",
  request: Request,
): Promise<Response> {
  const loaders = {
    orders: () => import("../app/routes/webhooks.orders"),
    "payment-terms": () => import("../app/routes/webhooks.payment-terms"),
    companies: () => import("../app/routes/webhooks.companies"),
  };
  const { action } = await loaders[modulePath]();
  try {
    return await action({ request, params: {}, context: {} } as never);
  } catch (thrown) {
    // A rejected HMAC is thrown as a Response by the library.
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

function signed(
  endpoint: string,
  topic: string,
  payload: Record<string, unknown>,
  webhookId: string,
  shop = SHOP,
) {
  return signedWebhookRequest(endpoint, topic, shop, payload, undefined, {
    webhookId,
  });
}

/**
 * Seeds one ATTRIBUTED NET-30 $500 order for FIXTURE_COMPANY_GID through the
 * real route: the payload's company hint sends ladder rung 2 over the mocked
 * CompanyOrdersForLedger edge, exactly as a real B2B orders/create would.
 */
async function seedOrder(webhookId = "b2b-seed") {
  return runAction(
    "orders",
    signed(
      ORDERS_ENDPOINT,
      "orders/create",
      {
        id: 5001,
        admin_graphql_api_id: FIXTURE_ORDER_GID,
        company: { id: 1001, location_id: 2001 },
      },
      webhookId,
    ),
  );
}

async function wipe(...domains: string[]) {
  await prisma.ledgerSchedule.deleteMany({ where: { shop: { in: domains } } });
  await prisma.ledgerOrder.deleteMany({ where: { shop: { in: domains } } });
  await prisma.company.deleteMany({ where: { shop: { in: domains } } });
  await prisma.webhookReceipt.deleteMany({ where: { shop: { in: domains } } });
  await prisma.syncCursor.deleteMany({ where: { shop: { in: domains } } });
  await prisma.session.deleteMany({ where: { shop: { in: domains } } });
  await prisma.shop.deleteMany({ where: { domain: { in: domains } } });
}

async function countsFor(domain: string) {
  return {
    companies: await prisma.company.count({ where: { shop: domain } }),
    orders: await prisma.ledgerOrder.count({ where: { shop: domain } }),
    schedules: await prisma.ledgerSchedule.count({ where: { shop: domain } }),
    receipts: await prisma.webhookReceipt.count({ where: { shop: domain } }),
    cursors: await prisma.syncCursor.count({ where: { shop: domain } }),
  };
}

function companyRow(shop = SHOP, companyGid = FIXTURE_COMPANY_GID) {
  return prisma.company.findUnique({
    where: { shop_companyGid: { shop, companyGid } },
  });
}

beforeEach(async () => {
  await wipe(SHOP, OTHER_SHOP);
  admin = createMockAdmin({
    OrderForLedger: makeOrderForLedgerResponse(),
    // The default company page lists the default order — seedOrder attributes
    // over this edge (ladder rung 2).
    CompanyOrdersForLedger: makeCompanyOrdersResponse(),
  });
  getAdminContext.mockReset();
  getAdminContext.mockResolvedValue(admin);
});

afterAll(async () => {
  await wipe(SHOP, OTHER_SHOP);
  await prisma.$disconnect();
});

describe("payment_terms/update — a due-date edit converges the ledger (the tracer)", () => {
  it("moves the schedule dueAt and Company.earliestDueAt to the refetched value", async () => {
    await seedOrder();

    // Baseline: the ledger believes the original NET-30 date.
    const before = await companyRow();
    expect(before!.earliestDueAt?.toISOString()).toBe(FIXTURE_DUE_AT);

    // The merchant edits the due date in the admin. The payload says nothing
    // about dates — the refetch is where the new truth comes from.
    admin.setFixture(
      "OrderForLedger",
      makeOrderForLedgerResponse({ dueAt: MOVED_DUE_AT }),
    );

    const response = await runAction(
      "payment-terms",
      signed(
        TERMS_ENDPOINT,
        "payment_terms/update",
        {
          id: 3001,
          admin_graphql_api_id: "gid://shopify/PaymentTerms/3001",
          payment_terms_name: "Net 60",
          order_id: 5001,
        },
        "terms-update-1",
      ),
    );

    expect(response.status).toBe(200);
    // The route resolved the ORDER, not the PaymentTerms id. (The seed itself
    // attributed over the company edge, so this is the first OrderForLedger.)
    expect(admin.callsFor("OrderForLedger")[0].variables).toEqual({
      id: FIXTURE_ORDER_GID,
    });

    const order = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: FIXTURE_ORDER_GID } },
      include: { schedules: true },
    });
    expect(order!.schedules).toHaveLength(1);
    expect(order!.schedules[0].dueAt?.toISOString()).toBe(MOVED_DUE_AT);

    const after = await companyRow();
    expect(after!.earliestDueAt?.toISOString()).toBe(MOVED_DUE_AT);
    // Moving a date does not move money.
    expect(after!.exposure.toFixed(4)).toBe("500.0000");
  });

  it("never treats the PaymentTerms id as an order id", async () => {
    // No order reference anywhere: `id` and `admin_graphql_api_id` both belong to
    // the PaymentTerms object. Refetching gid://shopify/Order/3001 would hit an
    // unrelated order, so the route must resolve nothing and defer.
    const response = await runAction(
      "payment-terms",
      signed(
        TERMS_ENDPOINT,
        "payment_terms/update",
        {
          id: 3001,
          admin_graphql_api_id: "gid://shopify/PaymentTerms/3001",
          payment_terms_name: "Net 60",
        },
        "terms-no-order",
      ),
    );

    expect(response.status).toBe(200);
    expect(admin.callCount("OrderForLedger")).toBe(0);
    expect(await prisma.ledgerOrder.count({ where: { shop: SHOP } })).toBe(0);
  });

  it("accepts payment_terms/create, /delete and payment_schedules/due through the same path", async () => {
    await seedOrder();
    admin.setFixture(
      "OrderForLedger",
      makeOrderForLedgerResponse({ dueAt: MOVED_DUE_AT }),
    );

    const deliveries: [string, Record<string, unknown>][] = [
      ["payment_terms/create", { id: 3001, order_id: 5001 }],
      ["payment_terms/delete", { id: 3001, order: { id: 5001 } }],
      [
        "payment_schedules/due",
        { id: 9001, payment_schedule: { id: 9001, order_id: 5001 } },
      ],
    ];

    for (const [index, [topic, payload]] of deliveries.entries()) {
      const response = await runAction(
        "payment-terms",
        signed(TERMS_ENDPOINT, topic, payload, `terms-multi-${index}`),
      );
      expect(response.status).toBe(200);
    }

    // Three deliveries, every one resolving the same order gid (the seed
    // attributed over the company edge and made no single-order refetch).
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(1);
    expect(admin.callCount("OrderForLedger")).toBe(3);
    for (const call of admin.callsFor("OrderForLedger")) {
      expect(call.variables).toEqual({ id: FIXTURE_ORDER_GID });
    }
  });

  it("persists an UNKNOWN order from a payment-terms doorbell as UNRESOLVED awaiting reconciliation", async () => {
    // No seed: the terms doorbell references an order the ledger has never
    // seen. The route (unchanged in 02-06) refetches and persists it — but
    // with no attribution evidence the row starts UNRESOLVED and contributes
    // nothing to any company's exposure until the daily sweep attributes it.
    const response = await runAction(
      "payment-terms",
      signed(
        TERMS_ENDPOINT,
        "payment_terms/update",
        { id: 3001, order_id: 5001 },
        "terms-unknown-order",
      ),
    );

    expect(response.status).toBe(200);
    expect(admin.callCount("OrderForLedger")).toBe(1);

    const order = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: FIXTURE_ORDER_GID } },
    });
    expect(order).not.toBeNull();
    expect(order!.attributionStatus).toBe("UNRESOLVED");
    expect(order!.companyId).toBeNull();
    // Zero contribution: no company row exists, so nothing gained exposure.
    expect(await prisma.company.count({ where: { shop: SHOP } })).toBe(0);
  });

  it("acks an unsubscribed topic without touching the ledger", async () => {
    const response = await runAction(
      "payment-terms",
      signed(
        TERMS_ENDPOINT,
        "payment_terms/unknown",
        { id: 3001, order_id: 5001 },
        "terms-unhandled",
      ),
    );

    expect(response.status).toBe(200);
    expect(admin.callCount()).toBe(0);
    expect(await prisma.ledgerOrder.count({ where: { shop: SHOP } })).toBe(0);
  });

  it("releases its claim on a transient failure so the redelivery still lands", async () => {
    // Identical hazard to the orders route: claim-then-work means a failed
    // delivery would leave a receipt that dedupes Shopify's own redelivery away,
    // losing a due-date change until the daily reconciliation.
    getAdminContext.mockRejectedValueOnce(new Error("Admin API unavailable"));

    await expect(
      runAction(
        "payment-terms",
        signed(
          TERMS_ENDPOINT,
          "payment_terms/update",
          { id: 3001, order_id: 5001 },
          "terms-transient",
        ),
      ),
    ).rejects.toThrow("Admin API unavailable");

    expect(
      await prisma.webhookReceipt.count({ where: { id: "terms-transient" } }),
    ).toBe(0);

    const retry = await runAction(
      "payment-terms",
      signed(
        TERMS_ENDPOINT,
        "payment_terms/update",
        { id: 3001, order_id: 5001 },
        "terms-transient",
      ),
    );

    expect(retry.status).toBe(200);
    expect(admin.callCount("OrderForLedger")).toBe(1);
    expect(
      (await prisma.webhookReceipt.findUnique({ where: { id: "terms-transient" } }))!
        .processedAt,
    ).toBeInstanceOf(Date);
  });
});

describe("companies/* lifecycle", () => {
  const COMPANY_PAYLOAD = {
    id: 1001,
    admin_graphql_api_id: FIXTURE_COMPANY_GID,
    name: FIXTURE_COMPANY_NAME,
  };

  it("creates a company head row before it has any orders", async () => {
    const response = await runAction(
      "companies",
      signed(COMPANIES_ENDPOINT, "companies/create", COMPANY_PAYLOAD, "co-1"),
    );

    expect(response.status).toBe(200);
    // Company lifecycle needs no Admin API call — there is no money to refetch.
    expect(admin.callCount()).toBe(0);

    const company = await companyRow();
    expect(company).not.toBeNull();
    expect(company!.name).toBe(FIXTURE_COMPANY_NAME);
    // Exposure fields stay at their defaults — recomputeCompany is their only
    // writer (ledger.server.ts rule 3).
    expect(company!.exposure.toFixed(4)).toBe("0.0000");
    expect(company!.recomputedAt).toBeNull();
  });

  it("refreshes the name on update without disturbing exposure", async () => {
    await seedOrder();
    expect((await companyRow())!.exposure.toFixed(4)).toBe("500.0000");

    const response = await runAction(
      "companies",
      signed(
        COMPANIES_ENDPOINT,
        "companies/update",
        { ...COMPANY_PAYLOAD, name: "Acme Industrial Supply (Renamed)" },
        "co-2",
      ),
    );

    expect(response.status).toBe(200);
    const company = await companyRow();
    expect(company!.name).toBe("Acme Industrial Supply (Renamed)");
    expect(company!.exposure.toFixed(4)).toBe("500.0000");
  });

  it("keeps the stored name when an update carries none (03-05 live defect)", async () => {
    await runAction(
      "companies",
      signed(COMPANIES_ENDPOINT, "companies/create", COMPANY_PAYLOAD, "co-2a"),
    );
    expect((await companyRow())!.name).toBe(FIXTURE_COMPANY_NAME);

    // This is the delivery Shopify actually sends ~1.5s after THIS APP writes a
    // company's credit_v1 metafield: a real companies/update with no `name`.
    // Falling back to the gid here renamed the merchant's own company on every
    // credit publish (measured on credit-guard-demo, 2026-08-19T17:43:34Z).
    const response = await runAction(
      "companies",
      signed(
        COMPANIES_ENDPOINT,
        "companies/update",
        { id: 1001, admin_graphql_api_id: FIXTURE_COMPANY_GID },
        "co-2b",
      ),
    );

    expect(response.status).toBe(200);
    const company = await companyRow();
    expect(company!.name).toBe(FIXTURE_COMPANY_NAME);
    expect(company!.name).not.toBe(FIXTURE_COMPANY_GID);
  });

  it("still names a NEWLY created company after its gid when the payload has none", async () => {
    // The fallback is create-only: the column is non-null, and a recognisable
    // gid beats inventing a friendly-looking string nobody typed.
    const response = await runAction(
      "companies",
      signed(
        COMPANIES_ENDPOINT,
        "companies/create",
        { id: 1001, admin_graphql_api_id: FIXTURE_COMPANY_GID },
        "co-2c",
      ),
    );

    expect(response.status).toBe(200);
    expect((await companyRow())!.name).toBe(FIXTURE_COMPANY_GID);
  });

  it("deletes the company while its orders survive with null linkage", async () => {
    await seedOrder();
    expect(await prisma.company.count({ where: { shop: SHOP } })).toBe(1);

    const response = await runAction(
      "companies",
      signed(COMPANIES_ENDPOINT, "companies/delete", COMPANY_PAYLOAD, "co-3"),
    );

    expect(response.status).toBe(200);
    expect(await prisma.company.count({ where: { shop: SHOP } })).toBe(0);

    // onDelete: SetNull — the order history is still true once the company row
    // is gone, and a null-keyed order counts toward nobody's exposure.
    const order = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: FIXTURE_ORDER_GID } },
      include: { schedules: true },
    });
    expect(order).not.toBeNull();
    expect(order!.companyId).toBeNull();
    expect(order!.schedules).toHaveLength(1);
  });

  it("builds the gid from a numeric id when admin_graphql_api_id is absent", async () => {
    await runAction(
      "companies",
      signed(
        COMPANIES_ENDPOINT,
        "companies/create",
        { id: 1001, name: FIXTURE_COMPANY_NAME },
        "co-4",
      ),
    );

    expect(await companyRow()).not.toBeNull();
  });

  it("never reaches into another shop's companies (threat T-02-11)", async () => {
    await runAction(
      "companies",
      signed(
        COMPANIES_ENDPOINT,
        "companies/create",
        COMPANY_PAYLOAD,
        "co-other",
        OTHER_SHOP,
      ),
    );
    expect(await prisma.company.count({ where: { shop: OTHER_SHOP } })).toBe(1);

    // Same company gid, different shop: the delete must not cross the boundary.
    await runAction(
      "companies",
      signed(COMPANIES_ENDPOINT, "companies/delete", COMPANY_PAYLOAD, "co-5"),
    );

    expect(await prisma.company.count({ where: { shop: OTHER_SHOP } })).toBe(1);
    expect(await prisma.company.count({ where: { shop: SHOP } })).toBe(0);
  });
});

describe("forged HMAC on the new routes (threat T-02-07)", () => {
  const EMPTY = {
    companies: 0,
    orders: 0,
    schedules: 0,
    receipts: 0,
    cursors: 0,
  };

  it("answers 401 on /webhooks/payment-terms and writes nothing", async () => {
    const response = await runAction(
      "payment-terms",
      forgedWebhookRequest(TERMS_ENDPOINT, "payment_terms/update", SHOP, {
        id: 3001,
        order_id: 5001,
      }),
    );

    expect(response.status).toBe(401);
    expect(await countsFor(SHOP)).toEqual(EMPTY);
    // The library rejects before handler code runs — no refetch was attempted.
    expect(admin.callCount()).toBe(0);
  });

  it("answers 401 on /webhooks/companies and writes nothing", async () => {
    const response = await runAction(
      "companies",
      forgedWebhookRequest(COMPANIES_ENDPOINT, "companies/create", SHOP, {
        id: 1001,
        name: "Forged Co",
      }),
    );

    expect(response.status).toBe(401);
    expect(await countsFor(SHOP)).toEqual(EMPTY);
  });

  it("cannot delete a real company with a forged delete", async () => {
    await seedOrder();

    const response = await runAction(
      "companies",
      forgedWebhookRequest(COMPANIES_ENDPOINT, "companies/delete", SHOP, {
        id: 1001,
        admin_graphql_api_id: FIXTURE_COMPANY_GID,
      }),
    );

    expect(response.status).toBe(401);
    const company = await companyRow();
    expect(company).not.toBeNull();
    expect(company!.exposure.toFixed(4)).toBe("500.0000");
  });
});

/**
 * The registration source guard (CF-1, CF-5).
 *
 * Every route above is dead code until `shopify.app.toml` subscribes its topics,
 * and the TOML is published to the live app registration on EVERY
 * `shopify app deploy` — so a wrong value here is a production change, not a
 * local one. These assertions read the file itself with comments stripped, so a
 * topic that only exists inside an explanatory comment cannot satisfy them.
 */
describe("shopify.app.toml registration (CF-1 scopes, CF-5 pin, 15 topics)", () => {
  const EXPECTED_SCOPES =
    "read_orders,read_all_orders,read_payment_terms,read_companies,write_companies,write_validations,write_orders";

  /** uri -> the topics that uri must carry. Fifteen topics, four Phase-2 routes. */
  const PHASE_2_SUBSCRIPTIONS: Record<string, string[]> = {
    "/webhooks/orders": [
      "orders/create",
      "orders/updated",
      "orders/paid",
      "orders/edited",
      "orders/cancelled",
      "orders/delete",
      "refunds/create",
    ],
    "/webhooks/payment-terms": [
      "payment_terms/create",
      "payment_terms/update",
      "payment_terms/delete",
      "payment_schedules/due",
    ],
    "/webhooks/companies": [
      "companies/create",
      "companies/update",
      "companies/delete",
    ],
    "/webhooks/bulk-operations": ["bulk_operations/finish"],
  };

  const TOML_URL = new URL("../shopify.app.toml", import.meta.url);

  /** The file with every comment line removed — config only, prose never. */
  async function activeToml(): Promise<string> {
    const raw = await readFile(TOML_URL, "utf8");
    return raw
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
  }

  /** Every [[webhooks.subscriptions]] block as { uri, topics, complianceTopics }. */
  async function subscriptions() {
    const blocks = (await activeToml()).split("[[webhooks.subscriptions]]").slice(1);
    return blocks.map((block) => {
      // Stop at the next top-level table so one block cannot absorb another.
      const body = block.split(/\n\[/)[0];
      const uri = /uri\s*=\s*"([^"]+)"/.exec(body)?.[1] ?? null;
      const list = (key: string) => {
        const raw = new RegExp(`${key}\\s*=\\s*\\[([^\\]]*)\\]`).exec(body)?.[1];
        return raw ? [...raw.matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
      };
      return { uri, topics: list("(?<!compliance_)topics"), complianceTopics: list("compliance_topics") };
    });
  }

  it("requests exactly the four CF-1 read scopes plus the three write scopes, once", async () => {
    const toml = await activeToml();

    expect(toml).toContain(`scopes = "${EXPECTED_SCOPES}"`);
    // Not a superset, not a reordering: the exact string, once.
    const declared = [...toml.matchAll(/^\s*scopes\s*=\s*"([^"]*)"/gm)].map((m) => m[1]);
    expect(declared).toEqual([EXPECTED_SCOPES]);
    // A write scope is requested only when a phase actually writes (T-02-23),
    // and this asserts the exact set — not a floor. write_companies arrived in
    // Phase 3 (CRED-03) when the app began publishing $app credit_v1
    // metafields; write_validations arrived in Phase 4 (ENFC-01/02) when the
    // app began creating the shop's cart-and-checkout Validation object;
    // write_orders arrived in Phase 5 (REMD-01, D5-01) for the single
    // paymentReminderSend mutation — not to write orders. Any FOURTH write
    // scope must justify itself by failing this line first.
    // read_customers stays out: it is the PII superset read_companies exists
    // to avoid — and the reason the reminder architecture lets Shopify resolve
    // the recipient instead of the app.
    expect(
      declared[0].split(",").filter((scope) => scope.startsWith("write_")),
    ).toEqual(["write_companies", "write_validations", "write_orders"]);
    expect(declared[0]).not.toMatch(/read_customers/);
  });

  it("keeps the api_version pinned to the stable 2026-07 (CF-5)", async () => {
    const toml = await activeToml();
    const versions = [...toml.matchAll(/api_version\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    // The Shopify CLI has rewritten this to the 2026-10 RC twice before.
    expect(versions).toEqual(["2026-07"]);
  });

  it("declares all fifteen Phase-2 topics on their routes", async () => {
    const byUri = new Map(
      (await subscriptions()).map((sub) => [sub.uri, sub.topics] as const),
    );

    for (const [uri, topics] of Object.entries(PHASE_2_SUBSCRIPTIONS)) {
      expect(byUri.get(uri)?.slice().sort()).toEqual(topics.slice().sort());
    }

    const phase2TopicCount = Object.values(PHASE_2_SUBSCRIPTIONS).flat().length;
    expect(phase2TopicCount).toBe(15);
  });

  it("points every subscription at a route file that exists", async () => {
    for (const sub of await subscriptions()) {
      expect(sub.uri).not.toBeNull();
      // React Router flat routes: "/webhooks/payment-terms" -> webhooks.payment-terms.tsx
      const file = `${sub.uri!.replace(/^\//, "").replace(/\//g, ".")}.tsx`;
      const path = fileURLToPath(new URL(`../app/routes/${file}`, import.meta.url));
      expect({ uri: sub.uri, exists: existsSync(path) }).toEqual({
        uri: sub.uri,
        exists: true,
      });
    }
  });

  it("leaves the Phase 1 compliance and lifecycle subscriptions intact", async () => {
    const subs = await subscriptions();

    expect(subs.find((s) => s.uri === "/webhooks/app/uninstalled")?.topics).toEqual([
      "app/uninstalled",
    ]);
    expect(subs.find((s) => s.uri === "/webhooks/app/scopes_update")?.topics).toEqual([
      "app/scopes_update",
    ]);
    expect(
      subs.find((s) => s.uri === "/webhooks/compliance")?.complianceTopics.sort(),
    ).toEqual(["customers/data_request", "customers/redact", "shop/redact"]);
  });

  it("keeps the production URL and the dev-URL-rewrite guard untouched (D-04)", async () => {
    const toml = await activeToml();
    expect(toml).toContain('application_url = "https://app.creditguardhq.com"');
    expect(toml).toContain("automatically_update_urls_on_dev = false");
  });

  it("runs the suite with the SAME scope string the registration requests", () => {
    // app/shopify.server.ts reads process.env.SCOPES; a test env that disagreed
    // with the TOML would exercise a differently-configured app than ships.
    expect(process.env.SCOPES).toBe(EXPECTED_SCOPES);
  });
});
