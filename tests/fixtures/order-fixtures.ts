import type {
  OrderForLedgerNode,
  OrderForLedgerSchedule,
  OrderStateInput,
  ScheduleStateInput,
} from "../../app/services/ledger.server";

/**
 * Builders for `OrderForLedger` responses (Phase 2 shared test infrastructure).
 *
 * The defaults describe the archetypal case this whole phase exists for: an
 * unpaid NET-30 order for $500 belonging to a B2B company. Every test then
 * states only its ONE difference — partially paid, cancelled, card-paid,
 * different company — which is what keeps the LEDG-03 matrix readable.
 *
 * All dates are fixed constants, never `new Date()`: the overdue boundary is a
 * correctness question (D-04 strict-past), so no fixture may drift with the
 * wall clock.
 */

/** Anchor date for every fixture. Orders are "placed" here. */
export const FIXTURE_PLACED_AT = "2026-08-01T00:00:00.000Z";
/** NET-30 from the anchor — the default schedule due date. */
export const FIXTURE_DUE_AT = "2026-08-31T00:00:00.000Z";
export const FIXTURE_COMPANY_GID = "gid://shopify/Company/1001";
export const FIXTURE_COMPANY_NAME = "Acme Industrial Supply";
export const FIXTURE_ORDER_GID = "gid://shopify/Order/5001";

export interface ScheduleFixtureOverrides {
  id?: string;
  dueAt?: string | null;
  completedAt?: string | null;
  balanceDue?: { amount: string; currencyCode: string } | null;
}

export interface OrderFixtureOverrides {
  id?: string;
  name?: string;
  updatedAt?: string;
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
  /** totalOutstandingSet.shopMoney.amount — the only money exposure reads. */
  outstanding?: string;
  received?: string;
  refunded?: string;
  currencyCode?: string;
  /** null builds a card-paid order (no payment terms at all — D-02). */
  paymentTerms?: null;
  paymentTermsType?: string;
  paymentTermsName?: string;
  dueInDays?: number | null;
  /** Replace the schedule list wholesale; [] means terms with no schedules. */
  schedules?: ScheduleFixtureOverrides[];
  /** Convenience for the single-schedule default. */
  dueAt?: string | null;
  completedAt?: string | null;
}

function money(amount: string, currencyCode: string) {
  return { shopMoney: { amount, currencyCode } };
}

function schedule(
  index: number,
  overrides: ScheduleFixtureOverrides,
  fallbackDueAt: string | null,
  fallbackCompletedAt: string | null,
): OrderForLedgerSchedule {
  return {
    id: overrides.id ?? `gid://shopify/PaymentSchedule/${9000 + index}`,
    dueAt: overrides.dueAt === undefined ? fallbackDueAt : overrides.dueAt,
    completedAt:
      overrides.completedAt === undefined
        ? fallbackCompletedAt
        : overrides.completedAt,
    balanceDue: overrides.balanceDue ?? null,
  };
}

/**
 * One refetched order, defaults = unpaid NET-30 $500.
 *
 * Deliberately carries NO attribution field: the reduced OrderForLedger
 * selection has none (`purchasingEntity` is scope-trapped behind the excluded
 * `read_customers` — 02-05 § CRITICAL FINDING). Which company an order belongs
 * to is decided by the CompanyOrdersForLedger page it appears on
 * (`makeCompanyOrdersResponse`) or by an explicit `OrderAttribution` param.
 */
export function makeOrderForLedger(
  overrides: OrderFixtureOverrides = {},
): OrderForLedgerNode {
  const currencyCode = overrides.currencyCode ?? "USD";

  const scheduleOverrides = overrides.schedules ?? [{}];
  const dueAt = overrides.dueAt === undefined ? FIXTURE_DUE_AT : overrides.dueAt;
  const completedAt = overrides.completedAt ?? null;

  const hasTerms = overrides.paymentTerms !== null;

  return {
    id: overrides.id ?? FIXTURE_ORDER_GID,
    name: overrides.name ?? "#1042",
    updatedAt: overrides.updatedAt ?? FIXTURE_PLACED_AT,
    cancelledAt: overrides.cancelledAt ?? null,
    displayFinancialStatus: overrides.displayFinancialStatus ?? "PENDING",
    totalOutstandingSet: money(overrides.outstanding ?? "500.00", currencyCode),
    totalReceivedSet: money(overrides.received ?? "0.00", currencyCode),
    totalRefundedSet: money(overrides.refunded ?? "0.00", currencyCode),
    paymentTerms: hasTerms
      ? {
          id: "gid://shopify/PaymentTerms/3001",
          paymentTermsType: overrides.paymentTermsType ?? "NET",
          paymentTermsName: overrides.paymentTermsName ?? "Net 30",
          dueInDays: overrides.dueInDays === undefined ? 30 : overrides.dueInDays,
          overdue: false,
          paymentSchedules: {
            edges: scheduleOverrides.map((node, index) => ({
              node: schedule(index, node, dueAt, completedAt),
            })),
          },
        }
      : null,
  };
}

/** The full GraphQL response body an admin-client fixture returns. */
export function makeOrderForLedgerResponse(
  overrides: OrderFixtureOverrides = {},
): { data: { order: OrderForLedgerNode } } {
  return { data: { order: makeOrderForLedger(overrides) } };
}

/* ------------------------------------------------------------------ *
 * CompanyOrdersForLedger — the company-side attribution page (02-06).
 * ------------------------------------------------------------------ */

export interface CompanyOrdersResponseOptions {
  companyGid?: string;
  /** null models a company Shopify returns without a name. */
  companyName?: string | null;
  /** Order nodes on this page, in edge order. */
  orders?: OrderForLedgerNode[];
  hasNextPage?: boolean;
  endCursor?: string | null;
}

/**
 * One page of the authenticated `company(id){ orders(...) }` edge — the shape
 * the resolution ladder scans to attribute an order to a company (WINDOWS
 * defect 5 remedy). Defaults describe the archetypal page: the fixture company
 * with its one unpaid NET-30 $500 order.
 */
export function makeCompanyOrdersResponse(
  options: CompanyOrdersResponseOptions = {},
): {
  data: {
    company: {
      id: string;
      name: string | null;
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: { node: OrderForLedgerNode }[];
      };
    };
  };
} {
  const {
    companyGid = FIXTURE_COMPANY_GID,
    companyName = FIXTURE_COMPANY_NAME,
    orders = [makeOrderForLedger()],
    hasNextPage = false,
    endCursor = null,
  } = options;

  return {
    data: {
      company: {
        id: companyGid,
        name: companyName,
        orders: {
          pageInfo: {
            hasNextPage,
            endCursor: endCursor ?? (hasNextPage ? "company-orders-cursor-1" : null),
          },
          edges: orders.map((node) => ({ node })),
        },
      },
    },
  };
}

/** Response when Shopify knows no company for the gid (bad or stale hint). */
export function makeMissingCompanyResponse(): { data: { company: null } } {
  return { data: { company: null } };
}

/** Response for an order that no longer exists at the source. */
export function makeMissingOrderResponse(): { data: { order: null } } {
  return { data: { order: null } };
}

/* ------------------------------------------------------------------ *
 * Inputs for the pure engine (`computeCompanyState`).
 * ------------------------------------------------------------------ */

/** The default schedule due date, as a Date. */
export const FIXTURE_DUE_DATE = new Date(FIXTURE_DUE_AT);
/** An evaluation instant BEFORE the default due date. */
export const BEFORE_DUE = new Date("2026-08-15T00:00:00.000Z");
/** An evaluation instant AFTER the default due date. */
export const AFTER_DUE = new Date("2026-09-15T00:00:00.000Z");

export interface OrderStateFixtureOverrides {
  outstanding?: string;
  currencyCode?: string;
  hasPaymentTerms?: boolean;
  cancelledAt?: Date | null;
  /** Replace the schedule list wholesale; [] means terms with no schedules. */
  schedules?: ScheduleStateInput[];
  /** Convenience for the single-schedule default. */
  dueAt?: Date | null;
  completedAt?: Date | null;
}

/**
 * One order as the pure engine sees it. Same defaults as the GraphQL builder —
 * unpaid NET-30 $500 — so a reader can move between the two without relearning
 * what "the normal case" is.
 */
export function makeOrderState(
  overrides: OrderStateFixtureOverrides = {},
): OrderStateInput {
  const dueAt = overrides.dueAt === undefined ? FIXTURE_DUE_DATE : overrides.dueAt;
  const completedAt = overrides.completedAt ?? null;

  return {
    outstandingShop: overrides.outstanding ?? "500.00",
    currencyCode: overrides.currencyCode ?? "USD",
    hasPaymentTerms: overrides.hasPaymentTerms ?? true,
    cancelledAt: overrides.cancelledAt ?? null,
    schedules: overrides.schedules ?? [{ dueAt, completedAt }],
  };
}
