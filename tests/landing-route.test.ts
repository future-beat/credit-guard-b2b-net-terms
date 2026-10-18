import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LoaderFunctionArgs } from "react-router";
import { describe, expect, it } from "vitest";

import { loader } from "../app/routes/_index/route";

/**
 * GET / — the bare `application_url`, which is what a Shopify reviewer opens
 * when they visit the app outside the admin with no `?shop` parameter.
 *
 * This route used to be the app template's placeholder page, and the App Store
 * self-review flagged it twice: 1.1.4 (factual information only — it shipped
 * `[your app]` headings and three `Product feature` stubs) and 2.3.1
 * (installation must begin on a Shopify-owned surface — it shipped a
 * shop-domain form posting to `/auth/login`). The negative assertions below are
 * therefore the point of this file, not padding: they are the two rejection
 * reasons, written down so a future edit cannot quietly reintroduce either.
 *
 * Three classes of assertion live here.
 *
 * BEHAVIOUR: the loader answers 200 with an HTML document, and still redirects
 * an admin entry (`?shop=`) to `/app`. Because this is a resource route the
 * loader IS the response, so calling it directly exercises the real path an
 * anonymous request takes.
 *
 * COPY: the page says what the app actually does and nothing more.
 *
 * SOURCE GUARD: this route must stay unauthenticated and self-contained, and
 * neither property is visible in the response once someone breaks it — an added
 * `authenticate.admin` call still returns HTML in a test that stubs auth, and an
 * added default export still returns a page while quietly routing it through
 * `app/root.tsx` and its cdn.shopify.com stylesheet. So the guards read the
 * source: comment-stripped (a rule that survives only in a comment is not a
 * rule) and walked TRANSITIVELY, because an indirect import of
 * `app/shopify.server` breaks the route exactly as thoroughly as a direct one.
 * These helpers mirror `tests/privacy-route.test.ts`, which guards the sibling
 * unauthenticated route the same way.
 */

const REPO_ROOT = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);
const ROUTE_FILE = path.join(REPO_ROOT, "app", "routes", "_index", "route.tsx");

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

/**
 * An anonymous GET carries no session token and no shop parameter — exactly
 * what a Shopify reviewer or a member of the public sends.
 */
const anonymousGet = (url = "https://app.creditguardhq.com/") =>
  loader({ request: new Request(url) } as unknown as LoaderFunctionArgs);

const renderPage = async () => await anonymousGet().text();

/**
 * The document with its stylesheet removed. Copy assertions are about what
 * the page SAYS, and a CSS declaration is not a claim — `100%` in
 * `-webkit-text-size-adjust` is not a statistic.
 */
const renderCopy = async () =>
  (await renderPage()).replace(/<style>[\s\S]*?<\/style>/g, "");

describe("GET / — response", () => {
  it("returns 200 with no authentication of any kind", async () => {
    const response = anonymousGet();

    expect(response.status).toBe(200);
  });

  it("serves HTML with an explicit charset", async () => {
    const response = anonymousGet();

    expect(response.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );
  });

  it("returns a complete, standalone HTML document", async () => {
    const html = await renderPage();

    expect(html.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain("</html>");
  });

  it("still redirects an admin entry to the embedded app", async () => {
    // Shopify opens the app URL with `?shop=` (plus host/embedded params); that
    // is an admin entry and belongs at /app, never on a marketing page. This
    // behaviour predates the rewrite and must survive it, query string intact.
    const response = anonymousGet(
      "https://app.creditguardhq.com/?shop=demo.myshopify.com&host=abc123",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/app?shop=demo.myshopify.com&host=abc123",
    );
  });
});

describe("GET / — factual copy (requirement 1.1.4)", () => {
  it("names the app and states what it does in one sentence", async () => {
    const html = await renderPage();

    expect(html).toContain("Credit Guard: B2B Net Terms");
    expect(html).toContain("<title>Credit Guard: B2B Net Terms</title>");
    expect(html).toContain(
      "Credit limits, checkout credit holds and payment reminders for your B2B net-terms customers.",
    );
  });

  it("describes only behaviour the app implements", async () => {
    const html = await renderPage();

    // Each line maps to real code: per-company limits, the hold predicate in
    // enforcement.server.ts, and the three touchpoints in reminders.server.ts.
    expect(html).toContain("Set a credit limit for each company.");
    expect(html).toContain(
      "over its limit or has overdue invoices",
    );
    expect(html).toContain(
      "before the due date, on the due date, and after it",
    );
  });

  it("carries no template placeholder copy", async () => {
    const html = await renderPage();

    // The exact strings the App Store self-review flagged under 1.1.4.
    expect(html).not.toContain("[your app]");
    expect(html).not.toContain("Product feature");
    expect(html).not.toContain("A short heading");
    expect(html).not.toContain("A tagline");
    expect(html).not.toContain("value proposition");
  });

  it("makes no outcome claim and quotes no price", async () => {
    const copy = await renderCopy();

    // 4.3: no fabricated statistics or guaranteed results. Pricing lives on
    // Shopify's hosted plan page; a figure here would only drift from it.
    expect(copy).not.toMatch(/\$\s?\d/);
    expect(copy).not.toMatch(/\bper month\b|\/mo\b|\bUSD\b/i);
    expect(copy).not.toMatch(/\b\d+%/);
  });

  it("links the privacy policy and the support address", async () => {
    const html = await renderPage();

    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/support"');
    expect(html).toContain("support@creditguardhq.com");
  });

  it("points installation at a Shopify-owned surface", async () => {
    const html = await renderPage();

    expect(html).toContain(
      "Credit Guard is installed from the Shopify App Store, or from the Apps section of your Shopify admin.",
    );
  });
});

describe("GET / — no self-owned install path (requirement 2.3.1)", () => {
  it("asks for no shop domain, in any shape", async () => {
    const html = await renderPage();

    // 2.3.1 forbids asking a merchant to type their .myshopify.com domain.
    // Asserted structurally as well as textually: a field named `shop` is the
    // violation whatever its label happens to say.
    expect(html).not.toMatch(/<input\b/i);
    expect(html).not.toMatch(/<form\b/i);
    expect(html).not.toMatch(/name=["']shop["']/i);
    expect(html.toLowerCase()).not.toContain("shop domain");
    expect(html).not.toContain("myshopify.com");
  });

  it("offers no install or log-in control of its own", async () => {
    const html = await renderPage();

    // Installation must begin on a Shopify-owned surface, so this page may
    // describe how to install but must never be the thing that starts it.
    expect(html).not.toMatch(/<button\b/i);
    expect(html).not.toContain("/auth/login");
    expect(html).not.toMatch(/\bLog in\b/i);
    expect(html).not.toMatch(/href=["'][^"']*\/auth\b/i);
  });
});

describe("GET / — self-contained, no external requests", () => {
  it("references no external origin at all", async () => {
    const html = await renderPage();

    // Served outside the admin and read by someone checking what we load; it
    // must render with the network unavailable after first byte.
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

describe("GET / — source guards", () => {
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
});
