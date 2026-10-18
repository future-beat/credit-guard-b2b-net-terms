import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Three-place scope lockstep guard (Phase 3, plan 03-02; 03-RESEARCH Pitfall 4).
 *
 * The scope string lives in THREE places, and a TOML change alone changes
 * nothing at runtime — app/shopify.server.ts reads process.env.SCOPES:
 *
 *   1. shopify.app.toml  [access_scopes]   what the merchant is asked to grant
 *   2. Railway `SCOPES` service variable   what the running app requests
 *   3. vitest.config.ts test env           what the suite exercises
 *
 * This file is the drift alarm for the two places a test can reach (1 and 3);
 * the Railway variable is asserted at deploy time by plan verification
 * (`railway variables --json`). If the TOML and the test env ever diverge —
 * or either write scope goes missing from either — the build goes red instead
 * of the app silently requesting different permissions than it ships with.
 *
 * Phase 4 added the second write scope, `write_validations` (04-RESEARCH Q6):
 * `validationCreate` is what binds the deployed checkout-validation Function to
 * the merchant's checkout, and it is the only way the app can pin
 * `blockOnFailure: false` itself (ENFC-04) instead of inheriting a hand-made
 * rule's default.
 *
 * Phase 5 added the third, `write_orders` (D5-01): `paymentReminderSend` is
 * gated on it, and that single mutation is the whole reminder feature — Shopify
 * composes and sends the mail, so the app needs no buyer contact data. The
 * scope is deliberately NOT a licence to write orders, and the exact-set
 * assertion in tests/webhooks.b2b-events.test.ts is what keeps a fourth write
 * scope from arriving unannounced.
 *
 * CF-5 riders: the Shopify CLI has rewritten api_version to the RC twice
 * before, and `automatically_update_urls_on_dev = true` would let `dev`
 * publish an ephemeral tunnel URL to the live registration. Both pins are
 * asserted here so a CLI rewrite fails the suite, not production installs.
 */

const EXPECTED_SCOPES =
  "read_orders,read_all_orders,read_payment_terms,read_companies,write_companies,write_validations,write_orders";

/** The TOML with every comment line removed — config only, prose never. */
function activeToml(): string {
  const raw = readFileSync(new URL("../shopify.app.toml", import.meta.url), "utf8");
  return raw
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

describe("scope lockstep guard — TOML and vitest env can never drift silently", () => {
  it("shopify.app.toml declares exactly the seven-scope string, once", () => {
    const declared = [...activeToml().matchAll(/^\s*scopes\s*=\s*"([^"]*)"/gm)].map(
      (m) => m[1],
    );

    // Not a superset, not a reordering, not a second scopes line elsewhere.
    expect(declared).toEqual([EXPECTED_SCOPES]);
    expect(declared[0].split(",")).toContain("write_companies");
    expect(declared[0].split(",")).toContain("write_validations");
    expect(declared[0].split(",")).toContain("write_orders");
    // read_orders survives the arrival of a write scope that conventionally
    // implies it (D5-01: explicitness over convention).
    expect(declared[0].split(",")).toContain("read_orders");
  });

  it("the vitest env runs the suite with the SAME scope string (Pitfall 4)", () => {
    // app/shopify.server.ts reads process.env.SCOPES at import time; a test
    // run with a different string exercises a differently-configured app than
    // the one that ships.
    expect(process.env.SCOPES).toBe(EXPECTED_SCOPES);
    expect(process.env.SCOPES?.split(",")).toContain("write_companies");
    expect(process.env.SCOPES?.split(",")).toContain("write_validations");
    expect(process.env.SCOPES?.split(",")).toContain("write_orders");
  });

  it("keeps api_version pinned to stable 2026-07, exactly once (CF-5)", () => {
    const versions = [...activeToml().matchAll(/api_version\s*=\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(versions).toEqual(["2026-07"]);
  });

  it("keeps the production URL and the dev-rewrite guard byte-identical (CF-5/D-04)", () => {
    const toml = activeToml();
    expect(toml).toContain('application_url = "https://app.creditguardhq.com"');
    expect(toml).toContain("automatically_update_urls_on_dev = false");
  });

  it("declares the credit_v1 company metafield definition (contract-home #1, D-04)", () => {
    const toml = activeToml();

    // The server<->Function interface rides in git and is auto-created on
    // deploy. Never the long-form app--{client-id} namespace: the TOML grammar
    // uses the literal `app` segment (research Reserved Namespace).
    expect(toml).toContain("[company.metafields.app.credit_v1]");

    const block = toml.split("[company.metafields.app.credit_v1]")[1].split(/\n\[/)[0];
    expect(block).toContain('type = "json"');
    expect(block).toContain('access.admin = "merchant_read"');
  });
});
