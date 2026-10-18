import { readdirSync } from "node:fs";

import { HttpResponseError } from "@shopify/shopify-api";
import { SessionNotFoundError } from "@shopify/shopify-app-react-router/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import { getAdminContext } from "../app/services/admin-client.server";
import {
  TOKEN_FAILURE_KEY,
  TOKEN_FAILURE_THRESHOLD,
  TOKEN_FAILURE_WINDOW_MS,
  classifyConstructionFailure,
  classifyRequestFailure,
  recordTokenFailure,
} from "../app/services/token-health.server";
import { expiredRefreshableSession } from "./helpers/offline-session";
import { sourceWithoutComments } from "./helpers/module-source";

/**
 * WINDOWS #30 — a shop whose offline token can no longer be refreshed is an
 * uninstall nobody told us about, and the sweeps hammered six such production
 * shops every cycle without noticing.
 *
 * Only `unauthenticated.admin` is mocked. The seam itself
 * (app/services/admin-client.server.ts) is imported for real, because the seam
 * is the thing under test: it is where every construction and every GraphQL
 * call passes through, and therefore the only place with both signals.
 *
 * `prisma` here is the SAME client the app uses, so a spy on it observes the
 * seam's own queries.
 */
const unauthenticatedAdmin = vi.hoisted(() => vi.fn());

vi.mock("../app/shopify.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../app/shopify.server")>();
  return {
    ...actual,
    unauthenticated: { ...actual.unauthenticated, admin: unauthenticatedAdmin },
  };
});

const SHOP = "token-health.myshopify.com";
const OTHER_SHOP = "token-health-bystander.myshopify.com";
/** No Shop row and no session — the seam must still not mask the error. */
const NO_ROW_SHOP = "token-health-norow.myshopify.com";
const ALL_SHOPS = [SHOP, OTHER_SHOP, NO_ROW_SHOP];

const T0 = Date.parse("2026-09-10T12:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms);
const MIN = 60_000;

const refreshFailure = () =>
  new Response(undefined, { status: 500, statusText: "Internal Server Error" });
const invalidSubjectToken = () =>
  new HttpResponseError({
    message: "invalid_subject_token",
    code: 400,
    statusText: "Bad Request",
    body: { error: "invalid_subject_token" },
  });
const unauthorized = () =>
  new HttpResponseError({
    message: "Received an error response (401 Unauthorized) from Shopify",
    code: 401,
    statusText: "Unauthorized",
    body: {
      errors:
        "[API] Invalid API key or access token (unrecognized login or wrong password)",
    },
  });
const adminThatThrows = (error: unknown) => ({
  session: {},
  admin: { graphql: vi.fn().mockRejectedValue(error) },
});
const adminThatSucceeds = () => ({
  session: {},
  admin: {
    graphql: vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { shop: { id: "gid://shopify/Shop/1" } } }),
        ),
      ),
  },
});
const PROBE = "query Probe { shop { id } }";

async function wipe() {
  await prisma.syncCursor.deleteMany({
    where: { shop: { in: ALL_SHOPS }, key: TOKEN_FAILURE_KEY },
  });
  await prisma.session.deleteMany({ where: { shop: { in: ALL_SHOPS } } });
  await prisma.complianceRequest.deleteMany({
    where: { shop: { in: ALL_SHOPS } },
  });
  // NO_ROW_SHOP is in this list because the third strike upserts a
  // Shop{active:false} row for it — it must not leak past this suite.
  await prisma.shop.deleteMany({ where: { domain: { in: ALL_SHOPS } } });
}

async function failureRecord(shop: string) {
  const row = await prisma.syncCursor.findUnique({
    where: { shop_key: { shop, key: TOKEN_FAILURE_KEY } },
  });
  return row ? JSON.parse(row.value) : null;
}

/** Age the stored strike anchor so the next failure lands in a new window. */
async function backdateFailureRecord(shop: string, ms: number) {
  const record = await failureRecord(shop);
  if (!record) throw new Error(`no token-failure record for ${shop}`);
  await prisma.syncCursor.update({
    where: { shop_key: { shop, key: TOKEN_FAILURE_KEY } },
    data: {
      value: JSON.stringify({
        ...record,
        lastAt: new Date(Date.now() - ms).toISOString(),
      }),
    },
  });
}

async function seedActiveShop(domain: string) {
  await prisma.shop.create({ data: { domain, active: true } });
  await prisma.session.create({ data: expiredRefreshableSession(domain) });
}

beforeEach(async () => {
  unauthenticatedAdmin.mockReset();
  await wipe();
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe("classification (CONTEXT §3 — the closed list)", () => {
  it("classifies exactly the three token-class failures", () => {
    expect(classifyConstructionFailure(refreshFailure())).toBe("refresh-failed");
    expect(classifyConstructionFailure(invalidSubjectToken())).toBe(
      "invalid-subject-token",
    );
    expect(classifyRequestFailure(unauthorized())).toBe("unauthorized");

    // Everything else is somebody else's problem — and counting it would
    // deactivate a live merchant over a network blip.
    expect(classifyConstructionFailure(new Error("ECONNRESET"))).toBeNull();
    expect(
      classifyConstructionFailure(
        new HttpResponseError({
          message: "x",
          code: 500,
          statusText: "Internal Server Error",
        }),
      ),
    ).toBeNull();
    expect(
      classifyConstructionFailure(
        new HttpResponseError({
          message: "x",
          code: 400,
          statusText: "Bad Request",
          body: { error: "invalid_grant" },
        }),
      ),
    ).toBeNull();
    expect(
      classifyConstructionFailure(new Response(undefined, { status: 502 })),
    ).toBeNull();
    expect(classifyConstructionFailure(new SessionNotFoundError("none"))).toBeNull();
    // A 401 never surfaces from construction — refresh-token.mjs collapses it.
    expect(classifyConstructionFailure(unauthorized())).toBeNull();
    expect(classifyRequestFailure(refreshFailure())).toBeNull();
    expect(
      classifyRequestFailure(
        new HttpResponseError({
          message: "x",
          code: 403,
          statusText: "Forbidden",
        }),
      ),
    ).toBeNull();
    expect(classifyRequestFailure(new Error("timeout"))).toBeNull();
  });
});

describe("the strike model", () => {
  it("three strikes in three separate windows deactivate the shop on the third and delete its sessions", async () => {
    await seedActiveShop(SHOP);
    await prisma.complianceRequest.create({
      data: { shop: SHOP, topic: "CUSTOMERS_DATA_REQUEST" },
    });
    await seedActiveShop(OTHER_SHOP);
    unauthenticatedAdmin.mockRejectedValue(refreshFailure());

    // Strike 1.
    await expect(getAdminContext(SHOP)).rejects.toBeInstanceOf(Response);
    const first = await failureRecord(SHOP);
    expect(first.count).toBe(1);
    expect(first.lastReason).toBe("refresh-failed");
    expect(typeof first.lastAt).toBe("string");
    expect(
      (await prisma.shop.findUnique({ where: { domain: SHOP } }))!.active,
    ).toBe(true);
    expect(await prisma.session.count({ where: { shop: SHOP } })).toBe(1);

    // The hourly-sweep-over-N-companies case: a burst inside one window is one
    // strike, and the anchor does not slide.
    await expect(getAdminContext(SHOP)).rejects.toBeInstanceOf(Response);
    await expect(getAdminContext(SHOP)).rejects.toBeInstanceOf(Response);
    const burst = await failureRecord(SHOP);
    expect(burst.count).toBe(1);
    expect(burst.lastAt).toBe(first.lastAt);

    // Strike 2, a cycle later.
    await backdateFailureRecord(SHOP, 31 * MIN);
    await expect(getAdminContext(SHOP)).rejects.toBeInstanceOf(Response);
    expect((await failureRecord(SHOP)).count).toBe(2);
    expect(
      (await prisma.shop.findUnique({ where: { domain: SHOP } }))!.active,
    ).toBe(true);
    expect(await prisma.session.count({ where: { shop: SHOP } })).toBe(1);

    // Strike 3 — the original error is still rethrown, not swallowed.
    await backdateFailureRecord(SHOP, 31 * MIN);
    await expect(getAdminContext(SHOP)).rejects.toBeInstanceOf(Response);

    const shop = await prisma.shop.findUnique({ where: { domain: SHOP } });
    expect(shop!.active).toBe(false);
    expect(shop!.uninstalledAt).toBeInstanceOf(Date);
    expect(await prisma.session.count({ where: { shop: SHOP } })).toBe(0);
    // Counter cleared, so a reinstall starts from zero evidence.
    expect(await failureRecord(SHOP)).toBeNull();
    // D-06: deactivate, never delete.
    expect(await prisma.shop.count({ where: { domain: SHOP } })).toBe(1);
    expect(
      await prisma.complianceRequest.count({ where: { shop: SHOP } }),
    ).toBe(1);

    // The bystander was never touched.
    expect(
      (await prisma.shop.findUnique({ where: { domain: OTHER_SHOP } }))!.active,
    ).toBe(true);
    expect(await prisma.session.count({ where: { shop: OTHER_SHOP } })).toBe(1);
    expect(await failureRecord(OTHER_SHOP)).toBeNull();
  });

  it("repeated failures inside one sweep window count once", async () => {
    await seedActiveShop(SHOP);

    expect(TOKEN_FAILURE_WINDOW_MS).toBe(30 * MIN);
    expect(TOKEN_FAILURE_THRESHOLD).toBe(3);

    expect(await recordTokenFailure(SHOP, "refresh-failed", at(0))).toEqual({
      count: 1,
      deactivated: false,
    });
    expect(await recordTokenFailure(SHOP, "refresh-failed", at(1_000))).toEqual({
      count: 1,
      deactivated: false,
    });
    expect(await recordTokenFailure(SHOP, "refresh-failed", at(2_000))).toEqual({
      count: 1,
      deactivated: false,
    });
    expect(await failureRecord(SHOP)).toEqual({
      count: 1,
      lastAt: at(0).toISOString(),
      lastReason: "refresh-failed",
    });

    // A new window is a new sweep cycle.
    expect(
      await recordTokenFailure(SHOP, "refresh-failed", at(31 * MIN)),
    ).toEqual({ count: 2, deactivated: false });
    expect((await failureRecord(SHOP)).lastAt).toBe(at(31 * MIN).toISOString());

    // In-window: the reason updates, the anchor and the count do not.
    expect(
      await recordTokenFailure(SHOP, "unauthorized", at(31 * MIN + 1_000)),
    ).toEqual({ count: 2, deactivated: false });
    expect(await failureRecord(SHOP)).toEqual({
      count: 2,
      lastAt: at(31 * MIN).toISOString(),
      lastReason: "unauthorized",
    });

    expect(
      await recordTokenFailure(SHOP, "refresh-failed", at(62 * MIN)),
    ).toEqual({ count: 3, deactivated: true });
    expect(
      (await prisma.shop.findUnique({ where: { domain: SHOP } }))!.active,
    ).toBe(false);
    expect(await prisma.session.count({ where: { shop: SHOP } })).toBe(0);
    expect(await failureRecord(SHOP)).toBeNull();
  });

  it("an invalid_subject_token refresh rejection counts as a token failure", async () => {
    await seedActiveShop(SHOP);
    const error = invalidSubjectToken();
    unauthenticatedAdmin.mockRejectedValue(error);

    await expect(getAdminContext(SHOP)).rejects.toBe(error);

    const record = await failureRecord(SHOP);
    expect(record.count).toBe(1);
    expect(record.lastReason).toBe("invalid-subject-token");
  });

  it("an Admin API 401 thrown by the client counts as a token failure", async () => {
    await seedActiveShop(SHOP);
    const error = unauthorized();
    unauthenticatedAdmin.mockResolvedValue(adminThatThrows(error));

    const client = await getAdminContext(SHOP);
    await expect(client.graphql(PROBE)).rejects.toBe(error);

    const record = await failureRecord(SHOP);
    expect(record.count).toBe(1);
    expect(record.lastReason).toBe("unauthorized");
  });
});

describe("recovery and restraint", () => {
  it("a successful Admin call resets the counter", async () => {
    await seedActiveShop(SHOP);
    unauthenticatedAdmin.mockRejectedValue(refreshFailure());

    await expect(getAdminContext(SHOP)).rejects.toBeInstanceOf(Response);
    await backdateFailureRecord(SHOP, 31 * MIN);
    await expect(getAdminContext(SHOP)).rejects.toBeInstanceOf(Response);
    expect((await failureRecord(SHOP)).count).toBe(2);

    unauthenticatedAdmin.mockResolvedValue(adminThatSucceeds());
    const client = await getAdminContext(SHOP);
    const body = (await (await client.graphql(PROBE)).json()) as {
      data: { shop: { id: string } };
    };
    expect(body.data.shop.id).toBe("gid://shopify/Shop/1");
    expect(await failureRecord(SHOP)).toBeNull();

    // The next failure starts from one, not from three.
    unauthenticatedAdmin.mockRejectedValue(refreshFailure());
    await expect(getAdminContext(SHOP)).rejects.toBeInstanceOf(Response);
    expect((await failureRecord(SHOP)).count).toBe(1);
    expect(
      (await prisma.shop.findUnique({ where: { domain: SHOP } }))!.active,
    ).toBe(true);
    expect(await prisma.session.count({ where: { shop: SHOP } })).toBe(1);
  });

  it("confirms a shop healthy once per process — a second success issues no second DELETE", async () => {
    await seedActiveShop(SHOP);

    // One recorded failure first: it clears SHOP from the healthy set, so this
    // test does not depend on whichever earlier test last touched SHOP.
    unauthenticatedAdmin.mockRejectedValue(refreshFailure());
    await expect(getAdminContext(SHOP)).rejects.toBeInstanceOf(Response);
    expect((await failureRecord(SHOP)).count).toBe(1);

    unauthenticatedAdmin.mockResolvedValue(adminThatSucceeds());
    const spy = vi.spyOn(prisma.syncCursor, "deleteMany");

    try {
      await (await getAdminContext(SHOP)).graphql(PROBE);
      expect(await failureRecord(SHOP)).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({
        where: { shop: SHOP, key: TOKEN_FAILURE_KEY },
      });

      // A NEW context per call is exactly what graphqlJson does; the process
      // level set is what keeps this from being one DELETE per company.
      await (await getAdminContext(SHOP)).graphql(PROBE);
      expect(spy).toHaveBeenCalledTimes(1);

      // A recorded failure re-arms the DELETE.
      unauthenticatedAdmin.mockRejectedValue(refreshFailure());
      await expect(getAdminContext(SHOP)).rejects.toBeInstanceOf(Response);
      expect((await failureRecord(SHOP)).count).toBe(1);

      unauthenticatedAdmin.mockResolvedValue(adminThatSucceeds());
      await (await getAdminContext(SHOP)).graphql(PROBE);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("a non-token error never increments the counter or deactivates", async () => {
    await seedActiveShop(SHOP);

    const constructionNonTokens = [
      () => new Error("ECONNRESET"),
      () =>
        new HttpResponseError({
          message: "x",
          code: 500,
          statusText: "Internal Server Error",
        }),
      () =>
        new HttpResponseError({
          message: "x",
          code: 400,
          statusText: "Bad Request",
          body: { error: "invalid_grant" },
        }),
      () => new SessionNotFoundError("none"),
    ];

    for (const make of constructionNonTokens) {
      for (let i = 0; i < 3; i++) {
        const error = make();
        unauthenticatedAdmin.mockRejectedValue(error);
        await expect(getAdminContext(SHOP)).rejects.toBe(error);
        expect(await failureRecord(SHOP)).toBeNull();
      }
    }

    for (let i = 0; i < 3; i++) {
      const error = new HttpResponseError({
        message: "x",
        code: 403,
        statusText: "Forbidden",
      });
      unauthenticatedAdmin.mockResolvedValue(adminThatThrows(error));
      const client = await getAdminContext(SHOP);
      await expect(client.graphql(PROBE)).rejects.toBe(error);
      expect(await failureRecord(SHOP)).toBeNull();
    }

    expect(
      (await prisma.shop.findUnique({ where: { domain: SHOP } }))!.active,
    ).toBe(true);
    expect(await prisma.session.count({ where: { shop: SHOP } })).toBe(1);
  });

  it("bookkeeping never masks the original error", async () => {
    // No Shop row, no session — recordTokenFailure's upsert works regardless.
    const error = refreshFailure();
    unauthenticatedAdmin.mockRejectedValue(error);

    await expect(getAdminContext(NO_ROW_SHOP)).rejects.toBe(error);
    await backdateFailureRecord(NO_ROW_SHOP, 31 * MIN);
    await expect(getAdminContext(NO_ROW_SHOP)).rejects.toBe(error);
    await backdateFailureRecord(NO_ROW_SHOP, 31 * MIN);
    // The third call deactivates AND still rethrows.
    await expect(getAdminContext(NO_ROW_SHOP)).rejects.toBe(error);

    const shop = await prisma.shop.findUnique({
      where: { domain: NO_ROW_SHOP },
    });
    expect(shop!.active).toBe(false);
  });
});

describe("seam guard", () => {
  it("admin-client.server.ts is the only module that constructs an unauthenticated admin client (source guard)", () => {
    const seam = "app/services/admin-client.server.ts";
    const construction = /unauthenticated\s*\.\s*admin/g;

    for (const dir of ["app/services", "app/routes"]) {
      for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url))) {
        if (!/\.tsx?$/.test(entry)) continue;
        const path = `${dir}/${entry}`;
        if (path === seam) continue;

        const code = sourceWithoutComments(path);
        expect(code.length).toBeGreaterThan(0);
        expect(code).not.toMatch(construction);
      }
    }

    const seamCode = sourceWithoutComments(seam);
    expect(seamCode.length).toBeGreaterThan(200);
    expect([...seamCode.matchAll(construction)]).toHaveLength(1);
  });
});
