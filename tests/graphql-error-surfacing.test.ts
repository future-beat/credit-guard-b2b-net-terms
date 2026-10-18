import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import { COMPANIES_FOR_LEDGER_QUERY } from "../app/services/backfill.server";
import {
  COMPANY_ORDERS_FOR_LEDGER_QUERY,
  LedgerGraphqlError,
  ORDER_FOR_LEDGER_QUERY,
  forEachCompanyOrder,
  recomputeCompany,
  refetchOrderAndRecompute,
  upsertOrderFromSource,
} from "../app/services/ledger.server";
import { PUBLISH_COMPANY_CREDIT_MUTATION } from "../app/services/metafields.server";
import {
  OPEN_ORDER_IDS_PROBE_QUERY,
  ORDERS_UPDATED_SINCE_QUERY,
} from "../app/services/reconciliation.server";
import { createMockAdmin, type MockAdminClient } from "./helpers/admin-client-mock";
import { moduleSource, sourceWithoutComments } from "./helpers/module-source";
import {
  FIXTURE_COMPANY_GID,
  FIXTURE_COMPANY_NAME,
  FIXTURE_ORDER_GID,
  makeOrderForLedger,
} from "./fixtures/order-fixtures";

/**
 * WINDOWS defect 5, secondary defect (T-02-27) — a GraphQL permission failure
 * must NEVER masquerade as absent data.
 *
 * The live failure this file locks (02-05 SUMMARY § CRITICAL FINDING, verified
 * on the deployed app 2026-08-19): Shopify answers HTTP 200, `data.order` is
 * PRESENT with the denied field nulled inside it, and the real story sits in
 * `errors[]` — which the old transport discarded. Every order therefore read
 * as "no company", every exposure read 0.0000, and nothing would ever be
 * blocked. The regression below replays that exact response shape and asserts
 * the only acceptable outcome: a loud, named throw and ZERO ledger writes.
 *
 * The document source-guard at the bottom is the other structural protection:
 * the bulk JSONL path has no errors channel AT ALL (field denials arrive as
 * silent nulls in JSONL), so the only defense there is never selecting a field
 * outside the granted scopes in the first place.
 */
const getAdminContext = vi.hoisted(() => vi.fn());

vi.mock("../app/services/admin-client.server", () => ({ getAdminContext }));

const SHOP = "error-surfacing-test.myshopify.com";

let admin: MockAdminClient;

/**
 * The exact live ACCESS_DENIED shape: 200-status body, `data.order` present
 * with the trapped field nulled, `errors[]` alongside. The poisoned
 * outstanding amount proves no code path believes the nulled-data half.
 */
function accessDeniedOrderResponse() {
  return {
    data: {
      order: {
        ...makeOrderForLedger({ outstanding: "999999.99" }),
        purchasingEntity: null,
      },
    },
    errors: [
      {
        message:
          "Access denied for purchasingEntity field. Required access: The " +
          "user must have access to customers and orders or draft orders.",
        path: ["order", "purchasingEntity"],
        extensions: {
          code: "ACCESS_DENIED",
          requiredAccess: "read_customers access scope",
        },
      },
    ],
  };
}

/** Same failure through the company edge. */
function accessDeniedCompanyResponse() {
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

async function wipe() {
  await prisma.ledgerSchedule.deleteMany({ where: { shop: SHOP } });
  await prisma.ledgerOrder.deleteMany({ where: { shop: SHOP } });
  await prisma.company.deleteMany({ where: { shop: SHOP } });
}

async function counts() {
  return {
    companies: await prisma.company.count({ where: { shop: SHOP } }),
    orders: await prisma.ledgerOrder.count({ where: { shop: SHOP } }),
    schedules: await prisma.ledgerSchedule.count({ where: { shop: SHOP } }),
  };
}

beforeEach(async () => {
  await wipe();
  admin = createMockAdmin();
  getAdminContext.mockReset();
  getAdminContext.mockResolvedValue(admin);
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe("ACCESS_DENIED regression — the live failure shape (T-02-27)", () => {
  it("throws LedgerGraphqlError from a refetch and writes nothing on an empty ledger", async () => {
    admin.setFixture("OrderForLedger", accessDeniedOrderResponse());

    await expect(
      refetchOrderAndRecompute(SHOP, FIXTURE_ORDER_GID),
    ).rejects.toBeInstanceOf(LedgerGraphqlError);

    // Not one row of any kind: the nulled-but-present data half was never
    // believed, and above all the order was NOT treated as deleted.
    expect(await counts()).toEqual({ companies: 0, orders: 0, schedules: 0 });
  });

  it("names the label, the shop, the code and the missing scope in the message", async () => {
    admin.setFixture("OrderForLedger", accessDeniedOrderResponse());

    const thrown = await refetchOrderAndRecompute(SHOP, FIXTURE_ORDER_GID).then(
      () => null,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(LedgerGraphqlError);
    const message = (thrown as LedgerGraphqlError).message;
    // Greppable in production logs: the next scope trap names itself instead
    // of masquerading as absent data.
    expect(message).toContain("OrderForLedger");
    expect(message).toContain(SHOP);
    expect(message).toContain("ACCESS_DENIED");
    expect(message).toContain("read_customers access scope");
    // The raw errors payload rides along for structured handling.
    expect((thrown as LedgerGraphqlError).errors).toHaveLength(1);
  });

  it("leaves an existing attributed row completely untouched", async () => {
    await upsertOrderFromSource(SHOP, makeOrderForLedger(), {
      kind: "company",
      companyGid: FIXTURE_COMPANY_GID,
      companyName: FIXTURE_COMPANY_NAME,
      companyLocationGid: "gid://shopify/CompanyLocation/2001",
    });
    await recomputeCompany(SHOP, FIXTURE_COMPANY_GID);

    const before = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: FIXTURE_ORDER_GID } },
      include: { schedules: true },
    });

    admin.setFixture("OrderForLedger", accessDeniedOrderResponse());
    await expect(
      refetchOrderAndRecompute(SHOP, FIXTURE_ORDER_GID),
    ).rejects.toBeInstanceOf(LedgerGraphqlError);

    const after = await prisma.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop: SHOP, orderGid: FIXTURE_ORDER_GID } },
      include: { schedules: true },
    });

    // Not updated, not deleted, not re-attributed — byte-for-byte survival.
    expect(after!.outstandingShop.toFixed(4)).toBe(
      before!.outstandingShop.toFixed(4),
    );
    expect(after!.outstandingShop.toFixed(4)).toBe("500.0000");
    expect(after!.attributionStatus).toBe("ATTRIBUTED");
    expect(after!.companyId).toBe(before!.companyId);
    expect(after!.refetchedAt.toISOString()).toBe(
      before!.refetchedAt.toISOString(),
    );
    expect(after!.schedules).toHaveLength(before!.schedules.length);

    const company = await prisma.company.findUnique({
      where: { shop_companyGid: { shop: SHOP, companyGid: FIXTURE_COMPANY_GID } },
    });
    expect(company!.exposure.toFixed(4)).toBe("500.0000");
  });

  it("throws from the company-edge scan with no partial company ingest", async () => {
    admin.setFixture("CompanyOrdersForLedger", accessDeniedCompanyResponse());

    const onNode = vi.fn();
    await expect(
      forEachCompanyOrder(SHOP, FIXTURE_COMPANY_GID, onNode),
    ).rejects.toBeInstanceOf(LedgerGraphqlError);

    expect(onNode).not.toHaveBeenCalled();
    expect(await counts()).toEqual({ companies: 0, orders: 0, schedules: 0 });
  });
});

/**
 * Document source-guard: no GraphQL document a ledger path executes may select
 * the scope-trapped attribution field or any customer field. The raw document
 * text is matched with nothing stripped — a selection hiding in a comment
 * still trips the guard, which is the safe direction to fail in.
 */
describe("document source-guard — the trap field stays out (CF-1, D-03)", () => {
  const TRAPPED = /purchasingEntity|\bcustomer\s*[({]/;

  it("keeps ledger.server.ts documents free of trapped selections", () => {
    expect(ORDER_FOR_LEDGER_QUERY).not.toMatch(TRAPPED);
    expect(COMPANY_ORDERS_FOR_LEDGER_QUERY).not.toMatch(TRAPPED);
  });

  it("keeps the company enumeration document clean", () => {
    expect(COMPANIES_FOR_LEDGER_QUERY).not.toMatch(TRAPPED);
  });

  it("keeps the reconciliation probe document clean", () => {
    expect(OPEN_ORDER_IDS_PROBE_QUERY).not.toMatch(TRAPPED);
  });

  // 02-07 flip (WINDOWS #6): the bulk backfill document — the last order
  // document in backfill.server.ts that selected the trapped field — was
  // DELETED with the bulk machinery, not just cleaned. This guard scans the
  // module source for every remaining `#graphql` document so a reintroduced
  // trapped selection anywhere in the file trips it, not only in the exports
  // this suite happens to import.
  it("02-07 flip: every GraphQL document in backfill.server.ts is free of trapped selections", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../app/services/backfill.server.ts", import.meta.url),
      "utf8",
    );

    const documents = source.match(/`#graphql[\s\S]*?`/g) ?? [];
    // The scope-trapped bulk order sweep is gone entirely, and 06-DEBUG fix 1
    // moved the company enumeration to ledger.server.ts (the ingest ladder
    // needs it, and importing the backfill from the ledger would be a cycle).
    // The backfill now executes NO document of its own — it reaches Shopify
    // only through ledger helpers that are themselves under this guard.
    expect(documents).toHaveLength(0);
  });

  // Every document the app executes now lives in exactly two modules; scan the
  // ledger's source wholesale so a trapped selection added to a NEW document
  // there trips this guard without anyone remembering to import it here.
  it("every GraphQL document in ledger.server.ts is free of trapped selections", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../app/services/ledger.server.ts", import.meta.url),
      "utf8",
    );

    const documents = source.match(/`#graphql[\s\S]*?`/g) ?? [];
    expect(documents).toHaveLength(3);
    for (const document of documents) {
      expect(document).not.toMatch(TRAPPED);
    }
  });

  // 02-08 flip (WINDOWS #7): the reconciliation cursor scan no longer selects
  // the scope-trapped attribution field — the LAST ledger document that did.
  // The source-guard is hard-green across all three services.
  it("02-08 flip: the reconciliation updated-since document is free of trapped selections", () => {
    expect(ORDERS_UPDATED_SINCE_QUERY).not.toMatch(TRAPPED);
  });

  // 03-04: the credit_v1 publisher is the FOURTH service under this guard.
  // It writes rather than reads, but it is still a document the app executes
  // against a shop's Admin API, and a document is exactly where the next scope
  // trap would be introduced — so it joins the guard at birth (03-01 already
  // complies; this locks the compliance structurally rather than by habit).
  it("keeps the credit_v1 publisher document free of trapped selections", () => {
    expect(PUBLISH_COMPANY_CREDIT_MUTATION).not.toMatch(TRAPPED);
  });

  it("every GraphQL document in metafields.server.ts is free of trapped selections", () => {
    const source = moduleSource("app/services/metafields.server.ts");
    const documents = source.match(/`#graphql[\s\S]*?`/g) ?? [];

    // The publisher executes exactly ONE document. A second one appearing here
    // is a design change that has to be looked at, not absorbed silently.
    expect(documents).toHaveLength(1);
    expect(documents[0]).toContain("mutation PublishCompanyCredit");
    for (const document of documents) {
      expect(document).not.toMatch(TRAPPED);
    }
  });
});

/**
 * Transport guard: every service EXCEPT the transport home reaches Shopify
 * through `graphqlJson`, never through the admin context directly.
 *
 * This is the other half of T-02-27. `graphqlJson` is the single place that
 * inspects `errors[]` and throws `LedgerGraphqlError`; a module that calls
 * `getAdminContext(...).graphql` itself gets a 200 with nulled data and no
 * error channel — which is precisely the live failure this file exists to
 * prevent, reintroduced one module over. Comments are stripped first, so the
 * doc comments that NAME the forbidden call (as several of these modules do)
 * cannot trip the guard.
 */
describe("transport guard — graphqlJson is the only way out (T-02-27)", () => {
  const DIRECT_TRANSPORT = /getAdminContext\s*\(|\.graphql\s*\(/;

  /** Modules that execute documents of their own: both halves of the guard. */
  const executors = [
    "app/services/reconciliation.server.ts",
    // 03-04: the publisher is a WRITE path, so a swallowed failure here is a
    // stale checkout decision rather than a missing row.
    "app/services/metafields.server.ts",
  ];

  /**
   * Modules that execute NO document of their own and reach Shopify only
   * through ledger helpers (the backfill, since 06-DEBUG fix 1 moved the
   * company enumeration to ledger.server.ts). The no-direct-transport half is
   * the half that matters for them — and it is the half that catches a
   * regression.
   */
  const delegators = ["app/services/backfill.server.ts"];

  for (const service of executors) {
    it(`${service} routes every call through graphqlJson`, () => {
      const source = sourceWithoutComments(service);

      // Stripper sanity: a blanked file satisfies the `not.toMatch` below.
      expect(source.length).toBeGreaterThan(200);
      expect(source).toMatch(/^export (async )?function /m);
      expect(source).not.toMatch(DIRECT_TRANSPORT);
      expect(source).toContain("graphqlJson");
    });
  }

  for (const service of delegators) {
    it(`${service} never reaches the admin context directly`, () => {
      const source = sourceWithoutComments(service);

      expect(source).not.toMatch(DIRECT_TRANSPORT);
    });
  }
});
