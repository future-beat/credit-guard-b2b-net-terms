import { beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import { createMockAdmin, type MockAdminClient } from "./helpers/admin-client-mock";
import { sourceWithoutComments } from "./helpers/module-source";
import {
  BACKFILL_CURSOR_KEY,
  type BackfillState,
} from "../app/services/backfill.server";
import {
  deriveSetupState,
  deriveSetupSteps,
  dismissOnboarding,
  loadSetupState,
  markBalancesReviewed,
  primaryCta,
  SETUP_COPY,
  type SetupInput,
} from "../app/services/onboarding.server";

/**
 * DASH-03 / D6-03 — the guided setup, end to end.
 *
 * Same seams as tests/companies-settings.test.ts and tests/dashboard.test.ts:
 * `authenticate.admin` is stubbed because a real session token needs a live
 * Shopify, and the Admin transport is stubbed so the enforcement module's
 * constants stay importable. Everything else is real — the real service, real
 * Prisma rows, the real route loader and action — because "pressing this button
 * stamps that column for THIS shop only" is a claim only a database settles.
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

const VALIDATION_GID = "gid://shopify/Validation/onboarding-1";
const SHOP = "onboarding-test.myshopify.com";
const OTHER_SHOP = "onboarding-bystander.myshopify.com";
const SHOPS = [SHOP, OTHER_SHOP];
const ENDPOINT = "https://app.creditguard.test/app";

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

async function routeModule() {
  return import("../app/routes/app._index");
}

async function runLoader(url = ENDPOINT) {
  const { loader } = await routeModule();
  return loader({ request: new Request(url), params: {}, context: {} } as never);
}

interface ActionEnvelope {
  data: { ok: boolean; intent?: string; code?: string; stamped?: boolean };
  init?: { status?: number } | null;
}

/**
 * The route answers with react-router's `data()` envelope, so a spec reads
 * `.data` for the payload and `.init.status` for the code — the same shape
 * tests/companies-settings.test.ts asserts against.
 */
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

/** `data()` with no init means 200 (react-router's default). */
function status(result: ActionEnvelope): number {
  return result.init?.status ?? 200;
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

interface ShopSeed {
  domain?: string;
  validationGid?: string | null;
  onboardingReviewedAt?: Date | null;
  onboardingDismissedAt?: Date | null;
  reviewPromptedAt?: Date | null;
}

async function seedShop(seed: ShopSeed = {}) {
  return prisma.shop.create({
    data: {
      domain: seed.domain ?? SHOP,
      validationGid: seed.validationGid ?? null,
      onboardingReviewedAt: seed.onboardingReviewedAt ?? null,
      onboardingDismissedAt: seed.onboardingDismissedAt ?? null,
      reviewPromptedAt: seed.reviewPromptedAt ?? null,
    },
  });
}

/**
 * The `SyncCursor[shop, "backfill"]` value in the shape backfill.server.ts
 * writes it — `status` first, because its own failed-run re-claim matches on
 * the `"status":"failed"` substring.
 */
function backfillState(patch: Partial<BackfillState> = {}): BackfillState {
  return {
    status: "completed",
    operationGid: null,
    startedAt: "2026-08-01T00:00:00.000Z",
    polledAt: null,
    completedAt: "2026-08-01T00:10:00.000Z",
    error: null,
    orderCount: 0,
    scheduleCount: 0,
    companyCount: 0,
    ...patch,
  };
}

async function seedBackfill(
  patch: Partial<BackfillState> = {},
  shop = SHOP,
): Promise<void> {
  const state = backfillState(patch);
  await prisma.syncCursor.upsert({
    where: { shop_key: { shop, key: BACKFILL_CURSOR_KEY } },
    create: { shop, key: BACKFILL_CURSOR_KEY, value: JSON.stringify(state) },
    update: { value: JSON.stringify(state) },
  });
}

async function seedCompanyWithLimit(
  creditLimit: string | null,
  shop = SHOP,
): Promise<void> {
  await prisma.company.create({
    data: {
      shop,
      companyGid: `gid://shopify/Company/${Math.random().toString(36).slice(2)}`,
      name: "Acme Industrial",
      exposure: "0",
      creditLimit,
    },
  });
}

async function shopRow(domain = SHOP) {
  return prisma.shop.findUnique({ where: { domain } });
}

/** The `ValidationConfig` read behind step 3, in the shape Shopify answers. */
function configResponse(options: { enabled?: boolean; missing?: boolean } = {}) {
  return {
    data: {
      validation: options.missing
        ? null
        : {
            id: VALIDATION_GID,
            enabled: options.enabled ?? true,
            blockOnFailure: false,
            metafield: null,
          },
    },
  };
}

let admin: MockAdminClient;

beforeEach(async () => {
  vi.clearAllMocks();
  authenticateAdmin.mockResolvedValue({ session: { shop: SHOP } });
  admin = createMockAdmin({ ValidationConfig: configResponse() });
  getAdminContext.mockReset();
  await resetShops();
});

/* ------------------------------------------------------------------ *
 * Step 1 — review your balances
 * ------------------------------------------------------------------ */

describe("guided setup step 1 (DASH-03)", () => {
  it("tells the merchant what has been imported so far while it runs", () => {
    const steps = deriveSetupSteps({
      backfill: backfillState({
        status: "running",
        orderCount: 41,
        companyCount: 7,
      }),
      reviewedAt: null,
      hasLimit: false,
      validationGid: null,
      validation: null,
    });

    expect(steps[0].title).toBe("Review your balances");
    expect(steps[0].body).toBe(
      "Importing your order history… 41 orders and 7 companies so far.",
    );
    expect(steps[0].complete).toBe(false);
    // A merchant cannot vouch for balances that are still arriving.
    expect(steps[0].button?.disabled).toBe(true);
  });

  it("reports the finished import with its counts and asks for a look", () => {
    const steps = deriveSetupSteps({
      backfill: backfillState({ orderCount: 128, companyCount: 12 }),
      reviewedAt: null,
      hasLimit: false,
      validationGid: null,
      validation: null,
    });

    expect(steps[0].body).toBe(
      "12 companies with 128 net-terms orders were imported. Check the balances look right before setting limits.",
    );
    expect(steps[0].button).toEqual({
      label: "Looks right",
      intent: "mark-reviewed",
      disabled: false,
      variant: "primary",
    });
    expect(steps[0].link).toEqual({
      label: "Open companies",
      href: "/app/companies",
    });
  });

  it.each([
    ["a failed run", backfillState({ status: "failed" })],
    ["no cursor row at all", null],
  ])("says the import did not finish for %s", (_label, backfill) => {
    const steps = deriveSetupSteps({
      backfill,
      reviewedAt: null,
      hasLimit: false,
      validationGid: null,
      validation: null,
    });

    expect(steps[0].body).toBe(
      "Credit Guard couldn't finish importing your order history. Open the app again to retry; balances may be incomplete until then.",
    );
  });

  it("marks step 1 complete and drops its button once reviewed", () => {
    const steps = deriveSetupSteps({
      backfill: backfillState(),
      reviewedAt: new Date("2026-08-20T00:00:00.000Z"),
      hasLimit: false,
      validationGid: null,
      validation: null,
    });

    expect(steps[0].complete).toBe(true);
    expect(steps[0].state).toBe("complete");
    expect(steps[0].icon).toEqual({
      type: "check-circle-filled",
      tone: "success",
    });
    expect(steps[0].button).toBeNull();
  });

  it("groups large counts rather than printing raw digits", () => {
    const steps = deriveSetupSteps({
      backfill: backfillState({ orderCount: 1024, companyCount: 2048 }),
      reviewedAt: null,
      hasLimit: false,
      validationGid: null,
      validation: null,
      locale: "en-US",
    });

    expect(steps[0].body).toContain("1,024 net-terms orders");
    expect(steps[0].body).toContain("2,048 companies");
  });
});

/* ------------------------------------------------------------------ *
 * loadSetupState — the reads, and the ones it refuses to make
 * ------------------------------------------------------------------ */

describe("loadSetupState", () => {
  it("derives step 1 from this shop's own backfill state", async () => {
    await seedShop();
    await seedBackfill({ orderCount: 9, companyCount: 3 });
    // A bystander shop's import must not leak into these numbers.
    await seedShop({ domain: OTHER_SHOP });
    await seedBackfill({ orderCount: 999, companyCount: 999 }, OTHER_SHOP);

    const state = await loadSetupState(SHOP);

    expect(state.visible).toBe(true);
    expect(state.steps[0].body).toContain("3 companies with 9 net-terms orders");
    expect(state.progressLabel).toBe("0 of 3 complete");
  });

  it("is invisible, and reads nothing else, once the guide is dismissed", async () => {
    await seedShop({
      onboardingDismissedAt: new Date("2026-08-20T00:00:00.000Z"),
    });
    await seedBackfill({ orderCount: 9, companyCount: 3 });

    const state = await loadSetupState(SHOP);

    expect(state.visible).toBe(false);
    expect(state.steps).toEqual([]);
    // The dismissed short-circuit is the outage-proofing contract: no Admin
    // transport is touched at all once the guide is gone (T-06-22).
    expect(getAdminContext).not.toHaveBeenCalled();
  });

  it("survives a shop that has no row yet", async () => {
    const state = await loadSetupState(SHOP);

    expect(state.visible).toBe(true);
    expect(state.steps[0].body).toBe(SETUP_COPY.step1BodyFailed);
  });
});

/* ------------------------------------------------------------------ *
 * The action — stamps, guards, and the tenant boundary
 * ------------------------------------------------------------------ */

describe("home action intents", () => {
  it("stamps onboardingReviewedAt for the session shop only", async () => {
    await seedShop();
    await seedShop({ domain: OTHER_SHOP });
    await seedBackfill();

    const result = await runAction({ intent: "mark-reviewed" });

    expect(result.data).toEqual({ ok: true, intent: "mark-reviewed" });
    expect((await shopRow())?.onboardingReviewedAt).toBeInstanceOf(Date);
    expect((await shopRow(OTHER_SHOP))?.onboardingReviewedAt).toBeNull();
  });

  it("keeps the first timestamp when pressed twice", async () => {
    await seedShop();
    await seedBackfill();

    await runAction({ intent: "mark-reviewed" });
    const first = (await shopRow())?.onboardingReviewedAt;
    await runAction({ intent: "mark-reviewed" });

    expect((await shopRow())?.onboardingReviewedAt).toEqual(first);
  });

  it("refuses to mark balances reviewed while the import is running", async () => {
    await seedShop();
    await seedBackfill({ status: "running" });

    const result = await runAction({ intent: "mark-reviewed" });

    expect(status(result)).toBe(409);
    expect(result.data).toEqual({ ok: false, code: "backfill-running" });
    expect((await shopRow())?.onboardingReviewedAt).toBeNull();
  });

  it("answers 400 for an intent that is not in the closed set", async () => {
    await seedShop();

    const result = await runAction({ intent: "delete-everything" });

    expect(status(result)).toBe(400);
    expect(result.data).toEqual({ ok: false, code: "unknown-intent" });
  });

  it("returns markBalancesReviewed's refusal for a shop with no row", async () => {
    const result = await markBalancesReviewed(SHOP, new Date());

    expect(result).toEqual({ ok: false, code: "not-found" });
  });
});

/* ------------------------------------------------------------------ *
 * The loader — the page carries the guide
 * ------------------------------------------------------------------ */

describe("home loader", () => {
  it("hands the page a visible guide for a fresh install", async () => {
    await seedShop();
    await seedBackfill({ orderCount: 4, companyCount: 2 });

    const payload = (await runLoader()) as { setup: { visible: boolean } };

    expect(payload.setup.visible).toBe(true);
  });

  it("hands the page nothing to render once dismissed", async () => {
    await seedShop({
      onboardingDismissedAt: new Date("2026-08-20T00:00:00.000Z"),
    });

    const payload = (await runLoader()) as { setup: { visible: boolean } };

    expect(payload.setup.visible).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The single-primary rule (UI-SPEC C1)
 * ------------------------------------------------------------------ */

describe("primary call to action", () => {
  it("is step 1's action while balances are unreviewed", () => {
    const state = deriveSetupState({
      backfill: backfillState(),
      reviewedAt: null,
      hasLimit: false,
      validationGid: null,
      validation: null,
    });

    expect(primaryCta(state)).toBe("Looks right");
    expect(
      state.steps.filter((step) => step.button?.variant === "primary"),
    ).toHaveLength(1);
  });

  it("is nothing at all once the guide is dismissed", () => {
    expect(
      primaryCta({
        visible: false,
        steps: [],
        completeCount: 0,
        allDone: false,
        progressLabel: "",
      }),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Steps 2 and 3 — the full derivation matrix
 * ------------------------------------------------------------------ */

/** A world where step 1 is already done, so steps 2-3 are what varies. */
function world(patch: Partial<SetupInput> = {}): SetupInput {
  return {
    backfill: backfillState(),
    reviewedAt: new Date("2026-08-20T00:00:00.000Z"),
    hasLimit: false,
    validationGid: null,
    validation: null,
    ...patch,
  };
}

describe("guided setup step 2 (DASH-03)", () => {
  it("says why limits matter and points at Companies", () => {
    const [, step2] = deriveSetupSteps(world());

    expect(step2.title).toBe("Set your first credit limit");
    expect(step2.body).toBe(
      "Companies stay observe-only until you set a limit. Start with the one company you most want to keep inside terms.",
    );
    expect(step2.complete).toBe(false);
    expect(step2.button).toEqual({
      label: "Set a limit",
      href: "/app/companies",
      variant: "primary",
    });
  });

  it("completes on the derived fact, never on a stored flag", () => {
    const [, step2] = deriveSetupSteps(world({ hasLimit: true }));

    expect(step2.complete).toBe(true);
    expect(step2.icon).toEqual({ type: "check-circle-filled", tone: "success" });
    expect(step2.button).toBeNull();
  });
});

describe("guided setup step 3 (D6-03 — status, not a switch)", () => {
  it.each([
    [
      "an unregistered rule",
      world({ hasLimit: true, validationGid: null, validation: "unregistered" }),
      {
        title: "Turn enforcement on",
        body: "Credit Guard hasn't been able to add its checkout rule yet. Reload the app to let it set itself up.",
        label: "Open settings",
        icon: "alert-circle",
        tone: "warning",
        complete: false,
      },
    ],
    [
      "a rule the merchant switched off",
      world({
        hasLimit: true,
        validationGid: VALIDATION_GID,
        validation: "disabled",
      }),
      {
        title: "Turn enforcement on",
        body: "Credit Guard's checkout rule is switched off in Shopify Settings → Checkout → Checkout rules. Turn it back on there to start enforcing limits.",
        label: "Open settings",
        icon: "alert-circle",
        tone: "warning",
        complete: false,
      },
    ],
    [
      "a live rule with a limit set",
      world({
        hasLimit: true,
        validationGid: VALIDATION_GID,
        validation: "active",
      }),
      {
        title: "Enforcement is on",
        body: "Companies over their credit limit or with overdue invoices can't complete a new net-terms order. You can turn this off any time in Shopify Settings → Checkout → Checkout rules.",
        label: "Check checkout messages",
        icon: "check-circle-filled",
        tone: "success",
        complete: true,
      },
    ],
    [
      "a live rule with no limit set yet",
      world({
        hasLimit: false,
        validationGid: VALIDATION_GID,
        validation: "active",
      }),
      {
        title: "Turn enforcement on",
        body: "Companies over their credit limit or with overdue invoices can't complete a new net-terms order. You can turn this off any time in Shopify Settings → Checkout → Checkout rules.",
        label: "Check checkout messages",
        icon: "circle-dashed",
        tone: "neutral",
        complete: false,
      },
    ],
    [
      "a stored gid Shopify no longer knows about",
      world({
        hasLimit: true,
        validationGid: VALIDATION_GID,
        validation: "unregistered",
      }),
      {
        title: "Turn enforcement on",
        body: "Credit Guard hasn't been able to add its checkout rule yet. Reload the app to let it set itself up.",
        label: "Open settings",
        icon: "alert-circle",
        tone: "warning",
        complete: false,
      },
    ],
  ])("reports %s", (_label, input, expected) => {
    const [, , step3] = deriveSetupSteps(input);

    expect(step3.title).toBe(expected.title);
    expect(step3.body).toBe(expected.body);
    expect(step3.complete).toBe(expected.complete);
    expect(step3.button?.label).toBe(expected.label);
    expect(step3.button?.href).toBe("/app/settings");
    expect(step3.icon).toEqual({ type: expected.icon, tone: expected.tone });
  });

  it("keeps its settings pointer even when complete (the one that stays)", () => {
    const [, , step3] = deriveSetupSteps(
      world({
        hasLimit: true,
        validationGid: VALIDATION_GID,
        validation: "active",
      }),
    );

    expect(step3.button).toEqual({
      label: "Check checkout messages",
      href: "/app/settings",
      variant: "secondary",
    });
  });

  it("offers no mutation of its own — status confirmation, not a kill switch", () => {
    const steps = deriveSetupSteps(
      world({ hasLimit: true, validation: "disabled" }),
    );

    for (const step of steps) {
      expect(step.button?.intent ?? "mark-reviewed").toBe("mark-reviewed");
    }
  });
});

/* ------------------------------------------------------------------ *
 * Progress, the single-primary invariant, and Done
 * ------------------------------------------------------------------ */

describe("progress and the single primary button (UI-SPEC C1)", () => {
  it.each([
    [world({ reviewedAt: null }), 0, "0 of 3 complete", "Looks right"],
    [world(), 1, "1 of 3 complete", "Set a limit"],
    [
      world({ hasLimit: true, validation: "disabled" }),
      2,
      "2 of 3 complete",
      "Open settings",
    ],
    [
      world({
        hasLimit: true,
        validationGid: VALIDATION_GID,
        validation: "active",
      }),
      3,
      "All set",
      "Done",
    ],
  ])(
    "counts progress and names one call to action (%#)",
    (input, completeCount, progressLabel, cta) => {
      const state = deriveSetupState(input);

      expect(state.completeCount).toBe(completeCount);
      expect(state.progressLabel).toBe(progressLabel);
      expect(state.allDone).toBe(completeCount === 3);
      expect(primaryCta(state)).toBe(cta);

      const primaries = state.steps.filter(
        (step) => step.button?.variant === "primary",
      );
      // Exactly one primary among the steps while anything is incomplete, and
      // none at 3/3 — "Done" is the page's primary then.
      expect(primaries).toHaveLength(completeCount === 3 ? 0 : 1);
    },
  );
});

describe("dismissing the guide", () => {
  it("refuses while anything is incomplete, and stamps nothing", async () => {
    await seedShop();
    await seedBackfill();

    const result = await runAction({ intent: "dismiss-onboarding" });

    expect(status(result)).toBe(409);
    expect(result.data).toEqual({ ok: false, code: "not-complete" });
    expect((await shopRow())?.onboardingDismissedAt).toBeNull();
  });

  it("re-derives 3 of 3 on the server before it will stamp", async () => {
    await seedShop({
      onboardingReviewedAt: new Date("2026-08-20T00:00:00.000Z"),
      validationGid: VALIDATION_GID,
    });
    await seedBackfill();
    await seedCompanyWithLimit("1000.0000");
    // The rule reads active from Shopify — the only step the DB cannot answer.
    getAdminContext.mockResolvedValue(admin);

    const result = await runAction({ intent: "dismiss-onboarding" });

    expect(result.data).toEqual({ ok: true, intent: "dismiss-onboarding" });
    expect((await shopRow())?.onboardingDismissedAt).toBeInstanceOf(Date);
    // And it never comes back (BFS 4.2.2 #6).
    expect((await loadSetupState(SHOP)).visible).toBe(false);
  });

  it("keeps the first dismissal timestamp when pressed twice", async () => {
    await seedShop({
      onboardingDismissedAt: new Date("2026-08-20T00:00:00.000Z"),
    });

    const before = (await shopRow())?.onboardingDismissedAt;
    const result = await dismissOnboarding(SHOP, new Date());

    expect(result).toEqual({ ok: true });
    expect((await shopRow())?.onboardingDismissedAt).toEqual(before);
  });
});

/* ------------------------------------------------------------------ *
 * The live status read, and when it is NOT made (T-06-22)
 * ------------------------------------------------------------------ */

describe("the live validation read", () => {
  it("asks Shopify for the rule's status while the guide is visible", async () => {
    await seedShop({ validationGid: VALIDATION_GID });
    await seedBackfill();
    admin.setFixture("ValidationConfig", configResponse({ enabled: false }));
    getAdminContext.mockResolvedValue(admin);

    const state = await loadSetupState(SHOP);

    expect(getAdminContext).toHaveBeenCalled();
    expect(state.steps[2].title).toBe("Turn enforcement on");
    expect(state.steps[2].icon.tone).toBe("warning");
  });

  it("makes no Admin call at all once the guide is dismissed", async () => {
    await seedShop({
      validationGid: VALIDATION_GID,
      onboardingDismissedAt: new Date("2026-08-20T00:00:00.000Z"),
    });

    await loadSetupState(SHOP);

    expect(getAdminContext).not.toHaveBeenCalled();
  });

  it("degrades to unregistered rather than taking the home page down", async () => {
    await seedShop({ validationGid: VALIDATION_GID });
    await seedBackfill();
    getAdminContext.mockRejectedValue(new Error("Shopify is having a day"));

    const state = await loadSetupState(SHOP);

    expect(state.visible).toBe(true);
    expect(state.steps[2].body).toContain("hasn't been able to add its checkout rule yet");
  });
});

/* ------------------------------------------------------------------ *
 * The client/server split (the 04-04 build trap)
 * ------------------------------------------------------------------ */

describe("setup copy module", () => {
  it("imports nothing, so a component can render it", () => {
    // The home page renders SETUP_COPY and walks SetupStep in its component.
    // An import here — even an innocent-looking one — would be inherited by
    // that route and fail only at `react-router build`, long after every test
    // and the typechecker have gone green.
    // Matched as a STATEMENT, not a substring: step 1's copy legitimately
    // contains the words "imported" and "importing".
    expect(sourceWithoutComments("app/setup-copy.ts")).not.toMatch(
      /^\s*import\s/m,
    );
  });

  it("keeps the page's copy identical to the service's", async () => {
    const service = await import("../app/services/onboarding.server");
    const plain = await import("../app/setup-copy");

    expect(service.SETUP_COPY).toBe(plain.SETUP_COPY);
  });
});
