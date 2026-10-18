import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import {
  ALREADY_COMPLETED_MESSAGE,
  DUE_SOON_LEAD_MS,
  FAILURE_REASON,
  OVERDUE_OFFSET_MS,
  RATE_LIMIT_MESSAGE,
  REMINDER_STATUS,
  REMINDER_SWEEP_CRON,
  REMINDER_SWEEP_LEASE,
  RETRIABLE_GRAPHQL_CODES,
  SCHEDULE_REFETCH_QUERY,
  SEND_CAP_PER_SWEEP,
  SEND_REMINDER_MUTATION,
  TOUCHPOINT,
  type Touchpoint,
  classifySendResponse,
  deriveTouchpoints,
  reminderSweep,
  selectEligible,
  sendReminder,
} from "../app/services/reminders.server";
import { createMockAdmin, type MockAdminClient } from "./helpers/admin-client-mock";
import { sourceWithoutComments } from "./helpers/module-source";

/**
 * REMD-01 / D5-01 / D5-02 — the reminder sweep tracer.
 *
 * One vertical slice, proven end-to-end at the ONLY seam that is faked: the
 * Admin GraphQL transport. `admin-client.server.ts` is mocked, so
 * `graphqlJson`, the claim, the watermark gate, `forEachActiveShop`'s active
 * filter and every Prisma write are the real thing running against real
 * Postgres. What lands in `ReminderLog` here is what would land in production.
 */
vi.mock("@sentry/react-router", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const getAdminContext = vi.hoisted(() => vi.fn());
vi.mock("../app/services/admin-client.server", () => ({ getAdminContext }));

const SHOP = "rem-enabled.myshopify.com";
const OFF_SHOP = "rem-off.myshopify.com";
const INACTIVE_SHOP = "rem-inactive.myshopify.com";
/** A second enabled shop, for proving one shop's pass cannot reach another's. */
const OTHER_SHOP = "rem-other.myshopify.com";
const SHOPS = [SHOP, OFF_SHOP, INACTIVE_SHOP, OTHER_SHOP];

/** The instant every sweep in this file is evaluated at. */
const NOW = new Date("2026-09-01T12:00:00.000Z");
/** Due long enough ago that `dueAt + 72h` is comfortably past NOW. */
const LONG_PAST_DUE = new Date("2026-08-20T12:00:00.000Z");
/** The merchant opted in before any of that happened. */
const ENABLED_LONG_AGO = new Date("2026-08-01T00:00:00.000Z");

/** The operation names the mock keys fixtures by. */
const SEND = "SendReminder";
const REFETCH = "ScheduleRefetch";

/** 24h platform limit plus the one-hour margin the hourly cadence needs. */
const HOUR = 60 * 60 * 1000;
const GUARD_MS = 25 * HOUR;

const scheduleGidOf = (shop: string) => `gid://shopify/PaymentSchedule/${shop}`;

async function wipe() {
  await prisma.reminderLog.deleteMany({ where: { shop: { in: SHOPS } } });
  await prisma.ledgerSchedule.deleteMany({ where: { shop: { in: SHOPS } } });
  await prisma.ledgerOrder.deleteMany({ where: { shop: { in: SHOPS } } });
  await prisma.company.deleteMany({ where: { shop: { in: SHOPS } } });
  await prisma.shop.deleteMany({ where: { domain: { in: SHOPS } } });
}

interface SeedOptions {
  shop: string;
  active?: boolean;
  /** null = reminders OFF, which is the production default (D5-02). */
  remindersEnabledAt?: Date | null;
  dueAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  hasPaymentTerms?: boolean;
  attributionStatus?: string;
  withCompany?: boolean;
}

/**
 * One shop, one company, one unpaid NET order with one overdue schedule — the
 * smallest situation the dunning sweep exists for.
 */
async function seed(options: SeedOptions) {
  const {
    shop,
    active = true,
    remindersEnabledAt = ENABLED_LONG_AGO,
    dueAt = LONG_PAST_DUE,
    completedAt = null,
    cancelledAt = null,
    hasPaymentTerms = true,
    attributionStatus = "ATTRIBUTED",
    withCompany = true,
  } = options;

  await prisma.shop.create({ data: { domain: shop, active, remindersEnabledAt } });

  const company = withCompany
    ? await prisma.company.create({
        data: {
          shop,
          companyGid: `gid://shopify/Company/${shop}`,
          name: "Northwind Traders",
        },
      })
    : null;

  const order = await prisma.ledgerOrder.create({
    data: {
      shop,
      orderGid: `gid://shopify/Order/${shop}`,
      name: "#1042",
      companyId: company?.id ?? null,
      attributionStatus,
      hasPaymentTerms,
      paymentTermsType: "NET",
      financialStatus: "PENDING",
      cancelledAt,
      outstandingShop: "500.0000",
      currencyCode: "USD",
      sourceUpdatedAt: LONG_PAST_DUE,
      refetchedAt: LONG_PAST_DUE,
    },
  });

  await prisma.ledgerSchedule.create({
    data: {
      shop,
      scheduleGid: scheduleGidOf(shop),
      orderId: order.id,
      dueAt,
      completedAt,
    },
  });
}

/** Shopify's happy answer: sent, nothing to report. */
function sendSuccess() {
  return { data: { paymentReminderSend: { success: true, userErrors: [] } } };
}

/**
 * The trap shape (03-01 / 04-05): HTTP 200, no `errors[]`, an EMPTY
 * `userErrors[]` — and no send.
 */
function sendUnsuccessfulSilently() {
  return { data: { paymentReminderSend: { success: false, userErrors: [] } } };
}

function sendWithUserErrors() {
  return {
    data: {
      paymentReminderSend: {
        success: false,
        userErrors: [
          {
            field: ["paymentScheduleId"],
            message: "Payment reminder could not be sent",
          },
        ],
      },
    },
  };
}

/**
 * 05-02 E3, MEASURED VERBATIM against a completed schedule on the dev store:
 * HTTP 200, no top-level errors, `success: null` — not `false` — and one
 * userError. Called twice, identical, with no state change.
 *
 * This is the shape that proves branching on `success` alone is a bug: `null`
 * is neither `true` nor a usable retry signal, and the ONLY thing that says
 * what happened is the message.
 */
function sendAlreadyCompleted() {
  return {
    data: {
      paymentReminderSend: {
        success: null,
        userErrors: [
          {
            code: "PAYMENT_REMINDER_SEND_UNSUCCESSFUL",
            field: null,
            message: "Payment schedule is already completed",
          },
        ],
      },
    },
  };
}

/**
 * 05-02 N1, MEASURED VERBATIM: the platform's per-ORDER 24h limit, proven to
 * be per order and not per company (#1007 was refused while the same company's
 * #1002 sent freely a minute later). Same code, same `success: null`.
 */
function sendRateLimited() {
  return {
    data: {
      paymentReminderSend: {
        success: null,
        userErrors: [
          {
            code: "PAYMENT_REMINDER_SEND_UNSUCCESSFUL",
            field: null,
            message:
              "You cannot send more than 1 payment reminders for the same order in a 24hour period",
          },
        ],
      },
    },
  };
}

/** The live pre-send refetch: this schedule is still open. */
function refetchOpen(variables: Record<string, unknown>) {
  const ids = (variables.ids as string[] | undefined) ?? [];
  return {
    data: {
      nodes: ids.map((id) => ({
        id,
        dueAt: LONG_PAST_DUE.toISOString(),
        completedAt: null,
      })),
    },
  };
}

/** The refetch that closes the just-paid race: settled since the sweep query. */
function refetchPaid(variables: Record<string, unknown>) {
  const ids = (variables.ids as string[] | undefined) ?? [];
  return {
    data: {
      nodes: ids.map((id) => ({
        id,
        dueAt: LONG_PAST_DUE.toISOString(),
        completedAt: "2026-08-31T23:00:00.000Z",
      })),
    },
  };
}

/** A shop row plus its company — for cases that seed their own orders. */
async function seedShop(
  shop: string,
  remindersEnabledAt: Date | null = ENABLED_LONG_AGO,
) {
  await prisma.shop.create({
    data: { domain: shop, active: true, remindersEnabledAt },
  });
  await prisma.company.create({
    data: {
      shop,
      companyGid: `gid://shopify/Company/${shop}`,
      name: "Northwind Traders",
    },
  });
}

/**
 * One ATTRIBUTED order carrying any number of schedules. The multi-schedule
 * case is the whole point: 05-02 proved Shopify's limit is per ORDER, so an
 * order with two open schedules is the situation that would earn a refusal.
 */
async function seedOrder(
  shop: string,
  key: string,
  schedules: { gid: string; dueAt: Date; completedAt?: Date | null }[],
): Promise<string> {
  const company = await prisma.company.findFirst({ where: { shop } });
  const orderGid = `gid://shopify/Order/${key}`;

  const order = await prisma.ledgerOrder.create({
    data: {
      shop,
      orderGid,
      name: `#${key}`,
      companyId: company?.id ?? null,
      attributionStatus: "ATTRIBUTED",
      hasPaymentTerms: true,
      paymentTermsType: "NET",
      financialStatus: "PENDING",
      outstandingShop: "500.0000",
      currencyCode: "USD",
      sourceUpdatedAt: LONG_PAST_DUE,
      refetchedAt: LONG_PAST_DUE,
    },
  });

  for (const schedule of schedules) {
    await prisma.ledgerSchedule.create({
      data: {
        shop,
        scheduleGid: schedule.gid,
        orderId: order.id,
        dueAt: schedule.dueAt,
        completedAt: schedule.completedAt ?? null,
      },
    });
  }

  return orderGid;
}


function logsFor(shop: string) {
  return prisma.reminderLog.findMany({ where: { shop }, orderBy: { createdAt: "asc" } });
}

/**
 * The row for ONE moment. Since 05-03 a single sweep writes up to three rows
 * per schedule — the send plus the suppressions it decided against — so a
 * positional `logs[0]` would assert against whichever row Postgres happened to
 * order first. Every status assertion below names its touchpoint.
 */
function logFor(shop: string, touchpoint: Touchpoint) {
  return prisma.reminderLog.findFirst({ where: { shop, touchpoint } });
}

/** Status per touchpoint, for asserting the whole shape of one sweep at once. */
async function statusesFor(shop: string): Promise<Record<string, string>> {
  const logs = await logsFor(shop);
  return Object.fromEntries(logs.map((log) => [log.touchpoint, log.status]));
}

let admin: MockAdminClient;

beforeEach(async () => {
  await wipe();
  admin = createMockAdmin({
    [SEND]: () => sendSuccess(),
    // Default: the schedule is still open when re-read just before the send.
    [REFETCH]: (variables: Record<string, unknown>) => refetchOpen(variables),
  });
  getAdminContext.mockReset();
  getAdminContext.mockResolvedValue(admin);
});

/**
 * Suites share one Postgres database and run serially, and `forEachActiveShop`
 * enumerates whatever active shops it finds. A file that seeds shops and leaves
 * them behind therefore silently inflates the call counts of every file that
 * runs after it. Wiping on the way out keeps this suite's blast radius inside
 * this suite.
 */
afterAll(async () => {
  await wipe();
});

/* ------------------------------------------------------------------ *
 * The tracer: one schedule, all the way through.
 * ------------------------------------------------------------------ */

describe("reminderSweep — the end-to-end tracer (REMD-01)", () => {
  it("sends the most severe moment once, and records the ones it passed over", async () => {
    // This schedule went past all three of its instants while the merchant was
    // opted in. It owes the buyer ONE message — the current truth, OVERDUE —
    // and a written record of the two moments deliberately not acted on.
    await seed({ shop: SHOP });

    await reminderSweep(NOW);

    // The send: exactly one, carrying the schedule GID and nothing else.
    expect(admin.callCount(SEND)).toBe(1);
    expect(admin.callsFor(SEND)[0].variables).toEqual({ id: scheduleGidOf(SHOP) });

    expect(await statusesFor(SHOP)).toEqual({
      [TOUCHPOINT.DUE_SOON]: REMINDER_STATUS.SUPPRESSED_STALE,
      [TOUCHPOINT.DUE]: REMINDER_STATUS.SUPPRESSED_STALE,
      [TOUCHPOINT.OVERDUE]: REMINDER_STATUS.SENT,
    });

    const sent = await logFor(SHOP, TOUCHPOINT.OVERDUE);
    expect(sent?.scheduleGid).toBe(scheduleGidOf(SHOP));
    expect(sent?.orderGid).toBe(`gid://shopify/Order/${SHOP}`);
    expect(sent?.companyGid).toBe(`gid://shopify/Company/${SHOP}`);
    expect(sent?.companyName).toBe("Northwind Traders");
    expect(sent?.status).toBe(REMINDER_STATUS.SENT);
    expect(sent?.sentAt).toEqual(NOW);
    expect(sent?.attempts).toBe(1);

    // A suppression is a decision, not a send: it never stamps sentAt.
    const stale = await logFor(SHOP, TOUCHPOINT.DUE);
    expect(stale?.sentAt).toBeNull();
    expect(stale?.attempts).toBe(0);
  });

  it("sends nothing a second time — the claim IS the idempotence (P2002)", async () => {
    await seed({ shop: SHOP });

    await reminderSweep(NOW);
    await reminderSweep(new Date(NOW.getTime() + 60 * 60 * 1000));

    // The second tick re-derives the same eligible schedule and finds every
    // moment already decided. A customer chased twice for one invoice is the
    // failure this whole design exists to prevent.
    expect(admin.callCount(SEND)).toBe(1);
    expect(await logsFor(SHOP)).toHaveLength(3);
  });

  it("waits until the first touchpoint instant is STRICTLY past (D-04 discipline)", async () => {
    // DUE_SOON (`dueAt - 72h`) is the EARLIEST moment, so it is the boundary at
    // which the sweep goes from silent to acting — and the one place where
    // strictness is observable end-to-end with no other touchpoint in play.
    // The same boundary at DUE and OVERDUE is pinned in the pure core specs.
    await seed({ shop: SHOP, dueAt: new Date(NOW.getTime() + DUE_SOON_LEAD_MS) });

    await reminderSweep(NOW);

    // Threshold lands exactly on the sweep instant: not yet chased, and — just
    // as important — not even recorded. Equality is never past.
    expect(admin.callCount(SEND)).toBe(0);
    expect(await logsFor(SHOP)).toHaveLength(0);

    // One millisecond later the moment has arrived, and the next tick acts.
    await reminderSweep(new Date(NOW.getTime() + 1));

    expect(admin.callCount(SEND)).toBe(1);
    expect(await statusesFor(SHOP)).toEqual({
      [TOUCHPOINT.DUE_SOON]: REMINDER_STATUS.SENT,
    });
  });

  it.each([
    ["already paid", { completedAt: new Date("2026-08-25T00:00:00.000Z") }],
    ["cancelled order", { cancelledAt: new Date("2026-08-25T00:00:00.000Z") }],
    ["no payment terms", { hasPaymentTerms: false }],
    ["attribution unresolved", { attributionStatus: "UNRESOLVED" }],
    ["no company attached", { withCompany: false, attributionStatus: "NO_COMPANY" }],
    ["no due date", { dueAt: null }],
  ])("never chases a schedule that is %s", async (_label, overrides) => {
    await seed({ shop: SHOP, ...(overrides as Partial<SeedOptions>) });

    await reminderSweep(NOW);

    expect(admin.callCount(SEND)).toBe(0);
    expect(await logsFor(SHOP)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * D5-02: off by default, and the watermark.
 * ------------------------------------------------------------------ */

describe("the enable gate — inert by construction (D5-02)", () => {
  it("does nothing at all for a shop whose remindersEnabledAt is null", async () => {
    // The production posture of EVERY shop the Wave-1 release touches: there is
    // no code path that can set this column yet, so the deployed sweep reads
    // one row per shop and stops.
    await seed({ shop: OFF_SHOP, remindersEnabledAt: null });

    await reminderSweep(NOW);

    expect(admin.callCount()).toBe(0);
    expect(await logsFor(OFF_SHOP)).toHaveLength(0);
  });

  it("suppresses a threshold crossed BEFORE the merchant opted in (Pitfall 1)", async () => {
    // The install blast: a store enabling reminders today must not email every
    // customer whose invoice went overdue during the months of backfilled
    // history.
    await seed({
      shop: SHOP,
      dueAt: LONG_PAST_DUE,
      remindersEnabledAt: new Date("2026-08-31T00:00:00.000Z"),
    });

    await reminderSweep(NOW);

    expect(admin.callCount(SEND)).toBe(0);

    // EVERY moment on this schedule predates the opt-in, so every one of them
    // is recorded as pre-existing and none of them sends.
    expect(await statusesFor(SHOP)).toEqual({
      [TOUCHPOINT.DUE_SOON]: REMINDER_STATUS.SUPPRESSED_PREEXISTING,
      [TOUCHPOINT.DUE]: REMINDER_STATUS.SUPPRESSED_PREEXISTING,
      [TOUCHPOINT.OVERDUE]: REMINDER_STATUS.SUPPRESSED_PREEXISTING,
    });
    for (const log of await logsFor(SHOP)) expect(log.sentAt).toBeNull();
  });

  it("keeps the suppression claimed so a later tick cannot resurrect it", async () => {
    await seed({
      shop: SHOP,
      dueAt: LONG_PAST_DUE,
      remindersEnabledAt: new Date("2026-08-31T00:00:00.000Z"),
    });

    await reminderSweep(NOW);
    await reminderSweep(new Date(NOW.getTime() + 24 * 60 * 60 * 1000));

    expect(admin.callCount(SEND)).toBe(0);
    const logs = await logsFor(SHOP);
    expect(logs).toHaveLength(3);
    for (const log of logs) {
      expect(log.status).toBe(REMINDER_STATUS.SUPPRESSED_PREEXISTING);
    }
  });

  it("skips an INACTIVE shop entirely (CF-3, inherited from forEachActiveShop)", async () => {
    // An uninstalled merchant inside the 48h retention window still has rows;
    // doing background work for them is unauthorized processing (T-05-03).
    await seed({ shop: INACTIVE_SHOP, active: false });

    await reminderSweep(NOW);

    expect(admin.callCount()).toBe(0);
    expect(await logsFor(INACTIVE_SHOP)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * The send seam and its failure taxonomy.
 * ------------------------------------------------------------------ */

describe("sendReminder — success is BOTH halves of the response", () => {
  it("is SENT only when success is true and userErrors is empty", async () => {
    admin.setFixture(SEND, () => sendSuccess());

    await expect(sendReminder(SHOP, scheduleGidOf(SHOP))).resolves.toMatchObject({
      status: REMINDER_STATUS.SENT,
    });
  });

  it("treats success:false with an EMPTY userErrors[] as FAILURE (the trap)", async () => {
    // The exact shape that burned metafieldsSet (03-01) and validationUpdate
    // (04-05): the failure lives inside `data`, and a caller that only looks at
    // `errors[]` reports a send that never happened.
    admin.setFixture(SEND, () => sendUnsuccessfulSilently());

    const outcome = await sendReminder(SHOP, scheduleGidOf(SHOP));

    expect(outcome.status).toBe(REMINDER_STATUS.FAILED);
    expect(outcome.reason).toContain("success: false");
  });

  it("treats a null/absent success the same way", async () => {
    admin.setFixture(SEND, () => ({
      data: { paymentReminderSend: { userErrors: [] } },
    }));

    await expect(sendReminder(SHOP, scheduleGidOf(SHOP))).resolves.toMatchObject({
      status: REMINDER_STATUS.FAILED,
      failureReason: FAILURE_REASON.REFUSED,
    });
  });

  it("reports userErrors messages verbatim", async () => {
    admin.setFixture(SEND, () => sendWithUserErrors());

    const outcome = await sendReminder(SHOP, scheduleGidOf(SHOP));

    expect(outcome.status).toBe(REMINDER_STATUS.FAILED);
    expect(outcome.reason).toBe("Payment reminder could not be sent");
  });

  it("keeps a top-level errors[] response RETRIABLE — it is a parsed refusal", async () => {
    // The ACCESS_DENIED shape an unconsented write_orders produces. graphqlJson
    // still throws it (T-02-27) so it can never read as "no payload, never
    // mind" — but it is a COMPLETE answer meaning nothing was sent, so it must
    // stay retriable rather than burning the moment as unconfirmed.
    admin.setFixture(SEND, () => ({
      data: { paymentReminderSend: null },
      errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }],
    }));

    const outcome = await sendReminder(SHOP, scheduleGidOf(SHOP));

    expect(outcome.status).toBe(REMINDER_STATUS.FAILED);
    expect(outcome.failureReason).toBe(FAILURE_REASON.REFUSED);
    expect(outcome.reason).toMatch(/SendReminder failed/);
  });

  it("treats a lost answer as AMBIGUOUS — terminal, never retried (F-01)", async () => {
    admin.setFixture(SEND, () => {
      throw new Error("socket hang up");
    });

    const outcome = await sendReminder(SHOP, scheduleGidOf(SHOP));

    expect(outcome.status).toBe(REMINDER_STATUS.SENT_UNCONFIRMED);
    expect(outcome.failureReason).toBe(FAILURE_REASON.TRANSPORT);
  });
});

describe("the sweep records failures instead of pretending", () => {
  it("marks FAILED — never SENT — when Shopify silently refuses", async () => {
    await seed({ shop: SHOP });
    admin.setFixture(SEND, () => sendUnsuccessfulSilently());

    await reminderSweep(NOW);

    const attempted = await logFor(SHOP, TOUCHPOINT.OVERDUE);
    expect(attempted?.status).toBe(REMINDER_STATUS.FAILED);
    expect(attempted?.sentAt).toBeNull();
    expect(attempted?.attempts).toBe(1);
  });

  it("marks FAILED when userErrors are present", async () => {
    await seed({ shop: SHOP });
    admin.setFixture(SEND, () => sendWithUserErrors());

    await reminderSweep(NOW);

    const attempted = await logFor(SHOP, TOUCHPOINT.OVERDUE);
    expect(attempted?.status).toBe(REMINDER_STATUS.FAILED);
    expect(attempted?.sentAt).toBeNull();
  });

  it("never leaves a row stuck in SENDING when the transport throws", async () => {
    // The ACCESS_DENIED shape of an unconsented `write_orders`. 05-03 Task 2
    // sharpens which terminal status this lands in; what matters here is that
    // the claim is always resolved and the sweep survives to do the next shop.
    await seed({ shop: SHOP });
    admin.setFixture(SEND, () => ({
      errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }],
    }));

    await reminderSweep(NOW);

    const attempted = await logFor(SHOP, TOUCHPOINT.OVERDUE);
    expect(attempted?.status).not.toBe(REMINDER_STATUS.SENDING);
    expect(attempted?.sentAt).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Structural guards. The forbidden patterns live HERE, inside the test.
 * ------------------------------------------------------------------ */

describe("structural guards — no PII, no second enumerator, no interpolation", () => {
  const source = () => sourceWithoutComments("app/services/reminders.server.ts");

  it("is guarding real code, not a blanked string (stripper sanity)", () => {
    // Every `not.toContain` / `not.toMatch` below is vacuously true against
    // an empty string. Pin an anchor that only the real module satisfies.
    expect(source().length).toBeGreaterThan(200);
    expect(source()).toContain("export async function reminderSweep");
  });

  it("names no protected-customer-data field in any document (Pitfall 5)", () => {
    // Under D5-01 Shopify resolves the recipient. Any of these appearing here
    // would quietly turn the app into a PCD Level 2 applicant and falsify
    // PRIVACY.md's load-bearing "no customer personal data" claim.
    for (const forbidden of [
      "customer",
      "Customer",
      "companyContact",
      "CompanyContact",
      "email",
      "statusPageUrl",
      "phone",
      "billingAddress",
      "shippingAddress",
    ]) {
      expect(source()).not.toContain(forbidden);
    }
  });

  it("keeps the send mutation to the two fields the schema defines", () => {
    expect(SEND_REMINDER_MUTATION).toContain("paymentReminderSend(paymentScheduleId: $id)");
    expect(SEND_REMINDER_MUTATION).toContain("success");
    expect(SEND_REMINDER_MUTATION).toContain("userErrors { field message }");
    // Variables only — never a template literal carrying a GID (T-02-27).
    expect(SEND_REMINDER_MUTATION).not.toContain("${");
    expect(SCHEDULE_REFETCH_QUERY).not.toContain("${");
    expect(SCHEDULE_REFETCH_QUERY).toContain("... on PaymentSchedule");
  });

  it("enumerates shops ONLY through forEachActiveShop (CF-3)", () => {
    // A `findMany` on the Shop table here would be a second authorization
    // decision, and the one that gets it wrong looks exactly like this one.
    expect(source()).not.toMatch(
      /\.shop\.(findMany|findFirst|count|groupBy|aggregate)\s*\(/,
    );
    expect(source()).toContain("forEachActiveShop");
  });

  it("routes every Admin call through graphqlJson, never a raw admin context", () => {
    expect(source()).toContain("graphqlJson");
    expect(source()).not.toContain("getAdminContext");
  });

  it("pins the sweep's own lease name and offset cadence", () => {
    expect(REMINDER_SWEEP_LEASE).toBe("reminder-sweep");
    expect(REMINDER_SWEEP_CRON).toBe("30 * * * *");
    expect(OVERDUE_OFFSET_MS).toBe(72 * 60 * 60 * 1000);
  });
});

/* ------------------------------------------------------------------ *
 * 05-03 Task 1 — the pure touchpoint core. No I/O, no clock, no database.
 * ------------------------------------------------------------------ */

describe("the touchpoint calendar — deriveTouchpoints (D5-03/D5-04)", () => {
  const DUE_AT = new Date("2026-09-10T09:00:00.000Z");

  it("derives exactly three touchpoint instants at the locked offsets", () => {
    const derived = deriveTouchpoints(DUE_AT);

    expect(derived.map((entry) => entry.touchpoint)).toEqual([
      TOUCHPOINT.DUE_SOON,
      TOUCHPOINT.DUE,
      TOUCHPOINT.OVERDUE,
    ]);
    expect(derived[0].instant.getTime()).toBe(DUE_AT.getTime() - 259_200_000);
    expect(derived[1].instant.getTime()).toBe(DUE_AT.getTime());
    expect(derived[2].instant.getTime()).toBe(DUE_AT.getTime() + 259_200_000);
  });

  it("pins both offsets at exactly 3x24h — instant math, never a calendar (D5-04)", () => {
    // D5-04 forbids shop-timezone/DST arithmetic in v1: a touchpoint is a fixed
    // number of milliseconds from `dueAt`, so the same schedule fires at the
    // same instant regardless of where the merchant or the buyer sits.
    expect(DUE_SOON_LEAD_MS).toBe(3 * 24 * 60 * 60 * 1000);
    expect(DUE_SOON_LEAD_MS).toBe(259_200_000);
    expect(OVERDUE_OFFSET_MS).toBe(259_200_000);
  });

  it("derives no touchpoint at all for a schedule with no due date", () => {
    expect(deriveTouchpoints(null)).toEqual([]);
  });

  it("derives no touchpoint for a schedule that is already paid", () => {
    expect(
      deriveTouchpoints(DUE_AT, new Date("2026-09-01T00:00:00.000Z")),
    ).toEqual([]);
  });
});

describe("touchpoint selection — catch-up, watermark, and F-02 precedence", () => {
  /** Due date every case in this block is measured against. */
  const D = new Date("2026-09-10T09:00:00.000Z");
  /** Opted in long before any instant below — so nothing is pre-watermark. */
  const ENABLED_BEFORE_ALL = new Date("2026-01-01T00:00:00.000Z");

  const at = (offsetMs: number) => new Date(D.getTime() + offsetMs);

  function select(
    now: Date,
    enabledAt: Date | null = ENABLED_BEFORE_ALL,
    alreadyLogged: Touchpoint[] = [],
    dueAt: Date = D,
  ) {
    return selectEligible(deriveTouchpoints(dueAt), now, enabledAt, alreadyLogged);
  }

  const statusOf = (
    selection: ReturnType<typeof select>,
    touchpoint: Touchpoint,
  ) => selection.suppress.find((entry) => entry.touchpoint === touchpoint)?.status;

  it("treats an instant equal to now as NOT crossed, and 1ms later as crossed", () => {
    // The D-04 discipline, to the millisecond, at the earliest touchpoint: a
    // schedule reaching its threshold exactly at the sweep instant waits for
    // the next tick. Equality is never "past".
    const exactly = select(at(-DUE_SOON_LEAD_MS));
    expect(exactly.send).toBeNull();
    expect(exactly.suppress).toEqual([]);

    const oneMsLater = select(at(-DUE_SOON_LEAD_MS + 1));
    expect(oneMsLater.send?.touchpoint).toBe(TOUCHPOINT.DUE_SOON);
    expect(oneMsLater.suppress).toEqual([]);
  });

  it("holds the same strict boundary at DUE and at OVERDUE", () => {
    // DUE lands exactly on now: the most severe CROSSED touchpoint is still
    // DUE_SOON, so the buyer gets the pre-due nudge and not the due-date mail.
    expect(select(D).send?.touchpoint).toBe(TOUCHPOINT.DUE_SOON);
    expect(select(at(1)).send?.touchpoint).toBe(TOUCHPOINT.DUE);

    expect(select(at(OVERDUE_OFFSET_MS)).send?.touchpoint).toBe(TOUCHPOINT.DUE);
    expect(select(at(OVERDUE_OFFSET_MS + 1)).send?.touchpoint).toBe(
      TOUCHPOINT.OVERDUE,
    );
  });

  it("sends only the MOST SEVERE crossed touchpoint and stales the rest", () => {
    // The five-day-outage case (research Pattern 1). The container was down
    // while all three instants passed; coming back up it owes the customer ONE
    // email — the current truth — not a three-message backlog.
    const selection = select(at(OVERDUE_OFFSET_MS + 1));

    expect(selection.send?.touchpoint).toBe(TOUCHPOINT.OVERDUE);
    expect(selection.suppress.map((entry) => entry.touchpoint)).toEqual([
      TOUCHPOINT.DUE_SOON,
      TOUCHPOINT.DUE,
    ]);
    expect(statusOf(selection, TOUCHPOINT.DUE_SOON)).toBe(
      REMINDER_STATUS.SUPPRESSED_STALE,
    );
    expect(statusOf(selection, TOUCHPOINT.DUE)).toBe(
      REMINDER_STATUS.SUPPRESSED_STALE,
    );
  });

  it("suppresses every touchpoint crossed before the watermark, sending nothing", () => {
    // A mature store switching reminders on: every instant on this schedule is
    // history the merchant never asked us to act on. Zero sends is the whole
    // point of D5-02 — the install blast, disarmed.
    const selection = select(at(OVERDUE_OFFSET_MS + 1), at(OVERDUE_OFFSET_MS + 1));

    expect(selection.send).toBeNull();
    expect(selection.suppress).toHaveLength(3);
    for (const entry of selection.suppress) {
      expect(entry.status).toBe(REMINDER_STATUS.SUPPRESSED_PREEXISTING);
    }
  });

  it("classifies a both-pre-watermark-AND-outranked instant PREEXISTING, never STALE (F-02)", () => {
    // The precedence spec shared with 05-05 LP-2. Enable at T; a schedule due
    // T+24h; sweep at T+25h.
    //   DUE_SOON  = T-48h : crossed, PRE-watermark AND outranked by DUE
    //   DUE       = T+24h : crossed, post-watermark -> the one send
    //   OVERDUE   = T+96h : not crossed at all
    // The watermark check runs FIRST and WINS: DUE_SOON is PREEXISTING. STALE
    // is reserved for post-watermark crossed-but-outranked instants, so the two
    // statuses never blur into "some kind of suppression" in the Phase-6 feed.
    const T = new Date("2026-10-01T00:00:00.000Z");
    const HOUR = 60 * 60 * 1000;
    const selection = selectEligible(
      deriveTouchpoints(new Date(T.getTime() + 24 * HOUR)),
      new Date(T.getTime() + 25 * HOUR),
      T,
      [],
    );

    expect(selection.send?.touchpoint).toBe(TOUCHPOINT.DUE);
    expect(selection.suppress).toHaveLength(1);
    expect(selection.suppress[0].touchpoint).toBe(TOUCHPOINT.DUE_SOON);
    expect(selection.suppress[0].status).toBe(
      REMINDER_STATUS.SUPPRESSED_PREEXISTING,
    );
  });

  it("never revisits a touchpoint that already has a log row", () => {
    // Every instant crossed, all three already claimed by an earlier sweep:
    // there is nothing left to do and — crucially — nothing left to re-suppress.
    const selection = select(at(OVERDUE_OFFSET_MS + 1), ENABLED_BEFORE_ALL, [
      TOUCHPOINT.DUE_SOON,
      TOUCHPOINT.DUE,
      TOUCHPOINT.OVERDUE,
    ]);

    expect(selection.send).toBeNull();
    expect(selection.suppress).toEqual([]);
  });

  it("promotes the next touchpoint once the previous one is logged", () => {
    // DUE_SOON went out on an earlier sweep; time moves past dueAt. DUE is now
    // the most severe unlogged crossed touchpoint and is the one that sends.
    const selection = select(at(1), ENABLED_BEFORE_ALL, [TOUCHPOINT.DUE_SOON]);

    expect(selection.send?.touchpoint).toBe(TOUCHPOINT.DUE);
    expect(selection.suppress).toEqual([]);
  });

  it("selects nothing when the merchant has never enabled reminders", () => {
    // Defence in depth: the sweep gates on this before it ever queries, but a
    // pure function that would happily send for a null watermark is a loaded gun.
    const selection = select(at(OVERDUE_OFFSET_MS + 1), null);

    expect(selection.send).toBeNull();
    expect(selection.suppress).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 05-03 Task 2 — the response parser, on the shapes 05-02 actually measured.
 * ------------------------------------------------------------------ */

describe("classifySendResponse — branch on CONTENT, never on success alone", () => {
  const payloadOf = (response: ReturnType<typeof sendSuccess>) =>
    response.data.paymentReminderSend;

  it("pins the two refusal substrings the classifier keys on", () => {
    // If Shopify ever rewords either message, exactly one spec fails and it
    // says which sentence moved — rather than a rate-limit refusal silently
    // being reclassified as a hard failure and burning three attempts.
    expect(sendAlreadyCompleted().data.paymentReminderSend.userErrors[0].message)
      .toContain(ALREADY_COMPLETED_MESSAGE);
    expect(sendRateLimited().data.paymentReminderSend.userErrors[0].message)
      .toContain(RATE_LIMIT_MESSAGE);
  });

  it("classifies SENT only on success true with an empty userErrors", () => {
    expect(classifySendResponse(payloadOf(sendSuccess()))).toMatchObject({
      status: REMINDER_STATUS.SENT,
    });
  });

  it("classifies the measured completed-schedule refusal SUPPRESSED_PAID", () => {
    // E3: the just-paid race lost to Shopify's own check. Benign and terminal —
    // the customer paid, which is the outcome the whole feature wants.
    const outcome = classifySendResponse(
      payloadOf(sendAlreadyCompleted() as never),
    );

    expect(outcome.status).toBe(REMINDER_STATUS.SUPPRESSED_PAID);
    expect(outcome.consumesAttempt).toBe(false);
  });

  it("classifies the measured 24h refusal RATE_LIMITED without spending an attempt", () => {
    // N1. Somebody — a merchant's manual send, a Flow, Shopify's own native
    // reminder — already wrote to this ORDER today. That is not our failure and
    // must not count toward the three strikes that bury a touchpoint as DEAD.
    const outcome = classifySendResponse(payloadOf(sendRateLimited() as never));

    expect(outcome.status).toBe(REMINDER_STATUS.FAILED);
    expect(outcome.failureReason).toBe(FAILURE_REASON.RATE_LIMITED);
    expect(outcome.consumesAttempt).toBe(false);
  });

  it("classifies unknown wording REFUSED rather than guessing", () => {
    const outcome = classifySendResponse(payloadOf(sendWithUserErrors() as never));

    expect(outcome.status).toBe(REMINDER_STATUS.FAILED);
    expect(outcome.failureReason).toBe(FAILURE_REASON.REFUSED);
    expect(outcome.consumesAttempt).toBe(true);
  });

  it("never reads success:null with an EMPTY userErrors as SENT (the trap)", () => {
    // No error to read and no success to trust. Historically this is where a
    // caller invents a send that never happened — permanently consuming the
    // touchpoint's claim so the buyer is never chased at all.
    for (const success of [null, false, undefined]) {
      const outcome = classifySendResponse({ success, userErrors: [] } as never);
      expect(outcome.status).toBe(REMINDER_STATUS.FAILED);
      expect(outcome.failureReason).toBe(FAILURE_REASON.REFUSED);
    }
  });

  it("treats a missing payload as AMBIGUOUS, never as a clean failure", () => {
    // Nothing parseable came back, so nothing can be ruled out — including that
    // Shopify accepted and delivered. Terminal, never retried.
    const outcome = classifySendResponse(null);

    expect(outcome.status).toBe(REMINDER_STATUS.SENT_UNCONFIRMED);
    expect(outcome.failureReason).toBe(FAILURE_REASON.TRANSPORT);
  });
});

/* ------------------------------------------------------------------ *
 * Never after paying (REMD-01's stop clause).
 * ------------------------------------------------------------------ */

describe("the paid race — local skip, then a live re-read (research Pattern 3)", () => {
  it("never claims and never refetches a schedule already settled locally", async () => {
    // The cheap check first: a schedule the ledger already knows is paid costs
    // no network call at all.
    await seed({ shop: SHOP, completedAt: new Date("2026-08-25T00:00:00.000Z") });

    await reminderSweep(NOW);

    expect(admin.callCount()).toBe(0);
    expect(await logsFor(SHOP)).toHaveLength(0);
  });

  it("flips the claim to SUPPRESSED_PAID when the live re-read says settled", async () => {
    // Payment landed between the sweep's own query and this send. The refetch
    // is the last thing standing between a paying customer and a dunning email.
    await seed({ shop: SHOP });
    admin.setFixture(REFETCH, (variables: Record<string, unknown>) =>
      refetchPaid(variables),
    );

    await reminderSweep(NOW);

    expect(admin.callCount(REFETCH)).toBe(1);
    expect(admin.callCount(SEND)).toBe(0);

    const claimed = await logFor(SHOP, TOUCHPOINT.OVERDUE);
    expect(claimed?.status).toBe(REMINDER_STATUS.SUPPRESSED_PAID);
    expect(claimed?.sentAt).toBeNull();
  });

  it("refetches BEFORE it sends, every time", async () => {
    await seed({ shop: SHOP });

    await reminderSweep(NOW);

    expect(admin.calls.map((call) => call.operationName)).toEqual([REFETCH, SEND]);
  });

  it("classifies Shopify's own completed-schedule refusal SUPPRESSED_PAID", async () => {
    // The residual window after the refetch: payment landed during the mutation
    // itself. Shopify's check is the backstop, and its refusal is benign.
    await seed({ shop: SHOP });
    admin.setFixture(SEND, () => sendAlreadyCompleted());

    await reminderSweep(NOW);

    const claimed = await logFor(SHOP, TOUCHPOINT.OVERDUE);
    expect(claimed?.status).toBe(REMINDER_STATUS.SUPPRESSED_PAID);
    expect(claimed?.attempts).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * F-01: ambiguity is terminal, refusals are retriable.
 * ------------------------------------------------------------------ */

describe("the send-failure taxonomy — retrying an ambiguous send is forbidden (F-01)", () => {
  it("marks SENT_UNCONFIRMED and never retries when the send transport dies", async () => {
    // The mutation was ISSUED and the answer never arrived. Shopify may have
    // accepted and delivered it. Re-sending would dun a real buyer twice for
    // one invoice, so this row is terminal by design: at-most-once means the
    // ambiguous case resolves toward silence.
    await seed({ shop: SHOP });
    // Counted here rather than via admin.callCount: the mock records a call
    // only AFTER its fixture resolves, so a throwing fixture is invisible to it.
    let attempts = 0;
    admin.setFixture(SEND, () => {
      attempts += 1;
      throw new Error("socket hang up");
    });

    await reminderSweep(NOW);

    expect(attempts).toBe(1);
    const row = await logFor(SHOP, TOUCHPOINT.OVERDUE);
    expect(row?.status).toBe(REMINDER_STATUS.SENT_UNCONFIRMED);
    expect(row?.failureReason).toBe(FAILURE_REASON.TRANSPORT);

    // Even far past every backoff window, it is never re-claimed. The fixture
    // now SUCCEEDS, so any retry would be recorded — and none is.
    admin.setFixture(SEND, () => sendSuccess());
    await reminderSweep(new Date(NOW.getTime() + 30 * 24 * HOUR));

    expect(admin.callCount(SEND)).toBe(0);
    expect((await logFor(SHOP, TOUCHPOINT.OVERDUE))?.status).toBe(
      REMINDER_STATUS.SENT_UNCONFIRMED,
    );
  });

  it("keeps a PARSED top-level GraphQL refusal retriable — nothing was sent", async () => {
    // ACCESS_DENIED during the post-release re-consent window: a complete,
    // parsed answer that definitively means no email left Shopify. Burning the
    // touchpoint here would silently drop every reminder for that shop.
    await seed({ shop: SHOP });
    admin.setFixture(SEND, () => ({
      errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }],
    }));

    await reminderSweep(NOW);

    const row = await logFor(SHOP, TOUCHPOINT.OVERDUE);
    expect(row?.status).toBe(REMINDER_STATUS.FAILED);
    expect(row?.failureReason).toBe(FAILURE_REASON.REFUSED);
    expect(row?.attempts).toBe(1);
  });

  it("marks a REFETCH transport failure FAILED — nothing was sent yet", async () => {
    await seed({ shop: SHOP });
    admin.setFixture(REFETCH, () => {
      throw new Error("socket hang up");
    });

    await reminderSweep(NOW);

    expect(admin.callCount(SEND)).toBe(0);
    const row = await logFor(SHOP, TOUCHPOINT.OVERDUE);
    expect(row?.status).toBe(REMINDER_STATUS.FAILED);
    expect(row?.failureReason).toBe(FAILURE_REASON.REFETCH);
    expect(row?.attempts).toBe(1);
  });

  /**
   * WINDOWS #21 / 05-VERIFICATION W2 — which 200-with-errors answers are safe
   * to retry.
   *
   * `graphqlJson` throws `LedgerGraphqlError` on ANY non-empty top-level
   * `errors[]`, so the class alone says nothing about whether Shopify ran the
   * mutation. Only the CODE does. These specs draw the line: a code that proves
   * the document was rejected before execution is retriable; everything else is
   * ambiguous and therefore terminal.
   */
  it.each([
    "ACCESS_DENIED",
    "THROTTLED",
    "MAX_COST_EXCEEDED",
    "undefinedField",
    "argumentNotAccepted",
    "missingRequiredArguments",
    "argumentLiteralsIncompatible",
    "variableNotDefined",
    "variableMismatch",
  ])(
    "treats extensions.code %s as definitely-not-sent — FAILED and retriable",
    async (code) => {
      await seed({ shop: SHOP });
      admin.setFixture(SEND, () => ({
        errors: [{ message: "refused", extensions: { code } }],
      }));

      await reminderSweep(NOW);

      const row = await logFor(SHOP, TOUCHPOINT.OVERDUE);
      expect(row?.status).toBe(REMINDER_STATUS.FAILED);
      expect(row?.failureReason).toBe(FAILURE_REASON.REFUSED);
      expect(row?.attempts).toBe(1);
    },
  );

  it.each([
    [
      "INTERNAL_SERVER_ERROR",
      [{ message: "Internal error", extensions: { code: "INTERNAL_SERVER_ERROR" } }],
    ],
    ["an errors[] entry with no extensions at all", [{ message: "boom" }]],
    [
      "a code nobody has documented",
      [{ message: "boom", extensions: { code: "SOMETHING_NEW" } }],
    ],
    [
      "a mixed batch where only ONE code is unknown",
      [
        { message: "Access denied", extensions: { code: "ACCESS_DENIED" } },
        { message: "Internal error", extensions: { code: "INTERNAL_SERVER_ERROR" } },
      ],
    ],
  ])(
    "lands SENT_UNCONFIRMED on %s — a 200-with-errors may already have mailed the buyer",
    async (_label, errors) => {
      // EVERY code must be retriable, not any: one ambiguous entry in the
      // array is enough to make the whole answer untrustworthy.
      await seed({ shop: SHOP });
      admin.setFixture(SEND, () => ({ errors }));

      await reminderSweep(NOW);

      const row = await logFor(SHOP, TOUCHPOINT.OVERDUE);
      expect(row?.status).toBe(REMINDER_STATUS.SENT_UNCONFIRMED);
      expect(row?.failureReason).toBe(FAILURE_REASON.TRANSPORT);
      // sentAt is stamped so the per-order guard holds the slot exactly as it
      // would for a real send.
      expect(row?.sentAt).toEqual(NOW);
    },
  );

  it("never sends again after an ambiguous 200-with-errors, however long it waits", async () => {
    await seed({ shop: SHOP });
    admin.setFixture(SEND, () => ({
      errors: [
        { message: "Internal error", extensions: { code: "INTERNAL_SERVER_ERROR" } },
      ],
    }));

    await reminderSweep(NOW);
    expect((await logFor(SHOP, TOUCHPOINT.OVERDUE))?.status).toBe(
      REMINDER_STATUS.SENT_UNCONFIRMED,
    );

    // The fixture now SUCCEEDS, so any retry would be recorded — and none is.
    admin.setFixture(SEND, () => sendSuccess());
    await reminderSweep(new Date(NOW.getTime() + 30 * 24 * HOUR));

    expect(admin.callCount(SEND)).toBe(1);
    expect((await logFor(SHOP, TOUCHPOINT.OVERDUE))?.status).toBe(
      REMINDER_STATUS.SENT_UNCONFIRMED,
    );
  });

  it("pins the retriable code set — widening it must be a deliberate change (T-06-07)", () => {
    // The exact list, in order. A future addition has to edit this spec, which
    // is the point: every entry is a claim that Shopify did NOT send, and a
    // wrong claim dunns a real buyer twice.
    expect([...RETRIABLE_GRAPHQL_CODES]).toEqual([
      "ACCESS_DENIED",
      "THROTTLED",
      "MAX_COST_EXCEEDED",
      "undefinedField",
      "argumentNotAccepted",
      "missingRequiredArguments",
      "argumentLiteralsIncompatible",
      "variableNotDefined",
      "variableMismatch",
    ]);

    // The one code this whole fix exists to exclude.
    expect([...RETRIABLE_GRAPHQL_CODES] as string[]).not.toContain(
      "INTERNAL_SERVER_ERROR",
    );
  });

  it("leaves an orphaned SENDING row alone forever (the crash drop)", async () => {
    // A container died between the claim and the mark. We cannot know whether
    // the send happened, so the row stays exactly where it is. One reminder is
    // dropped; none is duplicated. That is the correct direction to fail.
    await seed({ shop: SHOP });
    // Exactly the rows a crash leaves behind: the sweep writes the outranked
    // moments as suppressed FIRST, then claims the one it means to send, then
    // dies. The reverse order is unreachable, so seeding only the SENDING row
    // would be testing a state production cannot produce.
    const crashed = new Date(NOW.getTime() - 30 * 24 * HOUR);
    for (const [touchpoint, status] of [
      [TOUCHPOINT.DUE_SOON, REMINDER_STATUS.SUPPRESSED_STALE],
      [TOUCHPOINT.DUE, REMINDER_STATUS.SUPPRESSED_STALE],
      [TOUCHPOINT.OVERDUE, REMINDER_STATUS.SENDING],
    ] as const) {
      await prisma.reminderLog.create({
        data: {
          shop: SHOP,
          scheduleGid: scheduleGidOf(SHOP),
          orderGid: `gid://shopify/Order/${SHOP}`,
          touchpoint,
          status,
          updatedAt: crashed,
        },
      });
    }

    await reminderSweep(NOW);

    expect(admin.callCount(SEND)).toBe(0);
    expect((await logFor(SHOP, TOUCHPOINT.OVERDUE))?.status).toBe(
      REMINDER_STATUS.SENDING,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Bounded retries, and the backoff that respects the platform's window.
 * ------------------------------------------------------------------ */

describe("retry bounds and the >=25h backoff", () => {
  /** Drive one failing sweep and hand back the resulting FAILED row. */
  async function failOnce(fixture: () => unknown) {
    await seed({ shop: SHOP });
    admin.setFixture(SEND, fixture);
    await reminderSweep(NOW);
    return logFor(SHOP, TOUCHPOINT.OVERDUE);
  }

  it("does NOT re-claim a FAILED row inside Shopify's 24h window", async () => {
    // A minutes-scale retry is guaranteed to be refused by the platform (N1),
    // so it would burn attempts on a certainty rather than a chance.
    const failed = await failOnce(() => sendWithUserErrors());
    expect(failed?.status).toBe(REMINDER_STATUS.FAILED);

    await reminderSweep(new Date(NOW.getTime() + 2 * HOUR));

    expect(admin.callCount(SEND)).toBe(1);
    expect((await logFor(SHOP, TOUCHPOINT.OVERDUE))?.attempts).toBe(1);
  });

  it("re-claims a FAILED row once the window has cleared", async () => {
    await failOnce(() => sendWithUserErrors());

    admin.setFixture(SEND, () => sendSuccess());
    await reminderSweep(new Date(NOW.getTime() + GUARD_MS + 1));

    expect(admin.callCount(SEND)).toBe(2);
    const row = await logFor(SHOP, TOUCHPOINT.OVERDUE);
    expect(row?.status).toBe(REMINDER_STATUS.SENT);
  });

  it("buries a touchpoint DEAD on the third refusal", async () => {
    await failOnce(() => sendWithUserErrors());

    await reminderSweep(new Date(NOW.getTime() + GUARD_MS + 1));
    expect((await logFor(SHOP, TOUCHPOINT.OVERDUE))?.attempts).toBe(2);

    await reminderSweep(new Date(NOW.getTime() + 2 * GUARD_MS + 2));

    const row = await logFor(SHOP, TOUCHPOINT.OVERDUE);
    expect(row?.attempts).toBe(3);
    expect(row?.status).toBe(REMINDER_STATUS.DEAD);

    // DEAD is terminal: no later sweep resurrects it.
    await reminderSweep(new Date(NOW.getTime() + 30 * 24 * HOUR));
    expect(admin.callCount(SEND)).toBe(3);
  });

  it("never spends an attempt on a RATE_LIMITED refusal", async () => {
    // Three consecutive rate-limit refusals leave the row exactly as retriable
    // as it started: the platform's window is not our failure.
    await failOnce(() => sendRateLimited());

    await reminderSweep(new Date(NOW.getTime() + GUARD_MS + 1));
    await reminderSweep(new Date(NOW.getTime() + 2 * GUARD_MS + 2));

    expect(admin.callCount(SEND)).toBe(3);
    const row = await logFor(SHOP, TOUCHPOINT.OVERDUE);
    expect(row?.attempts).toBe(0);
    expect(row?.status).toBe(REMINDER_STATUS.FAILED);
    expect(row?.failureReason).toBe(FAILURE_REASON.RATE_LIMITED);
  });

  it.each([
    ["SENT", REMINDER_STATUS.SENT],
    ["DEAD", REMINDER_STATUS.DEAD],
    ["SUPPRESSED_PAID", REMINDER_STATUS.SUPPRESSED_PAID],
    ["SUPPRESSED_STALE", REMINDER_STATUS.SUPPRESSED_STALE],
    ["SUPPRESSED_PREEXISTING", REMINDER_STATUS.SUPPRESSED_PREEXISTING],
  ])("never re-claims a terminal %s row", async (_label, status) => {
    await seed({ shop: SHOP });
    await prisma.reminderLog.create({
      data: {
        shop: SHOP,
        scheduleGid: scheduleGidOf(SHOP),
        orderGid: `gid://shopify/Order/${SHOP}`,
        touchpoint: TOUCHPOINT.OVERDUE,
        status,
        attempts: 1,
        updatedAt: new Date(NOW.getTime() - 30 * 24 * HOUR),
      },
    });

    await reminderSweep(NOW);

    expect((await logFor(SHOP, TOUCHPOINT.OVERDUE))?.status).toBe(status);
  });
});

/* ------------------------------------------------------------------ *
 * WINDOWS #20 / 05-VERIFICATION W1: the severity fence on a late retry.
 * ------------------------------------------------------------------ */

/**
 * A FAILED row waits out the 25h window and becomes retriable again — but the
 * schedule may have MOVED ON in the meantime. If a more severe moment on the
 * same schedule was sent while the lower one sat failed, re-claiming the lower
 * one mails the buyer "your payment is due in 3 days" AFTER they were already
 * told it is due today. That is not a duplicate of any single moment, so the
 * unique constraint never sees it; it is a message that contradicts one the
 * buyer already has, which is worse than saying nothing.
 *
 * Rule 4 of `selectEligible` ("most severe only") already governs FRESH
 * moments. These specs pin the same rule across the retry path, where the
 * severity comparison is against rows written by an EARLIER sweep.
 */
describe("the severity fence on a late retry (WINDOWS #20)", () => {
  /** Placed so DUE_SOON and DUE are past at NOW while OVERDUE is not yet. */
  const PRE_OVERDUE_DUE_AT = new Date(NOW.getTime() - HOUR);
  /** Older than every backoff window, so nothing here is held by a timer. */
  const LONG_AGO = new Date(NOW.getTime() - 30 * 24 * HOUR);

  /** One ReminderLog row in a state an earlier sweep could really have left. */
  async function seedRow(
    touchpoint: Touchpoint,
    status: string,
    extra: Record<string, unknown> = {},
  ) {
    await prisma.reminderLog.create({
      data: {
        shop: SHOP,
        scheduleGid: scheduleGidOf(SHOP),
        orderGid: `gid://shopify/Order/${SHOP}`,
        touchpoint,
        status,
        updatedAt: LONG_AGO,
        ...extra,
      },
    });
  }

  it.each([
    ["SENT", REMINDER_STATUS.SENT],
    ["SENT_UNCONFIRMED", REMINDER_STATUS.SENT_UNCONFIRMED],
  ])(
    "never retries a FAILED DUE_SOON once DUE is %s — the lower moment is outranked",
    async (_label, siblingStatus) => {
      // SENT_UNCONFIRMED counts exactly as SENT does here, for the same reason
      // the per-order guard counts it: the buyer may well hold that email.
      await seed({ shop: SHOP, dueAt: PRE_OVERDUE_DUE_AT });
      await seedRow(TOUCHPOINT.DUE_SOON, REMINDER_STATUS.FAILED, {
        attempts: 1,
        failureReason: FAILURE_REASON.REFUSED,
      });
      await seedRow(TOUCHPOINT.DUE, siblingStatus, {
        attempts: 1,
        sentAt: LONG_AGO,
      });

      await reminderSweep(NOW);

      expect(admin.callCount(SEND)).toBe(0);

      const outranked = await logFor(SHOP, TOUCHPOINT.DUE_SOON);
      expect(outranked?.status).toBe(REMINDER_STATUS.SUPPRESSED_STALE);
      // Suppression is a decision, not an attempt: the counter is untouched.
      expect(outranked?.attempts).toBe(1);
      expect(outranked?.sentAt).toBeNull();

      // And the sibling that outranked it is left exactly as it was.
      expect((await logFor(SHOP, TOUCHPOINT.DUE))?.status).toBe(siblingStatus);
    },
  );

  it("never retries a FAILED DUE once OVERDUE has been sent", async () => {
    // The same fence two rungs up the ladder — nothing about it is specific to
    // the DUE_SOON/DUE pair.
    await seed({ shop: SHOP });
    await seedRow(TOUCHPOINT.DUE_SOON, REMINDER_STATUS.SUPPRESSED_STALE);
    await seedRow(TOUCHPOINT.DUE, REMINDER_STATUS.FAILED, {
      attempts: 1,
      failureReason: FAILURE_REASON.REFUSED,
    });
    await seedRow(TOUCHPOINT.OVERDUE, REMINDER_STATUS.SENT, {
      attempts: 1,
      sentAt: LONG_AGO,
    });

    await reminderSweep(NOW);

    expect(admin.callCount(SEND)).toBe(0);
    expect((await logFor(SHOP, TOUCHPOINT.DUE))?.status).toBe(
      REMINDER_STATUS.SUPPRESSED_STALE,
    );
  });

  it("still retries a FAILED DUE_SOON when no higher moment was ever sent", async () => {
    // The control that keeps the fence honest: a SUPPRESSED_STALE sibling is
    // not a sent one, so the retry path is untouched.
    await seed({ shop: SHOP, dueAt: PRE_OVERDUE_DUE_AT });
    await seedRow(TOUCHPOINT.DUE_SOON, REMINDER_STATUS.FAILED, {
      attempts: 1,
      failureReason: FAILURE_REASON.REFUSED,
    });
    await seedRow(TOUCHPOINT.DUE, REMINDER_STATUS.SUPPRESSED_STALE);

    await reminderSweep(NOW);

    expect(admin.callCount(SEND)).toBe(1);
    expect((await logFor(SHOP, TOUCHPOINT.DUE_SOON))?.status).toBe(
      REMINDER_STATUS.SENT,
    );
  });

  it("still retries a FAILED OVERDUE when only a LOWER moment was sent — the fence is one-directional", async () => {
    // Severity, not recency, is the rule. A DUE that already went out must not
    // stop the OVERDUE escalation the merchant is actually paying for.
    await seed({ shop: SHOP });
    await seedRow(TOUCHPOINT.DUE_SOON, REMINDER_STATUS.SUPPRESSED_STALE);
    await seedRow(TOUCHPOINT.DUE, REMINDER_STATUS.SENT, {
      attempts: 1,
      sentAt: LONG_AGO,
    });
    await seedRow(TOUCHPOINT.OVERDUE, REMINDER_STATUS.FAILED, {
      attempts: 1,
      failureReason: FAILURE_REASON.REFUSED,
    });

    await reminderSweep(NOW);

    expect(admin.callCount(SEND)).toBe(1);
    expect((await logFor(SHOP, TOUCHPOINT.OVERDUE))?.status).toBe(
      REMINDER_STATUS.SENT,
    );
  });
});

/* ------------------------------------------------------------------ *
 * N1: the platform allows ONE reminder per ORDER per 24h.
 * ------------------------------------------------------------------ */

describe("the per-order 24h guard (N1, measured in 05-02)", () => {
  it("sends for only ONE schedule of a multi-schedule order per sweep", async () => {
    // The claim primitive is per SCHEDULE but the platform's limit is per
    // ORDER, so an instalment order with two open schedules would earn a
    // guaranteed refusal on the second. The guard stops it BEFORE the claim, so
    // the skipped schedule keeps a clean slate and is re-derived next sweep.
    await seedShop(SHOP);
    await seedOrder(SHOP, "instalments", [
      { gid: "gid://shopify/PaymentSchedule/inst-1", dueAt: LONG_PAST_DUE },
      { gid: "gid://shopify/PaymentSchedule/inst-2", dueAt: LONG_PAST_DUE },
    ]);

    await reminderSweep(NOW);

    expect(admin.callCount(SEND)).toBe(1);

    const claims = await prisma.reminderLog.findMany({
      where: { shop: SHOP, status: { in: [REMINDER_STATUS.SENT, REMINDER_STATUS.SENDING] } },
    });
    expect(claims).toHaveLength(1);
    // The second schedule was passed over WITHOUT a row of its own.
    const second = await prisma.reminderLog.findMany({
      where: { shop: SHOP, scheduleGid: "gid://shopify/PaymentSchedule/inst-2" },
    });
    expect(second.every((row) => row.status !== REMINDER_STATUS.SENT)).toBe(true);
  });

  it("skips an order that received a reminder 20h ago, and proceeds at 25h", async () => {
    await seedShop(SHOP);
    await seedOrder(SHOP, "instalments", [
      { gid: "gid://shopify/PaymentSchedule/inst-1", dueAt: LONG_PAST_DUE },
      { gid: "gid://shopify/PaymentSchedule/inst-2", dueAt: LONG_PAST_DUE },
    ]);

    await reminderSweep(NOW);
    expect(admin.callCount(SEND)).toBe(1);

    // 20h later the platform would still refuse the order's other schedule.
    await reminderSweep(new Date(NOW.getTime() + 20 * HOUR));
    expect(admin.callCount(SEND)).toBe(1);

    // Past the window, the second schedule finally gets its turn.
    await reminderSweep(new Date(NOW.getTime() + GUARD_MS + 1));
    expect(admin.callCount(SEND)).toBe(2);
  });

  it("keys the guard on the ORDER, not the company (05-02 proved per-order)", async () => {
    // One company, two orders. Chasing one must not silence the other — that
    // would under-dun every multi-order account the app exists to protect.
    await seedShop(SHOP);
    await seedOrder(SHOP, "order-a", [
      { gid: "gid://shopify/PaymentSchedule/a-1", dueAt: LONG_PAST_DUE },
    ]);
    await seedOrder(SHOP, "order-b", [
      { gid: "gid://shopify/PaymentSchedule/b-1", dueAt: LONG_PAST_DUE },
    ]);

    await reminderSweep(NOW);

    expect(admin.callCount(SEND)).toBe(2);
  });

  it("counts a SENT_UNCONFIRMED row as having chased the order", async () => {
    // We do not know whether that ambiguous send arrived, so we must assume it
    // did — otherwise the guard would let a second one through on the same day.
    await seedShop(SHOP);
    await seedOrder(SHOP, "instalments", [
      { gid: "gid://shopify/PaymentSchedule/inst-1", dueAt: LONG_PAST_DUE },
      { gid: "gid://shopify/PaymentSchedule/inst-2", dueAt: LONG_PAST_DUE },
    ]);
    let attempts = 0;
    admin.setFixture(SEND, () => {
      attempts += 1;
      throw new Error("socket hang up");
    });

    await reminderSweep(NOW);

    expect(attempts).toBe(1);
    expect(
      await prisma.reminderLog.count({
        where: { shop: SHOP, status: REMINDER_STATUS.SENT_UNCONFIRMED },
      }),
    ).toBe(1);

    // The order's slot is spent, so its OTHER schedule stays untouched.
    await reminderSweep(new Date(NOW.getTime() + 2 * HOUR));

    expect(attempts).toBe(1);
    expect(admin.callCount(SEND)).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * The circuit breaker, and who gets starved by it.
 * ------------------------------------------------------------------ */

describe("the per-sweep send cap — the flood breaker (Pitfall 1)", () => {
  it("sends the cap, defers the rest, and lets the deferred through next sweep", async () => {
    await seedShop(SHOP);
    // 60 orders, each one minute NEWER than the last, so "oldest first" is
    // observable rather than incidental.
    for (let index = 0; index < 60; index += 1) {
      await seedOrder(SHOP, `bulk-${index}`, [
        {
          gid: `gid://shopify/PaymentSchedule/bulk-${index}`,
          dueAt: new Date(LONG_PAST_DUE.getTime() + index * 60_000),
        },
      ]);
    }

    await reminderSweep(NOW);

    expect(admin.callCount(SEND)).toBe(SEND_CAP_PER_SWEEP);

    const deferred = await prisma.reminderLog.findMany({
      where: { shop: SHOP, status: REMINDER_STATUS.DEFERRED },
    });
    expect(deferred).toHaveLength(10);
    // The cap can never starve the oldest obligations: the ten held back are
    // the ten NEWEST due dates.
    for (const row of deferred) {
      const index = Number(row.scheduleGid.split("-").at(-1));
      expect(index).toBeGreaterThanOrEqual(50);
    }

    // Next sweep, past the per-order window, the deferred ones go out.
    await reminderSweep(new Date(NOW.getTime() + GUARD_MS + 1));

    expect(admin.callCount(SEND)).toBe(60);
    expect(
      await prisma.reminderLog.count({
        where: { shop: SHOP, status: REMINDER_STATUS.DEFERRED },
      }),
    ).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Concurrency: two containers, one moment.
 * ------------------------------------------------------------------ */

describe("claim races — the unique constraint IS the correctness (rule 2)", () => {
  it("sends exactly once when two passes race the same fresh touchpoint", async () => {
    // Railway's deploy-overlap window, or 05-05's on-demand sweep landing on a
    // cron tick. The lease is hygiene; this is the actual guarantee.
    await seed({ shop: SHOP });

    await Promise.all([reminderSweep(NOW), reminderSweep(NOW)]);

    expect(admin.callCount(SEND)).toBe(1);
    expect(
      await prisma.reminderLog.count({
        where: { shop: SHOP, touchpoint: TOUCHPOINT.OVERDUE },
      }),
    ).toBe(1);
  });

  it("sends exactly once when two passes race the same FAILED re-claim (F-03)", async () => {
    // The retry path needs its own atomicity: two sweeps both seeing a
    // retriable FAILED row must not both re-claim it. The conditional
    // updateMany makes exactly one of them win.
    await seed({ shop: SHOP });
    admin.setFixture(SEND, () => sendWithUserErrors());
    await reminderSweep(NOW);
    expect(admin.callCount(SEND)).toBe(1);

    admin.setFixture(SEND, () => sendSuccess());
    const later = new Date(NOW.getTime() + GUARD_MS + 1);
    await Promise.all([reminderSweep(later), reminderSweep(later)]);

    expect(admin.callCount(SEND)).toBe(2);
    const row = await logFor(SHOP, TOUCHPOINT.OVERDUE);
    expect(row?.status).toBe(REMINDER_STATUS.SENT);
  });
});

describe("cross-shop isolation (T-05-02)", () => {
  it("never lets one shop's pass touch another shop's schedules", async () => {
    await seed({ shop: SHOP });
    await seed({ shop: OTHER_SHOP });

    await reminderSweep(NOW);

    for (const shop of [SHOP, OTHER_SHOP]) {
      const logs = await logsFor(shop);
      expect(logs.length).toBeGreaterThan(0);
      for (const log of logs) {
        expect(log.scheduleGid).toBe(scheduleGidOf(shop));
        expect(log.shop).toBe(shop);
      }
    }
  });
});
