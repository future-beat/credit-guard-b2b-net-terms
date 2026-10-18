import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import {
  LedgerGraphqlError,
  ingestOrderEvent,
  type OrderForLedgerNode,
} from "../app/services/ledger.server";
import {
  OPEN_ORDER_STATUS_FILTER,
  RECONCILIATION_CURSOR_KEY,
  reconcileShop,
  runAttributionHealSweep,
  runReconciliationSweep,
} from "../app/services/reconciliation.server";
import {
  createMockAdmin,
  type MockAdminClient,
} from "./helpers/admin-client-mock";
import {
  makeCompanyOrdersResponse,
  makeOrderForLedger,
} from "./fixtures/order-fixtures";

/**
 * LEDG-04 — the daily source-of-truth reconciliation, the universal absorber for
 * every missed, coalesced, reordered or never-delivered webhook.
 *
 * The tests that matter here are the ones that prove the ledger HEALS: a
 * deliberately corrupted exposure is corrected inside one run, and an order that
 * vanished at the source with no webhook is still noticed. Everything else
 * (paging, cursor arithmetic) exists to make sure those two can never be skipped.
 *
 * `getAdminContext` is the only mocked seam (02-01's Wave 2 contract), so all
 * ledger persistence runs for real against `creditguard_test`. Sentry is stubbed
 * so the drift alert is assertable without a network SDK.
 */
const captureMessage = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());

vi.mock("@sentry/react-router", () => ({ captureMessage, captureException }));

const getAdminContext = vi.hoisted(() => vi.fn());

vi.mock("../app/services/admin-client.server", () => ({ getAdminContext }));

const SHOP = "recon-test.myshopify.com";
const OTHER_SHOP = "recon-bystander.myshopify.com";
const SHOPS = [SHOP, OTHER_SHOP];

const COMPANY_GID = "gid://shopify/Company/7001";
const ORDER_GID = "gid://shopify/Order/8001";
const SECOND_ORDER_GID = "gid://shopify/Order/8002";

/** Evaluation instant for every reconcile in this file. */
const NOW = new Date("2026-09-02T00:00:00.000Z");
/** The newest `Order.updatedAt` the fixtures report. */
const SOURCE_UPDATED_AT = "2026-09-01T10:00:00.000Z";
/** Five minutes of clock-skew overlap behind it. */
const EXPECTED_CURSOR = new Date("2026-09-01T09:55:00.000Z");
const DUE_AT = new Date("2026-08-31T00:00:00.000Z");

let admin: MockAdminClient;

async function wipe() {
  await prisma.ledgerSchedule.deleteMany({ where: { shop: { in: SHOPS } } });
  await prisma.ledgerOrder.deleteMany({ where: { shop: { in: SHOPS } } });
  await prisma.company.deleteMany({ where: { shop: { in: SHOPS } } });
  await prisma.syncCursor.deleteMany({ where: { shop: { in: SHOPS } } });
  await prisma.shop.deleteMany({ where: { domain: { in: SHOPS } } });
}

/** An `OrdersUpdatedSince` / `OpenOrderIdsProbe` connection page. */
function ordersPage(
  nodes: unknown[],
  { hasNextPage = false, endCursor = null as string | null } = {},
) {
  return {
    data: {
      orders: {
        pageInfo: { hasNextPage, endCursor },
        edges: nodes.map((node) => ({ node })),
      },
    },
  };
}

function probePage(gids: string[]) {
  return ordersPage(gids.map((id) => ({ id })));
}

function throttledResponse() {
  return {
    errors: [
      {
        message: "Throttled",
        extensions: { code: "THROTTLED" },
      },
    ],
  };
}

/** A non-throttle GraphQL failure — the loud partial-sweep contract's case. */
function accessDeniedResponse() {
  return {
    data: null,
    errors: [
      {
        message: "Access denied for orders field.",
        extensions: {
          code: "ACCESS_DENIED",
          requiredAccess: "read_customers access scope",
        },
      },
    ],
  };
}

/** One CompaniesForLedger page, `ordersCount` selected as `{ count }`. */
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

/**
 * Let the wall clock advance past a just-written `refetchedAt` so the
 * exhaustion flip's strictly-before predicate cannot flake on a same-
 * millisecond seed.
 */
const settle = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One order as the source reports it. The schedule gid is derived from the
 * order gid because `LedgerSchedule` is unique on `(shop, scheduleGid)` — real
 * Shopify schedules are never shared between orders, and a fixture that shares
 * one would fail for a reason that has nothing to do with reconciliation.
 */
function orderNode(overrides: { id?: string; [key: string]: unknown } = {}) {
  const id = overrides.id ?? ORDER_GID;

  const node = makeOrderForLedger({
    id,
    updatedAt: SOURCE_UPDATED_AT,
    schedules: [
      {
        id: `gid://shopify/PaymentSchedule/${id.split("/").pop()}`,
        dueAt: DUE_AT.toISOString(),
      },
    ],
    ...overrides,
  });

  // The reduced OrdersUpdatedSince selection carries NO attribution field
  // (02-08): which company an order belongs to is decided exclusively by the
  // authenticated company→orders edge in the attribution pass.
  return node;
}

interface LocalOrderSeed {
  shop?: string;
  orderGid?: string;
  outstanding?: string;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
}

/**
 * A company plus one open net-terms order, already in the ledger. `exposure` is
 * set explicitly so a test can seed a WRONG stored balance and prove the sweep
 * corrects it.
 */
async function seedLocal(
  storedExposure: string,
  recomputedAt: Date | null,
  order: LocalOrderSeed = {},
) {
  const shop = order.shop ?? SHOP;
  await prisma.shop.upsert({
    where: { domain: shop },
    update: { active: true },
    create: { domain: shop, active: true },
  });

  const company = await prisma.company.upsert({
    where: { shop_companyGid: { shop, companyGid: COMPANY_GID } },
    update: { exposure: storedExposure, recomputedAt },
    create: {
      shop,
      companyGid: COMPANY_GID,
      name: "Acme Industrial Supply",
      exposure: storedExposure,
      recomputedAt,
    },
  });

  const orderGid = order.orderGid ?? ORDER_GID;
  const row = await prisma.ledgerOrder.upsert({
    where: { shop_orderGid: { shop, orderGid } },
    update: {},
    create: {
      shop,
      orderGid,
      name: "#1042",
      companyId: company.id,
      attributionStatus: "ATTRIBUTED",
      hasPaymentTerms: true,
      paymentTermsType: "NET",
      financialStatus: "PENDING",
      cancelledAt: order.cancelledAt ?? null,
      outstandingShop: order.outstanding ?? "500.0000",
      currencyCode: "USD",
      sourceUpdatedAt: new Date(SOURCE_UPDATED_AT),
      refetchedAt: new Date(SOURCE_UPDATED_AT),
    },
  });

  await prisma.ledgerSchedule.upsert({
    where: { shop_scheduleGid: { shop, scheduleGid: `sched-${orderGid}` } },
    update: {},
    create: {
      shop,
      scheduleGid: `sched-${orderGid}`,
      orderId: row.id,
      dueAt: DUE_AT,
      completedAt: order.completedAt ?? null,
    },
  });

  return company;
}

function companyRow(shop = SHOP) {
  return prisma.company.findUniqueOrThrow({
    where: { shop_companyGid: { shop, companyGid: COMPANY_GID } },
  });
}

function cursorRow(shop = SHOP) {
  return prisma.syncCursor.findUnique({
    where: { shop_key: { shop, key: RECONCILIATION_CURSOR_KEY } },
  });
}

beforeEach(async () => {
  await wipe();
  captureMessage.mockClear();
  captureException.mockClear();
  admin = createMockAdmin({
    OrdersUpdatedSince: ordersPage([]),
    OpenOrderIdsProbe: probePage([]),
    // The attribution pass enumerates companies every sweep; an empty shop is
    // the default, individual tests register companies where the pass matters.
    CompaniesForLedger: companiesPage([]),
  });
  getAdminContext.mockReset();
  getAdminContext.mockResolvedValue(admin);
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe("drift — the ledger heals itself within one run (LEDG-04)", () => {
  it("corrects a deliberately wrong stored exposure and warns Sentry", async () => {
    // A missed `orders/updated` left this company recorded at 999 when its one
    // open order is worth 500.
    await seedLocal("999.0000", new Date("2026-08-20T00:00:00.000Z"));
    admin.setFixture("OrdersUpdatedSince", ordersPage([orderNode()]));
    admin.setFixture("OpenOrderIdsProbe", probePage([ORDER_GID]));

    const report = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    const company = await companyRow();
    expect(company.exposure.toFixed(2)).toBe("500.00");
    expect(report.driftCorrected).toBe(1);

    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [message, level] = captureMessage.mock.calls[0];
    expect(message).toContain(SHOP);
    expect(message).toContain(COMPANY_GID);
    // Both amounts, so the alert says how far off the ledger had drifted.
    expect(message).toContain("999");
    expect(message).toContain("500");
    expect(level).toBe("warning");
  });

  it("does not warn when the stored exposure already matches", async () => {
    await seedLocal("500.0000", new Date("2026-08-20T00:00:00.000Z"));
    admin.setFixture("OrdersUpdatedSince", ordersPage([orderNode()]));
    admin.setFixture("OpenOrderIdsProbe", probePage([ORDER_GID]));

    const report = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    expect(report.driftCorrected).toBe(0);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("does not warn for a company seen for the very first time", async () => {
    // recomputedAt null = never computed, so 0 -> 500 is a first observation,
    // not drift. Warning on it would bury real alerts under install noise.
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    admin.setFixture("OrdersUpdatedSince", ordersPage([orderNode()]));
    admin.setFixture("OpenOrderIdsProbe", probePage([ORDER_GID]));
    // The new row lands UNRESOLVED off the cursor scan; the attribution pass
    // claims it on the company's edge (fixture shape — same assertions).
    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([
        { id: COMPANY_GID, name: "Acme Industrial Supply", ordersCount: 1 },
      ]),
    );
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        companyGid: COMPANY_GID,
        companyName: "Acme Industrial Supply",
        orders: [orderNode()],
      }),
    );

    const report = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    expect((await companyRow()).exposure.toFixed(2)).toBe("500.00");
    expect(report.driftCorrected).toBe(0);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("corrects drift by full recompute, never by arithmetic patching", async () => {
    // Stored 999 with an order that is actually cancelled: a patch-by-delta
    // implementation would land on some intermediate number; recompute-from-
    // source lands on exactly 0.
    await seedLocal("999.0000", new Date("2026-08-20T00:00:00.000Z"));
    admin.setFixture(
      "OrdersUpdatedSince",
      ordersPage([orderNode({ cancelledAt: "2026-09-01T09:00:00.000Z" })]),
    );
    admin.setFixture("OpenOrderIdsProbe", probePage([ORDER_GID]));

    await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    expect((await companyRow()).exposure.toFixed(2)).toBe("0.00");
  });
});

describe("cursor — clock skew must not skip an order", () => {
  it("advances to the newest sourceUpdatedAt minus a five-minute overlap", async () => {
    await seedLocal("500.0000", null);
    admin.setFixture("OrdersUpdatedSince", ordersPage([orderNode()]));
    admin.setFixture("OpenOrderIdsProbe", probePage([ORDER_GID]));

    await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    expect((await cursorRow())?.value).toBe(EXPECTED_CURSOR.toISOString());
  });

  it("leaves the cursor untouched when a page comes back empty", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    await prisma.syncCursor.create({
      data: {
        shop: SHOP,
        key: RECONCILIATION_CURSOR_KEY,
        value: EXPECTED_CURSOR.toISOString(),
      },
    });

    await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    expect((await cursorRow())?.value).toBe(EXPECTED_CURSOR.toISOString());
  });

  it("queries from the stored cursor with an updated_at filter", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    await prisma.syncCursor.create({
      data: {
        shop: SHOP,
        key: RECONCILIATION_CURSOR_KEY,
        value: EXPECTED_CURSOR.toISOString(),
      },
    });

    await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    const [call] = admin.callsFor("OrdersUpdatedSince");
    expect(call.variables.query).toContain(
      `updated_at:>=${EXPECTED_CURSOR.toISOString()}`,
    );
  });
});

describe("pagination", () => {
  it("follows hasNextPage and upserts every order across pages", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    admin.setFixture("OrdersUpdatedSince", [
      ordersPage([orderNode()], { hasNextPage: true, endCursor: "page-2" }),
      ordersPage([
        orderNode({ id: SECOND_ORDER_GID, outstanding: "250.00" }),
      ]),
    ]);
    admin.setFixture("OpenOrderIdsProbe", probePage([ORDER_GID, SECOND_ORDER_GID]));
    // Both fresh rows land UNRESOLVED; the attribution pass claims them on
    // the company's edge (fixture shape — same assertions).
    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([
        { id: COMPANY_GID, name: "Acme Industrial Supply", ordersCount: 2 },
      ]),
    );
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        companyGid: COMPANY_GID,
        companyName: "Acme Industrial Supply",
        orders: [orderNode(), orderNode({ id: SECOND_ORDER_GID, outstanding: "250.00" })],
      }),
    );

    const report = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    expect(admin.callCount("OrdersUpdatedSince")).toBe(2);
    expect(admin.callsFor("OrdersUpdatedSince")[1].variables.after).toBe("page-2");
    expect(report.ordersSeen).toBe(2);
    expect(await prisma.ledgerOrder.count({ where: { shop: SHOP } })).toBe(2);
    // 500 + 250, both open net-terms orders for the same company.
    expect((await companyRow()).exposure.toFixed(2)).toBe("750.00");
  });
});

describe("open-schedule probe — catches what emits no webhook", () => {
  it("individually refetches a locally-open order missing from the probe", async () => {
    // The order was deleted/archived at the source. `orders/delete` was never
    // delivered, and it is not in the updated-since page either, so the probe
    // gap is the only signal there is.
    await seedLocal("500.0000", new Date("2026-08-20T00:00:00.000Z"));
    admin.setFixture("OrdersUpdatedSince", ordersPage([]));
    admin.setFixture("OpenOrderIdsProbe", probePage([]));
    admin.setFixture("OrderForLedger", { data: { order: null } });

    const report = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    expect(report.probeRefetched).toBe(1);
    expect(admin.callsFor("OrderForLedger")[0].variables.id).toBe(ORDER_GID);
    // The refetch found it gone: the ledger row goes, and exposure follows.
    expect(await prisma.ledgerOrder.count({ where: { shop: SHOP } })).toBe(0);
    expect((await companyRow()).exposure.toFixed(2)).toBe("0.00");
  });

  it("does not refetch an order the probe still reports as open", async () => {
    await seedLocal("500.0000", new Date("2026-08-20T00:00:00.000Z"));
    admin.setFixture("OpenOrderIdsProbe", probePage([ORDER_GID]));

    const report = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    expect(report.probeRefetched).toBe(0);
    expect(admin.callCount("OrderForLedger")).toBe(0);
  });

  it("does not refetch an order whose schedules are all settled", async () => {
    await seedLocal("500.0000", new Date("2026-08-20T00:00:00.000Z"), {
      completedAt: new Date("2026-08-30T00:00:00.000Z"),
    });
    admin.setFixture("OpenOrderIdsProbe", probePage([]));

    const report = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    expect(report.probeRefetched).toBe(0);
  });

  it("probes with the same open-status filter the backfill uses", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: true } });

    await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    const [probe] = admin.callsFor("OpenOrderIdsProbe");
    expect(probe.variables.query).toBe(OPEN_ORDER_STATUS_FILTER);
  });
});

describe("throttling", () => {
  it("retries a throttled page once and then succeeds", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    admin.setFixture("OrdersUpdatedSince", [
      throttledResponse(),
      ordersPage([orderNode()]),
    ]);
    admin.setFixture("OpenOrderIdsProbe", probePage([ORDER_GID]));
    // The fresh row lands UNRESOLVED; the attribution pass claims it on the
    // company's edge (fixture shape — same assertions).
    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([
        { id: COMPANY_GID, name: "Acme Industrial Supply", ordersCount: 1 },
      ]),
    );
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        companyGid: COMPANY_GID,
        companyName: "Acme Industrial Supply",
        orders: [orderNode()],
      }),
    );

    const report = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    expect(admin.callCount("OrdersUpdatedSince")).toBe(2);
    expect(report.ordersSeen).toBe(1);
    expect((await companyRow()).exposure.toFixed(2)).toBe("500.00");
  });

  it("surfaces a persistently failing query to Sentry and throws", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    admin.setFixture("OrdersUpdatedSince", throttledResponse());

    await expect(
      reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 }),
    ).rejects.toThrow();

    expect(admin.callCount("OrdersUpdatedSince")).toBe(2);
    expect(captureMessage).toHaveBeenCalled();
  });
});

describe("attribution pass — company-side healing (02-08, WINDOWS defect 5 part 3)", () => {
  const COMPANY_NAME = "Acme Industrial Supply";

  function ledgerRow() {
    return prisma.ledgerOrder.findUniqueOrThrow({
      where: { shop_orderGid: { shop: SHOP, orderGid: ORDER_GID } },
    });
  }

  /**
   * Seed an UNRESOLVED row through the REAL 02-06 rung-3 path (unknown order,
   * no usable hint), never by hand-writing ledger internals: the heal tests
   * must start from exactly the shape the webhook path leaves behind.
   */
  async function seedUnresolvedViaRung3(node: OrderForLedgerNode) {
    admin.setFixture("OrderForLedger", { data: { order: node } });
    await ingestOrderEvent(SHOP, node.id, null);
    // Rung 3 warns (understated exposure); clear so sweep assertions are clean.
    captureMessage.mockClear();
  }

  it("claims a webhook-ingested UNRESOLVED order on its company's edge within one sweep", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    const node = orderNode();
    await seedUnresolvedViaRung3(node);

    const before = await ledgerRow();
    expect(before.attributionStatus).toBe("UNRESOLVED");
    expect(before.companyId).toBeNull();

    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([{ id: COMPANY_GID, name: COMPANY_NAME, ordersCount: 1 }]),
    );
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        companyGid: COMPANY_GID,
        companyName: COMPANY_NAME,
        orders: [node],
      }),
    );
    admin.setFixture("OpenOrderIdsProbe", probePage([ORDER_GID]));

    const report = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    const after = await ledgerRow();
    expect(after.attributionStatus).toBe("ATTRIBUTED");
    expect(after.companyId).not.toBeNull();
    expect(report.attributed).toBe(1);
    expect(report.flippedNoCompany).toBe(0);
    // The healed order's money now counts against its company.
    expect((await companyRow()).exposure.toFixed(2)).toBe("500.00");
  });

  it("reads overdue true when a past-due order arrives via the pass — count mismatch, zero UNRESOLVED", async () => {
    // No local rows at all: the re-page is driven purely by Shopify's
    // ordersCount disagreeing with the local attributed count (0 vs 1).
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([{ id: COMPANY_GID, name: COMPANY_NAME, ordersCount: 1 }]),
    );
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        companyGid: COMPANY_GID,
        companyName: COMPANY_NAME,
        orders: [orderNode()],
      }),
    );
    admin.setFixture("OpenOrderIdsProbe", probePage([ORDER_GID]));

    const report = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    const company = await companyRow();
    expect(company.exposure.toFixed(2)).toBe("500.00");
    // NOW (2026-09-02) is strictly past DUE_AT (2026-08-31) — D-04.
    expect(company.overdue).toBe(true);
    // A fresh ingest is not a heal: nothing was UNRESOLVED beforehand.
    expect(report.attributed).toBe(0);
  });

  it("flips an UNRESOLVED row no company claims to NO_COMPANY after a full enumeration", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    const node = orderNode();
    await seedUnresolvedViaRung3(node);
    // refetchedAt must sit strictly BEFORE the sweep start the flip reads.
    await settle();

    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([{ id: COMPANY_GID, name: COMPANY_NAME, ordersCount: 0 }]),
    );
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        companyGid: COMPANY_GID,
        companyName: COMPANY_NAME,
        orders: [],
      }),
    );

    const report = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    const row = await ledgerRow();
    // "Couldn't determine" has converged to "proven none" in ONE cycle.
    expect(row.attributionStatus).toBe("NO_COMPANY");
    expect(row.companyId).toBeNull();
    expect(report.flippedNoCompany).toBe(1);
    expect(report.attributed).toBe(0);
  });

  it("flips a row THIS sweep's own cursor scan refetched, in the same sweep (WINDOWS #10)", async () => {
    // The row is born mid-sweep from the cursor scan, so its refetchedAt
    // postdates sweepStart. That is NOT a race: the full company enumeration
    // that licenses the flip ran AFTER the scan, so this row was proven
    // unattributable by evidence NEWER than its own refetch. Excluding it is
    // what starved the newest order forever (the previous expectation here).
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    admin.setFixture("OrdersUpdatedSince", ordersPage([orderNode()]));
    admin.setFixture("OpenOrderIdsProbe", probePage([ORDER_GID]));
    admin.setFixture("CompaniesForLedger", companiesPage([]));

    const report = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    const row = await ledgerRow();
    expect(row.attributionStatus).toBe("NO_COMPANY");
    expect(row.companyId).toBeNull();
    expect(report.flippedNoCompany).toBe(1);
  });

  it("converges the shop's NEWEST unattributable order instead of starving it (WINDOWS #10, live #1012)", async () => {
    // THE LIVE SHAPE. The cursor is advanced to `newestUpdatedAt - 5 min`, so
    // the newest order is re-paged by EVERY sweep — which refreshed its
    // refetchedAt past every sweepStart, so the flip could never see it. The
    // row sat UNRESOLVED forever and pinned `data_complete: false` on the
    // dashboard. Before the fix this spec never leaves UNRESOLVED.
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    const node = orderNode();
    await seedUnresolvedViaRung3(node);
    await settle();

    // Nobody claims it, in either sweep.
    admin.setFixture("CompaniesForLedger", companiesPage([]));
    admin.setFixture("OpenOrderIdsProbe", probePage([ORDER_GID]));

    // Sweep 1: the cursor overlap re-pages the order it already knows about.
    admin.setFixture("OrdersUpdatedSince", ordersPage([node]));
    const first = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    expect((await ledgerRow()).attributionStatus).toBe("NO_COMPANY");
    expect(first.flippedNoCompany).toBe(1);

    // Sweep 2: the same overlap re-pages it again. The verdict is already in,
    // so there is nothing left to flip — convergence, not a flapping row.
    admin.setFixture("OrdersUpdatedSince", ordersPage([node]));
    const second = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    expect((await ledgerRow()).attributionStatus).toBe("NO_COMPANY");
    expect(second.flippedNoCompany).toBe(0);
  });

  it("still leaves a row refetched mid-sweep by an IN-FLIGHT webhook for the next cycle", async () => {
    // The no-race clause survives, narrowed to what it was actually for: a row
    // refreshed during the sweep by SOMETHING ELSE. The cursor scan does not
    // return it, so the enumeration cannot have accounted for whatever that
    // other writer just learned — flipping it would race a live ingest.
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    const node = orderNode();
    await seedUnresolvedViaRung3(node);

    // Stand in for a webhook ingest landing mid-sweep: refetchedAt in the
    // future, so it postdates any sweepStart this test can produce.
    await prisma.ledgerOrder.update({
      where: { shop_orderGid: { shop: SHOP, orderGid: ORDER_GID } },
      data: { refetchedAt: new Date(Date.now() + 60_000) },
    });

    // Empty cursor page: this sweep's own scan never saw the row.
    admin.setFixture("OrdersUpdatedSince", ordersPage([]));
    admin.setFixture("OpenOrderIdsProbe", probePage([ORDER_GID]));
    admin.setFixture("CompaniesForLedger", companiesPage([]));

    const report = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    const row = await ledgerRow();
    expect(row.attributionStatus).toBe("UNRESOLVED");
    expect(report.flippedNoCompany).toBe(0);
  });

  it("recovers a NO_COMPANY row the moment its order appears on a company's edge (W-2 — never sticky)", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    const node = orderNode();
    await seedUnresolvedViaRung3(node);
    await settle();

    // Sweep 1: full enumeration, nobody claims it — proven NO_COMPANY.
    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([{ id: COMPANY_GID, name: COMPANY_NAME, ordersCount: 0 }]),
    );
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        companyGid: COMPANY_GID,
        companyName: COMPANY_NAME,
        orders: [],
      }),
    );
    await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });
    expect((await ledgerRow()).attributionStatus).toBe("NO_COMPANY");

    // Sweep 2: Shopify now lists the order on the company's edge. No row is
    // UNRESOLVED anywhere, so the re-page is driven purely by the ordersCount
    // disagreement — the exhaustion verdict is a status, not a tombstone.
    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([{ id: COMPANY_GID, name: COMPANY_NAME, ordersCount: 1 }]),
    );
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        companyGid: COMPANY_GID,
        companyName: COMPANY_NAME,
        orders: [node],
      }),
    );
    const report = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    const row = await ledgerRow();
    expect(row.attributionStatus).toBe("ATTRIBUTED");
    expect(row.companyId).not.toBeNull();
    expect(report.attributed).toBe(1);
    // The amount re-enters exposure — NO_COMPANY was never sticky.
    expect((await companyRow()).exposure.toFixed(2)).toBe("500.00");
  });

  it("does not re-page a company whose ordersCount matches when nothing is UNRESOLVED", async () => {
    await seedLocal("500.0000", new Date("2026-08-20T00:00:00.000Z"));
    admin.setFixture("OpenOrderIdsProbe", probePage([ORDER_GID]));
    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([{ id: COMPANY_GID, name: COMPANY_NAME, ordersCount: 1 }]),
    );
    // Deliberately NO CompanyOrdersForLedger fixture: a re-page would throw.

    const report = await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });

    expect(admin.callCount("CompaniesForLedger")).toBe(1);
    expect(admin.callCount("CompanyOrdersForLedger")).toBe(0);
    expect(report.attributed).toBe(0);
    expect(report.flippedNoCompany).toBe(0);
  });

  it("propagates a non-throttle LedgerGraphqlError loudly — no silent partial sweep", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    admin.setFixture("OrdersUpdatedSince", accessDeniedResponse());

    await expect(
      reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 }),
    ).rejects.toBeInstanceOf(LedgerGraphqlError);

    // Only THROTTLED earns the single retry — a scope trap must not be re-hit.
    expect(admin.callCount("OrdersUpdatedSince")).toBe(1);
    expect(captureMessage).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * The 5-minute attribution heal (06-DEBUG-ingest-latency fix 2).
 * ------------------------------------------------------------------ */

describe("attribution-heal sweep — the minutes-scale backstop (06-DEBUG)", () => {
  const COMPANY_NAME = "Acme Industrial Supply";

  /** Seed an UNRESOLVED row through the REAL rung-3 path, as the heal tests do. */
  async function seedUnresolvedViaRung3(node: OrderForLedgerNode) {
    admin.setFixture("OrderForLedger", { data: { order: node } });
    await ingestOrderEvent(SHOP, node.id, null);
    captureMessage.mockClear();
  }

  it("costs NOTHING when no net-terms order is unresolved", async () => {
    // The whole argument for a 5-minute cadence: one indexed DB read per shop
    // per tick, and not a single Admin API call on a steady shop.
    await seedLocal("500.0000", new Date("2026-08-20T00:00:00.000Z"));

    await runAttributionHealSweep({ now: NOW });

    expect(getAdminContext).not.toHaveBeenCalled();
    expect(admin.callCount()).toBe(0);
  });

  it("heals an UNRESOLVED order in minutes — and does NOT run the NO_COMPANY flip", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    const claimed = orderNode();
    const orphan = orderNode({ id: SECOND_ORDER_GID });
    await seedUnresolvedViaRung3(claimed);
    await seedUnresolvedViaRung3(orphan);
    // Push refetchedAt strictly behind any sweep instant, so a flip that DID
    // run would have every excuse to fire.
    await settle();

    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([{ id: COMPANY_GID, name: COMPANY_NAME, ordersCount: 1 }]),
    );
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        companyGid: COMPANY_GID,
        companyName: COMPANY_NAME,
        orders: [claimed],
      }),
    );

    await runAttributionHealSweep({ now: NOW });

    const healed = await prisma.ledgerOrder.findUniqueOrThrow({
      where: { shop_orderGid: { shop: SHOP, orderGid: ORDER_GID } },
    });
    expect(healed.attributionStatus).toBe("ATTRIBUTED");
    expect((await companyRow()).exposure.toFixed(2)).toBe("500.00");

    // THE POINT OF THE SPLIT: no company claimed the second order, but a fast
    // tick must never conclude "proven attached to no company" — the company
    // edge trails a fresh order by seconds, and a flip on this cadence would
    // race it and make dataComplete and exposures flicker (06-DEBUG §3 Q4).
    const stillOpen = await prisma.ledgerOrder.findUniqueOrThrow({
      where: { shop_orderGid: { shop: SHOP, orderGid: SECOND_ORDER_GID } },
    });
    expect(stillOpen.attributionStatus).toBe("UNRESOLVED");

    // Heal half only: no cursor page, no open-order probe, no cursor write.
    expect(admin.callCount("OrdersUpdatedSince")).toBe(0);
    expect(admin.callCount("OpenOrderIdsProbe")).toBe(0);
    expect(await cursorRow()).toBeNull();
  });

  it("still flips that same orphan to NO_COMPANY on the daily sweep", async () => {
    // The flip did not move — it just stopped riding the fast tick.
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    await seedUnresolvedViaRung3(orderNode({ id: SECOND_ORDER_GID }));
    await settle();

    admin.setFixture("CompaniesForLedger", companiesPage([]));

    await runAttributionHealSweep({ now: NOW });
    expect(
      (
        await prisma.ledgerOrder.findUniqueOrThrow({
          where: { shop_orderGid: { shop: SHOP, orderGid: SECOND_ORDER_GID } },
        })
      ).attributionStatus,
    ).toBe("UNRESOLVED");

    await reconcileShop(SHOP, { now: NOW, retryDelayMs: 0 });
    expect(
      (
        await prisma.ledgerOrder.findUniqueOrThrow({
          where: { shop_orderGid: { shop: SHOP, orderGid: SECOND_ORDER_GID } },
        })
      ).attributionStatus,
    ).toBe("NO_COMPANY");
  });

  it("heals the active shop and never touches the uninstalled one (CF-3)", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: true } });
    await prisma.shop.create({ data: { domain: OTHER_SHOP, active: false } });
    const node = orderNode();
    await seedUnresolvedViaRung3(node);
    // The same unresolved shape on a shop inside the D-06 grace window.
    admin.setFixture("OrderForLedger", { data: { order: node } });
    await ingestOrderEvent(OTHER_SHOP, node.id, null);
    captureMessage.mockClear();
    // Seeding itself talked to the fake Admin for both shops; the assertion
    // below is about what the SWEEP does.
    getAdminContext.mockClear();

    admin.setFixture(
      "CompaniesForLedger",
      companiesPage([{ id: COMPANY_GID, name: COMPANY_NAME, ordersCount: 1 }]),
    );
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        companyGid: COMPANY_GID,
        companyName: COMPANY_NAME,
        orders: [node],
      }),
    );

    await runAttributionHealSweep({ now: NOW });

    expect(getAdminContext).not.toHaveBeenCalledWith(OTHER_SHOP);
    expect(
      (
        await prisma.ledgerOrder.findUniqueOrThrow({
          where: { shop_orderGid: { shop: OTHER_SHOP, orderGid: ORDER_GID } },
        })
      ).attributionStatus,
    ).toBe("UNRESOLVED");
  });
});

describe("runReconciliationSweep — active shops only (CF-3)", () => {
  it("reconciles the active shop and never touches the inactive one", async () => {
    await seedLocal("999.0000", new Date("2026-08-20T00:00:00.000Z"));
    await seedLocal("999.0000", new Date("2026-08-20T00:00:00.000Z"), {
      shop: OTHER_SHOP,
    });
    await prisma.shop.update({
      where: { domain: OTHER_SHOP },
      data: { active: false },
    });

    admin.setFixture("OrdersUpdatedSince", ordersPage([orderNode()]));
    admin.setFixture("OpenOrderIdsProbe", probePage([ORDER_GID]));

    await runReconciliationSweep({ now: NOW, retryDelayMs: 0 });

    expect((await companyRow(SHOP)).exposure.toFixed(2)).toBe("500.00");
    // The uninstalled merchant's drifted number stays exactly as it was: their
    // rows are retained through the grace window, not processed (D-06).
    expect((await companyRow(OTHER_SHOP)).exposure.toFixed(2)).toBe("999.00");
    expect(getAdminContext).not.toHaveBeenCalledWith(OTHER_SHOP);
  });
});
