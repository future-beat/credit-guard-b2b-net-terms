import { beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import {
  REVIEW_NEVER_EVALUATED_CODES,
  REVIEW_RESULT_CODES,
  type ReviewResultCode,
} from "../app/review-codes";
import { EVENT_KIND } from "../app/services/enforcement.server";
import {
  recordReviewPromptResult,
  reviewEligibility,
} from "../app/services/onboarding.server";
import { REMINDER_STATUS, TOUCHPOINT } from "../app/services/reminders.server";
import { sourceWithoutComments } from "./helpers/module-source";

/**
 * LNCH-02 — the review moment.
 *
 * Two rules carry the whole feature, and both are bookkeeping rather than UI:
 * WHEN we are allowed to ask (a genuine success moment has happened and we have
 * never been evaluated) and WHETHER an answer closes the question. Shopify draws
 * the modal; the only thing that can go wrong on our side is asking a merchant
 * who has seen nothing work yet, asking twice, or — the failure B-01 exists to
 * prevent — silently never asking at all.
 */

const authenticateAdmin = vi.hoisted(() => vi.fn());

vi.mock("../app/shopify.server", () => ({
  authenticate: { admin: authenticateAdmin },
}));

const captureException = vi.hoisted(() => vi.fn());
const captureMessage = vi.hoisted(() => vi.fn());

vi.mock("@sentry/react-router", () => ({ captureException, captureMessage }));

const getAdminContext = vi.hoisted(() => vi.fn());

vi.mock("../app/services/admin-client.server", () => ({ getAdminContext }));

const SHOP = "review-test.myshopify.com";
const OTHER_SHOP = "review-bystander.myshopify.com";
const SHOPS = [SHOP, OTHER_SHOP];
const ENDPOINT = "https://app.creditguard.test/app";

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

async function routeModule() {
  return import("../app/routes/app._index");
}

interface ActionEnvelope {
  data: { ok: boolean; intent?: string; code?: string; stamped?: boolean };
  init?: { status?: number } | null;
}

async function runAction(
  fields: Record<string, string>,
): Promise<ActionEnvelope> {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);

  const { action } = await routeModule();
  const request = new Request(ENDPOINT, { method: "POST", body });
  return (await action({
    request,
    params: {},
    context: {},
  } as never)) as unknown as ActionEnvelope;
}

function status(result: ActionEnvelope): number {
  return result.init?.status ?? 200;
}

async function runLoader() {
  const { loader } = await routeModule();
  return loader({
    request: new Request(ENDPOINT),
    params: {},
    context: {},
  } as never) as Promise<{ reviewEligible: boolean }>;
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

async function seedShop(domain = SHOP, reviewPromptedAt: Date | null = null) {
  return prisma.shop.create({
    data: {
      domain,
      reviewPromptedAt,
      // Dismissed, so the loader's setup half makes no Admin call and this
      // suite is only ever measuring the review rules.
      onboardingDismissedAt: new Date("2026-08-20T00:00:00.000Z"),
    },
  });
}

function gid(prefix: string): string {
  return `gid://shopify/${prefix}/${Math.random().toString(36).slice(2)}`;
}

async function seedEvent(kind: string, shop = SHOP) {
  return prisma.enforcementEvent.create({
    data: {
      shop,
      companyGid: gid("Company"),
      companyName: "Acme Industrial",
      kind,
      exposure: "0",
      overdue: false,
      bypass: false,
    },
  });
}

async function seedReminder(reminderStatus: string, shop = SHOP) {
  return prisma.reminderLog.create({
    data: {
      shop,
      scheduleGid: gid("PaymentSchedule"),
      orderGid: gid("Order"),
      companyGid: null,
      companyName: "Acme Industrial",
      touchpoint: TOUCHPOINT.DUE_SOON,
      status: reminderStatus,
    },
  });
}

async function shopRow(domain = SHOP) {
  return prisma.shop.findUnique({ where: { domain } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  authenticateAdmin.mockResolvedValue({ session: { shop: SHOP } });
  getAdminContext.mockReset();
  await resetShops();
});

/* ------------------------------------------------------------------ *
 * Eligibility — has anything actually worked for this merchant yet?
 * ------------------------------------------------------------------ */

describe("review eligibility (LNCH-02)", () => {
  it("is false on a shop where nothing has happened", async () => {
    await seedShop();

    expect(await reviewEligibility(SHOP)).toBe(false);
  });

  it.each([
    ["a company went on credit hold", EVENT_KIND.BLOCK_STATE_ENTERED],
    ["an order slipped past a hold", EVENT_KIND.BYPASSED_ORDER],
  ])("is true once %s", async (_label, kind) => {
    await seedShop();
    await seedEvent(kind);

    expect(await reviewEligibility(SHOP)).toBe(true);
  });

  it("is true once a reminder was actually sent", async () => {
    await seedShop();
    await seedReminder(REMINDER_STATUS.SENT);

    expect(await reviewEligibility(SHOP)).toBe(true);
  });

  it.each([
    ["a release", EVENT_KIND.BLOCK_STATE_EXITED],
    ["the merchant's own bypass toggle", EVENT_KIND.BYPASS_ENABLED],
  ])("is false for %s — that is not a success moment", async (_label, kind) => {
    await seedShop();
    await seedEvent(kind);

    expect(await reviewEligibility(SHOP)).toBe(false);
  });

  it.each([
    ["an unconfirmed send", REMINDER_STATUS.SENT_UNCONFIRMED],
    ["a failure", REMINDER_STATUS.FAILED],
  ])("is false for %s", async (_label, reminderStatus) => {
    await seedShop();
    await seedReminder(reminderStatus);

    expect(await reviewEligibility(SHOP)).toBe(false);
  });

  it("is false once we have already been evaluated", async () => {
    await seedShop(SHOP, new Date("2026-08-20T00:00:00.000Z"));
    await seedEvent(EVENT_KIND.BLOCK_STATE_ENTERED);

    expect(await reviewEligibility(SHOP)).toBe(false);
  });

  it("never lets another shop's success moment qualify this one", async () => {
    await seedShop();
    await seedShop(OTHER_SHOP);
    await seedEvent(EVENT_KIND.BLOCK_STATE_ENTERED, OTHER_SHOP);
    await seedReminder(REMINDER_STATUS.SENT, OTHER_SHOP);

    expect(await reviewEligibility(SHOP)).toBe(false);
    expect(await reviewEligibility(OTHER_SHOP)).toBe(true);
  });

  it("is false for a shop with no row at all", async () => {
    expect(await reviewEligibility(SHOP)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The stamp rule (B-01) — evaluated closes the question, never-evaluated
 * leaves it open.
 * ------------------------------------------------------------------ */

const EVALUATED_CODES: ReviewResultCode[] = [
  "success",
  "already-reviewed",
  "annual-limit-reached",
  "cooldown-period",
  "merchant-ineligible",
  "mobile-app",
  "cancelled",
  "error",
];

describe("recording the prompt result (B-01)", () => {
  it.each(EVALUATED_CODES)(
    "stamps reviewPromptedAt for the evaluated outcome %s",
    async (code) => {
      await seedShop();

      const result = await recordReviewPromptResult(SHOP, code, new Date());

      expect(result).toEqual({ ok: true, stamped: true });
      expect((await shopRow())?.reviewPromptedAt).toBeInstanceOf(Date);
    },
  );

  it.each(REVIEW_NEVER_EVALUATED_CODES)(
    "leaves reviewPromptedAt null for %s — Shopify never looked",
    async (code) => {
      await seedShop();

      const result = await recordReviewPromptResult(SHOP, code, new Date());

      expect(result).toEqual({ ok: true, stamped: false });
      expect((await shopRow())?.reviewPromptedAt).toBeNull();
    },
  );

  it("covers every code the App Bridge surface can return", () => {
    // The two sets together ARE the whole vocabulary: a code added to
    // app-bridge-types without a decision here would fail this spec rather
    // than silently fall into the invalid branch.
    expect(
      [...EVALUATED_CODES, ...REVIEW_NEVER_EVALUATED_CODES].sort(),
    ).toEqual([...REVIEW_RESULT_CODES].sort());
  });

  it.each(["forged", "SUCCESS", "", "success; drop table"])(
    "refuses the unknown code %o and stamps nothing",
    async (code) => {
      await seedShop();

      const result = await recordReviewPromptResult(
        SHOP,
        code as ReviewResultCode,
        new Date(),
      );

      expect(result).toEqual({ ok: false, code: "invalid-code" });
      expect((await shopRow())?.reviewPromptedAt).toBeNull();
    },
  );

  it("keeps the first timestamp when a second result arrives", async () => {
    await seedShop();

    await recordReviewPromptResult(SHOP, "success", new Date());
    const first = (await shopRow())?.reviewPromptedAt;
    await recordReviewPromptResult(SHOP, "cancelled", new Date());

    expect((await shopRow())?.reviewPromptedAt).toEqual(first);
  });

  it("stamps the session shop only", async () => {
    await seedShop();
    await seedShop(OTHER_SHOP);

    await recordReviewPromptResult(SHOP, "success", new Date());

    expect((await shopRow(OTHER_SHOP))?.reviewPromptedAt).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The route — loader flag and the closed intent
 * ------------------------------------------------------------------ */

describe("the review moment on the home route", () => {
  it("tells the page to ask after a success moment, and not before", async () => {
    await seedShop();

    expect((await runLoader()).reviewEligible).toBe(false);

    await seedEvent(EVENT_KIND.BLOCK_STATE_ENTERED);

    expect((await runLoader()).reviewEligible).toBe(true);
  });

  it("stops asking once an evaluated answer comes back", async () => {
    await seedShop();
    await seedEvent(EVENT_KIND.BLOCK_STATE_ENTERED);

    const result = await runAction({
      intent: "review-prompt-result",
      code: "cooldown-period",
    });

    expect(result.data).toEqual({
      ok: true,
      intent: "review-prompt-result",
      stamped: true,
    });
    expect((await runLoader()).reviewEligible).toBe(false);
  });

  it("asks again after a code Shopify never evaluated (B-01)", async () => {
    await seedShop();
    await seedEvent(EVENT_KIND.BLOCK_STATE_ENTERED);

    const result = await runAction({
      intent: "review-prompt-result",
      code: "recently-installed",
    });

    expect(result.data).toEqual({
      ok: true,
      intent: "review-prompt-result",
      stamped: false,
    });
    // The guided setup drives the first credit hold INSIDE the 24h
    // recently-installed window; stamping there is how an app never asks.
    expect((await runLoader()).reviewEligible).toBe(true);
  });

  it("answers 400 to a forged result code", async () => {
    await seedShop();

    const result = await runAction({
      intent: "review-prompt-result",
      code: "definitely-loved-it",
    });

    expect(status(result)).toBe(400);
    expect(result.data).toEqual({ ok: false, code: "invalid-code" });
    expect((await shopRow())?.reviewPromptedAt).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Policy guards — Shopify owns the modal, and we own no copy at all
 * ------------------------------------------------------------------ */

describe("review prompt source guards (policy 1.3.1)", () => {
  const source = sourceWithoutComments("app/routes/app._index.tsx");

  it("asks exactly once per page load", () => {
    expect(source.match(/reviews\.request\(\)/g)).toHaveLength(1);
  });

  it("asks from an effect after mount, never from a click handler", () => {
    const effect = source.slice(source.indexOf("reviews.request()"));
    expect(source).toContain("useEffect");
    // No onClick between the effect body and the request: the trigger is the
    // page having loaded, not the merchant having pressed anything.
    expect(
      source
        .slice(0, source.indexOf("reviews.request()"))
        .split("useEffect")
        .pop(),
    ).not.toContain("onClick");
    expect(effect).toBeTruthy();
  });

  it("polls nothing and retries nothing", () => {
    expect(source).not.toContain("setInterval");
    expect(source).not.toContain("setTimeout");
  });

  it("carries no review copy of its own", async () => {
    const { COPY } = await routeModule();
    const values = JSON.stringify(COPY).toLowerCase();

    for (const forbidden of ["rate us", "leave a review", "review us"]) {
      expect(values).not.toContain(forbidden);
      expect(source.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("keeps the result codes in a transport-free module (the 04-04 trap)", () => {
    // The browser validates the code before posting it, so this module ships
    // to the client — an import here would drag a server module with it.
    expect(sourceWithoutComments("app/review-codes.ts")).not.toContain("import");
  });
});
