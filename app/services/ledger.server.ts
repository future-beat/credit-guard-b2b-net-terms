import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/react-router";

import db from "../db.server";
import { getAdminContext } from "./admin-client.server";
import {
  EVENT_KIND,
  isBlockedState,
  recordEnforcementEvent,
  wouldBlockOrder,
  type EnforcementEventInput,
} from "./enforcement.server";
import { publishCompanyCreditState } from "./metafields.server";

/**
 * AR ledger service — the per-company outstanding-balance engine (LEDG-02,
 * LEDG-03).
 *
 * Three rules hold for every function in this file, and every future caller:
 *
 * 1. RECOMPUTE FROM SOURCE, NEVER INCREMENT. No `balance += delta` exists here
 *    or anywhere downstream. A webhook is a doorbell: it says "order X moved",
 *    and the amount is then read back from the Admin API and the whole company
 *    total is derived again from its stored orders. Incremental arithmetic is
 *    killer bug #2 in the project research — it drifts silently and a wrong
 *    balance blocks a paying merchant's checkout.
 * 2. IDENTITY COMES FROM THE AUTHENTICATED COMPANY→ORDERS EDGE (D-03). An
 *    order keys to a Company only when its gid appears on Shopify's own
 *    `company(id){ orders }` connection (`CompanyOrdersForLedger`). Never the
 *    order's buyer-contact field — on a B2B order it resolves to the person
 *    who placed the order, not the company that owes the money — and never
 *    `Order.purchasingEntity`: that union is scope-trapped behind
 *    `read_customers`, which the CF-1 scope set deliberately excludes, so
 *    Shopify nulls it on EVERY order (02-05 SUMMARY § CRITICAL FINDING). The
 *    intent is unchanged from day one — identity keys to the Company, never to
 *    the buyer contact — only the mechanism moved to the company-side edge.
 *    Enforced by source-guard tests in tests/credit-engine.test.ts and
 *    tests/graphql-error-surfacing.test.ts.
 * 3. ONE RECOMPUTE PATH. Webhooks, the install backfill, the hourly overdue
 *    sweep and the daily reconciliation all funnel through
 *    `recomputeCompany()`, which is the only writer of Company.exposure /
 *    overdue / earliestDueAt. Adding a second writer re-opens rule 1.
 *
 * Money is store currency throughout (D-07): every amount comes from a
 * `shopMoney` field and lands in a `Decimal(19,4)` column. Payment-schedule
 * money is stored but NEVER summed (research Pitfall 4).
 *
 * Every query is keyed by shop domain — the value returned by
 * `authenticate.webhook`, never anything read out of a payload body (T-02-05).
 */

/* ------------------------------------------------------------------ *
 * The one Admin GraphQL document this phase's webhook path uses.
 * ------------------------------------------------------------------ */

/**
 * Refetch of everything the ledger needs about one order.
 *
 * Field selection is deliberately minimal and free of protected personal data:
 * money, dates and payment terms only. It carries NO attribution field at all:
 * `purchasingEntity` requires the excluded `read_customers` scope and is nulled
 * on every order under the CF-1 scope set (02-05 § CRITICAL FINDING), so
 * attribution is established exclusively via `CompanyOrdersForLedger` below.
 * Every remaining field was proven live under the current scopes in the 02-05
 * empirical run (protected-customer-data Level 1, research Pitfall 2).
 */
export const ORDER_FOR_LEDGER_QUERY = `#graphql
  query OrderForLedger($id: ID!) {
    order(id: $id) {
      id
      name
      updatedAt
      cancelledAt
      displayFinancialStatus
      sourceName
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
`;

/* ------------------------------------------------------------------ *
 * Shapes of the refetched order (the contract test fixtures build).
 * ------------------------------------------------------------------ */

export interface ShopMoneyBag {
  shopMoney: { amount: string; currencyCode: string };
}

export interface OrderForLedgerSchedule {
  id: string;
  dueAt: string | null;
  completedAt: string | null;
  balanceDue?: { amount: string; currencyCode: string } | null;
}

export interface OrderForLedgerNode {
  id: string;
  name: string;
  updatedAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  /**
   * The channel the order came in through — `web`, `pos`,
   * `shopify_draft_order`, an app handle. Optional so every Phase 2 fixture
   * built before ENFC-06 still satisfies this shape; absent reads as
   * "unknown", never as a channel.
   */
  sourceName?: string | null;
  totalOutstandingSet: ShopMoneyBag;
  totalReceivedSet?: ShopMoneyBag;
  totalRefundedSet?: ShopMoneyBag;
  paymentTerms: {
    id: string;
    paymentTermsType: string | null;
    paymentTermsName?: string | null;
    dueInDays?: number | null;
    overdue?: boolean | null;
    paymentSchedules: {
      edges: { node: OrderForLedgerSchedule }[];
    };
  } | null;
}

export interface OrderForLedgerResponse {
  data?: { order: OrderForLedgerNode | null } | null;
  errors?: unknown[] | null;
}

/* ------------------------------------------------------------------ *
 * GraphQL transport — errors[] is structurally impossible to swallow.
 * ------------------------------------------------------------------ */

/**
 * A GraphQL `errors[]` array on a ledger-load-bearing response (T-02-27).
 *
 * The live failure this exists for: Shopify answers HTTP 200 with the denied
 * field nulled INSIDE `data` and the real story in `errors[]` — an
 * ACCESS_DENIED that reads exactly like "this order has no company" to any
 * caller that only looks at `data` (WINDOWS defect 5, secondary defect). The
 * message names the label, the shop and, when present, `extensions.code` and
 * `extensions.requiredAccess`, so the next scope trap names itself in the
 * production log instead of masquerading as absent data.
 */
export class LedgerGraphqlError extends Error {
  readonly errors: unknown[];

  constructor(message: string, errors: unknown[]) {
    super(message);
    this.name = "LedgerGraphqlError";
    this.errors = errors;
  }
}

function describeGraphqlErrors(errors: unknown[]): string {
  const notes: string[] = [];
  for (const error of errors) {
    const extensions = (error as { extensions?: Record<string, unknown> })
      ?.extensions;
    const code = extensions?.code;
    if (typeof code === "string" && code.length > 0) notes.push(code);
    const requiredAccess = extensions?.requiredAccess;
    if (typeof requiredAccess === "string" && requiredAccess.length > 0) {
      notes.push(`requires ${requiredAccess}`);
    }
  }
  return notes.length > 0 ? ` [${notes.join("; ")}]` : "";
}

/**
 * THE single Admin GraphQL transport for the ledger. Runs the document over the
 * shop's offline-session client and THROWS `LedgerGraphqlError` whenever the
 * response carries a non-empty `errors` array — a permission failure must never
 * be indistinguishable from "no such object". Every ledger call site goes
 * through here (backfill and reconciliation migrate in 02-07/02-08); nothing in
 * this module may call `getAdminContext(...).graphql` directly anymore.
 *
 * Lives in this module rather than admin-client.server.ts so the established
 * test seam survives unchanged: suites `vi.mock` admin-client.server.ts with a
 * factory exporting only `getAdminContext`, and this function reaches the mock
 * through that import exactly like every previous call site did.
 */
export async function graphqlJson<T>(
  shop: string,
  document: string,
  options: { variables?: Record<string, unknown>; label: string },
): Promise<T> {
  const admin = await getAdminContext(shop);
  const response = await admin.graphql(document, {
    variables: options.variables,
  });
  const body = (await response.json()) as T & { errors?: unknown };

  const errors = Array.isArray(body?.errors) ? (body.errors as unknown[]) : [];
  if (errors.length > 0) {
    throw new LedgerGraphqlError(
      `${options.label} failed for ${shop}${describeGraphqlErrors(errors)}: ` +
        JSON.stringify(errors),
      errors,
    );
  }

  return body;
}

/* ------------------------------------------------------------------ *
 * Company-side attribution — the authenticated company→orders edge.
 * ------------------------------------------------------------------ */

/**
 * One page of a company's own orders, with the SAME field selection as the
 * reduced OrderForLedger so a matched node feeds `upsertOrderFromSource`
 * directly. This is the attribution mechanism (D-03): an order belongs to a
 * company exactly when Shopify lists it on that company's authenticated orders
 * connection — verified working live under the CF-1 scopes on 2026-08-19.
 */
export const COMPANY_ORDERS_FOR_LEDGER_QUERY = `#graphql
  query CompanyOrdersForLedger($id: ID!, $first: Int!, $after: String) {
    company(id: $id) {
      id
      name
      orders(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            name
            updatedAt
            cancelledAt
            displayFinancialStatus
            sourceName
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
  }
`;

export interface CompanyOrdersPage {
  id: string;
  name: string | null;
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: { node: OrderForLedgerNode }[];
  };
}

export interface CompanyOrdersForLedgerResponse {
  data?: { company: CompanyOrdersPage | null } | null;
  errors?: unknown[] | null;
}

/** Documented maximum for the orders connection. */
const COMPANY_ORDERS_PAGE_SIZE = 250;

/**
 * Paging cap for one attribution scan: 40 pages × 250 = 10,000 orders — far
 * past any SMB company. Throwing past it (like syncCompanies' MAX_COMPANY_PAGES
 * guard) turns a pathological company into a redelivered webhook rather than an
 * unbounded loop inside a handler (T-02-28).
 */
export const MAX_ATTRIBUTION_PAGES = 40;

export interface CompanyOrdersScan {
  /** True when `onNode` stopped the scan early (find-and-stop). */
  stoppedEarly: boolean;
  /** Company name from the response; null when Shopify returned no company. */
  companyName: string | null;
}

/**
 * Page a company's authenticated orders edge, invoking `onNode` per node.
 * Stops early when the callback returns true. A gid Shopify knows no company
 * for is NOT an error — the scan reports `companyName: null` and the caller
 * decides (a stale or wrong hint must degrade, not throw — T-02-26).
 */
export async function forEachCompanyOrder(
  shop: string,
  companyGid: string,
  onNode: (
    node: OrderForLedgerNode,
    companyName: string | null,
  ) => Promise<boolean | void> | boolean | void,
): Promise<CompanyOrdersScan> {
  let after: string | null = null;
  let pages = 0;
  let companyName: string | null = null;

  do {
    if (pages >= MAX_ATTRIBUTION_PAGES) {
      throw new Error(
        `CompanyOrdersForLedger exceeded ${MAX_ATTRIBUTION_PAGES} pages for ` +
          `${companyGid} on ${shop}`,
      );
    }
    pages += 1;

    const body: CompanyOrdersForLedgerResponse =
      await graphqlJson<CompanyOrdersForLedgerResponse>(
        shop,
        COMPANY_ORDERS_FOR_LEDGER_QUERY,
        {
          variables: { id: companyGid, first: COMPANY_ORDERS_PAGE_SIZE, after },
          label: "CompanyOrdersForLedger",
        },
      );

    const company: CompanyOrdersPage | null = body?.data?.company ?? null;
    if (!company) return { stoppedEarly: false, companyName: null };
    companyName = company.name ?? companyName;

    for (const edge of company.orders.edges) {
      if ((await onNode(edge.node, companyName)) === true) {
        return { stoppedEarly: true, companyName };
      }
    }

    after = company.orders.pageInfo.hasNextPage
      ? company.orders.pageInfo.endCursor
      : null;
  } while (after);

  return { stoppedEarly: false, companyName };
}

/* ------------------------------------------------------------------ *
 * The company enumeration (02-07, moved here in 06-DEBUG fix 1).
 * ------------------------------------------------------------------ */

/**
 * The company enumeration the backfill walks. `ordersCount { count }` rides
 * along so callers can sanity-check a local per-company row count against
 * Shopify's own total — the reconciliation invariant 02-08 asserts.
 */
export const COMPANIES_FOR_LEDGER_QUERY = `#graphql
  query CompaniesForLedger($first: Int!, $after: String) {
    companies(first: $first, after: $after) {
      edges {
        node {
          id
          name
          ordersCount { count }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/** Documented maximum for the companies connection. */
const COMPANIES_PAGE_SIZE = 250;

/** Guard against a malformed or hostile `companies` response paging forever. */
const MAX_COMPANY_PAGES = 500;

/** One enumerated company, with Shopify's own order total riding along. */
export interface LedgerCompanySummary {
  companyGid: string;
  name: string;
  /** `Company.ordersCount.count` — 02-08's reconciliation invariant anchor. */
  ordersCount: number;
}

interface CompaniesForLedgerResponse {
  data?: {
    companies?: {
      edges: {
        node: {
          id: string;
          name: string | null;
          ordersCount: { count: number } | null;
        };
      }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    } | null;
  } | null;
  errors?: unknown[] | null;
}

/**
 * Page the full company list. Exported for 02-08, which re-walks the same
 * enumeration to reconcile local per-company counts against
 * `Company.ordersCount`. All transport through `graphqlJson` — an `errors[]`
 * page throws rather than reading as an empty shop.
 */
export async function enumerateCompanies(
  shop: string,
): Promise<LedgerCompanySummary[]> {
  const companies: LedgerCompanySummary[] = [];

  let after: string | null = null;
  let pages = 0;

  do {
    if (pages >= MAX_COMPANY_PAGES) {
      throw new Error(
        `CompaniesForLedger exceeded ${MAX_COMPANY_PAGES} pages for ${shop}`,
      );
    }
    pages += 1;

    const body: CompaniesForLedgerResponse =
      await graphqlJson<CompaniesForLedgerResponse>(
        shop,
        COMPANIES_FOR_LEDGER_QUERY,
        {
          variables: { first: COMPANIES_PAGE_SIZE, after },
          label: "CompaniesForLedger",
        },
      );

    const page = body?.data?.companies;
    if (!page) break;

    for (const edge of page.edges) {
      companies.push({
        companyGid: edge.node.id,
        name: edge.node.name ?? edge.node.id,
        ordersCount: edge.node.ordersCount?.count ?? 0,
      });
    }

    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  return companies;
}

/* ------------------------------------------------------------------ *
 * Pure compute core — no I/O, no clock. The correctness of the product.
 * ------------------------------------------------------------------ */

/** Only the two schedule fields the engine reasons about. */
export interface ScheduleStateInput {
  dueAt: Date | null;
  completedAt: Date | null;
}

/**
 * The order fields exposure depends on. Rows loaded via
 * `ledgerOrder.findMany({ include: { schedules: true } })` satisfy this shape
 * directly, and so do plain test fixtures.
 */
export interface OrderStateInput {
  outstandingShop: Prisma.Decimal | string | number;
  currencyCode: string;
  hasPaymentTerms: boolean;
  cancelledAt: Date | null;
  schedules: ScheduleStateInput[];
}

export interface CompanyState {
  /** Store-currency total owed (D-01/D-07). */
  exposure: Prisma.Decimal;
  /** True when any contributing order has an open schedule past its due date. */
  overdue: boolean;
  /** Earliest open due date across contributing orders, past or future. */
  earliestDueAt: Date | null;
  /**
   * True when contributing orders disagree on currency. Never blocks a
   * recompute — it means the shopMoney assumption (D-07) broke and someone
   * should look (research Pitfall 4).
   */
  currencyMismatch: boolean;
}

function isOpen(schedule: ScheduleStateInput): boolean {
  return schedule.completedAt === null || schedule.completedAt === undefined;
}

/**
 * Does this order put credit at risk right now? (D-01 / D-02)
 *
 * Three gates, all of which must hold:
 *  - it has payment terms — no terms means the money was taken up front, so a
 *    card-paid order falls out of exposure naturally rather than by a rule;
 *  - it was not cancelled — a cancelled order is not collectible;
 *  - at least one payment schedule is still open — once every schedule is
 *    completed the order is settled, whatever its outstanding total says.
 */
function contributes(order: OrderStateInput): boolean {
  if (!order.hasPaymentTerms) return false;
  if (order.cancelledAt) return false;
  return order.schedules.some(isOpen);
}

/**
 * Derive a company's credit state from its orders. Pure: same inputs, same
 * output, in any order, forever.
 *
 * `now` is a parameter rather than `Date.now()` on purpose — the "is it overdue
 * yet" boundary is a correctness question the tests must be able to sit exactly
 * on. Overdue is STRICTLY past (D-04): a schedule due at this instant is not yet
 * late.
 *
 * The amount is Shopify's own `totalOutstandingSet.shopMoney` (D-01/D-07),
 * captured per order at refetch time. It already nets partial payments,
 * refunds and order edits, which is why LEDG-03's whole matrix reduces to
 * "trust the refetched number".
 */
export function computeCompanyState(
  orders: OrderStateInput[],
  now: Date,
): CompanyState {
  let exposure = new Prisma.Decimal(0);
  let overdue = false;
  let earliestDueAt: Date | null = null;
  const currencies = new Set<string>();

  for (const order of orders) {
    if (!contributes(order)) continue;

    exposure = exposure.plus(new Prisma.Decimal(order.outstandingShop));
    currencies.add(order.currencyCode);

    for (const schedule of order.schedules) {
      if (!isOpen(schedule) || !schedule.dueAt) continue;

      if (schedule.dueAt.getTime() < now.getTime()) overdue = true;
      if (!earliestDueAt || schedule.dueAt.getTime() < earliestDueAt.getTime()) {
        earliestDueAt = schedule.dueAt;
      }
    }
  }

  return {
    exposure,
    overdue,
    earliestDueAt,
    currencyMismatch: currencies.size > 1,
  };
}

/* ------------------------------------------------------------------ *
 * Persistence — thin wrappers around the pure core.
 * ------------------------------------------------------------------ */

/** Prisma client or an interactive-transaction handle; both expose the models. */
type LedgerDb = Prisma.TransactionClient;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Claim a webhook delivery. Returns false when this exact delivery was already
 * recorded, which is the caller's signal to acknowledge and do nothing
 * (threat T-02-03).
 *
 * The INSERT itself is the lock: the id column is the `X-Shopify-Webhook-Id`
 * value, so two concurrent redeliveries race on a unique constraint rather than
 * on a read-then-write that both would win.
 */
export async function recordWebhookReceipt(
  webhookId: string,
  shop: string,
  topic: string,
): Promise<boolean> {
  try {
    await db.webhookReceipt.create({ data: { id: webhookId, shop, topic } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/**
 * Give an unfinished claim back, so a redelivery of the SAME webhook id is real
 * work instead of a dedupe no-op.
 *
 * `recordWebhookReceipt` claims before the work runs, which is what makes two
 * concurrent copies of one delivery race on the database rather than both
 * proceeding. The cost of claiming first is that a transient failure mid-work
 * (Admin API blip, throttle, lost connection) would otherwise leave a receipt
 * standing for work that never happened: the route returns non-200, Shopify
 * redelivers, and the redelivery is discarded as already-seen. That delivery is
 * then lost until the daily reconciliation — a ≤24h hole on the path this phase
 * exists to keep correct.
 *
 * So a caller that fails MUST release. The `processedAt: null` guard means a
 * finished delivery can never be un-recorded by a late error, and `deleteMany`
 * (not `delete`) keeps a concurrent shop/redact from turning the release into a
 * second throw that would mask the first.
 *
 * Re-doing released work is safe by construction: every ingest path is a refetch
 * from source plus an idempotent upsert, so a half-applied delivery converges on
 * replay rather than double-counting.
 */
export async function releaseWebhookReceipt(webhookId: string): Promise<void> {
  await db.webhookReceipt.deleteMany({
    where: { id: webhookId, processedAt: null },
  });
}

/** Stamp a delivery as fully processed — the "we finished" half of the receipt. */
export async function markWebhookProcessed(webhookId: string): Promise<void> {
  // updateMany, not update: a receipt deleted by a concurrent shop/redact must
  // not turn a successful ingest into a P2025 throw.
  await db.webhookReceipt.updateMany({
    where: { id: webhookId },
    data: { processedAt: new Date() },
  });
}

/**
 * `name === null` means "no usable display name in hand" — NOT "call it the
 * gid".
 *
 * The distinction is load-bearing, and it cost a live company its name to
 * learn (03-05, on the production dev store). Writing `credit_v1` to a Company
 * makes Shopify emit a real `companies/update` delivery ~1.5s later whose
 * payload carries no `name`; when that fell back to the gid, the UPDATE branch
 * overwrote a perfectly good "Acme Supply" with
 * "gid://shopify/Company/7766278377" — so every credit publish silently
 * replaced the merchant's own company names with gids in the dashboard.
 *
 * The gid fallback is therefore a CREATE-only affordance (the column is
 * non-null and a recognisable gid beats an invented friendly string); on
 * UPDATE, an absent name leaves the stored one alone. Nothing is ever
 * "refreshed" to a worse value than it already had.
 */
async function upsertCompanyRow(
  client: LedgerDb,
  shop: string,
  companyGid: string,
  name: string | null,
): Promise<string> {
  const row = await client.company.upsert({
    where: { shop_companyGid: { shop, companyGid } },
    update: name === null ? {} : { name },
    create: { shop, companyGid, name: name ?? companyGid },
  });
  return row.id;
}

/**
 * Create-or-refresh a company head row and return its local id.
 *
 * Exposure fields are deliberately untouched here: only `recomputeCompany()`
 * writes those (rule 3). Wave-2 plans use this from the companies/* webhook and
 * the install backfill.
 */
export async function upsertCompany(
  shop: string,
  companyGid: string,
  name: string | null,
): Promise<string> {
  return upsertCompanyRow(db, shop, companyGid, name);
}

/**
 * Drop a company head row. Its orders survive with `companyId = null` (schema
 * `onDelete: SetNull`) — the order history is still true even once the company
 * record is gone, and nothing null-keyed counts toward any exposure.
 */
export async function deleteCompany(
  shop: string,
  companyGid: string,
): Promise<void> {
  await db.company.deleteMany({ where: { shop, companyGid } });
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

/**
 * How the caller knows which company (if any) an order belongs to.
 *
 * "company" is only ever passed when the order's gid was seen on the
 * authenticated `company(id){orders}` edge (D-03). "unresolved" is the explicit
 * couldn't-determine-yet state — distinct from NO_COMPANY, which means "proven
 * attached to no company" and is written ONLY by the daily reconciliation's
 * exhaustion pass (02-08), never through this module.
 */
export type OrderAttribution =
  | {
      kind: "company";
      companyGid: string;
      companyName: string | null;
      companyLocationGid?: string | null;
    }
  | { kind: "unresolved" };

/**
 * Write one refetched order into the ledger and return the company gid it now
 * belongs to (null when it belongs to none).
 *
 * Attribution semantics:
 *  - kind "company": upsert the company head row in the same transaction and
 *    write companyId + attributionStatus ATTRIBUTED + the location gid.
 *  - kind "unresolved": companyId null, attributionStatus UNRESOLVED, location
 *    null — retained for visibility, contributes nothing to exposure
 *    (Pitfall 7); the daily reconciliation resolves it.
 *  - OMITTED (preserve-mode): on update the three attribution columns are left
 *    exactly as they are — a money refetch must never un-attribute an order —
 *    and on create the row starts unattributed (companyId null, UNRESOLVED).
 *
 * One transaction covers company head, order row and schedules so a concurrent
 * recompute can never observe an order with half its schedules. Schedules are
 * replaced wholesale (deleteMany + createMany) rather than merged: the refetched
 * response IS the truth, and deleteMany — not delete — means a redelivery for
 * rows that are already gone is a no-op instead of a P2025 throw, exactly as
 * `redactShop` does it.
 *
 * LEAKED-ORDER INFERENCE (ENFC-06, P4-L2) also lives here, because attribution
 * time is the ONLY moment the app can answer "would the validation Function
 * have stopped this?" — the company's exposure at that instant has not yet
 * absorbed the order's own contribution, which is exactly the pre-cart state
 * D4-01 compares against. One moment later the recompute folds it in and the
 * comparison is unrecoverable.
 *
 * The DECISION is made inside the transaction (against the pre-order company
 * row) and the WRITE happens after it commits: an event-store blip must never
 * roll back ledger work that is already correct (threat T-04-07). Duplicate-key
 * races from a redelivery land in `recordEnforcementEvent`, which treats them
 * as the dedupe succeeding.
 *
 * Channel context for whoever reads these rows: draft orders arrive with
 * `sourceName` `shopify_draft_order` (the merchant used "Ignore all checkout
 * rules"), POS as `pos`, storefront checkout as `web`. A BYPASSED_ORDER with a
 * `web` channel is the alarming one — it means the validation itself was
 * disabled, unregistered or failed open, which is precisely what the merchant
 * must be able to see (ENFC-06).
 */
export async function upsertOrderFromSource(
  shop: string,
  order: OrderForLedgerNode,
  attribution?: OrderAttribution,
): Promise<string | null> {
  const terms = order.paymentTerms;
  const schedules = terms?.paymentSchedules.edges.map((edge) => edge.node) ?? [];
  const refetchedAt = new Date();

  const outcome = await db.$transaction(async (tx) => {
    // Read BEFORE the upsert overwrites it: "was this row already attributed?"
    // is the question that keeps a redelivery from re-flagging a known leak.
    const priorRow = await tx.ledgerOrder.findUnique({
      where: { shop_orderGid: { shop, orderGid: order.id } },
      select: { attributionStatus: true },
    });

    const fields = {
      name: order.name,
      hasPaymentTerms: terms !== null && terms !== undefined,
      paymentTermsType: terms?.paymentTermsType ?? null,
      financialStatus: order.displayFinancialStatus ?? null,
      cancelledAt: toDate(order.cancelledAt),
      // D-07: the only money the ledger ever believes.
      outstandingShop: new Prisma.Decimal(
        order.totalOutstandingSet.shopMoney.amount,
      ),
      currencyCode: order.totalOutstandingSet.shopMoney.currencyCode,
      sourceUpdatedAt: new Date(order.updatedAt),
      refetchedAt,
    };

    let attributionFields: {
      companyId: string | null;
      attributionStatus: string;
      companyLocationGid: string | null;
    } | null = null;
    let attributedCompanyGid: string | null = null;

    if (attribution?.kind === "company") {
      const companyId = await upsertCompanyRow(
        tx,
        shop,
        attribution.companyGid,
        // Null passes THROUGH: an attribution that carries no name must not
        // rename an existing company to its gid (see upsertCompanyRow).
        attribution.companyName,
      );
      attributionFields = {
        companyId,
        attributionStatus: "ATTRIBUTED",
        companyLocationGid: attribution.companyLocationGid ?? null,
      };
      attributedCompanyGid = attribution.companyGid;
    } else if (attribution?.kind === "unresolved") {
      attributionFields = {
        companyId: null,
        attributionStatus: "UNRESOLVED",
        companyLocationGid: null,
      };
    }

    const row = await tx.ledgerOrder.upsert({
      where: { shop_orderGid: { shop, orderGid: order.id } },
      // Preserve-mode leaves the attribution columns untouched on update.
      update: attributionFields ? { ...fields, ...attributionFields } : fields,
      create: {
        shop,
        orderGid: order.id,
        ...fields,
        // A row created without attribution evidence starts UNRESOLVED.
        ...(attributionFields ?? {
          companyId: null,
          attributionStatus: "UNRESOLVED",
          companyLocationGid: null,
        }),
      },
    });

    await tx.ledgerSchedule.deleteMany({ where: { orderId: row.id } });
    if (schedules.length > 0) {
      await tx.ledgerSchedule.createMany({
        data: schedules.map((schedule) => ({
          shop,
          scheduleGid: schedule.id,
          orderId: row.id,
          dueAt: toDate(schedule.dueAt),
          completedAt: toDate(schedule.completedAt),
          balanceDueAmount: schedule.balanceDue
            ? new Prisma.Decimal(schedule.balanceDue.amount)
            : null,
          balanceDueCurrency: schedule.balanceDue?.currencyCode ?? null,
        })),
      });
    }

    // ENFC-06 (P4-L2). The order is a leak iff it JUST BECAME attributed to a
    // company the Function would have blocked it for. "Just became" is the
    // whole dedupe: a redelivered doorbell, a coalesced refetch and a
    // preserve-mode money refresh all find the row already ATTRIBUTED and say
    // nothing. The unique [shop, kind, orderGid] index is the backstop for the
    // race two concurrent first-ingests could still lose.
    //
    // Only the decision is made here — see this function's header for why the
    // write waits for the commit.
    let leak: EnforcementEventInput | null = null;
    const attributedCompanyId =
      attributionFields?.attributionStatus === "ATTRIBUTED"
        ? attributionFields.companyId
        : null;

    if (
      attributedCompanyId &&
      priorRow?.attributionStatus !== "ATTRIBUTED" &&
      // No terms means the money was taken up front — never credit, never a
      // leak, however bad the company's ledger looks (D-02).
      fields.hasPaymentTerms
    ) {
      const companyRow = await tx.company.findUnique({
        where: { id: attributedCompanyId },
      });

      if (
        companyRow &&
        wouldBlockOrder({
          bypassEnforcement: companyRow.bypassEnforcement,
          creditLimit: companyRow.creditLimit,
          // PRE-ORDER exposure: `recomputeCompany` has not folded this order in
          // yet, which is what makes this the D4-01 comparison and not a
          // double-count of the order against itself.
          exposure: companyRow.exposure,
          overdue: companyRow.overdue,
          orderOutstanding: fields.outstandingShop,
        })
      ) {
        leak = {
          companyGid: companyRow.companyGid,
          companyName: companyRow.name,
          kind: EVENT_KIND.BYPASSED_ORDER,
          orderGid: order.id,
          amount: fields.outstandingShop,
          // Absent sourceName reads as "unknown" — never as a channel.
          channel: order.sourceName ?? "unknown",
          exposure: companyRow.exposure,
          limit: companyRow.creditLimit,
          overdue: companyRow.overdue,
          bypass: companyRow.bypassEnforcement,
        };
      }
    }

    if (attribution) return { companyGid: attributedCompanyGid, leak };

    // Preserve-mode: report the company the row (still) belongs to, so callers
    // can recompute the right balance.
    if (!row.companyId) return { companyGid: null, leak };
    const company = await tx.company.findUnique({
      where: { id: row.companyId },
      select: { companyGid: true },
    });
    return { companyGid: company?.companyGid ?? null, leak };
  });

  // Outside the transaction, and non-throwing by its own contract: the ledger
  // write above is already committed and must stand whatever the event store
  // does (T-04-07).
  if (outcome.leak) await recordEnforcementEvent(shop, outcome.leak);

  return outcome.companyGid;
}

/**
 * Forget an order entirely (orders/delete — a deleted order cannot be
 * refetched). Returns the company gid that owned it so the caller can recompute
 * the company down. Schedules go with it via the cascade.
 */
export async function removeOrder(
  shop: string,
  orderGid: string,
): Promise<string | null> {
  const existing = await db.ledgerOrder.findUnique({
    where: { shop_orderGid: { shop, orderGid } },
    include: { company: true },
  });

  await db.ledgerOrder.deleteMany({ where: { shop, orderGid } });

  return existing?.company?.companyGid ?? null;
}

/**
 * THE single writer of a company's credit state (rule 3).
 *
 * Loads that company's orders — scoped by shop, always — runs the pure core over
 * them and persists the result. Returns null when the company is unknown to this
 * shop, which is not an error: an order can be deleted before its company ever
 * existed locally.
 */
export async function recomputeCompany(
  shop: string,
  companyGid: string,
  now: Date = new Date(),
): Promise<CompanyState | null> {
  const company = await db.company.findUnique({
    where: { shop_companyGid: { shop, companyGid } },
  });
  if (!company) return null;

  const orders = await db.ledgerOrder.findMany({
    where: { shop, companyId: company.id },
    include: { schedules: true },
  });

  const state = computeCompanyState(orders, now);

  if (state.currencyMismatch) {
    // Never blocks the recompute — the number is still the best available, but
    // D-07's single-currency premise just failed for this company.
    console.warn(
      `Ledger currency mismatch for company ${companyGid} on ${shop} — exposure mixes currencies (D-07)`,
    );
  }

  // ENFC-05 (D4-03): blocked state is DERIVED here, in the one function that
  // already owns exposure/overdue, and written in the same UPDATE. Deriving it
  // anywhere else — a route, the sweep, a webhook handler — would mean line
  // crossings the event log never saw (threat T-04-06), so this is the single
  // hook point by construction rather than by convention.
  //
  // Limit and bypass come from the row as read: this function does not write
  // them, and the settings action's own edits reach here through its
  // republish → recomputeCompany call, which re-reads the row it just changed.
  const nowBlocked = isBlockedState({
    bypassEnforcement: company.bypassEnforcement,
    creditLimit: company.creditLimit,
    exposure: state.exposure,
    overdue: state.overdue,
  });

  await db.company.update({
    where: { id: company.id },
    data: {
      exposure: state.exposure,
      overdue: state.overdue,
      earliestDueAt: state.earliestDueAt,
      recomputedAt: new Date(),
      blockedState: nowBlocked,
    },
  });

  if (nowBlocked !== company.blockedState) {
    // Two concurrent recomputes can in principle both observe the same flip and
    // write two transition rows. That is tolerated deliberately: the merchant
    // feed reads a timeline, and a rare duplicate transition is a cosmetic
    // wrinkle, whereas the lock or CAS that would prevent it puts contention on
    // the hot webhook path. Only BYPASSED_ORDER carries a real uniqueness
    // guarantee (the [shop, kind, orderGid] index), because a leak counted
    // twice would misstate money.
    await recordEnforcementEvent(shop, {
      companyGid,
      companyName: company.name,
      kind: nowBlocked
        ? EVENT_KIND.BLOCK_STATE_ENTERED
        : EVENT_KIND.BLOCK_STATE_EXITED,
      exposure: state.exposure,
      limit: company.creditLimit,
      overdue: state.overdue,
      bypass: company.bypassEnforcement,
    });
  }

  // CRED-03 (D-05): every state change publishes credit_v1 within the same
  // handling — the publisher PROJECTS the row this function just wrote, it
  // never computes. Outside any transaction, and non-throwing by its own
  // contract, so a metafield API blip cannot fail a webhook whose ledger work
  // already committed (metafields.server.ts rules 6 and 8).
  await publishCompanyCreditState(shop, company.id);

  return state;
}

/**
 * The known-order refresh path (research Pattern 1).
 *
 * Refetch the order over the authenticated Admin API, write what came back in
 * PRESERVE-MODE — a money refresh must never change what company an order
 * belongs to — then recompute. It recomputes BOTH the company the order used to
 * belong to and the one it belongs to now: re-attribution is rare but leaves a
 * stale balance on the old company if only the new one is recomputed.
 *
 * A GraphQL `errors` array THROWS (`graphqlJson` → LedgerGraphqlError) rather
 * than reading as "no such order" — an access-scope failure returns a nulled
 * order alongside errors[], and silently deleting a live ledger row on a
 * permissions blip would understate exposure, the exact failure mode this phase
 * exists to prevent (Pitfall 2, T-02-27). The throw propagates deliberately: a
 * non-200 makes Shopify redeliver, the same contract as always.
 */
export async function refetchOrderAndRecompute(
  shop: string,
  orderGid: string,
): Promise<void> {
  const previous = await db.ledgerOrder.findUnique({
    where: { shop_orderGid: { shop, orderGid } },
    include: { company: true },
  });
  const previousCompanyGid = previous?.company?.companyGid ?? null;

  const body = await graphqlJson<OrderForLedgerResponse>(
    shop,
    ORDER_FOR_LEDGER_QUERY,
    { variables: { id: orderGid }, label: "OrderForLedger" },
  );

  const order = body?.data?.order ?? null;
  const currentCompanyGid = order
    ? await upsertOrderFromSource(shop, order)
    : // Clean null with no errors: the order is gone at the source.
      await removeOrder(shop, orderGid);

  for (const companyGid of new Set(
    [previousCompanyGid, currentCompanyGid].filter(
      (gid): gid is string => gid !== null,
    ),
  )) {
    await recomputeCompany(shop, companyGid);
  }
}

/* ------------------------------------------------------------------ *
 * Attribution attempts — one mechanism, used by the ladder and the heal.
 * ------------------------------------------------------------------ */

/**
 * How many companies ONE doorbell may page when it has no hint to go on.
 *
 * A webhook handler answers inside Shopify's ack window or the delivery is
 * retried, so the hint-less retry cannot be allowed to walk an arbitrarily
 * long company list on the request path. The cap is safe precisely because it
 * is not the only backstop: the 5-minute `attribution-heal` sweep pages the
 * same companies off the request path, and the daily reconciliation is the
 * belt behind that. Ordering (biggest deficit first) means the cap almost
 * never binds in practice — the company an unattributed order belongs to is
 * by definition one Shopify counts more orders for than the ledger does.
 */
export const MAX_DOORBELL_COMPANY_SCANS = 10;

/**
 * Local attributed-row count per company gid — the left-hand side of 02-08's
 * invariant `local count(companyId = X) == Company.ordersCount`.
 *
 * Shared by the doorbell retry and the reconciliation heal so the two can
 * never drift into disagreeing about which companies are worth paging.
 */
export async function localAttributedCounts(
  shop: string,
): Promise<Map<string, number>> {
  const companyRows = await db.company.findMany({
    where: { shop },
    select: { id: true, companyGid: true },
  });
  const gidById = new Map(companyRows.map((row) => [row.id, row.companyGid]));

  const grouped = await db.ledgerOrder.groupBy({
    by: ["companyId"],
    where: { shop, companyId: { not: null } },
    _count: { _all: true },
  });

  const countByGid = new Map<string, number>();
  for (const group of grouped) {
    const gid = group.companyId ? gidById.get(group.companyId) : undefined;
    if (gid) countByGid.set(gid, group._count._all);
  }
  return countByGid;
}

/**
 * Scan ONE company's authenticated orders edge for `orderGid` and, if it is
 * there, attribute the order to that company.
 *
 * This is the attribution mechanism itself (D-03) — appearance on the edge IS
 * the evidence — factored out so rung 2, the rung-1 retry and (through them)
 * every caller use the same code rather than three copies of it. Returns
 * whether the order was found; a miss is never an error (T-02-26).
 */
async function attributeFromCompanyEdge(
  shop: string,
  orderGid: string,
  companyGid: string,
  companyLocationGid: string | null,
): Promise<boolean> {
  let matched: OrderForLedgerNode | null = null;
  const scan = await forEachCompanyOrder(shop, companyGid, (node) => {
    if (node.id === orderGid) {
      matched = node;
      return true;
    }
  });

  if (!matched) return false;

  await upsertOrderFromSource(shop, matched, {
    kind: "company",
    companyGid,
    // The company head's name comes from the authenticated response, never
    // from a payload.
    companyName: scan.companyName,
    companyLocationGid,
  });
  await recomputeCompany(shop, companyGid);
  return true;
}

/**
 * Re-attempt attribution for an order the ledger already has but has NOT
 * attributed (06-DEBUG-ingest-latency fix 1).
 *
 * WHY THIS EXISTS. Attribution used to be attempted exactly once — rung 2, on
 * the first doorbell for an unknown order — and in production that attempt
 * yields nothing: either the payload carries no `company` block, or Shopify's
 * company→orders edge has not indexed an order that is seconds old. Every
 * later doorbell then took rung 1, which is preserve-mode, so the row stayed
 * UNRESOLVED — contributing zero exposure, publishing no `credit_v1` change
 * and holding no checkout — until the 03:30Z reconciliation, up to 24h later.
 * Shopify rings 3–5 more times within the first minute of an order; this
 * function is what spends those rings.
 *
 * Two branches, both bounded, neither trusting the payload:
 *  - WITH A HINT: one scan of the hinted company's edge (+1 GraphQL call).
 *    Runs for any non-ATTRIBUTED row, NO_COMPANY included — that verdict is a
 *    status, not a tombstone, and one targeted scan is cheap enough to spend
 *    on the chance it is now wrong.
 *  - WITHOUT A HINT: enumerate companies and page only those whose
 *    `ordersCount` disagrees with the local attributed count — 02-08's
 *    invariant, which on a steady shop singles out exactly the company the
 *    missing order belongs to. Restricted to UNRESOLVED rows: a NO_COMPANY row
 *    has ALREADY had a full enumeration prove that no company claims it, and
 *    repeating that enumeration on every future doorbell would spend a page
 *    per ring forever for an order that never changes. The daily heal re-checks
 *    those rows (candidates are every row not ATTRIBUTED) — cadence, not
 *    stickiness, is what changes here.
 *
 * NEVER writes NO_COMPANY: "proven attached to no company" requires a full
 * enumeration to have exhausted every company, which only the daily sweep
 * does. A doorbell that finds nothing leaves the row exactly as it was.
 */
export async function reattemptAttribution(
  shop: string,
  orderGid: string,
  hint: CompanyOrderHint | null,
  status: string,
): Promise<boolean> {
  if (hint) {
    return attributeFromCompanyEdge(
      shop,
      orderGid,
      hint.companyGid,
      hint.companyLocationGid,
    );
  }

  if (status !== "UNRESOLVED") return false;

  const companies = await enumerateCompanies(shop);
  if (companies.length === 0) return false;

  const localCounts = await localAttributedCounts(shop);
  const deficit = (company: LedgerCompanySummary) =>
    company.ordersCount - (localCounts.get(company.companyGid) ?? 0);

  const candidates = companies
    .filter((company) => deficit(company) !== 0)
    // Biggest deficit first: Shopify counting MORE orders than the ledger has
    // attributed is the exact shape a missing attribution makes.
    .sort((a, b) => deficit(b) - deficit(a))
    .slice(0, MAX_DOORBELL_COMPANY_SCANS);

  for (const company of candidates) {
    if (
      await attributeFromCompanyEdge(shop, orderGid, company.companyGid, null)
    ) {
      return true;
    }
  }

  return false;
}

/* ------------------------------------------------------------------ *
 * The resolution ladder — every order-shaped doorbell funnels in here.
 * ------------------------------------------------------------------ */

/**
 * A company identifier read off a SIGNED webhook payload. It is a hint, not
 * evidence: it only selects WHICH company's authenticated order list to scan.
 * Attribution requires the order gid to actually appear on that company's
 * `company(id){orders}` edge, so a replayed, stale or wrong hint can waste a
 * scan but can never mint a false attribution (T-02-26).
 */
export interface CompanyOrderHint {
  companyGid: string;
  companyLocationGid: string | null;
}

/**
 * Resolve one non-delete order doorbell (LEDG-02, WINDOWS defect 5 remedy).
 *
 * Rung order is load-bearing — the known-row check comes FIRST because it is
 * the hot path and needs no company scan:
 *
 *  1. KNOWN ORDER: a ledger row exists → `refetchOrderAndRecompute`, which
 *     preserves attribution (an orders/paid on an attributed order updates
 *     money and keeps its company — D-01). FIRST, though, a row that is not
 *     yet ATTRIBUTED and carries payment terms gets another attribution
 *     attempt (`reattemptAttribution`): the ONE-SHOT ladder was the 24h
 *     latency defect (06-DEBUG-ingest-latency §1b), because a preserve-mode
 *     refetch can never change what company an order belongs to.
 *  2. UNKNOWN + HINT: scan the hinted company's authenticated orders edge for
 *     the gid; found → ATTRIBUTED via `upsertOrderFromSource` with the node
 *     from the scan (no separate refetch needed) + recompute (D-03). The
 *     company head's name comes from the CompanyOrdersForLedger response,
 *     never from the payload.
 *     A MISS does NOT throw — Shopify's company edge can trail orders/create
 *     by seconds (eventual consistency). It heals on the NEXT doorbell through
 *     rung 1's retry above (Shopify rings 3–5 more times within the first
 *     minute), or, if no further ring comes, within 5 minutes through the
 *     `attribution-heal` sweep. A retry storm over a race would be all cost,
 *     no correctness.
 *  3. UNKNOWN, NO USABLE HINT: reduced single-order refetch; the order exists →
 *     persist UNRESOLVED (explicitly distinct from NO_COMPANY — constraint 5)
 *     with zero exposure contribution until attributed; a clean null (no
 *     errors[]) → the order is gone at the source, no row is created.
 */
export async function ingestOrderEvent(
  shop: string,
  orderGid: string,
  hint: CompanyOrderHint | null,
): Promise<void> {
  /* Rung 1 — known order. */
  const existing = await db.ledgerOrder.findUnique({
    where: { shop_orderGid: { shop, orderGid } },
    select: { attributionStatus: true, hasPaymentTerms: true },
  });
  if (existing) {
    // A row that is not yet attributed gets another attempt on every ring —
    // this is what turns "attributed at 03:30 tomorrow" into "attributed in
    // seconds". Gated on payment terms because a card-paid order can never
    // contribute exposure (D-02), so scanning for one would be pure cost, and
    // on NOT-ATTRIBUTED because re-scanning the hot path would spend a
    // company page on every orders/paid for nothing.
    if (existing.attributionStatus !== "ATTRIBUTED" && existing.hasPaymentTerms) {
      // BEST-EFFORT, and the only swallowed failure on this path. Attribution
      // has two guaranteed backstops behind it (the 5-minute heal and the
      // daily sweep); the money refresh below has none — it is what the
      // merchant's dashboard is showing right now. Letting a company-edge blip
      // take the whole delivery down would trade a bounded attribution delay
      // for a lost money update, which is the wrong way round. Loud in Sentry,
      // never silent.
      try {
        const attributed = await reattemptAttribution(
          shop,
          orderGid,
          hint,
          existing.attributionStatus,
        );
        if (attributed) {
          console.log(
            `Order ${orderGid} on ${shop} attributed on a later doorbell ` +
              `(was ${existing.attributionStatus})`,
          );
        }
      } catch (error) {
        Sentry.captureException(error, {
          tags: { path: "ingest-reattribution", shop },
        });
        console.warn(
          `Attribution retry failed for ${orderGid} on ${shop} — the money ` +
            `refresh continues; the attribution heal will pick it up:`,
          error,
        );
      }
    }

    // Then the money refresh, exactly as before: preserve-mode leaves the
    // attribution the retry just wrote (or the one the row already had) alone.
    await refetchOrderAndRecompute(shop, orderGid);
    return;
  }

  /* Rung 2 — unknown order with a payload company hint. */
  if (hint) {
    if (
      await attributeFromCompanyEdge(
        shop,
        orderGid,
        hint.companyGid,
        hint.companyLocationGid,
      )
    ) {
      return;
    }

    // Miss: fall through to rung 3 (no throw — see the ladder doc above), but
    // make the miss visible: a systematic pattern here means wrong hints, not
    // eventual consistency, and only an alert can tell the two apart.
    Sentry.captureMessage(
      `Order attribution miss on ${shop}: ${orderGid} was not on hinted ` +
        `company edge ${hint.companyGid} — persisting UNRESOLVED for the ` +
        `next doorbell's retry or the attribution heal (rung 2-miss)`,
      "warning",
    );
  }

  /* Rung 3 — unknown order, no usable hint (or the hint scan missed). */
  const body = await graphqlJson<OrderForLedgerResponse>(
    shop,
    ORDER_FOR_LEDGER_QUERY,
    { variables: { id: orderGid }, label: "OrderForLedger" },
  );

  const order = body?.data?.order ?? null;
  if (!order) return; // Clean null: an unknown deleted order is a no-op.

  await upsertOrderFromSource(shop, order, { kind: "unresolved" });

  // A NET-TERMS order pending attribution understates exposure until it is
  // attributed — loud by design. A card-paid D2C order landing here is benign
  // noise and stays silent (D-02: no terms, no exposure).
  if (order.paymentTerms) {
    const message =
      `Unattributed net-terms order ${orderGid} on ${shop} persisted ` +
      `UNRESOLVED — exposure is understated until the next doorbell retries ` +
      `attribution or the attribution heal (≤5 min) claims it`;
    Sentry.captureMessage(message, "warning");
    console.warn(message);
  }
}
