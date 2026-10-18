import * as Sentry from "@sentry/react-router";

import db from "../db.server";
import {
  type LedgerCompanySummary,
  enumerateCompanies,
  forEachCompanyOrder,
  recomputeCompany,
  upsertCompany,
  upsertOrderFromSource,
} from "./ledger.server";

/**
 * Install backfill — day-one balances the merchant can trust (LEDG-01).
 *
 * COMPANY-DRIVEN since 02-07 (WINDOWS defect 5 remedy, part 2): the backfill
 * enumerates companies and ingests each company's orders over the
 * authenticated `company(id){orders}` edge, exactly like the webhook
 * resolution ladder. Attribution is DEFINITIONAL — an order is attributed
 * BECAUSE it appeared on its company's authenticated orders connection —
 * instead of inferential from `purchasingEntity`, the scope-trapped field
 * whose silent production nulls this rework exists to eliminate (02-05
 * SUMMARY § CRITICAL FINDING).
 *
 * The shape of this module is dictated by three rules:
 *
 * 1. NO ORDER-AGE WINDOW, NO STATUS FILTER (D-06). The per-company orders pull
 *    is unconditional: settled and cancelled orders land too (they contribute
 *    zero via the engine's gates), which is what lets a local per-company row
 *    count reconcile against `Company.ordersCount` in 02-08. Narrowing the
 *    pull would make the app understate exposure in its first session — the
 *    single failure mode this whole phase exists to prevent. `read_all_orders`
 *    is what makes the unbounded pull legal in production — see § Production
 *    dependency at the bottom.
 * 2. ONE RECOMPUTE PATH. Every node from the company edge feeds
 *    `upsertOrderFromSource` + `recomputeCompany` — the identical code the
 *    order webhooks use. There is no second implementation of balance math
 *    here, and there must never be.
 * 3. ALL GRAPHQL THROUGH `graphqlJson` (T-02-27). Any `errors[]` on a
 *    ledger-load-bearing response throws `LedgerGraphqlError`, naming the
 *    label, the shop and the missing scope — a permission failure can never
 *    read as absent data. The bulk-operation JSONL channel this replaced had
 *    no errors channel AT ALL, which is exactly how the purchasingEntity
 *    nulls arrived silently.
 *
 * D2C orders no longer enter through the backfill — a company enumeration
 * cannot see them, by definition. They still enter retained-but-excluded via
 * the order webhooks (resolution-ladder rung 3, UNRESOLVED → NO_COMPANY at
 * reconciliation). Exposure arithmetic is identical either way: a D2C order
 * has never contributed a cent (D-02: no terms, no exposure).
 *
 * Everything is keyed by shop domain — from the authenticated session or from
 * `authenticate.webhook`, never from a body (T-02-16).
 */

/* ------------------------------------------------------------------ *
 * GraphQL documents.
 * ------------------------------------------------------------------ */

/**
 * The company enumeration MOVED to ledger.server.ts (06-DEBUG fix 1): the
 * ingest ladder now re-attempts attribution on later doorbells and needs it,
 * and ledger.server.ts importing this module would be a cycle. Re-exported
 * from here because this is where 02-07/02-08 and their suites reach for it.
 */
export {
  COMPANIES_FOR_LEDGER_QUERY,
  enumerateCompanies,
  type LedgerCompanySummary,
} from "./ledger.server";

/* ------------------------------------------------------------------ *
 * Status machine, stored on SyncCursor.
 * ------------------------------------------------------------------ */

export const BACKFILL_CURSOR_KEY = "backfill";
export const RECONCILIATION_CURSOR_KEY = "reconciliation";

/** How long a `running` backfill may sit untouched before the poll re-checks it. */
export const STALE_AFTER_MS = 10 * 60 * 1000;

/** Overlap subtracted from the reconciliation start point (clock-skew tolerance). */
const RECONCILIATION_OVERLAP_MS = 5 * 60 * 1000;

export type BackfillStatus = "running" | "completed" | "failed";

/**
 * The value stored at `SyncCursor[shop, "backfill"]`, JSON-encoded.
 *
 * `status` is serialised FIRST on purpose: the failed-run re-claim below matches
 * on the `"status":"failed"` substring, which is only stable if the key order is.
 * 02-05's production-state script reads this shape.
 */
export interface BackfillState {
  status: BackfillStatus;
  operationGid: string | null;
  startedAt: string;
  polledAt: string | null;
  completedAt: string | null;
  error: string | null;
  orderCount: number;
  scheduleCount: number;
  companyCount: number;
}

function newRunningState(now: Date): BackfillState {
  return {
    status: "running",
    operationGid: null,
    startedAt: now.toISOString(),
    polledAt: null,
    completedAt: null,
    error: null,
    orderCount: 0,
    scheduleCount: 0,
    companyCount: 0,
  };
}

function serialise(state: BackfillState): string {
  // Explicit key order — see the `status`-first note on BackfillState.
  return JSON.stringify({
    status: state.status,
    operationGid: state.operationGid,
    startedAt: state.startedAt,
    polledAt: state.polledAt,
    completedAt: state.completedAt,
    error: state.error,
    orderCount: state.orderCount,
    scheduleCount: state.scheduleCount,
    companyCount: state.companyCount,
  });
}

export async function readBackfillState(
  shop: string,
): Promise<BackfillState | null> {
  const row = await db.syncCursor.findUnique({
    where: { shop_key: { shop, key: BACKFILL_CURSOR_KEY } },
  });
  if (!row) return null;

  try {
    return JSON.parse(row.value) as BackfillState;
  } catch {
    // A corrupt value must not wedge the install forever — treat it as a failed
    // run so the next admin load re-claims and starts over.
    return {
      ...newRunningState(new Date(0)),
      status: "failed",
      error: "unparseable backfill cursor value",
    };
  }
}

async function writeBackfillState(
  shop: string,
  state: BackfillState,
): Promise<void> {
  const value = serialise(state);
  await db.syncCursor.upsert({
    where: { shop_key: { shop, key: BACKFILL_CURSOR_KEY } },
    update: { value },
    create: { shop, key: BACKFILL_CURSOR_KEY, value },
  });
}

async function patchBackfillState(
  shop: string,
  patch: Partial<BackfillState>,
): Promise<void> {
  const current = await readBackfillState(shop);
  if (!current) return;
  await writeBackfillState(shop, { ...current, ...patch });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Claim the right to run this shop's backfill. Returns false when someone else
 * already owns it.
 *
 * The DATABASE is the lock, not a read-then-write: the `[shop, key]` unique
 * constraint means two concurrent embedded loads race on an INSERT that exactly
 * one of them can win (T-02-14). A previously FAILED run is re-claimable through
 * a single conditional UPDATE, which Postgres serialises on the row — the loser
 * re-evaluates the predicate after the lock and matches nothing.
 */
async function claimBackfill(shop: string, now: Date): Promise<boolean> {
  const fresh = serialise(newRunningState(now));

  try {
    await db.syncCursor.create({
      data: { shop, key: BACKFILL_CURSOR_KEY, value: fresh },
    });
    return true;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const { count } = await db.syncCursor.updateMany({
    where: {
      shop,
      key: BACKFILL_CURSOR_KEY,
      value: { contains: '"status":"failed"' },
    },
    data: { value: fresh },
  });

  return count === 1;
}

async function failBackfill(shop: string, reason: unknown): Promise<void> {
  const message = reason instanceof Error ? reason.message : String(reason);
  reportBackfillError(shop, message, reason);
  await patchBackfillState(shop, {
    status: "failed",
    error: message,
    completedAt: new Date().toISOString(),
  });
}

/**
 * Never swallow. Sentry is initialised out-of-process via
 * `--import ./instrument.server.mjs`; when it is not (tests, scripts),
 * `captureException` is a documented no-op and the console line is the record.
 */
function reportBackfillError(
  shop: string,
  message: string,
  cause?: unknown,
): void {
  console.error(`Backfill error for ${shop}: ${message}`);
  Sentry.captureException(
    cause instanceof Error ? cause : new Error(`${shop}: ${message}`),
  );
}

/* ------------------------------------------------------------------ *
 * In-flight tracking (drain hook).
 * ------------------------------------------------------------------ */

const inFlight = new Set<Promise<unknown>>();

function track<T>(work: Promise<T>): Promise<T> {
  inFlight.add(work);
  void work.catch(() => undefined).finally(() => inFlight.delete(work));
  return work;
}

/**
 * Resolve once no backfill work is outstanding.
 *
 * The install trigger is deliberately fire-and-forget (the embedded shell must
 * render immediately), so something has to be able to wait for it: a SIGTERM
 * handler that wants to drain before exit, and tests that need to assert on a
 * settled world. Registration happens synchronously inside `startBackfill`, so
 * calling this straight after the loader returns is not a race.
 */
export async function awaitBackfillIdle(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
  }
}

/* ------------------------------------------------------------------ *
 * Start.
 * ------------------------------------------------------------------ */

export interface BackfillOutcome {
  started: boolean;
  reason: "started" | "already-completed" | "already-running" | "run-failed";
}

/**
 * Ensure this shop's backfill is progressing. Safe to call on every admin load.
 *
 * Exactly one of three things happens: a first run is claimed and executed to
 * completion inside the tracked promise, an already-completed run is left
 * alone, or an in-progress run that someone else owns gets a staleness check
 * so a died-mid-run backfill cannot strand the install.
 *
 * Synchronous by design — it registers its promise with the drain set BEFORE
 * returning, so `void startBackfill(shop)` in a loader is still observable.
 */
export function startBackfill(
  shop: string,
  now: Date = new Date(),
): Promise<BackfillOutcome> {
  return track(runStartBackfill(shop, now));
}

async function runStartBackfill(
  shop: string,
  now: Date,
): Promise<BackfillOutcome> {
  const existing = await readBackfillState(shop);
  if (existing?.status === "completed") {
    return { started: false, reason: "already-completed" };
  }

  const claimed = await claimBackfill(shop, now);
  if (!claimed) {
    // Another load owns this run. Self-heal rather than doing nothing: if
    // that run died mid-way, this is where the install un-strands itself.
    await runPollBackfillIfStale(shop, now);
    return { started: false, reason: "already-running" };
  }

  try {
    await runCompanyBackfill(shop, now);
    return { started: true, reason: "started" };
  } catch (error) {
    // A LedgerGraphqlError here marks the run failed with the scope-naming
    // message — visible in prod-ledger-state, re-claimable on the next load.
    await failBackfill(shop, error);
    return { started: false, reason: "run-failed" };
  }
}

/**
 * Hand 02-04's daily sweep a start point with five minutes of deliberate
 * overlap, so a clock skew between Shopify and this app cannot open a gap on the
 * very first reconciliation. An empty shop has no order timestamps to anchor to,
 * so it anchors on now instead — the sweep still has somewhere to begin.
 */
async function setReconciliationCursor(
  shop: string,
  maxSourceUpdatedAt: Date | null,
): Promise<void> {
  const anchor = maxSourceUpdatedAt ?? new Date();
  const value = new Date(
    anchor.getTime() - RECONCILIATION_OVERLAP_MS,
  ).toISOString();

  await db.syncCursor.upsert({
    where: { shop_key: { shop, key: RECONCILIATION_CURSOR_KEY } },
    update: { value },
    create: { shop, key: RECONCILIATION_CURSOR_KEY, value },
  });
}

/* ------------------------------------------------------------------ *
 * Company-driven ingestion — the backfill's whole engine (02-07).
 * ------------------------------------------------------------------ */

/**
 * Enumerate + upsert every company head + recompute each, and RETURN the
 * enumeration so callers see the counts.
 *
 * This is what makes a company with no open orders exist at exposure 0 rather
 * than not exist at all — a merchant scanning the AR dashboard must see every
 * customer they extended terms to, including the ones who owe nothing.
 * Recomputing each one is what puts a real `recomputedAt` on the row: "we
 * checked, it is zero", not "we never looked".
 */
export async function syncCompanies(
  shop: string,
  now: Date = new Date(),
): Promise<LedgerCompanySummary[]> {
  const companies = await enumerateCompanies(shop);

  for (const company of companies) {
    await upsertCompany(shop, company.companyGid, company.name);
  }

  for (const company of companies) {
    await recomputeCompany(shop, company.companyGid, now);
  }

  return companies;
}

/** What one company's order ingest touched. */
export interface CompanyIngestResult {
  orders: number;
  schedules: number;
  /** Newest `updatedAt` seen — the reconciliation cursor anchor. */
  maxSourceUpdatedAt: Date | null;
}

/**
 * Ingest EVERY order on one company's authenticated orders edge. Exported for
 * 02-08's reconciliation reuse.
 *
 * The pull is unconditional (D-06): no age window, no financial-status
 * narrowing. Every node lands through `upsertOrderFromSource` with
 * kind "company" — attribution is the appearance on this company's edge, and
 * the company head's name comes from the CompanyOrdersForLedger response the
 * pager reports, never from anywhere less authenticated. The caller owns the
 * recompute (one recompute per touched company, after the ingest).
 */
export async function ingestCompanyOrders(
  shop: string,
  companyGid: string,
): Promise<CompanyIngestResult> {
  let orders = 0;
  let schedules = 0;
  let maxSourceUpdatedAt: Date | null = null;

  await forEachCompanyOrder(shop, companyGid, async (node, companyName) => {
    await upsertOrderFromSource(shop, node, {
      kind: "company",
      companyGid,
      companyName,
      // The company edge names no location; webhook deliveries carry it.
      companyLocationGid: null,
    });

    orders += 1;
    schedules += node.paymentTerms?.paymentSchedules.edges.length ?? 0;

    const updatedAt = new Date(node.updatedAt);
    if (
      !Number.isNaN(updatedAt.getTime()) &&
      (!maxSourceUpdatedAt || updatedAt > maxSourceUpdatedAt)
    ) {
      maxSourceUpdatedAt = updatedAt;
    }
  });

  return { orders, schedules, maxSourceUpdatedAt };
}

/**
 * The whole install backfill, synchronously: enumerate companies, upsert and
 * baseline every head, ingest each company's orders, recompute each touched
 * company, seed the reconciliation cursor, write the completed state.
 *
 * Safe to re-run at any point (the stale-poll self-heal does exactly that):
 * every write is an idempotent upsert or a full recompute, so a re-run over a
 * partially ingested ledger converges instead of double-counting.
 *
 * `now` threads into every recompute so the overdue boundary stays a
 * correctness question tests can sit exactly on (D-04).
 */
export async function runCompanyBackfill(
  shop: string,
  now: Date = new Date(),
): Promise<void> {
  const companies = await syncCompanies(shop, now);

  let orderCount = 0;
  let scheduleCount = 0;
  let maxSourceUpdatedAt: Date | null = null;

  for (const company of companies) {
    const result = await ingestCompanyOrders(shop, company.companyGid);

    orderCount += result.orders;
    scheduleCount += result.schedules;
    if (
      result.maxSourceUpdatedAt &&
      (!maxSourceUpdatedAt || result.maxSourceUpdatedAt > maxSourceUpdatedAt)
    ) {
      maxSourceUpdatedAt = result.maxSourceUpdatedAt;
    }

    // Exposure is only ever written by recomputeCompany, the same function
    // the webhooks call. syncCompanies already baselined the orderless
    // companies; this recomputes the ones whose orders just landed.
    if (result.orders > 0) {
      await recomputeCompany(shop, company.companyGid, now);
    }
  }

  // An empty shop has no order timestamps to anchor on, so it anchors on the
  // injected clock instead of the wall clock — the sweep still has somewhere
  // deterministic to begin (02-03 D11 equivalent).
  await setReconciliationCursor(shop, maxSourceUpdatedAt ?? now);

  const state = await readBackfillState(shop);
  await writeBackfillState(shop, {
    ...(state ?? newRunningState(now)),
    status: "completed",
    // The key survives for scripts/prod-ledger-state.mjs; there is no bulk
    // operation anymore, so the value is now always null.
    operationGid: null,
    completedAt: new Date().toISOString(),
    error: null,
    orderCount,
    scheduleCount,
    companyCount: companies.length,
  });
}

/**
 * Complete a backfill whose owning run died mid-way.
 *
 * A `running` state older than STALE_AFTER_MS means the process that claimed
 * it never finished (deploy restart, crash, container eviction). The work is
 * idempotent by construction, so the self-heal is simply to run it again.
 * Called from the embedded loader, so the worst case for a died run is "the
 * merchant's next visit fixes it" rather than "the install is stranded
 * forever showing no balances".
 */
export function pollBackfillIfStale(
  shop: string,
  now: Date = new Date(),
): Promise<void> {
  return track(runPollBackfillIfStale(shop, now));
}

async function runPollBackfillIfStale(
  shop: string,
  now: Date,
): Promise<void> {
  const state = await readBackfillState(shop);
  if (!state || state.status !== "running") return;

  const lastTouch = Date.parse(state.polledAt ?? state.startedAt);
  if (Number.isFinite(lastTouch) && now.getTime() - lastTouch < STALE_AFTER_MS) {
    return;
  }

  // Stamp the touch FIRST so concurrent loads do not pile re-runs onto one
  // stale state — the next retry window opens STALE_AFTER_MS from here.
  await patchBackfillState(shop, { polledAt: new Date().toISOString() });

  try {
    await runCompanyBackfill(shop, now);
  } catch (error) {
    // Leave the run `running` on a transient failure so the next load
    // retries once the staleness window reopens.
    reportBackfillError(
      shop,
      `stale-backfill re-run failed: ${(error as Error).message}`,
      error,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Production dependency
 * ------------------------------------------------------------------ *
 * `read_all_orders` is granted (02-05) and STILL REQUIRED: without it the
 * company(id){orders} edge silently windows to the most recent 60 days in
 * production and D-06 is violated invisibly — the same stake the old bulk
 * sweep carried. Development stores are exempt, which is why a missing grant
 * would not show up in local testing. The grant is verified live in
 * 02-05-SUMMARY.md and must never be dropped from the requested scope set.
 */
