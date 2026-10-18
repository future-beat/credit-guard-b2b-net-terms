import { describe, expect, it } from "vitest";

import {
  moduleSource,
  sourceWithoutComments,
  stripComments,
} from "./module-source";

/**
 * The comment stripper is load-bearing: four suites grep its output for
 * forbidden and required patterns. A stripper that hands a guard an empty
 * string turns every `not.toContain` green, which is exactly what happened
 * when a `/*`-like glob inside a `//` comment opened a phantom block comment
 * (found by the 06-04 executor). These tests pin the token classes the
 * stripper must respect.
 */
describe("stripComments — comment delimiters inside other tokens are inert", () => {
  it("a glob in a line comment does not open a block comment (the 06-04 defect)", () => {
    const source = [
      "import { x } from './x';",
      "// Every route under `/app/*` is authenticated here.",
      "export const loader = () => authenticate(x);",
      "export const SENTINEL = 'still here';",
      "/* real block */",
      "export const AFTER = 1;",
    ].join("\n");

    const stripped = stripComments(source);

    expect(stripped).toContain("export const loader");
    expect(stripped).toContain("SENTINEL");
    expect(stripped).toContain("AFTER");
    expect(stripped).not.toContain("authenticated here");
    expect(stripped).not.toContain("real block");
  });

  it("`//` inside a string literal is not a comment", () => {
    const source = [
      'const gid = "gid://shopify/Company/1"; const a = 1;',
      "const url = 'https://example.com/x'; const b = 2;",
      'const tricky = "a // b /* c */ d"; const c = 3;',
    ].join("\n");

    const stripped = stripComments(source);

    expect(stripped).toBe(source);
  });

  it("`/*` inside a template literal is not a comment", () => {
    const source = [
      "const glob = `/app/*`;",
      "const q = `select /* hint */ * from t where x = ${id /* inline */}`;",
      "const nested = `outer ${`inner /* x */ ${deep} // y`} tail`;",
      "export const KEEP = true;",
    ].join("\n");

    const stripped = stripComments(source);

    // Template contents survive verbatim, including the would-be delimiters…
    expect(stripped).toContain("`/app/*`");
    expect(stripped).toContain("select /* hint */ * from t");
    expect(stripped).toContain("`inner /* x */ ${deep} // y`");
    // …while a real comment inside a `${}` substitution is removed.
    expect(stripped).not.toContain("inline");
    expect(stripped).toMatch(/\$\{id\s*\}/);
    expect(stripped).toContain("export const KEEP = true;");
  });

  it("nested-looking sequences: block comments do not nest and `//` inside a block is inert", () => {
    const source = [
      "const a = 1;",
      "/* outer /* inner // not a line comment",
      "   still comment */ const b = 2;",
      "const c = 3; /* trailing */ // and a line comment",
      "const d = 4; // line comment with /* opener only",
      "const e = 5;",
      "/** doc with */ const f = 6;",
    ].join("\n");

    const stripped = stripComments(source);

    for (const kept of ["const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;", "const e = 5;", "const f = 6;"]) {
      expect(stripped).toContain(kept);
    }
    expect(stripped).not.toContain("outer");
    expect(stripped).not.toContain("inner");
    expect(stripped).not.toContain("still comment");
    expect(stripped).not.toContain("trailing");
    expect(stripped).not.toContain("line comment");
    expect(stripped).not.toContain("opener only");
    expect(stripped).not.toContain("doc with");
  });

  it("a regex literal containing comment-like sequences is left alone", () => {
    const source = [
      "const slashes = /\\/\\/|\\/\\*/g; const after = 1;",
      "const cls = /[/*]+/; const b = 2;",
      "return /^\\/\\/ok/.test(s); // real comment",
    ].join("\n");

    const stripped = stripComments(source);

    expect(stripped).toContain("/\\/\\/|\\/\\*/g; const after = 1;");
    expect(stripped).toContain("/[/*]+/; const b = 2;");
    expect(stripped).toContain("return /^\\/\\/ok/.test(s);");
    expect(stripped).not.toContain("real comment");
  });

  it("escaped quotes inside strings do not end the string early", () => {
    const source = "const s = 'it\\'s // not a comment'; const t = \"say \\\"//\\\"\"; const u = 1;";

    expect(stripComments(source)).toBe(source);
  });

  it("an unterminated block comment drops the rest of the file, not the file before it", () => {
    const stripped = stripComments("const a = 1;\n/* never closed\nconst b = 2;");

    expect(stripped).toContain("const a = 1;");
    expect(stripped).not.toContain("const b");
  });
});

describe("sourceWithoutComments — real files", () => {
  it("strips app/routes/app.tsx without swallowing its code", () => {
    const stripped = sourceWithoutComments("app/routes/app.tsx");
    const raw = moduleSource("app/routes/app.tsx");

    expect(stripped.length).toBeGreaterThan(200);
    expect(stripped).toContain("export default function");
    expect(stripped).toContain("authenticate.admin");
    // Every top-level export in the raw file survives stripping, and the
    // stripped file is still most of the raw file — a swallowed 38-line block
    // (the 06-04 defect) would drop either of these.
    for (const exported of raw.match(/^export .*$/gm) ?? []) {
      expect(stripped).toContain(exported);
    }
    const nonBlank = (text: string) =>
      text.split("\n").filter((line) => line.trim() !== "").length;
    // app.tsx is legitimately comment-heavy (the billing-gate doc block), so
    // the swallowed-block detector is a floor of one third, not one half —
    // the 06-04 defect blanked 38 straight code lines, far below either bar.
    expect(nonBlank(stripped)).toBeGreaterThan(nonBlank(raw) / 3);
    expect(stripped).toContain("export const headers: HeadersFunction");
  });

  it("never returns less than the code that is actually there", () => {
    // Every guarded module keeps a recognisable export after stripping.
    for (const [file, anchor] of [
      ["app/services/scheduler.server.ts", "export async function forEachActiveShop"],
      ["app/services/reminders.server.ts", "graphqlJson"],
      ["app/services/reconciliation.server.ts", "graphqlJson"],
      // backfill executes no GraphQL since the ingest-latency fix moved
      // enumerateCompanies into ledger.server.ts — anchor on the import it kept
      ["app/services/backfill.server.ts", "enumerateCompanies"],
      ["app/services/metafields.server.ts", "graphqlJson"],
      ["app/routes/app.settings.tsx", "export default function"],
      ["extensions/credit-guard-validation/src/cart_validations_generate_run.ts", "MAX_MESSAGE_LENGTH"],
    ]) {
      const stripped = sourceWithoutComments(file);
      expect(stripped.length, file).toBeGreaterThan(200);
      expect(stripped, file).toContain(anchor);
    }
  });
});
