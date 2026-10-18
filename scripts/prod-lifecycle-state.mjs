/**
 * Print the lifecycle state the production database holds for one shop domain.
 *
 * Runs INSIDE the Railway container (shipped there by
 * scripts/prod-lifecycle-state.sh), because `postgres.railway.internal` only
 * resolves on Railway's private network — DATABASE_URL is never copied to a
 * developer machine (threat T-01-16).
 *
 * Prints JSON only. Session rows hold access tokens, so they are COUNTED and
 * never selected.
 *
 * Usage (inside the container): node prod-lifecycle-state.mjs <shop-domain>
 */
import { PrismaClient } from "@prisma/client";

const domain = process.argv[2];
if (!domain) {
  process.stderr.write("usage: node prod-lifecycle-state.mjs <shop-domain>\n");
  process.exit(2);
}

const db = new PrismaClient();

const [shops, sessionCount, complianceRequests, allShops, totalSessions, totalRequests] =
  await Promise.all([
    db.shop.findMany({ where: { domain } }),
    db.session.count({ where: { shop: domain } }),
    db.complianceRequest.findMany({
      where: { shop: domain },
      orderBy: { receivedAt: "asc" },
    }),
    db.shop.findMany({ select: { domain: true, active: true } }),
    db.session.count(),
    db.complianceRequest.count(),
  ]);

console.log(
  JSON.stringify(
    {
      queriedAt: new Date().toISOString(),
      domain,
      forDomain: {
        shopRows: shops,
        sessionCount,
        complianceRequestCount: complianceRequests.length,
        complianceRequests,
      },
      wholeDatabase: {
        shopCount: allShops.length,
        shopDomains: allShops,
        sessionCount: totalSessions,
        complianceRequestCount: totalRequests,
      },
    },
    null,
    2,
  ),
);

await db.$disconnect();
