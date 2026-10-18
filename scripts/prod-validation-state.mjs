/**
 * Read the LIVE cart-and-checkout Validation back off one shop and line it up
 * against the production `Shop.validationGid` that is supposed to point at it
 * (plan 04-05, empirical check EC-4).
 *
 * Runs INSIDE the Railway container (shipped there by
 * scripts/prod-validation-state.sh) for the same two reasons prod-ledger-state
 * and prod-credit-metafields do: `postgres.railway.internal` only resolves on
 * Railway's private network, and the shop's offline access token exists only in
 * that database. Neither DATABASE_URL nor the token is ever copied to a
 * developer machine (threats T-02-22, T-03-12, T-04-18).
 *
 * TOKEN DISCIPLINE (T-03-12/T-04-18): this script NEVER READS AN ACCESS TOKEN.
 * Every Admin call goes through `unauthenticated.admin(shop)` — the same
 * library seam app/services/admin-client.server.ts gives the ledger — so the
 * rotating offline token stays inside the library's session handling. The
 * session `scope` string IS printed: it is not a credential, and a missing
 * `write_validations` is the first thing to check when a read-back comes back
 * ACCESS_DENIED.
 *
 * READ-ONLY (T-04-17): every Prisma call is a find, and the two GraphQL
 * documents are queries. This script cannot create, update or delete a
 * Validation, a metafield or a ledger row.
 *
 * WHAT IT PROVES
 *
 *  - EC-4 (registration): the Validation exists on the real store, `enabled` is
 *    true, `blockOnFailure` is the literal FALSE (the ENFC-04 fail-open half),
 *    `shopifyFunction.handle` is credit-guard-validation, and the $app/config_v1
 *    metafield carries the block copy buyers will read.
 *  - A4 (research assumption): whether `write_validations` alone satisfies the
 *    `Query.validations` READ. `accessDenied: true` in the output disproves it —
 *    the fix is a read-scope lockstep addition, not an improvisation here.
 *  - A3 (research assumption): whether the config metafield reached the
 *    Validation at all. Present ⇒ one of the two 04-03 branches (inline
 *    `metafields` on validationCreate, or the metafieldsSet fallback) worked;
 *    which one is recorded by that plan's Sentry breadcrumb, not by this read.
 *  - EC-2 PROXY (namespace omission): the Function's input query reads
 *    `metafield(key: "credit_v1")` with the namespace OMITTED, relying on the
 *    documented "if omitted, the app-reserved namespace is used" behaviour. The
 *    Admin schema documents that argument identically (verified in
 *    app/types/admin-2026-07.schema.json), so this script asks for the same
 *    metafield BOTH ways — explicit `$app` and omitted — and reports each. This
 *    is a PROXY on a different schema, never the proof: only a real blocked
 *    checkout proves the Function's own resolution (a block is impossible on a
 *    null metafield). An omitted-namespace NULL here is a red flag that gates
 *    the storefront matrix, not a verdict on it.
 *
 * The expected-copy comparison is DIAGNOSTIC ONLY. `matchesRegistrationDefaults`
 * exists so an unexpected empty/placeholder string is visible at a glance; it is
 * FALSE BY DESIGN once the merchant edits the copy on the Settings page
 * (ENFC-03). The canonical DEFAULT_MESSAGES home is enforcement.server.ts, and
 * tests/enforcement-registration.test.ts byte-diffs it against the Function's
 * duplicate — nothing here is an authority on that copy.
 *
 * Prints JSON only, so callers can pipe it into `jq`.
 *
 * Usage (inside the container): node prod-validation-state.mjs <shop-domain>
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
  process.stderr.write("usage: node prod-validation-state.mjs <shop-domain>\n");
  process.exit(2);
}

const FUNCTION_HANDLE = "credit-guard-validation";

/**
 * Diagnostic echo of the copy 04-03 registers. NOT a canonical home — see the
 * header. Kept as a literal because this file runs against the compiled bundle
 * inside the container and cannot import the TypeScript service module.
 */
const REGISTRATION_DEFAULTS = {
  over_limit_message:
    "Your company has reached its credit limit with us. To place this order, please contact us or settle open invoices to free up available credit.",
  overdue_message:
    "Your account has overdue invoices. New orders on payment terms are paused until the balance is settled — please contact us to arrange payment.",
};

/**
 * The whole validations population for the shop — ours and every other app's.
 * `first: 50` is the practical maximum (checkout rules are a handful per store)
 * and there is no server-side handle filter (04-RESEARCH Q6), so ours is
 * matched client-side exactly the way ensureValidationRegistered matches it.
 *
 * The config metafield is asked for TWICE per node: once with the explicit
 * `$app` namespace the writer uses, once with the namespace omitted the way the
 * Function's own input query asks. Aliases keep both answers in one round trip.
 */
const VALIDATIONS_QUERY = `#graphql
  query ProdValidationState {
    validations(first: 50) {
      nodes {
        id
        title
        enabled
        blockOnFailure
        shopifyFunction { handle appKey apiType apiVersion }
        explicitConfig: metafield(namespace: "$app", key: "config_v1") {
          value
          type
          updatedAt
        }
        omittedNamespaceConfig: metafield(key: "config_v1") {
          value
          type
          updatedAt
        }
      }
    }
  }
`;

/**
 * EC-2 proxy: the credit_v1 metafield the Function reads at checkout, asked for
 * both ways on the real Company records.
 */
const COMPANY_METAFIELD_PROBE = `#graphql
  query ProdCompanyNamespaceProbe($id: ID!) {
    company(id: $id) {
      id
      name
      explicit: metafield(namespace: "$app", key: "credit_v1") { value updatedAt }
      omittedNamespace: metafield(key: "credit_v1") { value updatedAt }
    }
  }
`;

const db = new PrismaClient();

/**
 * The app's own configuration, mirrored field for field from
 * app/shopify.server.ts — including `expiringOfflineAccessTokens`, without which
 * the library would not refresh the rotated offline token (the 401 measured on
 * 2026-08-19 against this shop). Values all come from the container's own env.
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
    // ACCESS_DENIED is the A4 answer, so it is surfaced by name rather than
    // flattened into a generic failure.
    const accessDenied = body.errors.some(
      (error) =>
        error?.extensions?.code === "ACCESS_DENIED" ||
        /access denied|required access/i.test(String(error?.message ?? "")),
    );
    return { ok: false, accessDenied, graphqlErrors: body.errors };
  }

  return { ok: true, data: body.data ?? null };
}

/** A metafield answer, with its json parsed when it will parse. */
function describeMetafield(metafield) {
  if (!metafield) return { present: false };
  let payload = null;
  let parseError = null;
  try {
    payload = JSON.parse(metafield.value);
  } catch (error) {
    parseError = `${String(error)} :: ${metafield.value}`;
  }
  return {
    present: true,
    type: metafield.type ?? null,
    updatedAt: metafield.updatedAt ?? null,
    ...(parseError === null ? { payload } : { parseError, raw: metafield.value }),
  };
}

const [shopRow, offlineSession, companies] = await Promise.all([
  db.shop.findUnique({
    where: { domain },
    select: {
      domain: true,
      active: true,
      validationGid: true,
      installedAt: true,
      uninstalledAt: true,
    },
  }),
  db.session.findFirst({
    where: { shop: domain, isOnline: false },
    select: { scope: true, expires: true },
  }),
  db.company.findMany({
    where: { shop: domain },
    orderBy: { name: "asc" },
    select: { companyGid: true, name: true },
  }),
]);

const validationsResult = await runQuery(VALIDATIONS_QUERY, {});

const nodes = validationsResult.ok
  ? (validationsResult.data?.validations?.nodes ?? [])
  : [];

/** Ours is the node whose function handle matches — the 04-03 matching rule. */
const ours = nodes.find((node) => node?.shopifyFunction?.handle === FUNCTION_HANDLE) ?? null;

const oursExplicitConfig = ours ? describeMetafield(ours.explicitConfig) : null;
const oursOmittedConfig = ours ? describeMetafield(ours.omittedNamespaceConfig) : null;

const configPayload = oursExplicitConfig?.payload ?? null;

const ec4 = {
  validationFound: ours !== null,
  enabledTrue: ours?.enabled === true,
  // The ENFC-04 half: the literal false, never an omitted-to-default.
  blockOnFailureFalse: ours?.blockOnFailure === false,
  handleMatches: ours?.shopifyFunction?.handle === FUNCTION_HANDLE,
  gidMatchesDatabase:
    ours !== null && shopRow !== null && ours.id === shopRow.validationGid,
  configPresent: oursExplicitConfig?.present === true,
  configVersionIsOne: configPayload?.v === 1,
  configCarriesBothMessages:
    typeof configPayload?.over_limit_message === "string" &&
    configPayload.over_limit_message.length > 0 &&
    typeof configPayload?.overdue_message === "string" &&
    configPayload.overdue_message.length > 0,
  // Diagnostic only — FALSE by design after a merchant edits the copy.
  matchesRegistrationDefaults:
    configPayload?.over_limit_message === REGISTRATION_DEFAULTS.over_limit_message &&
    configPayload?.overdue_message === REGISTRATION_DEFAULTS.overdue_message,
  duplicateOurValidations:
    nodes.filter((node) => node?.shopifyFunction?.handle === FUNCTION_HANDLE).length,
};

/** A4: did `Query.validations` answer under the write scope alone? */
const a4 = {
  validationsQuerySucceeded: validationsResult.ok === true,
  accessDenied: validationsResult.accessDenied === true,
  verdict: validationsResult.ok
    ? "write_validations satisfies Query.validations (A4 holds)"
    : validationsResult.accessDenied
      ? "ACCESS_DENIED — A4 DISPROVEN: a read scope must be added in a four-home lockstep commit + re-consent"
      : "inconclusive — the query failed for a non-scope reason (see graphqlErrors)",
};

/** EC-2 proxy, per company, on the metafield the Function actually reads. */
const namespaceProbe = [];
for (const company of companies) {
  const result = await runQuery(COMPANY_METAFIELD_PROBE, { id: company.companyGid });
  if (!result.ok) {
    namespaceProbe.push({ name: company.name, companyGid: company.companyGid, error: result });
    continue;
  }
  const live = result.data?.company ?? null;
  const explicit = describeMetafield(live?.explicit);
  const omitted = describeMetafield(live?.omittedNamespace);
  namespaceProbe.push({
    name: company.name,
    companyGid: company.companyGid,
    explicitNamespace: explicit,
    omittedNamespace: omitted,
    // The claim under test: omitting the namespace resolves to the same
    // app-reserved container the publisher wrote.
    omittedResolvesToApp:
      explicit.present === true &&
      omitted.present === true &&
      JSON.stringify(explicit.payload ?? null) === JSON.stringify(omitted.payload ?? null),
  });
}

const ec2Proxy = {
  companiesProbed: namespaceProbe.length,
  allOmittedReadsResolved:
    namespaceProbe.length > 0 && namespaceProbe.every((row) => row.omittedResolvesToApp === true),
  validationConfigOmittedResolves:
    oursExplicitConfig?.present === true &&
    oursOmittedConfig?.present === true &&
    JSON.stringify(oursExplicitConfig.payload ?? null) ===
      JSON.stringify(oursOmittedConfig.payload ?? null),
  note: "Admin-API proxy for the Function input query's omitted-namespace read. The behavioural proof is a real blocked checkout — a block is impossible on a null metafield.",
};

console.log(
  JSON.stringify(
    {
      queriedAt: new Date().toISOString(),
      shop: domain,
      apiVersion: ApiVersion.July26,
      sessionScopes: offlineSession ? offlineSession.scope : null,
      sessionTokenExpires: offlineSession ? offlineSession.expires : null,
      database: {
        shopRowPresent: shopRow !== null,
        active: shopRow?.active ?? null,
        validationGid: shopRow?.validationGid ?? null,
      },
      a4,
      ec4,
      ours: ours
        ? {
            id: ours.id,
            title: ours.title,
            enabled: ours.enabled,
            blockOnFailure: ours.blockOnFailure,
            shopifyFunction: ours.shopifyFunction,
            explicitConfig: oursExplicitConfig,
            omittedNamespaceConfig: oursOmittedConfig,
          }
        : null,
      otherValidations: nodes
        .filter((node) => node?.shopifyFunction?.handle !== FUNCTION_HANDLE)
        .map((node) => ({
          id: node.id,
          title: node.title,
          enabled: node.enabled,
          blockOnFailure: node.blockOnFailure,
          handle: node?.shopifyFunction?.handle ?? null,
        })),
      ec2Proxy,
      namespaceProbe,
      ...(validationsResult.ok ? {} : { validationsQueryFailure: validationsResult }),
    },
    null,
    2,
  ),
);

await db.$disconnect();
