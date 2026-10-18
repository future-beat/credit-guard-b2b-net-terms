/**
 * Public support and FAQ page — GET /support.
 *
 * This is the App Store listing's "Support / FAQ URL", the one listing field
 * that shipped empty at submission (support went out email-only). It is what a
 * merchant opens when something is not behaving as they expect, and what a
 * Shopify reviewer opens to check that the support commitment is real.
 *
 * FOUR properties of this module are load-bearing; none is incidental.
 *
 * 1. UNAUTHENTICATED. Like the landing, privacy and healthz routes, this module
 *    must never import the Shopify app server module — directly or
 *    transitively — and must never authenticate anything. The audience is an
 *    anonymous visitor, who holds no session token, so any authentication turns
 *    the listing's support URL into a 4xx. Guarded by
 *    `tests/support-route.test.ts`, which walks the transitive import graph.
 *
 * 2. RESOURCE ROUTE — no default export. A route module WITH a default export
 *    renders through `app/root.tsx`, which injects a stylesheet link to
 *    Shopify's CDN. This page stands alone with no external network request, so
 *    it returns a complete HTML document straight from the loader. It also
 *    renders OUTSIDE the admin iframe, where App Bridge — and therefore every
 *    Polaris web component — does not exist. Do not add a default export.
 *
 * 3. FACTUAL COPY ONLY (requirement 1.1.4). Every answer below maps to code:
 *    the holds FAQ to the Validation Function's locked decision order (bypass,
 *    then "no limit set" allows, then overdue blocks, then exposure plus cart
 *    against the limit — which is why an unlimited company is never held and
 *    why raising a limit cannot clear an overdue hold); the balance-freshness
 *    FAQ to `recomputeCompany` on the order and payment-terms webhooks, the
 *    five-minute attribution heal, the hourly overdue sweep and the daily
 *    reconciliation; the reminders FAQ to the 72h/due/72h touchpoints, the
 *    default-off switch and the measured one-per-order-per-24h platform limit;
 *    the uninstall FAQ to `redactShop` on `shop/redact` at about T+48h with
 *    reinstall restoring before then; and the billing FAQ to Shopify App
 *    Pricing, whose price and trial live on Shopify's own plan page and are
 *    therefore never quoted here. Editing an answer means checking the code it
 *    describes; the suite pins every load-bearing sentence.
 *
 * 4. NO HOSTNAME, RELATIVE LINKS ONLY. This page may later be served from the
 *    apex domain or from a help subdomain with no code change, so neither this
 *    module nor its output carries a host or an absolute URL of any scheme. The
 *    only occurrence of the domain anywhere here is inside the support email
 *    address. Every link is a site-relative path or a mailto:.
 */

/**
 * Self-contained styling — the landing page's block, widened for prose and
 * extended with the heading and paragraph rules the privacy page uses, since
 * this page is the only public surface with three heading levels. Every font is
 * a system font and every rule is inline: the page must render correctly with
 * zero external requests.
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
  main { max-width: 42rem; margin: 0 auto; }
  h1 { font-size: 1.85rem; line-height: 1.25; margin: 0 0 0.75rem; }
  h2 { font-size: 1.3rem; line-height: 1.3; margin: 2.5rem 0 0.75rem; }
  h3 { font-size: 1.05rem; margin: 1.75rem 0 0.5rem; }
  p { margin: 0 0 1rem; }
  .lead { font-size: 1.1rem; margin: 0 0 2rem; }
  ul { margin: 0 0 1.5rem; padding-left: 1.25rem; }
  li { margin-bottom: 0.6rem; }
  hr { border: 0; border-top: 1px solid #e0e0e0; margin: 2.5rem 0 1.25rem; }
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
const SUPPORT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Support — Credit Guard: B2B Net Terms</title>
<meta name="description" content="Support and frequently asked questions for Credit Guard: B2B Net Terms." />
<style>${STYLES}</style>
</head>
<body>
<main>
<h1>Support</h1>
<p class="lead">Help and frequently asked questions for Credit Guard: B2B Net Terms.</p>

<h2>Contact</h2>
<p>Email <a href="mailto:support@creditguardhq.com">support@creditguardhq.com</a>. We reply within one business day (AEST).</p>
<p>So we can answer in one reply, please include:</p>
<ul>
<li>your store's .myshopify.com domain</li>
<li>the company name, as it appears on the Companies page</li>
<li>the order number, if your question is about a particular order</li>
<li>a screenshot, if you have one</li>
</ul>

<h2>Where things are in the app</h2>
<ul>
<li><strong>Home</strong> (the page headed Credit Guard) — the accounts-receivable dashboard: overdue and upcoming invoices, the companies closest to their limit, and recent credit-hold and reminder activity.</li>
<li><strong>Companies</strong> — each company's credit limit, its Bypass enforcement switch, and its status: Within limit, Over limit, Overdue, or Enforcement bypassed.</li>
<li><strong>Settings</strong> — the Checkout block messages buyers see when an order is held, the current enforcement status, and the Payment reminders switch.</li>
</ul>

<h2>Frequently asked questions</h2>

<h3>Why did a buyer see a credit hold at checkout?</h3>
<p>Credit Guard holds a company's new orders only when all of these are true: the buyer's company has a credit limit set in Credit Guard, the company's Bypass enforcement switch is off, and either the company's outstanding balance plus the new order would go over that limit, or the company has an overdue invoice. Companies with no credit limit set are never held.</p>
<p>To lift a hold, open the Companies page and either raise the company's limit (or remove it, which switches enforcement off for that company) or turn on Bypass enforcement. If the hold is because of an overdue invoice, record the payment in Shopify; raising the limit alone does not clear an overdue hold. Balances recompute automatically — there is nothing to refresh. The wording buyers see is yours to edit on the Settings page, under Checkout block messages.</p>

<h3>How quickly do balances update?</h3>
<p>Credit Guard listens to Shopify's order and payment-terms webhooks and recomputes a company's balance as they arrive, usually within seconds of the change in Shopify. An order that cannot be matched to its company straight away is retried within five minutes. An hourly check catches anything that was missed, and once a day every balance is re-derived from Shopify's records.</p>

<h3>How do payment reminders work?</h3>
<p>Reminders are off by default; you turn them on from the Settings page. Once on, each net-terms invoice attributed to a company is chased at up to three moments: 72 hours before the due date, on the due date, and 72 hours after it. Shopify sends the emails from your store's own email address using your Payment reminder notification template (edited in your Shopify admin under Settings, then Notifications), so the wording is yours, and Credit Guard never sees the recipient. At most one reminder is sent per order in any 24-hour period.</p>

<h3>What data does Credit Guard store?</h3>
<p>Company names and identifiers, order identifiers, amounts, due dates and payment status — what is needed to work out each company's outstanding balance. Credit Guard never stores buyer contact details: no names, email addresses, phone numbers or postal addresses. See the <a href="/privacy">privacy policy</a> for the full list, including where the data is hosted.</p>

<h3>What happens when I uninstall?</h3>
<p>Processing stops straight away: balances are no longer recomputed, no reminders are sent, and checkout holds stop. All data Credit Guard holds for your store is deleted when Shopify sends its shop/redact request, about 48 hours after uninstall. If you reinstall before then, your settings are restored; after that, the app starts fresh.</p>

<h3>How is Credit Guard billed?</h3>
<p>Through Shopify. There is one plan, charged on your Shopify bill; the current price and any free trial are shown on Shopify's plan page when you install. Uninstalling the app ends the subscription.</p>

<hr />
<footer>
<p><a href="/">Credit Guard home</a> · <a href="/privacy">Privacy policy</a></p>
<p>Support: <a href="mailto:support@creditguardhq.com">support@creditguardhq.com</a></p>
</footer>
</main>
</body>
</html>
`;

export const loader = () =>
  new Response(SUPPORT_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The page only changes on deploy, and this URL sits on an app listing
      // where it is fetched by merchants, reviewers and crawlers. An hour of
      // caching costs nothing and still lets a correction propagate the same
      // day.
      "Cache-Control": "public, max-age=3600",
    },
  });
