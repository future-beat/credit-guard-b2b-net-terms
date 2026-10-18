import { readFileSync } from "node:fs";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import { createMockAdmin, type MockAdminClient } from "./helpers/admin-client-mock";

/**
 * CRED-01 / CRED-02 — the Companies settings route, end to end.
 *
 * The ONLY boundary stubbed here is `authenticate.admin`: no existing suite
 * authenticates an admin session, and a real session token would need a live
 * Shopify to mint it. Everything downstream of the stub is real — the real
 * route module, real Prisma rows in the scratch test database, the real
 * `recomputeCompany` → `publishCompanyCreditState` chain — with only the Admin
 * GraphQL seam faked, exactly as the webhook suites do it.
 *
 * That split is what makes these assertions worth anything: "the CAS rejected a
 * stale echo" is proven by a Postgres row that did not move, not by a mock.
 */

/** The session the stub hands back. `shop` here is the tenant boundary. */
const authenticateAdmin = vi.hoisted(() => vi.fn());

vi.mock("../app/shopify.server", () => ({
  authenticate: { admin: authenticateAdmin },
}));

const getAdminContext = vi.hoisted(() => vi.fn());

vi.mock("../app/services/admin-client.server", () => ({ getAdminContext }));

const captureException = vi.hoisted(() => vi.fn());
const captureMessage = vi.hoisted(() => vi.fn());

vi.mock("@sentry/react-router", () => ({ captureException, captureMessage }));

const SHOP = "companies-settings-test.myshopify.com";
const OTHER_SHOP = "companies-settings-bystander.myshopify.com";
const ENDPOINT = "https://app.creditguard.test/app/companies";

let admin: MockAdminClient;

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

/** RR7 `data()` returns a `DataWithResponseInit`, not a `Response`. */
interface ActionResult {
  data: Record<string, unknown>;
  init: { status?: number } | null;
}

async function routeModule() {
  return import("../app/routes/app.companies");
}

/**
 * The pure rendering helpers and the copy constants are imported statically —
 * `vi.mock` is hoisted above every import, so the auth stub is already in place
 * by the time this module graph loads.
 */
const {
  BYPASS_FAILED_TOAST,
  BYPASS_OFF_TOAST,
  BYPASS_ON_TOAST,
  COLUMN_HEADERS,
  DISCARD_LABEL,
  LIMIT_INVALID_ERROR,
  LIMIT_REMOVED_TOAST,
  LIMIT_SAVE_FAILED_ERROR,
  LIMIT_UPDATED_TOAST,
  NO_LIMIT_LABEL,
  REMOVE_LIMIT_LABEL,
  SAVE_LIMIT_LABEL,
  SET_LIMIT_LABEL,
  STATUS_BYPASSED,
  STATUS_OBSERVE_ONLY,
  STATUS_OVERDUE,
  STATUS_OVER_LIMIT,
  STATUS_WITHIN_LIMIT,
  primaryStatusOf,
  utilizationLabel,
} = await routeModule();

async function runAction(fields: Record<string, string>): Promise<ActionResult> {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);

  const { action } = await routeModule();
  const request = new Request(ENDPOINT, { method: "POST", body });
  return (await action({ request, params: {}, context: {} } as never)) as ActionResult;
}

async function runLoader(url = ENDPOINT) {
  const { loader } = await routeModule();
  const request = new Request(url);
  return loader({ request, params: {}, context: {} } as never);
}

function statusOf(result: ActionResult): number {
  return result.init?.status ?? 200;
}

async function seedShop(domain: string, active = true) {
  await prisma.shop.upsert({
    where: { domain },
    create: { domain, active },
    update: { active },
  });
}

interface CompanySeed {
  shop?: string;
  companyGid?: string;
  name?: string;
  creditLimit?: string | null;
  bypassEnforcement?: boolean;
  exposure?: string;
  overdue?: boolean;
}

async function seedCompany(seed: CompanySeed = {}) {
  const shop = seed.shop ?? SHOP;
  const companyGid = seed.companyGid ?? "gid://shopify/Company/1";
  return prisma.company.create({
    data: {
      shop,
      companyGid,
      name: seed.name ?? "Acme Industrial",
      exposure: seed.exposure ?? "0",
      overdue: seed.overdue ?? false,
      creditLimit: seed.creditLimit ?? null,
      bypassEnforcement: seed.bypassEnforcement ?? false,
    },
  });
}

async function readCompany(id: string) {
  const row = await prisma.company.findUnique({ where: { id } });
  if (!row) throw new Error(`company ${id} vanished`);
  return row;
}

/** `null` stays `null`; a set limit comes back as a fixed-2 string. */
function limitOf(row: { creditLimit: unknown }): string | null {
  const value = row.creditLimit as { toFixed(dp: number): string } | null;
  return value === null ? null : value.toFixed(2);
}

async function wipe(...domains: string[]) {
  await prisma.ledgerSchedule.deleteMany({ where: { shop: { in: domains } } });
  await prisma.ledgerOrder.deleteMany({ where: { shop: { in: domains } } });
  await prisma.company.deleteMany({ where: { shop: { in: domains } } });
  await prisma.syncCursor.deleteMany({ where: { shop: { in: domains } } });
  await prisma.session.deleteMany({ where: { shop: { in: domains } } });
  await prisma.shop.deleteMany({ where: { domain: { in: domains } } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  admin = createMockAdmin();
  getAdminContext.mockReset();
  getAdminContext.mockResolvedValue(admin);
  authenticateAdmin.mockResolvedValue({ session: { shop: SHOP } });

  await wipe(SHOP, OTHER_SHOP);
  await seedShop(SHOP);
  await seedShop(OTHER_SHOP);
});

afterAll(async () => {
  await wipe(SHOP, OTHER_SHOP);
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ *
 * Loader
 * ------------------------------------------------------------------ */

describe("loader", () => {
  it("returns only the authenticated shop's companies", async () => {
    await seedCompany({ name: "Ours", companyGid: "gid://shopify/Company/1" });
    await seedCompany({
      shop: OTHER_SHOP,
      name: "Theirs",
      companyGid: "gid://shopify/Company/2",
    });

    const result = await runLoader();

    expect(result.companies.map((company) => company.name)).toEqual(["Ours"]);
  });

  it("sorts by name A-Z with a deterministic id tie-break", async () => {
    // Same name three times: without the id tie-break Postgres is free to
    // return these in any order, and the table would shuffle on every
    // revalidation.
    for (const gid of [
      "gid://shopify/Company/3",
      "gid://shopify/Company/1",
      "gid://shopify/Company/2",
    ]) {
      await seedCompany({ name: "Duplicate Co", companyGid: gid });
    }
    await seedCompany({ name: "Alpha Co", companyGid: "gid://shopify/Company/9" });
    await seedCompany({ name: "zeta co", companyGid: "gid://shopify/Company/8" });

    const first = await runLoader();
    const second = await runLoader();

    expect(first.companies[0].name).toBe("Alpha Co");
    expect(first.companies.at(-1)?.name).toBe("zeta co");
    expect(first.companies.map((company) => company.id)).toEqual(
      second.companies.map((company) => company.id),
    );

    const duplicateIds = first.companies
      .filter((company) => company.name === "Duplicate Co")
      .map((company) => company.id);
    expect(duplicateIds).toEqual([...duplicateIds].sort());
  });

  it("carries the shop-level data_complete flag and backfill status", async () => {
    await seedCompany();

    const complete = await runLoader();
    expect(complete.dataComplete).toBe(true);
    expect(complete.backfillRunning).toBe(false);

    // One unattributed net-terms order is all it takes (L-01 NOT-EXISTS).
    await prisma.ledgerOrder.create({
      data: {
        shop: SHOP,
        orderGid: "gid://shopify/Order/1",
        name: "#1001",
        currencyCode: "AUD",
        outstandingShop: "100",
        attributionStatus: "UNRESOLVED",
        hasPaymentTerms: true,
        sourceUpdatedAt: new Date(),
        refetchedAt: new Date(),
      },
    });

    const partial = await runLoader();
    expect(partial.dataComplete).toBe(false);
  });

  it("never reaches the Admin API", async () => {
    await seedCompany();

    await runLoader();

    expect(admin.callCount()).toBe(0);
  });

  it("serializes limits so null and zero stay distinguishable (D-02)", async () => {
    await seedCompany({ name: "No Limit Co", companyGid: "gid://shopify/Company/1" });
    await seedCompany({
      name: "Zero Co",
      companyGid: "gid://shopify/Company/2",
      creditLimit: "0",
    });

    const result = await runLoader();
    const byName = new Map(result.companies.map((company) => [company.name, company]));

    expect(byName.get("No Limit Co")?.creditLimit).toBeNull();
    expect(byName.get("Zero Co")?.creditLimit).toBe("0.00");
  });

  it("pages at 50 companies", async () => {
    for (let index = 0; index < 51; index += 1) {
      await seedCompany({
        name: `Company ${String(index).padStart(3, "0")}`,
        companyGid: `gid://shopify/Company/${index}`,
      });
    }

    const first = await runLoader();
    expect(first.companies).toHaveLength(50);
    expect(first.hasNextPage).toBe(true);
    expect(first.hasPreviousPage).toBe(false);

    const second = await runLoader(`${ENDPOINT}?page=2`);
    expect(second.companies).toHaveLength(1);
    expect(second.hasNextPage).toBe(false);
    expect(second.hasPreviousPage).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Intent dispatch (T-03-02)
 * ------------------------------------------------------------------ */

describe("intent dispatch", () => {
  it("rejects an unknown intent with 400 and changes nothing", async () => {
    const company = await seedCompany({ creditLimit: "500" });

    const result = await runAction({
      intent: "delete-everything",
      companyId: company.id,
    });

    expect(statusOf(result)).toBe(400);
    expect(result.data.ok).toBe(false);
    expect(limitOf(await readCompany(company.id))).toBe("500.00");
    expect(admin.callCount("PublishCompanyCredit")).toBe(0);
  });

  it("rejects a missing intent with 400", async () => {
    const company = await seedCompany();

    const result = await runAction({ companyId: company.id });

    expect(statusOf(result)).toBe(400);
    expect(result.data.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * set-limit (CRED-01)
 * ------------------------------------------------------------------ */

describe("set-limit", () => {
  it("sets a limit on an unset company and republishes", async () => {
    const company = await seedCompany();

    const result = await runAction({
      intent: "set-limit",
      companyId: company.id,
      limit: "5000.00",
      previousLimit: "",
    });

    expect(statusOf(result)).toBe(200);
    expect(result.data.ok).toBe(true);
    expect(result.data.limitRemoved).toBe(false);
    expect(limitOf(await readCompany(company.id))).toBe("5000.00");
    expect(admin.callCount("PublishCompanyCredit")).toBe(1);
  });

  it("persists null when the field is submitted empty (remove via clear)", async () => {
    const company = await seedCompany({ creditLimit: "5000" });

    const result = await runAction({
      intent: "set-limit",
      companyId: company.id,
      limit: "",
      previousLimit: "5000.00",
    });

    expect(statusOf(result)).toBe(200);
    expect(result.data.limitRemoved).toBe(true);
    expect(limitOf(await readCompany(company.id))).toBeNull();
  });

  it("persists zero as a real limit, never as null (D-02)", async () => {
    const company = await seedCompany();

    const result = await runAction({
      intent: "set-limit",
      companyId: company.id,
      limit: "0",
      previousLimit: "",
    });

    expect(statusOf(result)).toBe(200);
    expect(result.data.limitRemoved).toBe(false);
    expect(limitOf(await readCompany(company.id))).toBe("0.00");
  });

  it.each([
    ["exponent notation", "1e9"],
    ["negative zero", "-0"],
    ["negative", "-5"],
    ["not a number", "NaN"],
    ["grouped", "1,000"],
    ["three decimal places", "5.999"],
    ["fourteen integer digits", "12345678901234"],
    ["whitespace padded", " 100 "],
    ["bare decimal point", "."],
    ["leading plus", "+100"],
  ])("rejects %s without touching the row", async (_label, value) => {
    const company = await seedCompany({ creditLimit: "500" });

    const result = await runAction({
      intent: "set-limit",
      companyId: company.id,
      limit: value,
      previousLimit: "500.00",
    });

    expect(statusOf(result)).toBe(422);
    expect(result.data.ok).toBe(false);
    expect(result.data.code).toBe("invalid");
    expect(limitOf(await readCompany(company.id))).toBe("500.00");
    expect(admin.callCount("PublishCompanyCredit")).toBe(0);
  });

  it("rejects a malformed previousLimit echo", async () => {
    const company = await seedCompany({ creditLimit: "500" });

    const result = await runAction({
      intent: "set-limit",
      companyId: company.id,
      limit: "600.00",
      previousLimit: "5e2",
    });

    expect(statusOf(result)).toBe(422);
    expect(limitOf(await readCompany(company.id))).toBe("500.00");
  });

  it("rejects a stale echo with 409 and leaves the winner's value in place", async () => {
    const company = await seedCompany({ creditLimit: "500" });

    // Someone else already moved it to 900 — this request still echoes 500.
    await prisma.company.update({
      where: { id: company.id },
      data: { creditLimit: "900" },
    });

    const result = await runAction({
      intent: "set-limit",
      companyId: company.id,
      limit: "600.00",
      previousLimit: "500.00",
    });

    expect(statusOf(result)).toBe(409);
    expect(result.data.code).toBe("stale");
    expect(limitOf(await readCompany(company.id))).toBe("900.00");
    expect(admin.callCount("PublishCompanyCredit")).toBe(0);
  });

  it("resolves two concurrent edits with exactly one winner", async () => {
    const company = await seedCompany({ creditLimit: "500" });

    const [first, second] = await Promise.all([
      runAction({
        intent: "set-limit",
        companyId: company.id,
        limit: "600.00",
        previousLimit: "500.00",
      }),
      runAction({
        intent: "set-limit",
        companyId: company.id,
        limit: "700.00",
        previousLimit: "500.00",
      }),
    ]);

    const statuses = [statusOf(first), statusOf(second)].sort();
    expect(statuses).toEqual([200, 409]);
    expect(["600.00", "700.00"]).toContain(limitOf(await readCompany(company.id)));
  });

  it("treats an unchanged save as a successful no-op", async () => {
    const company = await seedCompany({ creditLimit: "500" });

    const result = await runAction({
      intent: "set-limit",
      companyId: company.id,
      limit: "500.00",
      previousLimit: "500.00",
    });

    expect(statusOf(result)).toBe(200);
    expect(result.data.ok).toBe(true);
    expect(limitOf(await readCompany(company.id))).toBe("500.00");
  });

  it("matches a null echo only against rows whose limit IS NULL", async () => {
    const unset = await seedCompany({ companyGid: "gid://shopify/Company/1" });
    const set = await seedCompany({
      companyGid: "gid://shopify/Company/2",
      creditLimit: "250",
    });

    const okResult = await runAction({
      intent: "set-limit",
      companyId: unset.id,
      limit: "100.00",
      previousLimit: "",
    });
    expect(statusOf(okResult)).toBe(200);
    expect(limitOf(await readCompany(unset.id))).toBe("100.00");

    // Same null echo against a row that DOES have a limit must not win.
    const staleResult = await runAction({
      intent: "set-limit",
      companyId: set.id,
      limit: "100.00",
      previousLimit: "",
    });
    expect(statusOf(staleResult)).toBe(409);
    expect(limitOf(await readCompany(set.id))).toBe("250.00");
  });

  it("cannot write another shop's company (T-03-01)", async () => {
    const foreign = await seedCompany({
      shop: OTHER_SHOP,
      companyGid: "gid://shopify/Company/99",
      creditLimit: "1000",
    });

    const result = await runAction({
      intent: "set-limit",
      companyId: foreign.id,
      limit: "1.00",
      previousLimit: "1000.00",
    });

    expect(statusOf(result)).toBe(404);
    expect(result.data.ok).toBe(false);
    expect(limitOf(await readCompany(foreign.id))).toBe("1000.00");
    expect(admin.callCount("PublishCompanyCredit")).toBe(0);
  });

  it("ignores a shop supplied in the form body (session is the only source)", async () => {
    const foreign = await seedCompany({
      shop: OTHER_SHOP,
      companyGid: "gid://shopify/Company/99",
      creditLimit: "1000",
    });

    const result = await runAction({
      intent: "set-limit",
      companyId: foreign.id,
      limit: "1.00",
      previousLimit: "1000.00",
      shop: OTHER_SHOP,
    });

    expect(statusOf(result)).toBe(404);
    expect(limitOf(await readCompany(foreign.id))).toBe("1000.00");
  });

  it("reports the DB save as successful even when the metafield publish fails", async () => {
    // Locked decision 3: the toast covers the DB write; the projection heals via
    // the sweep, so a userErrors response must not read as "your limit failed".
    admin.setFixture("PublishCompanyCredit", {
      data: {
        metafieldsSet: {
          metafields: [],
          userErrors: [{ field: ["metafields"], message: "Owner not found" }],
        },
      },
    });
    const company = await seedCompany();

    const result = await runAction({
      intent: "set-limit",
      companyId: company.id,
      limit: "5000.00",
      previousLimit: "",
    });

    expect(statusOf(result)).toBe(200);
    expect(result.data.ok).toBe(true);
    expect(limitOf(await readCompany(company.id))).toBe("5000.00");
  });
});

/* ------------------------------------------------------------------ *
 * set-bypass (CRED-02)
 * ------------------------------------------------------------------ */

describe("set-bypass", () => {
  it("turns the bypass on and republishes", async () => {
    const company = await seedCompany();

    const result = await runAction({
      intent: "set-bypass",
      companyId: company.id,
      bypass: "true",
    });

    expect(statusOf(result)).toBe(200);
    expect(result.data.bypass).toBe(true);
    expect((await readCompany(company.id)).bypassEnforcement).toBe(true);
    expect(admin.callCount("PublishCompanyCredit")).toBe(1);
  });

  it("returns a bypassed row exactly to its prior state when turned off", async () => {
    const company = await seedCompany({
      creditLimit: "750",
      bypassEnforcement: true,
    });

    const result = await runAction({
      intent: "set-bypass",
      companyId: company.id,
      bypass: "false",
    });

    expect(statusOf(result)).toBe(200);
    expect(result.data.bypass).toBe(false);

    const row = await readCompany(company.id);
    expect(row.bypassEnforcement).toBe(false);
    // Bypass never touches any other cell (D-03).
    expect(limitOf(row)).toBe("750.00");
  });

  it("treats setting the current value as a successful no-op", async () => {
    const company = await seedCompany({ bypassEnforcement: true });

    const result = await runAction({
      intent: "set-bypass",
      companyId: company.id,
      bypass: "true",
    });

    expect(statusOf(result)).toBe(200);
    expect((await readCompany(company.id)).bypassEnforcement).toBe(true);
  });

  it("resolves concurrent flips last-write-wins without failing either", async () => {
    const company = await seedCompany();

    const results = await Promise.all([
      runAction({ intent: "set-bypass", companyId: company.id, bypass: "true" }),
      runAction({ intent: "set-bypass", companyId: company.id, bypass: "false" }),
    ]);

    expect(results.map(statusOf)).toEqual([200, 200]);
    expect(typeof (await readCompany(company.id)).bypassEnforcement).toBe("boolean");
  });

  it.each(["1", "yes", "TRUE", "", "on"])(
    "rejects the non-boolean value %j with 400",
    async (value) => {
      const company = await seedCompany();

      const result = await runAction({
        intent: "set-bypass",
        companyId: company.id,
        bypass: value,
      });

      expect(statusOf(result)).toBe(400);
      expect((await readCompany(company.id)).bypassEnforcement).toBe(false);
      expect(admin.callCount("PublishCompanyCredit")).toBe(0);
    },
  );

  it("cannot flip another shop's company (T-03-01)", async () => {
    const foreign = await seedCompany({
      shop: OTHER_SHOP,
      companyGid: "gid://shopify/Company/99",
    });

    const result = await runAction({
      intent: "set-bypass",
      companyId: foreign.id,
      bypass: "true",
    });

    expect(statusOf(result)).toBe(404);
    expect((await readCompany(foreign.id)).bypassEnforcement).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Response contracts the interaction layer depends on
 * ------------------------------------------------------------------ */

describe("response contracts", () => {
  it("discriminates success payloads by intent", async () => {
    const company = await seedCompany();

    const limit = await runAction({
      intent: "set-limit",
      companyId: company.id,
      limit: "10.00",
      previousLimit: "",
    });
    expect(limit.data).toEqual({
      ok: true,
      intent: "set-limit",
      limitRemoved: false,
    });

    const bypass = await runAction({
      intent: "set-bypass",
      companyId: company.id,
      bypass: "true",
    });
    expect(bypass.data).toEqual({ ok: true, intent: "set-bypass", bypass: true });
  });

  it("returns a bare code on every failure so the UI can branch on it", async () => {
    const company = await seedCompany({ creditLimit: "500" });

    const invalid = await runAction({
      intent: "set-limit",
      companyId: company.id,
      limit: "abc",
      previousLimit: "500.00",
    });
    expect(invalid.data).toEqual({ ok: false, code: "invalid" });

    await prisma.company.update({
      where: { id: company.id },
      data: { creditLimit: "600" },
    });
    const stale = await runAction({
      intent: "set-limit",
      companyId: company.id,
      limit: "700.00",
      previousLimit: "500.00",
    });
    expect(stale.data).toEqual({ ok: false, code: "stale" });

    const unknown = await runAction({ intent: "nope", companyId: company.id });
    expect(unknown.data).toEqual({ ok: false, code: "unknown-intent" });
  });

  it("flags a removal so the toast can say 'removed' rather than 'updated'", async () => {
    const company = await seedCompany({ creditLimit: "500" });

    const result = await runAction({
      intent: "set-limit",
      companyId: company.id,
      limit: "",
      previousLimit: "500.00",
    });

    expect(result.data).toEqual({
      ok: true,
      intent: "set-limit",
      limitRemoved: true,
    });
  });
});

/* ------------------------------------------------------------------ *
 * Rendering contracts (03-UI-SPEC.md)
 * ------------------------------------------------------------------ */

describe("status derivation", () => {
  function statusFor(overrides: {
    exposure?: string;
    overdue?: boolean;
    creditLimit?: string | null;
  }) {
    return primaryStatusOf({
      exposure: "0.00",
      overdue: false,
      creditLimit: null,
      ...overrides,
    });
  }

  it("treats a limit exactly equal to exposure as within limit", () => {
    expect(statusFor({ exposure: "5000.00", creditLimit: "5000.00" })).toBe(
      "within-limit",
    );
  });

  it("flips to over limit on one more cent", () => {
    expect(statusFor({ exposure: "5000.01", creditLimit: "5000.00" })).toBe(
      "over-limit",
    );
  });

  it("treats a zero limit with any exposure as over limit", () => {
    expect(statusFor({ exposure: "0.01", creditLimit: "0.00" })).toBe("over-limit");
    expect(statusFor({ exposure: "0.00", creditLimit: "0.00" })).toBe(
      "within-limit",
    );
  });

  it("shows observe only when no limit is set (CRED-04 default)", () => {
    expect(statusFor({ exposure: "9999.00", creditLimit: null })).toBe(
      "observe-only",
    );
  });

  it("lets overdue outrank every other state", () => {
    expect(statusFor({ exposure: "1.00", creditLimit: null, overdue: true })).toBe(
      "overdue",
    );
    expect(
      statusFor({ exposure: "9999.00", creditLimit: "1.00", overdue: true }),
    ).toBe("overdue");
  });

  it("counts negative exposure as within limit", () => {
    expect(statusFor({ exposure: "-250.00", creditLimit: "100.00" })).toBe(
      "within-limit",
    );
  });
});

describe("utilization", () => {
  it("is undefined without a usable limit", () => {
    expect(utilizationLabel("500.00", null)).toBeNull();
    expect(utilizationLabel("500.00", "0.00")).toBeNull();
  });

  it("renders a rounded whole percent", () => {
    expect(utilizationLabel("2100.00", "5000.00")).toBe("42%");
    expect(utilizationLabel("6900.00", "5000.00")).toBe("138%");
    expect(utilizationLabel("5000.00", "5000.00")).toBe("100%");
  });

  it("caps runaway ratios instead of stretching the column", () => {
    expect(utilizationLabel("50000.00", "5.00")).toBe(">999%");
    expect(utilizationLabel("49.95", "5.00")).toBe("999%");
  });

  it("floors negative exposure at zero percent", () => {
    expect(utilizationLabel("-250.00", "100.00")).toBe("0%");
  });
});

describe("copy contract", () => {
  it("matches the UI-SPEC copywriting rows byte for byte", () => {
    // Rows 4-5: the checker replaced generic labels with these exact strings.
    expect(SET_LIMIT_LABEL).toBe("Set limit");
    expect(SAVE_LIMIT_LABEL).toBe("Save limit");
    expect(DISCARD_LABEL).toBe("Discard");
    expect(REMOVE_LIMIT_LABEL).toBe("Remove limit");

    // Row 6: the locked status vocabulary (D-03).
    expect(STATUS_OVERDUE).toBe("Overdue");
    expect(STATUS_OVER_LIMIT).toBe("Over limit");
    expect(STATUS_WITHIN_LIMIT).toBe("Within limit");
    expect(STATUS_OBSERVE_ONLY).toBe("Observe only");
    expect(STATUS_BYPASSED).toBe("Enforcement bypassed");
    expect(NO_LIMIT_LABEL).toBe("No limit");

    // Rows 10-17.
    expect(LIMIT_INVALID_ERROR).toBe("Enter an amount of $0.00 or more.");
    expect(LIMIT_SAVE_FAILED_ERROR).toBe(
      "Couldn't save this limit. Check your connection and try again.",
    );
    expect(LIMIT_UPDATED_TOAST).toBe("Credit limit updated");
    expect(LIMIT_REMOVED_TOAST).toBe("Credit limit removed");
    expect(BYPASS_ON_TOAST).toBe("Enforcement bypassed");
    expect(BYPASS_OFF_TOAST).toBe("Bypass removed");
    expect(BYPASS_FAILED_TOAST).toBe("Couldn't update bypass. Try again.");
  });

  it("keeps D-01's locked column order", () => {
    expect(COLUMN_HEADERS).toEqual([
      "Company",
      "Exposure",
      "Credit limit",
      "Utilization",
      "Status",
      "Bypass enforcement",
    ]);
  });
});

/**
 * Source guards. Tone choices and the no-enforcement-language rule survive only
 * as literals in the JSX, so they are asserted against comment-stripped source
 * — a rule that lives in a comment is not a rule.
 */
describe("source guards", () => {
  const source = readFileSync(
    new URL("../app/routes/app.companies.tsx", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("uses caution for the bypass badge (there is no attention tone)", () => {
    expect(source).toContain('tone="caution"');
    expect(source).not.toContain('tone="attention"');
  });

  it("never claims success — nothing is enforced until Phase 4", () => {
    expect(source).not.toContain('tone="success"');
    expect(source).not.toMatch(/\bprotected\b/i);
    expect(source).not.toMatch(/\benforcing\b/i);
  });

  it("never float-parses money", () => {
    expect(source).not.toContain("parseFloat");
    expect(source).not.toContain("parseInt");
  });

  it("imports no Polaris React package", () => {
    expect(source).not.toContain("@shopify/polaris");
  });

  it("reads shop from the session, never from the form body", () => {
    expect(source).toContain("session.shop");
    expect(source).not.toMatch(/form\.get\(\s*["']shop["']\s*\)/);
  });
});
