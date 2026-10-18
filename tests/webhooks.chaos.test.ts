import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import { createMockAdmin, type MockAdminClient } from "./helpers/admin-client-mock";
import type { OrderForLedgerNode } from "../app/services/ledger.server";
import {
  FIXTURE_COMPANY_GID,
  FIXTURE_ORDER_GID,
  makeCompanyOrdersResponse,
  makeOrderForLedgerResponse,
} from "./fixtures/order-fixtures";
import { signedWebhookRequest } from "./helpers/webhook-hmac";

/**
 * LEDG-02/LEDG-03 — the chaos suite. The phase's non-negotiable correctness
 * proof (02-CONTEXT § Specific Ideas).
 *
 * Shopify's delivery guarantee is at-least-once and unordered. In production this
 * app WILL see the same delivery twice, a redelivery of a long-stale event, an
 * `orders/updated` that overtakes its own `orders/create`, and a payment that is
 * only ever announced as `orders/updated` because coalescing swallowed the
 * `orders/paid` (research Pitfall 3). "A false block of a paid customer is an
 * instant uninstall" — so none of that may corrupt a balance.
 *
 * THE INVARIANT EVERY TEST HERE ASSERTS:
 *
 *     however the deliveries arrive, the final ledger state is byte-identical to
 *     the state a SINGLE clean recompute of the current source would produce.
 *
 * 02-06 moved attribution to the company-side edge (WINDOWS defect 5): the
 * first delivery of an unknown hinted order attributes over
 * CompanyOrdersForLedger (ladder rung 2) and every later delivery refreshes via
 * the reduced OrderForLedger (rung 1). ONLY the mechanism changed — every
 * convergence assertion below is numerically identical to its pre-rework
 * expectation, which is the point of the rework.
 *
 * That is the executable form of "recompute from source, never increment". Each
 * test builds a `baseline` — one delivery against the final source state — and a
 * `chaos` replay of the same reality delivered badly, then deep-equals their
 * normalised snapshots. If the ingest path ever grows incremental arithmetic or
 * topic-specific ledger behaviour, these deep-equals are what break.
 *
 * Suites are serial (`fileParallelism: false`) — every scenario owns the whole
 * shop and wipes it, so parallel files would race on the same rows.
 */
const getAdminContext = vi.hoisted(() => vi.fn());

vi.mock("../app/services/admin-client.server", () => ({ getAdminContext }));

const SHOP = "chaos-test.myshopify.com";
const ENDPOINT = "https://app.creditguard.test/webhooks/orders";

/** Source states the scenarios move between, newest-truth last. */
const UNPAID = makeOrderForLedgerResponse({
  outstanding: "500.00",
  displayFinancialStatus: "PENDING",
});
const PARTIALLY_PAID = makeOrderForLedgerResponse({
  outstanding: "200.00",
  received: "300.00",
  displayFinancialStatus: "PARTIALLY_PAID",
});
const FULLY_PAID = makeOrderForLedgerResponse({
  outstanding: "0.00",
  received: "500.00",
  displayFinancialStatus: "PAID",
  // A settled order's schedule is completed at the source — which is what makes
  // it stop contributing, rather than any rule about its outstanding total.
  completedAt: "2026-08-20T00:00:00.000Z",
});

interface Step {
  topic: string;
  webhookId: string;
  /** The state the Admin API would return if refetched at this instant. */
  source: unknown;
}

/**
 * A doorbell payload. The wrong `total_price` is deliberate: any code that ever
 * believes a payload amount will show up as a snapshot mismatch here. The
 * company block is the B2B hint the ladder's rung 2 scans with.
 */
function orderPayload() {
  return {
    id: 5001,
    admin_graphql_api_id: FIXTURE_ORDER_GID,
    total_price: "999999.99",
    company: { id: 1001, location_id: 2001 },
  };
}

/**
 * The company-edge page consistent with a source state: whatever the Admin API
 * would say about the order right now is also what the company's authenticated
 * orders connection lists at that instant.
 */
function companyPageFor(source: unknown) {
  const order = (source as { data: { order: OrderForLedgerNode } }).data.order;
  return makeCompanyOrdersResponse({ orders: [order] });
}

function delivery(topic: string, webhookId: string) {
  return signedWebhookRequest(ENDPOINT, topic, SHOP, orderPayload(), undefined, {
    webhookId,
  });
}

async function ordersResponse(request: Request): Promise<Response> {
  const { action } = await import("../app/routes/webhooks.orders");
  try {
    return await action({ request, params: {}, context: {} } as never);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

async function wipe() {
  await prisma.ledgerSchedule.deleteMany({ where: { shop: SHOP } });
  await prisma.ledgerOrder.deleteMany({ where: { shop: SHOP } });
  await prisma.company.deleteMany({ where: { shop: SHOP } });
  await prisma.webhookReceipt.deleteMany({ where: { shop: SHOP } });
  await prisma.syncCursor.deleteMany({ where: { shop: SHOP } });
}

/**
 * The ledger state that matters, with every volatile field removed.
 *
 * Row ids, `createdAt`, `refetchedAt` and `recomputedAt` differ between two runs
 * by construction and say nothing about correctness, so they are excluded.
 * Everything a merchant could actually be harmed by — money, dates, overdue,
 * company linkage — is in.
 */
async function snapshot() {
  const companies = await prisma.company.findMany({
    where: { shop: SHOP },
    orderBy: { companyGid: "asc" },
  });
  const orders = await prisma.ledgerOrder.findMany({
    where: { shop: SHOP },
    orderBy: { orderGid: "asc" },
    include: {
      company: true,
      schedules: { orderBy: { scheduleGid: "asc" } },
    },
  });

  return {
    companies: companies.map((company) => ({
      companyGid: company.companyGid,
      name: company.name,
      exposure: company.exposure.toFixed(4),
      overdue: company.overdue,
      earliestDueAt: company.earliestDueAt?.toISOString() ?? null,
    })),
    orders: orders.map((order) => ({
      orderGid: order.orderGid,
      name: order.name,
      companyGid: order.company?.companyGid ?? null,
      attributionStatus: order.attributionStatus,
      companyLocationGid: order.companyLocationGid,
      hasPaymentTerms: order.hasPaymentTerms,
      paymentTermsType: order.paymentTermsType,
      financialStatus: order.financialStatus,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      outstandingShop: order.outstandingShop.toFixed(4),
      currencyCode: order.currencyCode,
      schedules: order.schedules.map((schedule) => ({
        scheduleGid: schedule.scheduleGid,
        dueAt: schedule.dueAt?.toISOString() ?? null,
        completedAt: schedule.completedAt?.toISOString() ?? null,
      })),
    })),
  };
}

type Snapshot = Awaited<ReturnType<typeof snapshot>>;

interface Replay {
  state: Snapshot;
  admin: MockAdminClient;
}

/** Wipe the shop, deliver the sequence, and snapshot what the ledger believes. */
async function replay(steps: Step[]): Promise<Replay> {
  await wipe();
  const admin = createMockAdmin();
  getAdminContext.mockReset();
  getAdminContext.mockResolvedValue(admin);

  for (const step of steps) {
    // The Admin API answers with the source state as it is AT THIS INSTANT —
    // never with the state implied by the delivery's topic or age. Both the
    // single-order refetch (rung 1) and the company edge (rung 2) speak the
    // same instantaneous truth.
    admin.setFixture("OrderForLedger", step.source);
    admin.setFixture("CompanyOrdersForLedger", companyPageFor(step.source));
    const response = await ordersResponse(delivery(step.topic, step.webhookId));
    expect(response.status).toBe(200);
  }

  return { state: await snapshot(), admin };
}

/** The reference: one clean delivery against the final source state. */
async function baseline(source: unknown): Promise<Replay> {
  return replay([
    { topic: "orders/updated", webhookId: "baseline-delivery", source },
  ]);
}

beforeEach(async () => {
  await wipe();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe("duplicate delivery", () => {
  it("processes one refetch and converges to the clean-recompute baseline", async () => {
    const chaos = await replay([
      { topic: "orders/updated", webhookId: "dup-same-id", source: UNPAID },
      // Byte-identical redelivery: Shopify retried because our ack was slow.
      { topic: "orders/updated", webhookId: "dup-same-id", source: UNPAID },
    ]);

    // The dedupe claim held: the second delivery did no work at all. The one
    // admin call is the first delivery's company-edge attribution scan.
    expect(chaos.admin.callCount("CompanyOrdersForLedger")).toBe(1);
    expect(chaos.admin.callCount("OrderForLedger")).toBe(0);
    expect(await prisma.webhookReceipt.count({ where: { shop: SHOP } })).toBe(1);

    const reference = await baseline(UNPAID);
    expect(chaos.state).toEqual(reference.state);
  });

  it("stays convergent when the duplicate carries a DISTINCT webhook id", async () => {
    // Same event, new id — dedupe cannot help, so idempotent upserts must.
    const chaos = await replay([
      { topic: "orders/updated", webhookId: "dup-id-a", source: UNPAID },
      { topic: "orders/updated", webhookId: "dup-id-b", source: UNPAID },
    ]);

    // First delivery attributed over the company edge; the second found a
    // known row and refreshed it with a single-order refetch.
    expect(chaos.admin.callCount("CompanyOrdersForLedger")).toBe(1);
    expect(chaos.admin.callCount("OrderForLedger")).toBe(1);
    // Two deliveries, still exactly one order and one schedule — no duplication.
    expect(await prisma.ledgerOrder.count({ where: { shop: SHOP } })).toBe(1);
    expect(await prisma.ledgerSchedule.count({ where: { shop: SHOP } })).toBe(1);

    const reference = await baseline(UNPAID);
    expect(chaos.state).toEqual(reference.state);
  });
});

describe("replayed stale delivery", () => {
  it("ignores the staleness of an old orders/create redelivered after newer state", async () => {
    // The order was created, then paid down. Hours later Shopify redelivers the
    // original orders/create. Because the payload is a doorbell and the refetch
    // returns CURRENT truth, the stale event cannot resurrect the old balance.
    const chaos = await replay([
      { topic: "orders/create", webhookId: "stale-create-1", source: UNPAID },
      { topic: "orders/updated", webhookId: "stale-update-1", source: PARTIALLY_PAID },
      { topic: "orders/create", webhookId: "stale-create-replay", source: PARTIALLY_PAID },
    ]);

    const reference = await baseline(PARTIALLY_PAID);
    expect(chaos.state).toEqual(reference.state);
    expect(chaos.state.companies[0].exposure).toBe("200.0000");
  });
});

describe("out-of-order delivery", () => {
  it("converges when orders/updated overtakes its own orders/create", async () => {
    // Both events already happened at the source, so a refetch at either arrival
    // returns the same final truth — which is exactly why order cannot matter.
    const chaos = await replay([
      { topic: "orders/updated", webhookId: "ooo-update", source: PARTIALLY_PAID },
      { topic: "orders/create", webhookId: "ooo-create", source: PARTIALLY_PAID },
    ]);

    const inOrder = await replay([
      { topic: "orders/create", webhookId: "ino-create", source: PARTIALLY_PAID },
      { topic: "orders/updated", webhookId: "ino-update", source: PARTIALLY_PAID },
    ]);

    expect(chaos.state).toEqual(inOrder.state);

    const reference = await baseline(PARTIALLY_PAID);
    expect(chaos.state).toEqual(reference.state);
  });
});

describe("coalesced payment — orders/paid never arrives (research Pitfall 3)", () => {
  it("converges a partial payment announced only as orders/updated", async () => {
    const chaos = await replay([
      { topic: "orders/create", webhookId: "coalesce-create", source: UNPAID },
      // The payment fired orders/updated and orders/paid within ~15s, so Shopify
      // delivered only the former. A topic-name-driven ledger would lose $300.
      { topic: "orders/updated", webhookId: "coalesce-partial", source: PARTIALLY_PAID },
    ]);

    expect(chaos.state.companies[0].exposure).toBe("200.0000");

    const reference = await baseline(PARTIALLY_PAID);
    expect(chaos.state).toEqual(reference.state);
  });

  it("drops the contribution to zero when the order settles, still without orders/paid", async () => {
    const steps: Step[] = [
      { topic: "orders/create", webhookId: "settle-create", source: UNPAID },
      { topic: "orders/updated", webhookId: "settle-partial", source: PARTIALLY_PAID },
      { topic: "orders/updated", webhookId: "settle-full", source: FULLY_PAID },
    ];

    // The guarantee under test, stated as an assertion: no orders/paid anywhere.
    expect(steps.some((step) => step.topic === "orders/paid")).toBe(false);

    const chaos = await replay(steps);

    const company = chaos.state.companies[0];
    expect(company.exposure).toBe("0.0000");
    // A settled order owes nothing and is therefore not overdue and has no open
    // due date, whatever the calendar says.
    expect(company.overdue).toBe(false);
    expect(company.earliestDueAt).toBeNull();
    // The order row survives as history, marked settled at the source.
    expect(chaos.state.orders[0].financialStatus).toBe("PAID");
    expect(chaos.state.orders[0].schedules[0].completedAt).not.toBeNull();

    const reference = await baseline(FULLY_PAID);
    expect(chaos.state).toEqual(reference.state);
  });
});

describe("the whole storm at once", () => {
  it("converges under duplicates, replays, reordering and coalescing combined", async () => {
    const chaos = await replay([
      // Reordered: the update lands before the create.
      { topic: "orders/updated", webhookId: "storm-1", source: UNPAID },
      { topic: "orders/create", webhookId: "storm-2", source: UNPAID },
      // Duplicate of storm-2, retried by Shopify.
      { topic: "orders/create", webhookId: "storm-2", source: UNPAID },
      // Coalesced partial payment.
      { topic: "orders/updated", webhookId: "storm-3", source: PARTIALLY_PAID },
      // A stale create redelivered long after the payment.
      { topic: "orders/create", webhookId: "storm-4", source: PARTIALLY_PAID },
      // Settlement, again only as orders/updated.
      { topic: "orders/updated", webhookId: "storm-5", source: FULLY_PAID },
      // And one more duplicate for good measure.
      { topic: "orders/updated", webhookId: "storm-5", source: FULLY_PAID },
    ]);

    // Seven deliveries, five unique ids -> five ingests: one company-edge
    // attribution scan (the first) plus four known-row refetches.
    expect(chaos.admin.callCount("CompanyOrdersForLedger")).toBe(1);
    expect(chaos.admin.callCount("OrderForLedger")).toBe(4);
    expect(await prisma.ledgerOrder.count({ where: { shop: SHOP } })).toBe(1);
    expect(await prisma.ledgerSchedule.count({ where: { shop: SHOP } })).toBe(1);

    const reference = await baseline(FULLY_PAID);
    expect(chaos.state).toEqual(reference.state);
    expect(chaos.state.companies[0].companyGid).toBe(FIXTURE_COMPANY_GID);
    expect(chaos.state.companies[0].exposure).toBe("0.0000");
  });
});
