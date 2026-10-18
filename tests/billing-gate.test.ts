import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sourceWithoutComments } from "./helpers/module-source";

/**
 * LNCH-01 / D6-01 — the Shopify App Pricing subscription gate in `app.tsx`.
 *
 * The gate is four lines of loader code and every one of its failure modes is a
 * launch-blocker, so this suite pins the behaviour rather than the shape:
 *
 *   1. NO SUBSCRIPTION REDIRECTS THE TOP WINDOW. The embedded iframe cannot
 *      navigate its parent, so a plain `redirect` would render Shopify's plan
 *      page INSIDE our frame (or be refused outright). `target: "_top"` is the
 *      whole feature.
 *   2. THE URL IS BUILT FROM THE SESSION, NEVER FROM REQUEST INPUT. A `?shop=`
 *      on the URL is attacker-controlled; the session shop is not (T-06-14).
 *   3. THE GATE FAILS OPEN. A community report has `activeSubscription`
 *      returning 500 immediately after plan selection (06-RESEARCH A2). A gate
 *      that fails CLOSED there hands the app reviewer an infinite redirect loop
 *      and hands paying merchants a locked door. On any throw the app renders
 *      and Sentry — not the merchant — hears about it (T-06-15).
 *   4. THE SIDE EFFECTS RUN FIRST. `ensureShopActive` / `startBackfill` /
 *      `ensureValidationRegistered` are kicked off BEFORE the check, so a
 *      merchant's very first session still backfills their ledger while they
 *      are away on Shopify's plan page (06-RESEARCH Pitfall 7).
 *
 * The seam is the same one every route suite uses: `authenticate.admin` is
 * stubbed (no suite mints a real session token) and the three service modules
 * are stubbed because this file is about the loader's control flow, not about
 * what those services do. `billing.check` is a `vi.fn()` because the real one
 * is an Admin GraphQL round trip.
 */

const authenticateAdmin = vi.hoisted(() => vi.fn());

vi.mock("../app/shopify.server", () => ({
  authenticate: { admin: authenticateAdmin },
}));

const ensureShopActive = vi.hoisted(() => vi.fn());
const startBackfill = vi.hoisted(() => vi.fn());
const ensureValidationRegistered = vi.hoisted(() => vi.fn());

vi.mock("../app/services/shop-lifecycle.server", () => ({ ensureShopActive }));
vi.mock("../app/services/backfill.server", () => ({ startBackfill }));
vi.mock("../app/services/enforcement.server", () => ({
  ensureValidationRegistered,
}));

const captureException = vi.hoisted(() => vi.fn());
const captureMessage = vi.hoisted(() => vi.fn());

vi.mock("@sentry/react-router", () => ({ captureException, captureMessage }));

const SHOP = "credit-guard-demo.myshopify.com";
const PRICING_URL =
  "https://admin.shopify.com/store/credit-guard-demo/charges/credit-guard-net-terms/pricing_plans";

const check = vi.fn();
const redirect = vi.fn();

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

beforeEach(() => {
  vi.clearAllMocks();

  // The two not-awaited side effects are called as `void fn(...).catch(...)`,
  // so the stubs must return promises or the loader itself would throw.
  ensureShopActive.mockResolvedValue(undefined);
  startBackfill.mockResolvedValue(undefined);
  ensureValidationRegistered.mockResolvedValue(undefined);

  check.mockResolvedValue({ hasActivePayment: true, appSubscriptions: [] });
  redirect.mockImplementation(
    (url: string) =>
      new Response(null, { status: 302, headers: { Location: url } }),
  );
  authenticateAdmin.mockResolvedValue({
    session: { shop: SHOP },
    billing: { check },
    redirect,
  });
});

async function runLoader(url = "https://app.creditguard.test/app") {
  const { loader } = await import("../app/routes/app");
  return loader({
    request: new Request(url),
    params: {},
    context: {},
  } as unknown as LoaderFunctionArgs);
}

/** The render payload, once we have established it is not a redirect. */
function asPayload(result: unknown): { apiKey: string } {
  expect(result).not.toBeInstanceOf(Response);
  return result as { apiKey: string };
}

/* ------------------------------------------------------------------ *
 * The gate
 * ------------------------------------------------------------------ */

describe("billing gate", () => {
  it("redirects the TOP window to the plan page when there is no subscription", async () => {
    check.mockResolvedValue({ hasActivePayment: false, appSubscriptions: [] });

    const result = await runLoader();

    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith(PRICING_URL, { target: "_top" });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("Location")).toBe(PRICING_URL);
  });

  it("renders the app untouched when a subscription is active", async () => {
    check.mockResolvedValue({
      hasActivePayment: true,
      appSubscriptions: [{ id: "gid://shopify/AppSubscription/1" }],
    });

    const result = await runLoader();

    expect(redirect).not.toHaveBeenCalled();
    expect(asPayload(result).apiKey).toBe("test-api-key");
  });

  it("fails OPEN when billing.check throws: app renders, Sentry hears it, merchant sees nothing", async () => {
    const error = new Error("billing unavailable");
    check.mockRejectedValue(error);

    const result = await runLoader();

    expect(redirect).not.toHaveBeenCalled();
    expect(asPayload(result).apiKey).toBe("test-api-key");
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error);
  });

  it("kicks off all three side effects BEFORE the billing check", async () => {
    check.mockResolvedValue({ hasActivePayment: false, appSubscriptions: [] });

    await runLoader();

    const checkOrder = check.mock.invocationCallOrder[0];
    expect(ensureShopActive.mock.invocationCallOrder[0]).toBeLessThan(
      checkOrder,
    );
    expect(startBackfill.mock.invocationCallOrder[0]).toBeLessThan(checkOrder);
    expect(ensureValidationRegistered.mock.invocationCallOrder[0]).toBeLessThan(
      checkOrder,
    );
  });

  it("builds the store handle from the session, never from a forged ?shop", async () => {
    check.mockResolvedValue({ hasActivePayment: false, appSubscriptions: [] });

    await runLoader(
      "https://app.creditguard.test/app?shop=evil-store.myshopify.com",
    );

    expect(redirect).toHaveBeenCalledWith(PRICING_URL, { target: "_top" });
  });

  it("exposes a pure plan-page URL builder that strips only the myshopify suffix", async () => {
    const { pricingPlansUrl, APP_HANDLE } = await import("../app/routes/app");

    expect(APP_HANDLE).toBe("credit-guard-net-terms");
    expect(pricingPlansUrl("another-store.myshopify.com")).toBe(
      "https://admin.shopify.com/store/another-store/charges/credit-guard-net-terms/pricing_plans",
    );
  });
});

/* ------------------------------------------------------------------ *
 * Source guards
 * ------------------------------------------------------------------ */

describe("source guards", () => {
  const routeSource = sourceWithoutComments("app/routes/app.tsx");
  const serverSource = sourceWithoutComments("app/shopify.server.ts");

  it("has exactly two nav links, Companies and Settings (BFS 4.1.4 #3)", () => {
    const navMatch = routeSource.match(/<s-app-nav>([\s\S]*?)<\/s-app-nav>/);
    expect(navMatch).not.toBeNull();

    const nav = navMatch![1];
    const hrefs = [...nav.matchAll(/<s-link\s+href="([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(hrefs).toEqual(["/app/companies", "/app/settings"]);
  });

  it("has no link back to the app home — the app name in the sidebar IS that link", () => {
    expect(routeSource).not.toContain('href="/app"');
  });

  it("uses the managed App Pricing read, never a Billing API mutation", () => {
    expect(routeSource).toContain("billing.check()");
    expect(routeSource).not.toContain("billing.require");
    expect(routeSource).not.toContain("billing.request");
    expect(routeSource).not.toContain("appSubscriptionCreate");
  });

  it("keeps ZERO billing configuration in shopify.server.ts (D6-01)", () => {
    // `billing.check()` works with no config only because the app library
    // force-enables `unstable_managedPricingSupport`. A billing config object
    // here would opt the app back into the Billing API it can no longer use.
    expect(serverSource).not.toMatch(/\bbilling\b/);
  });
});
