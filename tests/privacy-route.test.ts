import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loader } from "../app/routes/privacy";

/**
 * GET /privacy — the public privacy policy Shopify's app listing requires.
 *
 * Two classes of assertion live here, and the second is the important one.
 *
 * BEHAVIOUR: the loader answers 200 with an HTML document rendered from
 * PRIVACY.md. Because this is a resource route the loader IS the response, so
 * calling it directly exercises the real path an anonymous request takes.
 *
 * SOURCE GUARD: this route must stay unauthenticated and self-contained, and
 * neither property is visible in the response once someone breaks it — an added
 * `authenticate.admin` call still returns HTML in a test that stubs auth, and an
 * added default export still returns a page while quietly routing it through
 * `app/root.tsx` and its cdn.shopify.com stylesheet. So the guards read the
 * source: comment-stripped (a rule that survives only in a comment is not a
 * rule) and walked TRANSITIVELY, because an indirect import of
 * `app/shopify.server` breaks the route exactly as thoroughly as a direct one.
 */

const REPO_ROOT = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);
const ROUTE_FILE = path.join(REPO_ROOT, "app", "routes", "privacy.tsx");
const POLICY_FILE = path.join(REPO_ROOT, "PRIVACY.md");

/** Comment-stripped source, so a guard cannot be satisfied by prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
}

/** Every relative specifier this module pulls in, static or dynamic. */
function relativeImportsOf(source: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /(?:^|[\s;}])(?:import|export)\s[\s\S]*?\sfrom\s*["']([^"']+)["']/g,
    /(?:^|[\s;}])import\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier.startsWith(".")) specifiers.add(specifier);
    }
  }
  return [...specifiers];
}

async function resolveModule(
  fromDir: string,
  specifier: string,
): Promise<string | null> {
  // `?raw` (and friends) are build-time asset inlines, not modules — there is no
  // import graph beyond them.
  if (specifier.includes("?")) return null;
  const base = path.resolve(fromDir, specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.js`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    try {
      const stat = await readFile(candidate, "utf8");
      if (typeof stat === "string") return candidate;
    } catch {
      // try the next extension
    }
  }
  return null;
}

/** entry file + every module reachable from it by relative import. */
async function transitiveSources(entry: string): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (sources.has(file)) continue;
    const stripped = stripComments(await readFile(file, "utf8"));
    sources.set(file, stripped);
    for (const specifier of relativeImportsOf(stripped)) {
      const resolved = await resolveModule(path.dirname(file), specifier);
      if (resolved) queue.push(resolved);
    }
  }
  return sources;
}

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The loader takes no request — an anonymous GET carries nothing it needs. */
const renderPage = async () => await loader().text();

describe("GET /privacy — response", () => {
  it("returns 200 with no authentication of any kind", async () => {
    // No request, no session token, no shop parameter: exactly what a Shopify
    // reviewer or a member of the public sends.
    const response = loader();

    expect(response.status).toBe(200);
  });

  it("serves HTML with an explicit charset", async () => {
    const response = loader();

    expect(response.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );
  });

  it("is publicly cacheable", async () => {
    const response = loader();

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("returns a complete, standalone HTML document", async () => {
    const html = await renderPage();

    expect(html.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain("<title>Privacy Policy — Credit Guard: B2B Net Terms</title>");
    expect(html).toContain("</html>");
  });
});

describe("GET /privacy — content matches PRIVACY.md", () => {
  it("renders the 'What Credit Guard does not store' section", async () => {
    const html = await renderPage();

    expect(html).toContain("<h3>What Credit Guard does not store</h3>");
    // The substantive claim a reviewer checks against the PCD questionnaire —
    // asserted across the Markdown's line wrap, which proves the paragraph was
    // rejoined rather than emitted as two fragments.
    expect(html).toContain(
      "does <strong>not</strong> store any personal data about a merchant's customers or their business contacts",
    );
  });

  it("renders the support contact", async () => {
    const html = await renderPage();

    expect(html).toContain("support@creditguardhq.com");
    expect(html).toContain(
      "<h2>13. Contact</h2>",
    );
  });

  it("renders every top-level section heading from the Markdown", async () => {
    const markdown = await readFile(POLICY_FILE, "utf8");
    const headings = [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) =>
      match[1].trim(),
    );
    const html = await renderPage();

    // Non-trivial policy: if this ever drops to a handful the source read broke.
    expect(headings.length).toBeGreaterThanOrEqual(13);
    for (const heading of headings) {
      expect(html).toContain(`<h2>${escapeHtml(heading)}</h2>`);
    }
  });

  it("renders the scope table as a real table with inline code", async () => {
    const html = await renderPage();

    expect(html).toContain('<th scope="col">Scope</th>');
    expect(html).toContain("<code>read_all_orders</code>");
    expect(html).toContain("<code>read_companies</code>");
    // The processor/sub-processor table, which the questionnaire also asks about.
    expect(html).toContain("<strong>Railway</strong>");
    expect(html).toContain("<strong>Sentry</strong>");
  });

  it("leaves no raw Markdown syntax in the output", async () => {
    const html = await renderPage();

    expect(html).not.toMatch(/\*\*/); // unrendered bold
    expect(html).not.toMatch(/^\s*#{1,6}\s/m); // unrendered ATX heading
    expect(html).not.toContain("|---|"); // unrendered table delimiter
    expect(html).not.toMatch(/^\s*\|/m); // unrendered table row
    expect(html).not.toMatch(/^\s*-\s+\w/m); // unrendered bullet
  });
});

describe("GET /privacy — self-contained, no external requests", () => {
  it("references no external origin at all", async () => {
    const html = await renderPage();

    // This page is served outside the admin, is read by people checking what we
    // load, and must render with the network unavailable after first byte.
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("cdn.shopify.com");
  });

  it("loads no stylesheet, script, font, or image", async () => {
    const html = await renderPage();

    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<img\b/i);
    expect(html).toContain("<style>");
  });

  it("uses no Polaris web components or App Bridge", async () => {
    const html = await renderPage();

    // App Bridge only exists inside the admin iframe; this page is not in one,
    // so every `s-*` element would render as an unstyled unknown tag.
    expect(html).not.toMatch(/<s-[a-z]/);
    expect(html.toLowerCase()).not.toContain("app-bridge");
  });
});

describe("GET /privacy — source guards", () => {
  it("is a resource route with no default export", async () => {
    const source = stripComments(await readFile(ROUTE_FILE, "utf8"));

    // A default export would render this through app/root.tsx, which injects a
    // cdn.shopify.com stylesheet link — silently breaking self-containment.
    expect(source).not.toMatch(/export\s+default\b/);
  });

  it("never imports app/shopify.server, directly or transitively", async () => {
    const sources = await transitiveSources(ROUTE_FILE);

    expect(sources.has(ROUTE_FILE)).toBe(true);
    for (const [file, source] of sources) {
      expect(
        source,
        `${path.relative(REPO_ROOT, file)} must not reach shopify.server`,
      ).not.toMatch(/shopify\.server/);
      expect(
        source,
        `${path.relative(REPO_ROOT, file)} must not pull in the Shopify app library`,
      ).not.toMatch(/@shopify\/shopify-app-react-router/);
    }
  });

  it("never calls authenticate()", async () => {
    const sources = await transitiveSources(ROUTE_FILE);

    for (const [file, source] of sources) {
      expect(
        source,
        `${path.relative(REPO_ROOT, file)} must not authenticate`,
      ).not.toMatch(/\bauthenticate\s*[.(]/);
    }
  });

  it("sources its text from PRIVACY.md rather than duplicating it", async () => {
    const source = stripComments(await readFile(ROUTE_FILE, "utf8"));

    // Single source of truth: the route inlines the committed Markdown at build
    // time. A hand-authored copy of a legal document drifts silently.
    expect(source).toMatch(/PRIVACY\.md\?raw/);
  });
});
