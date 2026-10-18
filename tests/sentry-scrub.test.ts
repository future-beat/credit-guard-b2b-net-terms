import { describe, expect, it } from "vitest";

import { CREDENTIAL_QUERY_PARAMS, redactUrl } from "../app/sentry-redact.mjs";

/**
 * W-2 (Phase 1 verification carry-forward) — the Sentry URL scrubber.
 *
 * This is the app's strongest privacy control and, until this file existed, its
 * only gate was a grep that passed just as happily if someone deleted the
 * scrubber outright. Shopify puts a LIVE session token in the `id_token` query
 * parameter of every embedded admin document request, so an unscrubbed URL on an
 * error event hands a working credential to a third-party service (threat
 * T-02-09). These tests assert the redaction behaviour itself.
 *
 * The scrubber lives in `app/sentry-redact.mjs` — plain ESM, no Sentry import —
 * so it loads here without initialising any SDK, and so BOTH init sites can share
 * one implementation instead of the two hand-synced copies Phase 1 shipped.
 */

/** Synthetic, JWT-shaped, and not a credential for anything. */
const FAKE_SESSION_TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.not-a-real-signature";

const MARKER = "[redacted]";

async function initSource(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  // Comment-stripped, Phase 1 source-guard style: a rule that only survives in a
  // comment is not a rule.
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
}

describe("redactUrl — credential parameters", () => {
  it("replaces the id_token value while preserving every other parameter", () => {
    const scrubbed = redactUrl(
      `https://admin.shopify.com/store/credit-guard-demo/apps/creditguard?shop=credit-guard-demo.myshopify.com&id_token=${FAKE_SESSION_TOKEN}&host=YWRtaW4uc2hvcGlmeS5jb20&embedded=1`,
    );

    // The credential is gone — substring check, so a partial leak fails too.
    expect(scrubbed).not.toContain(FAKE_SESSION_TOKEN);
    expect(scrubbed).not.toContain("not-a-real-signature");
    expect(scrubbed).toContain(`id_token=${encodeURIComponent(MARKER)}`);

    // ...and the diagnostically useful context survives, which is the whole
    // point of scrubbing rather than dropping the URL.
    expect(scrubbed).toContain("shop=credit-guard-demo.myshopify.com");
    expect(scrubbed).toContain("host=YWRtaW4uc2hvcGlmeS5jb20");
    expect(scrubbed).toContain("embedded=1");
    expect(scrubbed).toContain("/apps/creditguard");
  });

  it.each(CREDENTIAL_QUERY_PARAMS)("redacts the %s parameter", (param) => {
    const scrubbed = redactUrl(
      `https://app.creditguard.test/auth/callback?${param}=super-secret-value&shop=demo.myshopify.com`,
    );

    expect(scrubbed).not.toContain("super-secret-value");
    expect(scrubbed).toContain("shop=demo.myshopify.com");
  });

  it("covers every credential parameter the two init sites used to list", () => {
    // Guards against someone shrinking the list during a refactor.
    expect(CREDENTIAL_QUERY_PARAMS).toEqual(
      expect.arrayContaining([
        "id_token",
        "session",
        "hmac",
        "signature",
        "access_token",
        "token",
        "code",
      ]),
    );
  });

  it("redacts several credential parameters in one URL", () => {
    const scrubbed = redactUrl(
      `https://app.creditguard.test/auth?code=abc123&hmac=deadbeef&id_token=${FAKE_SESSION_TOKEN}&shop=demo.myshopify.com`,
    );

    expect(scrubbed).not.toContain("abc123");
    expect(scrubbed).not.toContain("deadbeef");
    expect(scrubbed).not.toContain(FAKE_SESSION_TOKEN);
    expect(scrubbed).toContain("shop=demo.myshopify.com");
  });
});

describe("redactUrl — non-credential input is left alone", () => {
  it("returns a clean URL byte-identical", () => {
    const clean =
      "https://app.creditguard.test/app/companies?shop=demo.myshopify.com&page=2";
    expect(redactUrl(clean)).toBe(clean);
  });

  it("does not redact a parameter whose NAME merely contains a credential word", () => {
    const url =
      "https://app.creditguard.test/app?token_count=5&id_token_hint=harmless";
    expect(redactUrl(url)).toBe(url);
  });

  it("passes through non-string input untouched", () => {
    expect(redactUrl(undefined)).toBeUndefined();
    expect(redactUrl(null as never)).toBeNull();
  });
});

describe("redactUrl — breadcrumb-style relative URLs", () => {
  it("scrubs a relative path without inventing an origin", () => {
    const scrubbed = redactUrl(`/app/orders?id_token=${FAKE_SESSION_TOKEN}&tab=ar`);

    expect(scrubbed).not.toContain(FAKE_SESSION_TOKEN);
    expect(scrubbed!.startsWith("/app/orders")).toBe(true);
    expect(scrubbed).toContain("tab=ar");
    // The parser needs a base URL; that base must never surface in the output.
    expect(scrubbed).not.toContain("placeholder.invalid");
  });

  it("keeps a clean relative path unchanged", () => {
    expect(redactUrl("/app/companies?tab=ar")).toBe("/app/companies?tab=ar");
  });
});

describe("redactUrl — malformed input", () => {
  const malformed = [
    "http://[",
    "https://exa mple.com/?id_token=leak",
    "::::",
    "",
  ];

  it.each(malformed)("does not throw on %j", (url) => {
    expect(() => redactUrl(url)).not.toThrow();
  });

  it("fails CLOSED — an unparseable URL never forwards credential material", () => {
    // Deliberate deviation from "pass through unmodified": this control exists to
    // keep tokens out of Sentry, so the safe failure is to drop the URL, not to
    // forward something we could not inspect.
    const scrubbed = redactUrl(`http://[?id_token=${FAKE_SESSION_TOKEN}`);

    expect(scrubbed).not.toContain(FAKE_SESSION_TOKEN);
    expect(scrubbed).toBe(MARKER);
  });
});

describe("both Sentry init sites share ONE implementation (no drift)", () => {
  it("the server init imports the shared module and defines no scrubber of its own", async () => {
    const code = await initSource("../instrument.server.mjs");

    expect(code).toMatch(/import\s*\{[^}]*redactUrl[^}]*\}\s*from\s*["'][^"']*sentry-redact\.mjs["']/);
    // The duplicated copy is gone — a second definition is how the two sites
    // drifted apart in the first place.
    expect(code).not.toMatch(/function\s+redactUrl/);
    expect(code).not.toMatch(/const\s+CREDENTIAL_QUERY_PARAMS/);
    // And the scrubber is actually wired into both Sentry hooks.
    expect(code).toContain("beforeSend");
    expect(code).toContain("beforeBreadcrumb");
    expect(code).toMatch(/redactUrl\(/);
  });

  it("the client init imports the shared module and defines no scrubber of its own", async () => {
    const code = await initSource("../app/entry.client.tsx");

    expect(code).toMatch(/import\s*\{[^}]*redactUrl[^}]*\}\s*from\s*["'][^"']*sentry-redact\.mjs["']/);
    expect(code).not.toMatch(/function\s+redactUrl/);
    expect(code).not.toMatch(/const\s+CREDENTIAL_QUERY_PARAMS/);
    expect(code).toContain("beforeSend");
    expect(code).toContain("beforeBreadcrumb");
    expect(code).toMatch(/redactUrl\(/);
  });

  it.each([
    ["../instrument.server.mjs"],
    ["../app/entry.client.tsx"],
  ])("%s keeps sendDefaultPii off and strips bodies, cookies and headers", async (path) => {
    const code = await initSource(path);

    expect(code).toMatch(/sendDefaultPii\s*:\s*false/);
    expect(code).toContain("delete event.request.data");
    expect(code).toContain("delete event.request.cookies");
    expect(code).toContain("delete event.request.headers");
  });
});
