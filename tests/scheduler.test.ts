import { readFileSync } from "node:fs";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import { recomputeCompany } from "../app/services/ledger.server";
import {
  runAttributionHealSweep,
  runReconciliationSweep,
} from "../app/services/reconciliation.server";
import {
  REMINDER_SWEEP_CRON,
  REMINDER_SWEEP_LEASE,
  reminderSweep,
} from "../app/services/reminders.server";
import {
  ATTRIBUTION_HEAL_CRON,
  ATTRIBUTION_HEAL_LEASE,
  OVERDUE_SWEEP_CRON,
  OVERDUE_SWEEP_LEASE,
  RECONCILIATION_CRON,
  RECONCILIATION_LEASE,
  SWEEP_SCHEDULE,
  forEachActiveShop,
  handleSigterm,
  overdueSweep,
  runExclusive,
  scheduledTaskCount,
  schedulerEnabled,
  startScheduler,
  stopScheduler,
} from "../app/services/scheduler.server";
import { createMockAdmin, type MockAdminClient } from "./helpers/admin-client-mock";
import { sourceWithoutComments } from "./helpers/module-source";

/**
 * LEDG-05 / D-04 / D-05 / CF-3 — the hourly overdue sweep and its guard rails.
 *
 * Sentry is stubbed rather than loaded: these tests assert scheduler behaviour,
 * and the real SDK would try to talk to the network from a swallowed-error path.
 */
vi.mock("@sentry/react-router", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

/**
 * The sweep's publish backstop (03-04) reaches Shopify through the Phase 2
 * seam: `admin-client.server.ts` is the ONLY mocked transport module, so
 * `publishCompanyCreditState` runs its real hash-skip, Shop.active gate and
 * bookkeeping against real Postgres rows while every `metafieldsSet` lands on
 * a fake Admin API whose calls are countable per operation name. Counting
 * calls is the point: "did the backstop spend an API write?" is the property
 * under test, not "did a function get invoked".
 */
const getAdminContext = vi.hoisted(() => vi.fn());

vi.mock("../app/services/admin-client.server", () => ({ getAdminContext }));

const ACTIVE_SHOP = "sched-active.myshopify.com";
const INACTIVE_SHOP = "sched-inactive.myshopify.com";
const SHOPS = [ACTIVE_SHOP, INACTIVE_SHOP];

/** The instant every sweep in this file is evaluated at. */
const NOW = new Date("2026-09-01T12:00:00.000Z");
/** Strictly before NOW — a schedule here is late. */
const PAST_DUE = new Date("2026-08-31T00:00:00.000Z");
/** Strictly after NOW — not late. */
const FUTURE_DUE = new Date("2026-09-30T00:00:00.000Z");

async function wipe() {
  await prisma.ledgerSchedule.deleteMany({ where: { shop: { in: SHOPS } } });
  await prisma.ledgerOrder.deleteMany({ where: { shop: { in: SHOPS } } });
  await prisma.company.deleteMany({ where: { shop: { in: SHOPS } } });
  await prisma.shop.deleteMany({ where: { domain: { in: SHOPS } } });
}

interface SeedOptions {
  shop: string;
  active: boolean;
  companyGid?: string;
  dueAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  outstanding?: string;
  overdue?: boolean;
  attributionStatus?: string;
}

/**
 * One shop, one company, one unpaid NET-30 order with one schedule — the whole
 * situation the hourly sweep exists for, in the smallest form that can express
 * it. Company rows are created with `recomputedAt: null` so "was this company
 * visited at all?" is observable, not just "did the flag change?".
 */
async function seed(options: SeedOptions) {
  const {
    shop,
    active,
    companyGid = `gid://shopify/Company/${shop}`,
    dueAt = PAST_DUE,
    completedAt = null,
    cancelledAt = null,
    outstanding = "500.0000",
    overdue = false,
    // The row carries a companyId, so ATTRIBUTED is the only coherent status
    // (UNRESOLVED rows are unattributed by construction, L-01). It also means
    // a freshly seeded shop starts `data_complete: true`, which is what lets a
    // test flip the shop-scoped flag and observe the fan-out.
    attributionStatus = "ATTRIBUTED",
  } = options;

  await prisma.shop.create({ data: { domain: shop, active } });

  const company = await prisma.company.create({
    data: { shop, companyGid, name: "Acme Industrial Supply", overdue },
  });

  const order = await prisma.ledgerOrder.create({
    data: {
      shop,
      orderGid: `gid://shopify/Order/${shop}`,
      name: "#1042",
      companyId: company.id,
      attributionStatus,
      hasPaymentTerms: true,
      paymentTermsType: "NET",
      financialStatus: "PENDING",
      cancelledAt,
      outstandingShop: outstanding,
      currencyCode: "USD",
      sourceUpdatedAt: PAST_DUE,
      refetchedAt: PAST_DUE,
    },
  });

  await prisma.ledgerSchedule.create({
    data: {
      shop,
      scheduleGid: `gid://shopify/PaymentSchedule/${shop}`,
      orderId: order.id,
      dueAt,
      completedAt,
    },
  });

  return { companyGid };
}

function companyOn(shop: string) {
  return prisma.company.findFirstOrThrow({ where: { shop } });
}

let admin: MockAdminClient;

beforeEach(async () => {
  await wipe();
  admin = createMockAdmin();
  getAdminContext.mockReset();
  getAdminContext.mockResolvedValue(admin);
});

afterAll(async () => {
  await wipe();
  await prisma.sweepLease.deleteMany({
    where: { name: { startsWith: "test-lease" } },
  });
  await prisma.$disconnect();
});

describe("overdueSweep — time passing flips a company overdue (LEDG-05)", () => {
  it("flips a company with an open schedule strictly past dueAt", async () => {
    await seed({ shop: ACTIVE_SHOP, active: true });

    await overdueSweep(NOW);

    const company = await companyOn(ACTIVE_SHOP);
    expect(company.overdue).toBe(true);
    expect(company.earliestDueAt).toEqual(PAST_DUE);
    // Exposure is re-derived on the same pass — the sweep never writes the
    // overdue column on its own (scheduler rule 4).
    expect(company.exposure.toFixed(2)).toBe("500.00");
    expect(company.recomputedAt).not.toBeNull();
  });

  it("leaves a company whose schedule is still in the future alone", async () => {
    await seed({ shop: ACTIVE_SHOP, active: true, dueAt: FUTURE_DUE });

    await overdueSweep(NOW);

    const company = await companyOn(ACTIVE_SHOP);
    expect(company.overdue).toBe(false);
    expect(company.recomputedAt).toBeNull();
  });

  it("does NOT flip a schedule due at exactly the sweep instant (D-04 strict past)", async () => {
    // The adjacency edge the whole overdue semantic rests on: `dueAt == now` is
    // not yet late, and flips at the NEXT sweep. `recomputedAt` staying null
    // proves the indexed query did not even select it — the boundary lives in
    // the query, not only in computeCompanyState.
    await seed({ shop: ACTIVE_SHOP, active: true, dueAt: NOW });

    await overdueSweep(NOW);

    const atInstant = await companyOn(ACTIVE_SHOP);
    expect(atInstant.overdue).toBe(false);
    expect(atInstant.recomputedAt).toBeNull();

    // One millisecond later it is strictly past, and flips.
    await overdueSweep(new Date(NOW.getTime() + 1));

    const oneMsLater = await companyOn(ACTIVE_SHOP);
    expect(oneMsLater.overdue).toBe(true);
  });

  it("ignores a completed schedule and a cancelled order", async () => {
    await seed({ shop: ACTIVE_SHOP, active: true, completedAt: PAST_DUE });
    await seed({
      shop: INACTIVE_SHOP,
      active: true,
      cancelledAt: PAST_DUE,
    });

    await overdueSweep(NOW);

    expect((await companyOn(ACTIVE_SHOP)).overdue).toBe(false);
    expect((await companyOn(INACTIVE_SHOP)).overdue).toBe(false);
  });

  it("clears a stale overdue flag when nothing is past due any more", async () => {
    // A payment webhook normally clears this. If that delivery was missed the
    // company would stay blocked at checkout until the daily reconciliation —
    // a falsely-blocked paying customer, the worst failure mode in the project.
    await seed({
      shop: ACTIVE_SHOP,
      active: true,
      dueAt: PAST_DUE,
      completedAt: PAST_DUE,
      overdue: true,
    });

    await overdueSweep(NOW);

    const company = await companyOn(ACTIVE_SHOP);
    expect(company.overdue).toBe(false);
    expect(company.exposure.toFixed(2)).toBe("0.00");
  });

  it("is idempotent — running the sweep twice writes the same state", async () => {
    await seed({ shop: ACTIVE_SHOP, active: true });

    await overdueSweep(NOW);
    const first = await companyOn(ACTIVE_SHOP);
    await overdueSweep(NOW);
    const second = await companyOn(ACTIVE_SHOP);

    expect(second.overdue).toBe(first.overdue);
    expect(second.exposure.toString()).toBe(first.exposure.toString());
    expect(second.earliestDueAt).toEqual(first.earliestDueAt);
  });
});

describe("CF-3 — inactive shops are never swept", () => {
  it("sweeps the active shop and writes nothing for the inactive one", async () => {
    await seed({ shop: ACTIVE_SHOP, active: true });
    await seed({ shop: INACTIVE_SHOP, active: false });

    await overdueSweep(NOW);

    expect((await companyOn(ACTIVE_SHOP)).overdue).toBe(true);

    const untouched = await companyOn(INACTIVE_SHOP);
    expect(untouched.overdue).toBe(false);
    // Zero writes, not just an unchanged flag: an uninstalled merchant's rows
    // are retained through the 48h grace window (D-06) and must not be
    // processed at all.
    expect(untouched.recomputedAt).toBeNull();
    expect(untouched.exposure.toFixed(2)).toBe("0.00");
  });

  it("forEachActiveShop yields only active domains", async () => {
    await seed({ shop: ACTIVE_SHOP, active: true });
    await seed({ shop: INACTIVE_SHOP, active: false });

    const visited: string[] = [];
    await forEachActiveShop(async (shop) => {
      if (SHOPS.includes(shop)) visited.push(shop);
    });

    expect(visited).toEqual([ACTIVE_SHOP]);
  });

  it("steps over a shop whose sweep throws instead of abandoning the rest", async () => {
    await seed({ shop: ACTIVE_SHOP, active: true });
    await seed({ shop: INACTIVE_SHOP, active: true });

    const visited: string[] = [];
    await forEachActiveShop(async (shop) => {
      if (!SHOPS.includes(shop)) return;
      visited.push(shop);
      if (shop === ACTIVE_SHOP) throw new Error("boom");
    });

    // Ordered by domain: sched-active fails, sched-inactive still runs.
    expect(visited).toEqual([ACTIVE_SHOP, INACTIVE_SHOP]);
  });
});

/* ------------------------------------------------------------------ *
 * The publish backstop (CRED-03, L-02) — retry channel and fan-out.
 * ------------------------------------------------------------------ */

/** A second company on the same shop — fan-out needs more than one. */
async function seedSecondCompany(shop: string, companyGid: string) {
  return prisma.company.create({
    data: { shop, companyGid, name: "Beta Fabrication" },
  });
}

/**
 * The unattributed net-terms order that flips a SHOP's `data_complete` false
 * (L-01): companyId null by construction, so it could belong to any company —
 * which is exactly why the correction cannot be company-scoped.
 */
async function seedUnresolvedNetTermsOrder(shop: string) {
  return prisma.ledgerOrder.create({
    data: {
      shop,
      orderGid: `gid://shopify/Order/${shop}-unresolved`,
      name: "#2099",
      companyId: null,
      attributionStatus: "UNRESOLVED",
      hasPaymentTerms: true,
      paymentTermsType: "NET",
      financialStatus: "PENDING",
      outstandingShop: "125.0000",
      currencyCode: "USD",
      sourceUpdatedAt: PAST_DUE,
      refetchedAt: PAST_DUE,
    },
  });
}

const PUBLISH = "PublishCompanyCredit";

function payloadOf(call: { variables: Record<string, unknown> }) {
  const metafields = call.variables.metafields as { value: string }[];
  return JSON.parse(metafields[0].value) as Record<string, unknown>;
}

function ownerIdOf(variables: Record<string, unknown>): string {
  return (variables.metafields as { ownerId: string }[])[0].ownerId;
}

/** metafieldsSet answering 200 with the failure inside `data` (Pitfall 1). */
function userErrorsResponse() {
  return {
    data: {
      metafieldsSet: {
        metafields: [],
        userErrors: [
          {
            field: ["metafields", "0", "ownerId"],
            message: "Owner does not exist",
            code: "INVALID_VALUE",
            elementIndex: 0,
          },
        ],
      },
    },
  };
}

function successResponse() {
  return {
    data: {
      metafieldsSet: {
        metafields: [
          {
            id: "gid://shopify/Metafield/9",
            key: "credit_v1",
            namespace: "app--000000",
            updatedAt: NOW.toISOString(),
          },
        ],
        userErrors: [],
      },
    },
  };
}

/**
 * The steady state a healthy company sits in: recomputed, then published AT
 * that state — hash current and publishedAt >= recomputedAt, which is exactly
 * the condition the backstop must not spend an API write on.
 */
async function settle(shop: string, companyGid: string) {
  await recomputeCompany(shop, companyGid, NOW);
  admin.reset();
}

describe("publish backstop — the sweep IS the retry channel (CRED-03, L-02)", () => {
  it("republishes a company whose inline publish was swallowed (publishedAt < recomputedAt)", async () => {
    // Due in the future, so `companiesToReevaluate` selects nothing: the only
    // thing that can produce a call in this test is the backstop.
    const { companyGid } = await seed({
      shop: ACTIVE_SHOP,
      active: true,
      dueAt: FUTURE_DUE,
    });
    await settle(ACTIVE_SHOP, companyGid);

    // The 03-01 dirty marker: ledger state committed, publish lost (rule 8).
    const dirty = await companyOn(ACTIVE_SHOP);
    await prisma.company.update({
      where: { id: dirty.id },
      data: { publishedAt: new Date(dirty.recomputedAt!.getTime() - 60_000) },
    });

    await overdueSweep(NOW);

    expect(admin.callCount(PUBLISH)).toBe(1);

    // Healed: the marker is cleared, so the next sweep costs nothing again.
    const healed = await companyOn(ACTIVE_SHOP);
    expect(healed.publishedAt!.getTime()).toBeGreaterThanOrEqual(
      healed.recomputedAt!.getTime(),
    );
  });

  it("spends ZERO metafieldsSet calls on unchanged companies across repeated sweeps", async () => {
    const { companyGid } = await seed({
      shop: ACTIVE_SHOP,
      active: true,
      dueAt: FUTURE_DUE,
    });
    await settle(ACTIVE_SHOP, companyGid);

    await overdueSweep(NOW);
    await overdueSweep(NOW);

    // Hash-skip is what makes an hourly all-companies pass affordable at fleet
    // scale (T-03-11): an unchanged payload costs a DB read, never an API
    // write. Without this bound the backstop would be a self-inflicted DoS.
    expect(admin.callCount(PUBLISH)).toBe(0);
  });

  it("publishes a never-recomputed company (recomputedAt null) — fail toward freshness", async () => {
    await seed({ shop: ACTIVE_SHOP, active: true, dueAt: FUTURE_DUE });

    await overdueSweep(NOW);

    // No webhook and no recompute names this row, so without the backstop
    // enumerating it the company would stay invisible to Phase 4 forever.
    expect(admin.callCount(PUBLISH)).toBe(1);
    expect((await companyOn(ACTIVE_SHOP)).publishedAt).not.toBeNull();
  });

  it("fans a shop-scoped data_complete flip out to EVERY company of the shop (L-02)", async () => {
    const { companyGid } = await seed({
      shop: ACTIVE_SHOP,
      active: true,
      dueAt: FUTURE_DUE,
    });
    const second = await seedSecondCompany(ACTIVE_SHOP, `${companyGid}-b`);
    await recomputeCompany(ACTIVE_SHOP, companyGid, NOW);
    await recomputeCompany(ACTIVE_SHOP, second.companyGid, NOW);
    admin.reset();

    // One unattributed net-terms order flips the flag for the WHOLE shop. No
    // webhook names the other companies, so only a hash-driven pass over all
    // of them can correct their payloads.
    await seedUnresolvedNetTermsOrder(ACTIVE_SHOP);

    await overdueSweep(NOW);

    expect(admin.callCount(PUBLISH)).toBe(2);
    for (const call of admin.callsFor(PUBLISH)) {
      expect(payloadOf(call).data_complete).toBe(false);
    }

    // ...and the flip back is equally automatic, one cycle later.
    admin.reset();
    await prisma.ledgerOrder.updateMany({
      where: { shop: ACTIVE_SHOP, attributionStatus: "UNRESOLVED" },
      data: { attributionStatus: "NO_COMPANY" },
    });

    await overdueSweep(NOW);

    expect(admin.callCount(PUBLISH)).toBe(2);
    for (const call of admin.callsFor(PUBLISH)) {
      expect(payloadOf(call).data_complete).toBe(true);
    }

    // Third pass: nothing changed, so the fan-out is over — the burst is
    // bounded by the hash, not by the company count.
    admin.reset();
    await overdueSweep(NOW);
    expect(admin.callCount(PUBLISH)).toBe(0);
  });

  it("never publishes for an inactive shop — the backstop inherits CF-3 (T-03-16)", async () => {
    await seed({ shop: INACTIVE_SHOP, active: false, dueAt: FUTURE_DUE });

    await overdueSweep(NOW);

    // An uninstalled merchant's rows are retained through the 48h grace window
    // (D-06); writing their credit state to Shopify is unauthorized processing.
    expect(admin.callCount(PUBLISH)).toBe(0);
    expect((await companyOn(INACTIVE_SHOP)).publishedAt).toBeNull();
  });

  it("keeps going after one company's publish fails — the failure is isolated", async () => {
    const { companyGid } = await seed({
      shop: ACTIVE_SHOP,
      active: true,
      dueAt: FUTURE_DUE,
    });
    const second = await seedSecondCompany(ACTIVE_SHOP, `${companyGid}-b`);

    // First company (companyGid sorts before `${companyGid}-b`) fails.
    admin.setFixture(PUBLISH, (variables: Record<string, unknown>) =>
      ownerIdOf(variables) === companyGid
        ? userErrorsResponse()
        : successResponse(),
    );

    await overdueSweep(NOW);

    expect(admin.callCount(PUBLISH)).toBe(2);

    // The failed one advanced no bookkeeping — it stays dirty and is retried
    // next hour; the healthy one published regardless of its neighbour.
    // Both companies live on ACTIVE_SHOP, so each is addressed by its own gid
    // rather than by "some company on this shop".
    const failed = await prisma.company.findUniqueOrThrow({
      where: { shop_companyGid: { shop: ACTIVE_SHOP, companyGid } },
    });
    expect(failed.publishedAt).toBeNull();
    const healthy = await prisma.company.findUniqueOrThrow({
      where: { id: second.id },
    });
    expect(healthy.publishedAt).not.toBeNull();
  });

  it("still flips overdue when the publish half of the pass fails outright", async () => {
    // The overdue flip is the sweep's contract; publishing is additive. A
    // metafield outage must never cost a merchant the enforcement signal.
    await seed({ shop: ACTIVE_SHOP, active: true });
    admin.setFixture(PUBLISH, () => userErrorsResponse());

    await overdueSweep(NOW);

    const company = await companyOn(ACTIVE_SHOP);
    expect(company.overdue).toBe(true);
    expect(company.exposure.toFixed(2)).toBe("500.00");
    expect(company.publishedAt).toBeNull();
  });

  it("rides the existing OVERDUE_SWEEP lease — no new cron entry, no new lease", () => {
    // Locked decision 2: the backstop is sweep-driven. A second registration
    // would double the API burst and need its own lease row. (Phase 5's
    // reminder sweep took the third slot and 06-DEBUG's attribution heal the
    // fourth; the backstop still has none of its own — it is the SAME
    // overdueSweep entry it always was.)
    expect(SWEEP_SCHEDULE).toHaveLength(4);
    expect(
      SWEEP_SCHEDULE.filter((sweep) => sweep.run === overdueSweep),
    ).toHaveLength(1);
    expect(
      SWEEP_SCHEDULE.find((sweep) => sweep.run === overdueSweep)?.lease,
    ).toBe(OVERDUE_SWEEP_LEASE);
  });
});

describe("runExclusive — the deploy-overlap lease (Pitfall 6)", () => {
  const LEASE = "test-lease-exclusion";

  beforeEach(async () => {
    await prisma.sweepLease.deleteMany({ where: { name: LEASE } });
  });

  it("excludes a second claimant while the first holds it, and admits it after release", async () => {
    let bRuns = 0;
    let aClaimed = false;
    let releaseA: () => void = () => {};
    const aIsHolding = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    // Instance A takes the lease and keeps holding it.
    const aFinished = runExclusive(
      LEASE,
      async () => {
        aClaimed = true;
        await aIsHolding;
      },
      "instance-A",
    );

    while (!aClaimed) await new Promise((resolve) => setTimeout(resolve, 5));

    // Instance B — the other container during Railway's overlap window.
    const bRanWhileHeld = await runExclusive(
      LEASE,
      async () => {
        bRuns += 1;
      },
      "instance-B",
    );

    expect(bRanWhileHeld).toBe(false);
    expect(bRuns).toBe(0);

    releaseA();
    expect(await aFinished).toBe(true);

    const bRanAfterRelease = await runExclusive(
      LEASE,
      async () => {
        bRuns += 1;
      },
      "instance-B",
    );

    expect(bRanAfterRelease).toBe(true);
    expect(bRuns).toBe(1);
  });

  it("releases the lease even when the sweep throws", async () => {
    await expect(
      runExclusive(
        LEASE,
        async () => {
          throw new Error("sweep exploded");
        },
        "instance-A",
      ),
    ).rejects.toThrow("sweep exploded");

    // A crashed sweep must not wedge the lease until it expires.
    const claimedAfterCrash = await runExclusive(LEASE, async () => {}, "instance-B");
    expect(claimedAfterCrash).toBe(true);
  });

  it("creates the lease row on first use and reuses it afterwards", async () => {
    expect(await prisma.sweepLease.findUnique({ where: { name: LEASE } })).toBeNull();

    await runExclusive(LEASE, async () => {}, "instance-A");
    await runExclusive(LEASE, async () => {}, "instance-B");

    const row = await prisma.sweepLease.findUnique({ where: { name: LEASE } });
    expect(row).not.toBeNull();
    expect(row?.holder).toBe("instance-B");
    expect(await prisma.sweepLease.count({ where: { name: LEASE } })).toBe(1);
  });
});

describe("sweep registration", () => {
  it("registers the hourly overdue sweep and the daily reconciliation on distinct leases", () => {
    expect(SWEEP_SCHEDULE).toHaveLength(4);

    const overdue = SWEEP_SCHEDULE.find((s) => s.lease === OVERDUE_SWEEP_LEASE);
    const reconciliation = SWEEP_SCHEDULE.find(
      (s) => s.lease === RECONCILIATION_LEASE,
    );

    expect(overdue?.expression).toBe(OVERDUE_SWEEP_CRON);
    expect(overdue?.run).toBe(overdueSweep);
    expect(reconciliation?.expression).toBe(RECONCILIATION_CRON);
    expect(reconciliation?.run).toBe(runReconciliationSweep);

    // Two sweeps behind one lease would let a slow reconciliation suppress the
    // hourly flip entirely.
    expect(new Set(SWEEP_SCHEDULE.map((s) => s.lease)).size).toBe(4);
    // node-cron 4: skip a tick rather than pile runs up (Pitfall 8).
    expect(SWEEP_SCHEDULE.every((s) => s.noOverlap)).toBe(true);
  });

  it("registers the Phase-5 reminder sweep on its OWN lease, offset to minute 30", () => {
    // The module header reserved this slot for exactly one entry with its own
    // lease name (05-01). Asserted BY VALUE, not by a regex over source: a
    // reminder sweep sharing the overdue lease would let a slow ledger pass
    // silently suppress a merchant's dunning email for an hour, and a reminder
    // sweep on minute 0 would queue behind that pass every single tick.
    const reminder = SWEEP_SCHEDULE.find((s) => s.run === reminderSweep);

    expect(reminder).toBeDefined();
    expect(reminder?.lease).toBe(REMINDER_SWEEP_LEASE);
    expect(reminder?.lease).toBe("reminder-sweep");
    expect(reminder?.lease).not.toBe(OVERDUE_SWEEP_LEASE);
    expect(reminder?.lease).not.toBe(RECONCILIATION_LEASE);
    expect(reminder?.expression).toBe(REMINDER_SWEEP_CRON);
    expect(reminder?.expression).toBe("30 * * * *");
    expect(reminder?.expression).not.toBe(OVERDUE_SWEEP_CRON);
    // Deploy-overlap hygiene applies to the sweep that sends email most of all.
    expect(reminder?.noOverlap).toBe(true);
  });

  it("registers the 5-minute attribution heal on its OWN lease (06-DEBUG fix 2)", () => {
    // Asserted BY VALUE, like the reminder sweep above. The heal exists to put
    // a ≤5 min ceiling on the exposure-understatement window; sharing the
    // reconciliation lease would let one daily run — up to 30 minutes of lease
    // — suppress every fast tick underneath it, which is the whole defect
    // back again with a shorter cron string.
    const heal = SWEEP_SCHEDULE.find((s) => s.run === runAttributionHealSweep);

    expect(heal).toBeDefined();
    expect(heal?.lease).toBe(ATTRIBUTION_HEAL_LEASE);
    expect(heal?.lease).toBe("attribution-heal");
    expect(heal?.lease).not.toBe(RECONCILIATION_LEASE);
    expect(heal?.lease).not.toBe(OVERDUE_SWEEP_LEASE);
    expect(heal?.lease).not.toBe(REMINDER_SWEEP_LEASE);
    expect(heal?.expression).toBe(ATTRIBUTION_HEAL_CRON);
    expect(heal?.expression).toBe("*/5 * * * *");
    // A tick that overlaps its predecessor would double the company paging for
    // no gain — the previous run is already doing it.
    expect(heal?.noOverlap).toBe(true);
  });

  it("runs every registered sweep through the lease", () => {
    // The cron callback must be the lease wrapper, not the bare sweep — a sweep
    // registered directly would fire on both containers during a Railway
    // deploy overlap, which in Phase 5 means duplicate merchant-visible email.
    const source = sourceWithoutComments("app/services/scheduler.server.ts");
    // Stripper sanity: the file is real code, not a blanked string.
    expect(source.length).toBeGreaterThan(200);
    expect(source).toMatch(
      /scheduleCronTask\(\s*sweep\.expression,\s*\(\)\s*=>\s*runExclusive\(sweep\.lease,\s*sweep\.run\)/,
    );
    expect(source).toMatch(/noOverlap: sweep\.noOverlap/);
  });
});

/* ------------------------------------------------------------------ *
 * Structural guards. The forbidden patterns live HERE, inside the test,
 * so a doc comment in the service can never trip a plan's grep gate.
 * ------------------------------------------------------------------ */

/** Any Prisma read of the Shop table. */
const SHOP_TABLE_READ =
  /\.shop\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|groupBy|aggregate)\s*\(/g;

describe("CF-3 source guard — one shop enumerator, and it filters", () => {
  it("scheduler.server.ts reads the Shop table exactly once, inside forEachActiveShop", () => {
    const source = sourceWithoutComments("app/services/scheduler.server.ts");
    // Stripper sanity: `toHaveLength(1)` below would already catch a blanked
    // file, but say so explicitly.
    expect(source.length).toBeGreaterThan(200);
    const reads = [...source.matchAll(SHOP_TABLE_READ)];

    // A second read is a second policy decision — and the one that gets it
    // wrong will not look wrong, it will just quietly sweep an uninstalled
    // merchant (threat T-02-17).
    expect(reads).toHaveLength(1);

    const enumeratorStart = source.indexOf(
      "export async function forEachActiveShop",
    );
    expect(enumeratorStart).toBeGreaterThan(-1);
    const enumeratorEnd = source.indexOf("\nexport ", enumeratorStart + 1);

    const readIndex = reads[0].index ?? -1;
    expect(readIndex).toBeGreaterThan(enumeratorStart);
    expect(readIndex).toBeLessThan(enumeratorEnd);

    // ...and it filters. An unfiltered enumerator in the right place is still
    // the CF-3 violation.
    expect(source.slice(readIndex, readIndex + 200)).toContain("active: true");
  });

  it("reconciliation.server.ts never reads the Shop table at all", () => {
    const source = sourceWithoutComments("app/services/reconciliation.server.ts");

    // Stripper sanity: a blanked file has zero reads too.
    expect(source.length).toBeGreaterThan(200);
    expect(source).toMatch(/^export (async )?function /m);
    expect([...source.matchAll(SHOP_TABLE_READ)]).toHaveLength(0);
    expect(source).toContain("forEachActiveShop");
  });

  it("shop-lifecycle.server.ts documents forEachActiveShop as the enforcement", () => {
    // The contract that CF-3 started as a comment now names the mechanism that
    // enforces it, so a reader of the lifecycle service is pointed at code.
    const raw = readFileSync(
      new URL("../app/services/shop-lifecycle.server.ts", import.meta.url),
      "utf8",
    );
    expect(raw).toContain("forEachActiveShop");
  });
});

describe("lifecycle — start, shutdown, and staying out of the test process", () => {
  it("does not start under vitest", () => {
    expect(schedulerEnabled()).toBe(false);
    expect(startScheduler()).toBe(false);
    expect(scheduledTaskCount()).toBe(0);
  });

  it("registers both tasks when forced, and SIGTERM stops every one of them", async () => {
    expect(startScheduler({ force: true })).toBe(true);
    expect(scheduledTaskCount()).toBe(SWEEP_SCHEDULE.length);

    // A second call is a no-op — a dev hot-reload must not double-schedule.
    expect(startScheduler({ force: true })).toBe(false);
    expect(scheduledTaskCount()).toBe(SWEEP_SCHEDULE.length);

    // Railway sends SIGTERM to the outgoing container after the overlap window.
    expect(process.listeners("SIGTERM")).toContain(handleSigterm);

    await stopScheduler();

    expect(scheduledTaskCount()).toBe(0);
    expect(process.listeners("SIGTERM")).not.toContain(handleSigterm);
  });

  it("stopScheduler is safe to call when nothing is running", async () => {
    await expect(stopScheduler()).resolves.toBeUndefined();
    expect(scheduledTaskCount()).toBe(0);
  });
});
