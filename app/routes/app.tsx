import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Outlet,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import * as Sentry from "@sentry/react-router";

import { authenticate } from "../shopify.server";
import { ensureShopActive } from "../services/shop-lifecycle.server";
import { startBackfill } from "../services/backfill.server";
import { ensureValidationRegistered } from "../services/enforcement.server";

/**
 * This app's handle, kept in lockstep with `handle` in shopify.app.toml. It is
 * the path segment Shopify's plan-selection URL is addressed by, and it is a
 * CONSTANT on purpose: nothing a request carries may ever reach this string.
 */
export const APP_HANDLE = "credit-guard-net-terms";

/**
 * The Shopify-hosted plan-selection page for one store.
 *
 * The store handle is `session.shop` minus the `.myshopify.com` suffix — the
 * session, never `?shop` or any other request input, which an attacker
 * controls and which would turn this into an open redirect (T-06-14).
 */
export function pricingPlansUrl(shopDomain: string): string {
  const storeHandle = shopDomain.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing, redirect } = await authenticate.admin(request);

  // D-06 re-install reactivation. A cheap upsert on every authenticated load is
  // what makes uninstall/re-install painless: the shop's row (and everything
  // hanging off it) survived the uninstall, and this flips it back to active.
  // Keyed on the domain, never on session identity, to match the lifecycle
  // service contract.
  await ensureShopActive(session.shop);

  // LEDG-01 install backfill. Deliberately NOT awaited: the embedded shell has
  // to render immediately, and a bulk operation over a merchant's entire
  // net-terms history is not a page-load-latency budget item. It is also not in
  // the OAuth callback, where a slow start would stall the install itself.
  //
  // Calling this on EVERY authenticated load is the point, not an oversight:
  // `startBackfill` claims the run through a unique constraint, so repeat loads
  // (and concurrent ones) cannot start a second operation — and when a run is
  // already in flight it checks whether that run went stale, which is how a
  // missed `bulk_operations/finish` delivery heals itself.
  void startBackfill(session.shop).catch((error: unknown) => {
    console.error(`Backfill trigger failed for ${session.shop}:`, error);
  });

  // ENFC-01/02 registration ensure-step. Same not-awaited posture and the same
  // reason: a deployed Function does nothing until a Validation object binds it
  // to this merchant's checkout, and the app creates that itself rather than
  // sending merchants into Settings -> Checkout -> Checkout rules.
  //
  // Every authenticated load is again the point. The merchant ACCEPTING the
  // permissions prompt is itself an app-open, so enforcement arms on the very
  // first load after re-consent with no merchant action — and before consent
  // the step's own ACCESS_DENIED handling makes this a Sentry warning, never a
  // broken shell. It is non-throwing by contract; the `.catch` is belt to that
  // module's braces.
  void ensureValidationRegistered(session.shop).catch((error: unknown) => {
    console.error(`Validation registration failed for ${session.shop}:`, error);
  });

  // LNCH-01 subscription gate (D6-01). Pricing is Shopify App Pricing
  // ("managed pricing"): the plan, its price and the 14-day trial live in the
  // App Store listing, and there is ZERO billing configuration in this repo.
  // `billing.check()` still works without one because
  // @shopify/shopify-app-react-router@1.2.1 passes
  // `future: { unstable_managedPricingSupport: true }` unconditionally, which
  // is the exact flag @shopify/shopify-api checks before it would otherwise
  // throw "Attempted to look for purchases without billing configs". It reads
  // `currentAppInstallation { activeSubscriptions }` over Admin GraphQL, and
  // `isTest` defaults to true, so the demo store's $0 contract counts as
  // active. Never add a billing config, `billing.require()` or
  // `billing.request()`: once an app is on App Pricing it may no longer create
  // recurring charges through the Billing API.
  //
  // WHY IT RUNS AFTER THE THREE SIDE EFFECTS ABOVE (RESEARCH Pitfall 7): a
  // merchant's FIRST load is the one most likely to be unsubscribed, and it is
  // also the load that starts their backfill and arms enforcement. Gating those
  // behind the check would mean a merchant returns from Shopify's plan page to
  // an app with no ledger — the work should already be running while they are
  // away.
  //
  // WHY `_top` (and not a plain redirect): the app renders inside an admin
  // iframe, the plan page is outside the app's own scope, and an iframe cannot
  // navigate its parent. Without the target the merchant would get Shopify's
  // page nested in ours, or nothing at all. The listing's welcome link is set
  // to `/app`, so plan selection lands the merchant back on this route.
  //
  // WHY IT FAILS OPEN: a gate that fails CLOSED on a transport error is a
  // lockout. A community report has the subscription read returning 500
  // immediately after plan selection (RESEARCH A2) — precisely when an app
  // reviewer would hit it — and a redirect loop at that moment is a rejection.
  // So: an error is Sentry's problem, and the merchant sees the app. There is
  // deliberately no banner and no billing copy anywhere in this app (UI-SPEC
  // Billing Gate Contract); a merchant cannot act on "billing check failed".
  // The redirect is issued ONLY on a check that SUCCEEDED and said `false` —
  // any other shape falls through and renders.
  //
  // WHY IT IS NOT CACHED (plan-check I-01): this is one Admin GraphQL round
  // trip per embedded document load — every route under `/app` — by design.
  // App Pricing emits NO webhook for subscription changes, so a cached verdict
  // is the only thing that could keep a FROZEN or CANCELLED merchant inside a
  // paid app, and fail-open already absorbs the throttling/outage cost a cache
  // would be buying off. (Route paths are spelled out rather than glob-written
  // anywhere in this file: a glob in a line comment opens a block comment as
  // far as the source guards' comment stripper is concerned.)
  let subscription: { hasActivePayment: boolean } | null = null;
  try {
    subscription = await billing.check();
  } catch (error) {
    Sentry.captureException(error);
  }

  if (subscription?.hasActivePayment === false) {
    return redirect(pricingPlansUrl(session.shop), { target: "_top" });
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      {/*
        06-UI-SPEC.md § Layout & Navigation Contract → Navigation (BFS 4.1.4).
        Exactly two items: Companies and Settings.

        The "Home" slot Phase 1 reserved is RETIRED. The app's name in the admin
        sidebar already links to `/app`, and Built for Shopify 4.1.4 #3 names "a
        separate navigation item in addition to the app name that redirects to
        the app's homepage" as a rejection reason. Renaming it "Dashboard" does
        not cure that — it is still a second item pointing at the homepage — so
        there is no dashboard item at all; the dashboard is reached by clicking
        the app name, which is the admin convention merchants already use.

        A slot is still only consumed once its route exists: Phase 3 filled
        "Companies", plan 04-04 filled "Settings".
      */}
      <s-app-nav>
        <s-link href="/app/companies">Companies</s-link>
        <s-link href="/app/settings">Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

/**
 * One error path for every Phase 1 route (01-UI-SPEC.md Copywriting Contract).
 *
 * Route error *responses* are Shopify's own thrown responses — session-token
 * refresh and auth redirects travel this way — so they must keep going through
 * `boundary.error`, which renders the library's redirect payload. Everything
 * else (loader throw, render crash) gets the documented critical banner.
 *
 * The banner is wrapped in a non-embedded AppProvider because AppProvider is
 * what loads the Polaris web-components script; without it the `s-*` elements
 * here would be undefined and the banner would render invisible. `embedded` is
 * false because the loader failed, so no apiKey is available to boot App Bridge.
 */
export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return boundary.error(error);
  }

  return (
    <AppProvider embedded={false}>
      <s-page heading="Credit Guard">
        <s-section>
          <s-banner tone="critical" heading="Credit Guard couldn't load">
            <s-paragraph>
              Reload the page to try again. If this keeps happening, contact
              support.
            </s-paragraph>
            <s-button
              variant="primary"
              onClick={() => {
                window.location.reload();
              }}
            >
              Reload page
            </s-button>
          </s-banner>
        </s-section>
      </s-page>
    </AppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
