/**
 * Print the PRODUCTION reminder state: which migrations the release phase
 * applied, whether the `ReminderLog` table and the `Shop.remindersEnabledAt`
 * switch exist, how many shops have reminders ENABLED, and every reminder row
 * ever written (plan 05-01 and everything after it).
 *
 * Runs INSIDE the Railway container (shipped there by
 * scripts/prod-reminder-state.sh) for the same reason as its sibling probes:
 * `postgres.railway.internal` only resolves on Railway's private network, so
 * DATABASE_URL is never copied to a developer machine (threat T-02-22).
 *
 * READ-ONLY: every statement is a SELECT. This script cannot enable reminders
 * for a shop, and deliberately has no code path that writes
 * `remindersEnabledAt` — the merchant's settings action is its only writer
 * (D5-02), and a probe that could flip it would be the install blast with a
 * developer's hand on it.
 *
 * WHAT IT PROVES
 *
 *  - the `add_reminder_log` migration reached production, by NAME rather than
 *    by a green aggregate (04-03 lesson);
 *  - the Wave-1 sweep is INERT: `shops.enabled` is 0 and `reminderRows` is 0,
 *    which is the D5-02 default-off gate observed rather than asserted;
 *  - once reminders are enabled, the same output is the send log: one row per
 *    (schedule x touchpoint) with its status;
 *  - which of plan 05-02's E-fixture categories actually exist on the store
 *    (open past-due attributed, open pre-due beyond the 72h lead, completed,
 *    unattributed net-terms) and which are EMPTY — the empty list is the
 *    human's fixture shopping list, measured rather than assumed.
 *
 * NO PERSONAL DATA is selected or printed, because none is stored: reminder
 * rows carry identifiers, a company-name snapshot, the touchpoint and status,
 * and the fixture inventory adds only GIDs, order names, company names and
 * dates. Shopify resolves the recipient and sends the mail (D5-01), so there is
 * no contact field in this database for a probe to leak (threat T-05-07).
 *
 * Usage (inside the container):
 *   node prod-reminder-state.mjs [shop-domain] [--after <iso>]
 *
 * `--after` supplies a PROVISIONAL watermark so the touchpoint plan can be read
 * before the merchant has enabled reminders (plan 05-05 LP-0). It changes
 * nothing in the database; it only moves the instant the plan is measured from.
 */
import { PrismaClient } from "@prisma/client";

/** Positional args only; flags (and a flag's value) are never the domain. */
const positional = process.argv.slice(2).filter((arg, index, all) => {
  if (arg.startsWith("--")) return false;
  return all[index - 1] !== "--after";
});
const domain = positional[0] ?? null;
const db = new PrismaClient();

/** BigInt-safe JSON (Postgres count() comes back as BigInt through $queryRaw). */
function jsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, inner) =>
      typeof inner === "bigint" ? Number(inner) : inner,
    ),
  );
}

const migrations = await db.$queryRawUnsafe(
  `SELECT migration_name, finished_at
     FROM "_prisma_migrations"
    ORDER BY finished_at ASC`,
);

const reminderLogTable = await db.$queryRawUnsafe(
  `SELECT to_regclass('public."ReminderLog"')::text AS name`,
);

const remindersColumn = await db.$queryRawUnsafe(
  `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
    WHERE table_name = 'Shop' AND column_name = 'remindersEnabledAt'`,
);

const shops = await db.shop.findMany({
  select: { domain: true, active: true, remindersEnabledAt: true },
  orderBy: { domain: "asc" },
});

const reminderRows = await db.reminderLog.findMany({
  where: domain ? { shop: domain } : {},
  select: {
    shop: true,
    scheduleGid: true,
    orderGid: true,
    companyName: true,
    touchpoint: true,
    status: true,
    attempts: true,
    sentAt: true,
    createdAt: true,
  },
  orderBy: { createdAt: "desc" },
  take: 50,
});

const leases = await db.sweepLease.findMany({
  select: { name: true, holder: true, lockedUntil: true },
  orderBy: { name: "asc" },
});

/* ------------------------------------------------------------------ *
 * E-fixture inventory (plan 05-02, Task 1).
 * ------------------------------------------------------------------ */

/**
 * The four empirical checks of plan 05-02 each need a schedule in a particular
 * state on the live store, and the only honest way to know whether one exists is
 * to look. This block classifies every stored schedule against `now` into the
 * E-categories and reports which ones are EMPTY — that list IS the human's
 * fixture shopping list, rather than a guess about what the demo store holds.
 *
 * The thresholds are D5-04 instant math, identical to reminders.server.ts: a
 * lead/offset of exactly 72h either side of `dueAt`, no calendar arithmetic.
 *
 * IDENTIFIERS AND DATES ONLY. No buyer, contact or customer field is selected —
 * none is stored (D5-01), and this script must not become the first place one
 * appears. Order NAMES are included deliberately: the human needs "#1023" to
 * tell one test email from another in an inbox, and an order name is merchant
 * data, not personal data.
 */
const HOURS = 60 * 60 * 1000;
const LEAD_MS = 72 * HOURS; // DUE_SOON lead and OVERDUE offset are both 72h.
const now = new Date();

const scheduleRows = await db.ledgerSchedule.findMany({
  where: domain ? { shop: domain } : {},
  select: {
    scheduleGid: true,
    dueAt: true,
    completedAt: true,
    balanceDueAmount: true,
    balanceDueCurrency: true,
    order: {
      select: {
        orderGid: true,
        name: true,
        attributionStatus: true,
        hasPaymentTerms: true,
        paymentTermsType: true,
        cancelledAt: true,
        financialStatus: true,
        companyId: true,
        company: { select: { companyGid: true, name: true } },
      },
    },
  },
  orderBy: [{ dueAt: "asc" }],
});

/** One schedule, flattened to exactly what a fixture picker needs to choose. */
function describeSchedule(row) {
  const dueAt = row.dueAt;
  const hoursFromDue =
    dueAt === null ? null : Math.round(((dueAt.getTime() - now.getTime()) / HOURS) * 10) / 10;
  return {
    scheduleGid: row.scheduleGid,
    orderGid: row.order.orderGid,
    orderName: row.order.name,
    companyName: row.order.company?.name ?? null,
    companyGid: row.order.company?.companyGid ?? null,
    attributionStatus: row.order.attributionStatus,
    hasPaymentTerms: row.order.hasPaymentTerms,
    paymentTermsType: row.order.paymentTermsType,
    financialStatus: row.order.financialStatus,
    cancelled: row.order.cancelledAt !== null,
    dueAt,
    completedAt: row.completedAt,
    balanceDue:
      row.balanceDueAmount === null
        ? null
        : `${row.balanceDueAmount.toString()} ${row.balanceDueCurrency ?? ""}`.trim(),
    hoursFromDue,
    /** Would the tracer sweep pick this up today? Diagnostic, not a filter. */
    overdueTouchpointCrossed:
      dueAt !== null && dueAt.getTime() + LEAD_MS < now.getTime(),
  };
}

const described = scheduleRows.map(describeSchedule);
const open = described.filter((row) => row.completedAt === null);
const sendable = (row) => row.cancelled === false && row.hasPaymentTerms === true;

/** E1: an OPEN, past-due, company-ATTRIBUTED schedule — the baseline send. */
const e1OpenPastDueAttributed = open.filter(
  (row) =>
    sendable(row) &&
    row.attributionStatus === "ATTRIBUTED" &&
    row.companyGid !== null &&
    row.dueAt !== null &&
    row.dueAt.getTime() < now.getTime(),
);

/** E2: an OPEN schedule whose dueAt is more than the 72h lead in the FUTURE. */
const e2OpenPreDueBeyondLead = open.filter(
  (row) =>
    sendable(row) &&
    row.attributionStatus === "ATTRIBUTED" &&
    row.companyGid !== null &&
    row.dueAt !== null &&
    row.dueAt.getTime() > now.getTime() + LEAD_MS,
);

/** E3: any COMPLETED schedule — the refusal shape 05-03's race handling needs. */
const e3Completed = described.filter((row) => row.completedAt !== null);

/**
 * E4: net-terms orders that are NOT attributed to a company. Queried from the
 * order side, because such an order may exist with no schedule row at all — and
 * "the order ingested but produced no schedule" is itself an E4 answer.
 */
const e4UnattributedNetTermsOrders = (
  await db.ledgerOrder.findMany({
    where: {
      ...(domain ? { shop: domain } : {}),
      hasPaymentTerms: true,
      cancelledAt: null,
      OR: [{ attributionStatus: { not: "ATTRIBUTED" } }, { companyId: null }],
    },
    select: {
      orderGid: true,
      name: true,
      attributionStatus: true,
      paymentTermsType: true,
      financialStatus: true,
      companyId: true,
      createdAt: true,
      schedules: {
        select: { scheduleGid: true, dueAt: true, completedAt: true },
        orderBy: { dueAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  })
).map((order) => ({
  orderGid: order.orderGid,
  orderName: order.name,
  attributionStatus: order.attributionStatus,
  paymentTermsType: order.paymentTermsType,
  financialStatus: order.financialStatus,
  companyAttached: order.companyId !== null,
  ingestedAt: order.createdAt,
  schedules: order.schedules.map((schedule) => ({
    scheduleGid: schedule.scheduleGid,
    dueAt: schedule.dueAt,
    completedAt: schedule.completedAt,
    open: schedule.completedAt === null,
  })),
}));

const categories = {
  E1_open_past_due_attributed: e1OpenPastDueAttributed,
  E2_open_pre_due_beyond_72h: e2OpenPreDueBeyondLead,
  E3_completed: e3Completed,
  E4_unattributed_net_terms_orders: e4UnattributedNetTermsOrders,
};

const fixtures = {
  now,
  leadHours: LEAD_MS / HOURS,
  counts: Object.fromEntries(
    Object.entries(categories).map(([name, rows]) => [name, rows.length]),
  ),
  /** The shopping list: every category with no live row must be built by hand. */
  emptyCategories: Object.entries(categories)
    .filter(([, rows]) => rows.length === 0)
    .map(([name]) => name),
  ...categories,
  scheduleTotal: described.length,
  allSchedules: described,
};

/* ------------------------------------------------------------------ *
 * Touchpoint plan + now-selection (plan 05-05, Task 1).
 * ------------------------------------------------------------------ */

/**
 * The LP-2/LP-4 drive needs one thing the fixtures block above cannot give it:
 * the exact INSTANT to inject as `now`. Choosing that instant by hand from a
 * list of `dueAt` values is how a live drive crosses three moments instead of
 * one (threat T-05-15), so it is computed here, from the same instant math
 * `reminders.server.ts` uses, against the same eligibility filter the sweep
 * applies — and the answer carries its own tie warning.
 *
 * STILL READ-ONLY, and still no contact field: instants are arithmetic on a
 * `dueAt` Shopify gave us, and the identifiers are the ones already printed
 * above.
 *
 * The eligibility mirror below is deliberately a MIRROR and not a shared
 * import: this script runs inside the container against `@prisma/client` only,
 * with no bundler and no TypeScript. If `eligibleSchedules` ever changes its
 * filter, this block reports a superset or a subset and the LP evidence stops
 * agreeing with the sweep — which is why the filter is spelled out in full
 * rather than approximated.
 */
const TOUCHPOINT_OFFSETS = [
  ["DUE_SOON", -LEAD_MS],
  ["DUE", 0],
  ["OVERDUE", LEAD_MS],
];

/** The tie window: any second instant this close to the target would also be
 *  crossed by `now = target + 5 minutes`, breaking LP-2's "exactly one". */
const TIE_WINDOW_MS = 5 * 60 * 1000;
const INJECTION_OFFSET_MS = 5 * 60 * 1000;

/** `--after <iso>` (or `--after=<iso>`): a provisional watermark, for reading
 *  the plan BEFORE the merchant has enabled reminders. */
const afterFlagIndex = process.argv.findIndex((arg) => arg === "--after");
const afterInline = process.argv.find((arg) => arg.startsWith("--after="));
const afterRaw =
  afterFlagIndex !== -1
    ? (process.argv[afterFlagIndex + 1] ?? null)
    : afterInline
      ? afterInline.slice("--after=".length)
      : null;
const afterOverride =
  afterRaw && !Number.isNaN(Date.parse(afterRaw)) ? new Date(afterRaw) : null;

/** The shop this plan is computed for: the queried domain, else the only shop. */
const planShop =
  shops.find((shop) => shop.domain === domain) ??
  (shops.length === 1 ? shops[0] : null);

const watermark = afterOverride ?? planShop?.remindersEnabledAt ?? null;
const watermarkSource = afterOverride
  ? "--after"
  : planShop?.remindersEnabledAt
    ? "remindersEnabledAt"
    : null;

/** Exactly `eligibleSchedules`' filter (reminders.server.ts), plus the
 *  `dueAt < now + lead` prefilter it applies in the query. */
const dunnable = (row) =>
  row.completedAt === null &&
  row.cancelled === false &&
  row.hasPaymentTerms === true &&
  row.attributionStatus === "ATTRIBUTED" &&
  row.companyGid !== null &&
  row.dueAt !== null;

/** Every reminder row that already exists, keyed the way the claim is. */
const allReminderRows = await db.reminderLog.findMany({
  where: domain ? { shop: domain } : {},
  select: {
    scheduleGid: true,
    orderGid: true,
    touchpoint: true,
    status: true,
    sentAt: true,
    updatedAt: true,
  },
});
const loggedKey = new Map(
  allReminderRows.map((row) => [`${row.scheduleGid}::${row.touchpoint}`, row.status]),
);

const touchpointSchedules = described.filter(dunnable).map((row) => ({
  scheduleGid: row.scheduleGid,
  orderGid: row.orderGid,
  orderName: row.orderName,
  companyName: row.companyName,
  dueAt: row.dueAt,
  instants: TOUCHPOINT_OFFSETS.map(([touchpoint, offset]) => {
    const instant = new Date(row.dueAt.getTime() + offset);
    return {
      touchpoint,
      instant,
      /** Strictly past, exactly as `selectEligible` reads it. */
      crossedAtRealClock: instant.getTime() < now.getTime(),
      afterWatermark:
        watermark === null ? null : instant.getTime() >= watermark.getTime(),
      loggedStatus: loggedKey.get(`${row.scheduleGid}::${touchpoint}`) ?? null,
    };
  }),
}));

/** Flattened, so "the earliest instant after the watermark" is one sort away. */
const allInstants = touchpointSchedules.flatMap((schedule) =>
  schedule.instants.map((entry) => ({
    scheduleGid: schedule.scheduleGid,
    orderGid: schedule.orderGid,
    orderName: schedule.orderName,
    companyName: schedule.companyName,
    dueAt: schedule.dueAt,
    ...entry,
  })),
);

/**
 * What LP-1 must produce: every crossed, unlogged moment, all of which are
 * older than a watermark stamped now — so all of them suppress and none sends.
 * Counted here BEFORE enabling, which is the only time the number is honest.
 */
const crossedUnlogged = allInstants.filter(
  (entry) => entry.crossedAtRealClock && entry.loggedStatus === null,
);

/**
 * Per SCHEDULE, only the most severe crossed-and-unlogged moment can send and
 * the rest are suppressed — but under a watermark stamped at enable time every
 * one of them is PREEXISTING, so the whole set is the expected suppression
 * count. (Rule 3 of `selectEligible`: the watermark runs first and wins.)
 */
const expectedSuppressedPreexisting = crossedUnlogged.length;

const afterWatermark = allInstants
  .filter(
    (entry) =>
      entry.loggedStatus === null &&
      watermark !== null &&
      entry.instant.getTime() >= watermark.getTime(),
  )
  .sort((left, right) => left.instant.getTime() - right.instant.getTime());

const target = afterWatermark[0] ?? null;

const nextInstantAfterWatermark =
  target === null
    ? null
    : {
        scheduleGid: target.scheduleGid,
        orderGid: target.orderGid,
        orderName: target.orderName,
        companyName: target.companyName,
        touchpoint: target.touchpoint,
        instant: target.instant,
        dueAt: target.dueAt,
        /** The `now` to inject: five minutes past the moment, never earlier. */
        injectedNow: new Date(target.instant.getTime() + INJECTION_OFFSET_MS),
        minutesFromRealClock:
          Math.round(((target.instant.getTime() - now.getTime()) / 60000) * 10) / 10,
        /**
         * Any OTHER unlogged instant that `now = instant + 5 min` would also
         * cross. A non-empty list means the drive proves "at most one per
         * schedule", not "exactly one send" — report it rather than send into it.
         */
        ties: afterWatermark
          .slice(1)
          .filter(
            (entry) =>
              entry.instant.getTime() - target.instant.getTime() < TIE_WINDOW_MS,
          )
          .map((entry) => ({
            scheduleGid: entry.scheduleGid,
            orderName: entry.orderName,
            touchpoint: entry.touchpoint,
            instant: entry.instant,
          })),
      };

const touchpointPlan = {
  now,
  watermark,
  watermarkSource,
  tieWindowMinutes: TIE_WINDOW_MS / 60000,
  injectionOffsetMinutes: INJECTION_OFFSET_MS / 60000,
  dunnableScheduleCount: touchpointSchedules.length,
  crossedUnloggedCount: crossedUnlogged.length,
  expectedSuppressedPreexisting,
  crossedUnlogged,
  nextInstantAfterWatermark,
  /** The next few, so LP-4's "that schedule's NEXT instant" is already here. */
  upcomingAfterWatermark: afterWatermark.slice(0, 10),
  schedules: touchpointSchedules,
};

/**
 * The most recent row this app believes it SENT for each order. It is NOT the
 * N1 answer — Shopify's 24h limit counts reminders sent by ANY means, including
 * the hand-driven sends of 05-02 that never touched this table — so this is
 * read alongside `scripts/prod-reminder-recipients.sh`, never instead of it.
 */
const lastSendByOrder = Object.fromEntries(
  Object.entries(
    allReminderRows
      .filter((row) => row.status === "SENT" || row.status === "SENT_UNCONFIRMED")
      .reduce((acc, row) => {
        const stamp = row.sentAt ?? row.updatedAt;
        const held = acc[row.orderGid];
        if (!held || (held.sentAt ?? held.updatedAt) < stamp) acc[row.orderGid] = row;
        return acc;
      }, {}),
  ).map(([orderGid, row]) => [
    orderGid,
    {
      scheduleGid: row.scheduleGid,
      touchpoint: row.touchpoint,
      status: row.status,
      sentAt: row.sentAt,
      hoursAgo:
        Math.round(
          ((now.getTime() - (row.sentAt ?? row.updatedAt).getTime()) / HOURS) * 10,
        ) / 10,
    },
  ]),
);

console.log(
  JSON.stringify(
    jsonSafe({
      queriedDomain: domain,
      migrations: migrations.map((row) => row.migration_name),
      lastMigrationFinishedAt: migrations[migrations.length - 1]?.finished_at,
      reminderLogTable: reminderLogTable[0]?.name ?? null,
      shopRemindersColumn: remindersColumn[0] ?? null,
      shops: {
        total: shops.length,
        active: shops.filter((shop) => shop.active).length,
        remindersEnabled: shops.filter((shop) => shop.remindersEnabledAt).length,
        rows: shops,
      },
      reminderRowCount: reminderRows.length,
      reminderRowsByStatus: reminderRows.reduce((acc, row) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1;
        return acc;
      }, {}),
      reminderRowsByTouchpoint: reminderRows.reduce((acc, row) => {
        acc[row.touchpoint] = (acc[row.touchpoint] ?? 0) + 1;
        return acc;
      }, {}),
      reminderRows,
      fixtures,
      touchpointPlan,
      lastSendByOrder,
      leases,
    }),
    null,
    2,
  ),
);

await db.$disconnect();
