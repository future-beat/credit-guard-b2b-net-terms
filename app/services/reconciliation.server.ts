import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/react-router";

import db from "../db.server";
import { enumerateCompanies, ingestCompanyOrders } from "./backfill.server";
import {
  LedgerGraphqlError,
  type OrderForLedgerNode,
  graphqlJson,
  localAttributedCounts,
  recomputeCompany,
  refetchOrderAndRecompute,
  upsertOrderFromSource,
} from "./ledger.server";
import { forEachActiveShop } from "./scheduler.server";

/**
 * Daily source-of-truth reconciliation (LEDG-04) — the universal error absorber.
 *
 * Every "what if a webhook was missed / duplicated / reordered / coalesced /
 * never sent" question about this phase has one answer: this sweep re-derives
 * the ledger from Shopify. Research put it plainly — build reconciliation early,
 * not last, because it is what makes the webhook path allowed to be imperfect.
 *
 * Five passes per shop, everything inside the CF-1 scope set (02-08):
 *
 *   1. CURSOR PAGE. Every order touched since the last run (`updated_at:>=`,
 *      `sortKey: UPDATED_AT`) is upserted from source in PRESERVE mode: known
 *      rows keep their attribution (a money change must never un-attribute an
 *      order — D-01), unknown rows land explicitly UNRESOLVED for the
 *      attribution pass below. The cursor is then advanced to the newest
 *      `updatedAt` seen MINUS a five-minute overlap, so clock skew between
 *      Shopify and this container can never step over an order.
 *   2. DRIFT CHECK. Each touched company's stored exposure is compared with the
 *      freshly recomputed value. A mismatch is a missed webhook, so it is
 *      reported to Sentry as a warning AND corrected — but the correction is
 *      always a full `recomputeCompany`, never arithmetic on the stored number.
 *      Patching a balance by a delta is the drift bug wearing a fix's clothes
 *      (threat T-02-19).
 *   3. ATTRIBUTION PASS. Companies are enumerated (`Company.ordersCount`
 *      riding along); a company's authenticated orders edge is re-paged when
 *      Shopify's count disagrees with the local attributed count, or whenever
 *      ANY row sits UNRESOLVED — the belt over the coincidence where a miss
 *      and a stray cancel out. Appearance on the edge IS the attribution
 *      evidence (D-03), so a webhook-missed attribution heals within one cycle.
 *   4. EXHAUSTION FLIP. After a full enumeration, UNRESOLVED rows that predate
 *      this sweep and were claimed by no company flip to NO_COMPANY — "couldn't
 *      determine" converges to "proven none" (constraint 5). This is the ONLY
 *      writer of that status anywhere in the app; rows refetched during the
 *      sweep are left UNRESOLVED so an in-flight webhook is never raced.
 *   5. OPEN-SCHEDULE PROBE. Some source changes emit nothing at all — an order
 *      deleted or archived produces no update to page over. So every LOCALLY
 *      open order absent from an ids-only open-status probe is refetched
 *      individually, which resolves it to either fresh state or removal.
 *
 * Shops come exclusively from `forEachActiveShop` (CF-3, threat T-02-17); this
 * module must never query the Shop table itself.
 *
 * TWO CADENCES SINCE 06-DEBUG. `runReconciliationSweep` runs all five passes
 * daily. `runAttributionHealSweep` runs pass 3 ALONE every five minutes, and
 * only for a shop that actually has an unresolved net-terms order, so the
 * exposure-understatement window is minutes rather than up to 24h at
 * ~zero steady-state API cost. Pass 4 is deliberately not part of it.
 */

/** `SyncCursor.key` holding this shop's reconciliation watermark. */
export const RECONCILIATION_CURSOR_KEY = "reconciliation";

/**
 * Clock-skew tolerance subtracted from the newest `updatedAt` before it is
 * stored. Overlap costs a handful of redundant, idempotent upserts; a gap costs
 * a silently wrong credit limit.
 */
export const CURSOR_OVERLAP_MS = 5 * 60 * 1000;

/**
 * Open-status filter, identical to the install backfill's. Net-terms orders
 * awaiting payment read `pending`; a partly-settled one reads `partially_paid`.
 * There is no `payment_terms` search filter, so terms are judged after fetch.
 */
export const OPEN_ORDER_STATUS_FILTER =
  "financial_status:pending OR financial_status:partially_paid";

/**
 * Both documents page at `first: 250`, the documented maximum for the orders
 * connection. It is a literal in the query text rather than a constant here
 * because a variable would make the query cost unpredictable to Shopify's
 * calculator without buying anything.
 */

/** Backoff before the single retry of a throttled query. */
const DEFAULT_RETRY_DELAY_MS = 2_000;

/**
 * Guard against an unbounded loop if a page ever reports `hasNextPage` without
 * advancing. 250 pages is 62,500 orders — far past any MVP merchant.
 */
const MAX_PAGES = 250;

/* ------------------------------------------------------------------ *
 * GraphQL documents. Validated against the pinned 2026-07 schema by
 * `npm run graphql-codegen` — the first correctness gate on any field name.
 * ------------------------------------------------------------------ */

/**
 * Every order touched since the cursor, with the full ledger field set so each
 * node can go straight into `upsertOrderFromSource` — the same shape the webhook
 * refetch produces, so there is exactly one order-ingest path.
 *
 * DELIBERATELY selects no attribution field: `purchasingEntity` is scope-trapped
 * behind the excluded `read_customers` (02-05 § CRITICAL FINDING) and in
 * production would poison every daily sweep with an ACCESS_DENIED. Which
 * company an order belongs to is decided exclusively by the authenticated
 * company→orders edge in the attribution pass (D-03). Field selection carries
 * no protected personal data: money, status and dates only.
 */
export const ORDERS_UPDATED_SINCE_QUERY = `#graphql
  query OrdersUpdatedSince($query: String!, $after: String) {
    orders(first: 250, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          updatedAt
          cancelledAt
          displayFinancialStatus
          totalOutstandingSet { shopMoney { amount currencyCode } }
          totalReceivedSet { shopMoney { amount currencyCode } }
          totalRefundedSet { shopMoney { amount currencyCode } }
          paymentTerms {
            id
            paymentTermsType
            paymentTermsName
            dueInDays
            overdue
            paymentSchedules(first: 10) {
              edges {
                node {
                  id
                  dueAt
                  completedAt
                  balanceDue { amount currencyCode }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Ids only. This asks one question — "which orders does Shopify still consider
 * open?" — and the answer is used purely as a set-difference against local open
 * orders, so fetching anything more would be wasted quota.
 */
export const OPEN_ORDER_IDS_PROBE_QUERY = `#graphql
  query OpenOrderIdsProbe($query: String!, $after: String) {
    orders(first: 250, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges { node { id } }
    }
  }
`;

/* ------------------------------------------------------------------ *
 * Response shapes.
 * ------------------------------------------------------------------ */

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface OrdersConnection<TNode> {
  pageInfo: PageInfo;
  edges: { node: TNode }[];
}

interface GraphqlBody<TNode> {
  data?: { orders: OrdersConnection<TNode> } | null;
}

export interface ReconcileOptions {
  /** Evaluation instant — injected so overdue boundaries stay deterministic. */
  now?: Date;
  /** Backoff before the single throttle retry; 0 in tests. */
  retryDelayMs?: number;
}

export interface ReconcileReport {
  shop: string;
  ordersSeen: number;
  companiesRecomputed: number;
  /** Companies whose stored exposure disagreed with the recomputed truth. */
  driftCorrected: number;
  /** Rows the attribution pass healed out of UNRESOLVED/NO_COMPANY. */
  attributed: number;
  /** UNRESOLVED rows proven company-less by the exhaustion flip. */
  flippedNoCompany: number;
  /** Locally-open orders the probe did not return, and so were refetched. */
  probeRefetched: number;
  cursorAdvancedTo: Date | null;
}

/* ------------------------------------------------------------------ *
 * Transport — graphqlJson underneath, one throttle retry on top.
 * ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Shopify signals rate limiting with `extensions.code === "THROTTLED"`. */
function isThrottled(errors: unknown[]): boolean {
  return errors.some((error) => {
    const code = (error as { extensions?: { code?: unknown } })?.extensions?.code;
    if (code === "THROTTLED") return true;
    const message = (error as { message?: unknown })?.message;
    return typeof message === "string" && /throttl/i.test(message);
  });
}

function reportFailure(label: string, shop: string, error: unknown): void {
  Sentry.captureMessage(
    `Reconciliation ${label} failed for ${shop}: ` +
      (error instanceof Error ? error.message : String(error)),
    "error",
  );
}

/**
 * One query over `graphqlJson`, retried once if — and only if — the thrown
 * `LedgerGraphqlError` carries a THROTTLED code. Any other failure (scope
 * trap, malformed document, network) is Sentry-reported and rethrown
 * immediately: a permission failure must never be re-hit hoping it heals.
 *
 * Deliberately NOT a rate-limit governor: at MVP volume the reconciliation costs
 * a few hundred points against a 100/s restore rate, so a single backoff covers
 * the realistic case and a bucket manager would be untested machinery guarding
 * an event that does not happen. A failure that survives the retry is surfaced
 * to Sentry and thrown — a silent partial sweep is worse than a loud missing one.
 */
async function queryWithRetry<TNode>(
  shop: string,
  document: string,
  variables: Record<string, unknown>,
  label: string,
  retryDelayMs: number,
): Promise<OrdersConnection<TNode>> {
  const run = () =>
    graphqlJson<GraphqlBody<TNode>>(shop, document, { variables, label });

  let body: GraphqlBody<TNode>;
  try {
    body = await run();
  } catch (error) {
    if (!(error instanceof LedgerGraphqlError) || !isThrottled(error.errors)) {
      reportFailure(label, shop, error);
      throw error;
    }
    await sleep(retryDelayMs);
    try {
      body = await run();
    } catch (retryError) {
      reportFailure(label, shop, retryError);
      throw retryError;
    }
  }

  const connection = body?.data?.orders;
  if (!connection) {
    const message = `Reconciliation ${label} returned no orders connection for ${shop}`;
    Sentry.captureMessage(message, "error");
    throw new Error(message);
  }

  return connection;
}

/** Page a connection to exhaustion, yielding every node. */
async function collectPages<TNode>(
  shop: string,
  document: string,
  query: string,
  label: string,
  retryDelayMs: number,
  onNode: (node: TNode) => Promise<void> | void,
): Promise<void> {
  let after: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const connection: OrdersConnection<TNode> = await queryWithRetry<TNode>(
      shop,
      document,
      { query, after },
      label,
      retryDelayMs,
    );

    for (const edge of connection.edges) await onNode(edge.node);

    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) return;
    after = connection.pageInfo.endCursor;
  }

  Sentry.captureMessage(
    `Reconciliation ${label} hit the ${MAX_PAGES}-page ceiling for ${shop}`,
    "warning",
  );
}

/* ------------------------------------------------------------------ *
 * Cursor.
 * ------------------------------------------------------------------ */

async function readCursor(shop: string): Promise<Date> {
  const row = await db.syncCursor.findUnique({
    where: { shop_key: { shop, key: RECONCILIATION_CURSOR_KEY } },
  });

  const parsed = row ? new Date(row.value) : null;
  // No cursor yet (or an unreadable one) means the first sweep after install
  // covers all history — which is precisely the safety net D-06 asks for, and
  // it self-limits from the second run onwards.
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(0);
}

async function writeCursor(shop: string, value: Date): Promise<void> {
  await db.syncCursor.upsert({
    where: { shop_key: { shop, key: RECONCILIATION_CURSOR_KEY } },
    update: { value: value.toISOString() },
    create: { shop, key: RECONCILIATION_CURSOR_KEY, value: value.toISOString() },
  });
}

/* ------------------------------------------------------------------ *
 * Attribution pass + exhaustion flip (02-08, WINDOWS defect 5 part 3).
 * ------------------------------------------------------------------ */

/**
 * PASS 3 — heal order→company attribution from the authenticated
 * company→orders edge.
 *
 * SPLIT FROM THE FLIP (06-DEBUG fix 2) so it can also run on the 5-minute
 * `runAttributionHealSweep` tick, where concluding "proven attached to no
 * company" would race Shopify's own edge lag. The heal is idempotent and
 * cadence-free; the flip is not, and stays daily.
 *
 * Every row not currently ATTRIBUTED is a heal candidate — INCLUDING
 * NO_COMPANY rows: the exhaustion verdict is a status, not a tombstone, and a
 * company edge claiming the order later must win (`upsertOrderFromSource`
 * with kind "company" overwrites it). A sticky NO_COMPANY would silently
 * understate exposure forever.
 *
 * The re-page decision per company: Shopify's `Company.ordersCount` versus the
 * local count of rows attributed to that company — plus the belt: whenever ANY
 * row sits UNRESOLVED, every company is re-paged, so a count coincidence
 * (one missed, one strayed) can never suppress the heal. Because that belt
 * guarantees a FULL enumeration whenever anything is UNRESOLVED, an UNRESOLVED
 * row that survives the pass is provably on no company's edge — which is what
 * licenses `flipExhaustedAttribution` below to run after it, and ONLY after it.
 */
export async function healAttribution(
  shop: string,
  now: Date,
): Promise<{ attributed: number }> {
  const candidates = await db.ledgerOrder.findMany({
    where: { shop, attributionStatus: { not: "ATTRIBUTED" } },
    select: { orderGid: true, attributionStatus: true },
  });
  const anyUnresolved = candidates.some(
    (row) => row.attributionStatus === "UNRESOLVED",
  );

  const companies = await enumerateCompanies(shop);

  // Local attributed counts per company gid, to hold the 02-07 invariant
  // `local count(companyId=X) == Company.ordersCount`. Shared with the
  // doorbell retry (ledger.server.ts) so the two can never disagree about
  // which companies are worth paging.
  const localCountByGid = await localAttributedCounts(shop);

  for (const company of companies) {
    const localCount = localCountByGid.get(company.companyGid) ?? 0;
    if (!anyUnresolved && localCount === company.ordersCount) continue;

    await ingestCompanyOrders(shop, company.companyGid);
    // Exposure is only ever written by recomputeCompany, with the injected
    // clock so the overdue boundary stays deterministic (D-04).
    await recomputeCompany(shop, company.companyGid, now);
  }

  let attributed = 0;
  if (candidates.length > 0) {
    attributed = await db.ledgerOrder.count({
      where: {
        shop,
        orderGid: { in: candidates.map((row) => row.orderGid) },
        attributionStatus: "ATTRIBUTED",
      },
    });
  }

  return { attributed };
}

/**
 * PASS 4 — the exhaustion flip. DAILY ONLY, and separated from the heal above
 * for exactly that reason (06-DEBUG fix 2).
 *
 * Licensed by the heal's full enumeration: an UNRESOLVED row that survives it
 * is provably on no company's edge, so "couldn't determine" converges to
 * "proven none" (constraint 5). This is still the ONLY writer of NO_COMPANY
 * anywhere in the app, and NO_COMPANY is still never sticky — a company edge
 * claiming the order later overwrites the verdict.
 *
 * WHY IT MUST NOT RIDE THE 5-MINUTE HEAL. Shopify's company→orders edge trails
 * a fresh order by seconds; a flip on that cadence would mark a minutes-old
 * order "proven attached to no company", self-heal on the next tick, and make
 * `data_complete` and every exposure flicker in front of the merchant.
 * Nothing is gained: the row's exposure contribution is zero either way.
 *
 * The flip is a single `updateMany` gated on `attributionStatus: "UNRESOLVED"`
 * AND either `refetchedAt < sweepStart` OR membership in `scannedGids` — the
 * gids THIS sweep's own cursor scan returned.
 *
 * WHY THE SECOND ARM EXISTS (WINDOWS #10, observed live on #1012 2026-08-20).
 * The gate is there to avoid racing a row refreshed mid-sweep by SOMETHING ELSE
 * — an in-flight webhook whose ingest the enumeration could not have accounted
 * for. A row the sweep's OWN scan refreshed is not that: the full company
 * enumeration that licenses the flip runs AFTER the scan, so such a row was
 * proven unattributable by evidence strictly newer than its own refetch.
 * Excluding it was a starvation bug rather than a safety property: the cursor is
 * advanced to `newestUpdatedAt - CURSOR_OVERLAP_MS`, so the shop's NEWEST order
 * is re-paged by every single sweep, its `refetchedAt` refreshed past every
 * `sweepStart`, and an unattributable one could never converge — it sat
 * UNRESOLVED forever and pinned `data_complete: false` on the dashboard.
 */
async function flipExhaustedAttribution(
  shop: string,
  sweepStart: Date,
  scannedGids: ReadonlySet<string>,
): Promise<number> {
  // Both arms mean "the enumeration above is newer than this row's evidence":
  // it predates the sweep, or the sweep itself is what refreshed it. The OR
  // member is omitted entirely when nothing was scanned, so an empty page can
  // never widen into `in: []` and change the predicate's meaning.
  const flippable: Prisma.LedgerOrderWhereInput[] = [
    { refetchedAt: { lt: sweepStart } },
  ];
  if (scannedGids.size > 0) {
    flippable.push({ orderGid: { in: [...scannedGids] } });
  }

  const flipped = await db.ledgerOrder.updateMany({
    where: {
      shop,
      attributionStatus: "UNRESOLVED",
      OR: flippable,
    },
    data: { attributionStatus: "NO_COMPANY" },
  });

  return flipped.count;
}

/* ------------------------------------------------------------------ *
 * The sweep.
 * ------------------------------------------------------------------ */

/**
 * Re-derive one shop's ledger from Shopify. Safe to run twice — every write is
 * an upsert or a full recompute, so a concurrent duplicate (deploy overlap)
 * lands on the same values.
 */
export async function reconcileShop(
  shop: string,
  options: ReconcileOptions = {},
): Promise<ReconcileReport> {
  // Captured ONCE at entry: the exhaustion flip below only touches rows whose
  // refetchedAt predates this instant, so nothing ingested mid-sweep is raced.
  const sweepStart = new Date();
  const now = options.now ?? new Date();
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const since = await readCursor(shop);
  const touchedCompanies = new Set<string>();
  // Every order gid THIS sweep's cursor scan returned. The attribution pass
  // needs it to tell "refreshed by us, a moment ago" from "refreshed by an
  // in-flight webhook we cannot see" (WINDOWS #10).
  const scannedGids = new Set<string>();
  let ordersSeen = 0;
  let newestUpdatedAt: Date | null = null;

  /* 1. Page every order updated since the cursor — PRESERVE mode: a known
        row keeps its attribution, a new row lands UNRESOLVED for pass 3. */
  await collectPages<OrderForLedgerNode>(
    shop,
    ORDERS_UPDATED_SINCE_QUERY,
    `updated_at:>=${since.toISOString()}`,
    "OrdersUpdatedSince",
    retryDelayMs,
    async (node) => {
      ordersSeen += 1;
      scannedGids.add(node.id);

      const companyGid = await upsertOrderFromSource(shop, node);
      if (companyGid) touchedCompanies.add(companyGid);

      const updatedAt = new Date(node.updatedAt);
      if (
        !Number.isNaN(updatedAt.getTime()) &&
        (!newestUpdatedAt || updatedAt > newestUpdatedAt)
      ) {
        newestUpdatedAt = updatedAt;
      }
    },
  );

  /* 2. Recompute, comparing against what was stored to expose drift. */
  const before = await db.company.findMany({
    where: { shop, companyGid: { in: [...touchedCompanies] } },
    select: { companyGid: true, exposure: true, recomputedAt: true },
  });
  const storedExposure = new Map<string, Prisma.Decimal | null>(
    // A company never recomputed before has no stored truth to disagree with —
    // its 0 is an absence, not drift, and warning about it would bury real
    // alerts under install noise.
    before.map((row) => [row.companyGid, row.recomputedAt ? row.exposure : null]),
  );

  let companiesRecomputed = 0;
  let driftCorrected = 0;

  for (const companyGid of touchedCompanies) {
    const state = await recomputeCompany(shop, companyGid, now);
    if (!state) continue;
    companiesRecomputed += 1;

    const stored = storedExposure.get(companyGid);
    if (stored && !stored.equals(state.exposure)) {
      driftCorrected += 1;
      // The value is already corrected by the recompute above; this alert exists
      // so a systematic webhook gap is visible rather than silently absorbed.
      Sentry.captureMessage(
        `Ledger drift corrected on ${shop} for company ${companyGid}: ` +
          `stored ${stored.toFixed(4)}, recomputed ${state.exposure.toFixed(4)}`,
        "warning",
      );
    }
  }

  /* 3. Advance the cursor — before the attribution pass and the probe, so a
        later failure does not cost the paging work. An empty page leaves it
        exactly where it was. */
  let cursorAdvancedTo: Date | null = null;
  if (newestUpdatedAt) {
    cursorAdvancedTo = new Date(
      (newestUpdatedAt as Date).getTime() - CURSOR_OVERLAP_MS,
    );
    await writeCursor(shop, cursorAdvancedTo);
  }

  /* 4. Attribution pass, then the exhaustion flip the pass licenses. */
  const { attributed } = await healAttribution(shop, now);
  const flippedNoCompany = await flipExhaustedAttribution(
    shop,
    sweepStart,
    scannedGids,
  );

  /* 5. Probe for locally-open orders Shopify no longer reports as open. */
  const probeGids = new Set<string>();
  await collectPages<{ id: string }>(
    shop,
    OPEN_ORDER_IDS_PROBE_QUERY,
    OPEN_ORDER_STATUS_FILTER,
    "OpenOrderIdsProbe",
    retryDelayMs,
    (node) => {
      probeGids.add(node.id);
    },
  );

  const locallyOpen = await db.ledgerOrder.findMany({
    where: { shop, cancelledAt: null, schedules: { some: { completedAt: null } } },
    select: { orderGid: true },
  });

  let probeRefetched = 0;
  for (const { orderGid } of locallyOpen) {
    if (probeGids.has(orderGid)) continue;
    // Resolves to fresh state or to removal — `refetchOrderAndRecompute` only
    // treats a clean null (no GraphQL errors) as a deletion.
    await refetchOrderAndRecompute(shop, orderGid);
    probeRefetched += 1;
  }

  return {
    shop,
    ordersSeen,
    companiesRecomputed,
    driftCorrected,
    attributed,
    flippedNoCompany,
    probeRefetched,
    cursorAdvancedTo,
  };
}

/**
 * The daily task's entry point: reconcile every ACTIVE shop.
 *
 * Shop enumeration goes through `forEachActiveShop` and nowhere else (CF-3),
 * which also means one shop's failure is reported and stepped over rather than
 * abandoning every merchant after it.
 */
export async function runReconciliationSweep(
  options: ReconcileOptions = {},
): Promise<void> {
  await forEachActiveShop(async (shop) => {
    await reconcileShop(shop, options);
  });
}

/**
 * The 5-minute attribution heal (06-DEBUG-ingest-latency fix 2).
 *
 * WHY A SECOND, FASTER TICK EXISTS. Attribution decides whether an order
 * counts toward its company's exposure, and therefore whether the validation
 * Function holds the next checkout. Before this sweep, an order the ingest
 * ladder could not attribute waited for the 03:30Z reconciliation — up to 24h
 * of understated exposure, which is the direction that lets an over-limit
 * buyer through. The rung-1 retry (fix 1) closes that in seconds whenever
 * Shopify rings again; this closes it in ≤5 min when nothing rings at all.
 *
 * WHAT MAKES A 5-MINUTE CADENCE AFFORDABLE. The gate is one indexed read per
 * shop per tick — `LedgerOrder @@index([shop, attributionStatus])`, the same
 * question `shopDataComplete` asks — and a shop with nothing unresolved makes
 * ZERO Admin API calls. Only a shop that is actually missing an attribution
 * pays: one companies page plus one orders page per count-mismatched company.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: the NO_COMPANY exhaustion flip (see
 * `flipExhaustedAttribution`), the cursor scan, and the open-schedule probe.
 * This is the heal, not a fast reconciliation.
 *
 * Shops come from `forEachActiveShop` and nowhere else (CF-3, T-02-17).
 */
export async function runAttributionHealSweep(
  options: ReconcileOptions = {},
): Promise<void> {
  const now = options.now ?? new Date();

  await forEachActiveShop(async (shop) => {
    const unresolvedNetTerms = await db.ledgerOrder.findFirst({
      // Net-terms only: a card-paid D2C order can never contribute exposure
      // (D-02), so an unattributed one is not worth a single API call.
      where: { shop, attributionStatus: "UNRESOLVED", hasPaymentTerms: true },
      select: { id: true },
    });
    if (!unresolvedNetTerms) return;

    await healAttribution(shop, now);
  });
}
