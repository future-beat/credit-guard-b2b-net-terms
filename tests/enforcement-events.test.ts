import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderForLedgerNode } from "../app/services/ledger.server";
import prisma from "../app/db.server";
import { createMockAdmin, type MockAdminClient } from "./helpers/admin-client-mock";
import {
  makeCompanyOrdersResponse,
  makeOrderForLedger,
} from "./fixtures/order-fixtures";

/**
 * ENFC-05 / ENFC-06 — the enforcement observability log (D4-03).
 *
 * Everything below runs against REAL Postgres rows: the predicates are pure,
 * but "exactly one BLOCK_STATE_ENTERED row exists" is a claim about a table,
 * and a mock cannot make it true. Only two seams are faked — the Admin GraphQL
 * transport (so `publishCompanyCreditState` inside `recomputeCompany` is
 * satisfied) and, for the route tests, `authenticate.admin`. That is the same
 * split tests/metafield-publish.test.ts and tests/companies-settings.test.ts
 * use, and it is what makes these assertions worth anything.
 */

const getAdminContext = vi.hoisted(() => vi.fn());

vi.mock("../app/services/admin-client.server", () => ({ getAdminContext }));

const captureException = vi.hoisted(() => vi.fn());
const captureMessage = vi.hoisted(() => vi.fn());

vi.mock("@sentry/react-router", () => ({ captureException, captureMessage }));

const authenticateAdmin = vi.hoisted(() => vi.fn());

vi.mock("../app/shopify.server", () => ({
  authenticate: { admin: authenticateAdmin },
}));

const SHOP = "enforcement-events-test.myshopify.com";
const OTHER_SHOP = "enforcement-events-bystander.myshopify.com";
const COMPANY_GID = "gid://shopify/Company/4001";
const COMPANY_NAME = "Ledger Bound Supply";
const NOW = new Date("2026-09-01T00:00:00.000Z");
const FUTURE_DUE = new Date("2026-09-30T00:00:00.000Z");
const PAST_DUE = new Date("2026-08-01T00:00:00.000Z");

let admin: MockAdminClient;

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

interface CompanySeed {
  shop?: string;
  companyGid?: string;
  name?: string;
  exposure?: string;
  overdue?: boolean;
  creditLimit?: string | null;
  bypassEnforcement?: boolean;
  blockedState?: boolean;
}

async function seedCompany(seed: CompanySeed = {}) {
  return prisma.company.create({
    data: {
      shop: seed.shop ?? SHOP,
      companyGid: seed.companyGid ?? COMPANY_GID,
      name: seed.name ?? COMPANY_NAME,
      exposure: seed.exposure ?? "0",
      overdue: seed.overdue ?? false,
      creditLimit: seed.creditLimit ?? null,
      bypassEnforcement: seed.bypassEnforcement ?? false,
      blockedState: seed.blockedState ?? false,
    },
  });
}

interface OrderSeed {
  shop?: string;
  orderGid?: string;
  companyId: string;
  outstanding: string;
  hasPaymentTerms?: boolean;
  dueAt?: Date | null;
  completedAt?: Date | null;
}

async function seedOrder(seed: OrderSeed) {
  const shop = seed.shop ?? SHOP;
  const orderGid = seed.orderGid ?? "gid://shopify/Order/7001";
  const order = await prisma.ledgerOrder.create({
    data: {
      shop,
      orderGid,
      name: "#2001",
      companyId: seed.companyId,
      attributionStatus: "ATTRIBUTED",
      hasPaymentTerms: seed.hasPaymentTerms ?? true,
      paymentTermsType: "NET",
      financialStatus: "PENDING",
      outstandingShop: seed.outstanding,
      currencyCode: "USD",
      sourceUpdatedAt: NOW,
      refetchedAt: NOW,
    },
  });
  await prisma.ledgerSchedule.create({
    data: {
      shop,
      scheduleGid: `gid://shopify/PaymentSchedule/${order.id}`,
      orderId: order.id,
      dueAt: seed.dueAt === undefined ? FUTURE_DUE : seed.dueAt,
      completedAt: seed.completedAt ?? null,
    },
  });
  return order;
}

async function events(shop = SHOP) {
  return prisma.enforcementEvent.findMany({
    where: { shop },
    orderBy: { createdAt: "asc" },
  });
}

async function kinds(shop = SHOP) {
  return (await events(shop)).map((row) => row.kind);
}

async function companyRow(companyGid = COMPANY_GID, shop = SHOP) {
  const row = await prisma.company.findUnique({
    where: { shop_companyGid: { shop, companyGid } },
  });
  if (!row) throw new Error(`company ${companyGid} vanished`);
  return row;
}

async function wipe(...domains: string[]) {
  await prisma.enforcementEvent.deleteMany({ where: { shop: { in: domains } } });
  await prisma.ledgerSchedule.deleteMany({ where: { shop: { in: domains } } });
  await prisma.ledgerOrder.deleteMany({ where: { shop: { in: domains } } });
  await prisma.company.deleteMany({ where: { shop: { in: domains } } });
  await prisma.syncCursor.deleteMany({ where: { shop: { in: domains } } });
  await prisma.session.deleteMany({ where: { shop: { in: domains } } });
  await prisma.shop.deleteMany({ where: { domain: { in: domains } } });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  admin = createMockAdmin();
  getAdminContext.mockReset();
  getAdminContext.mockResolvedValue(admin);
  authenticateAdmin.mockResolvedValue({ session: { shop: SHOP } });

  await wipe(SHOP, OTHER_SHOP);
  for (const domain of [SHOP, OTHER_SHOP]) {
    await prisma.shop.create({ data: { domain } });
  }
});

afterAll(async () => {
  await wipe(SHOP, OTHER_SHOP);
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ *
 * The pure predicates (P4-L1, P4-L2)
 * ------------------------------------------------------------------ */

describe("isBlockedState — P4-L1", () => {
  const state = (over: Partial<Record<string, unknown>> = {}) => ({
    bypassEnforcement: false,
    creditLimit: new Prisma.Decimal("1000.00"),
    exposure: new Prisma.Decimal("0.00"),
    overdue: false,
    ...over,
  });

  it("is false for an observe-only company however bad its ledger looks (CRED-04)", async () => {
    const { isBlockedState } = await import("../app/services/enforcement.server");
    expect(
      isBlockedState(
        state({
          creditLimit: null,
          exposure: new Prisma.Decimal("999999.00"),
          overdue: true,
        }),
      ),
    ).toBe(false);
  });

  it("is false whenever bypass is on — bypass is the FIRST check (D-03)", async () => {
    const { isBlockedState } = await import("../app/services/enforcement.server");
    expect(
      isBlockedState(
        state({
          bypassEnforcement: true,
          exposure: new Prisma.Decimal("5000.00"),
          overdue: true,
        }),
      ),
    ).toBe(false);
  });

  it("is true on overdue alone, with exposure far under the limit", async () => {
    const { isBlockedState } = await import("../app/services/enforcement.server");
    expect(isBlockedState(state({ overdue: true }))).toBe(true);
  });

  it("treats exposure == limit as blocked and one cent under as not (P4-L1 boundary)", async () => {
    const { isBlockedState } = await import("../app/services/enforcement.server");
    expect(isBlockedState(state({ exposure: new Prisma.Decimal("1000.00") }))).toBe(true);
    expect(isBlockedState(state({ exposure: new Prisma.Decimal("999.99") }))).toBe(false);
  });

  it("never coerces money through a float", async () => {
    const { isBlockedState } = await import("../app/services/enforcement.server");
    // 0.1 + 0.2 in IEEE-754 is 0.30000000000000004; as decimals it is exactly
    // the limit, which under P4-L1 is blocked state.
    expect(
      isBlockedState({
        bypassEnforcement: false,
        creditLimit: new Prisma.Decimal("0.30"),
        exposure: new Prisma.Decimal("0.10").plus(new Prisma.Decimal("0.20")),
        overdue: false,
      }),
    ).toBe(true);
  });
});

describe("wouldBlockOrder — P4-L2 (the D4-01 comparison)", () => {
  const state = (over: Partial<Record<string, unknown>> = {}) => ({
    bypassEnforcement: false,
    creditLimit: new Prisma.Decimal("1000.00"),
    exposure: new Prisma.Decimal("0.00"),
    overdue: false,
    orderOutstanding: new Prisma.Decimal("100.00"),
    ...over,
  });

  it("blocks when exposure + order exceeds the limit, strictly (D4-01)", async () => {
    const { wouldBlockOrder } = await import("../app/services/enforcement.server");
    expect(
      wouldBlockOrder(
        state({
          exposure: new Prisma.Decimal("900.00"),
          orderOutstanding: new Prisma.Decimal("100.01"),
        }),
      ),
    ).toBe(true);
    // Exactly at the limit is allowed — Phase 3's at-limit-is-within boundary.
    expect(
      wouldBlockOrder(
        state({
          exposure: new Prisma.Decimal("900.00"),
          orderOutstanding: new Prisma.Decimal("100.00"),
        }),
      ),
    ).toBe(false);
  });

  it("blocks on overdue regardless of remaining credit", async () => {
    const { wouldBlockOrder } = await import("../app/services/enforcement.server");
    expect(wouldBlockOrder(state({ overdue: true }))).toBe(true);
  });

  it("never blocks observe-only or bypassed companies", async () => {
    const { wouldBlockOrder } = await import("../app/services/enforcement.server");
    expect(wouldBlockOrder(state({ creditLimit: null, overdue: true }))).toBe(false);
    expect(
      wouldBlockOrder(state({ bypassEnforcement: true, overdue: true })),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Task 1 — transition events written by recomputeCompany
 * ------------------------------------------------------------------ */

describe("recomputeCompany — blocked-state transitions (ENFC-05)", () => {
  async function recompute(now: Date = NOW) {
    const { recomputeCompany } = await import("../app/services/ledger.server");
    return recomputeCompany(SHOP, COMPANY_GID, now);
  }

  it("writes exactly one BLOCK_STATE_ENTERED with the transition snapshot", async () => {
    const company = await seedCompany({ creditLimit: "1000.00" });
    await seedOrder({ companyId: company.id, outstanding: "1200.00" });

    await recompute();

    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("BLOCK_STATE_ENTERED");
    expect(rows[0].companyGid).toBe(COMPANY_GID);
    expect(rows[0].companyName).toBe(COMPANY_NAME);
    expect(rows[0].exposure.toFixed(2)).toBe("1200.00");
    expect(rows[0].limit?.toFixed(2)).toBe("1000.00");
    expect(rows[0].overdue).toBe(false);
    expect(rows[0].bypass).toBe(false);
    expect(rows[0].orderGid).toBeNull();
    expect((await companyRow()).blockedState).toBe(true);
  });

  it("does not re-fire while the state is unchanged", async () => {
    const company = await seedCompany({ creditLimit: "1000.00" });
    await seedOrder({ companyId: company.id, outstanding: "1200.00" });

    await recompute();
    await recompute();
    await recompute();

    expect(await kinds()).toEqual(["BLOCK_STATE_ENTERED"]);
  });

  it("writes BLOCK_STATE_EXITED when the balance is settled", async () => {
    const company = await seedCompany({ creditLimit: "1000.00" });
    const order = await seedOrder({ companyId: company.id, outstanding: "1200.00" });
    await recompute();

    // Settled: every schedule completed, so the order stops contributing.
    await prisma.ledgerSchedule.updateMany({
      where: { orderId: order.id },
      data: { completedAt: NOW },
    });
    await recompute();

    expect(await kinds()).toEqual(["BLOCK_STATE_ENTERED", "BLOCK_STATE_EXITED"]);
    const exited = (await events())[1];
    expect(exited.exposure.toFixed(2)).toBe("0.00");
    expect((await companyRow()).blockedState).toBe(false);
  });

  it("transitions on an overdue flip alone, under the limit both times", async () => {
    const company = await seedCompany({ creditLimit: "10000.00" });
    const order = await seedOrder({
      companyId: company.id,
      outstanding: "100.00",
      dueAt: PAST_DUE,
    });

    await recompute();
    expect(await kinds()).toEqual(["BLOCK_STATE_ENTERED"]);
    const entered = (await events())[0];
    expect(entered.overdue).toBe(true);
    expect(entered.exposure.toFixed(2)).toBe("100.00");

    await prisma.ledgerSchedule.updateMany({
      where: { orderId: order.id },
      data: { dueAt: FUTURE_DUE },
    });
    await recompute();

    expect(await kinds()).toEqual(["BLOCK_STATE_ENTERED", "BLOCK_STATE_EXITED"]);
    expect((await companyRow()).blockedState).toBe(false);
  });

  it("enters at exposure == limit and stays quiet one cent below (P4-L1)", async () => {
    const company = await seedCompany({ creditLimit: "1000.00" });
    const order = await seedOrder({ companyId: company.id, outstanding: "999.99" });

    await recompute();
    expect(await events()).toHaveLength(0);
    expect((await companyRow()).blockedState).toBe(false);

    await prisma.ledgerOrder.update({
      where: { id: order.id },
      data: { outstandingShop: "1000.00" },
    });
    await recompute();

    expect(await kinds()).toEqual(["BLOCK_STATE_ENTERED"]);
  });

  it("never blocks an observe-only company, even overdue (CRED-04)", async () => {
    const company = await seedCompany({ creditLimit: null });
    await seedOrder({
      companyId: company.id,
      outstanding: "999999.00",
      dueAt: PAST_DUE,
    });

    await recompute();

    expect(await events()).toHaveLength(0);
    expect((await companyRow()).blockedState).toBe(false);
  });

  it("never blocks a bypassed company (D-03 precedence)", async () => {
    const company = await seedCompany({
      creditLimit: "1000.00",
      bypassEnforcement: true,
    });
    await seedOrder({
      companyId: company.id,
      outstanding: "5000.00",
      dueAt: PAST_DUE,
    });

    await recompute();

    expect(await events()).toHaveLength(0);
    expect((await companyRow()).blockedState).toBe(false);
  });

  it("survives an event-store failure without failing the recompute", async () => {
    const company = await seedCompany({ creditLimit: "1000.00" });
    await seedOrder({ companyId: company.id, outstanding: "1200.00" });

    const create = vi
      .spyOn(prisma.enforcementEvent, "create")
      .mockRejectedValue(new Error("event store down"));

    const state = await recompute();

    expect(create).toHaveBeenCalled();
    // The ledger work still landed — that is the whole point of the posture.
    expect(state?.exposure.toFixed(2)).toBe("1200.00");
    expect((await companyRow()).exposure.toFixed(2)).toBe("1200.00");
    expect(captureException).toHaveBeenCalled();

    create.mockRestore();
    expect(await events()).toHaveLength(0);
  });

  it("keys every row by shop — one store's events never reach another's", async () => {
    const ours = await seedCompany({ creditLimit: "1000.00" });
    await seedOrder({ companyId: ours.id, outstanding: "1200.00" });
    await recompute();

    expect(await events(OTHER_SHOP)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Task 2 — leaked-order inference at attribution time (ENFC-06)
 * ------------------------------------------------------------------ */

const LEAKED_ORDER_GID = "gid://shopify/Order/8001";

/**
 * `sourceName` is spread on locally rather than added to the shared Phase 2
 * fixture builder: this plan owns its own test file, not tests/fixtures.
 */
function leakedOrderNode(
  overrides: Parameters<typeof makeOrderForLedger>[0] & {
    sourceName?: string | null;
  } = {},
): OrderForLedgerNode {
  const { sourceName, ...orderOverrides } = overrides;
  const node = makeOrderForLedger({
    id: LEAKED_ORDER_GID,
    name: "#3001",
    outstanding: "100.00",
    dueAt: FUTURE_DUE.toISOString(),
    ...orderOverrides,
  });
  return sourceName === undefined ? node : { ...node, sourceName };
}

describe("upsertOrderFromSource — BYPASSED_ORDER inference (ENFC-06)", () => {
  /** Drive the real rung-2 path: hinted doorbell, authenticated company edge. */
  async function ingestViaCompanyEdge(node: OrderForLedgerNode) {
    admin.setFixture(
      "CompanyOrdersForLedger",
      makeCompanyOrdersResponse({
        companyGid: COMPANY_GID,
        companyName: COMPANY_NAME,
        orders: [node],
      }),
    );
    const { ingestOrderEvent } = await import("../app/services/ledger.server");
    await ingestOrderEvent(SHOP, node.id, {
      companyGid: COMPANY_GID,
      companyLocationGid: null,
    });
  }

  async function leaks(shop = SHOP) {
    return prisma.enforcementEvent.findMany({
      where: { shop, kind: "BYPASSED_ORDER" },
      orderBy: { createdAt: "asc" },
    });
  }

  it("flags an order that arrives while the company is already blocked", async () => {
    const company = await seedCompany({
      creditLimit: "1000.00",
      exposure: "1200.00",
      blockedState: true,
    });
    await seedOrder({ companyId: company.id, outstanding: "1200.00" });

    await ingestViaCompanyEdge(
      leakedOrderNode({ sourceName: "shopify_draft_order" }),
    );

    const rows = await leaks();
    expect(rows).toHaveLength(1);
    expect(rows[0].orderGid).toBe(LEAKED_ORDER_GID);
    expect(rows[0].amount?.toFixed(2)).toBe("100.00");
    expect(rows[0].channel).toBe("shopify_draft_order");
    expect(rows[0].companyGid).toBe(COMPANY_GID);
    expect(rows[0].companyName).toBe(COMPANY_NAME);
    // The snapshot is the PRE-order state, not the post-recompute one.
    expect(rows[0].exposure.toFixed(2)).toBe("1200.00");
    expect(rows[0].limit?.toFixed(2)).toBe("1000.00");
    expect(rows[0].bypass).toBe(false);
  });

  it("flags an order whose own total exceeds remaining credit (P4-L2 > P4-L1)", async () => {
    // The company is NOT in blocked state: $900 of a $1,000 limit, not overdue.
    // The $200 order is what breaks it — the exact D4-01 comparison.
    const company = await seedCompany({
      creditLimit: "1000.00",
      exposure: "900.00",
    });
    await seedOrder({ companyId: company.id, outstanding: "900.00" });

    await ingestViaCompanyEdge(
      leakedOrderNode({ outstanding: "200.00", sourceName: "pos" }),
    );

    expect(await kinds()).toEqual(["BYPASSED_ORDER", "BLOCK_STATE_ENTERED"]);
    const leak = (await leaks())[0];
    expect(leak.exposure.toFixed(2)).toBe("900.00");
    expect(leak.amount?.toFixed(2)).toBe("200.00");
    expect(leak.channel).toBe("pos");
  });

  it("does not flag an order that fits inside remaining credit", async () => {
    const company = await seedCompany({
      creditLimit: "1000.00",
      exposure: "800.00",
    });
    await seedOrder({ companyId: company.id, outstanding: "800.00" });

    await ingestViaCompanyEdge(leakedOrderNode({ outstanding: "200.00" }));

    expect(await leaks()).toHaveLength(0);
  });

  it("records `unknown` when Shopify returns no sourceName", async () => {
    const company = await seedCompany({
      creditLimit: "1000.00",
      exposure: "1200.00",
      blockedState: true,
    });
    await seedOrder({ companyId: company.id, outstanding: "1200.00" });

    await ingestViaCompanyEdge(leakedOrderNode({ sourceName: null }));

    expect((await leaks())[0].channel).toBe("unknown");
  });

  it("never double-flags across a redelivered doorbell", async () => {
    const company = await seedCompany({
      creditLimit: "1000.00",
      exposure: "1200.00",
      blockedState: true,
    });
    await seedOrder({ companyId: company.id, outstanding: "1200.00" });

    const node = leakedOrderNode({ sourceName: "web" });
    await ingestViaCompanyEdge(node);
    // Redelivery: the row is now known, so this takes rung 1 (refetch +
    // preserve-mode) — the order is still attributed, still over the line.
    admin.setFixture("OrderForLedger", { data: { order: node } });
    const { ingestOrderEvent } = await import("../app/services/ledger.server");
    await ingestOrderEvent(SHOP, node.id, {
      companyGid: COMPANY_GID,
      companyLocationGid: null,
    });
    await ingestOrderEvent(SHOP, node.id, null);

    expect(await leaks()).toHaveLength(1);
  });

  it("holds the dedupe at the database even if the pre-read misses", async () => {
    const { recordEnforcementEvent } = await import(
      "../app/services/enforcement.server"
    );
    const row = {
      companyGid: COMPANY_GID,
      companyName: COMPANY_NAME,
      kind: "BYPASSED_ORDER" as const,
      orderGid: LEAKED_ORDER_GID,
      amount: "100.00",
      channel: "web",
      exposure: "1200.00",
      limit: "1000.00",
      overdue: false,
      bypass: false,
    };

    await recordEnforcementEvent(SHOP, row);
    await recordEnforcementEvent(SHOP, row);

    expect(await leaks()).toHaveLength(1);
    // A duplicate is the dedupe working, not an incident.
    expect(captureException).not.toHaveBeenCalled();
  });

  it("never flags a card-paid order — it was never credit (D-02)", async () => {
    const company = await seedCompany({
      creditLimit: "1000.00",
      exposure: "1200.00",
      blockedState: true,
    });
    await seedOrder({ companyId: company.id, outstanding: "1200.00" });

    await ingestViaCompanyEdge(
      leakedOrderNode({ paymentTerms: null, sourceName: "web" }),
    );

    expect(await leaks()).toHaveLength(0);
  });

  it("flags at attribution time when the order arrived UNRESOLVED first", async () => {
    const company = await seedCompany({
      creditLimit: "1000.00",
      exposure: "1200.00",
      blockedState: true,
    });
    await seedOrder({ companyId: company.id, outstanding: "1200.00" });

    const { upsertOrderFromSource } = await import(
      "../app/services/ledger.server"
    );
    const node = leakedOrderNode({ sourceName: "web" });

    // Rung 3: persisted UNRESOLVED, contributing nothing, flagged by nothing.
    await upsertOrderFromSource(SHOP, node, { kind: "unresolved" });
    expect(await leaks()).toHaveLength(0);

    // The reconciliation later proves the company edge — THAT is attribution
    // time, and the honest approximation of "at ingest".
    await upsertOrderFromSource(SHOP, node, {
      kind: "company",
      companyGid: COMPANY_GID,
      companyName: COMPANY_NAME,
      companyLocationGid: null,
    });

    expect(await leaks()).toHaveLength(1);
  });

  it("never flags for an observe-only company, even overdue (CRED-04)", async () => {
    const company = await seedCompany({
      creditLimit: null,
      exposure: "999999.00",
      overdue: true,
    });
    await seedOrder({
      companyId: company.id,
      outstanding: "999999.00",
      dueAt: PAST_DUE,
    });

    await ingestViaCompanyEdge(leakedOrderNode({ sourceName: "web" }));

    expect(await leaks()).toHaveLength(0);
  });

  it("never flags for a bypassed company (D-03)", async () => {
    const company = await seedCompany({
      creditLimit: "1000.00",
      exposure: "1200.00",
      overdue: true,
      bypassEnforcement: true,
    });
    await seedOrder({
      companyId: company.id,
      outstanding: "1200.00",
      dueAt: PAST_DUE,
    });

    await ingestViaCompanyEdge(leakedOrderNode({ sourceName: "web" }));

    expect(await leaks()).toHaveLength(0);
  });

  it("leaves the ledger untouched by an event-store failure (T-04-07)", async () => {
    const company = await seedCompany({
      creditLimit: "1000.00",
      exposure: "1200.00",
      blockedState: true,
    });
    await seedOrder({ companyId: company.id, outstanding: "1200.00" });

    const create = vi
      .spyOn(prisma.enforcementEvent, "create")
      .mockRejectedValue(new Error("event store down"));

    await ingestViaCompanyEdge(leakedOrderNode({ sourceName: "web" }));

    create.mockRestore();

    // The leaked order still counts against the balance — ENFC-06's first half.
    const order = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: LEAKED_ORDER_GID } },
    });
    expect(order?.attributionStatus).toBe("ATTRIBUTED");
    expect((await companyRow()).exposure.toFixed(2)).toBe("1300.00");
    expect(captureException).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * Task 3 — bypass audit events, written by the real settings action
 * ------------------------------------------------------------------ */

describe("set-bypass — audit events and the transitions they cause", () => {
  const ENDPOINT = "https://app.creditguard.test/app/companies";

  async function setBypass(companyId: string, bypass: boolean) {
    const body = new FormData();
    body.append("intent", "set-bypass");
    body.append("companyId", companyId);
    body.append("bypass", String(bypass));

    const { action } = await import("../app/routes/app.companies");
    const request = new Request(ENDPOINT, { method: "POST", body });
    return action({ request, params: {}, context: {} } as never);
  }

  /** A company genuinely over its limit, with the ledger row to prove it. */
  async function seedBlockedCompany() {
    const company = await seedCompany({
      creditLimit: "1000.00",
      exposure: "1200.00",
      blockedState: true,
    });
    await seedOrder({ companyId: company.id, outstanding: "1200.00" });
    return company;
  }

  it("writes BYPASS_ENABLED plus the BLOCK_STATE_EXITED it causes", async () => {
    const company = await seedBlockedCompany();

    await setBypass(company.id, true);

    // Causal order: the merchant's act, then its consequence.
    expect(await kinds()).toEqual(["BYPASS_ENABLED", "BLOCK_STATE_EXITED"]);

    const [audit, exited] = await events();
    expect(audit.companyGid).toBe(COMPANY_GID);
    expect(audit.companyName).toBe(COMPANY_NAME);
    expect(audit.orderGid).toBeNull();
    expect(audit.amount).toBeNull();
    expect(audit.exposure.toFixed(2)).toBe("1200.00");
    expect(audit.limit?.toFixed(2)).toBe("1000.00");
    expect(audit.overdue).toBe(false);
    // The state the toggle left behind.
    expect(audit.bypass).toBe(true);

    // And the transition really is the recompute's, not the route's.
    expect(exited.bypass).toBe(true);
    expect((await companyRow()).blockedState).toBe(false);
  });

  it("writes BYPASS_DISABLED plus the BLOCK_STATE_ENTERED it causes", async () => {
    const company = await seedBlockedCompany();
    await setBypass(company.id, true);

    await setBypass(company.id, false);

    expect(await kinds()).toEqual([
      "BYPASS_ENABLED",
      "BLOCK_STATE_EXITED",
      "BYPASS_DISABLED",
      "BLOCK_STATE_ENTERED",
    ]);
    expect((await companyRow()).blockedState).toBe(true);
  });

  it("records every flip — audit rows never dedupe each other", async () => {
    const company = await seedBlockedCompany();

    await setBypass(company.id, true);
    await setBypass(company.id, false);
    await setBypass(company.id, true);

    const enabled = (await events()).filter(
      (row) => row.kind === "BYPASS_ENABLED",
    );
    // The [shop, kind, orderGid] index constrains BYPASSED_ORDER only: Postgres
    // treats these NULL orderGids as distinct, which is what the schema comment
    // promises and what an audit trail requires.
    expect(enabled).toHaveLength(2);
  });

  it("writes nothing when the write itself was refused", async () => {
    await seedBlockedCompany();

    // A forged id from another store: rule 1 stops it before any mutation, so
    // there is no act to audit.
    const result = await setBypass("not-a-real-company-id", true);
    expect((result as { init?: { status?: number } }).init?.status).toBe(404);
    expect(await events()).toHaveLength(0);
  });

  it("never fails the merchant's save when the event store is down", async () => {
    const company = await seedBlockedCompany();

    const create = vi
      .spyOn(prisma.enforcementEvent, "create")
      .mockRejectedValue(new Error("event store down"));

    const result = await setBypass(company.id, true);

    create.mockRestore();

    expect((result as { data: { ok: boolean } }).data.ok).toBe(true);
    // The toggle SAVED — that is what the toast reports and what must be true.
    expect((await companyRow()).bypassEnforcement).toBe(true);
    expect(captureException).toHaveBeenCalled();
  });
});
