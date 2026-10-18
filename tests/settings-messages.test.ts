import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "../app/db.server";
import {
  CONFIG_METAFIELD_KEY,
  CONFIG_METAFIELD_NAMESPACE,
  DEFAULT_MESSAGES,
  MAX_MESSAGE_LENGTH,
  buildConfigValue,
} from "../app/services/enforcement.server";
import { REMINDERS_CADENCE } from "../app/reminder-copy";
import { createMockAdmin, type MockAdminClient } from "./helpers/admin-client-mock";
import { sourceWithoutComments } from "./helpers/module-source";

/**
 * ENFC-03 — the enforcement Settings page, end to end.
 *
 * Same seam as tests/companies-settings.test.ts: `authenticate.admin` is
 * stubbed (no suite mints a real session token) and the Admin GraphQL client is
 * faked per operation name. EVERYTHING else is real — the real route module,
 * the real action, the real service helpers, real `Shop` rows in the scratch
 * test database. So "no mutation was issued" is a claim about a call log, and
 * "the id came from this shop's own row" is a claim about Postgres.
 *
 * The three assertions this file exists for:
 *
 *   1. THE CAP IS SERVER-SIDE. A 251-character message is refused by the action
 *      and issues NO mutation. The textarea's `maxLength` is decoration; a
 *      scripted POST walks past it, and the string on the other side of this
 *      gate renders on a stranger's checkout (T-04-13).
 *   2. userErrors ARE A FAILURE. `validationUpdate` reports them INSIDE `data`
 *      with a 200 and an empty top-level `errors[]` — the 03-01 trap. Reading
 *      past them is how an app tells a merchant their copy is live while buyers
 *      still read the old text (T-04-15).
 *   3. THE GID IS THE AUTHENTICATED SHOP'S OWN. A second shop with its own
 *      Validation is seeded in every test; no path may ever address it
 *      (T-04-14).
 */

const authenticateAdmin = vi.hoisted(() => vi.fn());

vi.mock("../app/shopify.server", () => ({
  authenticate: { admin: authenticateAdmin },
}));

const getAdminContext = vi.hoisted(() => vi.fn());

vi.mock("../app/services/admin-client.server", () => ({ getAdminContext }));

const captureException = vi.hoisted(() => vi.fn());
const captureMessage = vi.hoisted(() => vi.fn());

vi.mock("@sentry/react-router", () => ({ captureException, captureMessage }));

const SHOP = "settings-messages-test.myshopify.com";
const OTHER_SHOP = "settings-messages-bystander.myshopify.com";
const VALIDATION_GID = "gid://shopify/Validation/4404";
const OTHER_VALIDATION_GID = "gid://shopify/Validation/9999";
const ENDPOINT = "https://app.creditguard.test/app/settings";

const CUSTOM_MESSAGES = {
  overLimit: "You have used all the credit we extended. Call Priya on 03 9000 1234.",
  overdue: "Invoice 10042 is past due. We can release this order once it is paid.",
};

let admin: MockAdminClient;

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

interface ActionResult {
  data: Record<string, unknown>;
  init: { status?: number } | null;
}

async function routeModule() {
  return import("../app/routes/app.settings");
}

const {
  MESSAGES_SAVED_TOAST,
  MESSAGE_CONTROL_ERROR,
  MESSAGE_REQUIRED_ERROR,
  MESSAGE_TOO_LONG_ERROR,
  OVERDUE_LABEL,
  OVER_LIMIT_LABEL,
  PAGE_INTRO,
  SAVE_MESSAGES_INTENT,
  STATUS_ACTIVE_HEADING,
  STATUS_DISABLED_HEADING,
  STATUS_UNREGISTERED_HEADING,
  fieldErrorFor,
} = await routeModule();

/** `validation(id:)` answering with an arbitrary Validation node. */
function configResponse(options: {
  enabled?: boolean;
  blockOnFailure?: boolean;
  value?: string | null;
  missing?: boolean;
}) {
  return {
    data: {
      validation: options.missing
        ? null
        : {
            id: VALIDATION_GID,
            enabled: options.enabled ?? true,
            // Read back so the update can ECHO it. `ValidationUpdateInput` is
            // NOT a partial update — see the enable-preservation tests below.
            blockOnFailure: options.blockOnFailure ?? false,
            metafield:
              options.value === null || options.value === undefined
                ? null
                : { value: options.value },
          },
    },
  };
}

function updateResponse(
  userErrors: Array<{
    field?: string[] | null;
    message: string;
    code?: string | null;
  }> = [],
) {
  return {
    data: {
      validationUpdate: {
        validation:
          userErrors.length > 0 ? null : { id: VALIDATION_GID, enabled: true },
        userErrors,
      },
    },
  };
}

async function seedShop(domain: string, validationGid: string | null) {
  await prisma.shop.upsert({
    where: { domain },
    create: { domain, active: true, validationGid },
    update: { active: true, validationGid },
  });
}

async function runAction(body: FormData): Promise<ActionResult> {
  const { action } = await routeModule();
  const request = new Request(ENDPOINT, { method: "POST", body });
  return (await action({ request, params: {}, context: {} } as never)) as ActionResult;
}

function saveForm(fields: Record<string, string>): FormData {
  const body = new FormData();
  body.append("intent", SAVE_MESSAGES_INTENT);
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return body;
}

async function runLoader() {
  const { loader } = await routeModule();
  const request = new Request(ENDPOINT);
  return loader({ request, params: {}, context: {} } as never);
}

function statusOf(result: ActionResult): number {
  return result.init?.status ?? 200;
}

/** The variables of the single UpdateValidationConfig call. */
function updateVariables(): Record<string, unknown> {
  const calls = admin.callsFor("UpdateValidationConfig");
  expect(calls).toHaveLength(1);
  return calls[0].variables;
}

/** The config_v1 JSON the mutation carried, parsed. */
function writtenConfig(): Record<string, unknown> {
  const variables = updateVariables();
  const validation = variables.validation as {
    metafields: Array<{
      namespace: string;
      key: string;
      type: string;
      value: string;
    }>;
  };
  expect(validation.metafields).toHaveLength(1);
  const metafield = validation.metafields[0];
  expect(metafield.namespace).toBe(CONFIG_METAFIELD_NAMESPACE);
  expect(metafield.key).toBe(CONFIG_METAFIELD_KEY);
  expect(metafield.type).toBe("json");
  return JSON.parse(metafield.value) as Record<string, unknown>;
}

beforeEach(async () => {
  vi.clearAllMocks();

  await prisma.shop.deleteMany({ where: { domain: { in: [SHOP, OTHER_SHOP] } } });
  await seedShop(SHOP, VALIDATION_GID);
  // The bystander is seeded in EVERY test on purpose: a cross-shop leak needs
  // somewhere to leak TO before a test can catch it.
  await seedShop(OTHER_SHOP, OTHER_VALIDATION_GID);

  admin = createMockAdmin({
    ValidationConfig: configResponse({
      enabled: true,
      value: buildConfigValue(DEFAULT_MESSAGES),
    }),
    UpdateValidationConfig: updateResponse(),
  });
  getAdminContext.mockResolvedValue(admin);
  authenticateAdmin.mockResolvedValue({ session: { shop: SHOP } });
});

afterAll(async () => {
  await prisma.shop.deleteMany({ where: { domain: { in: [SHOP, OTHER_SHOP] } } });
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ *
 * Loader — honest status, current-or-default copy
 * ------------------------------------------------------------------ */

describe("settings loader (ENFC-03 status honesty)", () => {
  it("reports active when the shop's Validation exists and is enabled", async () => {
    const state = await runLoader();

    expect(state.status).toBe("active");
    expect(admin.callsFor("ValidationConfig")[0].variables).toEqual({
      id: VALIDATION_GID,
    });
  });

  it("reports disabled — never active — when the merchant turned the rule off", async () => {
    admin.setFixture(
      "ValidationConfig",
      configResponse({ enabled: false, value: buildConfigValue(DEFAULT_MESSAGES) }),
    );

    const state = await runLoader();

    expect(state.status).toBe("disabled");
  });

  it("reports unregistered when the shop has no stored Validation GID", async () => {
    await seedShop(SHOP, null);

    const state = await runLoader();

    expect(state.status).toBe("unregistered");
    // Nothing to ask Shopify about: no transport at all.
    expect(admin.callCount("ValidationConfig")).toBe(0);
    expect(state.messages).toEqual({ ...DEFAULT_MESSAGES });
  });

  it("reports unregistered when the stored GID points at a deleted rule", async () => {
    admin.setFixture("ValidationConfig", configResponse({ missing: true }));

    const state = await runLoader();

    expect(state.status).toBe("unregistered");
  });

  it("never 500s over a GraphQL blip — degrades to unregistered and reports it", async () => {
    admin.setFixture("ValidationConfig", () => {
      throw new Error("upstream connect error");
    });

    const state = await runLoader();

    expect(state.status).toBe("unregistered");
    expect(state.messages).toEqual({ ...DEFAULT_MESSAGES });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("shows the merchant's saved copy when config_v1 holds it", async () => {
    admin.setFixture(
      "ValidationConfig",
      configResponse({ value: buildConfigValue(CUSTOM_MESSAGES) }),
    );

    const state = await runLoader();

    expect(state.messages).toEqual(CUSTOM_MESSAGES);
  });

  it("falls back FIELD BY FIELD when config_v1 is partly unusable", async () => {
    admin.setFixture(
      "ValidationConfig",
      configResponse({
        value: JSON.stringify({
          v: 1,
          over_limit_message: CUSTOM_MESSAGES.overLimit,
          overdue_message: "   ",
        }),
      }),
    );

    const state = await runLoader();

    expect(state.messages.overLimit).toBe(CUSTOM_MESSAGES.overLimit);
    // Exactly what the Function would render for that field — not a blank box.
    expect(state.messages.overdue).toBe(DEFAULT_MESSAGES.overdue);
  });

  it("falls back wholesale on an absent metafield, junk JSON, or a wrong version", async () => {
    for (const value of [
      null,
      "not json at all",
      JSON.stringify({ v: 2, over_limit_message: "x", overdue_message: "y" }),
      JSON.stringify([1, 2, 3]),
    ]) {
      admin.setFixture("ValidationConfig", configResponse({ value }));

      const state = await runLoader();

      expect(state.messages).toEqual({ ...DEFAULT_MESSAGES });
    }
  });
});

/* ------------------------------------------------------------------ *
 * Action — the save path
 * ------------------------------------------------------------------ */

describe("save-messages action (ENFC-03 write path)", () => {
  it("writes the full config_v1 JSON with both messages and reports success", async () => {
    const result = await runAction(
      saveForm({
        overLimitMessage: CUSTOM_MESSAGES.overLimit,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    expect(result.data).toEqual({ ok: true, intent: SAVE_MESSAGES_INTENT });
    expect(statusOf(result)).toBe(200);
    expect(writtenConfig()).toEqual({
      v: 1,
      over_limit_message: CUSTOM_MESSAGES.overLimit,
      overdue_message: CUSTOM_MESSAGES.overdue,
    });
  });

  it("round-trips: what the mutation wrote is what a reload renders", async () => {
    await runAction(
      saveForm({
        overLimitMessage: CUSTOM_MESSAGES.overLimit,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    const variables = updateVariables();
    const stored = (
      variables.validation as { metafields: Array<{ value: string }> }
    ).metafields[0].value;
    admin.setFixture("ValidationConfig", configResponse({ value: stored }));

    const state = await runLoader();

    expect(state.messages).toEqual(CUSTOM_MESSAGES);
  });

  it("trims before writing — surrounding whitespace is not merchant copy", async () => {
    await runAction(
      saveForm({
        overLimitMessage: `  ${CUSTOM_MESSAGES.overLimit}  `,
        overdueMessage: `\n${CUSTOM_MESSAGES.overdue}\n`,
      }),
    );

    expect(writtenConfig()).toEqual({
      v: 1,
      over_limit_message: CUSTOM_MESSAGES.overLimit,
      overdue_message: CUSTOM_MESSAGES.overdue,
    });
  });

  it("accepts a message of exactly 250 characters", async () => {
    const exact = "a".repeat(MAX_MESSAGE_LENGTH);

    const result = await runAction(
      saveForm({
        overLimitMessage: exact,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    expect(result.data.ok).toBe(true);
    expect(writtenConfig().over_limit_message).toBe(exact);
  });

  it("rejects 251 characters with a field error and issues NO mutation", async () => {
    const tooLong = "a".repeat(MAX_MESSAGE_LENGTH + 1);

    const result = await runAction(
      saveForm({
        overLimitMessage: tooLong,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    expect(result.data).toEqual({
      ok: false,
      code: "invalid",
      fieldErrors: { overLimit: MESSAGE_TOO_LONG_ERROR },
    });
    expect(statusOf(result)).toBe(422);
    expect(admin.callCount("UpdateValidationConfig")).toBe(0);
  });

  it("rejects an empty or whitespace-only message, per field, with no mutation", async () => {
    for (const [field, value] of [
      ["overLimitMessage", ""],
      ["overLimitMessage", "   \n  "],
      ["overdueMessage", ""],
    ] as const) {
      admin.reset();

      const result = await runAction(
        saveForm({
          overLimitMessage: CUSTOM_MESSAGES.overLimit,
          overdueMessage: CUSTOM_MESSAGES.overdue,
          [field]: value,
        }),
      );

      expect(result.data.ok).toBe(false);
      expect(result.data.code).toBe("invalid");
      expect(statusOf(result)).toBe(422);
      expect(admin.callCount("UpdateValidationConfig")).toBe(0);
    }
  });

  it("rejects a missing field rather than saving the string 'null'", async () => {
    const body = new FormData();
    body.append("intent", SAVE_MESSAGES_INTENT);
    body.append("overdueMessage", CUSTOM_MESSAGES.overdue);

    const result = await runAction(body);

    expect(result.data).toEqual({
      ok: false,
      code: "invalid",
      fieldErrors: { overLimit: MESSAGE_REQUIRED_ERROR },
    });
    expect(admin.callCount("UpdateValidationConfig")).toBe(0);
  });

  it("rejects non-string form values (a file part) with no mutation", async () => {
    const body = new FormData();
    body.append("intent", SAVE_MESSAGES_INTENT);
    body.append("overLimitMessage", new Blob(["over limit"]), "message.txt");
    body.append("overdueMessage", CUSTOM_MESSAGES.overdue);

    const result = await runAction(body);

    expect(result.data.ok).toBe(false);
    expect(result.data.code).toBe("invalid");
    expect(statusOf(result)).toBe(422);
    expect(admin.callCount("UpdateValidationConfig")).toBe(0);
  });

  it("rejects control characters — the checkout renders plain text", async () => {
    const withBell = `Over limit${String.fromCharCode(7)} call us`;

    const result = await runAction(
      saveForm({
        overLimitMessage: withBell,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    expect(result.data).toEqual({
      ok: false,
      code: "invalid",
      fieldErrors: { overLimit: MESSAGE_CONTROL_ERROR },
    });
    expect(admin.callCount("UpdateValidationConfig")).toBe(0);
  });

  it("keeps a deliberate line break — a textarea is a textarea", async () => {
    const twoLines = "Your credit limit is reached.\nCall Priya on 03 9000 1234.";

    const result = await runAction(
      saveForm({
        overLimitMessage: twoLines,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    expect(result.data.ok).toBe(true);
    expect(writtenConfig().over_limit_message).toBe(twoLines);
  });

  it("answers 400 to an unknown intent having written nothing", async () => {
    const body = new FormData();
    body.append("intent", "delete-everything");
    body.append("overLimitMessage", CUSTOM_MESSAGES.overLimit);
    body.append("overdueMessage", CUSTOM_MESSAGES.overdue);

    const result = await runAction(body);

    expect(result.data).toEqual({ ok: false, code: "unknown-intent" });
    expect(statusOf(result)).toBe(400);
    expect(admin.calls).toHaveLength(0);
  });

  it("answers 400 to a missing intent", async () => {
    const body = new FormData();
    body.append("overLimitMessage", CUSTOM_MESSAGES.overLimit);
    body.append("overdueMessage", CUSTOM_MESSAGES.overdue);

    const result = await runAction(body);

    expect(result.data).toEqual({ ok: false, code: "unknown-intent" });
    expect(statusOf(result)).toBe(400);
    expect(admin.calls).toHaveLength(0);
  });

  it("reports userErrors inside data as a FAILURE and captures them", async () => {
    admin.setFixture(
      "UpdateValidationConfig",
      updateResponse([
        {
          field: ["metafields", "0", "value"],
          message: "Value is invalid",
          code: "INVALID",
        },
      ]),
    );

    const result = await runAction(
      saveForm({
        overLimitMessage: CUSTOM_MESSAGES.overLimit,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    expect(result.data).toEqual({ ok: false, code: "save-failed" });
    expect(statusOf(result)).toBe(502);
    expect(captureException).toHaveBeenCalledTimes(1);
    const captured = captureException.mock.calls[0][0] as Error;
    expect(captured.message).toContain("UpdateValidationConfig userErrors");
    expect(captured.message).toContain("Value is invalid");
  });

  it("reports a transport failure as a save failure, never as success", async () => {
    admin.setFixture("UpdateValidationConfig", () => {
      throw new Error("socket hang up");
    });

    const result = await runAction(
      saveForm({
        overLimitMessage: CUSTOM_MESSAGES.overLimit,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    expect(result.data).toEqual({ ok: false, code: "save-failed" });
    expect(statusOf(result)).toBe(502);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("refuses to save when the shop has no Validation, and issues no mutation", async () => {
    await seedShop(SHOP, null);

    const result = await runAction(
      saveForm({
        overLimitMessage: CUSTOM_MESSAGES.overLimit,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    expect(result.data).toEqual({ ok: false, code: "unregistered" });
    expect(statusOf(result)).toBe(409);
    expect(admin.callCount("UpdateValidationConfig")).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Tenancy — T-04-14
 * ------------------------------------------------------------------ */

describe("shop scoping (T-04-14)", () => {
  it("addresses only the authenticated shop's own Validation on save", async () => {
    await runAction(
      saveForm({
        overLimitMessage: CUSTOM_MESSAGES.overLimit,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    expect(updateVariables().id).toBe(VALIDATION_GID);
    const everyId = admin.calls.map((call) => call.variables.id);
    expect(everyId).not.toContain(OTHER_VALIDATION_GID);
  });

  it("ignores a validation id smuggled in through the form body", async () => {
    await runAction(
      saveForm({
        overLimitMessage: CUSTOM_MESSAGES.overLimit,
        overdueMessage: CUSTOM_MESSAGES.overdue,
        id: OTHER_VALIDATION_GID,
        validationGid: OTHER_VALIDATION_GID,
      }),
    );

    expect(updateVariables().id).toBe(VALIDATION_GID);
  });

  it("follows the session when the authenticated shop changes", async () => {
    authenticateAdmin.mockResolvedValue({ session: { shop: OTHER_SHOP } });

    await runAction(
      saveForm({
        overLimitMessage: CUSTOM_MESSAGES.overLimit,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    expect(updateVariables().id).toBe(OTHER_VALIDATION_GID);
  });

  it("reads only the authenticated shop's Validation on load", async () => {
    await runLoader();

    expect(admin.callsFor("ValidationConfig")[0].variables).toEqual({
      id: VALIDATION_GID,
    });
  });
});

/* ------------------------------------------------------------------ *
 * Contract guards
 * ------------------------------------------------------------------ */

describe("settings contracts", () => {
  it("keeps the 250-char cap in lockstep with the Function's own guard", () => {
    const functionSource = sourceWithoutComments(
      "extensions/credit-guard-validation/src/cart_validations_generate_run.ts",
    );
    // Stripper sanity: a blanked file would make `matched` null, but be
    // explicit that we are looking at real code, not an empty string.
    expect(functionSource).toContain("export function cartValidationsGenerateRun");
    const matched = /MAX_MESSAGE_LENGTH\s*=\s*(\d+)/.exec(functionSource);

    expect(matched).not.toBeNull();
    // The server accepts exactly what the wasm accepts. A wider server cap
    // would let a merchant save copy the Function then silently replaces with
    // the default.
    expect(Number(matched?.[1])).toBe(MAX_MESSAGE_LENGTH);
  });

  /**
   * MEASURED ON THE LIVE STORE, 2026-08-20 (plan 04-05).
   *
   * `validationUpdate` is NOT a partial update. An input carrying only
   * `metafields` — which is what this app sent until this commit — came back
   * with `userErrors: []` and SILENTLY SET `enabled` FROM true TO false on
   * credit-guard-demo. Read back through
   * `scripts/prod-validation-state.sh`: `enabled: true` at 05:16Z, one
   * metafields-only update at 05:23Z, `enabled: false` at 05:24Z.
   *
   * So every merchant message edit turned that merchant's checkout enforcement
   * OFF. The omission was a deliberate 04-04 decision ("writing `enable` would
   * let a copy edit silently re-enable a merchant-disabled rule") whose premise
   * — that an omitted field is left alone — the platform does not honour.
   *
   * The fix keeps the ORIGINAL intent and inverts the mechanism: read the
   * current flags and ECHO them. The rule ends an edit in exactly the state it
   * started, on or off, because that state is now stated rather than assumed.
   */
  it("never re-enables a merchant-disabled rule on a copy edit", async () => {
    admin.setFixture(
      "ValidationConfig",
      configResponse({ enabled: false, value: buildConfigValue(DEFAULT_MESSAGES) }),
    );

    await runAction(
      saveForm({
        overLimitMessage: CUSTOM_MESSAGES.overLimit,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    const validation = updateVariables().validation as Record<string, unknown>;
    expect(validation.enable).toBe(false);
  });

  it("never DISABLES an enabled rule on a copy edit — the live 04-05 regression", async () => {
    admin.setFixture(
      "ValidationConfig",
      configResponse({ enabled: true, value: buildConfigValue(DEFAULT_MESSAGES) }),
    );

    await runAction(
      saveForm({
        overLimitMessage: CUSTOM_MESSAGES.overLimit,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    const validation = updateVariables().validation as Record<string, unknown>;
    // The literal true, present in the input. An ABSENT key is the bug.
    expect(validation.enable).toBe(true);
    expect(Object.keys(validation)).toEqual([
      "enable",
      "blockOnFailure",
      "metafields",
    ]);
  });

  it("echoes blockOnFailure rather than letting the platform re-default it", async () => {
    admin.setFixture(
      "ValidationConfig",
      configResponse({
        enabled: true,
        blockOnFailure: true,
        value: buildConfigValue(DEFAULT_MESSAGES),
      }),
    );

    await runAction(
      saveForm({
        overLimitMessage: CUSTOM_MESSAGES.overLimit,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    // Whatever the platform holds is what it keeps. Copy edits are not the
    // place to move the ENFC-04 fail-open flag in EITHER direction; the app
    // pins `false` exactly once, at registration, where it owns the decision.
    expect((updateVariables().validation as Record<string, unknown>).blockOnFailure).toBe(
      true,
    );
  });

  it("defaults blockOnFailure to FALSE when the platform does not report it", async () => {
    admin.setFixture("ValidationConfig", {
      data: {
        validation: {
          id: VALIDATION_GID,
          enabled: true,
          metafield: { value: buildConfigValue(DEFAULT_MESSAGES) },
        },
      },
    });

    await runAction(
      saveForm({
        overLimitMessage: CUSTOM_MESSAGES.overLimit,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    // Never `undefined` on the wire: an absent key is what caused the live
    // regression, so the fail-open value (ENFC-04) is the only safe stand-in.
    expect((updateVariables().validation as Record<string, unknown>).blockOnFailure).toBe(
      false,
    );
  });

  it("writes NOTHING when the current flags cannot be read", async () => {
    admin.setFixture("ValidationConfig", () => {
      throw new Error("boom");
    });

    const result = await runAction(
      saveForm({
        overLimitMessage: CUSTOM_MESSAGES.overLimit,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    // Writing blind is how the rule gets disabled. A read failure is a save
    // failure, reported to the merchant with their text still on screen.
    expect(admin.callCount("UpdateValidationConfig")).toBe(0);
    expect(statusOf(result)).toBe(502);
  });

  it("reports unregistered — and writes nothing — when the rule was deleted", async () => {
    admin.setFixture("ValidationConfig", configResponse({ missing: true }));

    await runAction(
      saveForm({
        overLimitMessage: CUSTOM_MESSAGES.overLimit,
        overdueMessage: CUSTOM_MESSAGES.overdue,
      }),
    );

    expect(admin.callCount("UpdateValidationConfig")).toBe(0);
  });

  it("uses no @shopify/polaris React imports", () => {
    const source = sourceWithoutComments("app/routes/app.settings.tsx");

    // Stripper sanity: a blanked file satisfies any `not.toContain`.
    expect(source).toContain("export default function");
    expect(source).not.toContain("@shopify/polaris");
  });

  it("names the three honest states distinctly and never says 'protected'", () => {
    const headings = [
      STATUS_ACTIVE_HEADING,
      STATUS_DISABLED_HEADING,
      STATUS_UNREGISTERED_HEADING,
    ];

    expect(new Set(headings).size).toBe(3);
    for (const copy of [...headings, PAGE_INTRO, OVER_LIMIT_LABEL, OVERDUE_LABEL]) {
      expect(copy.toLowerCase()).not.toContain("protected");
    }
    // The disabled state must say so in the merchant's own vocabulary.
    expect(STATUS_DISABLED_HEADING.toLowerCase()).toContain("turned off");
  });

  it("maps every rejection reason to a merchant-readable sentence", () => {
    expect(fieldErrorFor("too-long")).toBe(MESSAGE_TOO_LONG_ERROR);
    expect(fieldErrorFor("control")).toBe(MESSAGE_CONTROL_ERROR);
    expect(fieldErrorFor("empty")).toBe(MESSAGE_REQUIRED_ERROR);
    expect(fieldErrorFor("not-a-string")).toBe(MESSAGE_REQUIRED_ERROR);
    expect(MESSAGES_SAVED_TOAST.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * Payment reminders (REMD-01 / D5-02) — the enablement gate
 *
 * The switch on this page is the only thing standing between a quiet app and
 * every net-terms buyer on the store receiving email. So these specs are not
 * really about a boolean: they are about who may flip it (the session shop and
 * nobody else), what the flip means to the sweep (the watermark), and the fact
 * that an app nobody switched on writes no timestamp at all.
 * ------------------------------------------------------------------ */

const {
  REMINDERS_DISABLE_INTENT,
  REMINDERS_DISABLED_TOAST,
  REMINDERS_DUPLICATE_BODY,
  REMINDERS_DUPLICATE_HEADING,
  REMINDERS_ENABLE_INTENT,
  REMINDERS_ENABLED_TOAST,
  REMINDERS_MOMENTS_BODY,
  REMINDERS_OFF_STATUS,
  REMINDERS_ONE_PER_DAY_BODY,
  REMINDERS_RECIPIENT_BODY,
  REMINDERS_SECTION_HEADING,
  REMINDERS_TEMPLATE_BODY,
  REMINDERS_WATERMARK_BODY,
  remindersOnStatus,
} = await routeModule();

async function watermarkOf(domain: string): Promise<Date | null> {
  const row = await prisma.shop.findUnique({ where: { domain } });
  return row?.remindersEnabledAt ?? null;
}

function remindersForm(
  intent: string,
  extra: Record<string, string> = {},
): FormData {
  const body = new FormData();
  body.append("intent", intent);
  for (const [key, value] of Object.entries(extra)) body.append(key, value);
  return body;
}

describe("payment reminders toggle (REMD-01, D5-02)", () => {
  it("is off for a freshly seeded shop — the default is NULL, never a date", async () => {
    expect(await watermarkOf(SHOP)).toBeNull();
    expect(await watermarkOf(OTHER_SHOP)).toBeNull();
  });

  it("stamps the watermark at ~now when the merchant turns reminders on", async () => {
    const before = Date.now();
    const result = await runAction(remindersForm(REMINDERS_ENABLE_INTENT));
    const after = Date.now();

    expect(result.data).toEqual({ ok: true, intent: REMINDERS_ENABLE_INTENT });
    expect(statusOf(result)).toBe(200);

    const stamped = await watermarkOf(SHOP);
    expect(stamped).toBeInstanceOf(Date);
    expect(stamped!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    expect(stamped!.getTime()).toBeLessThanOrEqual(after + 1_000);
  });

  it("flips the switch with NO Admin API traffic at all", async () => {
    await runAction(remindersForm(REMINDERS_ENABLE_INTENT));

    // Enabling is a local decision about a local column. If this ever starts
    // calling Shopify, something is sending on the merchant's behalf at the
    // very moment they opt in — the install blast this design exists to stop.
    expect(admin.calls).toHaveLength(0);
  });

  it("nulls the watermark when the merchant turns reminders off", async () => {
    await runAction(remindersForm(REMINDERS_ENABLE_INTENT));

    const result = await runAction(remindersForm(REMINDERS_DISABLE_INTENT));

    expect(result.data).toEqual({ ok: true, intent: REMINDERS_DISABLE_INTENT });
    expect(statusOf(result)).toBe(200);
    expect(await watermarkOf(SHOP)).toBeNull();
  });

  it("moves the watermark FORWARD on re-enable — the off window stays suppressed", async () => {
    await runAction(remindersForm(REMINDERS_ENABLE_INTENT));
    const first = await watermarkOf(SHOP);

    await runAction(remindersForm(REMINDERS_DISABLE_INTENT));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await runAction(remindersForm(REMINDERS_ENABLE_INTENT));
    const second = await watermarkOf(SHOP);

    // D5-02, deliberately: every moment crossed while reminders were off sits
    // behind the NEW watermark and is never chased. Preserving the original
    // timestamp would dun the entire off-window the instant a merchant
    // changed their mind.
    expect(second!.getTime()).toBeGreaterThan(first!.getTime());
  });

  it("touches only the authenticated shop's row", async () => {
    await runAction(remindersForm(REMINDERS_ENABLE_INTENT));

    expect(await watermarkOf(SHOP)).toBeInstanceOf(Date);
    expect(await watermarkOf(OTHER_SHOP)).toBeNull();
  });

  it("ignores a shop smuggled in through the form body (T-05-11)", async () => {
    await runAction(
      remindersForm(REMINDERS_ENABLE_INTENT, {
        shop: OTHER_SHOP,
        domain: OTHER_SHOP,
      }),
    );

    expect(await watermarkOf(SHOP)).toBeInstanceOf(Date);
    expect(await watermarkOf(OTHER_SHOP)).toBeNull();
  });

  it("follows the session when the authenticated shop changes", async () => {
    authenticateAdmin.mockResolvedValue({ session: { shop: OTHER_SHOP } });

    await runAction(remindersForm(REMINDERS_ENABLE_INTENT));

    expect(await watermarkOf(OTHER_SHOP)).toBeInstanceOf(Date);
    expect(await watermarkOf(SHOP)).toBeNull();
  });

  it("answers 400 to a near-miss intent having moved no watermark (T-05-12)", async () => {
    await runAction(remindersForm(REMINDERS_ENABLE_INTENT));
    const enabled = await watermarkOf(SHOP);

    const result = await runAction(remindersForm("enable-reminders-now"));

    expect(result.data).toEqual({ ok: false, code: "unknown-intent" });
    expect(statusOf(result)).toBe(400);
    expect((await watermarkOf(SHOP))!.getTime()).toBe(enabled!.getTime());
  });

  it("reports a write failure instead of toasting over a switch that never moved", async () => {
    // No row to update: the merchant must see a failure, not a success toast
    // over an unchanged column (the T-04-15 discipline applied to this switch).
    await prisma.shop.deleteMany({ where: { domain: SHOP } });

    const result = await runAction(remindersForm(REMINDERS_ENABLE_INTENT));

    expect(result.data).toEqual({ ok: false, code: "save-failed" });
    expect(statusOf(result)).toBe(502);
  });
});

describe("payment reminders loader exposure (honest status)", () => {
  it("reports null while reminders are off", async () => {
    const state = await runLoader();

    expect(state.remindersEnabledAt).toBeNull();
  });

  it("reports the enable moment once reminders are on", async () => {
    await runAction(remindersForm(REMINDERS_ENABLE_INTENT));

    const state = await runLoader();
    const stored = await watermarkOf(SHOP);

    expect(state.remindersEnabledAt).not.toBeNull();
    expect(new Date(state.remindersEnabledAt!).getTime()).toBe(stored!.getTime());
  });

  it("reads the COLUMN, not an inferred flag", async () => {
    // Written behind the route's back: the page reports what the sweep will
    // actually read, so a value this route never stamped still shows.
    const injected = new Date("2026-08-01T02:03:04.000Z");
    await prisma.shop.update({
      where: { domain: SHOP },
      data: { remindersEnabledAt: injected },
    });

    const state = await runLoader();

    expect(new Date(state.remindersEnabledAt!).getTime()).toBe(injected.getTime());
  });

  it("still answers when the shop row is missing entirely", async () => {
    await prisma.shop.deleteMany({ where: { domain: SHOP } });

    const state = await runLoader();

    expect(state.remindersEnabledAt).toBeNull();
  });
});

describe("payment reminders copy (D5-05, N1, N2)", () => {
  const everyLine = () => [
    REMINDERS_SECTION_HEADING,
    REMINDERS_OFF_STATUS,
    REMINDERS_MOMENTS_BODY,
    REMINDERS_WATERMARK_BODY,
    REMINDERS_DUPLICATE_HEADING,
    REMINDERS_DUPLICATE_BODY,
    REMINDERS_ONE_PER_DAY_BODY,
    REMINDERS_RECIPIENT_BODY,
    REMINDERS_TEMPLATE_BODY,
  ];

  it("never claims protection over a state the app cannot confirm", () => {
    for (const copy of everyLine()) {
      expect(copy.toLowerCase()).not.toContain("protected");
      expect(copy.toLowerCase()).not.toContain("guaranteed");
    }
  });

  it("says plainly that nothing is emailed until the merchant opts in", () => {
    expect(REMINDERS_OFF_STATUS.toLowerCase()).toContain("off");
    expect(REMINDERS_OFF_STATUS.toLowerCase()).toContain("never emails");
  });

  it("dates the ON status from the watermark rather than asserting a vague 'active'", () => {
    const line = remindersOnStatus("12 August 2026");

    expect(line).toContain("12 August 2026");
    expect(line.toLowerCase()).toContain("on since");
  });

  it("explains the watermark: older overdue invoices are not chased (D5-02)", () => {
    const body = REMINDERS_WATERMARK_BODY.toLowerCase();

    expect(body).toContain("after you turn this on");
    expect(body).toContain("older overdue invoices");
  });

  it("names the three moments and credits Shopify as the sender (D5-03/D5-04)", () => {
    const body = REMINDERS_MOMENTS_BODY.toLowerCase();

    expect(body).toContain("shopify");
    expect(body).toContain("3 days before");
    expect(body).toContain("due date");
    expect(body).toContain("3 days after");
    // Never chasing an invoice that is already paid is the promise a merchant
    // most needs to hear before flipping this on.
    expect(body).toContain("paid");
  });

  it("states the company-only eligibility limit plainly (WINDOWS #22)", () => {
    // The old line said "each unpaid invoice is chased", which is false:
    // eligibleSchedules requires ATTRIBUTED + a company. A merchant who
    // believed it would wait for reminders that were never coming — an App
    // Store 4.3 truthfulness exposure, not a documentation gap.
    const body = REMINDERS_MOMENTS_BODY.toLowerCase();

    expect(body).toContain("attributed to a company");
    expect(body).toContain("no purchasing company");
    // And the overstatement itself is gone.
    expect(body).not.toContain("each unpaid invoice is chased");
  });

  it("composes the cadence from the shared constant, byte for byte (UI-SPEC R2)", () => {
    // Not "says the same thing" — CONTAINS the shared string. Two literals
    // that match today are two literals that drift the first time one is
    // edited, and a merchant reading two cadences on two screens trusts
    // neither.
    expect(REMINDERS_MOMENTS_BODY).toContain(REMINDERS_CADENCE);
    expect(REMINDERS_CADENCE).toBe(
      "3 days before the due date, on the due date, and 3 days after",
    );
  });

  it("keeps app/reminder-copy.ts import-free so any route can compose from it (04-04)", () => {
    // The 04-04 build trap: an import here is inherited by every route that
    // composes from this module, and a transitively server-only import
    // typechecks, passes every unit test, and only fails at `react-router
    // build`. Comments are stripped so the guard reacts to CODE only.
    const source = sourceWithoutComments("app/reminder-copy.ts");

    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });

  it("warns about Shopify's own reminders AND gives E5's measured default (D5-05)", () => {
    const body = REMINDERS_DUPLICATE_BODY.toLowerCase();

    expect(body).toContain("settings > notifications");
    // Measured in 05-02, not assumed: native reminders are off until a
    // merchant configures them.
    expect(body).toContain("off until");
    expect(body).toContain("two emails");
    expect(body).toContain("one");
  });

  it("states the one-reminder-per-order-per-day platform limit (N1)", () => {
    const body = REMINDERS_ONE_PER_DAY_BODY.toLowerCase();

    expect(body).toContain("one payment reminder per order per day");
    expect(body).toContain("next day");
  });

  it("warns that correcting a contact's email does not redirect existing orders (N2)", () => {
    const body = REMINDERS_RECIPIENT_BODY.toLowerCase();

    expect(body).toContain("when the order is created");
    expect(body).toContain("old address");
    expect(body).toContain("new orders");
  });

  it("points template editing at the Shopify admin and describes both due states", () => {
    const body = REMINDERS_TEMPLATE_BODY.toLowerCase();

    expect(body).toContain("payment reminder");
    expect(body).toContain("settings > notifications");
    expect(body).toContain("not in this app");
    // The addendum's measured branches, in merchant words.
    expect(body).toContain("due in");
    expect(body).toContain("overdue");
    expect(body).toContain("preview");
  });

  it("keeps the two toasts distinct and honest", () => {
    expect(REMINDERS_ENABLED_TOAST).not.toBe(REMINDERS_DISABLED_TOAST);
    expect(REMINDERS_ENABLED_TOAST.length).toBeGreaterThan(0);
    expect(REMINDERS_DISABLED_TOAST.length).toBeGreaterThan(0);
  });

  it("does not import the reminders service — 05-03 owns that file this wave", () => {
    const source = sourceWithoutComments("app/routes/app.settings.tsx");

    // Stripper sanity: a blanked file satisfies any `not.toContain`.
    expect(source).toContain("export default function");
    expect(source).not.toContain("reminders.server");
  });
});
