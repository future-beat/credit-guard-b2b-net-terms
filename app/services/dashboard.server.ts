import { Prisma } from "@prisma/client";

import db from "../db.server";
import { createMoneyFormatter } from "../lib/money";
import { readBackfillState } from "./backfill.server";
import { EVENT_KIND } from "./enforcement.server";
import { shopDataComplete } from "./metafields.server";
import { REMINDER_STATUS, TOUCHPOINT } from "./reminders.server";
import { resolveShopCurrency } from "./shop-currency.server";

/**
 * The AR dashboard read model (DASH-01, DASH-02, 06-UI-SPEC).
 *
 * THREE CONTRACT RULES, all load-bearing:
 *
 * 1. EVERY READ IS SHOP-SCOPED. `shop` arrives from `session.shop` and appears
 *    in every WHERE. A forged `?shop=` search param reaches nothing (T-06-01).
 *
 * 2. NAMES COME FROM SNAPSHOTS, NEVER FROM A JOIN TO `Company`. Enforcement and
 *    reminder rows carry `companyName` precisely so the history of a decision
 *    outlives the company it was made about; joining would let a deleted
 *    company erase its own audit trail. (Joining an order GID to
 *    `LedgerOrder.name` is a different thing and is both allowed and required —
 *    "#1015" is what the merchant calls that order.)
 *
 * 3. `LedgerSchedule` MONEY IS NEVER SUMMED. Schedules supply due dates and the
 *    open/closed signal only; every amount on this page is
 *    `LedgerOrder.outstandingShop` or `Company.exposure`, summed over DISTINCT
 *    orders (schema contract, UI-SPEC hard rule 10).
 *
 * And one absence worth naming: there is NO Admin API call anywhere in this
 * module. The dashboard is a pure projection of Postgres, so a Shopify outage
 * cannot break the merchant's home page (06-RESEARCH Pattern 2).
 *
 * Everything crossing the loader boundary is already a STRING — money as
 * formatted decimals, dates and timestamps preformatted in UTC — so the
 * server-rendered markup and the hydrated markup cannot disagree. The only
 * numbers that survive are row counts and the feed's page index.
 *
 * COST: one `Promise.all` of independent reads, then ONE more wave of two
 * order-name joins that cannot be issued earlier because they depend on the
 * GIDs the first wave returned. Two round trips, no per-row query.
 */

/* ------------------------------------------------------------------ *
 * Serialisable shapes
 * ------------------------------------------------------------------ */

/** The badge tones this page is allowed to use (there is no `attention`). */
export type BadgeTone = "critical" | "warning" | "caution" | "neutral";

export interface Badge {
  text: string;
  tone: BadgeTone;
}

/**
 * A money KPI. `value` is null when there is nothing to total (the tile renders
 * an em dash); `incomplete` carries the Phase 3 "· incomplete" marker.
 */
export interface MoneyKpi {
  value: string | null;
  incomplete: boolean;
}

export interface OverdueRow {
  id: string;
  name: string;
  outstanding: string;
  earliestDue: string | null;
  blockedState: boolean;
  bypassEnforcement: boolean;
}

export interface UpcomingRow {
  id: string;
  orderName: string;
  companyName: string;
  due: string;
  outstanding: string;
}

export interface UtilisationRow {
  id: string;
  name: string;
  outstanding: string;
  creditLimit: string;
  utilisation: string;
}

export interface FeedRow {
  id: string;
  when: string;
  badge: Badge;
  details: string;
}

/** Which tooltip a reminder badge carries, or none. Copy lives on the page. */
export type ReminderTooltip = "unconfirmed" | "dead";

export interface ReminderBadge extends Badge {
  tooltip: ReminderTooltip | null;
}

export interface ReminderRow {
  id: string;
  when: string;
  companyName: string;
  orderName: string;
  touchpoint: string;
  badge: ReminderBadge;
}

/**
 * Which banner the page shows, if any. The loader picks; the page only maps the
 * choice to its copy, so precedence cannot drift between the two.
 */
export type BannerSelection =
  | { kind: "backfill-running" }
  | { kind: "data-incomplete" }
  | {
      kind: "bypassed-one";
      orderName: string;
      amountLabel: string;
      companyName: string;
    }
  | { kind: "bypassed-many"; countLabel: string; sumLabel: string };

export interface DashboardData {
  currencyCode: string | null;
  banner: BannerSelection | null;
  kpis: {
    totalOutstanding: MoneyKpi;
    /** Formatted integer — "0" is a good answer here, never an em dash. */
    overdueCompanies: string;
    onCreditHold: string;
    dueIn7Days: { value: string | null };
  };
  overdue: {
    rows: OverdueRow[];
    /** Every overdue company, not just the ten rendered (P5). */
    total: number;
    totalLabel: string;
    /** All companies, so the page can pick empty copy E1b over E2. */
    companyCount: number;
  };
  upcoming: {
    rows: UpcomingRow[];
    total: number;
    totalLabel: string;
  };
  closestToLimit: {
    rows: UtilisationRow[];
  };
  feed: {
    /** The 1-based page the merchant is on, already clamped. */
    page: number;
    rows: FeedRow[];
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  reminders: {
    enabled: boolean;
    enabledSince: string | null;
    rows: ReminderRow[];
  };
}

export interface LoadDashboardOptions {
  /** Injected clock. Defaults to now; the specs pin every window against it. */
  now?: Date;
  /** BCP-47 tag for date formatting; already validated by `resolveLocale`. */
  locale?: string;
  /** 1-based page of the enforcement feed. */
  feedPage?: number;
}

/* ------------------------------------------------------------------ *
 * Request-derived options
 * ------------------------------------------------------------------ */

/** The locale used when the request asks for none, or asks for nonsense. */
export const DEFAULT_LOCALE = "en-US";

/**
 * The locale the loader formats dates in (T-06-02).
 *
 * A search param is merchant-supplied, so it is validated rather than trusted:
 * `supportedLocalesOf` both rejects a bad tag and throws on a malformed one, and
 * either way the page falls back to `en-US` instead of 500-ing on a query
 * string.
 */
export function resolveLocale(request: Request): string {
  const requested = new URL(request.url).searchParams.get("locale");
  if (!requested) return DEFAULT_LOCALE;

  try {
    return Intl.DateTimeFormat.supportedLocalesOf(requested).length > 0
      ? requested
      : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Feed rows per page (06-UI-SPEC § Credit holds and bypasses). */
export const FEED_PAGE_SIZE = 25;

/** Rows the reminder activity table shows. */
export const REMINDER_PAGE_SIZE = 25;

/** Row caps for the two ledger tables (UI-SPEC). */
export const OVERDUE_ROW_CAP = 10;
export const UPCOMING_ROW_CAP = 15;
export const CLOSEST_TO_LIMIT_ROW_CAP = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back the bypassed-order alert looks (UI-SPEC B3). */
export const BYPASSED_WINDOW_DAYS = 30;

/**
 * The feed page number, clamped (T-06-02). `?feedPage=` is merchant-supplied,
 * so anything that is not a positive integer — a negative, a float, "abc",
 * Infinity — reads as page 1 rather than reaching Prisma's `skip`.
 */
export function clampFeedPage(requested: number | undefined): number {
  return Number.isInteger(requested) && (requested as number) > 0
    ? (requested as number)
    : 1;
}

/* ------------------------------------------------------------------ *
 * Formatting — all of it server-side, all of it UTC
 * ------------------------------------------------------------------ */

function dateFormatter(locale: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
}

function timestampFormatter(locale: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

/** A due or overdue date. Never editorialised — no "3 days late". */
export function formatDate(value: Date | null, locale: string): string | null {
  return value === null ? null : dateFormatter(locale).format(value);
}

/** A feed or reminder moment: "21 Aug 2026, 09:14". Never "3 hours ago". */
export function formatWhen(value: Date, locale: string): string {
  return timestampFormatter(locale).format(value);
}

function utcDayNumber(value: Date): number {
  return Math.floor(value.getTime() / DAY_MS);
}

/**
 * The "Due" column. Only two relative words exist — today and tomorrow — and
 * both are decided on the UTC day, the same clock the rest of the page formats
 * in, so a row cannot say "Tomorrow" beside a date that reads as today.
 */
export function formatDue(
  dueAt: Date | null,
  now: Date,
  locale: string,
): string {
  if (dueAt === null) return "—";

  const days = utcDayNumber(dueAt) - utcDayNumber(now);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return dateFormatter(locale).format(dueAt);
}

function countFormatter(locale: string): Intl.NumberFormat {
  return new Intl.NumberFormat(locale);
}

/* ------------------------------------------------------------------ *
 * Pure derivations
 * ------------------------------------------------------------------ */

/**
 * Which half of the 30-day window a due date falls in, or null when it is
 * outside the window entirely. K4 is the "next-7" slice of the same rows the
 * upcoming table renders — one query answers both, and they can never disagree.
 */
export function bucketUpcoming(
  dueAt: Date | null,
  now: Date,
): "next-7" | "days-8-30" | null {
  if (dueAt === null) return null;

  const delta = dueAt.getTime() - now.getTime();
  if (delta < 0) return null;
  if (delta <= 7 * DAY_MS) return "next-7";
  if (delta <= 30 * DAY_MS) return "days-8-30";
  return null;
}

/**
 * Fixed-2 money string -> integer cents (the Phase 3 rule, verbatim).
 *
 * Utilisation is compared and ranked on these exact integers, never on floats:
 * a percentage that decides how a merchant reads their own risk must not move
 * because of a rounding artifact.
 */
function cents(value: string): bigint {
  const negative = value.startsWith("-");
  const digits = (negative ? value.slice(1) : value).replace(".", "");
  return negative ? -BigInt(digits) : BigInt(digits);
}

/**
 * Whole-percent utilisation for a company that HAS a positive limit (Phase 3
 * rendering rules). Negative exposure floors at "0%"; anything past 999% caps
 * rather than stretching the column.
 *
 * Deliberately no verdict: this module never says "within limit". A company
 * sitting exactly on its limit IS on credit hold under P4-L1 (`exposure >=
 * limit`), so the number speaks and the stored `blockedState` flag is what any
 * status claim elsewhere is built from (plan-check I-02).
 */
export function utilisationPercent(
  exposure: string,
  creditLimit: string,
): string {
  const limit = cents(creditLimit);
  if (limit <= 0n) return "0%";

  const owed = cents(exposure);
  if (owed <= 0n) return "0%";

  // Round-half-up in integers: (2a + b) / 2b, with a = owed * 100.
  const percent = (owed * 200n + limit) / (limit * 2n);
  return percent > 999n ? ">999%" : `${percent}%`;
}

/**
 * `EnforcementEvent.channel` is `Order.sourceName`. The three values the ledger
 * actually produces get merchant-readable phrasing; anything else is shown
 * verbatim rather than guessed at, and a null channel drops the clause.
 */
export function channelPhrase(channel: string | null): string | null {
  if (channel === null) return null;
  if (channel === "shopify_draft_order") return "a draft order";
  if (channel === "web") return "online store";
  if (channel === "pos") return "POS";
  return channel;
}

/** Kind -> badge (06-UI-SPEC § Credit holds and bypasses, byte-exact). */
export function feedBadge(kind: string): Badge {
  switch (kind) {
    case EVENT_KIND.BLOCK_STATE_ENTERED:
      return { text: "Credit hold", tone: "critical" };
    case EVENT_KIND.BLOCK_STATE_EXITED:
      return { text: "Released", tone: "neutral" };
    case EVENT_KIND.BYPASSED_ORDER:
      return { text: "Order went through", tone: "warning" };
    case EVENT_KIND.BYPASS_ENABLED:
      return { text: "Bypass on", tone: "neutral" };
    case EVENT_KIND.BYPASS_DISABLED:
      return { text: "Bypass off", tone: "neutral" };
    default:
      // A kind written by a newer version of the enforcement service. Show it
      // rather than hide the row: the feed's job is that nothing is invisible.
      return { text: kind, tone: "neutral" };
  }
}

export interface FeedSentenceInput {
  kind: string;
  companyName: string;
  /** Fixed-2 strings; the formatter is passed in so money reads one way. */
  exposure: string;
  limit: string | null;
  overdue: boolean;
  amount: string | null;
  channel: string | null;
  orderName: string | null;
}

/**
 * The merchant-facing sentence for one event (06-UI-SPEC, byte-exact).
 *
 * The vocabulary is "credit hold", never "blocked $X": per-attempt blocks are
 * unobservable on this platform (D4-03), so the page claims only what a row
 * proves (honesty rule, threat T-06-04).
 */
export function feedSentence(
  input: FeedSentenceInput,
  formatMoney: (value: string) => string,
): string {
  const limitClause =
    input.limit === null ? "" : `, limit ${formatMoney(input.limit)}`;
  const channel = channelPhrase(input.channel);
  const viaClause = channel === null ? "" : ` via ${channel}`;
  const order = input.orderName ?? "";

  switch (input.kind) {
    case EVENT_KIND.BLOCK_STATE_ENTERED:
      return `${input.companyName} placed on credit hold — ${formatMoney(
        input.exposure,
      )} outstanding${limitClause}${input.overdue ? ", overdue" : ""}.`;
    case EVENT_KIND.BLOCK_STATE_EXITED:
      return `${input.companyName} released from credit hold — ${formatMoney(
        input.exposure,
      )} outstanding${limitClause}.`;
    case EVENT_KIND.BYPASSED_ORDER:
      return input.amount === null
        ? `Order ${order} went through while ${input.companyName} was on credit hold${viaClause}.`
        : `Order ${order} (${formatMoney(
            input.amount,
          )}) went through while ${input.companyName} was on credit hold${viaClause}.`;
    case EVENT_KIND.BYPASS_ENABLED:
      return `Enforcement bypassed for ${input.companyName}.`;
    case EVENT_KIND.BYPASS_DISABLED:
      return `Bypass removed for ${input.companyName}.`;
    default:
      return `${input.companyName}.`;
  }
}

/**
 * Status -> badge. FAILED and DEAD both read "Failed" on purpose: the tone and
 * the tooltip carry the difference, so a merchant is never taught an internal
 * state name. No `success` tone lives on this page (honesty rule).
 */
export function reminderBadge(status: string): ReminderBadge {
  switch (status) {
    case REMINDER_STATUS.SENT:
      return { text: "Sent", tone: "neutral", tooltip: null };
    case REMINDER_STATUS.SENT_UNCONFIRMED:
      return {
        text: "Sent (unconfirmed)",
        tone: "neutral",
        tooltip: "unconfirmed",
      };
    case REMINDER_STATUS.FAILED:
      return { text: "Failed", tone: "warning", tooltip: null };
    case REMINDER_STATUS.DEAD:
      return { text: "Failed", tone: "critical", tooltip: "dead" };
    default:
      return { text: status, tone: "neutral", tooltip: null };
  }
}

/** Touchpoint -> label (UI-SPEC R5). */
export function touchpointLabel(touchpoint: string): string {
  switch (touchpoint) {
    case TOUCHPOINT.DUE_SOON:
      return "Due soon";
    case TOUCHPOINT.DUE:
      return "Due today";
    case TOUCHPOINT.OVERDUE:
      return "Overdue";
    default:
      return touchpoint;
  }
}

export interface BannerInput {
  backfillRunning: boolean;
  dataComplete: boolean;
  bypassed: {
    count: number;
    sumLabel: string;
    single: {
      orderName: string;
      amountLabel: string;
      companyName: string;
    } | null;
  };
}

/**
 * AT MOST ONE BANNER, in the UI-SPEC's precedence: B1 (still importing) beats
 * B2 (some balances incomplete) beats B3 (orders went through). Stacked banners
 * are noise, and the more specific alarm is worthless while the page is still
 * admitting its numbers are provisional.
 *
 * B4 (currency mismatch) is deliberately NOT built: every ledger amount is
 * store currency (D-07 `shopMoney`) and a mismatched order is still counted in
 * exposure, so B4's body — "aren't included in totals" — would be false.
 */
export function selectBanner(input: BannerInput): BannerSelection | null {
  if (input.backfillRunning) return { kind: "backfill-running" };
  if (!input.dataComplete) return { kind: "data-incomplete" };
  if (input.bypassed.count === 1 && input.bypassed.single !== null) {
    return {
      kind: "bypassed-one",
      orderName: input.bypassed.single.orderName,
      amountLabel: input.bypassed.single.amountLabel,
      companyName: input.bypassed.single.companyName,
    };
  }
  if (input.bypassed.count > 1) {
    return {
      kind: "bypassed-many",
      countLabel: String(input.bypassed.count),
      sumLabel: input.bypassed.sumLabel,
    };
  }
  return null;
}

/** The last four characters of a GID, for an order row we no longer hold. */
function gidTail(orderGid: string): string {
  return orderGid.slice(-4);
}

/* ------------------------------------------------------------------ *
 * The read model
 * ------------------------------------------------------------------ */

const VISIBLE_REMINDER_STATUSES = [
  REMINDER_STATUS.SENT,
  REMINDER_STATUS.SENT_UNCONFIRMED,
  REMINDER_STATUS.FAILED,
  REMINDER_STATUS.DEAD,
];

/**
 * One pass over Postgres producing everything the dashboard renders.
 */
export async function loadDashboard(
  shop: string,
  options: LoadDashboardOptions = {},
): Promise<DashboardData> {
  const now = options.now ?? new Date();
  const locale = options.locale ?? DEFAULT_LOCALE;
  const feedPage = clampFeedPage(options.feedPage);

  const horizon30 = new Date(now.getTime() + 30 * DAY_MS);
  const bypassedSince = new Date(now.getTime() - BYPASSED_WINDOW_DAYS * DAY_MS);
  const bypassedWindow = {
    shop,
    kind: EVENT_KIND.BYPASSED_ORDER,
    createdAt: { gte: bypassedSince },
  };

  const [
    companyTotals,
    overdueCount,
    onHoldCount,
    overdueRows,
    scheduleRows,
    limitedCompanies,
    eventRows,
    bypassedTotals,
    bypassedNewest,
    reminderRows,
    shopRow,
    backfill,
    dataComplete,
    currencyCode,
  ] = await Promise.all([
    db.company.aggregate({
      where: { shop },
      _sum: { exposure: true },
      _count: true,
    }),
    db.company.count({ where: { shop, overdue: true } }),
    db.company.count({ where: { shop, blockedState: true } }),
    db.company.findMany({
      where: { shop, overdue: true },
      orderBy: [{ earliestDueAt: "asc" }, { id: "asc" }],
      take: OVERDUE_ROW_CAP,
      select: {
        id: true,
        name: true,
        exposure: true,
        earliestDueAt: true,
        blockedState: true,
        bypassEnforcement: true,
      },
    }),
    // The 30-day window answers both K4 and the upcoming table. Bounded by the
    // shop's own open schedules in one month — the ICP's whole ledger is
    // smaller than one page of most admin tables.
    db.ledgerSchedule.findMany({
      where: {
        shop,
        completedAt: null,
        dueAt: { gte: now, lte: horizon30 },
        order: { companyId: { not: null }, cancelledAt: null },
      },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        dueAt: true,
        orderId: true,
        order: {
          select: {
            name: true,
            outstandingShop: true,
            company: { select: { name: true } },
          },
        },
      },
    }),
    // Observe-only (null) and block-all (0.00) companies have no ratio to rank.
    db.company.findMany({
      where: { shop, creditLimit: { gt: 0 } },
      select: { id: true, name: true, exposure: true, creditLimit: true },
    }),
    db.enforcementEvent.findMany({
      where: { shop },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (feedPage - 1) * FEED_PAGE_SIZE,
      // One extra row is the cheapest possible "is there a next page".
      take: FEED_PAGE_SIZE + 1,
    }),
    db.enforcementEvent.aggregate({
      where: bypassedWindow,
      _count: true,
      _sum: { amount: true },
    }),
    db.enforcementEvent.findMany({
      where: bypassedWindow,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 1,
      select: { orderGid: true, amount: true, companyName: true },
    }),
    db.reminderLog.findMany({
      where: { shop, status: { in: VISIBLE_REMINDER_STATUSES } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: REMINDER_PAGE_SIZE,
    }),
    db.shop.findUnique({
      where: { domain: shop },
      select: { remindersEnabledAt: true },
    }),
    readBackfillState(shop),
    shopDataComplete(shop),
    resolveShopCurrency(shop),
  ]);

  const formatMoney = createMoneyFormatter(currencyCode);
  const formatCount = countFormatter(locale);

  // The two GID -> name joins. They could not run in the wave above: the GIDs
  // they look up are what that wave returned.
  const feedGids = [
    ...eventRows.map((row) => row.orderGid),
    ...bypassedNewest.map((row) => row.orderGid),
  ].filter((gid): gid is string => gid !== null);
  const reminderGids = reminderRows.map((row) => row.orderGid);

  const [feedOrders, reminderOrders] = await Promise.all([
    feedGids.length === 0
      ? Promise.resolve([])
      : db.ledgerOrder.findMany({
          where: { shop, orderGid: { in: feedGids } },
          select: { orderGid: true, name: true },
        }),
    reminderGids.length === 0
      ? Promise.resolve([])
      : db.ledgerOrder.findMany({
          where: { shop, orderGid: { in: reminderGids } },
          select: { orderGid: true, name: true },
        }),
  ]);

  const feedNames = new Map(feedOrders.map((row) => [row.orderGid, row.name]));
  const reminderNames = new Map(
    reminderOrders.map((row) => [row.orderGid, row.name]),
  );

  /* -- K1 ------------------------------------------------------------ */

  // `_sum` is null only when no row matched; a shop with companies but a zero
  // total still renders a formatted 0.00, because "nothing owed" and "nothing
  // to show" are different facts.
  const exposureSum =
    companyTotals._count === 0
      ? null
      : (companyTotals._sum.exposure ?? new Prisma.Decimal(0));

  /* -- K4 and the upcoming table ------------------------------------- */

  // DISTINCT orders: an order with two open schedules in the window is one
  // amount, not two. Schedule money is never read.
  const sevenDayOrders = new Map<string, Prisma.Decimal>();
  for (const schedule of scheduleRows) {
    if (bucketUpcoming(schedule.dueAt, now) !== "next-7") continue;
    sevenDayOrders.set(schedule.orderId, schedule.order.outstandingShop);
  }
  const dueIn7Days =
    sevenDayOrders.size === 0
      ? null
      : [...sevenDayOrders.values()].reduce(
          (total, amount) => total.add(amount),
          new Prisma.Decimal(0),
        );

  /* -- Closest to limit ---------------------------------------------- */

  // Sorted in JS over the shop's own (≤ 50-row ICP) limited companies: the
  // ratio is a Decimal comparison Postgres would need a computed column for,
  // and cross-multiplied integers keep it exact.
  const ranked = limitedCompanies
    .map((row) => ({
      id: row.id,
      name: row.name,
      exposure: row.exposure.toFixed(2),
      creditLimit: (row.creditLimit ?? new Prisma.Decimal(0)).toFixed(2),
    }))
    .sort((left, right) => {
      const crossed =
        cents(left.exposure) * cents(right.creditLimit) -
        cents(right.exposure) * cents(left.creditLimit);
      if (crossed > 0n) return -1;
      if (crossed < 0n) return 1;
      return left.name.localeCompare(right.name);
    })
    .slice(0, CLOSEST_TO_LIMIT_ROW_CAP);

  /* -- Feed ----------------------------------------------------------- */

  const feedVisible = eventRows.slice(0, FEED_PAGE_SIZE);

  /* -- Bypassed-order banner ------------------------------------------ */

  const bypassedCount = bypassedTotals._count;
  const bypassedSingle = bypassedNewest[0] ?? null;
  const banner = selectBanner({
    backfillRunning: backfill?.status === "running",
    dataComplete,
    bypassed: {
      count: bypassedCount,
      sumLabel: formatMoney(
        (bypassedTotals._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      ),
      single:
        bypassedSingle === null
          ? null
          : {
              orderName:
                bypassedSingle.orderGid === null
                  ? "—"
                  : (feedNames.get(bypassedSingle.orderGid) ??
                    gidTail(bypassedSingle.orderGid)),
              amountLabel: formatMoney(
                (bypassedSingle.amount ?? new Prisma.Decimal(0)).toFixed(2),
              ),
              companyName: bypassedSingle.companyName,
            },
    },
  });

  /* -- Reminders ------------------------------------------------------ */

  const remindersEnabledAt = shopRow?.remindersEnabledAt ?? null;
  const remindersEnabled = remindersEnabledAt !== null;

  return {
    currencyCode,
    banner,
    kpis: {
      totalOutstanding: {
        value: exposureSum === null ? null : formatMoney(exposureSum.toFixed(2)),
        incomplete: !dataComplete,
      },
      overdueCompanies: formatCount.format(overdueCount),
      onCreditHold: formatCount.format(onHoldCount),
      dueIn7Days: {
        value: dueIn7Days === null ? null : formatMoney(dueIn7Days.toFixed(2)),
      },
    },
    overdue: {
      rows: overdueRows.map((row) => ({
        id: row.id,
        name: row.name,
        outstanding: formatMoney(row.exposure.toFixed(2)),
        earliestDue: formatDate(row.earliestDueAt, locale),
        blockedState: row.blockedState,
        bypassEnforcement: row.bypassEnforcement,
      })),
      total: overdueCount,
      totalLabel: formatCount.format(overdueCount),
      companyCount: companyTotals._count,
    },
    upcoming: {
      rows: scheduleRows.slice(0, UPCOMING_ROW_CAP).map((schedule) => ({
        id: schedule.id,
        orderName: schedule.order.name,
        companyName: schedule.order.company?.name ?? "—",
        due: formatDue(schedule.dueAt, now, locale),
        outstanding: formatMoney(schedule.order.outstandingShop.toFixed(2)),
      })),
      total: scheduleRows.length,
      totalLabel: formatCount.format(scheduleRows.length),
    },
    closestToLimit: {
      rows: ranked.map((row) => ({
        id: row.id,
        name: row.name,
        outstanding: formatMoney(row.exposure),
        creditLimit: formatMoney(row.creditLimit),
        utilisation: utilisationPercent(row.exposure, row.creditLimit),
      })),
    },
    feed: {
      page: feedPage,
      rows: feedVisible.map((event) => ({
        id: event.id,
        when: formatWhen(event.createdAt, locale),
        badge: feedBadge(event.kind),
        details: feedSentence(
          {
            kind: event.kind,
            companyName: event.companyName,
            exposure: event.exposure.toFixed(2),
            limit: event.limit === null ? null : event.limit.toFixed(2),
            overdue: event.overdue,
            amount: event.amount === null ? null : event.amount.toFixed(2),
            channel: event.channel,
            orderName:
              event.orderGid === null
                ? null
                : (feedNames.get(event.orderGid) ?? gidTail(event.orderGid)),
          },
          formatMoney,
        ),
      })),
      hasNextPage: eventRows.length > FEED_PAGE_SIZE,
      hasPreviousPage: feedPage > 1,
    },
    reminders: {
      enabled: remindersEnabled,
      enabledSince: formatDate(remindersEnabledAt, locale),
      rows: remindersEnabled
        ? reminderRows.map((row) => ({
            id: row.id,
            when: formatWhen(row.createdAt, locale),
            companyName: row.companyName ?? "—",
            orderName:
              reminderNames.get(row.orderGid) ?? gidTail(row.orderGid),
            touchpoint: touchpointLabel(row.touchpoint),
            badge: reminderBadge(row.status),
          }))
        : [],
    },
  };
}
