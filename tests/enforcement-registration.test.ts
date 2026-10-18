import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import {
  CONFIG_METAFIELD_KEY,
  CONFIG_METAFIELD_NAMESPACE,
  DEFAULT_MESSAGES,
  VALIDATION_FUNCTION_HANDLE,
  VALIDATION_TITLE,
  buildConfigValue,
  ensureValidationRegistered,
} from "../app/services/enforcement.server";
import { createMockAdmin, type MockAdminClient } from "./helpers/admin-client-mock";

/**
 * ENFC-01/02/03/04 — the app-managed Validation registration ensure-step.
 *
 * The seam is the Phase 2 convention: `admin-client.server.ts` is the ONLY
 * mocked module, so the ensure-step runs real code against real Postgres rows
 * (the `Shop.validationGid` claims below are claims about a table) and lands on
 * a fake Admin API whose calls are assertable per GraphQL operation name.
 *
 * The load-bearing assertion in this file is `blockOnFailure: false`. That flag
 * is the platform half of ENFC-04: Shopify's own wording is "Validation errors
 * always block checkout progress. The `blockOnFailure` field controls whether
 * runtime exceptions, such as timeouts, also block checkout." True — or omitted
 * and left to a default we do not control — means a crash or a slow function in
 * OUR code stops a merchant's real sale. That is this app's entire purpose
 * inverted, so it gets a dedicated test rather than a code comment.
 */

const getAdminContext = vi.hoisted(() => vi.fn());

vi.mock("../app/services/admin-client.server", () => ({ getAdminContext }));

/** The ensure-step is non-throwing by contract — failures surface ONLY here. */
const captureException = vi.hoisted(() => vi.fn());
const captureMessage = vi.hoisted(() => vi.fn());

vi.mock("@sentry/react-router", () => ({ captureException, captureMessage }));

const SHOP = "enforcement-registration-test.myshopify.com";
const OTHER_SHOP = "enforcement-registration-bystander.myshopify.com";
const VALIDATION_GID = "gid://shopify/Validation/9901";

let admin: MockAdminClient;

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

async function wipe(...domains: string[]) {
  await prisma.session.deleteMany({ where: { shop: { in: domains } } });
  await prisma.shop.deleteMany({ where: { domain: { in: domains } } });
}

async function seedShop(domain = SHOP, active = true) {
  return prisma.shop.create({ data: { domain, active } });
}

/** `validations(first: 50)` answering with an arbitrary node list. */
function validationsResponse(
  nodes: Array<{
    id: string;
    enabled?: boolean;
    blockOnFailure?: boolean;
    handle?: string | null;
    appKey?: string | null;
  }> = [],
) {
  return {
    data: {
      validations: {
        nodes: nodes.map((node) => ({
          id: node.id,
          enabled: node.enabled ?? true,
          blockOnFailure: node.blockOnFailure ?? false,
          shopifyFunction:
            node.handle === null
              ? null
              : {
                  handle: node.handle ?? VALIDATION_FUNCTION_HANDLE,
                  appKey: node.appKey ?? process.env.SHOPIFY_API_KEY ?? null,
                },
        })),
      },
    },
  };
}

function createResponse(
  overrides: {
    id?: string;
    enabled?: boolean;
    blockOnFailure?: boolean;
    userErrors?: Array<{ field?: string[] | null; message: string; code?: string | null }>;
  } = {},
) {
  const userErrors = overrides.userErrors ?? [];
  return {
    data: {
      validationCreate: {
        validation:
          userErrors.length > 0
            ? null
            : {
                id: overrides.id ?? VALIDATION_GID,
                enabled: overrides.enabled ?? true,
                blockOnFailure: overrides.blockOnFailure ?? false,
                shopifyFunction: { handle: VALIDATION_FUNCTION_HANDLE },
              },
        userErrors,
      },
    },
  };
}

function configResponse(
  userErrors: Array<{ field?: string[] | null; message: string }> = [],
) {
  return {
    data: {
      metafieldsSet: {
        metafields:
          userErrors.length > 0
            ? []
            : [
                {
                  id: "gid://shopify/Metafield/5501",
                  key: CONFIG_METAFIELD_KEY,
                  namespace: "app--000000",
                },
              ],
        userErrors,
      },
    },
  };
}

/** The `metafields` entry of a validationCreate call, if it carried one. */
function createVariables(): Record<string, unknown> {
  const call = admin.callsFor("EnsureValidation").at(-1);
  expect(call, "expected a validationCreate call").toBeTruthy();
  return call!.variables.validation as Record<string, unknown>;
}

async function validationGidOf(domain = SHOP): Promise<string | null> {
  const row = await prisma.shop.findUnique({
    where: { domain },
    select: { validationGid: true },
  });
  return row?.validationGid ?? null;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await wipe(SHOP, OTHER_SHOP);
  admin = createMockAdmin();
  getAdminContext.mockImplementation(async () => admin);
});

afterAll(async () => {
  await wipe(SHOP, OTHER_SHOP);
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ *
 * Create-when-absent
 * ------------------------------------------------------------------ */

describe("ensureValidationRegistered — create when absent", () => {
  beforeEach(async () => {
    await seedShop();
  });

  it("creates the Validation once when the shop has none of ours", async () => {
    admin.setFixture("EnsureValidationState", validationsResponse([]));
    admin.setFixture("EnsureValidation", createResponse());

    await ensureValidationRegistered(SHOP);

    expect(admin.callCount("EnsureValidation")).toBe(1);
    const variables = createVariables();
    expect(variables.functionHandle).toBe(VALIDATION_FUNCTION_HANDLE);
    expect(variables.enable).toBe(true);
    expect(variables.title).toBe(VALIDATION_TITLE);
  });

  it("pins blockOnFailure to FALSE in the create variables (ENFC-04)", async () => {
    admin.setFixture("EnsureValidationState", validationsResponse([]));
    admin.setFixture("EnsureValidation", createResponse());

    await ensureValidationRegistered(SHOP);

    const variables = createVariables();
    // Not falsy, not absent: the literal `false`. An omitted key would leave the
    // platform default in charge of whether OUR crash blocks a merchant's sale.
    expect(variables).toHaveProperty("blockOnFailure");
    expect(variables.blockOnFailure).toBe(false);
    expect(JSON.stringify(variables)).not.toContain('"blockOnFailure":true');
  });

  it("carries the config_v1 defaults metafield inline (ENFC-03, P4-L5)", async () => {
    admin.setFixture("EnsureValidationState", validationsResponse([]));
    admin.setFixture("EnsureValidation", createResponse());

    await ensureValidationRegistered(SHOP);

    const metafields = createVariables().metafields as Array<
      Record<string, unknown>
    >;
    expect(metafields).toHaveLength(1);
    expect(metafields[0].namespace).toBe(CONFIG_METAFIELD_NAMESPACE);
    expect(metafields[0].key).toBe(CONFIG_METAFIELD_KEY);
    expect(metafields[0].type).toBe("json");

    const value = JSON.parse(String(metafields[0].value));
    expect(value).toEqual({
      v: 1,
      over_limit_message: DEFAULT_MESSAGES.overLimit,
      overdue_message: DEFAULT_MESSAGES.overdue,
    });
  });

  it("persists the new Validation GID on the shop's own row", async () => {
    admin.setFixture("EnsureValidationState", validationsResponse([]));
    admin.setFixture("EnsureValidation", createResponse());

    await ensureValidationRegistered(SHOP);

    expect(await validationGidOf()).toBe(VALIDATION_GID);
  });

  it("ignores another app's validation and one with no shopifyFunction", async () => {
    admin.setFixture(
      "EnsureValidationState",
      validationsResponse([
        { id: "gid://shopify/Validation/1", handle: "some-other-app-rule" },
        { id: "gid://shopify/Validation/2", handle: null },
      ]),
    );
    admin.setFixture("EnsureValidation", createResponse());

    await ensureValidationRegistered(SHOP);

    expect(admin.callCount("EnsureValidation")).toBe(1);
    expect(await validationGidOf()).toBe(VALIDATION_GID);
  });
});

/* ------------------------------------------------------------------ *
 * Skip-when-present / idempotence
 * ------------------------------------------------------------------ */

describe("ensureValidationRegistered — idempotence", () => {
  beforeEach(async () => {
    await seedShop();
  });

  it("issues NO mutation when our validation already exists", async () => {
    admin.setFixture(
      "EnsureValidationState",
      validationsResponse([{ id: VALIDATION_GID }]),
    );

    await ensureValidationRegistered(SHOP);

    // No fixture is registered for EnsureValidation, so an attempted create
    // would throw out of the mock rather than pass silently.
    expect(admin.callCount("EnsureValidation")).toBe(0);
    expect(await validationGidOf()).toBe(VALIDATION_GID);
  });

  it("does not create a second Validation on a repeat call (the app-open path)", async () => {
    admin.setFixture("EnsureValidationState", [
      validationsResponse([]),
      validationsResponse([{ id: VALIDATION_GID }]),
    ]);
    admin.setFixture("EnsureValidation", createResponse());

    await ensureValidationRegistered(SHOP);
    await ensureValidationRegistered(SHOP);

    expect(admin.callCount("EnsureValidation")).toBe(1);
    expect(admin.callCount("EnsureValidationState")).toBe(2);
    expect(await validationGidOf()).toBe(VALIDATION_GID);
  });

  it("records a merchant-disabled rule honestly instead of forcing it back on", async () => {
    admin.setFixture(
      "EnsureValidationState",
      validationsResponse([{ id: VALIDATION_GID, enabled: false }]),
    );

    await ensureValidationRegistered(SHOP);

    // Turning a rule off in Settings -> Checkout is a merchant choice (research
    // Open Question 1). The app stores the GID so 04-04 can SHOW the off state;
    // it never issues validationUpdate to override it.
    expect(admin.callCount("EnsureValidation")).toBe(0);
    expect(admin.callsFor().map((call) => call.operationName)).toEqual([
      "EnsureValidationState",
    ]);
    expect(await validationGidOf()).toBe(VALIDATION_GID);
  });

  it("refreshes a stale stored GID to whatever the platform actually has", async () => {
    await prisma.shop.update({
      where: { domain: SHOP },
      data: { validationGid: "gid://shopify/Validation/OLD" },
    });
    admin.setFixture(
      "EnsureValidationState",
      validationsResponse([{ id: VALIDATION_GID }]),
    );

    await ensureValidationRegistered(SHOP);

    expect(await validationGidOf()).toBe(VALIDATION_GID);
  });
});

/* ------------------------------------------------------------------ *
 * Failure shapes — every one of them non-throwing
 * ------------------------------------------------------------------ */

describe("ensureValidationRegistered — never throws, never lies", () => {
  beforeEach(async () => {
    await seedShop();
  });

  it("treats userErrors inside data as failure: no GID, Sentry, no throw", async () => {
    admin.setFixture("EnsureValidationState", validationsResponse([]));
    admin.setFixture(
      "EnsureValidation",
      createResponse({
        userErrors: [
          { field: ["validation", "functionHandle"], message: "Function not found", code: "NOT_FOUND" },
        ],
      }),
    );

    await expect(ensureValidationRegistered(SHOP)).resolves.toBeUndefined();

    expect(await validationGidOf()).toBeNull();
    expect(captureException).toHaveBeenCalled();
  });

  it("survives a pre-consent ACCESS_DENIED without crashing the app shell", async () => {
    admin.setFixture("EnsureValidationState", {
      data: { validations: null },
      errors: [
        {
          message: "Access denied for validations field.",
          extensions: { code: "ACCESS_DENIED", requiredAccess: "write_validations" },
        },
      ],
    });

    await expect(ensureValidationRegistered(SHOP)).resolves.toBeUndefined();

    expect(admin.callCount("EnsureValidation")).toBe(0);
    expect(await validationGidOf()).toBeNull();
    // A warning, not an exception page: this is the EXPECTED state between the
    // scope release and the merchant accepting the re-consent prompt.
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1]).toMatchObject({ level: "warning" });
  });

  it("survives a transport throw (network / offline session gone)", async () => {
    getAdminContext.mockImplementation(async () => {
      throw new Error("no offline session for shop");
    });

    await expect(ensureValidationRegistered(SHOP)).resolves.toBeUndefined();
    expect(await validationGidOf()).toBeNull();
    expect(captureException).toHaveBeenCalled();
  });

  it("does nothing at all for an uninstalled shop (active gate first)", async () => {
    await prisma.shop.update({ where: { domain: SHOP }, data: { active: false } });

    await ensureValidationRegistered(SHOP);

    expect(admin.callsFor()).toHaveLength(0);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("does nothing for a shop with no row at all", async () => {
    await ensureValidationRegistered(OTHER_SHOP);

    expect(admin.callsFor()).toHaveLength(0);
    expect(captureException).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * A3 fallback — inline metafields rejected
 * ------------------------------------------------------------------ */

describe("ensureValidationRegistered — A3 fallback (inline metafields rejected)", () => {
  beforeEach(async () => {
    await seedShop();
  });

  it("retries bare then metafieldsSet when the inline metafields input is rejected", async () => {
    admin.setFixture("EnsureValidationState", validationsResponse([]));
    admin.setFixture("EnsureValidation", [
      createResponse({
        userErrors: [
          {
            field: ["validation", "metafields", "0", "namespace"],
            message: "Namespace $app is not allowed here",
          },
        ],
      }),
      createResponse(),
    ]);
    admin.setFixture("SetValidationConfig", configResponse());

    await ensureValidationRegistered(SHOP);

    expect(admin.callCount("EnsureValidation")).toBe(2);
    // Second attempt is BARE — no metafields key at all.
    const retry = admin.callsFor("EnsureValidation")[1].variables
      .validation as Record<string, unknown>;
    expect(retry.metafields).toBeUndefined();
    expect(retry.blockOnFailure).toBe(false);

    // Config then lands on the new Validation object by ownerId.
    const setCall = admin.callsFor("SetValidationConfig")[0];
    const metafields = setCall.variables.metafields as Array<
      Record<string, unknown>
    >;
    expect(metafields[0].ownerId).toBe(VALIDATION_GID);
    expect(metafields[0].key).toBe(CONFIG_METAFIELD_KEY);
    expect(metafields[0].value).toBe(buildConfigValue());

    expect(await validationGidOf()).toBe(VALIDATION_GID);
    // The winning path is recorded so the SUMMARY's A3 verdict is evidence.
    expect(captureMessage).toHaveBeenCalled();
  });

  it("keeps the Validation (and its GID) when only the config write fails", async () => {
    admin.setFixture("EnsureValidationState", validationsResponse([]));
    admin.setFixture("EnsureValidation", [
      createResponse({
        userErrors: [
          { field: ["validation", "metafields"], message: "metafields is invalid" },
        ],
      }),
      createResponse(),
    ]);
    admin.setFixture(
      "SetValidationConfig",
      configResponse([{ field: ["metafields", "0"], message: "owner not supported" }]),
    );

    await ensureValidationRegistered(SHOP);

    // The rule is live and fail-open-configured; only the merchant-editable
    // copy is missing, and the Function falls back to its own DEFAULT_MESSAGES
    // for exactly that case (ENFC-03). Losing the GID would strand the rule.
    expect(await validationGidOf()).toBe(VALIDATION_GID);
    expect(captureException).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * The copy contract
 * ------------------------------------------------------------------ */

describe("DEFAULT_MESSAGES / buildConfigValue (P4-L4, P4-L5)", () => {
  it("keeps both messages plain text and within the 250-char cap", () => {
    for (const message of [DEFAULT_MESSAGES.overLimit, DEFAULT_MESSAGES.overdue]) {
      expect(message.length).toBeGreaterThan(0);
      expect(message.length).toBeLessThanOrEqual(250);
      expect(message).not.toMatch(/[<>]/);
    }
  });

  it("serializes exactly the P4-L5 shape (additive evolution only)", () => {
    expect(JSON.parse(buildConfigValue())).toEqual({
      v: 1,
      over_limit_message: DEFAULT_MESSAGES.overLimit,
      overdue_message: DEFAULT_MESSAGES.overdue,
    });
  });

  it("matches the Function's duplicated copy byte for byte", async () => {
    // The wasm cannot import server code, so the strings live twice on purpose
    // (04-01 header). This is the mechanical diff that keeps the duplication
    // honest — and it is what 04-04's settings copy review re-runs.
    const fn = await import(
      "../extensions/credit-guard-validation/src/cart_validations_generate_run"
    );
    expect(fn.DEFAULT_MESSAGES.overLimit).toBe(DEFAULT_MESSAGES.overLimit);
    expect(fn.DEFAULT_MESSAGES.overdue).toBe(DEFAULT_MESSAGES.overdue);
  });
});
