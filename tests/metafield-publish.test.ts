import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

import prisma from "../app/db.server";
import { recomputeCompany } from "../app/services/ledger.server";
import {
  MetafieldPublishError,
  publishCompanyCreditState,
} from "../app/services/metafields.server";
import { createMockAdmin, type MockAdminClient } from "./helpers/admin-client-mock";

/**
 * CRED-03 publish wiring — the 03-01 tracer plus every publisher edge.
 *
 * The seam is the Phase 2 convention: `admin-client.server.ts` is the ONLY
 * mocked module, so `recomputeCompany` runs real code against real Postgres
 * rows and the publish lands on a fake Admin API whose calls are assertable
 * per GraphQL operation name.
 */
const getAdminContext = vi.hoisted(() => vi.fn());

vi.mock("../app/services/admin-client.server", () => ({ getAdminContext }));

/** The publisher is non-throwing by contract — failures surface ONLY here. */
const captureMessage = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());

vi.mock("@sentry/react-router", () => ({ captureMessage, captureException }));

const SHOP = "metafield-publish-test.myshopify.com";
const OTHER_SHOP = "metafield-publish-bystander.myshopify.com";
const COMPANY_GID = "gid://shopify/Company/8801";

let admin: MockAdminClient;

async function wipe(...domains: string[]) {
  await prisma.ledgerSchedule.deleteMany({ where: { shop: { in: domains } } });
  await prisma.ledgerOrder.deleteMany({ where: { shop: { in: domains } } });
  await prisma.company.deleteMany({ where: { shop: { in: domains } } });
  await prisma.webhookReceipt.deleteMany({ where: { shop: { in: domains } } });
  await prisma.syncCursor.deleteMany({ where: { shop: { in: domains } } });
  await prisma.session.deleteMany({ where: { shop: { in: domains } } });
  await prisma.shop.deleteMany({ where: { domain: { in: domains } } });
}

async function seedShop(domain = SHOP, active = true) {
  await prisma.shop.create({ data: { domain, active } });
}

async function seedCompany(
  overrides: Partial<Parameters<typeof prisma.company.create>[0]["data"]> = {},
) {
  return prisma.company.create({
    data: {
      shop: SHOP,
      companyGid: COMPANY_GID,
      name: "Acme Wholesale",
      ...overrides,
    },
  });
}

let scheduleSequence = 0;

/** A contributing net-terms order: open schedule, not cancelled. */
async function seedNetTermsOrder(
  companyId: string | null,
  {
    outstanding = "500.00",
    orderGid = `gid://shopify/Order/${7000 + scheduleSequence}`,
    dueAt = new Date(Date.now() + 14 * 86_400_000),
    currencyCode = "USD",
    shop = SHOP,
    attributionStatus = "ATTRIBUTED",
    hasPaymentTerms = true,
    withSchedule = true,
  } = {},
) {
  scheduleSequence += 1;
  return prisma.ledgerOrder.create({
    data: {
      shop,
      orderGid,
      name: `#${1000 + scheduleSequence}`,
      companyId,
      attributionStatus,
      hasPaymentTerms,
      paymentTermsType: hasPaymentTerms ? "NET" : null,
      financialStatus: "PENDING",
      outstandingShop: new Prisma.Decimal(outstanding),
      currencyCode,
      sourceUpdatedAt: new Date(),
      refetchedAt: new Date(),
      ...(withSchedule
        ? {
            schedules: {
              create: {
                shop,
                scheduleGid: `gid://shopify/PaymentSchedule/${9000 + scheduleSequence}`,
                dueAt,
                completedAt: null,
              },
            },
          }
        : {}),
    },
  });
}

beforeEach(async () => {
  await wipe(SHOP, OTHER_SHOP);
  admin = createMockAdmin();
  getAdminContext.mockReset();
  getAdminContext.mockResolvedValue(admin);
  captureMessage.mockReset();
  captureException.mockReset();
});

afterAll(async () => {
  await wipe(SHOP, OTHER_SHOP);
  await prisma.$disconnect();
});

describe("03-01 tracer — recompute publishes credit_v1 end to end (CRED-03, D-04, D-05)", () => {
  it("one recompute produces exactly one correctly-shaped credit_v1 metafieldsSet", async () => {
    await seedShop();
    const company = await seedCompany();
    await seedNetTermsOrder(company.id, { outstanding: "1874.95" });

    const state = await recomputeCompany(SHOP, COMPANY_GID);
    expect(state).not.toBeNull();

    const calls = admin.callsFor("PublishCompanyCredit");
    expect(calls).toHaveLength(1);

    const metafields = calls[0].variables.metafields as Array<
      Record<string, string>
    >;
    expect(metafields).toHaveLength(1);
    const input = metafields[0];
    // T-03-06: the ownerId comes from the shop-scoped Company row.
    expect(input.ownerId).toBe(COMPANY_GID);
    // Reserved shorthand ONLY — never the app--{id} long form.
    expect(input.namespace).toBe("$app");
    expect(input.key).toBe("credit_v1");
    expect(input.type).toBe("json");

    const payload = JSON.parse(input.value) as Record<string, unknown>;
    expect(payload).toEqual({
      v: 1,
      limit: null, // CRED-04: observe-only default is the encoding itself
      exposure: "1874.95", // decimal STRING, recomputeCompany output verbatim
      currency: "USD",
      overdue: false,
      bypass: false,
      data_complete: true,
      computed_at: expect.any(String),
    });
    const computedAt = payload.computed_at as string;
    expect(new Date(computedAt).toISOString()).toBe(computedAt);

    const row = await prisma.company.findUniqueOrThrow({
      where: { id: company.id },
    });
    expect(row.publishedStateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.publishedAt).not.toBeNull();

    // D-05: the publisher PROJECTED the recompute output — it changed nothing.
    expect(row.exposure.toFixed(4)).toBe(state!.exposure.toFixed(4));
    expect(row.overdue).toBe(state!.overdue);
    expect(row.earliestDueAt?.getTime()).toBe(state!.earliestDueAt?.getTime());
  });
});

function lastPublishedPayload() {
  const calls = admin.callsFor("PublishCompanyCredit");
  const metafields = calls[calls.length - 1].variables.metafields as Array<
    Record<string, string>
  >;
  return JSON.parse(metafields[0].value) as Record<string, unknown>;
}

describe("hash-skip and the dirty-retry channel (CRED-03/adjacency)", () => {
  it("re-publishing unchanged state makes ZERO further metafieldsSet calls", async () => {
    await seedShop();
    const company = await seedCompany();
    await seedNetTermsOrder(company.id);

    await recomputeCompany(SHOP, COMPANY_GID);
    expect(admin.callCount("PublishCompanyCredit")).toBe(1);

    // Direct re-publish with nothing recomputed since: hash equal AND
    // publishedAt >= recomputedAt -> skip, no API call.
    await publishCompanyCreditState(SHOP, company.id);
    expect(admin.callCount("PublishCompanyCredit")).toBe(1);
  });

  it("hash equal but publishedAt < recomputedAt publishes anyway — the failed-write retry", async () => {
    await seedShop();
    const company = await seedCompany();
    await seedNetTermsOrder(company.id);

    await recomputeCompany(SHOP, COMPANY_GID);
    expect(admin.callCount("PublishCompanyCredit")).toBe(1);

    // Simulate a prior failed publish: the state hash matches but the write
    // never landed after the last recompute.
    const row = await prisma.company.findUniqueOrThrow({
      where: { id: company.id },
    });
    await prisma.company.update({
      where: { id: company.id },
      data: { publishedAt: new Date(row.recomputedAt!.getTime() - 60_000) },
    });

    await publishCompanyCreditState(SHOP, company.id);
    expect(admin.callCount("PublishCompanyCredit")).toBe(2);
  });

  it("a never-recomputed row (recomputedAt null) PUBLISHES — fail toward freshness", async () => {
    await seedShop();
    // Fresh Company, no recompute has ever run — the sweep backstop can
    // enumerate such rows and skipping would strand them invisible to Phase 4.
    const company = await seedCompany();

    await publishCompanyCreditState(SHOP, company.id);

    expect(admin.callCount("PublishCompanyCredit")).toBe(1);
    const payload = lastPublishedPayload();
    expect(payload.exposure).toBe("0.00");
    expect(payload.limit).toBeNull();
    const computedAt = payload.computed_at as string;
    expect(new Date(computedAt).toISOString()).toBe(computedAt);
  });
});

describe("the userErrors trap — failure inside data with EMPTY errors[] (research Pitfall 1 + 3)", () => {
  it("userErrors are FAILURE: Sentry event, no bookkeeping advance, caller does not throw", async () => {
    await seedShop();
    const company = await seedCompany();
    await seedNetTermsOrder(company.id);

    // The exact live shape: 200 body, NO top-level errors[], the real story
    // inside data.metafieldsSet.userErrors — graphqlJson will NOT throw.
    admin.setFixture("PublishCompanyCredit", {
      data: {
        metafieldsSet: {
          metafields: [],
          userErrors: [
            {
              field: ["metafields", "0"],
              message: "App is not authorized to write company metafields.",
              code: "APP_NOT_AUTHORIZED",
              elementIndex: 0,
            },
          ],
        },
      },
    });

    // Non-throwing contract: a webhook whose ledger work committed returns 200.
    await expect(
      recomputeCompany(SHOP, COMPANY_GID),
    ).resolves.not.toBeNull();

    expect(admin.callCount("PublishCompanyCredit")).toBe(1);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][0]).toBeInstanceOf(
      MetafieldPublishError,
    );
    expect(captureException.mock.calls[0][1]).toMatchObject({
      tags: { publisher: "credit_v1", shop: SHOP },
    });

    // The dirty marker IS the retry state: bookkeeping must not advance.
    const row = await prisma.company.findUniqueOrThrow({
      where: { id: company.id },
    });
    expect(row.publishedStateHash).toBeNull();
    expect(row.publishedAt).toBeNull();
  });

  it("a transport throw (top-level errors[]) is swallowed + Sentried, never rethrown", async () => {
    await seedShop();
    const company = await seedCompany();
    await seedNetTermsOrder(company.id);

    admin.setFixture("PublishCompanyCredit", {
      data: { metafieldsSet: null },
      errors: [
        {
          message: "Throttled",
          extensions: { code: "THROTTLED" },
        },
      ],
    });

    await expect(
      recomputeCompany(SHOP, COMPANY_GID),
    ).resolves.not.toBeNull();

    expect(captureException).toHaveBeenCalledTimes(1);
    const row = await prisma.company.findUniqueOrThrow({
      where: { id: company.id },
    });
    expect(row.publishedStateHash).toBeNull();
    expect(row.publishedAt).toBeNull();
  });
});

describe("Shop.active gate (SCHEDULER CONTRACT extends to metafield publishing)", () => {
  it("an inactive shop suppresses every publish — zero API calls", async () => {
    await seedShop(SHOP, false);
    const company = await seedCompany();
    await seedNetTermsOrder(company.id);

    await recomputeCompany(SHOP, COMPANY_GID);
    await publishCompanyCreditState(SHOP, company.id);

    expect(admin.callCount("PublishCompanyCredit")).toBe(0);
  });
});

describe("data_complete is SHOP-scoped (L-01; UNRESOLVED ≠ NO_COMPANY)", () => {
  it("an UNRESOLVED net-terms order anywhere in the shop flags EVERY company's payload", async () => {
    await seedShop();
    const company = await seedCompany();
    await seedNetTermsOrder(company.id);
    // Unattributed by construction: UNRESOLVED rows carry companyId null and
    // could belong to ANY company — including this one.
    await seedNetTermsOrder(null, {
      attributionStatus: "UNRESOLVED",
      orderGid: "gid://shopify/Order/7777",
    });

    await recomputeCompany(SHOP, COMPANY_GID);
    expect(lastPublishedPayload().data_complete).toBe(false);
  });

  it("a NO_COMPANY row never flags it — proven attached to no company", async () => {
    await seedShop();
    const company = await seedCompany();
    await seedNetTermsOrder(company.id);
    await seedNetTermsOrder(null, {
      attributionStatus: "NO_COMPANY",
      orderGid: "gid://shopify/Order/7778",
    });

    await recomputeCompany(SHOP, COMPANY_GID);
    expect(lastPublishedPayload().data_complete).toBe(true);
  });

  it("a card-paid D2C UNRESOLVED row never flags it — it can never contribute exposure", async () => {
    await seedShop();
    const company = await seedCompany();
    await seedNetTermsOrder(company.id);
    await seedNetTermsOrder(null, {
      attributionStatus: "UNRESOLVED",
      hasPaymentTerms: false,
      orderGid: "gid://shopify/Order/7779",
    });

    await recomputeCompany(SHOP, COMPANY_GID);
    expect(lastPublishedPayload().data_complete).toBe(true);
  });
});

describe("sequential recomputes converge (CRED-03/ordering)", () => {
  it("the final metafield value reflects the last committed state", async () => {
    await seedShop();
    const company = await seedCompany();
    const order = await seedNetTermsOrder(company.id, { outstanding: "500.00" });

    await recomputeCompany(SHOP, COMPANY_GID);
    expect(lastPublishedPayload().exposure).toBe("500.00");

    // The order is partially paid; the refetch wrote the new outstanding.
    await prisma.ledgerOrder.update({
      where: { id: order.id },
      data: { outstandingShop: new Prisma.Decimal("125.50") },
    });
    await recomputeCompany(SHOP, COMPANY_GID);

    expect(admin.callCount("PublishCompanyCredit")).toBe(2);
    expect(lastPublishedPayload().exposure).toBe("125.50");

    const row = await prisma.company.findUniqueOrThrow({
      where: { id: company.id },
    });
    expect(row.publishedAt!.getTime()).toBeGreaterThanOrEqual(
      row.recomputedAt!.getTime(),
    );
  });

  it("merchant settings project into the publish: limit and bypass carry through (CRED-04)", async () => {
    await seedShop();
    const company = await seedCompany({
      creditLimit: new Prisma.Decimal("5000"),
      bypassEnforcement: true,
    });
    await seedNetTermsOrder(company.id);

    await recomputeCompany(SHOP, COMPANY_GID);

    const payload = lastPublishedPayload();
    expect(payload.limit).toBe("5000.00");
    expect(payload.bypass).toBe(true);
  });
});
