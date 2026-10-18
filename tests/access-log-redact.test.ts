import { describe, expect, it, vi } from "vitest";

import {
  installAccessLogRedaction,
  redactLogLine,
} from "../app/access-log-redact.mjs";
import { CREDENTIAL_QUERY_PARAMS } from "../app/sentry-redact.mjs";
import { sourceWithoutComments } from "./helpers/module-source";

/**
 * WINDOWS #8 — the access log leak.
 *
 * `react-router-serve` hard-wires `app.use(morgan("tiny"))` and offers no option
 * or env var to change it, so every embedded admin document request prints its
 * FULL URL to stdout — including the `id_token` query parameter, which is a live
 * Shopify session JWT. Railway then retains that line. Same leak class as
 * T-01-07, but into a log store rather than an error tracker, and the Sentry
 * scrubber never sees it: morgan writes to the stream directly.
 *
 * The control therefore lives at the stream: `instrument.server.mjs` is already
 * loaded by raw Node through `NODE_OPTIONS='--import'` BEFORE the server module
 * graph, so wrapping `process.stdout.write` there catches morgan's line (and
 * every console.error stack) on the way out, with no dependency and no custom
 * server file.
 */

/** Synthetic, JWT-shaped, and not a credential for anything. */
const FAKE_SESSION_TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.not-a-real-signature";

const MARKER = "[redacted]";

describe("redactLogLine — morgan 'tiny' access lines", () => {
  it("scrubs the id_token value and keeps everything else byte-for-byte", () => {
    const line = `GET /app?shop=credit-guard-demo.myshopify.com&id_token=${FAKE_SESSION_TOKEN}&host=YWRtaW4 200 - 12.345 ms`;

    const scrubbed = redactLogLine(line);

    // Substring assertions, so a PARTIAL leak fails too.
    expect(scrubbed).not.toContain(FAKE_SESSION_TOKEN);
    expect(scrubbed).not.toContain("not-a-real-signature");
    expect(scrubbed).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(scrubbed).toContain(`id_token=${MARKER}`);

    // ...and the line is still a usable access-log record. A control that
    // destroys the diagnostic is a control someone eventually switches off.
    expect(scrubbed).toContain("GET /app?");
    expect(scrubbed).toContain("shop=credit-guard-demo.myshopify.com");
    expect(scrubbed).toContain("host=YWRtaW4");
    expect(scrubbed).toContain("200 - 12.345 ms");
  });

  it.each(CREDENTIAL_QUERY_PARAMS)(
    "scrubs %s as the first, middle and last parameter",
    (param) => {
      const first = redactLogLine(
        `GET /auth?${param}=super-secret-value&shop=demo.myshopify.com 302 - 1 ms`,
      );
      const middle = redactLogLine(
        `GET /auth?shop=demo.myshopify.com&${param}=super-secret-value&host=abc 302 - 1 ms`,
      );
      const last = redactLogLine(
        `GET /auth?shop=demo.myshopify.com&${param}=super-secret-value 302 - 1 ms`,
      );

      for (const scrubbed of [first, middle, last]) {
        expect(scrubbed).not.toContain("super-secret-value");
        expect(scrubbed).toContain(`${param}=${MARKER}`);
        expect(scrubbed).toContain("shop=demo.myshopify.com");
      }
      // The trailing status/timing survives even when the credential was last.
      expect(last).toContain("302 - 1 ms");
    },
  );

  it("scrubs several credential parameters in one line", () => {
    const scrubbed = redactLogLine(
      `GET /auth/callback?code=abc123&hmac=deadbeef&id_token=${FAKE_SESSION_TOKEN}&shop=demo.myshopify.com 200 - 4 ms`,
    );

    expect(scrubbed).not.toContain("abc123");
    expect(scrubbed).not.toContain("deadbeef");
    expect(scrubbed).not.toContain(FAKE_SESSION_TOKEN);
    expect(scrubbed).toContain("shop=demo.myshopify.com");
  });

  it("leaves a line with no credential parameter byte-identical", () => {
    const clean = "GET /app/companies?shop=demo.myshopify.com&page=2 200 - 8 ms";
    expect(redactLogLine(clean)).toBe(clean);
  });

  it("does not touch a parameter whose NAME merely contains a credential word", () => {
    // Matching is anchored on `?`/`&` + the exact name + `=`, so neither a
    // prefix nor a suffix collision can trigger a redaction.
    const line =
      "GET /app?locale=en&embedded=1&id_token_hint=harmless&x_token=keep&token_count=5 200 - 2 ms";
    expect(redactLogLine(line)).toBe(line);
  });

  it("passes non-string input through untouched", () => {
    expect(redactLogLine(undefined)).toBeUndefined();
    expect(redactLogLine(null)).toBeNull();
  });
});

describe("redactLogLine — structured and multi-line output", () => {
  it("keeps a JSON log line parseable, with only the token value replaced", () => {
    // Anything structured that some future logger prints must survive: the
    // scrubber stops at the quote, so the JSON envelope is never damaged.
    const record = {
      level: "error",
      msg: "request failed",
      url: `https://app.creditguard.test/app?shop=demo.myshopify.com&id_token=${FAKE_SESSION_TOKEN}`,
      status: 500,
    };
    const line = JSON.stringify(record);

    const scrubbed = redactLogLine(line);

    expect(scrubbed).not.toContain(FAKE_SESSION_TOKEN);

    const parsed = JSON.parse(scrubbed as string);
    expect(parsed.level).toBe("error");
    expect(parsed.msg).toBe("request failed");
    expect(parsed.status).toBe(500);
    expect(parsed.url).toBe(
      `https://app.creditguard.test/app?shop=demo.myshopify.com&id_token=${MARKER}`,
    );
  });

  it("scrubs a URL embedded in an error stack, keeping the frames", () => {
    const stack = [
      `Error: Unexpected response for https://app.creditguard.test/app?id_token=${FAKE_SESSION_TOKEN}&shop=demo.myshopify.com`,
      "    at loader (/app/build/server/index.js:120:11)",
      "    at async Object.callRouteLoader (/app/node_modules/react-router/dist/index.js:44:5)",
    ].join("\n");

    const scrubbed = redactLogLine(stack) as string;

    expect(scrubbed).not.toContain(FAKE_SESSION_TOKEN);
    expect(scrubbed).toContain(`id_token=${MARKER}`);
    expect(scrubbed).toContain("shop=demo.myshopify.com");
    // Every frame survives — the stack is the whole diagnostic.
    expect(scrubbed.split("\n")).toHaveLength(3);
    expect(scrubbed).toContain("at loader (/app/build/server/index.js:120:11)");
  });
});

describe("installAccessLogRedaction — the stream wrapper", () => {
  /** A minimal stand-in for process.stdout: records what the real write saw. */
  function fakeStream() {
    const written: unknown[] = [];
    return {
      written,
      write: vi.fn((chunk: unknown) => {
        written.push(chunk);
        return true;
      }),
    };
  }

  it("scrubs string chunks on their way to the underlying write", () => {
    const stream = fakeStream();
    installAccessLogRedaction(stream);

    stream.write(
      `GET /app?id_token=${FAKE_SESSION_TOKEN}&shop=demo.myshopify.com 200 - 3 ms\n`,
    );

    expect(stream.written).toHaveLength(1);
    expect(stream.written[0]).not.toContain(FAKE_SESSION_TOKEN);
    expect(stream.written[0]).toContain(`id_token=${MARKER}`);
    // The newline morgan appends is part of the chunk and must survive.
    expect(stream.written[0]).toMatch(/\n$/);
  });

  it("passes non-string chunks (Buffer) through untouched", () => {
    const stream = fakeStream();
    installAccessLogRedaction(stream);

    const buffer = Buffer.from("binary-payload");
    stream.write(buffer);

    expect(stream.written[0]).toBe(buffer);
  });

  it("preserves the return value and forwards encoding and callback", () => {
    const written: unknown[][] = [];
    const stream = {
      write: vi.fn((...args: unknown[]) => {
        written.push(args);
        return false; // backpressure — the caller must see it
      }),
    };
    installAccessLogRedaction(stream);

    const callback = vi.fn();
    const result = stream.write("plain line\n", "utf8", callback);

    expect(result).toBe(false);
    expect(written[0]).toEqual(["plain line\n", "utf8", callback]);
  });

  it("is idempotent — a second install does not double-wrap", () => {
    const stream = fakeStream();
    installAccessLogRedaction(stream);
    const wrapped = stream.write;
    installAccessLogRedaction(stream);

    expect(stream.write).toBe(wrapped);
  });

  it("ignores a stream without a write function rather than throwing at boot", () => {
    // Fail SOFT here, deliberately: this runs in the --import hook, and an
    // exception would take the whole server down before it ever boots.
    expect(() => installAccessLogRedaction({} as never)).not.toThrow();
    expect(() => installAccessLogRedaction(null as never)).not.toThrow();
  });
});

describe("the scrubber is wired in, and shares ONE parameter list (W-2)", () => {
  it("instrument.server.mjs installs it on stdout AND stderr", () => {
    const code = sourceWithoutComments("instrument.server.mjs");

    expect(code).toMatch(
      /import\s*\{[^}]*installAccessLogRedaction[^}]*\}\s*from\s*["']\.\/app\/access-log-redact\.mjs["']/,
    );
    expect(code).toContain("installAccessLogRedaction(process.stdout)");
    expect(code).toContain("installAccessLogRedaction(process.stderr)");
    // Before Sentry.init: the hook must be in place for anything the SDK's own
    // startup might print.
    expect(code.indexOf("installAccessLogRedaction(process.stdout)")).toBeLessThan(
      code.indexOf("Sentry.init"),
    );
  });

  it("app/access-log-redact.mjs imports only the shared parameter list", () => {
    // Plain ESM, no dependencies: production runs this module through raw Node
    // 20 via --import, before any bundler or TypeScript loader exists. And the
    // parameter list is the SHARED one — two hand-synced copies is how a
    // privacy control drifts on one side only (W-2).
    const code = sourceWithoutComments("app/access-log-redact.mjs");

    const imports = code.match(/^\s*import\s.*$/gm) ?? [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatch(
      /import\s*\{\s*CREDENTIAL_QUERY_PARAMS\s*\}\s*from\s*["']\.\/sentry-redact\.mjs["']/,
    );
    expect(code).not.toMatch(/const\s+CREDENTIAL_QUERY_PARAMS/);
    expect(code).not.toContain("require(");
  });

  it("covers every credential parameter the Sentry scrubber covers", () => {
    // One list, two consumers: adding a name in sentry-redact.mjs must protect
    // the access log too, with no second edit.
    for (const param of CREDENTIAL_QUERY_PARAMS) {
      expect(redactLogLine(`GET /x?${param}=leak 200 - 1 ms`)).toContain(
        `${param}=${MARKER}`,
      );
    }
  });
});
