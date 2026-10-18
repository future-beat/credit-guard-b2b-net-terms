import { afterAll, beforeEach, describe, expect, it } from "vitest";

import prisma from "../app/db.server";
import {
  computeCompanyState,
  upsertOrderFromSource,
} from "../app/services/ledger.server";
import {
  AFTER_DUE,
  BEFORE_DUE,
  FIXTURE_COMPANY_GID,
  FIXTURE_DUE_DATE,
  makeOrderForLedger,
  makeOrderState,
} from "./fixtures/order-fixtures";

/**
 * LEDG-03 — the exposure matrix (D-01 / D-02 / D-07), plus the probe edges the
 * plan calls out: empty input, the overdue adjacency boundary, and order
 * independence.
 *
 * These are pure-function tests on purpose. The engine takes plain data and an
 * explicit `now`, so the "is it late yet" boundary can be sat on exactly rather
 * than approached with a sleep, and the whole matrix runs in milliseconds with
 * no database and no GraphQL mocking.
 *
 * The one DB-backed block at the bottom covers attribution, which is a
 * persistence question rather than an arithmetic one.
 */

const SHOP = "credit-engine-test.myshopify.com";
const OTHER_SHOP = "credit-engine-bystander.myshopify.com";

function exposureOf(orders: Parameters<typeof computeCompanyState>[0], now = BEFORE_DUE) {
  return computeCompanyState(orders, now).exposure.toFixed(2);
}

describe("exposure — what counts (D-01)", () => {
  it("counts an unpaid net-terms order at its full outstanding balance", () => {
    expect(exposureOf([makeOrderState({ outstanding: "500.00" })])).toBe("500.00");
  });

  it("counts a partially-paid order at its REMAINING balance, not its total (D-02)", () => {
    // $500 order, $300 received: the refetched outstanding is what's left.
    expect(exposureOf([makeOrderState({ outstanding: "200.00" })])).toBe("200.00");
  });

  it("follows a refund down to the refetched outstanding (LEDG-03)", () => {
    const before = makeOrderState({ outstanding: "500.00" });
    const afterRefund = makeOrderState({ outstanding: "350.00" });

    expect(exposureOf([before])).toBe("500.00");
    expect(exposureOf([afterRefund])).toBe("350.00");
  });

  it("follows an edited-down order to the refetched outstanding (LEDG-03)", () => {
    expect(exposureOf([makeOrderState({ outstanding: "125.50" })])).toBe("125.50");
  });

  it("sums across a company's qualifying orders", () => {
    const orders = [
      makeOrderState({ outstanding: "500.00" }),
      makeOrderState({ outstanding: "250.25" }),
      makeOrderState({ outstanding: "0.75" }),
    ];

    expect(exposureOf(orders)).toBe("751.00");
  });
});

describe("exposure — what does NOT count (D-02)", () => {
  it("excludes a cancelled order", () => {
    expect(
      exposureOf([makeOrderState({ cancelledAt: new Date("2026-08-05T00:00:00Z") })]),
    ).toBe("0.00");
  });

  it("excludes a card-paid order — no payment terms, no credit extended", () => {
    expect(exposureOf([makeOrderState({ hasPaymentTerms: false })])).toBe("0.00");
  });

  it("excludes an order whose schedules are all completed", () => {
    const settled = makeOrderState({
      schedules: [
        { dueAt: FIXTURE_DUE_DATE, completedAt: new Date("2026-08-20T00:00:00Z") },
      ],
    });

    expect(exposureOf([settled])).toBe("0.00");
  });

  it("still counts an order with one completed and one open schedule", () => {
    const partly = makeOrderState({
      outstanding: "250.00",
      schedules: [
        { dueAt: FIXTURE_DUE_DATE, completedAt: new Date("2026-08-20T00:00:00Z") },
        { dueAt: new Date("2026-09-30T00:00:00Z"), completedAt: null },
      ],
    });

    expect(exposureOf([partly])).toBe("250.00");
  });

  it("excludes a terms-bearing order with no schedules at all", () => {
    expect(exposureOf([makeOrderState({ schedules: [] })])).toBe("0.00");
  });

  it("mixes qualifying and excluded orders correctly", () => {
    const orders = [
      makeOrderState({ outstanding: "500.00" }),
      makeOrderState({ outstanding: "900.00", hasPaymentTerms: false }),
      makeOrderState({ outstanding: "700.00", cancelledAt: new Date() }),
      makeOrderState({
        outstanding: "600.00",
        completedAt: new Date("2026-08-02T00:00:00Z"),
      }),
    ];

    expect(exposureOf(orders)).toBe("500.00");
  });
});

describe("overdue and earliestDueAt (D-04 strict-past)", () => {
  it("is not overdue when the due date is still ahead", () => {
    const state = computeCompanyState([makeOrderState()], BEFORE_DUE);

    expect(state.overdue).toBe(false);
    expect(state.earliestDueAt).toEqual(FIXTURE_DUE_DATE);
  });

  it("is NOT overdue at the exact due instant — adjacency edge", () => {
    const state = computeCompanyState([makeOrderState()], FIXTURE_DUE_DATE);

    expect(state.overdue).toBe(false);
  });

  it("is overdue one millisecond past the due instant", () => {
    const oneMsLate = new Date(FIXTURE_DUE_DATE.getTime() + 1);
    const state = computeCompanyState([makeOrderState()], oneMsLate);

    expect(state.overdue).toBe(true);
  });

  it("reports the earliest OPEN due date across orders", () => {
    const early = new Date("2026-08-10T00:00:00.000Z");
    const orders = [
      makeOrderState({ dueAt: new Date("2026-10-01T00:00:00.000Z") }),
      makeOrderState({ dueAt: early }),
      // Completed schedules are settled; their dates must not win.
      makeOrderState({
        dueAt: new Date("2026-08-02T00:00:00.000Z"),
        completedAt: new Date("2026-08-03T00:00:00.000Z"),
      }),
    ];

    expect(computeCompanyState(orders, BEFORE_DUE).earliestDueAt).toEqual(early);
  });

  it("ignores a lapsed due date on a cancelled or settled order", () => {
    const orders = [
      makeOrderState({ cancelledAt: new Date("2026-08-02T00:00:00Z") }),
      makeOrderState({ completedAt: new Date("2026-08-02T00:00:00Z") }),
      makeOrderState({ hasPaymentTerms: false }),
    ];

    const state = computeCompanyState(orders, AFTER_DUE);

    expect(state.overdue).toBe(false);
    expect(state.earliestDueAt).toBeNull();
    expect(state.exposure.toFixed(2)).toBe("0.00");
  });

  it("leaves earliestDueAt null when an open schedule has no due date", () => {
    const state = computeCompanyState([makeOrderState({ dueAt: null })], AFTER_DUE);

    expect(state.exposure.toFixed(2)).toBe("500.00");
    expect(state.earliestDueAt).toBeNull();
    expect(state.overdue).toBe(false);
  });
});

describe("probe edges", () => {
  it("returns the zero state for a company with no orders", () => {
    const state = computeCompanyState([], AFTER_DUE);

    expect(state.exposure.toFixed(2)).toBe("0.00");
    expect(state.overdue).toBe(false);
    expect(state.earliestDueAt).toBeNull();
    expect(state.currencyMismatch).toBe(false);
  });

  it("is order-independent — every permutation yields the same state", () => {
    const a = makeOrderState({ outstanding: "100.10", dueAt: AFTER_DUE });
    const b = makeOrderState({
      outstanding: "200.20",
      dueAt: new Date("2026-08-05T00:00:00.000Z"),
    });
    const c = makeOrderState({ outstanding: "300.30", hasPaymentTerms: false });

    const permutations = [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ];

    const results = permutations.map((orders) => {
      const state = computeCompanyState(orders, BEFORE_DUE);
      return {
        exposure: state.exposure.toFixed(4),
        overdue: state.overdue,
        earliestDueAt: state.earliestDueAt?.toISOString() ?? null,
        currencyMismatch: state.currencyMismatch,
      };
    });

    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
    expect(results[0].exposure).toBe("300.3000");
    expect(results[0].overdue).toBe(true);
  });

  it("lets an over-refunded order net against the company's other debt", () => {
    // A refund past the collected amount leaves a negative outstanding: the
    // merchant owes the buyer that much. Netting it is deliberate — it matches
    // what the merchant sees in admin, and clamping it to zero would OVERSTATE
    // exposure, which is the direction that falsely blocks a paying buyer.
    const orders = [
      makeOrderState({ outstanding: "500.00" }),
      makeOrderState({ outstanding: "-100.00" }),
    ];

    expect(exposureOf(orders)).toBe("400.00");
  });

  it("uses exact decimal arithmetic — no float drift", () => {
    const orders = [
      makeOrderState({ outstanding: "0.10" }),
      makeOrderState({ outstanding: "0.20" }),
    ];

    expect(exposureOf(orders)).toBe("0.30");
  });
});

describe("currency guard (Pitfall 4 / D-07)", () => {
  it("flags contributing orders that disagree on currency", () => {
    const orders = [
      makeOrderState({ currencyCode: "USD" }),
      makeOrderState({ currencyCode: "CAD" }),
    ];

    expect(computeCompanyState(orders, BEFORE_DUE).currencyMismatch).toBe(true);
  });

  it("does not flag a single-currency company", () => {
    const orders = [makeOrderState(), makeOrderState({ outstanding: "10.00" })];

    expect(computeCompanyState(orders, BEFORE_DUE).currencyMismatch).toBe(false);
  });

  it("ignores the currency of orders that do not contribute", () => {
    const orders = [
      makeOrderState({ currencyCode: "USD" }),
      makeOrderState({ currencyCode: "EUR", hasPaymentTerms: false }),
    ];

    expect(computeCompanyState(orders, BEFORE_DUE).currencyMismatch).toBe(false);
  });
});

describe("attribution (D-03)", () => {
  async function wipe(...domains: string[]) {
    await prisma.ledgerSchedule.deleteMany({ where: { shop: { in: domains } } });
    await prisma.ledgerOrder.deleteMany({ where: { shop: { in: domains } } });
    await prisma.company.deleteMany({ where: { shop: { in: domains } } });
  }

  beforeEach(async () => {
    await wipe(SHOP, OTHER_SHOP);
  });

  afterAll(async () => {
    await wipe(SHOP, OTHER_SHOP);
    await prisma.$disconnect();
  });

  it("persists an explicitly unresolved order with no company linkage (Pitfall 7)", async () => {
    const companyGid = await upsertOrderFromSource(
      SHOP,
      makeOrderForLedger({ id: "gid://shopify/Order/7001" }),
      { kind: "unresolved" },
    );

    expect(companyGid).toBeNull();

    const order = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: "gid://shopify/Order/7001" } },
    });
    expect(order).not.toBeNull();
    expect(order!.companyId).toBeNull();
    // UNRESOLVED, explicitly — "couldn't determine yet" is a stored state,
    // never a silent null (constraint 5).
    expect(order!.attributionStatus).toBe("UNRESOLVED");
    // The order is visible (ENFC-06 groundwork) but belongs to no company.
    expect(await prisma.company.count({ where: { shop: SHOP } })).toBe(0);
  });

  it("creates a row unattributed when no attribution evidence is supplied", async () => {
    // Preserve-mode create: without evidence a row STARTS unresolved.
    const companyGid = await upsertOrderFromSource(
      SHOP,
      makeOrderForLedger({ id: "gid://shopify/Order/7002" }),
    );

    expect(companyGid).toBeNull();
    const order = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: "gid://shopify/Order/7002" } },
    });
    expect(order!.attributionStatus).toBe("UNRESOLVED");
    expect(await prisma.company.count({ where: { shop: SHOP } })).toBe(0);
  });

  it("keys a company-attributed order to its company and not to another shop", async () => {
    await upsertOrderFromSource(
      SHOP,
      makeOrderForLedger({ id: "gid://shopify/Order/7003" }),
      {
        kind: "company",
        companyGid: FIXTURE_COMPANY_GID,
        companyName: "Acme Industrial Supply",
      },
    );

    const company = await prisma.company.findUnique({
      where: { shop_companyGid: { shop: SHOP, companyGid: FIXTURE_COMPANY_GID } },
    });
    expect(company).not.toBeNull();

    // Cross-shop isolation: the same company gid on another shop is a different
    // row, and this shop's write created nothing there (threat T-02-05).
    expect(await prisma.company.count({ where: { shop: OTHER_SHOP } })).toBe(0);
    expect(await prisma.ledgerOrder.count({ where: { shop: OTHER_SHOP } })).toBe(0);
  });

  it("keys identity off the company edge, never the buyer contact — source guard", async () => {
    // The INTENT guard outlives the mechanism change (02-06): identity keys to
    // the Company that owes the money, never to the person who placed the
    // order. The mechanism is now the authenticated company(id){orders} edge —
    // `Order.purchasingEntity` is scope-trapped behind the excluded
    // `read_customers` and may never return (02-05 § CRITICAL FINDING).
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../app/services/ledger.server.ts", import.meta.url),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

    // D-03 / CF-2: on a B2B order the buyer-contact field resolves to the
    // person who placed the order, not the company that owes the money.
    expect(code).not.toMatch(/\.\s*customer\b/i);
    expect(code).not.toMatch(/\bcustomer\s*[:{]/i);
    // The scope-trapped union may never return (02-05 § CRITICAL FINDING):
    // attribution runs over the authenticated company→orders edge instead.
    expect(code).not.toContain("purchasingEntity");
    expect(code).toContain("CompanyOrdersForLedger");
  });
});
