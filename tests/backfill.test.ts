import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import {
  BACKFILL_CURSOR_KEY,
  RECONCILIATION_CURSOR_KEY,
  STALE_AFTER_MS,
  awaitBackfillIdle,
  enumerateCompanies,
  ingestCompanyOrders,
  pollBackfillIfStale,
  readBackfillState,
  runCompanyBackfill,
  startBackfill,
} from "../app/services/backfill.server";
import type { OrderForLedgerNode } from "../app/services/ledger.server";
import { createMockAdmin, type MockAdminClient } from "./helpers/admin-client-mock";
import {
  makeCompanyOrdersResponse,
  makeMissingCompanyResponse,
  makeOrderForLedger,
} from "./fixtures/order-fixtures";
import { forgedWebhookRequest, signedWebhookRequest } from "./helpers/webhook-hmac";

/**
 * LEDG-01 — the COMPANY-DRIVEN install backfill (02-07, WINDOWS defect 5
 * remedy part 2).
 *
 * The backfill enumerates companies and ingests each company's orders over the
 * authenticated `company(id){orders}` edge — the same edge the webhook
 * resolution ladder uses. Attribution is DEFINITIONAL: an order is attributed
 * because it appeared on its company's edge, never inferred from a
 * scope-trapped order field. There is no bulk operation, no JSONL, and no
 * outbound fetch anywhere on this path.
 *
 * Only two seams are faked: `admin-client.server.ts` (the Admin GraphQL
 * client) and `authenticate.admin` (so the embedded layout loader can be
 * driven without a real session token). `authenticate.webhook` stays REAL, so
 * the bulk-operations route is exercised through genuine HMAC verification
 * exactly as the order webhooks are.
 */
const getAdminContext = vi.hoisted(() => vi.fn());
const authenticateAdmin = vi.hoisted(() => vi.fn());

vi.mock("../app/services/admin-client.server", () => ({ getAdminContext }));

vi.mock("../app/shopify.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app/shopify.server")>();
  return {
    ...actual,
    authenticate: { ...actual.authenticate, admin: authenticateAdmin },
  };
});

const SHOP = "backfill-test.myshopify.com";
const OTHER_SHOP = "backfill-bystander.myshopify.com";
const APP_URL = "https://app.creditguard.test";

const ACME = "gid://shopify/Company/100";
const BOREALIS = "gid://shopify/Company/200";
const CYGNUS = "gid://shopify/Company/300";

/**
 * A clock strictly PAST the default fixture due date (2026-08-31): schedule
 * 8001 is overdue at this instant, schedules 8002/8004 (2026-10-01) are not.
 * Injected rather than read from the wall clock so the overdue assertions
 * below mean the same thing next year (D-04 strict-past).
 */
const NOW = new Date("2026-09-15T00:00:00.000Z");

let admin: MockAdminClient;

/* ------------------------------------------------------------------ *
 * Fixtures and helpers
 * ------------------------------------------------------------------ */

/**
 * Acme's ledger, as the company edge reports it. #1001 is open NET-30 and past
 * due at NOW; #1002 is open and due in the future; #1003 is fully settled —
 * and MUST still be ingested, because the company orders pull carries no
 * financial-status narrowing and no age window (D-06). Settled orders
 * contribute zero via the engine's gates, and their presence is what lets a
 * local per-company row count reconcile against `Company.ordersCount` (02-08).
 */
const ACME_OPEN_PAST_DUE = makeOrderForLedger({
  id: "gid://shopify/Order/1001",
  name: "#1001",
  outstanding: "1250.50",
  updatedAt: "2026-08-05T00:00:00.000Z",
  schedules: [{ id: "gid://shopify/PaymentSchedule/8001" }],
});

const ACME_OPEN_FUTURE = makeOrderForLedger({
  id: "gid://shopify/Order/1002",
  name: "#1002",
  outstanding: "400.25",
  displayFinancialStatus: "PARTIALLY_PAID",
  updatedAt: "2026-08-10T04:00:00.000Z",
  schedules: [
    {
      id: "gid://shopify/PaymentSchedule/8002",
      dueAt: "2026-10-01T00:00:00.000Z",
    },
  ],
});

const ACME_SETTLED = makeOrderForLedger({
  id: "gid://shopify/Order/1003",
  name: "#1003",
  outstanding: "0.00",
  displayFinancialStatus: "PAID",
  updatedAt: "2026-08-03T00:00:00.000Z",
  schedules: [
    {
      id: "gid://shopify/PaymentSchedule/8003",
      dueAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-02T00:00:00.000Z",
    },
  ],
});

const BOREALIS_OPEN = makeOrderForLedger({
  id: "gid://shopify/Order/2001",
  name: "#2001",
  outstanding: "75.00",
  updatedAt: "2026-08-08T00:00:00.000Z",
  schedules: [
    {
      id: "gid://shopify/PaymentSchedule/8004",
      dueAt: "2026-10-01T00:00:00.000Z",
    },
  ],
});

interface CompanyNodeFixture {
  id: string;
  name: string;
  ordersCount: number;
}

/** One CompaniesForLedger page, ordersCount selected as `{ count }`. */
function companiesPage(
  nodes: CompanyNodeFixture[],
  { hasNextPage = false, endCursor = null as string | null } = {},
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
        pageInfo: { hasNextPage, endCursor },
      },
    },
  };
}

/**
 * Route CompanyOrdersForLedger calls by the requested company gid — each
 * company answers with its own single page of orders. A gid outside the map
 * answers `company: null`, exactly as Shopify does for an unknown company.
 */
function companyOrdersByGid(
  map: Record<string, { name: string; orders: OrderForLedgerNode[] }>,
) {
  return (variables: Record<string, unknown>) => {
    const gid = String(variables.id);
    const entry = map[gid];
    if (!entry) return makeMissingCompanyResponse();
    return makeCompanyOrdersResponse({
      companyGid: gid,
      companyName: entry.name,
      orders: entry.orders,
    });
  };
}

/** The archetypal three-company shop the tracer runs over. */
function seedTracerShop() {
  admin.setFixture(
    "CompaniesForLedger",
    companiesPage([
      { id: ACME, name: "Acme Industrial", ordersCount: 3 },
      { id: BOREALIS, name: "Borealis Supply", ordersCount: 1 },
      { id: CYGNUS, name: "Cygnus Ltd", ordersCount: 0 },
    ]),
  );
  admin.setFixture(
    "CompanyOrdersForLedger",
    companyOrdersByGid({
      [ACME]: {
        name: "Acme Industrial",
        orders: [ACME_OPEN_PAST_DUE, ACME_OPEN_FUTURE, ACME_SETTLED],
      },
      [BOREALIS]: { name: "Borealis Supply", orders: [BOREALIS_OPEN] },
      [CYGNUS]: { name: "Cygnus Ltd", orders: [] },
    }),
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

async function exposureOf(companyGid: string, shop = SHOP) {
  const company = await prisma.company.findUnique({
    where: { shop_companyGid: { shop, companyGid } },
  });
  return company?.exposure.toFixed(4) ?? null;
}

async function tableCounts(shop = SHOP) {
  return {
    companies: await prisma.company.count({ where: { shop } }),
    orders: await prisma.ledgerOrder.count({ where: { shop } }),
    schedules: await prisma.ledgerSchedule.count({ where: { shop } }),
  };
}

/** Put a shop into the state an interrupted run leaves behind. */
async function seedRunningBackfill(startedAt: Date, { shop = SHOP } = {}) {
  await prisma.syncCursor.create({
    data: {
      shop,
      key: BACKFILL_CURSOR_KEY,
      value: JSON.stringify({
        status: "running",
        operationGid: null,
        startedAt: startedAt.toISOString(),
        polledAt: null,
        completedAt: null,
        error: null,
        orderCount: 0,
        scheduleCount: 0,
        companyCount: 0,
      }),
    },
  });
}

beforeEach(async () => {
  await wipe(SHOP, OTHER_SHOP);
  admin = createMockAdmin();
  getAdminContext.mockReset();
  getAdminContext.mockResolvedValue(admin);
  authenticateAdmin.mockReset();
  authenticateAdmin.mockResolvedValue({ session: { shop: SHOP } });
});

afterAll(async () => {
  await wipe(SHOP, OTHER_SHOP);
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ *
 * Task 1 — the tracer: company enumeration to exact exposures
 * ------------------------------------------------------------------ */

describe("startBackfill — company-driven ingest (LEDG-01, D-06)", () => {
  it("ingests every company's orders — settled included — and lands exact exposures", async () => {
    seedTracerShop();

    const outcome = await startBackfill(SHOP, NOW);
    await awaitBackfillIdle();

    expect(outcome).toEqual({ started: true, reason: "started" });

    // 1250.50 (#1001) + 400.25 (#1002); #1003 is settled and contributes zero.
    expect(await exposureOf(ACME)).toBe("1650.7500");
    expect(await exposureOf(BOREALIS)).toBe("75.0000");
    // A company with no orders exists at zero, not not-at-all.
    expect(await exposureOf(CYGNUS)).toBe("0.0000");

    expect(await tableCounts()).toEqual({
      companies: 3,
      orders: 4,
      schedules: 4,
    });

    // The settled order landed too: the pull carries no financial-status
    // narrowing and no age window (D-06), which is what makes the local
    // per-company count reconcilable against Company.ordersCount in 02-08.
    const settled = await prisma.ledgerOrder.findUnique({
      where: {
        shop_orderGid: { shop: SHOP, orderGid: "gid://shopify/Order/1003" },
      },
    });
    expect(settled).not.toBeNull();
    expect(settled!.financialStatus).toBe("PAID");

    // Local count(companyId=Acme) == the enumeration's ordersCount for Acme.
    const acme = await prisma.company.findUnique({
      where: { shop_companyGid: { shop: SHOP, companyGid: ACME } },
    });
    expect(
      await prisma.ledgerOrder.count({
        where: { shop: SHOP, companyId: acme!.id },
      }),
    ).toBe(3);
  });

  it("attributes every ingested order ATTRIBUTED — appearance on the edge IS the evidence", async () => {
    seedTracerShop();

    await startBackfill(SHOP, NOW);
    await awaitBackfillIdle();

    const orders = await prisma.ledgerOrder.findMany({
      where: { shop: SHOP },
      include: { company: true },
    });
    expect(orders).toHaveLength(4);
    for (const order of orders) {
      expect(order.attributionStatus).toBe("ATTRIBUTED");
      expect(order.company).not.toBeNull();
    }

    const byGid = new Map(orders.map((o) => [o.orderGid, o]));
    expect(byGid.get("gid://shopify/Order/1001")!.company!.companyGid).toBe(ACME);
    expect(byGid.get("gid://shopify/Order/2001")!.company!.companyGid).toBe(
      BOREALIS,
    );
  });

  it("flips overdue strictly past dueAt (D-04) and records earliestDueAt", async () => {
    seedTracerShop();

    await startBackfill(SHOP, NOW);
    await awaitBackfillIdle();

    // NOW (2026-09-15) is past schedule 8001's 2026-08-31 — overdue, straight
    // out of the backfill recompute.
    const acme = await prisma.company.findUnique({
      where: { shop_companyGid: { shop: SHOP, companyGid: ACME } },
    });
    expect(acme!.overdue).toBe(true);
    expect(acme!.earliestDueAt?.toISOString()).toBe("2026-08-31T00:00:00.000Z");

    const borealis = await prisma.company.findUnique({
      where: { shop_companyGid: { shop: SHOP, companyGid: BOREALIS } },
    });
    expect(borealis!.overdue).toBe(false);
    expect(borealis!.earliestDueAt?.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );

    // "We checked and it is zero", not "we never looked".
    const cygnus = await prisma.company.findUnique({
      where: { shop_companyGid: { shop: SHOP, companyGid: CYGNUS } },
    });
    expect(cygnus!.overdue).toBe(false);
    expect(cygnus!.recomputedAt).toBeInstanceOf(Date);
  });

  it("seeds the reconciliation cursor five minutes before the newest source timestamp", async () => {
    seedTracerShop();

    await startBackfill(SHOP, NOW);
    await awaitBackfillIdle();

    // Max fixture updatedAt is #1002's 2026-08-10T04:00:00Z; 02-04's sweep
    // starts five minutes earlier so clock skew cannot open a gap.
    const cursor = await prisma.syncCursor.findUnique({
      where: { shop_key: { shop: SHOP, key: RECONCILIATION_CURSOR_KEY } },
    });
    expect(cursor!.value).toBe("2026-08-10T03:55:00.000Z");
  });

  it("writes a completed state with true counts and a null operationGid", async () => {
    seedTracerShop();

    await startBackfill(SHOP, NOW);
    await awaitBackfillIdle();

    const state = await readBackfillState(SHOP);
    expect(state).toMatchObject({
      status: "completed",
      operationGid: null,
      error: null,
      orderCount: 4,
      scheduleCount: 4,
      companyCount: 3,
    });
    expect(state!.completedAt).not.toBeNull();
  });

  it("does not rerun a completed backfill: repeat start makes zero admin calls", async () => {
    seedTracerShop();
    await startBackfill(SHOP, NOW);
    await awaitBackfillIdle();

    admin.reset();
    const second = await startBackfill(SHOP, NOW);
    await awaitBackfillIdle();

    expect(second).toEqual({ started: false, reason: "already-completed" });
    expect(admin.callCount()).toBe(0);
    expect((await readBackfillState(SHOP))!.status).toBe("completed");
  });

  it("never reaches into another shop's ledger", async () => {
    seedTracerShop();

    await startBackfill(SHOP, NOW);
    await awaitBackfillIdle();

    expect(await tableCounts(OTHER_SHOP)).toEqual({
      companies: 0,
      orders: 0,
      schedules: 0,
    });
  });

  it("pages the company list, threading the cursor page one returned", async () => {
    admin.setFixture("CompaniesForLedger", [
      companiesPage(
        [
          { id: ACME, name: "Acme Industrial", ordersCount: 3 },
          { id: BOREALIS, name: "Borealis Supply", ordersCount: 1 },
        ],
        { hasNextPage: true, endCursor: "companies-cursor-1" },
      ),
      companiesPage([{ id: CYGNUS, name: "Cygnus Ltd", ordersCount: 0 }]),
    ]);
    admin.setFixture(
      "CompanyOrdersForLedger",
      companyOrdersByGid({
        [ACME]: {
          name: "Acme Industrial",
          orders: [ACME_OPEN_PAST_DUE, ACME_OPEN_FUTURE, ACME_SETTLED],
        },
        [BOREALIS]: { name: "Borealis Supply", orders: [BOREALIS_OPEN] },
        [CYGNUS]: { name: "Cygnus Ltd", orders: [] },
      }),
    );

    await startBackfill(SHOP, NOW);
    await awaitBackfillIdle();

    // Page two must ask for what page one said came next, or the traversal
    // silently loops on page one forever.
    expect(admin.callCount("CompaniesForLedger")).toBe(2);
    expect(admin.callsFor("CompaniesForLedger")[0].variables).toEqual({
      first: 250,
      after: null,
    });
    expect(admin.callsFor("CompaniesForLedger")[1].variables).toEqual({
      first: 250,
      after: "companies-cursor-1",
    });

    expect((await tableCounts()).companies).toBe(3);
    expect(await exposureOf(CYGNUS)).toBe("0.0000");
  });

  it("pages a company's orders edge, threading the cursor between pages", async () => {
    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([{ id: ACME, name: "Acme Industrial", ordersCount: 2 }]),
    );
    admin.setFixture("CompanyOrdersForLedger", (variables: Record<string, unknown>) =>
      variables.after == null
        ? makeCompanyOrdersResponse({
            companyGid: ACME,
            companyName: "Acme Industrial",
            orders: [ACME_OPEN_PAST_DUE],
            hasNextPage: true,
            endCursor: "orders-cursor-1",
          })
        : makeCompanyOrdersResponse({
            companyGid: ACME,
            companyName: "Acme Industrial",
            orders: [ACME_OPEN_FUTURE],
          }),
    );

    await startBackfill(SHOP, NOW);
    await awaitBackfillIdle();

    expect(admin.callCount("CompanyOrdersForLedger")).toBe(2);
    expect(admin.callsFor("CompanyOrdersForLedger")[1].variables).toMatchObject({
      id: ACME,
      after: "orders-cursor-1",
    });

    // Both pages landed in one exposure.
    expect(await exposureOf(ACME)).toBe("1650.7500");
    expect((await tableCounts()).orders).toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * Install trigger (app layout loader)
 * ------------------------------------------------------------------ */

describe("install trigger (app layout loader)", () => {
  async function runLoader() {
    const { loader } = await import("../app/routes/app");
    return loader({
      request: new Request(`${APP_URL}/app`),
      params: {},
      context: {},
    } as never);
  }

  it("runs exactly one backfill across repeated admin loads", async () => {
    seedTracerShop();

    await runLoader();
    await runLoader();
    await awaitBackfillIdle();

    // The claim is a unique-constraint INSERT, so repeat (and concurrent)
    // loads cannot start a second enumeration — T-02-14.
    expect(admin.callCount("CompaniesForLedger")).toBe(1);

    const state = await readBackfillState(SHOP);
    expect(state!.status).toBe("completed");
    expect(state!.orderCount).toBe(4);
  });

  it("renders without waiting for the backfill", async () => {
    seedTracerShop();

    // The loader returns the shell payload; the ingest is fire-and-forget.
    const data = await runLoader();
    expect(data).toEqual({ apiKey: "test-api-key" });

    await awaitBackfillIdle();
    expect((await readBackfillState(SHOP))!.status).toBe("completed");
  });

  it("does not restart a completed backfill", async () => {
    seedTracerShop();
    await startBackfill(SHOP, NOW);
    await awaitBackfillIdle();

    admin.reset();
    await runLoader();
    await awaitBackfillIdle();

    expect(admin.callCount()).toBe(0);
    expect((await readBackfillState(SHOP))!.status).toBe("completed");
  });
});

/* ------------------------------------------------------------------ *
 * bulk_operations/finish — the topic stays registered, the route stays safe
 * ------------------------------------------------------------------ */

describe("bulk_operations/finish webhook", () => {
  const ENDPOINT = `${APP_URL}/webhooks/bulk-operations`;

  async function finishAction(request: Request): Promise<Response> {
    const { action } = await import("../app/routes/webhooks.bulk-operations");
    try {
      return await action({ request, params: {}, context: {} } as never);
    } catch (thrown) {
      if (thrown instanceof Response) return thrown;
      throw thrown;
    }
  }

  function finishPayload(overrides: Record<string, unknown> = {}) {
    return {
      admin_graphql_api_id: "gid://shopify/BulkOperation/7001",
      completed_at: "2026-08-19T00:00:00Z",
      status: "completed",
      type: "query",
      // A doorbell must never be believed. If any code ever fetches this, the
      // app has an SSRF hole pointed at the cloud metadata service.
      url: "http://169.254.169.254/latest/meta-data/",
      ...overrides,
    };
  }

  function delivery(
    payload: Record<string, unknown> = finishPayload(),
    webhookId = "bulk-finish-1",
    shop = SHOP,
  ) {
    return signedWebhookRequest(
      ENDPOINT,
      "bulk_operations/finish",
      shop,
      payload,
      undefined,
      { webhookId },
    );
  }

  it("acks a signed delivery with 200 and writes nothing to the ledger", async () => {
    const response = await finishAction(delivery());

    expect(response.status).toBe(200);
    // The route is a no-op doorbell: no admin call, no ledger write, no
    // backfill state minted.
    expect(admin.callCount()).toBe(0);
    expect(await tableCounts()).toEqual({
      companies: 0,
      orders: 0,
      schedules: 0,
    });
    expect(await readBackfillState(SHOP)).toBeNull();
  });

  it("ignores a delivery even while a run is in progress — zero admin calls, state untouched", async () => {
    await seedRunningBackfill(NOW);
    // Fixtures ARE registered; a route that still advanced the old bulk flow
    // would show up here as admin calls. The neutered route makes none.
    seedTracerShop();

    const response = await finishAction(
      delivery(finishPayload(), "bulk-finish-while-running"),
    );

    expect(response.status).toBe(200);
    expect(admin.callCount()).toBe(0);
    expect((await readBackfillState(SHOP))!.status).toBe("running");
    expect(await tableCounts()).toEqual({
      companies: 0,
      orders: 0,
      schedules: 0,
    });
  });

  it("processes a duplicate delivery exactly once and still acks 200", async () => {
    const first = await finishAction(delivery());
    const second = await finishAction(delivery());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await prisma.webhookReceipt.count({ where: { shop: SHOP } })).toBe(1);
  });

  it("answers 401 to a forged signature and writes nothing (T-02-12)", async () => {
    const response = await finishAction(
      forgedWebhookRequest(
        ENDPOINT,
        "bulk_operations/finish",
        SHOP,
        finishPayload(),
      ),
    );

    expect(response.status).toBe(401);
    expect(admin.callCount()).toBe(0);
    expect(await prisma.webhookReceipt.count({ where: { shop: SHOP } })).toBe(0);
    expect(await tableCounts()).toEqual({
      companies: 0,
      orders: 0,
      schedules: 0,
    });
  });

  it("holds no fetch call in its source — the SSRF surface is gone", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../app/routes/webhooks.bulk-operations.tsx", import.meta.url),
      "utf8",
    );

    // The route is a doorbell handler. Any fetch here would be the SSRF bug.
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).toContain("authenticate.webhook");
  });
});

/* ------------------------------------------------------------------ *
 * Task 2 — edges: resilience properties re-proven at the company shape
 * ------------------------------------------------------------------ */

/** The exact live ACCESS_DENIED shape, through the company orders edge. */
function accessDeniedCompanyOrders() {
  return {
    data: { company: null },
    errors: [
      {
        message: "Access denied for orders field.",
        path: ["company", "orders"],
        extensions: {
          code: "ACCESS_DENIED",
          requiredAccess: "read_customers access scope",
        },
      },
    ],
  };
}

/**
 * Every meaningful column of the shop's ledger, sorted by gid.
 *
 * Row ids, and the timestamps that record WHEN the app looked (`refetchedAt`,
 * `recomputedAt`, `createdAt`, `updatedAt`), are deliberately projected away:
 * they differ between any two runs by construction, and leaving them in would
 * make the comparisons below vacuous. Sorting by gid rather than trusting the
 * database's return order is the other half: an unsorted comparison can pass
 * while the ingest is order-dependent.
 */
async function ledgerSnapshot(shop = SHOP) {
  const companies = await prisma.company.findMany({ where: { shop } });
  const orders = await prisma.ledgerOrder.findMany({
    where: { shop },
    include: { company: true, schedules: true },
  });
  const cursors = await prisma.syncCursor.findMany({ where: { shop } });

  const backfill = cursors.find((row) => row.key === BACKFILL_CURSOR_KEY);
  const parsedBackfill = backfill
    ? (JSON.parse(backfill.value) as Record<string, unknown>)
    : null;

  return {
    companies: companies
      .map((company) => ({
        companyGid: company.companyGid,
        name: company.name,
        exposure: company.exposure.toFixed(4),
        overdue: company.overdue,
        earliestDueAt: company.earliestDueAt?.toISOString() ?? null,
      }))
      .sort((a, b) => a.companyGid.localeCompare(b.companyGid)),

    orders: orders
      .map((order) => ({
        orderGid: order.orderGid,
        name: order.name,
        companyGid: order.company?.companyGid ?? null,
        companyLocationGid: order.companyLocationGid,
        attributionStatus: order.attributionStatus,
        hasPaymentTerms: order.hasPaymentTerms,
        paymentTermsType: order.paymentTermsType,
        financialStatus: order.financialStatus,
        cancelledAt: order.cancelledAt?.toISOString() ?? null,
        outstandingShop: order.outstandingShop.toFixed(4),
        currencyCode: order.currencyCode,
        sourceUpdatedAt: order.sourceUpdatedAt.toISOString(),
        schedules: order.schedules
          .map((schedule) => ({
            scheduleGid: schedule.scheduleGid,
            dueAt: schedule.dueAt?.toISOString() ?? null,
            completedAt: schedule.completedAt?.toISOString() ?? null,
          }))
          .sort((a, b) => a.scheduleGid.localeCompare(b.scheduleGid)),
      }))
      .sort((a, b) => a.orderGid.localeCompare(b.orderGid)),

    reconciliationCursor:
      cursors.find((row) => row.key === RECONCILIATION_CURSOR_KEY)?.value ??
      null,

    backfill: parsedBackfill && {
      status: parsedBackfill.status,
      orderCount: parsedBackfill.orderCount,
      scheduleCount: parsedBackfill.scheduleCount,
      companyCount: parsedBackfill.companyCount,
    },

    // The two remaining shop-keyed ledger tables plus the global lease: the
    // backfill must not write to any of them.
    receipts: await prisma.webhookReceipt.count({ where: { shop } }),
    leases: await prisma.sweepLease.count(),
  };
}

describe("exported surface for 02-08", () => {
  it("enumerateCompanies reports gid, name and Shopify's own ordersCount", async () => {
    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([
        { id: ACME, name: "Acme Industrial", ordersCount: 3 },
        { id: BOREALIS, name: "Borealis Supply", ordersCount: 1 },
      ]),
    );

    await expect(enumerateCompanies(SHOP)).resolves.toEqual([
      { companyGid: ACME, name: "Acme Industrial", ordersCount: 3 },
      { companyGid: BOREALIS, name: "Borealis Supply", ordersCount: 1 },
    ]);
  });

  it("ingestCompanyOrders lands ATTRIBUTED rows and reports true counts — recompute stays the caller's job", async () => {
    admin.setFixture(
      "CompanyOrdersForLedger",
      companyOrdersByGid({
        [ACME]: {
          name: "Acme Industrial",
          orders: [ACME_OPEN_PAST_DUE, ACME_OPEN_FUTURE, ACME_SETTLED],
        },
      }),
    );

    const result = await ingestCompanyOrders(SHOP, ACME);

    expect(result.orders).toBe(3);
    expect(result.schedules).toBe(3);
    expect(result.maxSourceUpdatedAt).toEqual(
      new Date("2026-08-10T04:00:00.000Z"),
    );

    const rows = await prisma.ledgerOrder.findMany({
      where: { shop: SHOP },
      include: { company: true },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.attributionStatus).toBe("ATTRIBUTED");
      expect(row.company!.companyGid).toBe(ACME);
    }
    // The company head's name came from the CompanyOrdersForLedger response.
    expect(rows[0].company!.name).toBe("Acme Industrial");

    // ONE recompute path: the ingest itself never writes exposure — the
    // caller recomputes, exactly as runCompanyBackfill does.
    expect(await exposureOf(ACME)).toBe("0.0000");
  });
});

describe("backfill edges (LEDG-01)", () => {
  it("completes cleanly on a shop with no companies at all", async () => {
    admin.setFixture("CompaniesForLedger", companiesPage([]));

    const outcome = await startBackfill(SHOP, NOW);

    expect(outcome).toEqual({ started: true, reason: "started" });

    const state = await readBackfillState(SHOP);
    expect(state).toMatchObject({
      status: "completed",
      operationGid: null,
      error: null,
      orderCount: 0,
      scheduleCount: 0,
      companyCount: 0,
    });

    // Zero balances recorded, not zero work done: every ledger table is empty
    // and the run is finished rather than stuck pending.
    expect(await tableCounts()).toEqual({
      companies: 0,
      orders: 0,
      schedules: 0,
    });

    // 02-04's sweep still has somewhere to start: an empty shop anchors the
    // cursor on the injected clock, minus the deliberate five-minute overlap.
    const cursor = await prisma.syncCursor.findUnique({
      where: { shop_key: { shop: SHOP, key: RECONCILIATION_CURSOR_KEY } },
    });
    expect(cursor!.value).toBe("2026-09-14T23:55:00.000Z");
  });

  it("is deterministic on replay: running the ingest twice yields identical state", async () => {
    seedTracerShop();
    await runCompanyBackfill(SHOP, NOW);
    const first = await ledgerSnapshot();

    await runCompanyBackfill(SHOP, NOW);
    const second = await ledgerSnapshot();

    // Upserts keyed by gid plus wholesale schedule replacement: a re-run
    // converges instead of doubling exposure.
    expect(second).toEqual(first);
    expect(await tableCounts()).toEqual({
      companies: 3,
      orders: 4,
      schedules: 4,
    });
  });

  it("re-runs over a partially ingested ledger and converges on the clean-run state", async () => {
    // A run that died after Acme: only one company enumerated, one ingested.
    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([{ id: ACME, name: "Acme Industrial", ordersCount: 3 }]),
    );
    admin.setFixture(
      "CompanyOrdersForLedger",
      companyOrdersByGid({
        [ACME]: {
          name: "Acme Industrial",
          orders: [ACME_OPEN_PAST_DUE, ACME_OPEN_FUTURE, ACME_SETTLED],
        },
      }),
    );
    await runCompanyBackfill(SHOP, NOW);
    expect((await tableCounts()).orders).toBe(3);

    // Partial truth is still truth — Acme reads right from what landed.
    expect(await exposureOf(ACME)).toBe("1650.7500");

    // The self-heal re-run sees the whole shop.
    seedTracerShop();
    await runCompanyBackfill(SHOP, NOW);
    const afterRecovery = await ledgerSnapshot();

    // Re-running from scratch lands exactly where the recovery did.
    await wipe(SHOP);
    seedTracerShop();
    await runCompanyBackfill(SHOP, NOW);
    expect(afterRecovery).toEqual(await ledgerSnapshot());
  });

  it("marks the run failed when one company's orders pull is denied — the label names itself", async () => {
    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([
        { id: ACME, name: "Acme Industrial", ordersCount: 3 },
        { id: BOREALIS, name: "Borealis Supply", ordersCount: 1 },
        { id: CYGNUS, name: "Cygnus Ltd", ordersCount: 0 },
      ]),
    );
    const healthy = companyOrdersByGid({
      [ACME]: {
        name: "Acme Industrial",
        orders: [ACME_OPEN_PAST_DUE, ACME_OPEN_FUTURE, ACME_SETTLED],
      },
      [BOREALIS]: { name: "Borealis Supply", orders: [BOREALIS_OPEN] },
      [CYGNUS]: { name: "Cygnus Ltd", orders: [] },
    });
    // Company 2 of 3 answers the live ACCESS_DENIED shape.
    admin.setFixture(
      "CompanyOrdersForLedger",
      (variables: Record<string, unknown>) =>
        String(variables.id) === BOREALIS
          ? accessDeniedCompanyOrders()
          : healthy(variables),
    );

    const outcome = await startBackfill(SHOP, NOW);

    expect(outcome).toEqual({ started: false, reason: "run-failed" });

    // graphqlJson's loud-failure contract, observed end-to-end: the state
    // names the query label, the code and the missing scope.
    const state = await readBackfillState(SHOP);
    expect(state!.status).toBe("failed");
    expect(state!.error).toContain("CompanyOrdersForLedger");
    expect(state!.error).toContain("ACCESS_DENIED");
    expect(state!.error).toContain("read_customers access scope");

    // Company 1's ingest survived — partial truth, converged on the re-run.
    expect((await tableCounts()).orders).toBe(3);
  });

  it("serialises a failed state with status as the FIRST key — the re-claim substring depends on it", async () => {
    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([{ id: ACME, name: "Acme Industrial", ordersCount: 1 }]),
    );
    admin.setFixture("CompanyOrdersForLedger", accessDeniedCompanyOrders());

    await startBackfill(SHOP, NOW);

    const row = await prisma.syncCursor.findUnique({
      where: { shop_key: { shop: SHOP, key: BACKFILL_CURSOR_KEY } },
    });
    expect(row!.value.startsWith('{"status":"failed"')).toBe(true);
  });

  it("re-claims a failed run on the next load and completes without duplicating rows", async () => {
    let denyBorealis = true;
    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([
        { id: ACME, name: "Acme Industrial", ordersCount: 3 },
        { id: BOREALIS, name: "Borealis Supply", ordersCount: 1 },
        { id: CYGNUS, name: "Cygnus Ltd", ordersCount: 0 },
      ]),
    );
    const healthy = companyOrdersByGid({
      [ACME]: {
        name: "Acme Industrial",
        orders: [ACME_OPEN_PAST_DUE, ACME_OPEN_FUTURE, ACME_SETTLED],
      },
      [BOREALIS]: { name: "Borealis Supply", orders: [BOREALIS_OPEN] },
      [CYGNUS]: { name: "Cygnus Ltd", orders: [] },
    });
    admin.setFixture(
      "CompanyOrdersForLedger",
      (variables: Record<string, unknown>) =>
        String(variables.id) === BOREALIS && denyBorealis
          ? accessDeniedCompanyOrders()
          : healthy(variables),
    );

    const first = await startBackfill(SHOP, NOW);
    expect(first).toEqual({ started: false, reason: "run-failed" });

    // The transient denial clears; the next admin load re-claims and finishes.
    denyBorealis = false;
    const second = await startBackfill(SHOP, NOW);
    expect(second).toEqual({ started: true, reason: "started" });

    expect((await readBackfillState(SHOP))!.status).toBe("completed");
    expect(await tableCounts()).toEqual({
      companies: 3,
      orders: 4,
      schedules: 4,
    });
    expect(await exposureOf(ACME)).toBe("1650.7500");
    expect(await exposureOf(BOREALIS)).toBe("75.0000");
  });

  it("exactly one of two concurrent startBackfill calls claims the run (T-02-14)", async () => {
    seedTracerShop();

    const [first, second] = await Promise.all([
      startBackfill(SHOP, NOW),
      startBackfill(SHOP, NOW),
    ]);
    await awaitBackfillIdle();

    // The DATABASE is the lock: the [shop, key] unique constraint lets
    // exactly one INSERT win.
    expect([first.reason, second.reason].sort()).toEqual([
      "already-running",
      "started",
    ]);
    expect([first.started, second.started].filter(Boolean)).toHaveLength(1);

    expect(admin.callCount("CompaniesForLedger")).toBe(1);
    expect((await readBackfillState(SHOP))!.status).toBe("completed");
    expect(await tableCounts()).toEqual({
      companies: 3,
      orders: 4,
      schedules: 4,
    });
  });
});

describe("stale-poll self-heal — a died run cannot strand the install", () => {
  it("re-runs a stale running backfill to completion", async () => {
    await seedRunningBackfill(new Date(NOW.getTime() - STALE_AFTER_MS - 1000));
    seedTracerShop();

    await pollBackfillIfStale(SHOP, NOW);

    expect((await readBackfillState(SHOP))!.status).toBe("completed");
    expect(await exposureOf(ACME)).toBe("1650.7500");
    expect(await exposureOf(BOREALIS)).toBe("75.0000");
  });

  it("leaves a freshly started run alone", async () => {
    await seedRunningBackfill(new Date(NOW.getTime() - 60_000));
    seedTracerShop();

    await pollBackfillIfStale(SHOP, NOW);

    // Nothing stale yet — polling every load would be pointless chatter.
    expect(admin.callCount()).toBe(0);
    expect((await readBackfillState(SHOP))!.status).toBe("running");
  });

  it("leaves the run running on a transient failure so the next load retries", async () => {
    await seedRunningBackfill(new Date(NOW.getTime() - STALE_AFTER_MS - 1000));
    admin.setFixture("CompaniesForLedger", accessDeniedCompanyOrders());

    await pollBackfillIfStale(SHOP, NOW);

    const state = await readBackfillState(SHOP);
    expect(state!.status).toBe("running");
    // The touch was stamped, so retries wait out the staleness window rather
    // than hammering on every load.
    expect(state!.polledAt).not.toBeNull();
  });
});

describe("page-cap guards — pathological pagination throws, never spins", () => {
  it("fails the run when the companies pager never terminates", async () => {
    // A hostile or malformed response that always advertises another page.
    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([{ id: ACME, name: "Acme Industrial", ordersCount: 1 }], {
        hasNextPage: true,
        endCursor: "same-cursor-forever",
      }),
    );

    const outcome = await startBackfill(SHOP, NOW);

    expect(outcome).toEqual({ started: false, reason: "run-failed" });
    const state = await readBackfillState(SHOP);
    expect(state!.status).toBe("failed");
    expect(state!.error).toMatch(/CompaniesForLedger exceeded \d+ pages/);
  });

  it("fails the run when one company's orders pager never terminates", async () => {
    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([{ id: ACME, name: "Acme Industrial", ordersCount: 1 }]),
    );
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        companyGid: ACME,
        companyName: "Acme Industrial",
        orders: [ACME_OPEN_PAST_DUE],
        hasNextPage: true,
        endCursor: "orders-cursor-forever",
      }),
    );

    const outcome = await startBackfill(SHOP, NOW);

    expect(outcome).toEqual({ started: false, reason: "run-failed" });
    const state = await readBackfillState(SHOP);
    expect(state!.status).toBe("failed");
    expect(state!.error).toMatch(/CompanyOrdersForLedger exceeded \d+ pages/);
  });
});

describe("BackfillState — the frozen production contract", () => {
  it("degrades a corrupt cursor value to a failed state instead of wedging", async () => {
    await prisma.syncCursor.create({
      data: { shop: SHOP, key: BACKFILL_CURSOR_KEY, value: "not json {" },
    });

    const state = await readBackfillState(SHOP);

    expect(state!.status).toBe("failed");
    expect(state!.error).toBe("unparseable backfill cursor value");
  });

  it("serialises EXACTLY the nine documented keys, status first (prod-ledger-state contract)", async () => {
    seedTracerShop();
    await startBackfill(SHOP, NOW);
    await awaitBackfillIdle();

    const row = await prisma.syncCursor.findUnique({
      where: { shop_key: { shop: SHOP, key: BACKFILL_CURSOR_KEY } },
    });
    const parsed = JSON.parse(row!.value) as Record<string, unknown>;

    // scripts/prod-ledger-state.mjs § parseBackfill reads this shape in
    // production, and the failed-run re-claim matches on the
    // '"status":"failed"' substring — both depend on these keys in this
    // order. operationGid stays a key and is now always null.
    expect(Object.keys(parsed)).toEqual([
      "status",
      "operationGid",
      "startedAt",
      "polledAt",
      "completedAt",
      "error",
      "orderCount",
      "scheduleCount",
      "companyCount",
    ]);
    expect(Object.keys(parsed)[0]).toBe("status");
    expect(parsed.operationGid).toBeNull();
  });
});
