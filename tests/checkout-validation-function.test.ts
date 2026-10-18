import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { CartValidationsGenerateRunInput } from "../extensions/credit-guard-validation/generated/api";
import { run } from "../extensions/credit-guard-validation/src/cart_validations_generate_run";

/**
 * Checkout enforcement — the comparator that decides whether a real B2B buyer
 * can complete checkout. A false block here is instant-uninstall territory and
 * a false allow silently sells the app's only promise, so every branch is
 * pinned rather than sampled.
 *
 * FIXTURE PROVENANCE. Functions build as a separate workspace and cannot import
 * app server code, so the server<->Function contract is carried by the
 * BYTE-EXACT serialized strings locked in tests/metafield-contract.test.ts, not
 * by a shared import. Every payload below is `JSON.parse`d from one of those
 * two strings and then given targeted field overrides — never hand-rolled as an
 * object literal, because a hand-rolled literal would happily disagree with
 * what the publisher actually writes and no test would notice.
 */

/**
 * Byte-exact from tests/metafield-contract.test.ts — "a set limit serializes as
 * a 2dp decimal string". Changing a character here without changing it there is
 * a silent contract fork.
 */
const CONTRACT_FULL =
  '{"v":1,"limit":"5000.00","exposure":"1874.95","currency":"USD",' +
  '"overdue":false,"bypass":false,"data_complete":true,' +
  '"computed_at":"2026-08-19T22:10:00.000Z"}';

/**
 * Byte-exact from tests/metafield-contract.test.ts — "zero-order company
 * publishes a COMPLETE payload". Payload law rule 5: a null currency can only
 * co-occur with exposure "0.00" (the shop has no ledger rows at all).
 */
const CONTRACT_ZERO_ORDER =
  '{"v":1,"limit":null,"exposure":"0.00","currency":null,' +
  '"overdue":false,"bypass":false,"data_complete":true,' +
  '"computed_at":"2026-08-19T22:10:00.000Z"}';

type Json = Record<string, unknown>;

function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Apply overrides to a contract-parsed payload, refusing any override that
 * silently changes a field's JSON type or invents a field the contract does not
 * have. Type changes ARE sometimes the point (the malformed-payload matrix rows
 * exist to test exactly that) — those must be declared in `retypes`, so a
 * deliberate contract violation is visible in the test source instead of
 * hiding inside an object literal.
 */
function payloadFrom(
  contractBytes: string,
  overrides: Json = {},
  retypes: string[] = [],
): Json {
  const payload = JSON.parse(contractBytes) as Json;
  for (const [field, value] of Object.entries(overrides)) {
    if (retypes.includes(field)) {
      payload[field] = value;
      continue;
    }
    if (!(field in payload)) {
      throw new Error(
        `override "${field}" is not a credit_v1 field — declare it in retypes if that is deliberate`,
      );
    }
    if (jsonTypeOf(value) !== jsonTypeOf(payload[field])) {
      throw new Error(
        `override "${field}" changes JSON type ${jsonTypeOf(payload[field])} -> ${jsonTypeOf(value)} — declare it in retypes if that is deliberate`,
      );
    }
    payload[field] = value;
  }
  return payload;
}

function withoutField(payload: Json, field: string): Json {
  const copy = { ...payload };
  delete copy[field];
  return copy;
}

/** Shaped exactly like the input query result in src/cart_validations_generate_run.graphql. */
function cartInput(options: {
  payload?: unknown;
  hasCompany?: boolean;
  cartAmount?: string;
  currencyCode?: string;
  config?: unknown;
}): CartValidationsGenerateRunInput {
  const {
    payload,
    hasCompany = true,
    cartAmount = "100.00",
    currencyCode = "USD",
    config = null,
  } = options;
  return {
    cart: {
      cost: { totalAmount: { amount: cartAmount, currencyCode } },
      buyerIdentity: {
        purchasingCompany: hasCompany
          ? {
              company: {
                id: "gid://shopify/Company/1",
                metafield: payload === undefined ? null : { jsonValue: payload },
              },
            }
          : null,
      },
    },
    validation: { metafield: config === null ? null : { jsonValue: config } },
    // One cast, at the boundary: `currencyCode` is a generated string enum and
    // these tests deliberately feed it plain currency strings (and deliberately
    // malformed payloads elsewhere). Casting here keeps every call site typed.
  } as CartValidationsGenerateRunInput;
}

const ALLOW = { operations: [] };

function blockedMessage(result: ReturnType<typeof run>): string {
  expect(result.operations).toHaveLength(1);
  const errors = result.operations[0].validationAdd.errors;
  expect(errors).toHaveLength(1);
  expect(errors[0].target).toBe("$.cart");
  return errors[0].message;
}

/**
 * The three live shapes observed on the demo store in Phase 3 — the payloads
 * this function will actually meet first.
 */
const NORTHWIND = payloadFrom(CONTRACT_FULL, {
  limit: "1500.00",
  exposure: "1874.95",
});
const ACME_BYPASSED = payloadFrom(CONTRACT_FULL, {
  limit: "2000.00",
  exposure: "3100.00",
  overdue: true,
  bypass: true,
});
const SNOWDEVIL_OBSERVE_ONLY = payloadFrom(CONTRACT_ZERO_ORDER);

const DEFAULT_OVER_LIMIT =
  "Your company has reached its credit limit with us. To place this order, please contact us or settle open invoices to free up available credit.";
const DEFAULT_OVERDUE =
  "Your account has overdue invoices. New orders on payment terms are paused until the balance is settled — please contact us to arrange payment.";

describe("run — the three live payload shapes", () => {
  it("Northwind (limit 1500.00, exposure 1874.95) blocks a 100.00 USD cart at $.cart (ENFC-01, D4-01)", () => {
    expect(blockedMessage(run(cartInput({ payload: NORTHWIND })))).toBe(DEFAULT_OVER_LIMIT);
  });

  it("Acme (overdue AND over limit) is allowed because the merchant flipped bypass (matrix row 6, D-03)", () => {
    expect(run(cartInput({ payload: ACME_BYPASSED }))).toEqual(ALLOW);
  });

  it("Snowdevil (zero-order, limit null) is observe-only against any cart (matrix row 7, CRED-04)", () => {
    expect(
      run(cartInput({ payload: SNOWDEVIL_OBSERVE_ONLY, cartAmount: "99999.00" })),
    ).toEqual(ALLOW);
  });
});

describe("run — fail-open matrix (ENFC-04)", () => {
  it("row 1: no purchasing company (D2C) is never touched", () => {
    expect(run(cartInput({ hasCompany: false }))).toEqual(ALLOW);
  });

  it("row 2: credit_v1 never published (metafield null) allows", () => {
    expect(run(cartInput({ payload: undefined }))).toEqual(ALLOW);
  });

  it.each([
    ["a bare string", "not-a-payload"],
    ["a number", 42],
    ["a boolean", true],
    ["an array", []],
    ["null", null],
  ])("row 3: jsonValue is %s, not an object -> allow", (_label, jsonValue) => {
    expect(run(cartInput({ payload: jsonValue }))).toEqual(ALLOW);
  });

  it("row 3: `overdue` missing entirely -> allow", () => {
    expect(run(cartInput({ payload: withoutField(NORTHWIND, "overdue") }))).toEqual(ALLOW);
  });

  it("row 3: `bypass` missing entirely -> allow", () => {
    expect(run(cartInput({ payload: withoutField(NORTHWIND, "bypass") }))).toEqual(ALLOW);
  });

  it("row 3: `bypass` as the STRING \"false\" is not a boolean -> allow (never coerced)", () => {
    const payload = payloadFrom(CONTRACT_FULL, { limit: "1500.00", exposure: "1874.95", bypass: "false" }, ["bypass"]);
    expect(run(cartInput({ payload }))).toEqual(ALLOW);
  });

  it("row 3: limit \"5000\" is 0dp, not the contract's 2dp grammar -> allow", () => {
    const payload = payloadFrom(CONTRACT_FULL, { limit: "5000", exposure: "99999.00" });
    expect(run(cartInput({ payload }))).toEqual(ALLOW);
  });

  it("row 3: exposure \"12.345\" is 3dp, not the contract's 2dp grammar -> allow", () => {
    const payload = payloadFrom(CONTRACT_FULL, { limit: "1.00", exposure: "12.345" });
    expect(run(cartInput({ payload }))).toEqual(ALLOW);
  });

  it("row 3: a negative limit is nonsense the publisher cannot produce -> allow", () => {
    const payload = payloadFrom(CONTRACT_FULL, { limit: "-100.00", exposure: "0.00" });
    expect(run(cartInput({ payload }))).toEqual(ALLOW);
  });

  it("row 4: v: 2 is a payload this reader predates -> allow", () => {
    const payload = payloadFrom(CONTRACT_FULL, { v: 2, limit: "1500.00", exposure: "1874.95" });
    expect(run(cartInput({ payload }))).toEqual(ALLOW);
  });

  it("row 5: data_complete false ENFORCES normally — understated exposure can only under-block (D-04)", () => {
    const payload = payloadFrom(CONTRACT_FULL, {
      limit: "1500.00",
      exposure: "1874.95",
      data_complete: false,
    });
    expect(blockedMessage(run(cartInput({ payload })))).toBe(DEFAULT_OVER_LIMIT);
  });

  it("row 6: bypass outranks BOTH rules and is checked first (D-03)", () => {
    const payload = payloadFrom(CONTRACT_FULL, {
      limit: "0.00",
      exposure: "99999.00",
      overdue: true,
      bypass: true,
    });
    expect(run(cartInput({ payload }))).toEqual(ALLOW);
  });

  it("row 7: limit null exempts the OVERDUE rule too — an unconfigured company is never surprise-blocked", () => {
    const payload = payloadFrom(CONTRACT_FULL, { limit: null, overdue: true }, ["limit"]);
    expect(run(cartInput({ payload }))).toEqual(ALLOW);
  });

  it("row 7: an absent limit key is indistinguishable from unconfigured -> allow, even overdue", () => {
    const payload = withoutField(payloadFrom(CONTRACT_FULL, { overdue: true }), "limit");
    expect(run(cartInput({ payload }))).toEqual(ALLOW);
  });

  it("row 8: currency mismatch skips the LIMIT rule (D4-02, never converts)", () => {
    expect(run(cartInput({ payload: NORTHWIND, currencyCode: "EUR" }))).toEqual(ALLOW);
  });

  it("row 8: currency mismatch does NOT skip the OVERDUE rule — it is a boolean", () => {
    const payload = payloadFrom(CONTRACT_FULL, {
      limit: "1500.00",
      exposure: "1874.95",
      overdue: true,
    });
    expect(blockedMessage(run(cartInput({ payload, currencyCode: "EUR" })))).toBe(DEFAULT_OVERDUE);
  });

  it("row 8: a non-string currency in the payload skips the limit rule too", () => {
    const payload = payloadFrom(CONTRACT_FULL, { limit: "1500.00", exposure: "1874.95", currency: null }, ["currency"]);
    expect(run(cartInput({ payload }))).toEqual(ALLOW);
  });

  it("row 9: an input whose every property access throws still allows (throw-proof)", () => {
    const exploding = new Proxy(
      {},
      {
        get() {
          throw new Error("simulated runtime failure");
        },
      },
    );
    expect(run(exploding as never)).toEqual(ALLOW);
  });

  it("row 9: a throw from deep inside the input (metafield getter) still allows", () => {
    const input = cartInput({ payload: NORTHWIND });
    Object.defineProperty(input.cart.buyerIdentity!.purchasingCompany!.company, "metafield", {
      get() {
        throw new Error("simulated runtime failure");
      },
    });
    expect(run(input)).toEqual(ALLOW);
  });

  it("row 9: a malformed cart amount allows rather than blocking", () => {
    expect(run(cartInput({ payload: NORTHWIND, cartAmount: "one hundred" }))).toEqual(ALLOW);
  });
});

/**
 * F-01. Fail-open is PER RULE, not per payload. These two are the pin: reverting
 * to the research skeleton's grammar-before-overdue order turns the first red
 * while leaving the second green, which is exactly the regression to catch.
 */
describe("run — F-01: a garbage limit must not silence the overdue rule", () => {
  it("limit \"not-money\" + overdue true on a CONFIGURED company still blocks, with the overdue message", () => {
    const payload = payloadFrom(CONTRACT_FULL, { limit: "not-money", exposure: "1874.95", overdue: true });
    expect(blockedMessage(run(cartInput({ payload })))).toBe(DEFAULT_OVERDUE);
  });

  it("the same garbage limit with overdue false allows — the LIMIT rule alone fails open", () => {
    const payload = payloadFrom(CONTRACT_FULL, { limit: "not-money", exposure: "1874.95" });
    expect(run(cartInput({ payload }))).toEqual(ALLOW);
  });
});

/**
 * F-02. `limit: "0.00"` is the merchant's deliberate block-all switch and is
 * byte-distinct from `limit: null` (D-02). Zero remaining credit is exceeded in
 * every currency, so this one case skips the currency gate — otherwise the
 * legal `currency: null` zero-order payload would silently disarm it.
 */
describe("run — F-02: block-all is currency-independent, a non-zero limit is not", () => {
  it("limit \"0.00\" with currency null (the legal zero-order payload) still blocks a positive cart", () => {
    const payload = payloadFrom(CONTRACT_ZERO_ORDER, { limit: "0.00" }, ["limit"]);
    expect(blockedMessage(run(cartInput({ payload, cartAmount: "1.00" })))).toBe(DEFAULT_OVER_LIMIT);
  });

  it("limit \"0.00\" with a matching currency blocks (the ordinary block-all path)", () => {
    const payload = payloadFrom(CONTRACT_FULL, { limit: "0.00", exposure: "0.00" });
    expect(blockedMessage(run(cartInput({ payload })))).toBe(DEFAULT_OVER_LIMIT);
  });

  it("a NON-zero limit with currency null keeps the D4-02 skip and allows", () => {
    const payload = payloadFrom(
      CONTRACT_FULL,
      { limit: "1500.00", exposure: "1874.95", currency: null },
      ["currency"],
    );
    expect(run(cartInput({ payload }))).toEqual(ALLOW);
  });

  it("limit \"0.00\" and limit null are opposite verdicts on identical carts (D-02)", () => {
    const blockAll = payloadFrom(CONTRACT_ZERO_ORDER, { limit: "0.00" }, ["limit"]);
    const observeOnly = payloadFrom(CONTRACT_ZERO_ORDER);
    expect(run(cartInput({ payload: blockAll })).operations).toHaveLength(1);
    expect(run(cartInput({ payload: observeOnly }))).toEqual(ALLOW);
  });

  it("block-all does not block a zero-value cart — nothing exceeds zero remaining credit", () => {
    const payload = payloadFrom(CONTRACT_ZERO_ORDER, { limit: "0.00" }, ["limit"]);
    expect(run(cartInput({ payload, cartAmount: "0.00" }))).toEqual(ALLOW);
  });
});

describe("run — D4-01 remaining-credit arithmetic (integer cents, never float)", () => {
  it("at-limit exactly is ALLOWED: 1400.00 + 100.00 == 1500.00", () => {
    const payload = payloadFrom(CONTRACT_FULL, { limit: "1500.00", exposure: "1400.00" });
    expect(run(cartInput({ payload, cartAmount: "100.00" }))).toEqual(ALLOW);
  });

  it("one cent past the limit BLOCKS: 1400.00 + 100.01 > 1500.00", () => {
    const payload = payloadFrom(CONTRACT_FULL, { limit: "1500.00", exposure: "1400.00" });
    expect(blockedMessage(run(cartInput({ payload, cartAmount: "100.01" })))).toBe(DEFAULT_OVER_LIMIT);
  });

  it("float trap: limit 0.10, exposure 0.00, cart 0.10 allows (0.1 + 0.2 territory)", () => {
    const payload = payloadFrom(CONTRACT_FULL, { limit: "0.10", exposure: "0.00" });
    expect(run(cartInput({ payload, cartAmount: "0.10" }))).toEqual(ALLOW);
  });

  it("negative exposure (refund history) counts as available credit, not as debt", () => {
    const payload = payloadFrom(CONTRACT_FULL, { limit: "100.00", exposure: "-50.00" });
    expect(run(cartInput({ payload, cartAmount: "120.00" }))).toEqual(ALLOW);
  });

  it("negative exposure still blocks once the cart clears the remaining credit", () => {
    const payload = payloadFrom(CONTRACT_FULL, { limit: "100.00", exposure: "-50.00" });
    expect(blockedMessage(run(cartInput({ payload, cartAmount: "150.01" })))).toBe(DEFAULT_OVER_LIMIT);
  });
});

describe("run — cart amount normalization (Shopify sends an unknown decimal width)", () => {
  const atLimit = payloadFrom(CONTRACT_FULL, { limit: "1500.00", exposure: "1400.00" });

  it("0dp: cart \"100\" is one hundred dollars, not one dollar (sum == limit -> allow)", () => {
    expect(run(cartInput({ payload: atLimit, cartAmount: "100" }))).toEqual(ALLOW);
  });

  it("1dp: cart \"100.5\" is 100.50, not 100.05 (one cent over -> block)", () => {
    expect(blockedMessage(run(cartInput({ payload: atLimit, cartAmount: "100.5" })))).toBe(
      DEFAULT_OVER_LIMIT,
    );
  });

  it("3dp: cart \"100.999\" TRUNCATES to 100.99 rather than rounding up to 101.00", () => {
    // Limit sits exactly at the truncated sum. Rounding up would tip it over and
    // block — truncation is deliberate, because a cheaper cart can only under-block.
    const payload = payloadFrom(CONTRACT_FULL, { limit: "1500.99", exposure: "1400.00" });
    expect(run(cartInput({ payload, cartAmount: "100.999" }))).toEqual(ALLOW);
  });
});

describe("run — computed_at is informational only (the wasm has no clock)", () => {
  it("a year-old computed_at does not weaken a block", () => {
    const payload = payloadFrom(CONTRACT_FULL, {
      limit: "1500.00",
      exposure: "1874.95",
      computed_at: "2025-01-01T00:00:00.000Z",
    });
    expect(blockedMessage(run(cartInput({ payload })))).toBe(DEFAULT_OVER_LIMIT);
  });

  it("a year-old computed_at does not manufacture a block either", () => {
    const payload = payloadFrom(CONTRACT_FULL, {
      limit: "5000.00",
      exposure: "10.00",
      computed_at: "2025-01-01T00:00:00.000Z",
    });
    expect(run(cartInput({ payload }))).toEqual(ALLOW);
  });
});

describe("run — block messages (ENFC-03: a missing config never fails closed, never silences)", () => {
  const CUSTOM_OVER_LIMIT = "Please clear your balance before ordering again.";
  const CUSTOM_OVERDUE = "You have unpaid invoices with us.";
  const overduePayload = payloadFrom(CONTRACT_FULL, {
    limit: "1500.00",
    exposure: "10.00",
    overdue: true,
  });

  it("a well-formed config_v1 supplies both messages", () => {
    const config = {
      v: 1,
      over_limit_message: CUSTOM_OVER_LIMIT,
      overdue_message: CUSTOM_OVERDUE,
    };
    expect(blockedMessage(run(cartInput({ payload: NORTHWIND, config })))).toBe(CUSTOM_OVER_LIMIT);
    expect(blockedMessage(run(cartInput({ payload: overduePayload, config })))).toBe(CUSTOM_OVERDUE);
  });

  it("falls back FIELD BY FIELD — a config carrying only one message keeps the default for the other", () => {
    const config = { v: 1, overdue_message: CUSTOM_OVERDUE };
    expect(blockedMessage(run(cartInput({ payload: NORTHWIND, config })))).toBe(DEFAULT_OVER_LIMIT);
    expect(blockedMessage(run(cartInput({ payload: overduePayload, config })))).toBe(CUSTOM_OVERDUE);
  });

  it.each([
    ["absent (metafield null)", null],
    ["a bare string", "over limit!"],
    ["an array", []],
    ["a future config version", { v: 2, over_limit_message: CUSTOM_OVER_LIMIT }],
    ["a non-string message", { v: 1, over_limit_message: 42 }],
    ["an empty message", { v: 1, over_limit_message: "" }],
    ["an over-long message", { v: 1, over_limit_message: "x".repeat(251) }],
  ])("config is %s -> the block still fires, with the default copy", (_label, config) => {
    expect(blockedMessage(run(cartInput({ payload: NORTHWIND, config })))).toBe(DEFAULT_OVER_LIMIT);
  });

  it("a message of exactly the 250-character cap is accepted", () => {
    const exact = "y".repeat(250);
    const config = { v: 1, over_limit_message: exact, overdue_message: exact };
    expect(blockedMessage(run(cartInput({ payload: NORTHWIND, config })))).toBe(exact);
  });
});

/**
 * The eight committed fixtures under tests/fixtures/function-inputs/ are the
 * exact JSON piped into function-runner against the real wasm. Running the pure
 * `run` over the same files is what stops the runner corpus and the unit suite
 * from drifting apart: if someone edits a fixture to make a runner invocation
 * pass, this table turns red.
 */
const FIXTURE_VERDICTS: Array<{ file: string; blocks: boolean; why: string }> = [
  { file: "allow-d2c.json", blocks: false, why: "matrix row 1 — no purchasing company" },
  { file: "block-over-limit.json", blocks: true, why: "ENFC-01 remaining credit (Northwind)" },
  { file: "block-overdue.json", blocks: true, why: "ENFC-02 overdue, well within limit" },
  { file: "allow-bypass.json", blocks: false, why: "matrix row 6 — bypass first (Acme)" },
  { file: "allow-observe-only.json", blocks: false, why: "matrix row 7 — limit null (Snowdevil)" },
  { file: "allow-currency-mismatch.json", blocks: false, why: "D4-02 — EUR cart, USD payload" },
  { file: "block-all-zero-limit.json", blocks: true, why: "F-02 — limit 0.00 with currency null" },
  {
    file: "block-malformed-limit-overdue.json",
    blocks: true,
    why: "F-01 — garbage limit does not silence overdue",
  },
];

/** The credit_v1 key set, from the contract test's own key-set lock. */
const CONTRACT_KEYS = [
  "bypass",
  "computed_at",
  "currency",
  "data_complete",
  "exposure",
  "limit",
  "overdue",
  "v",
];

function readFixture(file: string): CartValidationsGenerateRunInput {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/function-inputs/${file}`, import.meta.url), "utf8"),
  ) as CartValidationsGenerateRunInput;
}

describe("committed function-runner fixtures agree with the pure comparator", () => {
  it("the corpus is exactly the eight fixtures the runner matrix executes", () => {
    expect(FIXTURE_VERDICTS).toHaveLength(8);
  });

  for (const { file, blocks, why } of FIXTURE_VERDICTS) {
    it(`${file}: ${blocks ? "blocks" : "allows"} — ${why}`, () => {
      const result = run(readFixture(file));
      expect(result.operations).toHaveLength(blocks ? 1 : 0);
      if (blocks) {
        expect(result.operations[0].validationAdd.errors[0].target).toBe("$.cart");
      }
    });
  }

  it("every fixture payload carries the exact credit_v1 key set — proof it came from the contract bytes", () => {
    for (const { file } of FIXTURE_VERDICTS) {
      const metafield = readFixture(file).cart.buyerIdentity!.purchasingCompany?.company.metafield;
      if (!metafield) continue; // allow-d2c has no company at all
      expect(Object.keys(metafield.jsonValue).sort(), `${file} payload keys`).toEqual(
        CONTRACT_KEYS,
      );
    }
  });
});

