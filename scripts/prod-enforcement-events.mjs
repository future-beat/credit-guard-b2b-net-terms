/**
 * Print the enforcement event log the production database holds for one shop —
 * every EnforcementEvent row, newest first, with the credit state that drove it
 * (plan 04-05: the ENFC-05 transition evidence and the ENFC-06 leak evidence).
 *
 * Runs INSIDE the Railway container (shipped there by
 * scripts/prod-enforcement-events.sh), because `postgres.railway.internal` only
 * resolves on Railway's private network — DATABASE_URL is never copied to a
 * developer machine (threat T-02-22).
 *
 * READ-ONLY (T-04-17): every Prisma call here is a find or a count. This script
 * makes no Admin API call at all — the event log is entirely ours — so it needs
 * no access token and touches no session row beyond counting nothing.
 *
 * PRIVACY (T-04-18): the rows carry company names (the merchant's own B2B
 * company names, the only way to line a row up against what the admin shows),
 * company/order GIDs and money. No customer name, email, phone or address is
 * stored by this app at all, so none can appear here.
 *
 * MONEY (metafields rule 1 / the ledger's own law): `amount`, `exposure` and
 * `limit` are Decimal(19,4) and are stringified at FULL precision. A null
 * `limit` stays JSON null — observe-only (never set) must remain
 * distinguishable from a 0.00 ceiling (D-02). Nothing is rounded into a
 * comparison here; a mismatch is meant to be visible.
 *
 * The current per-company enforcement state is printed alongside the log,
 * because the two questions asked of this output are always "which transitions
 * fired?" and "where did the company end up?" — and after 04-05's temporary
 * limit drive, "was the fixture restored?".
 *
 * Prints JSON only, so callers can pipe it into `jq`:
 *   scripts/prod-enforcement-events.sh credit-guard-demo.myshopify.com \
 *     | jq '.events[] | {kind, companyName, createdAt, exposure, limit}'
 *
 * Usage (inside the container): node prod-enforcement-events.mjs <shop-domain> [limit]
 */
import { PrismaClient } from "@prisma/client";

const domain = process.argv[2];
if (!domain) {
  process.stderr.write("usage: node prod-enforcement-events.mjs <shop-domain> [limit]\n");
  process.exit(2);
}

const parsedLimit = Number.parseInt(process.argv[3] ?? "200", 10);
const take = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 1000) : 200;

const db = new PrismaClient();

/** Decimal(19,4) at full precision, nulls preserved as nulls. */
const money = (value) => (value === null || value === undefined ? null : value.toFixed(4));

const [events, totalCount, kindGroups, companies] = await Promise.all([
  db.enforcementEvent.findMany({
    where: { shop: domain },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      kind: true,
      companyGid: true,
      companyName: true,
      orderGid: true,
      amount: true,
      channel: true,
      exposure: true,
      limit: true,
      overdue: true,
      bypass: true,
      createdAt: true,
    },
  }),
  db.enforcementEvent.count({ where: { shop: domain } }),
  db.enforcementEvent.groupBy({
    by: ["kind"],
    where: { shop: domain },
    _count: { _all: true },
  }),
  db.company.findMany({
    where: { shop: domain },
    orderBy: { name: "asc" },
    select: {
      companyGid: true,
      name: true,
      exposure: true,
      creditLimit: true,
      overdue: true,
      bypassEnforcement: true,
      blockedState: true,
      recomputedAt: true,
      publishedAt: true,
    },
  }),
]);

/**
 * P4-L1, mirrored from isBlockedState in enforcement.server.ts: blocked iff no
 * bypass AND a limit is set AND (overdue OR exposure >= limit). Recomputed here
 * from the stored numbers purely so a stored `blockedState` that DISAGREES with
 * its own inputs is visible rather than trusted — the one thing a single
 * `blockedState` column cannot tell you about itself.
 */
function derivedBlockedState(company) {
  if (company.bypassEnforcement) return false;
  if (company.creditLimit === null) return false;
  if (company.overdue) return true;
  return company.exposure.comparedTo(company.creditLimit) >= 0;
}

console.log(
  JSON.stringify(
    {
      queriedAt: new Date().toISOString(),
      shop: domain,
      eventCount: totalCount,
      returned: events.length,
      countsByKind: Object.fromEntries(
        kindGroups.map((group) => [group.kind, group._count._all]),
      ),
      companies: companies.map((company) => ({
        name: company.name,
        companyGid: company.companyGid,
        exposure: money(company.exposure),
        creditLimit: money(company.creditLimit),
        overdue: company.overdue,
        bypassEnforcement: company.bypassEnforcement,
        blockedState: company.blockedState,
        derivedBlockedState: derivedBlockedState(company),
        blockedStateAgrees: company.blockedState === derivedBlockedState(company),
        recomputedAt: company.recomputedAt,
        publishedAt: company.publishedAt,
      })),
      events: events.map((event) => ({
        ...event,
        amount: money(event.amount),
        exposure: money(event.exposure),
        limit: money(event.limit),
      })),
    },
    null,
    2,
  ),
);

await db.$disconnect();
