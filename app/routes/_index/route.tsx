/**
 * Public landing page — GET /.
 *
 * This is the bare `application_url` from `shopify.app.toml`
 * (`https://app.creditguardhq.com/`). It is what a Shopify reviewer sees when
 * they open the app URL outside the admin with no `?shop` parameter, so it is
 * reviewed against requirement 1.1.4 (factual information only) and 2.3.1
 * (installation must begin on a Shopify-owned surface). It replaced the app
 * template's placeholder page, which shipped `[your app]` headings, three
 * `Product feature` stubs, and a shop-domain form.
 *
 * FOUR properties of this module are load-bearing; none is incidental.
 *
 * 1. NO SHOP-DOMAIN INPUT, NO INSTALL BUTTON. Requirement 2.3.1 forbids asking
 *    a merchant to type their `.myshopify.com` domain, and installation must
 *    start from the App Store or the admin — never from a control we own. The
 *    template's `<Form action="/auth/login">` is therefore gone for good. The
 *    library's own `/auth/login` fallback still exists for the rare non-admin
 *    entry; nothing here should ever grow back into a second one.
 *
 * 2. FACTUAL COPY ONLY. Every line below describes behaviour this app actually
 *    implements: per-company credit limits, the checkout hold in
 *    `app/services/enforcement.server.ts` (bypass off AND a limit is set AND
 *    the company is over it or overdue), and the three reminder touchpoints in
 *    `app/services/reminders.server.ts` (`dueAt - 72h`, `dueAt`, `dueAt + 72h`).
 *    No outcome claims ("blocked $X"), no statistics, no pricing — pricing lives
 *    on Shopify's hosted plan page, and a figure here would only drift from it.
 *
 * 3. UNAUTHENTICATED. Like `healthz.tsx` and `privacy.tsx`, this module must
 *    never import `app/shopify.server` — directly or transitively. The audience
 *    is an anonymous visitor and a Shopify reviewer, neither of whom holds a
 *    session token, so any authentication turns the `application_url` itself
 *    into a 4xx. Guarded by `tests/landing-route.test.ts`.
 *
 * 4. RESOURCE ROUTE — no default export. A route module WITH a default export
 *    renders through `app/root.tsx`, which injects a stylesheet `<link>` to
 *    cdn.shopify.com. This page stands alone with no external network request,
 *    so it returns a complete HTML document straight from the loader. It also
 *    renders OUTSIDE the admin iframe, where App Bridge — and therefore every
 *    Polaris web component — does not exist. Do not add a default export.
 *
 * The `?shop=` redirect predates this rewrite and is preserved exactly: when
 * Shopify opens the app URL with a shop parameter, that is an admin entry and
 * belongs at `/app`, not on a marketing page.
 */
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

/**
 * Self-contained styling. Every font is a system font and every rule is inline:
 * this page must render correctly with zero external requests, because it is
 * served outside the admin and read by a reviewer who is, by definition,
 * checking what we load.
 */
const STYLES = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 3rem 1.25rem 4rem;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    font-size: 17px;
    line-height: 1.65;
    color: #1a1a1a;
    background: #ffffff;
    -webkit-text-size-adjust: 100%;
  }
  main { max-width: 38rem; margin: 0 auto; }
  h1 { font-size: 1.85rem; line-height: 1.25; margin: 0 0 0.75rem; }
  .lead { font-size: 1.1rem; margin: 0 0 2rem; }
  ul { margin: 0 0 2rem; padding-left: 1.25rem; }
  li { margin-bottom: 0.6rem; }
  .install { margin: 0 0 2.5rem; }
  hr { border: 0; border-top: 1px solid #e0e0e0; margin: 0 0 1.25rem; }
  footer { font-size: 0.95rem; }
  footer p { margin: 0 0 0.4rem; }
  a { color: #1f5eff; }
  @media (prefers-color-scheme: dark) {
    body { color: #e8e8e8; background: #16181a; }
    hr { border-top-color: #33383d; }
    a { color: #7aa2ff; }
  }
`;

/**
 * Rendered once at module load — the page is a constant, so there is nothing
 * per-request to recompute.
 */
const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Credit Guard: B2B Net Terms</title>
<meta name="description" content="Credit limits, checkout credit holds and payment reminders for your B2B net-terms customers." />
<style>${STYLES}</style>
</head>
<body>
<main>
<h1>Credit Guard: B2B Net Terms</h1>
<p class="lead">Credit limits, checkout credit holds and payment reminders for your B2B net-terms customers.</p>
<ul>
<li>Set a credit limit for each company.</li>
<li>Place a credit hold at checkout on payment terms when a company is over its limit or has overdue invoices.</li>
<li>Send payment reminders before the due date, on the due date, and after it.</li>
</ul>
<p class="install">Credit Guard is installed from the Shopify App Store, or from the Apps section of your Shopify admin.</p>
<hr />
<footer>
<p><a href="/privacy">Privacy policy</a> · <a href="/support">Support</a></p>
<p>Support: <a href="mailto:support@creditguardhq.com">support@creditguardhq.com</a></p>
</footer>
</main>
</body>
</html>
`;

export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // An admin entry, not a visit: Shopify opens the app URL with `?shop=`, and
  // that belongs in the embedded app rather than on a marketing page. Preserved
  // from the template unchanged, query string and all.
  if (url.searchParams.get("shop")) {
    return redirect(`/app?${url.searchParams.toString()}`);
  }

  return new Response(LANDING_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The page only changes on deploy, and this URL is fetched by reviewers
      // and crawlers. An hour of caching costs nothing and still lets a
      // correction propagate the same day.
      "Cache-Control": "public, max-age=3600",
    },
  });
};
