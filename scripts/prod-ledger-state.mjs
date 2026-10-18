/**
 * Print the AR-ledger state the production database holds for one shop domain.
 *
 * Runs INSIDE the Railway container (shipped there by
 * scripts/prod-ledger-state.sh), because `postgres.railway.internal` only
 * resolves on Railway's private network — DATABASE_URL is never copied to a
 * developer machine (threat T-02-22).
 *
 * Prints JSON only, so callers can pipe it into `jq`. Session rows hold access
 * tokens, so they are COUNTED and never selected. Company names ARE selected:
 * they are the merchant's own B2B company names and are the only way to line a
 * row up against what the admin shows (phase success criterion 1). No customer
 * name, email, phone or address is stored by this app at all.
 *
 * Usage (inside the container): node prod-ledger-state.mjs <shop-domain>
 */
import { PrismaClient } from "@prisma/client";

const domain = process.argv[2];
if (!domain) {
  process.stderr.write("usage: node prod-ledger-state.mjs <shop-domain>\n");
  process.exit(2);
}

const db = new PrismaClient();

/** The backfill cursor value is a JSON string (02-03 § SyncCursor schema). */
function parseBackfill(row) {
  if (!row) return { status: "absent" };
  try {
    return JSON.parse(row.value);
  } catch {
    // A corrupt value is reported as-is rather than crashing the query: seeing
    // the raw string is what makes the corruption diagnosable.
    return { status: "unparseable", raw: row.value };
  }
}

const [
  shops,
  sessionCount,
  companies,
  orderCount,
  scheduleCount,
  receiptCount,
  unprocessedReceiptCount,
  recentReceipts,
  cursors,
  leases,
  openOrderCount,
  attributionGroups,
  offlineSession,
  unresolvedNetTerms,
] = await Promise.all([
  db.shop.findMany({ where: { domain } }),
  db.session.count({ where: { shop: domain } }),
  db.company.findMany({
    where: { shop: domain },
    orderBy: { name: "asc" },
    select: {
      companyGid: true,
      name: true,
      exposure: true,
      overdue: true,
      earliestDueAt: true,
      recomputedAt: true,
      // Phase 3 credit-control columns (03-01). `creditLimit` null is the
      // observe-only default (CRED-04) and is deliberately distinct from 0 —
      // the two publish different contracts, so the null is preserved here
      // rather than coalesced to a zero that would read the same.
      creditLimit: true,
      bypassEnforcement: true,
      publishedAt: true,
    },
  }),
  db.ledgerOrder.count({ where: { shop: domain } }),
  db.ledgerSchedule.count({ where: { shop: domain } }),
  db.webhookReceipt.count({ where: { shop: domain } }),
  // A receipt with no processedAt is a delivery that was claimed and never
  // finished — the shape the claim-release fix exists to keep from accumulating.
  db.webhookReceipt.count({ where: { shop: domain, processedAt: null } }),
  db.webhookReceipt.findMany({
    where: { shop: domain },
    orderBy: { receivedAt: "desc" },
    take: 10,
  }),
  db.syncCursor.findMany({ where: { shop: domain } }),
  // Global, not shop-keyed: scheduler leadership across containers (D11).
  db.sweepLease.findMany({ orderBy: { name: "asc" } }),
  db.ledgerOrder.count({
    where: { shop: domain, cancelledAt: null, hasPaymentTerms: true },
  }),
  // Order→company attribution states (02-06/02-08): after the company-driven
  // backfill and one reconciliation, `unresolved` must read 0 and every
  // net-terms order must sit in `attributed` (WINDOWS defect 5 readiness).
  db.ledgerOrder.groupBy({
    by: ["attributionStatus"],
    where: { shop: domain },
    _count: { _all: true },
  }),
  // Scope string only — the session's access token is NEVER selected. The
  // readiness gate asserts the four CF-1 scopes are held before the one-tap
  // backfill re-run is invited.
  db.session.findFirst({
    where: { shop: domain, isOnline: false },
    select: { scope: true },
  }),
  // The L-01 predicate, mirrored from metafields.server.ts `shopDataComplete`:
  // the shop's ledger is complete unless some net-terms order is still
  // unattributed. It is SHOP-scoped, so its value lands in every company's
  // published payload.
  db.ledgerOrder.findFirst({
    where: { shop: domain, attributionStatus: "UNRESOLVED", hasPaymentTerms: true },
    select: { id: true },
  }),
]);

/**
 * The 03-01 dirty marker: a company is dirty when its credit_v1 was never
 * published, or was published BEFORE the last recompute — the exact condition
 * the hourly publish backstop (03-04) exists to clear. A never-recomputed row
 * that has been published is not dirty.
 */
const isDirty = (company) => {
  if (company.publishedAt === null) return true;
  if (company.recomputedAt === null) return false;
  return company.publishedAt.getTime() < company.recomputedAt.getTime();
};

const attributionCount = (status) =>
  attributionGroups.find((group) => group.attributionStatus === status)?._count
    ._all ?? 0;

const cursorFor = (key) => cursors.find((row) => row.key === key) ?? null;
const reconciliation = cursorFor("reconciliation");

console.log(
  JSON.stringify(
    {
      queriedAt: new Date().toISOString(),
      domain,
      shop: {
        rows: shops,
        sessionCount,
        // Phase 6 guided-setup and review bookkeeping (06-05), surfaced as its
        // own block rather than left buried in the full row: these three
        // stamps are what E-2 reads back from production to confirm the review
        // modal actually fired and the guide was completed on a real store.
        // Read-only, like everything else in this probe.
        onboarding: shops.map((row) => ({
          domain: row.domain,
          onboardingReviewedAt: row.onboardingReviewedAt,
          onboardingDismissedAt: row.onboardingDismissedAt,
          reviewPromptedAt: row.reviewPromptedAt,
        })),
      },
      ledger: {
        companyCount: companies.length,
        companies: companies.map((company) => ({
          ...company,
          // Decimal(19,4) — stringified at full precision so a comparison
          // against an admin-shown amount is exact, not float-rounded.
          exposure: company.exposure.toFixed(4),
          // Same treatment, and the null is kept as JSON null: observe-only
          // (never set) must stay distinguishable from a 0 ceiling (D-02).
          creditLimit:
            company.creditLimit === null ? null : company.creditLimit.toFixed(4),
          dirty: isDirty(company),
        })),
        orderCount,
        openTermsOrderCount: openOrderCount,
        scheduleCount,
      },
      webhooks: {
        receiptCount,
        unprocessedReceiptCount,
        recentReceipts,
      },
      attribution: {
        attributed: attributionCount("ATTRIBUTED"),
        unresolved: attributionCount("UNRESOLVED"),
        noCompany: attributionCount("NO_COMPANY"),
      },
      sessionScopes: offlineSession ? offlineSession.scope : null,
      // Phase 3 publish health: how many companies still owe Shopify a
      // credit_v1 write, and the shop-scoped flag every payload carries.
      dirtyPublishes: companies.filter(isDirty).length,
      dataComplete: unresolvedNetTerms === null,
      backfill: parseBackfill(cursorFor("backfill")),
      reconciliation: {
        cursor: reconciliation ? reconciliation.value : null,
        updatedAt: reconciliation ? reconciliation.updatedAt : null,
      },
      sweepLeases: leases,
    },
    null,
    2,
  ),
);

await db.$disconnect();
