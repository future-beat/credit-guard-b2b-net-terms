/**
 * Ask the LIVE Admin API what `billing.check()` would see for one shop — the
 * App Pricing subscription state the LNCH-01 gate in app/routes/app.tsx keys on
 * (plan 06-04; empirical check E-1 in 06-06).
 *
 * WHY THIS EXISTS. The gate redirects a merchant to Shopify's plan page when
 * `billing.check()` reports no active payment. That is only safe if the Admin
 * API actually reports the App Pricing contract a merchant just selected —
 * Shopify's App Pricing docs say subscription status comes from the PARTNER API
 * `activeSubscription`, while Shopify's own React Router guide gates on the
 * ADMIN API through `billing.check()` (06-RESEARCH § LNCH-01 Caveats, A2). Both
 * are official; only one is testable from here. So this script reads exactly
 * what `billing.check()` reads, on the real store, BEFORE the gate is deployed.
 * A `wouldPassGate: false` on a store that has selected a plan means the gate
 * must not ship in its current form — which is a thing to learn from a JSON
 * document, not from a merchant locked out of the app.
 *
 * Runs INSIDE the Railway container (shipped there by
 * scripts/prod-billing-state.sh) for the same two reasons every prod-* probe
 * does: `postgres.railway.internal` only resolves on Railway's private network,
 * and the shop's offline access token exists only in that database. Neither
 * DATABASE_URL nor the token is ever copied to a developer machine (threats
 * T-02-22, T-03-12, T-04-18).
 *
 * TOKEN DISCIPLINE (T-06-17): this script NEVER READS AN ACCESS TOKEN. The
 * Admin call goes through `unauthenticated.admin(shop)`, the same library seam
 * app/services/admin-client.server.ts uses, so the rotating offline token stays
 * inside the library's session handling and never reaches stdout. The session
 * `scope` string and expiry ARE printed: neither is a credential, and both are
 * the first thing to check when a read comes back ACCESS_DENIED or 401.
 *
 * READ-ONLY (T-04-17): one Prisma find, one raw SELECT, one GraphQL QUERY. This
 * script cannot create, cancel or modify a subscription — and by design there
 * is no Billing API mutation anywhere in this project: once an app is on
 * Shopify App Pricing it may no longer create recurring charges that way.
 *
 * WHAT IT PROVES
 *
 *  - E-1: after the human selects the plan on credit-guard-demo, does the
 *    Admin API report an active subscription — i.e. would the deployed gate let
 *    the merchant through (`wouldPassGate: true`) or bounce them to the plan
 *    page forever?
 *  - The dev-store $0 path: a same-org development store gets a contract with
 *    effective prices of $0. `test` and the line-item price below show whether
 *    what landed is that $0 contract or a real charge.
 *  - The redirect target the gate would build, printed verbatim, so a 404 on
 *    Shopify's plan page (the documented locale wart, E-4) can be reproduced by
 *    hand from this output.
 *
 * Prints JSON only, so callers can pipe it into `jq`.
 *
 * Usage (inside the container): node prod-billing-state.mjs <shop-domain>
 */
import "@shopify/shopify-app-react-router/adapters/node";
import { PrismaClient } from "@prisma/client";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";

const domain = process.argv[2];
if (!domain) {
  process.stderr.write("usage: node prod-billing-state.mjs <shop-domain>\n");
  process.exit(2);
}

/**
 * Duplicated from app/routes/app.tsx (and shopify.app.toml:5) because this file
 * runs against the compiled bundle inside the container and cannot import the
 * route module. If the handle ever changes, it changes in three places.
 */
const APP_HANDLE = "credit-guard-net-terms";

/**
 * The same read `billing.check()` performs, minus the `oneTimePurchases` page
 * this app can never have (App Pricing has no one-time purchases here, and the
 * Billing API is off the table entirely). `AppSubscriptionFragment`'s fields are
 * spelled out rather than fragment-referenced so the document is legible on its
 * own; `planHandle` and the line-item price are extra, and are what distinguish
 * a $0 development-store contract from a real US$29 charge.
 */
const BILLING_QUERY = `#graphql
  query ProdBillingState {
    currentAppInstallation {
      id
      app { handle title }
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        createdAt
        currentPeriodEnd
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                interval
                planHandle
                price { amount currencyCode }
              }
            }
          }
        }
      }
    }
  }
`;

const db = new PrismaClient();

/**
 * The app's own configuration, mirrored field for field from
 * app/shopify.server.ts — including `expiringOfflineAccessTokens`, without which
 * the library would not refresh the rotated offline token (the 401 measured on
 * 2026-08-19). Values all come from the container's own env.
 *
 * There is deliberately NO `billing` key here, exactly as in the app: the
 * library force-enables `unstable_managedPricingSupport`, which is what makes a
 * config-free subscription read legal in the first place.
 */
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(db),
  distribution: AppDistribution.AppStore,
  future: { expiringOfflineAccessTokens: true },
  // stdout is the JSON document and nothing else, so the library's startup
  // banner must not land there. Errors and warnings still surface, on stderr.
  logger: {
    log: (severity, message) => {
      if (severity <= 1) process.stderr.write(`[shopify-api] ${message}\n`);
    },
  },
});

/** One Admin query, reported rather than thrown — including the failure shapes. */
async function runQuery(document, variables) {
  let body;
  try {
    const { admin } = await shopify.unauthenticated.admin(domain);
    const response = await admin.graphql(document, { variables });
    if (!response.ok) {
      return { ok: false, httpStatus: response.status, error: "non-200 from Admin API" };
    }
    body = await response.json();
  } catch (error) {
    return { ok: false, error: `query failed: ${String(error)}` };
  }

  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const accessDenied = body.errors.some(
      (error) =>
        error?.extensions?.code === "ACCESS_DENIED" ||
        /access denied|required access/i.test(String(error?.message ?? "")),
    );
    return { ok: false, accessDenied, graphqlErrors: body.errors };
  }

  return { ok: true, data: body.data ?? null };
}

/** The recurring price on a subscription, flattened for reading. */
function describePricing(subscription) {
  const details = (subscription?.lineItems ?? [])
    .map((item) => item?.plan?.pricingDetails)
    .filter((pricing) => pricing?.__typename === "AppRecurringPricing");

  return details.map((pricing) => ({
    interval: pricing.interval ?? null,
    planHandle: pricing.planHandle ?? null,
    amount: pricing.price?.amount ?? null,
    currencyCode: pricing.price?.currencyCode ?? null,
  }));
}

const [shopRow, offlineSession, migrations] = await Promise.all([
  db.shop.findUnique({
    where: { domain },
    select: {
      domain: true,
      active: true,
      installedAt: true,
      uninstalledAt: true,
    },
  }),
  db.session.findFirst({
    where: { shop: domain, isOnline: false },
    select: { scope: true, expires: true },
  }),
  // Newest five only: this is a "which build am I talking to" marker, not a
  // migration history. A probe reporting a subscription state from a container
  // running last week's schema is a trap worth closing cheaply.
  db.$queryRawUnsafe(
    `SELECT migration_name, finished_at
       FROM "_prisma_migrations"
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 5`,
  ),
]);

const billingResult = await runQuery(BILLING_QUERY, {});

const installation = billingResult.ok
  ? (billingResult.data?.currentAppInstallation ?? null)
  : null;

const activeSubscriptions = installation?.activeSubscriptions ?? [];

const subscriptions = activeSubscriptions.map((subscription) => ({
  id: subscription.id,
  name: subscription.name,
  status: subscription.status,
  test: subscription.test,
  trialDays: subscription.trialDays,
  createdAt: subscription.createdAt,
  currentPeriodEnd: subscription.currentPeriodEnd,
  pricing: describePricing(subscription),
}));

/**
 * `billing.check()`'s rule, reproduced exactly.
 *
 * With no `plans` filter and `isTest` left at its default of TRUE, its
 * per-subscription predicate `(plans === undefined || plans.includes(name)) &&
 * (isTest || !subscription.test)` is unconditionally true — so `hasActivePayment`
 * is simply "`activeSubscriptions` is non-empty". That is why a development
 * store's $0 contract counts, and it is the whole reason the gate needs no
 * billing configuration. `test` is still reported above, so the difference
 * between a $0 dev contract and a real charge is visible even though the gate
 * does not care.
 *
 * If this is FALSE on a store where a plan was just selected, the gate would
 * bounce that merchant to the plan page on every load: E-1 has failed and the
 * gate must not be deployed (06-06 carries the halt).
 */
const wouldPassGate = subscriptions.length > 0;

const storeHandle = domain.replace(/\.myshopify\.com$/, "");

console.log(
  JSON.stringify(
    {
      queriedAt: new Date().toISOString(),
      shop: domain,
      apiVersion: ApiVersion.July26,
      appHandle: installation?.app?.handle ?? null,
      appHandleMatchesGate: installation?.app?.handle === APP_HANDLE,
      sessionScopes: offlineSession ? offlineSession.scope : null,
      sessionTokenExpires: offlineSession ? offlineSession.expires : null,
      database: {
        shopRowPresent: shopRow !== null,
        active: shopRow?.active ?? null,
        installedAt: shopRow?.installedAt ?? null,
        uninstalledAt: shopRow?.uninstalledAt ?? null,
      },
      migrations,
      installationId: installation?.id ?? null,
      subscriptions,
      wouldPassGate,
      // The exact URL app/routes/app.tsx would send this store to while
      // `wouldPassGate` is false. Open it by hand to reproduce the documented
      // locale 404 (E-4) without deploying anything.
      pricingPlansUrl: `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`,
      ...(billingResult.ok ? {} : { billingQueryFailure: billingResult }),
    },
    null,
    2,
  ),
);

await db.$disconnect();
