import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loader } from "../app/routes/support";
import { stripComments } from "./helpers/module-source";

/**
 * GET /support — the public support and FAQ page, and the App Store listing's
 * "Support / FAQ URL". It is fetched by merchants, by a Shopify reviewer, and
 * by crawlers, none of whom holds a session token.
 *
 * Three classes of assertion live here, mirroring `tests/landing-route.test.ts`
 * and `tests/privacy-route.test.ts`, which guard the sibling unauthenticated
 * routes the same way.
 *
 * BEHAVIOUR: the loader answers 200 with a complete standalone HTML document
 * and the cache headers the listing URL is served with. Because this is a
 * resource route the loader IS the response, so calling it directly exercises
 * the real path an anonymous request takes.
 *
 * FACTUAL COPY (requirement 1.1.4): every load-bearing claim on the page is
 * pinned here, because each one maps to behaviour implemented elsewhere in the
 * repo — the Function's locked decision order for credit holds, the recompute
 * and sweep cadences for balance freshness, the reminder touchpoints and the
 * per-order daily limit, the redaction delay after uninstall, and Shopify App
 * Pricing for billing. A drifting page is a false public product claim, and
 * nothing else in the suite would notice.
 *
 * RELATIVE LINKS AND NO HOSTNAME: the page may later be served from the apex
 * domain or from a help subdomain with no code change, so neither the module
 * nor its output may carry a host or an absolute URL. The single permitted
 * occurrence of the domain is inside the support email address.
 *
 * SOURCE GUARDS: staying unauthenticated and self-contained is invisible in the
 * response once someone breaks it — an added authenticate call still returns
 * HTML in a test that stubs auth, and an added default export still returns a
 * page while quietly routing it through `app/root.tsx` and its CDN stylesheet.
 * So the guards read the source: comment-stripped (a rule that survives only in
 * a comment is not a rule) via the repo's single tokenizer-aware
 * `stripComments`, and walked TRANSITIVELY, because an indirect import of
 * `app/shopify.server` breaks the route exactly as thoroughly as a direct one.
 * Per that helper's contract every negative source assertion is preceded by a
 * non-triviality anchor, so a stripper defect cannot turn a guard green by
 * handing it an empty string.
 */

const REPO_ROOT = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);
const ROUTE_FILE = path.join(REPO_ROOT, "app", "routes", "support.tsx");

const SUPPORT_ADDRESS = "support@creditguardhq.com";

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
 * An anonymous GET carries no session token and no parameters — the loader
 * takes no arguments at all, because this page has no admin entry to redirect.
 */
const renderPage = async () => await loader().text();

/**
 * The document with its stylesheet removed. Copy assertions are about what the
 * page SAYS, and a CSS declaration is not a claim — `100%` in
 * `-webkit-text-size-adjust` is not a statistic.
 */
const renderCopy = async () =>
  (await renderPage()).replace(/<style>[\s\S]*?<\/style>/g, "");

describe("GET /support — response", () => {
  it("returns 200 with no authentication of any kind", () => {
    expect(loader().status).toBe(200);
  });

  it("serves HTML with an explicit charset", () => {
    expect(loader().headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );
  });

  it("is publicly cacheable for an hour", () => {
    expect(loader().headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("returns a complete, standalone HTML document", async () => {
    const html = await renderPage();

    expect(html.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain("<title>Support — Credit Guard: B2B Net Terms</title>");
    expect(html).toContain("</html>");
  });
});

describe("GET /support — factual copy (requirement 1.1.4)", () => {
  it("leads with the support heading and the contact promise", async () => {
    const html = await renderPage();

    expect(html).toContain("<h1>Support</h1>");
    expect(html).toContain(`href="mailto:${SUPPORT_ADDRESS}"`);
    expect(html).toContain("within one business day (AEST)");
  });

  it("lists the four things to include in a support email", async () => {
    const html = await renderPage();

    for (const bullet of [
      "your store's .myshopify.com domain",
      "the company name, as it appears on the Companies page",
      "the order number, if your question is about a particular order",
      "a screenshot, if you have one",
    ]) {
      expect(html, `missing include-in-email bullet: ${bullet}`).toContain(
        bullet,
      );
    }
  });

  it("points at the three in-app surfaces by their real names", async () => {
    const html = await renderPage();

    expect(html).toContain("<h2>Where things are in the app</h2>");
    expect(html).toContain("<strong>Home</strong>");
    expect(html).toContain("<strong>Companies</strong>");
    expect(html).toContain("<strong>Settings</strong>");
  });

  it("answers all six questions the product actually raises", async () => {
    const html = await renderPage();

    for (const question of [
      "Why did a buyer see a credit hold at checkout?",
      "How quickly do balances update?",
      "How do payment reminders work?",
      "What data does Credit Guard store?",
      "What happens when I uninstall?",
      "How is Credit Guard billed?",
    ]) {
      expect(html, `missing FAQ heading: ${question}`).toContain(
        `<h3>${question}</h3>`,
      );
    }
  });

  it("states each load-bearing claim exactly as the code behaves", async () => {
    const html = await renderPage();

    // Function decision order: step 6 (no limit → allow) is checked BEFORE
    // step 7 (overdue → block), so an unlimited company is never held; and an
    // overdue company is held whatever its limit, so raising it cannot help.
    expect(html).toContain("Companies with no credit limit set are never held.");
    expect(html).toContain(
      "raising the limit alone does not clear an overdue hold",
    );
    // reminders.server.ts: DUE_SOON_LEAD_MS and OVERDUE_OFFSET_MS are both 72h,
    // and Shopify's measured limit is one reminder per ORDER per 24 hours.
    expect(html).toContain(
      "72 hours before the due date, on the due date, and 72 hours after it",
    );
    expect(html).toContain(
      "At most one reminder is sent per order in any 24-hour period.",
    );
    // The PII posture: no schema column holds a buyer contact detail.
    expect(html).toContain("never stores buyer contact details");
    // shop-lifecycle.server.ts: redactShop runs on shop/redact, ~T+48h.
    expect(html).toContain("about 48 hours after uninstall");
  });

  it("links the privacy policy and the landing page", async () => {
    const html = await renderPage();

    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/"');
  });

  it("makes no outcome claim and quotes no price", async () => {
    const copy = await renderCopy();

    // 4.3: no fabricated statistics or guaranteed results. Pricing lives on
    // Shopify's hosted plan page; a figure here would only drift from it.
    expect(copy).not.toMatch(/\$\s?\d/);
    expect(copy).not.toMatch(/\bper month\b|\/mo\b|\bUSD\b/i);
    expect(copy).not.toMatch(/\b\d+%/);
  });
});

describe("GET /support — relative links only, no hostname", () => {
  it("names no host except inside the support address", async () => {
    const html = await renderPage();

    const withoutAddress = html.split(SUPPORT_ADDRESS).join("");

    expect(withoutAddress).not.toContain("creditguardhq.com");
  });

  it("references no external origin at all", async () => {
    const html = await renderPage();

    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("cdn.shopify.com");
  });

  it("every href is a site-relative path or a mailto:", async () => {
    const html = await renderPage();

    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href, `${href} must be relative or mailto:`).toMatch(
        /^(\/[^"']*|mailto:[^"']+)$/,
      );
    }
  });
});

describe("GET /support — self-contained, no install path", () => {
  it("loads no stylesheet, script, or image", async () => {
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

  it("offers no install or log-in control of its own", async () => {
    const html = await renderPage();

    // Requirement 2.3.1 applies to every public surface we own, not just the
    // landing page: installation must begin on a Shopify-owned surface.
    expect(html).not.toMatch(/<form\b/i);
    expect(html).not.toMatch(/<input\b/i);
    expect(html).not.toMatch(/<button\b/i);
    expect(html).not.toContain("/auth/login");
  });
});

describe("GET /support — source guards", () => {
  it("is a resource route with no default export", async () => {
    const source = stripComments(await readFile(ROUTE_FILE, "utf8"));

    // Non-triviality anchor first: the shared stripper's contract requires it,
    // so a stripper defect can never satisfy the negative below with "".
    expect(source).toContain("export const loader");
    // A default export would render this through app/root.tsx, which injects a
    // cdn.shopify.com stylesheet link — silently breaking self-containment.
    expect(source).not.toMatch(/export\s+default\b/);
  });

  it("carries no hostname or absolute URL in its source, comments included", async () => {
    const raw = await readFile(ROUTE_FILE, "utf8");

    expect(raw).toContain("export const loader");
    // Read RAW, not stripped: a host left behind in a comment is still a host
    // a later editor will copy into the markup.
    expect(raw.split(SUPPORT_ADDRESS).join("")).not.toContain(
      "creditguardhq.com",
    );
    expect(raw).not.toMatch(/https?:\/\//);
  });

  it("never imports app/shopify.server, directly or transitively", async () => {
    const sources = await transitiveSources(ROUTE_FILE);

    expect(sources.has(ROUTE_FILE)).toBe(true);
    expect(sources.get(ROUTE_FILE)).toContain("export const loader");
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

    expect(sources.get(ROUTE_FILE)).toContain("export const loader");
    for (const [file, source] of sources) {
      expect(
        source,
        `${path.relative(REPO_ROOT, file)} must not authenticate`,
      ).not.toMatch(/\bauthenticate\s*[.(]/);
    }
  });
});
