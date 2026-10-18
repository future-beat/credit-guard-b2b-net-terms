import { SessionNotFoundError } from "@shopify/shopify-app-react-router/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import { createMockAdmin, type MockAdminClient } from "./helpers/admin-client-mock";
import { sourceWithoutComments } from "./helpers/module-source";
import {
  FIXTURE_COMPANY_GID,
  FIXTURE_COMPANY_NAME,
  FIXTURE_ORDER_GID,
  makeCompanyOrdersResponse,
  makeMissingCompanyResponse,
  makeMissingOrderResponse,
  makeOrderForLedger,
  makeOrderForLedgerResponse,
} from "./fixtures/order-fixtures";
import { forgedWebhookRequest, signedWebhookRequest } from "./helpers/webhook-hmac";

/**
 * LEDG-02 — the ingest path, end to end.
 *
 * `authenticate.webhook` is deliberately NOT mocked: the 401-on-forged-HMAC
 * behaviour is the library's and a mocked authenticator would prove nothing.
 * The ONLY seam replaced is `admin-client.server.ts`, so a signed delivery drives
 * a real route, real HMAC verification, a fake Admin API, and real Postgres rows.
 */
const getAdminContext = vi.hoisted(() => vi.fn());

vi.mock("../app/services/admin-client.server", () => ({ getAdminContext }));

/** The ladder reports attribution gaps to Sentry; stub it so they're assertable. */
const captureMessage = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());

vi.mock("@sentry/react-router", () => ({ captureMessage, captureException }));

const SHOP = "orders-test.myshopify.com";
const OTHER_SHOP = "orders-bystander.myshopify.com";
const ENDPOINT = "https://app.creditguard.test/webhooks/orders";

let admin: MockAdminClient;

async function ordersAction(request: Request) {
  const { action } = await import("../app/routes/webhooks.orders");
  return action({ request, params: {}, context: {} } as never);
}

/** Returns the thrown Response for rejected requests instead of throwing. */
async function ordersResponse(request: Request): Promise<Response> {
  try {
    return await ordersAction(request);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

function orderPayload(overrides: Record<string, unknown> = {}) {
  // A doorbell, not data: the route may read identifiers from this and nothing
  // else. The deliberately wrong total is here to catch any code that believes
  // a payload amount. The company block is the B2B order-webhook attribute the
  // resolution ladder uses as a HINT (which company edge to scan) — numeric ids
  // exactly as Shopify delivers them.
  return {
    id: 5001,
    admin_graphql_api_id: FIXTURE_ORDER_GID,
    total_price: "999999.99",
    company: { id: 1001, location_id: 2001 },
    ...overrides,
  };
}

function delivery(
  topic: string,
  payload: Record<string, unknown> = orderPayload(),
  webhookId = "orders-webhook-1",
  shop = SHOP,
) {
  return signedWebhookRequest(ENDPOINT, topic, shop, payload, undefined, {
    webhookId,
  });
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

beforeEach(async () => {
  await wipe(SHOP, OTHER_SHOP);
  admin = createMockAdmin({
    OrderForLedger: makeOrderForLedgerResponse(),
    // The default company page lists the default order — an unknown hinted
    // delivery attributes via this edge (ladder rung 2).
    CompanyOrdersForLedger: makeCompanyOrdersResponse(),
  });
  getAdminContext.mockReset();
  getAdminContext.mockResolvedValue(admin);
  captureMessage.mockReset();
  captureException.mockReset();
});

afterAll(async () => {
  await wipe(SHOP, OTHER_SHOP);
  await prisma.$disconnect();
});

describe("company-hinted attribution (02-06 tracer — WINDOWS defect 5)", () => {
  const HINTED_ORDER_GID = "gid://shopify/Order/9001";
  const HINT_COMPANY_GID = "gid://shopify/Company/601";
  const HINT_LOCATION_GID = "gid://shopify/CompanyLocation/701";

  it("attributes a hinted B2B order via the authenticated company edge into nonzero exposure", async () => {
    // The payload names a company — an identifier off a signed delivery, used
    // ONLY to pick which company's authenticated order list to scan (T-02-26).
    // The attribution evidence is Shopify's own company(id){orders} edge.
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        companyGid: HINT_COMPANY_GID,
        companyName: "Northwind Trading",
        orders: [makeOrderForLedger({ id: HINTED_ORDER_GID })],
      }),
    );

    const response = await ordersResponse(
      delivery(
        "orders/create",
        {
          id: 9001,
          admin_graphql_api_id: HINTED_ORDER_GID,
          company: { id: 601, location_id: 701 },
          // Doorbell discipline: never believed (T-02-02).
          total_price: "999999.99",
        },
        "wh-tracer",
      ),
    );

    expect(response.status).toBe(200);

    // Attribution ran over the company edge — no single-order refetch needed.
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(1);
    expect(admin.callsFor("CompanyOrdersForLedger")[0].variables).toMatchObject({
      id: HINT_COMPANY_GID,
    });
    expect(admin.callCount("OrderForLedger")).toBe(0);

    const company = await prisma.company.findUnique({
      where: { shop_companyGid: { shop: SHOP, companyGid: HINT_COMPANY_GID } },
    });
    expect(company).not.toBeNull();
    // The head-row name comes from the CompanyOrdersForLedger response — the
    // authenticated source — never from the payload.
    expect(company!.name).toBe("Northwind Trading");
    expect(company!.exposure.toFixed(4)).toBe("500.0000");
    expect(company!.recomputedAt).toBeInstanceOf(Date);

    const order = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: HINTED_ORDER_GID } },
      include: { schedules: true },
    });
    expect(order).not.toBeNull();
    expect(order!.attributionStatus).toBe("ATTRIBUTED");
    expect(order!.companyId).toBe(company!.id);
    expect(order!.companyLocationGid).toBe(HINT_LOCATION_GID);
    expect(order!.outstandingShop.toFixed(4)).toBe("500.0000");
    expect(order!.schedules).toHaveLength(1);

    // The delivery is fully processed…
    const receipt = await prisma.webhookReceipt.findUnique({
      where: { id: "wh-tracer" },
    });
    expect(receipt!.processedAt).toBeInstanceOf(Date);

    // …and the bystander shop is untouched (T-02-05).
    expect(await countsFor(OTHER_SHOP)).toEqual({
      companies: 0,
      orders: 0,
      schedules: 0,
      receipts: 0,
      cursors: 0,
    });
  });
});

describe("orders/create (the tracer path — LEDG-02)", () => {
  it("ingests an unknown hinted order via the company edge and persists the source exposure", async () => {
    const response = await ordersResponse(delivery("orders/create"));

    expect(response.status).toBe(200);

    // The amount came from the authenticated company-edge scan, never from the
    // payload's 999999.99. No single-order refetch is needed on this rung.
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(1);
    expect(admin.callsFor("CompanyOrdersForLedger")[0].variables).toMatchObject({
      id: FIXTURE_COMPANY_GID,
    });
    expect(admin.callCount("OrderForLedger")).toBe(0);

    const company = await prisma.company.findUnique({
      where: { shop_companyGid: { shop: SHOP, companyGid: FIXTURE_COMPANY_GID } },
    });
    expect(company).not.toBeNull();
    expect(company!.exposure.toFixed(4)).toBe("500.0000");
    expect(company!.recomputedAt).toBeInstanceOf(Date);

    const order = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: FIXTURE_ORDER_GID } },
      include: { schedules: true },
    });
    expect(order).not.toBeNull();
    expect(order!.companyId).toBe(company!.id);
    expect(order!.attributionStatus).toBe("ATTRIBUTED");
    expect(order!.hasPaymentTerms).toBe(true);
    expect(order!.outstandingShop.toFixed(4)).toBe("500.0000");
    expect(order!.currencyCode).toBe("USD");
    expect(order!.schedules).toHaveLength(1);
    expect(order!.schedules[0].completedAt).toBeNull();
    expect(order!.schedules[0].dueAt).toBeInstanceOf(Date);
  });

  it("records the delivery receipt and stamps it processed", async () => {
    await ordersResponse(delivery("orders/create"));

    const receipt = await prisma.webhookReceipt.findUnique({
      where: { id: "orders-webhook-1" },
    });
    expect(receipt).not.toBeNull();
    expect(receipt!.shop).toBe(SHOP);
    expect(receipt!.topic).toBe("ORDERS_CREATE");
    expect(receipt!.processedAt).toBeInstanceOf(Date);
    // Metadata only — no payload body column exists (threat T-02-04).
    expect(Object.keys(receipt!).sort()).toEqual([
      "id",
      "processedAt",
      "receivedAt",
      "shop",
      "topic",
    ]);
  });
});

describe("the resolution ladder (02-06 — D-01/D-02/D-03)", () => {
  it("rung 1: refreshes a known order's money while PRESERVING its attribution", async () => {
    // Attribute first (rung 2)…
    await ordersResponse(delivery("orders/create", orderPayload(), "wh-r1-a"));
    const before = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: FIXTURE_ORDER_GID } },
    });
    expect(before!.attributionStatus).toBe("ATTRIBUTED");

    // …then a payment arrives. The refetch returns the paid-down truth.
    admin.setFixture(
      "OrderForLedger",
      makeOrderForLedgerResponse({
        outstanding: "200.00",
        received: "300.00",
        displayFinancialStatus: "PARTIALLY_PAID",
      }),
    );
    const response = await ordersResponse(
      delivery("orders/paid", orderPayload(), "wh-r1-b"),
    );

    expect(response.status).toBe(200);
    // Known row -> single-order refetch, no second company scan (hot path).
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(1);
    expect(admin.callCount("OrderForLedger")).toBe(1);
    expect(admin.callsFor("OrderForLedger")[0].variables).toEqual({
      id: FIXTURE_ORDER_GID,
    });

    const after = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: FIXTURE_ORDER_GID } },
    });
    // Money moved; attribution did not (D-01: a paid order keeps its company).
    expect(after!.outstandingShop.toFixed(4)).toBe("200.0000");
    expect(after!.attributionStatus).toBe("ATTRIBUTED");
    expect(after!.companyId).toBe(before!.companyId);
    expect(after!.companyLocationGid).toBe(before!.companyLocationGid);

    const company = await prisma.company.findUnique({
      where: { shop_companyGid: { shop: SHOP, companyGid: FIXTURE_COMPANY_GID } },
    });
    expect(company!.exposure.toFixed(4)).toBe("200.0000");
  });

  it("rung 2-miss: warns naming the hint and persists UNRESOLVED without failing the delivery", async () => {
    // The hinted company's edge does NOT list this order — an eventual-
    // consistency race or a wrong hint (T-02-26). The delivery must still ack:
    // orders/updated + orders/paid re-ring the doorbell and the daily
    // reconciliation heals within 24h; a throw here would be a retry storm.
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        orders: [makeOrderForLedger({ id: "gid://shopify/Order/7777" })],
      }),
    );

    const response = await ordersResponse(
      delivery("orders/create", orderPayload(), "wh-r2-miss"),
    );

    expect(response.status).toBe(200);
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(1);
    // Fell through to the reduced single-order refetch (rung 3).
    expect(admin.callCount("OrderForLedger")).toBe(1);

    const order = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: FIXTURE_ORDER_GID } },
    });
    expect(order).not.toBeNull();
    expect(order!.attributionStatus).toBe("UNRESOLVED");
    expect(order!.companyId).toBeNull();

    // A false attribution was never minted: no company row exists at all.
    expect(await prisma.company.count({ where: { shop: SHOP } })).toBe(0);

    // The miss is visible in Sentry, naming the hint that missed.
    const messages = captureMessage.mock.calls.map((call) => String(call[0]));
    expect(
      messages.some(
        (message) =>
          message.includes(FIXTURE_COMPANY_GID) &&
          message.includes(FIXTURE_ORDER_GID),
      ),
    ).toBe(true);
  });

  it("rung 2-miss: a hint Shopify knows no company for degrades the same way", async () => {
    admin.setFixture("CompanyOrdersForLedger", makeMissingCompanyResponse());

    const response = await ordersResponse(
      delivery("orders/create", orderPayload(), "wh-r2-nocompany"),
    );

    expect(response.status).toBe(200);
    const order = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: FIXTURE_ORDER_GID } },
    });
    expect(order!.attributionStatus).toBe("UNRESOLVED");
    expect(await prisma.company.count({ where: { shop: SHOP } })).toBe(0);
  });

  it("rung 3: persists a hint-less net-terms order UNRESOLVED with zero exposure contribution, and warns", async () => {
    // Prove zero-contribution against a live balance: attribute the default
    // order first, then ingest a SECOND, unattributable net-terms order.
    await ordersResponse(delivery("orders/create", orderPayload(), "wh-r3-seed"));

    admin.setFixture(
      "OrderForLedger",
      makeOrderForLedgerResponse({
        id: "gid://shopify/Order/6001",
        outstanding: "700.00",
        // Real schedules are never shared between orders; the default fixture
        // id would collide with the seeded order's (unique shop+scheduleGid).
        schedules: [{ id: "gid://shopify/PaymentSchedule/6001" }],
      }),
    );
    captureMessage.mockClear();

    const response = await ordersResponse(
      delivery(
        "orders/create",
        {
          id: 6001,
          admin_graphql_api_id: "gid://shopify/Order/6001",
          total_price: "999999.99",
          // No company attribute at all — nothing to hint with.
        },
        "wh-r3-unresolved",
      ),
    );

    expect(response.status).toBe(200);

    const order = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: "gid://shopify/Order/6001" } },
    });
    // UNRESOLVED is an explicit stored state — distinct from "proven no
    // company" (constraint 5) — and contributes nothing until attributed.
    expect(order!.attributionStatus).toBe("UNRESOLVED");
    expect(order!.companyId).toBeNull();

    const company = await prisma.company.findUnique({
      where: { shop_companyGid: { shop: SHOP, companyGid: FIXTURE_COMPANY_GID } },
    });
    expect(company!.exposure.toFixed(4)).toBe("500.0000");

    // A net-terms order pending attribution understates exposure until the
    // sweep — that is worth a loud warning.
    const messages = captureMessage.mock.calls.map((call) => String(call[0]));
    expect(
      messages.some((message) => message.includes("gid://shopify/Order/6001")),
    ).toBe(true);
  });

  it("rung 3: stays silent for a card-paid order — benign noise, not understated exposure", async () => {
    admin.setFixture(
      "OrderForLedger",
      makeOrderForLedgerResponse({
        id: "gid://shopify/Order/6002",
        paymentTerms: null,
        outstanding: "0.00",
        schedules: [{ id: "gid://shopify/PaymentSchedule/6002" }],
      }),
    );

    const response = await ordersResponse(
      delivery(
        "orders/create",
        { id: 6002, admin_graphql_api_id: "gid://shopify/Order/6002" },
        "wh-r3-card",
      ),
    );

    expect(response.status).toBe(200);
    const order = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: "gid://shopify/Order/6002" } },
    });
    expect(order!.attributionStatus).toBe("UNRESOLVED");
    expect(order!.hasPaymentTerms).toBe(false);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("rung 3: a clean null means the unknown order is gone at the source — no row, no warning", async () => {
    admin.setFixture("OrderForLedger", makeMissingOrderResponse());

    const response = await ordersResponse(
      delivery(
        "orders/create",
        { id: 6003, admin_graphql_api_id: "gid://shopify/Order/6003" },
        "wh-r3-gone",
      ),
    );

    expect(response.status).toBe(200);
    expect(await prisma.ledgerOrder.count({ where: { shop: SHOP } })).toBe(0);
    expect(captureMessage).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * Rung-1 re-attribution (06-DEBUG ingest latency).
 * ------------------------------------------------------------------ */

/** One CompaniesForLedger page — `ordersCount` selected as `{ count }`. */
function companiesPage(
  nodes: { id: string; name: string; ordersCount: number }[],
) {
  return {
    data: {
      companies: {
        edges: nodes.map((node) => ({
          node: {
            id: node.id,
            name: node.name,
            ordersCount: { count: node.ordersCount },
          },
        })),
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  };
}

/** A doorbell with no `company` attribute at all — the hint-less rung. */
function hintlessPayload(numericId: number, gid: string) {
  return {
    id: numericId,
    admin_graphql_api_id: gid,
    total_price: "999999.99",
  };
}

function ledgerRowFor(orderGid: string) {
  return prisma.ledgerOrder.findUnique({
    where: { shop_orderGid: { shop: SHOP, orderGid } },
  });
}

describe("rung 1 re-attribution — a later doorbell heals a miss (06-DEBUG)", () => {
  /**
   * The defect this describe exists for: attribution used to be attempted
   * EXACTLY ONCE, on the first doorbell for an unknown order. Every later
   * doorbell took rung 1, which is preserve-mode, so an order the company edge
   * had not yet indexed sat UNRESOLVED — zero exposure, no `credit_v1` change,
   * no checkout hold — until the next 03:30Z reconciliation, up to 24h later.
   * Shopify rings 3–5 more times within the first minute; those rings are what
   * these tests spend.
   */
  async function activeShop() {
    // Publishing gates on Shop.active — without the row, the credit_v1 write
    // that makes the hold real is a silent no-op and this file would prove
    // nothing about it.
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
  }

  it("attributes on the SECOND doorbell once the edge lists the order, and publishes credit_v1", async () => {
    await activeShop();

    // First doorbell: Shopify's company→orders edge has not indexed the
    // seconds-old order yet, so rung 2 misses and rung 3 persists UNRESOLVED.
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        orders: [makeOrderForLedger({ id: "gid://shopify/Order/7777" })],
      }),
    );
    await ordersResponse(delivery("orders/create", orderPayload(), "wh-heal-1"));

    const missed = await ledgerRowFor(FIXTURE_ORDER_GID);
    expect(missed!.attributionStatus).toBe("UNRESOLVED");
    expect(await prisma.company.count({ where: { shop: SHOP } })).toBe(0);

    // Half a second later the edge catches up and orders/updated re-rings.
    admin.setFixture("CompanyOrdersForLedger", makeCompanyOrdersResponse());
    admin.reset();

    const response = await ordersResponse(
      delivery("orders/updated", orderPayload(), "wh-heal-2"),
    );

    expect(response.status).toBe(200);

    const healed = await ledgerRowFor(FIXTURE_ORDER_GID);
    expect(healed!.attributionStatus).toBe("ATTRIBUTED");
    expect(healed!.companyId).not.toBeNull();
    // The hint carried the location; the heal keeps it.
    expect(healed!.companyLocationGid).toBe("gid://shopify/CompanyLocation/2001");

    const company = await prisma.company.findUnique({
      where: { shop_companyGid: { shop: SHOP, companyGid: FIXTURE_COMPANY_GID } },
    });
    expect(company!.exposure.toFixed(4)).toBe("500.0000");

    // Exposure the Function cannot read is exposure that blocks nothing.
    expect(admin.callCount("PublishCompanyCredit")).toBeGreaterThan(0);

    // Bounded: the hint names one company, so exactly one edge scan and no
    // company enumeration at all.
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(1);
    expect(admin.callCount("CompaniesForLedger")).toBe(0);
  });

  it("enumerates companies for a HINT-LESS doorbell and pages only the count-mismatched one", async () => {
    await activeShop();
    const gid = "gid://shopify/Order/6101";
    const node = makeOrderForLedger({
      id: gid,
      schedules: [{ id: "gid://shopify/PaymentSchedule/6101" }],
    });

    // First doorbell: no hint at all (production's observed shape) — rung 3.
    admin.setFixture("OrderForLedger", { data: { order: node } });
    await ordersResponse(
      delivery("orders/create", hintlessPayload(6101, gid), "wh-heal-h1"),
    );
    expect((await ledgerRowFor(gid))!.attributionStatus).toBe("UNRESOLVED");

    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([
        // Local attributed count 0 == Shopify's 0: nothing to look for here.
        { id: "gid://shopify/Company/9001", name: "Settled Co", ordersCount: 0 },
        // Shopify says 1, the ledger has 0 attributed — the 02-08 invariant
        // says this company is exactly where a missing order can be.
        { id: FIXTURE_COMPANY_GID, name: FIXTURE_COMPANY_NAME, ordersCount: 1 },
      ]),
    );
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({ orders: [node] }),
    );
    admin.reset();

    await ordersResponse(
      delivery("orders/updated", hintlessPayload(6101, gid), "wh-heal-h2"),
    );

    const healed = await ledgerRowFor(gid);
    expect(healed!.attributionStatus).toBe("ATTRIBUTED");
    // The company edge names no location, and a hint-less heal invents none.
    expect(healed!.companyLocationGid).toBeNull();

    const company = await prisma.company.findUnique({
      where: { shop_companyGid: { shop: SHOP, companyGid: FIXTURE_COMPANY_GID } },
    });
    expect(company!.exposure.toFixed(4)).toBe("500.0000");

    // One enumeration, and ONLY the mismatched company is paged: this is the
    // whole API-cost argument for doing this on a webhook.
    expect(admin.callCount("CompaniesForLedger")).toBe(1);
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(1);
    expect(admin.callsFor("CompanyOrdersForLedger")[0].variables.id).toBe(
      FIXTURE_COMPANY_GID,
    );
  });

  it("never re-attributes an ATTRIBUTED row — the hot path stays one refetch", async () => {
    await activeShop();
    await ordersResponse(delivery("orders/create", orderPayload(), "wh-attr-1"));
    expect((await ledgerRowFor(FIXTURE_ORDER_GID))!.attributionStatus).toBe(
      "ATTRIBUTED",
    );

    admin.reset();
    await ordersResponse(delivery("orders/paid", orderPayload(), "wh-attr-2"));

    // A money refresh on an attributed order re-scans nothing (D-01).
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(0);
    expect(admin.callCount("CompaniesForLedger")).toBe(0);
    expect(admin.callCount("OrderForLedger")).toBe(1);
    expect((await ledgerRowFor(FIXTURE_ORDER_GID))!.attributionStatus).toBe(
      "ATTRIBUTED",
    );
  });

  it("re-attempts a NO_COMPANY row — the exhaustion verdict is never sticky (W-2)", async () => {
    await activeShop();
    const gid = "gid://shopify/Order/6103";
    const node = makeOrderForLedger({
      id: gid,
      schedules: [{ id: "gid://shopify/PaymentSchedule/6103" }],
    });

    admin.setFixture("OrderForLedger", { data: { order: node } });
    await ordersResponse(
      delivery("orders/create", hintlessPayload(6103, gid), "wh-nocompany-1"),
    );
    // Yesterday's reconciliation proved no company claimed it.
    await prisma.ledgerOrder.update({
      where: { shop_orderGid: { shop: SHOP, orderGid: gid } },
      data: { attributionStatus: "NO_COMPANY" },
    });

    admin.setFixture("CompanyOrdersForLedger", makeCompanyOrdersResponse({ orders: [node] }));
    admin.reset();

    await ordersResponse(
      delivery("orders/updated", orderPayload({ id: 6103, admin_graphql_api_id: gid }), "wh-nocompany-2"),
    );

    const healed = await ledgerRowFor(gid);
    expect(healed!.attributionStatus).toBe("ATTRIBUTED");
  });

  it("never lets a failing retry cost the delivery its money refresh", async () => {
    await activeShop();
    // First doorbell misses, leaving an UNRESOLVED row.
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        orders: [makeOrderForLedger({ id: "gid://shopify/Order/7777" })],
      }),
    );
    await ordersResponse(delivery("orders/create", orderPayload(), "wh-retry-fail-1"));

    // Now the company edge fails outright — a scope blip, a throttle that
    // outlived its retry, anything. The retry is best-effort: the 5-minute
    // heal and the daily sweep are the guaranteed attribution paths, so a
    // failure here must not stop the doorbell doing its OTHER job, which is
    // the money the merchant's dashboard is showing right now.
    admin.setFixture("CompanyOrdersForLedger", {
      data: { company: null },
      errors: [
        {
          message: "Access denied for orders field.",
          extensions: { code: "ACCESS_DENIED" },
        },
      ],
    });
    admin.setFixture(
      "OrderForLedger",
      makeOrderForLedgerResponse({ outstanding: "250.00" }),
    );

    const response = await ordersResponse(
      delivery("orders/paid", orderPayload(), "wh-retry-fail-2"),
    );

    expect(response.status).toBe(200);

    const row = await ledgerRowFor(FIXTURE_ORDER_GID);
    expect(row!.outstandingShop.toFixed(4)).toBe("250.0000");
    expect(row!.attributionStatus).toBe("UNRESOLVED");
    // Best-effort, never silent.
    expect(captureException).toHaveBeenCalled();
  });

  it("does not re-enumerate every company for a HINT-LESS NO_COMPANY row", async () => {
    await activeShop();
    const gid = "gid://shopify/Order/6104";
    const node = makeOrderForLedger({
      id: gid,
      schedules: [{ id: "gid://shopify/PaymentSchedule/6104" }],
    });

    admin.setFixture("OrderForLedger", { data: { order: node } });
    await ordersResponse(
      delivery("orders/create", hintlessPayload(6104, gid), "wh-noco-scan-1"),
    );
    // The daily exhaustion pass already enumerated EVERY company and proved
    // none claims this order. Repeating that enumeration on every later
    // doorbell would buy nothing and spend a page each time; the daily heal
    // re-checks NO_COMPANY rows (they are never sticky) and a hinted doorbell
    // still retries, because that scan is one targeted call.
    await prisma.ledgerOrder.update({
      where: { shop_orderGid: { shop: SHOP, orderGid: gid } },
      data: { attributionStatus: "NO_COMPANY" },
    });
    admin.reset();

    const response = await ordersResponse(
      delivery("orders/updated", hintlessPayload(6104, gid), "wh-noco-scan-2"),
    );

    expect(response.status).toBe(200);
    expect(admin.callCount("CompaniesForLedger")).toBe(0);
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(0);
  });

  it("leaves a card-paid UNRESOLVED row alone — no terms, no credit, no scan (D-02)", async () => {
    await activeShop();
    const gid = "gid://shopify/Order/6102";
    admin.setFixture(
      "OrderForLedger",
      makeOrderForLedgerResponse({
        id: gid,
        paymentTerms: null,
        outstanding: "0.00",
        schedules: [{ id: "gid://shopify/PaymentSchedule/6102" }],
      }),
    );

    await ordersResponse(
      delivery("orders/create", hintlessPayload(6102, gid), "wh-card-heal-1"),
    );
    admin.reset();

    // No CompaniesForLedger fixture is registered in this file's default: a
    // retry here would throw rather than merely cost a call.
    const response = await ordersResponse(
      delivery("orders/updated", hintlessPayload(6102, gid), "wh-card-heal-2"),
    );

    expect(response.status).toBe(200);
    expect(admin.callCount("CompaniesForLedger")).toBe(0);
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(0);
    expect((await ledgerRowFor(gid))!.hasPaymentTerms).toBe(false);
  });
});

describe("redelivery (threat T-02-03)", () => {
  it("processes the same webhook id exactly once and still acks 200", async () => {
    const first = await ordersResponse(delivery("orders/create"));
    const second = await ordersResponse(delivery("orders/create"));

    expect(first.status).toBe(200);
    // A duplicate is not an error — a non-200 would make Shopify retry forever.
    expect(second.status).toBe(200);

    // The proof that the second delivery did no work: one scan, one receipt.
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(1);
    expect(admin.callCount("OrderForLedger")).toBe(0);
    expect(await prisma.webhookReceipt.count({ where: { shop: SHOP } })).toBe(1);
    expect(await prisma.ledgerOrder.count({ where: { shop: SHOP } })).toBe(1);
    expect(await prisma.company.count({ where: { shop: SHOP } })).toBe(1);
  });

  it("survives a transient failure — the redelivery is real work, not a dedupe no-op", async () => {
    // The receipt is claimed BEFORE the work, which is what makes two concurrent
    // copies of one delivery race on the database. The hazard that ordering
    // creates: if the work then fails transiently, the route answers non-200,
    // Shopify redelivers, and the receipt just claimed discards the redelivery
    // as already-seen — the delivery is gone for good, leaving the ledger wrong
    // until the daily reconciliation. The route must therefore RELEASE an
    // unfinished claim on failure.
    getAdminContext.mockRejectedValueOnce(new Error("Admin API unavailable"));

    await expect(
      ordersAction(delivery("orders/create", orderPayload(), "wh-transient")),
    ).rejects.toThrow("Admin API unavailable");

    // Nothing durable survives the failed attempt — above all no receipt.
    expect(await countsFor(SHOP)).toEqual({
      companies: 0,
      orders: 0,
      schedules: 0,
      receipts: 0,
      cursors: 0,
    });

    // Shopify redelivers the SAME webhook id. This time it must do the work.
    const retry = await ordersResponse(
      delivery("orders/create", orderPayload(), "wh-transient"),
    );

    expect(retry.status).toBe(200);
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(1);

    const company = await prisma.company.findUnique({
      where: { shop_companyGid: { shop: SHOP, companyGid: FIXTURE_COMPANY_GID } },
    });
    expect(company!.exposure.toFixed(4)).toBe("500.0000");

    const receipt = await prisma.webhookReceipt.findUnique({
      where: { id: "wh-transient" },
    });
    expect(receipt!.processedAt).toBeInstanceOf(Date);
  });

  it("keeps a SUCCEEDED delivery's receipt even if a later error is raised", async () => {
    // The release is guarded on `processedAt: null`, so dedupe-on-success is
    // untouched: a completed delivery can never be un-recorded.
    await ordersResponse(delivery("orders/create", orderPayload(), "wh-done"));

    const { releaseWebhookReceipt } = await import(
      "../app/services/ledger.server"
    );
    await releaseWebhookReceipt("wh-done");

    expect(
      await prisma.webhookReceipt.findUnique({ where: { id: "wh-done" } }),
    ).not.toBeNull();

    const again = await ordersResponse(
      delivery("orders/create", orderPayload(), "wh-done"),
    );
    expect(again.status).toBe(200);
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(1);
    expect(admin.callCount("OrderForLedger")).toBe(0);
  });

  it("treats a distinct webhook id for the same order as fresh work", async () => {
    await ordersResponse(delivery("orders/create", orderPayload(), "wh-a"));
    await ordersResponse(delivery("orders/updated", orderPayload(), "wh-b"));

    // First delivery attributed over the company edge (rung 2); the second
    // found a known row and refreshed it with a single-order refetch (rung 1).
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(1);
    expect(admin.callCount("OrderForLedger")).toBe(1);
    expect(await prisma.webhookReceipt.count({ where: { shop: SHOP } })).toBe(2);
    // Idempotent upserts: two deliveries, still one order and one schedule.
    expect(await prisma.ledgerOrder.count({ where: { shop: SHOP } })).toBe(1);
    expect(await prisma.ledgerSchedule.count({ where: { shop: SHOP } })).toBe(1);
  });
});

describe("orders/cancelled and orders/delete converge exposure down", () => {
  async function exposure() {
    const company = await prisma.company.findUnique({
      where: { shop_companyGid: { shop: SHOP, companyGid: FIXTURE_COMPANY_GID } },
    });
    return company?.exposure.toFixed(4) ?? null;
  }

  it("drops a cancelled order's contribution while keeping the row", async () => {
    await ordersResponse(delivery("orders/create", orderPayload(), "wh-1"));
    expect(await exposure()).toBe("500.0000");

    admin.setFixture(
      "OrderForLedger",
      makeOrderForLedgerResponse({ cancelledAt: "2026-08-10T00:00:00.000Z" }),
    );
    const response = await ordersResponse(
      delivery("orders/cancelled", orderPayload(), "wh-2"),
    );

    expect(response.status).toBe(200);
    expect(await exposure()).toBe("0.0000");

    // The order is history, not a lie: the row stays, marked cancelled.
    const order = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: FIXTURE_ORDER_GID } },
    });
    expect(order).not.toBeNull();
    expect(order!.cancelledAt).toBeInstanceOf(Date);
  });

  it("removes a deleted order, cascades its schedules, and recomputes down", async () => {
    await ordersResponse(delivery("orders/create", orderPayload(), "wh-1"));
    expect(await exposure()).toBe("500.0000");

    const response = await ordersResponse(
      delivery("orders/delete", orderPayload(), "wh-2"),
    );

    expect(response.status).toBe(200);
    // A deleted order cannot be refetched, so this topic must not try: the one
    // admin call on record is the create's company-edge scan.
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(1);
    expect(admin.callCount("OrderForLedger")).toBe(0);
    expect(await prisma.ledgerOrder.count({ where: { shop: SHOP } })).toBe(0);
    expect(await prisma.ledgerSchedule.count({ where: { shop: SHOP } })).toBe(0);
    // The company survives its last order — with nothing owed.
    expect(await exposure()).toBe("0.0000");
  });

  it("never reaches into another shop's ledger", async () => {
    await ordersResponse(delivery("orders/create", orderPayload(), "wh-other", OTHER_SHOP));
    expect(
      await prisma.ledgerOrder.count({ where: { shop: OTHER_SHOP } }),
    ).toBe(1);

    await ordersResponse(delivery("orders/delete", orderPayload(), "wh-2"));

    // Same order gid, different shop: untouched (threat T-02-05).
    expect(
      await prisma.ledgerOrder.count({ where: { shop: OTHER_SHOP } }),
    ).toBe(1);
    expect(await prisma.company.count({ where: { shop: OTHER_SHOP } })).toBe(1);
  });
});

describe("refunds/create and orders/edited resolve the parent order", () => {
  it("uses order_id from a refund payload, not the refund's own gid", async () => {
    await ordersResponse(
      delivery(
        "refunds/create",
        {
          id: 88001,
          admin_graphql_api_id: "gid://shopify/Refund/88001",
          order_id: 5001,
        },
        "wh-refund",
      ),
    );

    expect(admin.callsFor("OrderForLedger")[0].variables).toEqual({
      id: FIXTURE_ORDER_GID,
    });
  });

  it("digs the order id out of an order_edit payload", async () => {
    await ordersResponse(
      delivery(
        "orders/edited",
        { order_edit: { id: 99001, order_id: 5001 } },
        "wh-edit",
      ),
    );

    expect(admin.callsFor("OrderForLedger")[0].variables).toEqual({
      id: FIXTURE_ORDER_GID,
    });
  });

  it("acks an unsubscribed topic without touching the ledger", async () => {
    const response = await ordersResponse(
      delivery("orders/fulfilled", orderPayload(), "wh-unhandled"),
    );

    expect(response.status).toBe(200);
    expect(admin.callCount()).toBe(0);
    expect(await prisma.ledgerOrder.count({ where: { shop: SHOP } })).toBe(0);
  });
});

describe("forged HMAC (threat T-02-01)", () => {
  it("answers 401 and writes nothing to any ledger table", async () => {
    const response = await ordersResponse(
      forgedWebhookRequest(ENDPOINT, "orders/create", SHOP, orderPayload()),
    );

    expect(response.status).toBe(401);
    expect(await countsFor(SHOP)).toEqual({
      companies: 0,
      orders: 0,
      schedules: 0,
      receipts: 0,
      cursors: 0,
    });
    // The library rejects before handler code runs — no refetch was attempted.
    expect(admin.callCount()).toBe(0);
    expect(await prisma.sweepLease.count()).toBe(0);
  });

  it("cannot corrupt an existing company's exposure", async () => {
    await ordersResponse(delivery("orders/create"));

    const response = await ordersResponse(
      forgedWebhookRequest(
        ENDPOINT,
        "orders/updated",
        SHOP,
        orderPayload({ total_price: "0.00" }),
      ),
    );

    expect(response.status).toBe(401);
    const company = await prisma.company.findUnique({
      where: { shop_companyGid: { shop: SHOP, companyGid: FIXTURE_COMPANY_GID } },
    });
    expect(company!.exposure.toFixed(4)).toBe("500.0000");
  });
});

describe("post-uninstall delivery — acknowledge-and-drop (WINDOWS #3)", () => {
  /**
   * The shape observed live: a shop uninstalls, the `app/uninstalled` handler
   * deletes its offline session, and Shopify keeps delivering whatever was
   * already in flight. `unauthenticated.admin(shop)` then throws
   * `SessionNotFoundError`, the generic catch released the claim and rethrew,
   * and Shopify retried a GUARANTEED failure for ~48h — recording 500s against
   * the app on a platform surface a reviewer looks at.
   *
   * The distinction pinned here is the whole point: the NAMED error is
   * acknowledged and dropped, EVERY other error still releases the receipt and
   * rethrows so Shopify's redelivery stays the retry mechanism (the 02-03
   * claim-release contract, threat T-06-12).
   */
  const noSession = () => new SessionNotFoundError("no session found for shop");

  it("answers 200 with a processed receipt and writes nothing to the ledger", async () => {
    getAdminContext.mockReset();
    getAdminContext.mockRejectedValue(noSession());

    const response = await ordersAction(
      delivery("orders/create", orderPayload(), "wh-uninstalled"),
    );

    expect(response.status).toBe(200);

    // The receipt is marked PROCESSED, not released: the point of dropping is
    // that the redelivery dedupes instead of re-running the same failure.
    const receipt = await prisma.webhookReceipt.findUnique({
      where: { id: "wh-uninstalled" },
    });
    expect(receipt!.processedAt).toBeInstanceOf(Date);

    // Nothing is written for a shop that is gone — D-06 retain-and-deactivate
    // already holds whatever data the merchant had.
    expect(await countsFor(SHOP)).toEqual({
      companies: 0,
      orders: 0,
      schedules: 0,
      receipts: 1,
      cursors: 0,
    });
  });

  it("records the drop once, at warning level, naming the topic and the shop", async () => {
    getAdminContext.mockReset();
    getAdminContext.mockRejectedValue(noSession());

    await ordersAction(
      delivery("orders/create", orderPayload(), "wh-uninstalled-warn"),
    );

    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [message, level] = captureMessage.mock.calls[0];
    expect(message).toContain(SHOP);
    expect(message).toContain("ORDERS_CREATE");
    expect(level).toBe("warning");
  });

  it("dedupes Shopify's redelivery of a dropped id — no second Admin attempt", async () => {
    getAdminContext.mockReset();
    getAdminContext.mockRejectedValue(noSession());

    const first = await ordersAction(
      delivery("orders/create", orderPayload(), "wh-uninstalled-dupe"),
    );
    const second = await ordersAction(
      delivery("orders/create", orderPayload(), "wh-uninstalled-dupe"),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // The processed receipt short-circuits the redelivery before any work.
    expect(getAdminContext).toHaveBeenCalledTimes(1);
    expect(await prisma.webhookReceipt.count({ where: { shop: SHOP } })).toBe(1);
  });

  it("still releases and rethrows a NON-session failure (the drop is not a blanket catch)", async () => {
    // T-06-12: a drop branch that swallowed real transient failures would cost
    // the ledger deliveries outright. Only the named error is droppable.
    getAdminContext.mockRejectedValueOnce(new Error("Admin API unavailable"));

    await expect(
      ordersAction(delivery("orders/create", orderPayload(), "wh-not-session")),
    ).rejects.toThrow("Admin API unavailable");

    expect(await countsFor(SHOP)).toEqual({
      companies: 0,
      orders: 0,
      schedules: 0,
      receipts: 0,
      cursors: 0,
    });
  });

  it.each([
    ["app/routes/webhooks.orders.tsx"],
    ["app/routes/webhooks.companies.tsx"],
    ["app/routes/webhooks.payment-terms.tsx"],
  ])("%s drops on the NAMED error only", (path) => {
    // Comment-stripped: a rule that only survives in a comment is not a rule.
    const code = sourceWithoutComments(path);

    expect(code).toMatch(
      /import\s*\{[^}]*SessionNotFoundError[^}]*\}\s*from\s*["']@shopify\/shopify-app-react-router\/server["']/,
    );
    expect(code).toContain("instanceof SessionNotFoundError");
    expect(code).toContain("markWebhookProcessed(webhookId)");
    // The claim-release contract survives for everything else.
    expect(code).toContain("releaseWebhookReceipt(webhookId)");
    expect(code).toMatch(/throw error;/);
  });
});
