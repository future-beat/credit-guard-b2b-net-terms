/**
 * Read the LIVE `$app`/`credit_v1` metafield back off every real Company record
 * of one shop and line it up against the production database row it projects
 * (plan 03-05 — the ROADMAP gate Phase 4 reads: "the metafield contract must be
 * verifiable on real Company records before Phase 4 starts").
 *
 * Runs INSIDE the Railway container (shipped there by
 * scripts/prod-credit-metafields.sh) for the same two reasons prod-ledger-state
 * does: `postgres.railway.internal` only resolves on Railway's private network,
 * and the shop's offline access token exists only in that database. Neither
 * DATABASE_URL nor the access token is ever copied to a developer machine
 * (threats T-02-22, T-03-12).
 *
 * TOKEN DISCIPLINE (T-03-12): this script NEVER READS AN ACCESS TOKEN AT ALL.
 * The read-back goes through `unauthenticated.admin(shop)` — the same library
 * seam `app/services/admin-client.server.ts` gives the ledger — so the token
 * stays inside the library's session handling and cannot reach a variable here,
 * the output document, a thrown message or stderr. The session's `scope` string
 * IS selected and printed: it is not a credential, and a missing
 * `write_companies` is the first thing to check when a publish failed.
 *
 * That seam is not a convenience — it is CORRECTNESS. The app runs with
 * `future.expiringOfflineAccessTokens` (app/shopify.server.ts), so the offline
 * access token in the Session row EXPIRES (~hourly) and is rotated via the
 * refresh token. A script that read `Session.accessToken` straight out of the
 * database and set its own `X-Shopify-Access-Token` header would get a 401
 * whenever it happened to run after the stored token's `expires` — measured
 * exactly that way on 2026-08-19 against this shop. Going through the library
 * means the read-back is authenticated the same way every production call is.
 *
 * READ-ONLY (T-03-13): every Prisma call here is a find/count, and the single
 * GraphQL document is a query readable under `read_companies`. This script
 * cannot change ledger, company or metafield state.
 *
 * Money is emitted at BOTH scales on purpose: `exposure`/`creditLimit` at the
 * ledger's full Decimal(19,4) precision (no information hidden), and the
 * `match` block compares the published payload against the same values rendered
 * through the contract's own `toFixed(2)` — so a mismatch is reported, never
 * rounded away.
 *
 * Prints JSON only, so callers can pipe it into `jq`.
 *
 * Usage (inside the container): node prod-credit-metafields.mjs <shop-domain>
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
  process.stderr.write("usage: node prod-credit-metafields.mjs <shop-domain>\n");
  process.exit(2);
}


/**
 * Verbatim from 03-RESEARCH.md § "Dev-store verification query". `$app` is the
 * reserved shorthand the publisher writes with — reading it back through the
 * same shorthand is what proves the two agree about where the contract lives.
 */
const COMPANY_CREDIT_METAFIELD_QUERY = `#graphql
  query CompanyCreditMetafield($id: ID!) {
    company(id: $id) {
      id
      name
      metafield(namespace: "$app", key: "credit_v1") { value updatedAt type }
    }
  }
`;

const db = new PrismaClient();

/**
 * The app's own configuration, mirrored field for field from
 * app/shopify.server.ts — including `expiringOfflineAccessTokens`, without which
 * the library would not refresh the rotated offline token. Constructed here
 * rather than imported because that module is TypeScript and the container runs
 * the compiled bundle; the values all come from the container's own env, the
 * same ones the running server booted with.
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
  // banner (`[shopify-api/INFO] version ...`, INFO severity) must not land
  // there — it would make the output unparseable by `jq` and by the plan's own
  // verify gate. Errors and warnings are still surfaced, on stderr.
  logger: {
    log: (severity, message) => {
      if (severity <= 1) process.stderr.write(`[shopify-api] ${message}\n`);
    },
  },
});

const [companies, offlineSession, unresolvedNetTerms] = await Promise.all([
  db.company.findMany({
    where: { shop: domain },
    orderBy: { name: "asc" },
    select: {
      companyGid: true,
      name: true,
      exposure: true,
      overdue: true,
      creditLimit: true,
      bypassEnforcement: true,
      recomputedAt: true,
      publishedAt: true,
    },
  }),
  // `scope` ONLY. The access token is never selected — the library loads the
  // session itself when the read-back client is built (T-03-12).
  db.session.findFirst({
    where: { shop: domain, isOnline: false },
    select: { scope: true, expires: true },
  }),
  // The L-01 predicate, mirrored from metafields.server.ts `shopDataComplete`:
  // the shop's ledger is complete unless some net-terms order is still
  // unattributed. NO_COMPANY rows and card-paid D2C UNRESOLVED rows never flag
  // it, so this is the exact value every payload's data_complete must carry.
  db.ledgerOrder.findFirst({
    where: { shop: domain, attributionStatus: "UNRESOLVED", hasPaymentTerms: true },
    select: { id: true },
  }),
]);

const dataComplete = unresolvedNetTerms === null;

/** The 03-01 dirty marker: never published, or published before the last recompute. */
function isDirty(company) {
  if (company.publishedAt === null) return true;
  if (company.recomputedAt === null) return false;
  return company.publishedAt.getTime() < company.recomputedAt.getTime();
}

const dirtyPublishes = companies.filter(isDirty).length;

/**
 * One read-back. Returns a description of what the live store holds — including
 * the failure shapes — rather than throwing, so one unreachable company cannot
 * hide the state of the rest.
 */
async function readMetafield(companyGid) {
  let body;
  try {
    // The library resolves (and refreshes) the shop's offline session itself.
    const { admin } = await shopify.unauthenticated.admin(domain);
    const response = await admin.graphql(COMPANY_CREDIT_METAFIELD_QUERY, {
      variables: { id: companyGid },
    });
    if (!response.ok) {
      return {
        found: false,
        httpStatus: response.status,
        error: "non-200 from Admin API",
      };
    }
    body = await response.json();
  } catch (error) {
    // Transport or session failure is reported, never swallowed into a passing
    // shape. The library's errors carry no token material.
    return { found: false, error: `read-back failed: ${String(error)}` };
  }

  if (Array.isArray(body.errors) && body.errors.length > 0) {
    return { found: false, graphqlErrors: body.errors };
  }

  const company = body.data?.company ?? null;
  if (!company) {
    return { found: false, error: "company not found on the live store" };
  }

  const metafield = company.metafield ?? null;
  if (!metafield) {
    return { found: false, liveName: company.name };
  }

  let payload = null;
  let parseError = null;
  try {
    payload = JSON.parse(metafield.value);
  } catch (error) {
    // A metafield whose json value will not parse is a contract violation worth
    // seeing verbatim — the raw string is what makes it diagnosable.
    parseError = `${String(error)} :: ${metafield.value}`;
  }

  return {
    found: true,
    type: metafield.type,
    updatedAt: metafield.updatedAt,
    liveName: company.name,
    ...(parseError === null ? { payload } : { parseError, raw: metafield.value }),
  };
}

/**
 * Field-by-field agreement between the live payload and the DB row it projects.
 * Money is compared as the contract's own fixed-2 strings, so "1500" vs
 * "1500.00" is a reported mismatch rather than a numeric coincidence.
 */
function matchReport(company, metafield) {
  if (!metafield.found || !metafield.payload) return null;
  const payload = metafield.payload;
  const expectedLimit =
    company.creditLimit === null ? null : company.creditLimit.toFixed(2);

  return {
    v: payload.v === 1,
    limit: payload.limit === expectedLimit,
    exposure: payload.exposure === company.exposure.toFixed(2),
    overdue: payload.overdue === company.overdue,
    bypass: payload.bypass === company.bypassEnforcement,
    dataComplete: payload.data_complete === dataComplete,
    // The contract's money-is-strings law (metafields rule 1), asserted on the
    // live bytes rather than on a fixture.
    moneyIsString:
      typeof payload.exposure === "string" &&
      (payload.limit === null || typeof payload.limit === "string"),
    computedAtIsIso: typeof payload.computed_at === "string",
  };
}

const results = [];
for (const company of companies) {
  const metafield = await readMetafield(company.companyGid);
  results.push({
    name: company.name,
    companyGid: company.companyGid,
    db: {
      creditLimit:
        company.creditLimit === null ? null : company.creditLimit.toFixed(4),
      bypassEnforcement: company.bypassEnforcement,
      exposure: company.exposure.toFixed(4),
      overdue: company.overdue,
      publishedAt: company.publishedAt,
      recomputedAt: company.recomputedAt,
      dirty: isDirty(company),
    },
    metafield,
    match: matchReport(company, metafield),
  });
}

console.log(
  JSON.stringify(
    {
      queriedAt: new Date().toISOString(),
      shop: domain,
      apiVersion: ApiVersion.July26,
      sessionScopes: offlineSession ? offlineSession.scope : null,
      // Informational: the rotating offline token's current expiry. A past
      // timestamp is NOT a failure here — the library refreshes on use — but it
      // is the first thing to look at if a read-back ever 401s.
      sessionTokenExpires: offlineSession ? offlineSession.expires : null,
      dataComplete,
      dirtyPublishes,
      companyCount: companies.length,
      companies: results,
    },
    null,
    2,
  ),
);

await db.$disconnect();
