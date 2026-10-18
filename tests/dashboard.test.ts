import { beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import { createMoneyFormatter } from "../app/lib/money";
import { REMINDERS_CADENCE } from "../app/reminder-copy";
import { BACKFILL_CURSOR_KEY } from "../app/services/backfill.server";
import {
  channelPhrase,
  clampFeedPage,
  feedBadge,
  feedSentence,
  bucketUpcoming,
  loadDashboard,
  reminderBadge,
  resolveLocale,
  selectBanner,
  touchpointLabel,
  utilisationPercent,
} from "../app/services/dashboard.server";
import { EVENT_KIND } from "../app/services/enforcement.server";
import { REMINDER_STATUS, TOUCHPOINT } from "../app/services/reminders.server";
import { sourceWithoutComments } from "./helpers/module-source";

/**
 * DASH-01 / DASH-02 — the AR dashboard read model and page, end to end.
 *
 * The ONLY boundary stubbed here is `authenticate.admin`, exactly as
 * tests/companies-settings.test.ts does it: a real session token would need a
 * live Shopify to mint. Everything downstream is real — the real service, real
 * Prisma rows in the scratch test database, the real route loader — because
 * "the total is the sum of these rows" is a claim only a database can settle.
 *
 * There is deliberately NO Admin GraphQL mock in this file: the dashboard makes
 * no Admin API call at all, and a mock nobody calls would hide a regression that
 * added one (T-06-03).
 */

const authenticateAdmin = vi.hoisted(() => vi.fn());

vi.mock("../app/shopify.server", () => ({
  authenticate: { admin: authenticateAdmin },
}));

const captureException = vi.hoisted(() => vi.fn());
const captureMessage = vi.hoisted(() => vi.fn());

vi.mock("@sentry/react-router", () => ({ captureException, captureMessage }));

/**
 * The enforcement and reminder services own the kind/status vocabularies this
 * page speaks, and both sit downstream of the Admin transport. Stubbing that
 * transport keeps their constants importable without a live Shopify — nothing
 * in the dashboard path ever calls it.
 */
const getAdminContext = vi.hoisted(() => vi.fn());

vi.mock("../app/services/admin-client.server", () => ({ getAdminContext }));

const SHOP = "dashboard-test.myshopify.com";
const OTHER_SHOP = "dashboard-bystander.myshopify.com";
const EMPTY_SHOP = "dashboard-empty.myshopify.com";
const SHOPS = [SHOP, OTHER_SHOP, EMPTY_SHOP];
const ENDPOINT = "https://app.creditguard.test/app";
const CURRENCY = "USD";

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

async function routeModule() {
  return import("../app/routes/app._index");
}

async function runLoader(url = ENDPOINT) {
  const { loader } = await routeModule();
  const request = new Request(url);
  return loader({ request, params: {}, context: {} } as never);
}

async function resetShops() {
  const where = { shop: { in: SHOPS } };
  await prisma.reminderLog.deleteMany({ where });
  await prisma.enforcementEvent.deleteMany({ where });
  await prisma.ledgerSchedule.deleteMany({ where });
  await prisma.ledgerOrder.deleteMany({ where });
  await prisma.company.deleteMany({ where });
  await prisma.syncCursor.deleteMany({ where });
  await prisma.shop.deleteMany({ where: { domain: { in: SHOPS } } });
}

interface CompanySeed {
  shop?: string;
  companyGid?: string;
  name?: string;
  exposure?: string;
  overdue?: boolean;
  earliestDueAt?: Date | null;
  creditLimit?: string | null;
  bypassEnforcement?: boolean;
  blockedState?: boolean;
}

async function seedCompany(seed: CompanySeed = {}) {
  return prisma.company.create({
    data: {
      shop: seed.shop ?? SHOP,
      companyGid: seed.companyGid ?? `gid://shopify/Company/${cuidish()}`,
      name: seed.name ?? "Acme Industrial",
      exposure: seed.exposure ?? "0",
      overdue: seed.overdue ?? false,
      earliestDueAt: seed.earliestDueAt ?? null,
      creditLimit: seed.creditLimit ?? null,
      bypassEnforcement: seed.bypassEnforcement ?? false,
      blockedState: seed.blockedState ?? false,
    },
  });
}

interface OrderSeed {
  shop?: string;
  orderGid?: string;
  name?: string;
  companyId?: string | null;
  outstandingShop?: string;
  currencyCode?: string;
  hasPaymentTerms?: boolean;
  attributionStatus?: string;
  cancelledAt?: Date | null;
}

async function seedOrder(seed: OrderSeed = {}) {
  const at = new Date("2026-08-01T00:00:00.000Z");
  return prisma.ledgerOrder.create({
    data: {
      shop: seed.shop ?? SHOP,
      orderGid: seed.orderGid ?? `gid://shopify/Order/${cuidish()}`,
      name: seed.name ?? "#1001",
      companyId: seed.companyId ?? null,
      attributionStatus: seed.attributionStatus ?? "ATTRIBUTED",
      hasPaymentTerms: seed.hasPaymentTerms ?? true,
      cancelledAt: seed.cancelledAt ?? null,
      outstandingShop: seed.outstandingShop ?? "0",
      currencyCode: seed.currencyCode ?? CURRENCY,
      sourceUpdatedAt: at,
      refetchedAt: at,
    },
  });
}

interface ScheduleSeed {
  shop?: string;
  scheduleGid?: string;
  orderId: string;
  dueAt?: Date | null;
  completedAt?: Date | null;
}

async function seedSchedule(seed: ScheduleSeed) {
  return prisma.ledgerSchedule.create({
    data: {
      shop: seed.shop ?? SHOP,
      scheduleGid: seed.scheduleGid ?? `gid://shopify/PaymentSchedule/${cuidish()}`,
      orderId: seed.orderId,
      dueAt: seed.dueAt ?? null,
      completedAt: seed.completedAt ?? null,
    },
  });
}

interface EventSeed {
  shop?: string;
  companyGid?: string;
  companyName?: string;
  kind: string;
  orderGid?: string | null;
  amount?: string | null;
  channel?: string | null;
  exposure?: string;
  limit?: string | null;
  overdue?: boolean;
  bypass?: boolean;
  createdAt?: Date;
}

async function seedEvent(seed: EventSeed) {
  return prisma.enforcementEvent.create({
    data: {
      shop: seed.shop ?? SHOP,
      companyGid: seed.companyGid ?? `gid://shopify/Company/${cuidish()}`,
      companyName: seed.companyName ?? "Acme Industrial",
      kind: seed.kind,
      orderGid: seed.orderGid ?? null,
      amount: seed.amount ?? null,
      channel: seed.channel ?? null,
      exposure: seed.exposure ?? "0",
      limit: seed.limit ?? null,
      overdue: seed.overdue ?? false,
      bypass: seed.bypass ?? false,
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
    },
  });
}

interface ReminderSeed {
  shop?: string;
  scheduleGid?: string;
  orderGid?: string;
  companyGid?: string | null;
  companyName?: string | null;
  touchpoint?: string;
  status: string;
  createdAt?: Date;
}

async function seedReminder(seed: ReminderSeed) {
  return prisma.reminderLog.create({
    data: {
      shop: seed.shop ?? SHOP,
      scheduleGid: seed.scheduleGid ?? `gid://shopify/PaymentSchedule/${cuidish()}`,
      orderGid: seed.orderGid ?? `gid://shopify/Order/${cuidish()}`,
      companyGid: seed.companyGid ?? null,
      companyName: seed.companyName === undefined ? "Acme Industrial" : seed.companyName,
      touchpoint: seed.touchpoint ?? TOUCHPOINT.DUE_SOON,
      status: seed.status,
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
    },
  });
}

async function seedShopRow(domain: string, remindersEnabledAt: Date | null = null) {
  return prisma.shop.upsert({
    where: { domain },
    create: { domain, remindersEnabledAt },
    update: { remindersEnabledAt },
  });
}

async function seedBackfillState(status: string, shop = SHOP) {
  return prisma.syncCursor.upsert({
    where: { shop_key: { shop, key: BACKFILL_CURSOR_KEY } },
    create: {
      shop,
      key: BACKFILL_CURSOR_KEY,
      value: JSON.stringify({
        status,
        operationGid: null,
        startedAt: NOW.toISOString(),
        polledAt: null,
        completedAt: null,
        error: null,
        orderCount: 0,
        scheduleCount: 0,
        companyCount: 0,
      }),
    },
    update: { value: JSON.stringify({ status }) },
  });
}

let sequence = 0;
function cuidish(): string {
  sequence += 1;
  return `${sequence}`;
}

/** The injected clock every window below is measured from. */
const NOW = new Date("2026-08-20T12:00:00.000Z");

function daysFromNow(days: number, hours = 0): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000);
}

/** The formatter the page itself uses — never a hard-coded symbol. */
const money = createMoneyFormatter(CURRENCY);

beforeEach(async () => {
  await resetShops();
  authenticateAdmin.mockReset();
  authenticateAdmin.mockResolvedValue({ session: { shop: SHOP } });
});

/* ------------------------------------------------------------------ *
 * K1 — Total outstanding
 * ------------------------------------------------------------------ */

describe("K1 total outstanding", () => {
  it("sums every company's exposure for the shop and formats it once", async () => {
    await seedCompany({ exposure: "100.5000", companyGid: "gid://shopify/Company/a1" });
    await seedCompany({ exposure: "200.2500", companyGid: "gid://shopify/Company/a2" });
    await seedOrder({ currencyCode: CURRENCY });

    const data = await loadDashboard(SHOP);

    expect(data.kpis.totalOutstanding.value).toBe(money("300.75"));
    expect(data.kpis.totalOutstanding.incomplete).toBe(false);
  });

  it("never lets another shop's rows into the total", async () => {
    await seedCompany({ exposure: "100.5000" });
    await seedCompany({ shop: OTHER_SHOP, exposure: "999.0000" });
    await seedOrder({ currencyCode: CURRENCY });

    const mine = await loadDashboard(SHOP);
    const theirs = await loadDashboard(OTHER_SHOP);

    expect(mine.kpis.totalOutstanding.value).toBe(money("100.50"));
    expect(theirs.kpis.totalOutstanding.value).not.toBe(money("100.50"));
  });

  it("marks the total incomplete while a net-terms order is unattributed", async () => {
    await seedCompany({ exposure: "100.5000" });
    await seedOrder({
      attributionStatus: "UNRESOLVED",
      hasPaymentTerms: true,
    });

    const data = await loadDashboard(SHOP);

    expect(data.kpis.totalOutstanding.incomplete).toBe(true);
  });

  it("renders no total at all for a shop with no companies", async () => {
    const data = await loadDashboard(EMPTY_SHOP);

    expect(data.kpis.totalOutstanding.value).toBeNull();
  });

  it("formats zero exposure as a number, not as an em dash", async () => {
    await seedCompany({ exposure: "0" });
    await seedOrder({ currencyCode: CURRENCY });

    const data = await loadDashboard(SHOP);

    expect(data.kpis.totalOutstanding.value).toBe(money("0.00"));
  });

  it("serialises money as a string, never as a number", async () => {
    await seedCompany({ exposure: "12.3400" });

    const data = await loadDashboard(SHOP);

    expect(typeof data.kpis.totalOutstanding.value).toBe("string");
  });
});

/* ------------------------------------------------------------------ *
 * Locale — T-06-02
 * ------------------------------------------------------------------ */

describe("resolveLocale", () => {
  it("defaults to en-US when the request asks for nothing", () => {
    expect(resolveLocale(new Request(ENDPOINT))).toBe("en-US");
  });

  it("accepts a supported tag", () => {
    expect(resolveLocale(new Request(`${ENDPOINT}?locale=en-GB`))).toBe("en-GB");
  });

  it("falls back rather than throwing on a malformed tag", () => {
    expect(resolveLocale(new Request(`${ENDPOINT}?locale=not-a-locale!!`))).toBe(
      "en-US",
    );
  });
});

describe("clampFeedPage", () => {
  it("keeps a positive integer", () => {
    expect(clampFeedPage(3)).toBe(3);
  });

  it("refuses anything that is not a positive integer", () => {
    expect(clampFeedPage(undefined)).toBe(1);
    expect(clampFeedPage(Number.NaN)).toBe(1);
    expect(clampFeedPage(0)).toBe(1);
    expect(clampFeedPage(-5)).toBe(1);
    expect(clampFeedPage(2.5)).toBe(1);
    expect(clampFeedPage(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * The route loader
 * ------------------------------------------------------------------ */

describe("dashboard loader", () => {
  it("returns the session shop's numbers", async () => {
    await seedCompany({ exposure: "100.5000" });
    await seedOrder({ currencyCode: CURRENCY });

    const data = (await runLoader()) as Awaited<ReturnType<typeof loadDashboard>>;

    expect(data.kpis.totalOutstanding.value).toBe(money("100.50"));
  });

  it("ignores a shop supplied in the query string (T-06-01)", async () => {
    await seedCompany({ exposure: "100.5000" });
    await seedCompany({ shop: OTHER_SHOP, exposure: "999.0000" });
    await seedOrder({ currencyCode: CURRENCY });

    const data = (await runLoader(
      `${ENDPOINT}?shop=${OTHER_SHOP}`,
    )) as Awaited<ReturnType<typeof loadDashboard>>;

    expect(data.kpis.totalOutstanding.value).toBe(money("100.50"));
  });
});

/* ------------------------------------------------------------------ *
 * K2 / K3 — the two counts
 * ------------------------------------------------------------------ */

describe("K2 and K3 counts", () => {
  it("counts overdue and on-hold companies for this shop only", async () => {
    await seedCompany({ companyGid: "gid://shopify/Company/o1", overdue: true });
    await seedCompany({
      companyGid: "gid://shopify/Company/o2",
      overdue: true,
      blockedState: true,
    });
    await seedCompany({ companyGid: "gid://shopify/Company/o3" });
    await seedCompany({ shop: OTHER_SHOP, overdue: true, blockedState: true });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.kpis.overdueCompanies).toBe("2");
    expect(data.kpis.onCreditHold).toBe("1");
  });

  it("shows zero rather than an em dash when nothing is overdue", async () => {
    await seedCompany({});

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.kpis.overdueCompanies).toBe("0");
    expect(data.kpis.onCreditHold).toBe("0");
  });
});

/* ------------------------------------------------------------------ *
 * K4 — Due in 7 days (schedule money is NEVER summed)
 * ------------------------------------------------------------------ */

describe("K4 due in 7 days", () => {
  it("counts an order once however many open schedules it has in the window", async () => {
    const company = await seedCompany({});
    const order = await seedOrder({
      companyId: company.id,
      outstandingShop: "100.0000",
    });
    await seedSchedule({ orderId: order.id, dueAt: daysFromNow(1) });
    await seedSchedule({ orderId: order.id, dueAt: daysFromNow(5) });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.kpis.dueIn7Days.value).toBe(money("100.00"));
  });

  it("leaves out schedules past the 7-day edge, completed ones, cancelled and unattributed orders", async () => {
    const company = await seedCompany({});
    const inWindow = await seedOrder({
      companyId: company.id,
      outstandingShop: "10.0000",
    });
    await seedSchedule({ orderId: inWindow.id, dueAt: daysFromNow(6) });

    const later = await seedOrder({ companyId: company.id, outstandingShop: "20.0000" });
    await seedSchedule({ orderId: later.id, dueAt: daysFromNow(20) });

    const completed = await seedOrder({
      companyId: company.id,
      outstandingShop: "40.0000",
    });
    await seedSchedule({
      orderId: completed.id,
      dueAt: daysFromNow(2),
      completedAt: NOW,
    });

    const cancelled = await seedOrder({
      companyId: company.id,
      outstandingShop: "80.0000",
      cancelledAt: NOW,
    });
    await seedSchedule({ orderId: cancelled.id, dueAt: daysFromNow(2) });

    const noCompany = await seedOrder({ outstandingShop: "160.0000" });
    await seedSchedule({ orderId: noCompany.id, dueAt: daysFromNow(2) });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.kpis.dueIn7Days.value).toBe(money("10.00"));
  });

  it("renders nothing at all when no open schedule falls in the window", async () => {
    const company = await seedCompany({});
    const order = await seedOrder({ companyId: company.id, outstandingShop: "10.0000" });
    await seedSchedule({ orderId: order.id, dueAt: daysFromNow(20) });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.kpis.dueIn7Days.value).toBeNull();
  });

  it("formats a zero-outstanding window as money, not as an em dash", async () => {
    const company = await seedCompany({});
    const order = await seedOrder({ companyId: company.id, outstandingShop: "0" });
    await seedSchedule({ orderId: order.id, dueAt: daysFromNow(3) });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.kpis.dueIn7Days.value).toBe(money("0.00"));
  });

  it("never reads another shop's schedules", async () => {
    const mine = await seedCompany({});
    const myOrder = await seedOrder({ companyId: mine.id, outstandingShop: "10.0000" });
    await seedSchedule({ orderId: myOrder.id, dueAt: daysFromNow(2) });

    const theirs = await seedCompany({ shop: OTHER_SHOP });
    const theirOrder = await seedOrder({
      shop: OTHER_SHOP,
      companyId: theirs.id,
      outstandingShop: "999.0000",
    });
    await seedSchedule({
      shop: OTHER_SHOP,
      orderId: theirOrder.id,
      dueAt: daysFromNow(2),
    });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.kpis.dueIn7Days.value).toBe(money("10.00"));
  });
});

/* ------------------------------------------------------------------ *
 * Overdue companies table
 * ------------------------------------------------------------------ */

describe("overdue companies table", () => {
  it("orders by earliest due date and carries formatted, flagged rows", async () => {
    await seedCompany({
      companyGid: "gid://shopify/Company/late",
      name: "Late Ltd",
      overdue: true,
      exposure: "500.0000",
      earliestDueAt: new Date("2026-08-10T00:00:00.000Z"),
      blockedState: true,
    });
    await seedCompany({
      companyGid: "gid://shopify/Company/later",
      name: "Later Ltd",
      overdue: true,
      exposure: "250.0000",
      earliestDueAt: new Date("2026-08-15T00:00:00.000Z"),
      bypassEnforcement: true,
    });
    await seedCompany({ companyGid: "gid://shopify/Company/fine", name: "Fine Ltd" });
    await seedOrder({ currencyCode: CURRENCY });

    // An explicit locale so the date literal below is the contract, not this
    // machine's default.
    const data = await loadDashboard(SHOP, { now: NOW, locale: "en-GB" });

    expect(data.overdue.rows.map((row) => row.name)).toEqual([
      "Late Ltd",
      "Later Ltd",
    ]);
    expect(data.overdue.rows[0]).toMatchObject({
      outstanding: money("500.00"),
      earliestDue: "10 Aug 2026",
      blockedState: true,
      bypassEnforcement: false,
    });
    expect(data.overdue.rows[1].bypassEnforcement).toBe(true);
    expect(data.overdue.total).toBe(2);
    expect(data.overdue.companyCount).toBe(3);
  });

  it("caps the table at ten rows and still reports the true total", async () => {
    for (let index = 0; index < 12; index += 1) {
      await seedCompany({
        companyGid: `gid://shopify/Company/bulk-${index}`,
        name: `Company ${index}`,
        overdue: true,
        earliestDueAt: new Date(`2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
      });
    }

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.overdue.rows).toHaveLength(10);
    expect(data.overdue.total).toBe(12);
    expect(data.overdue.totalLabel).toBe("12");
  });

  it("never lists another shop's overdue companies", async () => {
    await seedCompany({ shop: OTHER_SHOP, overdue: true, name: "Bystander" });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.overdue.rows).toHaveLength(0);
    expect(data.overdue.companyCount).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Due in the next 30 days
 * ------------------------------------------------------------------ */

describe("upcoming payments table", () => {
  it("lists open schedules due in the window, order-money per row, soonest first", async () => {
    const company = await seedCompany({ name: "Acme Industrial" });
    const soon = await seedOrder({
      companyId: company.id,
      name: "#1015",
      outstandingShop: "300.0000",
    });
    const later = await seedOrder({
      companyId: company.id,
      name: "#1016",
      outstandingShop: "400.0000",
    });
    await seedSchedule({ orderId: later.id, dueAt: daysFromNow(20) });
    await seedSchedule({ orderId: soon.id, dueAt: daysFromNow(3) });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.upcoming.rows.map((row) => row.orderName)).toEqual(["#1015", "#1016"]);
    expect(data.upcoming.rows[0]).toMatchObject({
      companyName: "Acme Industrial",
      outstanding: money("300.00"),
    });
    expect(data.upcoming.total).toBe(2);
  });

  it("says Today and Tomorrow, and a medium date after that", async () => {
    const company = await seedCompany({});
    const today = await seedOrder({ companyId: company.id, outstandingShop: "1.0000" });
    const tomorrow = await seedOrder({ companyId: company.id, outstandingShop: "1.0000" });
    const later = await seedOrder({ companyId: company.id, outstandingShop: "1.0000" });
    await seedSchedule({ orderId: today.id, dueAt: daysFromNow(0, 5) });
    await seedSchedule({ orderId: tomorrow.id, dueAt: daysFromNow(1) });
    await seedSchedule({ orderId: later.id, dueAt: daysFromNow(9) });

    const data = await loadDashboard(SHOP, { now: NOW, locale: "en-GB" });

    expect(data.upcoming.rows.map((row) => row.due)).toEqual([
      "Today",
      "Tomorrow",
      "29 Aug 2026",
    ]);
  });

  it("caps at fifteen rows and reports the true total", async () => {
    const company = await seedCompany({});
    for (let index = 0; index < 17; index += 1) {
      const order = await seedOrder({
        companyId: company.id,
        name: `#20${index}`,
        outstandingShop: "1.0000",
      });
      await seedSchedule({ orderId: order.id, dueAt: daysFromNow(index + 1) });
    }

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.upcoming.rows).toHaveLength(15);
    expect(data.upcoming.total).toBe(17);
    expect(data.upcoming.totalLabel).toBe("17");
  });
});

/* ------------------------------------------------------------------ *
 * Closest to limit
 * ------------------------------------------------------------------ */

describe("closest to limit", () => {
  it("ranks by utilisation and keeps the top five", async () => {
    const seeds: Array<[string, string, string]> = [
      ["A", "900.0000", "1000.0000"],
      ["B", "500.0000", "1000.0000"],
      ["C", "990.0000", "1000.0000"],
      ["D", "100.0000", "1000.0000"],
      ["E", "200.0000", "1000.0000"],
      ["F", "10.0000", "1000.0000"],
    ];
    for (const [name, exposure, creditLimit] of seeds) {
      await seedCompany({
        companyGid: `gid://shopify/Company/util-${name}`,
        name,
        exposure,
        creditLimit,
      });
    }
    await seedOrder({ currencyCode: CURRENCY });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.closestToLimit.rows.map((row) => row.name)).toEqual([
      "C",
      "A",
      "B",
      "E",
      "D",
    ]);
    expect(data.closestToLimit.rows[0]).toMatchObject({
      outstanding: money("990.00"),
      creditLimit: money("1000.00"),
      utilisation: "99%",
    });
  });

  it("excludes observe-only and zero-limit companies from the ranking", async () => {
    await seedCompany({
      companyGid: "gid://shopify/Company/observe",
      name: "Observe",
      exposure: "500.0000",
      creditLimit: null,
    });
    await seedCompany({
      companyGid: "gid://shopify/Company/blockall",
      name: "Block all",
      exposure: "500.0000",
      creditLimit: "0.0000",
    });
    await seedCompany({
      companyGid: "gid://shopify/Company/real",
      name: "Real",
      exposure: "500.0000",
      creditLimit: "1000.0000",
    });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.closestToLimit.rows.map((row) => row.name)).toEqual(["Real"]);
  });

  it("caps a runaway ratio and floors a credit balance", async () => {
    expect(utilisationPercent("50000.00", "1.00")).toBe(">999%");
    expect(utilisationPercent("-10.00", "100.00")).toBe("0%");
    expect(utilisationPercent("100.00", "100.00")).toBe("100%");
  });
});

/* ------------------------------------------------------------------ *
 * Credit holds and bypasses — the feed
 * ------------------------------------------------------------------ */

describe("enforcement feed", () => {
  it("pages 25 newest-first rows and reports both directions", async () => {
    for (let index = 0; index < 26; index += 1) {
      await seedEvent({
        kind: EVENT_KIND.BLOCK_STATE_ENTERED,
        companyGid: `gid://shopify/Company/feed-${index}`,
        companyName: `Company ${index}`,
        createdAt: new Date(NOW.getTime() - index * 60_000),
      });
    }

    const first = await loadDashboard(SHOP, { now: NOW });
    const second = await loadDashboard(SHOP, { now: NOW, feedPage: 2 });

    expect(first.feed.rows).toHaveLength(25);
    expect(first.feed.hasNextPage).toBe(true);
    expect(first.feed.hasPreviousPage).toBe(false);
    expect(first.feed.rows[0].details).toContain("Company 0");
    expect(second.feed.rows).toHaveLength(1);
    expect(second.feed.hasNextPage).toBe(false);
    expect(second.feed.hasPreviousPage).toBe(true);
    expect(second.feed.rows[0].details).toContain("Company 25");
  });

  it("renders the company-name snapshot even after the company row is gone", async () => {
    const company = await seedCompany({
      companyGid: "gid://shopify/Company/doomed",
      name: "Doomed Ltd",
    });
    await seedEvent({
      kind: EVENT_KIND.BLOCK_STATE_ENTERED,
      companyGid: "gid://shopify/Company/doomed",
      companyName: "Doomed Ltd",
      exposure: "100.0000",
    });
    await prisma.company.delete({ where: { id: company.id } });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.feed.rows[0].details).toContain("Doomed Ltd");
  });

  it("resolves an order name, and falls back to the gid's last four characters", async () => {
    const company = await seedCompany({});
    await seedOrder({
      companyId: company.id,
      orderGid: "gid://shopify/Order/9911",
      name: "#1015",
    });
    await seedEvent({
      kind: EVENT_KIND.BYPASSED_ORDER,
      orderGid: "gid://shopify/Order/9911",
      amount: "250.0000",
      companyName: "Acme Industrial",
      channel: "shopify_draft_order",
      createdAt: new Date(NOW.getTime() - 1000),
    });
    await seedEvent({
      kind: EVENT_KIND.BYPASSED_ORDER,
      orderGid: "gid://shopify/Order/45217",
      amount: "125.0000",
      companyName: "Acme Industrial",
      createdAt: new Date(NOW.getTime() - 2000),
    });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.feed.rows[0].details).toBe(
      `Order #1015 (${money("250.00")}) went through while Acme Industrial was on credit hold via a draft order.`,
    );
    expect(data.feed.rows[1].details).toBe(
      `Order 5217 (${money("125.00")}) went through while Acme Industrial was on credit hold.`,
    );
  });

  it("never shows another shop's events", async () => {
    await seedEvent({
      shop: OTHER_SHOP,
      kind: EVENT_KIND.BLOCK_STATE_ENTERED,
      companyName: "Bystander",
    });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.feed.rows).toHaveLength(0);
  });
});

describe("feed sentence templates", () => {
  const format = money;

  it("writes the credit-hold sentence with optional limit and overdue clauses", () => {
    expect(
      feedSentence(
        {
          kind: EVENT_KIND.BLOCK_STATE_ENTERED,
          companyName: "Acme Industrial",
          exposure: "1200.00",
          limit: "1000.00",
          overdue: true,
          amount: null,
          channel: null,
          orderName: null,
        },
        format,
      ),
    ).toBe(
      `Acme Industrial placed on credit hold — ${format("1200.00")} outstanding, limit ${format("1000.00")}, overdue.`,
    );

    expect(
      feedSentence(
        {
          kind: EVENT_KIND.BLOCK_STATE_ENTERED,
          companyName: "Acme Industrial",
          exposure: "1200.00",
          limit: null,
          overdue: false,
          amount: null,
          channel: null,
          orderName: null,
        },
        format,
      ),
    ).toBe(`Acme Industrial placed on credit hold — ${format("1200.00")} outstanding.`);
  });

  it("writes the release sentence", () => {
    expect(
      feedSentence(
        {
          kind: EVENT_KIND.BLOCK_STATE_EXITED,
          companyName: "Acme Industrial",
          exposure: "10.00",
          limit: "1000.00",
          overdue: false,
          amount: null,
          channel: null,
          orderName: null,
        },
        format,
      ),
    ).toBe(
      `Acme Industrial released from credit hold — ${format("10.00")} outstanding, limit ${format("1000.00")}.`,
    );
  });

  it("writes both bypassed-order variants", () => {
    expect(
      feedSentence(
        {
          kind: EVENT_KIND.BYPASSED_ORDER,
          companyName: "Acme Industrial",
          exposure: "0.00",
          limit: null,
          overdue: false,
          amount: null,
          channel: "pos",
          orderName: "#1015",
        },
        format,
      ),
    ).toBe("Order #1015 went through while Acme Industrial was on credit hold via POS.");
  });

  it("writes the two bypass-toggle sentences", () => {
    const base = {
      companyName: "Acme Industrial",
      exposure: "0.00",
      limit: null,
      overdue: false,
      amount: null,
      channel: null,
      orderName: null,
    };

    expect(feedSentence({ ...base, kind: EVENT_KIND.BYPASS_ENABLED }, format)).toBe(
      "Enforcement bypassed for Acme Industrial.",
    );
    expect(feedSentence({ ...base, kind: EVENT_KIND.BYPASS_DISABLED }, format)).toBe(
      "Bypass removed for Acme Industrial.",
    );
  });

  it("maps every channel the ledger records", () => {
    expect(channelPhrase("shopify_draft_order")).toBe("a draft order");
    expect(channelPhrase("web")).toBe("online store");
    expect(channelPhrase("pos")).toBe("POS");
    expect(channelPhrase("some_headless_thing")).toBe("some_headless_thing");
    expect(channelPhrase(null)).toBeNull();
  });

  it("keeps the badge vocabulary and tones the spec fixes", () => {
    expect(feedBadge(EVENT_KIND.BLOCK_STATE_ENTERED)).toEqual({
      text: "Credit hold",
      tone: "critical",
    });
    expect(feedBadge(EVENT_KIND.BLOCK_STATE_EXITED)).toEqual({
      text: "Released",
      tone: "neutral",
    });
    expect(feedBadge(EVENT_KIND.BYPASSED_ORDER)).toEqual({
      text: "Order went through",
      tone: "warning",
    });
    expect(feedBadge(EVENT_KIND.BYPASS_ENABLED)).toEqual({
      text: "Bypass on",
      tone: "neutral",
    });
    expect(feedBadge(EVENT_KIND.BYPASS_DISABLED)).toEqual({
      text: "Bypass off",
      tone: "neutral",
    });
  });
});

/* ------------------------------------------------------------------ *
 * Banner precedence
 * ------------------------------------------------------------------ */

describe("banner selection", () => {
  it("puts a running backfill ahead of everything else", () => {
    expect(
      selectBanner({
        backfillRunning: true,
        dataComplete: false,
        bypassed: { count: 3, sumLabel: "x", single: null },
      }),
    ).toEqual({ kind: "backfill-running" });
  });

  it("puts incomplete data ahead of the bypassed-order alert", () => {
    expect(
      selectBanner({
        backfillRunning: false,
        dataComplete: false,
        bypassed: { count: 3, sumLabel: "x", single: null },
      }),
    ).toEqual({ kind: "data-incomplete" });
  });

  it("uses the singular template for exactly one bypassed order", () => {
    expect(
      selectBanner({
        backfillRunning: false,
        dataComplete: true,
        bypassed: {
          count: 1,
          sumLabel: "$250.00",
          single: {
            orderName: "#1015",
            amountLabel: "$250.00",
            companyName: "Acme Industrial",
          },
        },
      }),
    ).toEqual({
      kind: "bypassed-one",
      orderName: "#1015",
      amountLabel: "$250.00",
      companyName: "Acme Industrial",
    });
  });

  it("uses the plural template past one", () => {
    expect(
      selectBanner({
        backfillRunning: false,
        dataComplete: true,
        bypassed: { count: 4, sumLabel: "$900.00", single: null },
      }),
    ).toEqual({ kind: "bypassed-many", countLabel: "4", sumLabel: "$900.00" });
  });

  it("shows nothing when nothing applies", () => {
    expect(
      selectBanner({
        backfillRunning: false,
        dataComplete: true,
        bypassed: { count: 0, sumLabel: "", single: null },
      }),
    ).toBeNull();
  });

  it("is driven by real rows: a running backfill wins over a leaked order", async () => {
    await seedBackfillState("running");
    await seedEvent({
      kind: EVENT_KIND.BYPASSED_ORDER,
      orderGid: "gid://shopify/Order/7777",
      amount: "250.0000",
    });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.banner).toEqual({ kind: "backfill-running" });
  });

  it("surfaces the singular alert from a single leaked order in the window", async () => {
    await seedShopRow(SHOP);
    const company = await seedCompany({});
    await seedOrder({
      companyId: company.id,
      orderGid: "gid://shopify/Order/7777",
      name: "#1099",
    });
    await seedEvent({
      kind: EVENT_KIND.BYPASSED_ORDER,
      orderGid: "gid://shopify/Order/7777",
      amount: "250.0000",
      companyName: "Acme Industrial",
      createdAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.banner).toEqual({
      kind: "bypassed-one",
      orderName: "#1099",
      amountLabel: money("250.00"),
      companyName: "Acme Industrial",
    });
  });

  it("ignores leaked orders older than thirty days", async () => {
    await seedEvent({
      kind: EVENT_KIND.BYPASSED_ORDER,
      orderGid: "gid://shopify/Order/8888",
      amount: "250.0000",
      createdAt: new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000),
    });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.banner).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Payment reminders
 * ------------------------------------------------------------------ */

describe("payment reminders section", () => {
  it("reports reminders off when the shop never opted in", async () => {
    await seedShopRow(SHOP, null);

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.reminders.enabled).toBe(false);
    expect(data.reminders.rows).toHaveLength(0);
  });

  it("reports reminders off for a shop with no row at all", async () => {
    const data = await loadDashboard(EMPTY_SHOP, { now: NOW });

    expect(data.reminders.enabled).toBe(false);
  });

  it("hides suppressed, deferred and in-flight rows", async () => {
    await seedShopRow(SHOP, new Date("2026-08-01T00:00:00.000Z"));
    for (const status of [
      REMINDER_STATUS.SENDING,
      REMINDER_STATUS.DEFERRED,
      REMINDER_STATUS.SUPPRESSED_PAID,
      REMINDER_STATUS.SUPPRESSED_STALE,
      REMINDER_STATUS.SUPPRESSED_PREEXISTING,
    ]) {
      await seedReminder({ status });
    }
    await seedReminder({ status: REMINDER_STATUS.SENT });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.reminders.enabled).toBe(true);
    expect(data.reminders.rows).toHaveLength(1);
    expect(data.reminders.rows[0].badge.text).toBe("Sent");
  });

  it("carries the snapshot company, the joined order name and the touchpoint label", async () => {
    await seedShopRow(SHOP, new Date("2026-08-01T00:00:00.000Z"));
    const company = await seedCompany({});
    await seedOrder({
      companyId: company.id,
      orderGid: "gid://shopify/Order/5150",
      name: "#1020",
    });
    await seedReminder({
      status: REMINDER_STATUS.SENT,
      orderGid: "gid://shopify/Order/5150",
      companyName: "Acme Industrial",
      touchpoint: TOUCHPOINT.OVERDUE,
      createdAt: new Date("2026-08-19T09:14:00.000Z"),
    });
    await seedReminder({
      status: REMINDER_STATUS.FAILED,
      companyName: null,
      touchpoint: TOUCHPOINT.DUE,
      createdAt: new Date("2026-08-18T09:14:00.000Z"),
    });

    const data = await loadDashboard(SHOP, { now: NOW, locale: "en-GB" });

    expect(data.reminders.rows[0]).toMatchObject({
      companyName: "Acme Industrial",
      orderName: "#1020",
      touchpoint: "Overdue",
      when: "19 Aug 2026, 09:14",
    });
    expect(data.reminders.rows[1].companyName).toBe("—");
    expect(data.reminders.enabledSince).toBe("1 Aug 2026");
  });

  it("never lists another shop's reminders", async () => {
    await seedShopRow(SHOP, new Date("2026-08-01T00:00:00.000Z"));
    await seedReminder({ shop: OTHER_SHOP, status: REMINDER_STATUS.SENT });

    const data = await loadDashboard(SHOP, { now: NOW });

    expect(data.reminders.rows).toHaveLength(0);
  });

  it("keeps the badge vocabulary the merchant is taught", () => {
    expect(reminderBadge(REMINDER_STATUS.SENT)).toEqual({
      text: "Sent",
      tone: "neutral",
      tooltip: null,
    });
    expect(reminderBadge(REMINDER_STATUS.SENT_UNCONFIRMED)).toEqual({
      text: "Sent (unconfirmed)",
      tone: "neutral",
      tooltip: "unconfirmed",
    });
    expect(reminderBadge(REMINDER_STATUS.FAILED)).toEqual({
      text: "Failed",
      tone: "warning",
      tooltip: null,
    });
    expect(reminderBadge(REMINDER_STATUS.DEAD)).toEqual({
      text: "Failed",
      tone: "critical",
      tooltip: "dead",
    });
  });

  it("labels every touchpoint", () => {
    expect(touchpointLabel(TOUCHPOINT.DUE_SOON)).toBe("Due soon");
    expect(touchpointLabel(TOUCHPOINT.DUE)).toBe("Due today");
    expect(touchpointLabel(TOUCHPOINT.OVERDUE)).toBe("Overdue");
  });
});

/* ------------------------------------------------------------------ *
 * Bucketing and serialisation
 * ------------------------------------------------------------------ */

describe("bucketUpcoming", () => {
  it("splits the window at seven days", () => {
    expect(bucketUpcoming(daysFromNow(0, 1), NOW)).toBe("next-7");
    expect(bucketUpcoming(daysFromNow(7), NOW)).toBe("next-7");
    expect(bucketUpcoming(daysFromNow(7, 1), NOW)).toBe("days-8-30");
    expect(bucketUpcoming(daysFromNow(30), NOW)).toBe("days-8-30");
    expect(bucketUpcoming(daysFromNow(31), NOW)).toBeNull();
    expect(bucketUpcoming(daysFromNow(-1), NOW)).toBeNull();
    expect(bucketUpcoming(null, NOW)).toBeNull();
  });
});

describe("DashboardData serialisation", () => {
  it("hands the client strings and plain integers — never a Decimal or a Date", async () => {
    await seedShopRow(SHOP, new Date("2026-08-01T00:00:00.000Z"));
    const company = await seedCompany({
      exposure: "500.0000",
      creditLimit: "1000.0000",
      overdue: true,
      earliestDueAt: new Date("2026-08-10T00:00:00.000Z"),
      blockedState: true,
    });
    const order = await seedOrder({
      companyId: company.id,
      orderGid: "gid://shopify/Order/4242",
      name: "#1042",
      outstandingShop: "500.0000",
    });
    await seedSchedule({ orderId: order.id, dueAt: daysFromNow(2) });
    await seedEvent({
      kind: EVENT_KIND.BYPASSED_ORDER,
      orderGid: "gid://shopify/Order/4242",
      amount: "500.0000",
      channel: "web",
    });
    await seedReminder({
      status: REMINDER_STATUS.SENT,
      orderGid: "gid://shopify/Order/4242",
    });

    const data = await loadDashboard(SHOP, { now: NOW });

    const offenders: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (value === null || value === undefined) return;
      if (value instanceof Date) {
        offenders.push(`${path}: Date`);
        return;
      }
      if (typeof value === "object" && "toFixed" in (value as object)) {
        offenders.push(`${path}: Decimal`);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          walk(item, `${path}[${index}]`);
        });
        return;
      }
      if (typeof value === "object") {
        for (const [key, child] of Object.entries(value as object)) {
          walk(child, `${path}.${key}`);
        }
        return;
      }
      // Money and dates are already strings by the time they get here; the only
      // numbers left are row counts and the feed's page index.
      if (typeof value === "number" && !/(total|page|Count)$/.test(path)) {
        offenders.push(`${path}: number`);
      }
    };
    walk(data, "data");

    expect(offenders).toEqual([]);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });
});

/* ------------------------------------------------------------------ *
 * The page — copy, derivations and source guards
 * ------------------------------------------------------------------ */

const { COPY, bannerFor, overdueEmptyCopy, overdueStatusBadges } =
  await routeModule();

describe("dashboard copy", () => {
  it("keeps the page title and KPI labels the spec fixes", () => {
    expect(COPY.pageTitle).toBe("Credit Guard");
    expect(COPY.kpiTotalOutstanding).toBe("Total outstanding");
    expect(COPY.kpiOverdueCompanies).toBe("Overdue companies");
    expect(COPY.kpiOnCreditHold).toBe("On credit hold");
    expect(COPY.kpiDueIn7Days).toBe("Due in 7 days");
  });

  it("keeps the five section headings and both header links", () => {
    expect(COPY.overdueHeading).toBe("Overdue companies");
    expect(COPY.upcomingHeading).toBe("Due in the next 30 days");
    expect(COPY.closestToLimitHeading).toBe("Closest to limit");
    expect(COPY.feedHeading).toBe("Credit holds and bypasses");
    expect(COPY.remindersHeading).toBe("Payment reminders");
    expect(COPY.viewAllCompanies).toBe("View all companies");
    expect(COPY.reminderSettings).toBe("Reminder settings");
  });

  it("keeps every table's header row byte-exact", () => {
    expect(COPY.overdueHeaders).toEqual([
      "Company",
      "Outstanding",
      "Earliest due",
      "Status",
    ]);
    expect(COPY.upcomingHeaders).toEqual([
      "Order",
      "Company",
      "Due",
      "Outstanding",
    ]);
    expect(COPY.closestToLimitHeaders).toEqual([
      "Company",
      "Outstanding",
      "Credit limit",
      "Utilization",
    ]);
    expect(COPY.feedHeaders).toEqual(["When", "Event", "Details"]);
    expect(COPY.reminderHeaders).toEqual([
      "When",
      "Company",
      "Order",
      "Reminder",
      "Status",
    ]);
  });

  it("keeps the feed intro and every empty state", () => {
    expect(COPY.feedIntro).toBe(
      "A company goes on credit hold when it's over its limit or overdue. Orders listed here went through while a hold was active.",
    );
    expect(COPY.emptyNoCompanies).toBe(
      "No companies yet. Companies from your store's B2B net-terms orders appear here automatically.",
    );
    expect(COPY.emptyNoOverdue).toBe("No overdue companies.");
    expect(COPY.emptyUpcoming).toBe(
      "No net-terms payments due in the next 30 days.",
    );
    expect(COPY.emptyFeed).toBe(
      "No credit holds yet. When a company goes over its limit or overdue, it shows up here.",
    );
    expect(COPY.emptyClosestToLimit).toBe("No companies have a credit limit yet.");
    expect(COPY.setALimit).toBe("Set a limit");
  });

  it("keeps the overflow lines and the tooltips", () => {
    expect(COPY.overdueOverflow("12")).toBe("Showing 10 of 12 overdue companies.");
    expect(COPY.upcomingOverflow("17")).toBe(
      "Showing 15 of 17 upcoming payments.",
    );
    expect(COPY.tooltipIncomplete).toBe(
      "Some orders couldn't be fully matched yet. This total may be incomplete.",
    );
    expect(COPY.tooltipCreditHold).toBe(
      "A company is on credit hold when it's over its credit limit or has an overdue balance, and bypass is off. Its buyers can't complete a new net-terms order.",
    );
    expect(COPY.tooltipUnconfirmed).toBe(
      "The email was handed to the mail provider but delivery wasn't confirmed.",
    );
    expect(COPY.tooltipDead).toBe(
      "Credit Guard stopped retrying this reminder. The next scheduled reminder will still be sent.",
    );
  });

  it("keeps the reminder status line and the off notice (R1, R4)", () => {
    expect(COPY.remindersOnSince("21 Aug 2026")).toBe(
      "Payment reminders are on since 21 Aug 2026.",
    );
    expect(COPY.remindersOffBefore).toBe(
      "Payment reminders are off. Credit Guard never emails your customers until you turn this on in ",
    );
    expect(COPY.remindersOffAfter).toBe(".");
    expect(
      `${COPY.remindersOffBefore}${COPY.reminderSettings}${COPY.remindersOffAfter}`,
    ).toBe(
      "Payment reminders are off. Credit Guard never emails your customers until you turn this on in Reminder settings.",
    );
  });

  /**
   * R2 is composed from 06-02's shared `REMINDERS_CADENCE`, not from a literal
   * of this page's own (W-04). Byte-for-byte is the whole point: a merchant who
   * reads one cadence on Settings and a different one here trusts neither, and
   * two literals that happen to agree today are two literals that drift the
   * first time one is edited.
   */
  it("composes the reminder cadence from the shared constant (R2, W-04)", () => {
    expect(COPY.emptyReminders).toBe(
      `No reminders sent yet. Credit Guard emails a company ${REMINDERS_CADENCE}.`,
    );
    expect(COPY.emptyReminders).toBe(
      "No reminders sent yet. Credit Guard emails a company 3 days before the due date, on the due date, and 3 days after.",
    );
  });

  it("never claims a block it cannot observe (honesty rule, D6-02)", () => {
    const values = JSON.stringify(
      Object.values(COPY).map((value) =>
        typeof value === "function"
          ? (value as (...args: string[]) => string)("1", "2", "3")
          : value,
      ),
    );

    expect(values).not.toContain("blocked $");
    expect(values).not.toMatch(/saved you/i);
    expect(values).not.toMatch(/\bprotected\b/i);
  });
});

describe("banner copy mapping", () => {
  it("maps the backfill banner (B1)", () => {
    expect(bannerFor({ kind: "backfill-running" })).toEqual({
      tone: "info",
      heading: "Still importing your order history",
      body: "Balances and due dates may be incomplete for a few minutes. Credit Guard hasn't changed anything in your store.",
    });
  });

  it("maps the incomplete-balances banner (B2)", () => {
    expect(bannerFor({ kind: "data-incomplete" })).toEqual({
      tone: "info",
      heading: "Some balances may be incomplete",
      body: 'A few net-terms orders couldn\'t be matched to a company yet. Totals on this page leave them out until they\'re matched. Companies affected show "· incomplete" next to their balance.',
    });
  });

  it("maps the singular bypassed-order alert (B3a)", () => {
    expect(
      bannerFor({
        kind: "bypassed-one",
        orderName: "#1015",
        amountLabel: "$250.00",
        companyName: "Acme Industrial",
      }),
    ).toEqual({
      tone: "warning",
      heading: "1 order went through during a credit hold",
      body: "Order #1015 ($250.00) was placed while Acme Industrial was on credit hold in the last 30 days. Orders completed from a draft or with bypass turned on aren't checked.",
    });
  });

  it("maps the plural bypassed-order alert (B3b)", () => {
    expect(
      bannerFor({ kind: "bypassed-many", countLabel: "4", sumLabel: "$900.00" }),
    ).toEqual({
      tone: "warning",
      heading: "4 orders went through during credit holds",
      body: "4 orders totalling $900.00 were placed while companies were on credit hold in the last 30 days. Orders completed from a draft or with bypass turned on aren't checked.",
    });
  });

  it("renders no banner when the loader picked none", () => {
    expect(bannerFor(null)).toBeNull();
  });
});

describe("overdue row rendering", () => {
  it("prefers the credit-hold badge over the implied overdue one", () => {
    expect(
      overdueStatusBadges({ blockedState: true, bypassEnforcement: false }),
    ).toEqual([{ text: "On credit hold", tone: "critical" }]);
  });

  it("falls back to the overdue badge when there is no hold", () => {
    expect(
      overdueStatusBadges({ blockedState: false, bypassEnforcement: false }),
    ).toEqual([{ text: "Overdue", tone: "critical" }]);
  });

  it("adds the bypass badge second, never a third", () => {
    const badges = overdueStatusBadges({
      blockedState: true,
      bypassEnforcement: true,
    });

    expect(badges).toEqual([
      { text: "On credit hold", tone: "critical" },
      { text: "Enforcement bypassed", tone: "caution" },
    ]);
    expect(badges.length).toBeLessThanOrEqual(2);
  });

  it("switches empty copy on whether the shop has companies at all", () => {
    expect(overdueEmptyCopy(0)).toBe(COPY.emptyNoCompanies);
    expect(overdueEmptyCopy(3)).toBe(COPY.emptyNoOverdue);
  });
});

describe("dashboard route source guards", () => {
  const source = sourceWithoutComments("app/routes/app._index.tsx");

  it("imports no Polaris React package", () => {
    expect(source).not.toContain("@shopify/polaris");
  });

  it("uses no attention tone (it does not exist in the catalog)", () => {
    expect(source).not.toContain("attention");
  });

  it("never float-parses money", () => {
    expect(source).not.toContain("parseFloat");
  });

  it("reads the page from the dashboard service", () => {
    expect(source).toContain("loadDashboard");
    expect(source).toContain("session.shop");
  });

  it("makes no Admin API call — the home page survives a Shopify outage", () => {
    expect(source).not.toContain("admin-client");
    expect(source).not.toContain("graphqlJson");
  });

  it("takes its cadence wording from the shared module, not a literal (W-04)", () => {
    expect(source).toContain("reminder-copy");
    expect(source).toContain("REMINDERS_CADENCE");
    // The sentence exists in exactly one place in the app now.
    expect(source).not.toContain("3 days before the due date");
  });
});
