import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import {
  deactivateShop,
  ensureShopActive,
  logComplianceRequest,
  redactShop,
} from "../app/services/shop-lifecycle.server";
import { expiredRefreshableSession } from "./helpers/offline-session";
import { signedWebhookRequest } from "./helpers/webhook-hmac";

/**
 * FOUND-03 — the D-06 two-stage uninstall lifecycle.
 *
 * The whole point of these tests is that `app/uninstalled` DEACTIVATES and
 * RETAINS. Deleting on uninstall would still pass a naive "shop is gone" test
 * while destroying the painless-reinstall experience, so every uninstall
 * assertion here also asserts what SURVIVED.
 *
 * `authenticate.admin` is the only thing stubbed — `authenticate.webhook` stays
 * real so the webhook tests exercise genuine HMAC verification.
 */
const authenticateAdmin = vi.hoisted(() => vi.fn());

vi.mock("../app/shopify.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../app/shopify.server")>();
  return {
    ...actual,
    authenticate: { ...actual.authenticate, admin: authenticateAdmin },
  };
});

const SHOP = "lifecycle-test.myshopify.com";
const OTHER_SHOP = "lifecycle-bystander.myshopify.com";
const APP_URL = "https://app.creditguard.test";

async function wipe(...domains: string[]) {
  await prisma.enforcementEvent.deleteMany({ where: { shop: { in: domains } } });
  await prisma.reminderLog.deleteMany({ where: { shop: { in: domains } } });
  await prisma.session.deleteMany({ where: { shop: { in: domains } } });
  await prisma.complianceRequest.deleteMany({ where: { shop: { in: domains } } });
  await prisma.ledgerSchedule.deleteMany({ where: { shop: { in: domains } } });
  await prisma.ledgerOrder.deleteMany({ where: { shop: { in: domains } } });
  await prisma.company.deleteMany({ where: { shop: { in: domains } } });
  await prisma.webhookReceipt.deleteMany({ where: { shop: { in: domains } } });
  await prisma.syncCursor.deleteMany({ where: { shop: { in: domains } } });
  await prisma.shop.deleteMany({ where: { domain: { in: domains } } });
}

/**
 * Every shop-keyed table. Each Phase 2 ledger model was added here and to
 * `redactShop` in the same change — a model that exists in one but not the
 * other is a GDPR hole that no other test would notice.
 */
async function countsFor(domain: string) {
  return {
    shops: await prisma.shop.count({ where: { domain } }),
    complianceRequests: await prisma.complianceRequest.count({
      where: { shop: domain },
    }),
    sessions: await prisma.session.count({ where: { shop: domain } }),
    companies: await prisma.company.count({ where: { shop: domain } }),
    ledgerOrders: await prisma.ledgerOrder.count({ where: { shop: domain } }),
    ledgerSchedules: await prisma.ledgerSchedule.count({
      where: { shop: domain },
    }),
    webhookReceipts: await prisma.webhookReceipt.count({
      where: { shop: domain },
    }),
    syncCursors: await prisma.syncCursor.count({ where: { shop: domain } }),
    reminderLogs: await prisma.reminderLog.count({ where: { shop: domain } }),
    enforcementEvents: await prisma.enforcementEvent.count({
      where: { shop: domain },
    }),
  };
}

const EMPTY_COUNTS = {
  shops: 0,
  complianceRequests: 0,
  sessions: 0,
  companies: 0,
  ledgerOrders: 0,
  ledgerSchedules: 0,
  webhookReceipts: 0,
  syncCursors: 0,
  reminderLogs: 0,
  enforcementEvents: 0,
};

/** One row in every shop-keyed ledger table, wired together as in production. */
async function seedLedger(domain: string, suffix: string) {
  const company = await prisma.company.create({
    data: {
      shop: domain,
      companyGid: `gid://shopify/Company/${suffix}`,
      name: `Company ${suffix}`,
      exposure: "500.0000",
    },
  });
  const order = await prisma.ledgerOrder.create({
    data: {
      shop: domain,
      orderGid: `gid://shopify/Order/${suffix}`,
      name: `#${suffix}`,
      companyId: company.id,
      hasPaymentTerms: true,
      outstandingShop: "500.0000",
      currencyCode: "USD",
      sourceUpdatedAt: new Date(),
      refetchedAt: new Date(),
    },
  });
  await prisma.ledgerSchedule.create({
    data: {
      shop: domain,
      scheduleGid: `gid://shopify/PaymentSchedule/${suffix}`,
      orderId: order.id,
      dueAt: new Date("2026-09-30T00:00:00Z"),
    },
  });
  await prisma.webhookReceipt.create({
    data: { id: `receipt-${suffix}`, shop: domain, topic: "ORDERS_CREATE" },
  });
  await prisma.syncCursor.create({
    data: { shop: domain, key: "reconciliation", value: "2026-08-19T00:00:00Z" },
  });
  // The Phase-5 dunning trail. It records WHICH company was chased and when,
  // so it is shop-keyed merchant data and must not survive a redact.
  await prisma.reminderLog.create({
    data: {
      shop: domain,
      scheduleGid: `gid://shopify/PaymentSchedule/${suffix}`,
      orderGid: `gid://shopify/Order/${suffix}`,
      companyGid: `gid://shopify/Company/${suffix}`,
      companyName: `Company ${suffix}`,
      touchpoint: "OVERDUE",
      status: "SENT",
      sentAt: new Date("2026-08-25T00:00:00Z"),
    },
  });
  // The Phase-4 enforcement trail: which company was held, at what exposure.
  // Snapshot columns, no FK — exactly the kind of row a redact must chase down.
  await prisma.enforcementEvent.create({
    data: {
      shop: domain,
      companyGid: `gid://shopify/Company/${suffix}`,
      companyName: `Company ${suffix}`,
      kind: "BLOCK_STATE_ENTERED",
      exposure: "500.0000",
      limit: "400.0000",
      overdue: false,
      bypass: false,
    },
  });
}

beforeEach(async () => {
  authenticateAdmin.mockReset();
  await wipe(SHOP, OTHER_SHOP);
});

afterAll(async () => {
  await wipe(SHOP, OTHER_SHOP);
  await prisma.$disconnect();
});

describe("deactivateShop (app/uninstalled — D-06 retain)", () => {
  it("marks the shop inactive, stamps uninstalledAt, and retains its data", async () => {
    await prisma.shop.create({ data: { domain: SHOP } });
    await prisma.complianceRequest.create({
      data: { shop: SHOP, topic: "CUSTOMERS_DATA_REQUEST" },
    });

    await deactivateShop(SHOP);

    const shop = await prisma.shop.findUnique({ where: { domain: SHOP } });
    expect(shop).not.toBeNull();
    expect(shop!.active).toBe(false);
    expect(shop!.uninstalledAt).toBeInstanceOf(Date);

    // Retention is the assertion that matters: nothing was deleted.
    const counts = await countsFor(SHOP);
    expect(counts.shops).toBe(1);
    expect(counts.complianceRequests).toBe(1);
  });

  it("does not throw for a shop it has never seen", async () => {
    await expect(deactivateShop(SHOP)).resolves.not.toThrow();

    const shop = await prisma.shop.findUnique({ where: { domain: SHOP } });
    expect(shop).not.toBeNull();
    expect(shop!.active).toBe(false);
  });

  it("is idempotent under webhook redelivery", async () => {
    await deactivateShop(SHOP);
    const first = await prisma.shop.findUnique({ where: { domain: SHOP } });

    await deactivateShop(SHOP);
    const second = await prisma.shop.findUnique({ where: { domain: SHOP } });

    expect(await prisma.shop.count({ where: { domain: SHOP } })).toBe(1);
    expect(second!.active).toBe(false);
    expect(second!.id).toBe(first!.id);
  });
});

describe("redactShop (shop/redact — D-06 hard delete)", () => {
  it("deletes every row for the shop", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: false } });
    await prisma.complianceRequest.createMany({
      data: [
        { shop: SHOP, topic: "CUSTOMERS_REDACT" },
        { shop: SHOP, topic: "SHOP_REDACT" },
      ],
    });

    await redactShop(SHOP);

    expect(await countsFor(SHOP)).toEqual(EMPTY_COUNTS);
  });

  it("deletes every shop-keyed ledger table's rows (Phase 2 models)", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: false } });
    await seedLedger(SHOP, "1");

    // Guard against a vacuous assertion: the rows really were there first.
    const before = await countsFor(SHOP);
    expect(before.companies).toBe(1);
    expect(before.ledgerOrders).toBe(1);
    expect(before.ledgerSchedules).toBe(1);
    expect(before.webhookReceipts).toBe(1);
    expect(before.syncCursors).toBe(1);
    expect(before.reminderLogs).toBe(1);
    expect(before.enforcementEvents).toBe(1);

    await redactShop(SHOP);

    expect(await countsFor(SHOP)).toEqual(EMPTY_COUNTS);
  });

  it("leaves a bystander shop's ledger completely intact", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: false } });
    await seedLedger(SHOP, "1");
    await prisma.shop.create({ data: { domain: OTHER_SHOP } });
    await seedLedger(OTHER_SHOP, "2");

    await redactShop(SHOP);

    expect(await countsFor(OTHER_SHOP)).toEqual({
      ...EMPTY_COUNTS,
      shops: 1,
      companies: 1,
      ledgerOrders: 1,
      ledgerSchedules: 1,
      webhookReceipts: 1,
      syncCursors: 1,
      reminderLogs: 1,
      enforcementEvents: 1,
    });
  });

  it("does not touch SweepLease — scheduler leadership is global, not per shop", async () => {
    await prisma.sweepLease.deleteMany({ where: { name: "redact-probe" } });
    await prisma.sweepLease.create({
      data: {
        name: "redact-probe",
        holder: "instance-1",
        lockedUntil: new Date("2026-08-19T00:00:00Z"),
      },
    });

    await redactShop(SHOP);

    expect(
      await prisma.sweepLease.count({ where: { name: "redact-probe" } }),
    ).toBe(1);
    await prisma.sweepLease.deleteMany({ where: { name: "redact-probe" } });
  });

  it("is idempotent for an unknown or already-redacted shop", async () => {
    await redactShop(SHOP);
    await expect(redactShop(SHOP)).resolves.not.toThrow();

    expect((await countsFor(SHOP)).shops).toBe(0);
  });

  it("never touches another shop's rows", async () => {
    await prisma.shop.create({ data: { domain: OTHER_SHOP } });
    await prisma.complianceRequest.create({
      data: { shop: OTHER_SHOP, topic: "SHOP_REDACT" },
    });

    await redactShop(SHOP);

    expect(await countsFor(OTHER_SHOP)).toEqual({
      ...EMPTY_COUNTS,
      shops: 1,
      complianceRequests: 1,
    });
  });
});

describe("ensureShopActive (re-install reactivation)", () => {
  it("creates an active shop on first authenticated load", async () => {
    await ensureShopActive(SHOP);

    const shop = await prisma.shop.findUnique({ where: { domain: SHOP } });
    expect(shop!.active).toBe(true);
    expect(shop!.uninstalledAt).toBeNull();
  });

  it("reactivates a deactivated shop and clears uninstalledAt", async () => {
    await prisma.shop.create({
      data: { domain: SHOP, active: false, uninstalledAt: new Date() },
    });

    await ensureShopActive(SHOP);

    const shop = await prisma.shop.findUnique({ where: { domain: SHOP } });
    expect(shop!.active).toBe(true);
    expect(shop!.uninstalledAt).toBeNull();
  });

  it("is a no-op-shaped upsert for an already-active shop", async () => {
    const created = await prisma.shop.create({ data: { domain: SHOP } });

    await ensureShopActive(SHOP);
    await ensureShopActive(SHOP);

    const shop = await prisma.shop.findUnique({ where: { domain: SHOP } });
    expect(await prisma.shop.count({ where: { domain: SHOP } })).toBe(1);
    expect(shop!.id).toBe(created.id);
    expect(shop!.installedAt.getTime()).toBe(created.installedAt.getTime());
  });
});

describe("logComplianceRequest", () => {
  it("writes a receipt carrying metadata only — never a payload", async () => {
    await logComplianceRequest(SHOP, "CUSTOMERS_DATA_REQUEST");

    const rows = await prisma.complianceRequest.findMany({
      where: { shop: SHOP },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].topic).toBe("CUSTOMERS_DATA_REQUEST");
    expect(rows[0].receivedAt).toBeInstanceOf(Date);
    // T-01-12: the audit trail must never itself become retained PII.
    expect(Object.keys(rows[0]).sort()).toEqual([
      "id",
      "receivedAt",
      "shop",
      "topic",
    ]);
  });

  it("appends rather than overwrites, so redeliveries keep an audit trail", async () => {
    await logComplianceRequest(SHOP, "CUSTOMERS_REDACT");
    await logComplianceRequest(SHOP, "CUSTOMERS_REDACT");

    expect((await countsFor(SHOP)).complianceRequests).toBe(2);
  });
});

describe("app/uninstalled webhook route", () => {
  async function uninstallAction(request: Request) {
    const { action } = await import("../app/routes/webhooks.app.uninstalled");
    return action({ request, params: {}, context: {} } as never);
  }

  function uninstallRequest() {
    return signedWebhookRequest(
      `${APP_URL}/webhooks/app/uninstalled`,
      "app/uninstalled",
      SHOP,
      { shop_domain: SHOP, shop_id: 42 },
    );
  }

  it("deletes sessions, deactivates the shop, and retains everything else", async () => {
    await prisma.shop.create({ data: { domain: SHOP } });
    await prisma.complianceRequest.create({
      data: { shop: SHOP, topic: "CUSTOMERS_DATA_REQUEST" },
    });
    await prisma.session.create({
      data: {
        id: `offline_${SHOP}`,
        shop: SHOP,
        state: "",
        isOnline: false,
        accessToken: "test-offline-token",
      },
    });

    const response = await uninstallAction(uninstallRequest());
    expect(response.status).toBe(200);

    const counts = await countsFor(SHOP);
    expect(counts.sessions).toBe(0);
    // D-06: deactivate, never delete.
    expect(counts.shops).toBe(1);
    expect(counts.complianceRequests).toBe(1);

    const shop = await prisma.shop.findUnique({ where: { domain: SHOP } });
    expect(shop!.active).toBe(false);
    expect(shop!.uninstalledAt).toBeInstanceOf(Date);
  });

  it("returns 200 on redelivery when the session is already gone", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: false } });

    const response = await uninstallAction(uninstallRequest());

    expect(response.status).toBe(200);
    expect((await countsFor(SHOP)).shops).toBe(1);
  });

  it("answers 200, deletes an expired refreshable session and deactivates the shop (WINDOWS #31)", async () => {
    await prisma.shop.create({ data: { domain: SHOP } });
    await prisma.complianceRequest.create({
      data: { shop: SHOP, topic: "CUSTOMERS_DATA_REQUEST" },
    });
    await prisma.session.create({ data: expiredRefreshableSession(SHOP) });

    const response = await uninstallAction(uninstallRequest());
    expect(response.status).toBe(200);

    const counts = await countsFor(SHOP);
    expect(counts.sessions).toBe(0);
    // D-06: deactivate, never delete.
    expect(counts.shops).toBe(1);
    expect(counts.complianceRequests).toBe(1);

    const shop = await prisma.shop.findUnique({ where: { domain: SHOP } });
    expect(shop!.active).toBe(false);
    expect(shop!.uninstalledAt).toBeInstanceOf(Date);
  });

  it("holds no delete against retained tables in its source", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../app/routes/webhooks.app.uninstalled.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/\bshop\s*\.\s*delete/i);
    expect(source).not.toMatch(/complianceRequest\s*\.\s*delete/i);
    expect(source).toContain("deactivateShop");
  });
});

describe("shop/redact route with a stale offline session (WINDOWS #31)", () => {
  async function redactAction(request: Request) {
    const { action } = await import("../app/routes/webhooks.compliance");
    return action({ request, params: {}, context: {} } as never);
  }

  it("zeroes every counted table when the stored token is expired but refreshable", async () => {
    await prisma.shop.create({ data: { domain: SHOP, active: false } });
    await seedLedger(SHOP, "1");
    await prisma.complianceRequest.create({
      data: { shop: SHOP, topic: "SHOP_REDACT" },
    });
    await prisma.session.create({ data: expiredRefreshableSession(SHOP) });

    // Guard against a vacuous assertion — #32's row really was there first.
    expect((await countsFor(SHOP)).enforcementEvents).toBe(1);

    const response = await redactAction(
      signedWebhookRequest(
        `${APP_URL}/webhooks/compliance`,
        "shop/redact",
        SHOP,
        { shop_id: 99, shop_domain: SHOP },
      ),
    );

    expect(response.status).toBe(200);
    expect(await countsFor(SHOP)).toEqual(EMPTY_COUNTS);
  });
});

describe("app layout loader (authenticated load reactivates)", () => {
  async function runLoader() {
    const { loader } = await import("../app/routes/app");
    return loader({
      request: new Request(`${APP_URL}/app`),
      params: {},
      context: {},
    } as never);
  }

  it("flips a deactivated shop back to active on re-install", async () => {
    await prisma.shop.create({
      data: { domain: SHOP, active: false, uninstalledAt: new Date() },
    });
    authenticateAdmin.mockResolvedValue({ session: { shop: SHOP } });

    await runLoader();

    const shop = await prisma.shop.findUnique({ where: { domain: SHOP } });
    expect(shop!.active).toBe(true);
    expect(shop!.uninstalledAt).toBeNull();
  });

  it("records a shop that has never been seen before", async () => {
    authenticateAdmin.mockResolvedValue({ session: { shop: SHOP } });

    await runLoader();

    expect((await countsFor(SHOP)).shops).toBe(1);
  });
});
