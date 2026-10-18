/**
 * Clear ONE shop's backfill cursor in the PRODUCTION database, so the next
 * embedded app-open re-runs the company-driven install backfill (02-08,
 * WINDOWS defect 5 staging).
 *
 * Runs INSIDE the Railway container (shipped there by
 * scripts/prod-clear-backfill.sh), because `postgres.railway.internal` only
 * resolves on Railway's private network — DATABASE_URL is never copied to a
 * developer machine (threat T-02-22).
 *
 * This is a production WRITE, so its blast radius is pinned to exactly one row
 * (threat T-02-30): a single `deleteMany` whose where clause carries BOTH the
 * shop domain argument AND the literal "backfill" key. It must never touch the
 * reconciliation cursor, any other shop, or any other key. The before/after
 * state is printed so the operation is auditable from the captured output.
 *
 * Prints JSON only, so callers can pipe it into `jq`.
 *
 * Usage (inside the container): node prod-clear-backfill.mjs <shop-domain>
 */
import { PrismaClient } from "@prisma/client";

const domain = process.argv[2];
if (!domain) {
  process.stderr.write("usage: node prod-clear-backfill.mjs <shop-domain>\n");
  process.exit(2);
}

const db = new PrismaClient();

/** `SyncCursor.key` the embedded loader's backfill claim machine reads. */
const BACKFILL_KEY = "backfill";

/** The backfill cursor value is a JSON string (02-03 § SyncCursor schema). */
function parseBackfill(row) {
  if (!row) return { status: "absent" };
  try {
    return JSON.parse(row.value);
  } catch {
    // A corrupt value is reported as-is rather than crashing the clear: seeing
    // the raw string is what makes the corruption diagnosable.
    return { status: "unparseable", raw: row.value };
  }
}

const readCursor = () =>
  db.syncCursor.findUnique({
    where: { shop_key: { shop: domain, key: BACKFILL_KEY } },
  });

const before = await readCursor();

// The ONLY write in this script: scoped to exactly [shop, "backfill"].
// deleteMany (not delete) so clearing an already-absent cursor is a clean
// no-op ({ cleared: 0 }) instead of a P2025 throw.
const result = await db.syncCursor.deleteMany({
  where: { shop: domain, key: BACKFILL_KEY },
});

const after = await readCursor();

console.log(
  JSON.stringify(
    {
      clearedAt: new Date().toISOString(),
      domain,
      before: parseBackfill(before),
      cleared: result.count,
      after: parseBackfill(after),
    },
    null,
    2,
  ),
);

await db.$disconnect();
