import { useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { REMINDERS_CADENCE } from "../reminder-copy";
import {
  isReviewResultCode,
  type ReviewResultCode,
} from "../review-codes";
import { authenticate } from "../shopify.server";
import {
  loadDashboard,
  resolveLocale,
  type Badge,
  type BannerSelection,
  type DashboardData,
  type OverdueRow,
  type ReminderTooltip,
  type UpcomingRow,
  type UtilisationRow,
} from "../services/dashboard.server";
import {
  dismissOnboarding,
  loadHomeOnboarding,
  markBalancesReviewed,
  recordReviewPromptResult,
} from "../services/onboarding.server";
// The guide's copy and shape come from the transport-free module, never from
// the service: importing a value out of a `.server` module into a component is
// the 04-04 build trap (see app/setup-copy.ts).
import { SETUP_COPY } from "../setup-copy";
import type { SetupState, SetupStep } from "../setup-copy";

/**
 * The AR dashboard — the merchant's home page (DASH-01, DASH-02, D6-02).
 *
 * Every string this page renders is a contract from 06-UI-SPEC.md's
 * Copywriting Contract and is byte-exact. They all live in `COPY` so a spec can
 * pin them: a rule that survives only as a literal buried in JSX is a rule
 * nobody is checking.
 *
 * THE PAGE DERIVES NOTHING. The loader has already summed, formatted and dated
 * everything into strings, so the server-rendered and the hydrated markup
 * cannot disagree, and the only logic here is which of those strings to show.
 *
 * The vocabulary is "credit hold", never "blocked $X": per-attempt blocks are
 * unobservable on this platform (D4-03), and claiming money we cannot prove is
 * both dishonest and an App Store 1.1 problem (threat T-06-04).
 *
 * NO ADMIN API CALL LIVES ON THIS PATH. A Shopify outage must not take the
 * merchant's home page with it (06-RESEARCH Pattern 2, threat T-06-03).
 */

/* ------------------------------------------------------------------ *
 * Copy — 06-UI-SPEC.md Copywriting Contract, byte-exact.
 * ------------------------------------------------------------------ */

export const COPY = {
  /** P1. */
  pageTitle: "Credit Guard",

  /** P2 — KPI labels, left to right. */
  kpiTotalOutstanding: "Total outstanding",
  kpiOverdueCompanies: "Overdue companies",
  kpiOnCreditHold: "On credit hold",
  kpiDueIn7Days: "Due in 7 days",

  /** P3 — section headings. */
  overdueHeading: "Overdue companies",
  upcomingHeading: "Due in the next 30 days",
  closestToLimitHeading: "Closest to limit",
  feedHeading: "Credit holds and bypasses",
  remindersHeading: "Payment reminders",

  /** P4 — section header links. */
  viewAllCompanies: "View all companies",
  reminderSettings: "Reminder settings",

  /** P5 — overflow lines, each followed by the "View all companies" link. */
  overdueOverflow: (total: string) =>
    `Showing 10 of ${total} overdue companies.`,
  upcomingOverflow: (total: string) =>
    `Showing 15 of ${total} upcoming payments.`,

  /** F0 — the feed's subdued intro. */
  feedIntro:
    "A company goes on credit hold when it's over its limit or overdue. Orders listed here went through while a hold was active.",

  /** Table header rows. */
  overdueHeaders: ["Company", "Outstanding", "Earliest due", "Status"],
  upcomingHeaders: ["Order", "Company", "Due", "Outstanding"],
  closestToLimitHeaders: [
    "Company",
    "Outstanding",
    "Credit limit",
    "Utilization",
  ],
  feedHeaders: ["When", "Event", "Details"],
  /** R3. */
  reminderHeaders: ["When", "Company", "Order", "Reminder", "Status"],

  /** B1. */
  bannerBackfillHeading: "Still importing your order history",
  bannerBackfillBody:
    "Balances and due dates may be incomplete for a few minutes. Credit Guard hasn't changed anything in your store.",
  /** B2. */
  bannerIncompleteHeading: "Some balances may be incomplete",
  bannerIncompleteBody:
    'A few net-terms orders couldn\'t be matched to a company yet. Totals on this page leave them out until they\'re matched. Companies affected show "· incomplete" next to their balance.',
  /** B3a. */
  bannerBypassedOneHeading: "1 order went through during a credit hold",
  bannerBypassedOneBody: (order: string, amount: string, company: string) =>
    `Order ${order} (${amount}) was placed while ${company} was on credit hold in the last 30 days. Orders completed from a draft or with bypass turned on aren't checked.`,
  /** B3b. */
  bannerBypassedManyHeading: (count: string) =>
    `${count} orders went through during credit holds`,
  bannerBypassedManyBody: (count: string, sum: string) =>
    `${count} orders totalling ${sum} were placed while companies were on credit hold in the last 30 days. Orders completed from a draft or with bypass turned on aren't checked.`,

  /** E1b / E2 / E3 / E4 / E5. */
  emptyNoCompanies:
    "No companies yet. Companies from your store's B2B net-terms orders appear here automatically.",
  emptyNoOverdue: "No overdue companies.",
  emptyUpcoming: "No net-terms payments due in the next 30 days.",
  emptyFeed:
    "No credit holds yet. When a company goes over its limit or overdue, it shows up here.",
  emptyClosestToLimit: "No companies have a credit limit yet.",
  setALimit: "Set a limit",

  /** R1. */
  remindersOnSince: (date: string) =>
    `Payment reminders are on since ${date}.`,
  /**
   * R2 — composed from the SHARED cadence constant, never a literal of this
   * page's own (W-04). Settings says the same three moments in the same words
   * because both surfaces read the same string; a merchant who found two
   * different cadences on two screens of one app would be right not to trust
   * either. The sentence itself is a claim about the sweep's behaviour
   * (DUE_SOON_LEAD_MS and OVERDUE_OFFSET_MS are both 72h), so it changes only
   * when that behaviour does.
   */
  emptyReminders: `No reminders sent yet. Credit Guard emails a company ${REMINDERS_CADENCE}.`,
  /** R4 — the link text sits between these two halves. */
  remindersOffBefore:
    "Payment reminders are off. Credit Guard never emails your customers until you turn this on in ",
  remindersOffAfter: ".",

  /** Status badges (Phase 3 vocabulary, reused). */
  badgeOnCreditHold: "On credit hold",
  badgeOverdue: "Overdue",
  badgeBypassed: "Enforcement bypassed",

  /** T1 — T4. */
  tooltipIncomplete:
    "Some orders couldn't be fully matched yet. This total may be incomplete.",
  tooltipCreditHold:
    "A company is on credit hold when it's over its credit limit or has an overdue balance, and bypass is off. Its buyers can't complete a new net-terms order.",
  tooltipUnconfirmed:
    "The email was handed to the mail provider but delivery wasn't confirmed.",
  tooltipDead:
    "Credit Guard stopped retrying this reminder. The next scheduled reminder will still be sent.",

  /** The Phase 3 incomplete-data marker, reused on K1. */
  incompleteMarker: "· incomplete",
} as const;

/** What a money tile shows when there is nothing to total. */
const EM_DASH = "—";

/* ------------------------------------------------------------------ *
 * Loader
 * ------------------------------------------------------------------ */

export interface DashboardPageData extends DashboardData {
  /** DASH-03 — the guided setup, or an invisible state once dismissed. */
  setup: SetupState;
  /** LNCH-02 — may the page ask for a review on this load? */
  reviewEligible: boolean;
}

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<DashboardPageData> => {
  // The tenant boundary: `session.shop`, never a search param (T-06-01).
  const { session } = await authenticate.admin(request);
  const locale = resolveLocale(request);

  const [dashboard, onboarding] = await Promise.all([
    loadDashboard(session.shop, {
      locale,
      // Merchant-supplied; `loadDashboard` clamps it (T-06-02).
      feedPage: Number(new URL(request.url).searchParams.get("feedPage")),
    }),
    // One Shop read answers both halves. The live checkout-rule status behind
    // step 3 is fetched ONLY while the guide is visible; a dismissed guide
    // short-circuits before any Shopify call (T-06-22).
    loadHomeOnboarding(session.shop, { locale }),
  ]);

  return { ...dashboard, ...onboarding };
};

/* ------------------------------------------------------------------ *
 * Action — the guided setup's bookkeeping, and nothing else.
 * ------------------------------------------------------------------ */

export type DashboardActionResult =
  | { ok: true; intent: string; stamped?: boolean }
  | { ok: false; code: string };

function fail(code: string, status: number) {
  return data<DashboardActionResult>({ ok: false, code }, { status });
}

/**
 * A CLOSED set of intents, dispatched exactly the way the Companies page does
 * it: the shop comes from the session and never from the form, so a forged
 * post can only ever stamp the poster's own store (T-06-18), and anything not
 * named below is a 400 rather than a silent no-op (T-06-19).
 *
 * Nothing here writes to Shopify. The guide's whole job is to point at work the
 * merchant does elsewhere.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = new Date();

  switch (intent) {
    case "mark-reviewed": {
      const result = await markBalancesReviewed(shop, now);
      if (!result.ok) {
        return fail(result.code, result.code === "not-found" ? 404 : 409);
      }
      return data<DashboardActionResult>({ ok: true, intent });
    }

    case "dismiss-onboarding": {
      // The 3/3 check happens server-side inside `dismissOnboarding`: the
      // button only renders at 3/3, but a rendered button is a hint and this
      // is the boundary (T-06-20).
      const result = await dismissOnboarding(shop, now);
      if (!result.ok) return fail(result.code, 409);
      return data<DashboardActionResult>({ ok: true, intent });
    }

    case "review-prompt-result": {
      const code = String(form.get("code") ?? "");
      if (!isReviewResultCode(code)) return fail("invalid-code", 400);

      const result = await recordReviewPromptResult(shop, code, now);
      if (!result.ok) return fail(result.code, 400);

      return data<DashboardActionResult>({
        ok: true,
        intent,
        stamped: result.stamped,
      });
    }

    default:
      return fail("unknown-intent", 400);
  }
};

/* ------------------------------------------------------------------ *
 * Pure rendering derivations — tested without a DOM.
 * ------------------------------------------------------------------ */

export interface PageBanner {
  tone: "info" | "warning";
  heading: string;
  body: string;
}

/**
 * The loader picked WHICH banner; this fills in its copy. Precedence lives in
 * `selectBanner` alone, so the page cannot quietly grow a second opinion.
 */
export function bannerFor(banner: BannerSelection | null): PageBanner | null {
  if (banner === null) return null;

  switch (banner.kind) {
    case "backfill-running":
      return {
        tone: "info",
        heading: COPY.bannerBackfillHeading,
        body: COPY.bannerBackfillBody,
      };
    case "data-incomplete":
      return {
        tone: "info",
        heading: COPY.bannerIncompleteHeading,
        body: COPY.bannerIncompleteBody,
      };
    case "bypassed-one":
      return {
        tone: "warning",
        heading: COPY.bannerBypassedOneHeading,
        body: COPY.bannerBypassedOneBody(
          banner.orderName,
          banner.amountLabel,
          banner.companyName,
        ),
      };
    case "bypassed-many":
      return {
        tone: "warning",
        heading: COPY.bannerBypassedManyHeading(banner.countLabel),
        body: COPY.bannerBypassedManyBody(banner.countLabel, banner.sumLabel),
      };
  }
}

/**
 * At most two badges, never three (UI-SPEC Badge & Tone Semantics).
 *
 * "Overdue" is implied by the section heading, so a company that is BOTH
 * overdue and on hold shows the more consequential fact — its buyers cannot
 * complete a new net-terms order — and the bypass badge keeps its second slot.
 */
export function overdueStatusBadges(row: {
  blockedState: boolean;
  bypassEnforcement: boolean;
}): Badge[] {
  const badges: Badge[] = [
    row.blockedState
      ? { text: COPY.badgeOnCreditHold, tone: "critical" }
      : { text: COPY.badgeOverdue, tone: "critical" },
  ];

  if (row.bypassEnforcement) {
    badges.push({ text: COPY.badgeBypassed, tone: "caution" });
  }

  return badges;
}

/** E1b when the shop has no companies at all, otherwise E2. */
export function overdueEmptyCopy(companyCount: number): string {
  return companyCount === 0 ? COPY.emptyNoCompanies : COPY.emptyNoOverdue;
}

const REMINDER_TOOLTIP_COPY: Record<ReminderTooltip, string> = {
  unconfirmed: COPY.tooltipUnconfirmed,
  dead: COPY.tooltipDead,
};

/* ------------------------------------------------------------------ *
 * UI
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Guided setup (DASH-03) — rows derived server-side, rendered verbatim.
 * ------------------------------------------------------------------ */

/**
 * One setup row: icon · (title, body) · action.
 *
 * The component decides NOTHING. Which icon, which body, which button label
 * and which button is the page's single primary all arrive already derived
 * from `onboarding.server.ts`, so the rule and the rendering cannot drift.
 */
function SetupRow({
  step,
  onIntent,
  busy,
}: {
  step: SetupStep;
  onIntent: (intent: string) => void;
  busy: boolean;
}) {
  const running =
    step.id === 1 && step.button?.disabled === true && !step.complete;

  return (
    <s-stack direction="inline" gap="base" alignItems="center">
      <s-icon type={step.icon.type} tone={step.icon.tone} />
      <s-stack gap="small-200">
        <s-text type="strong">{step.title}</s-text>
        {step.body === "" ? null : (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            {/*
              A genuine in-progress indicator for a background job — the one
              spinner the page is allowed (UI-SPEC § Loading).
            */}
            {/*
              CATALOG SUBSTITUTION: `s-spinner` has no "small" size in
              polaris-types 1.0.1 (`base | large | large-100`), so the spec's
              `size="small"` becomes the smallest size that exists — the live
              catalog wins over the spec (hard rule 4).
            */}
            {running ? <s-spinner size="base" /> : null}
            <s-text color="subdued">{step.body}</s-text>
          </s-stack>
        )}
        {step.link === undefined ? null : (
          <s-link href={step.link.href}>{step.link.label}</s-link>
        )}
      </s-stack>
      {step.button === null ? null : step.button.href !== undefined ? (
        <s-button variant={step.button.variant} href={step.button.href}>
          {step.button.label}
        </s-button>
      ) : (
        <s-button
          variant={step.button.variant}
          disabled={step.button.disabled === true || busy}
          onClick={() => {
            if (step.button?.intent) onIntent(step.button.intent);
          }}
        >
          {step.button.label}
        </s-button>
      )}
    </s-stack>
  );
}

/**
 * The "Set up Credit Guard" section — rendered while
 * `Shop.onboardingDismissedAt` is null and gone for good after "Done"
 * (BFS 4.2.2 #6: onboarding must be removable once it is complete).
 */
function SetupGuide({ setup }: { setup: SetupState }) {
  const fetcher = useFetcher<DashboardActionResult>();
  const shopify = useAppBridge();
  const result = fetcher.data;
  const busy = fetcher.state !== "idle";

  const submit = (intent: string) => {
    fetcher.submit({ intent }, { method: "post" });
  };

  // `fetcher.data` survives after the fetcher settles, so each outcome is
  // handled once by identity rather than re-toasting on every render — the
  // Companies page pattern.
  const handled = useRef<DashboardActionResult | undefined>(undefined);
  useEffect(() => {
    if (fetcher.state !== "idle" || !result || handled.current === result) {
      return;
    }
    handled.current = result;

    if (result.ok) {
      shopify.toast.show(
        result.intent === "dismiss-onboarding"
          ? SETUP_COPY.toastDismissed
          : SETUP_COPY.toastReviewed,
      );
      return;
    }

    shopify.toast.show(SETUP_COPY.toastFailed, { isError: true });
  }, [fetcher.state, result, shopify]);

  return (
    <s-section heading={SETUP_COPY.heading}>
      <s-stack gap="base">
        <s-text color="subdued">{setup.progressLabel}</s-text>
        {setup.steps.map((step, index) => (
          <s-stack key={step.id} gap="base">
            {index === 0 ? null : <s-divider />}
            <SetupRow step={step} onIntent={submit} busy={busy} />
          </s-stack>
        ))}
        {setup.allDone ? (
          <s-button
            variant="primary"
            disabled={busy}
            onClick={() => {
              submit("dismiss-onboarding");
            }}
          >
            {SETUP_COPY.doneButton}
          </s-button>
        ) : null}
      </s-stack>
    </s-section>
  );
}

/**
 * The review moment (LNCH-02) — timing and bookkeeping, and NO UI of ours.
 *
 * Shopify draws the modal, enforces its own rate limits (once per 60 days,
 * three per year, never inside the first 24 hours) and decides whether the
 * merchant is eligible at all. Our entire job is choosing the moment: the next
 * dashboard load after something has actually worked for this store.
 *
 * WHY AN EFFECT AND NOT A BUTTON. Tying the ask to a click is explicitly
 * discouraged by Shopify, and any prompt of ours — a banner, a "rate us" link,
 * anything nudging toward a rating — is an App Store policy 1.3.1 problem
 * (T-06-21). So this component renders nothing at all: the page looks
 * identical whether or not the modal appears.
 *
 * EXACTLY ONE ASK PER LOAD, NO RETRY LOOP. There is no timer and no polling.
 * The only path to asking again is a later page load while `reviewPromptedAt`
 * is still null, which happens only for the three codes Shopify never
 * evaluated (B-01).
 */
function useReviewPrompt(reviewEligible: boolean): void {
  const shopify = useAppBridge();
  const fetcher = useFetcher();

  useEffect(() => {
    if (!reviewEligible) return;

    let cancelled = false;

    void (async () => {
      // A throw and an evaluated refusal are indistinguishable from here, and
      // both mean "asked, got an answer we cannot act on" — so both post, and
      // both stamp (UI-SPEC Review Prompt Contract, Failure row).
      let code: ReviewResultCode = "error";
      try {
        const result = await shopify.reviews.request();
        if (isReviewResultCode(result.code)) code = result.code;
      } catch {
        // Never surfaced to the merchant. There is nothing they could do.
      }

      if (cancelled) return;
      fetcher.submit({ intent: "review-prompt-result", code }, { method: "post" });
    })();

    return () => {
      cancelled = true;
    };
    // Deliberately keyed on eligibility alone: including `fetcher` would re-run
    // the ask every time its state changed, which is the nag this hook exists
    // to make impossible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewEligible]);
}

function BadgeCell({ badges }: { badges: Badge[] }) {
  return (
    <s-table-cell>
      {badges.map((badge) => (
        <s-badge key={badge.text} tone={badge.tone}>
          {badge.text}
        </s-badge>
      ))}
    </s-table-cell>
  );
}

function KpiTile({
  label,
  value,
  tooltip,
  tooltipId,
  suffix,
}: {
  label: string;
  value: string;
  tooltip?: string;
  tooltipId?: string;
  suffix?: React.ReactNode;
}) {
  return (
    <s-section>
      <s-stack gap="small-200">
        {tooltip && tooltipId ? (
          <>
            <s-text color="subdued" interestFor={tooltipId}>
              {label}
            </s-text>
            <s-tooltip id={tooltipId}>{tooltip}</s-tooltip>
          </>
        ) : (
          <s-text color="subdued">{label}</s-text>
        )}
        {/* The only display-size number on the page. */}
        <s-heading>{value}</s-heading>
        {suffix}
      </s-stack>
    </s-section>
  );
}

function OverdueTable({ rows }: { rows: OverdueRow[] }) {
  return (
    <s-table variant="auto">
      <s-table-header-row>
        <s-table-header listSlot="primary">
          {COPY.overdueHeaders[0]}
        </s-table-header>
        <s-table-header format="currency">
          {COPY.overdueHeaders[1]}
        </s-table-header>
        <s-table-header>{COPY.overdueHeaders[2]}</s-table-header>
        <s-table-header>{COPY.overdueHeaders[3]}</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {rows.map((row) => (
          <s-table-row key={row.id}>
            {/* Names wrap rather than truncate: data integrity over tidiness. */}
            <s-table-cell>{row.name}</s-table-cell>
            <s-table-cell>{row.outstanding}</s-table-cell>
            <s-table-cell>{row.earliestDue ?? EM_DASH}</s-table-cell>
            <BadgeCell badges={overdueStatusBadges(row)} />
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}

function UpcomingTable({ rows }: { rows: UpcomingRow[] }) {
  return (
    <s-table variant="auto">
      <s-table-header-row>
        <s-table-header listSlot="primary">
          {COPY.upcomingHeaders[0]}
        </s-table-header>
        <s-table-header>{COPY.upcomingHeaders[1]}</s-table-header>
        <s-table-header>{COPY.upcomingHeaders[2]}</s-table-header>
        <s-table-header format="currency">
          {COPY.upcomingHeaders[3]}
        </s-table-header>
      </s-table-header-row>
      <s-table-body>
        {rows.map((row) => (
          <s-table-row key={row.id}>
            {/*
              Plain text, not a link: no admin deep-link contract for orders is
              verified in the embedded admin this phase, and a broken link is
              worse than none.
            */}
            <s-table-cell>{row.orderName}</s-table-cell>
            <s-table-cell>{row.companyName}</s-table-cell>
            <s-table-cell>{row.due}</s-table-cell>
            <s-table-cell>{row.outstanding}</s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}

function ClosestToLimitTable({ rows }: { rows: UtilisationRow[] }) {
  return (
    <s-table variant="auto">
      <s-table-header-row>
        <s-table-header listSlot="primary">
          {COPY.closestToLimitHeaders[0]}
        </s-table-header>
        <s-table-header format="currency">
          {COPY.closestToLimitHeaders[1]}
        </s-table-header>
        <s-table-header format="currency">
          {COPY.closestToLimitHeaders[2]}
        </s-table-header>
        <s-table-header format="numeric">
          {COPY.closestToLimitHeaders[3]}
        </s-table-header>
      </s-table-header-row>
      <s-table-body>
        {rows.map((row) => (
          <s-table-row key={row.id}>
            <s-table-cell>{row.name}</s-table-cell>
            <s-table-cell>{row.outstanding}</s-table-cell>
            <s-table-cell>{row.creditLimit}</s-table-cell>
            {/* A number, never a verdict: the percent is the whole claim. */}
            <s-table-cell>{row.utilisation}</s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}

export default function Dashboard() {
  const {
    kpis,
    overdue,
    upcoming,
    closestToLimit,
    feed,
    reminders,
    banner,
    setup,
    reviewEligible,
  } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

  useReviewPrompt(reviewEligible);

  const pageBanner = bannerFor(banner);

  const goToFeedPage = (next: number) => {
    setSearchParams((params) => {
      params.set("feedPage", String(next));
      return params;
    });
  };

  return (
    <s-page heading={COPY.pageTitle}>
      {/* At most ONE banner, chosen by the loader's precedence rule. */}
      {pageBanner === null ? null : (
        <s-banner tone={pageBanner.tone} heading={pageBanner.heading}>
          <s-paragraph>{pageBanner.body}</s-paragraph>
        </s-banner>
      )}

      {/*
        The guided setup (DASH-03), directly under the banner slot and above
        the KPI row, while `Shop.onboardingDismissedAt` is null.
      */}
      {setup.visible ? <SetupGuide setup={setup} /> : null}

      {/*
        Four tiles at default admin width, 2x2 at narrow, one column on mobile
        — `auto-fit` does it with no breakpoint of ours to maintain.
      */}
      <s-grid
        gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))"
        gap="base"
      >
        <KpiTile
          label={COPY.kpiTotalOutstanding}
          value={kpis.totalOutstanding.value ?? EM_DASH}
          suffix={
            kpis.totalOutstanding.incomplete ? (
              <>
                <s-text color="subdued" interestFor="kpi-total-incomplete">
                  {COPY.incompleteMarker}
                </s-text>
                <s-tooltip id="kpi-total-incomplete">
                  {COPY.tooltipIncomplete}
                </s-tooltip>
              </>
            ) : undefined
          }
        />
        <KpiTile
          label={COPY.kpiOverdueCompanies}
          value={kpis.overdueCompanies}
        />
        <KpiTile
          label={COPY.kpiOnCreditHold}
          value={kpis.onCreditHold}
          tooltip={COPY.tooltipCreditHold}
          tooltipId="kpi-credit-hold"
        />
        <KpiTile
          label={COPY.kpiDueIn7Days}
          value={kpis.dueIn7Days.value ?? EM_DASH}
        />
      </s-grid>

      <s-section heading={COPY.overdueHeading}>
        <s-link slot="primary-action" href="/app/companies">
          {COPY.viewAllCompanies}
        </s-link>
        {overdue.rows.length === 0 ? (
          <s-paragraph>{overdueEmptyCopy(overdue.companyCount)}</s-paragraph>
        ) : (
          <>
            <OverdueTable rows={overdue.rows} />
            {overdue.total > overdue.rows.length ? (
              <s-paragraph>
                <s-text color="subdued">
                  {COPY.overdueOverflow(overdue.totalLabel)}
                </s-text>{" "}
                <s-link href="/app/companies">{COPY.viewAllCompanies}</s-link>
              </s-paragraph>
            ) : null}
          </>
        )}
      </s-section>

      <s-section heading={COPY.upcomingHeading}>
        {upcoming.rows.length === 0 ? (
          <s-paragraph>{COPY.emptyUpcoming}</s-paragraph>
        ) : (
          <>
            <UpcomingTable rows={upcoming.rows} />
            {upcoming.total > upcoming.rows.length ? (
              <s-paragraph>
                <s-text color="subdued">
                  {COPY.upcomingOverflow(upcoming.totalLabel)}
                </s-text>{" "}
                <s-link href="/app/companies">{COPY.viewAllCompanies}</s-link>
              </s-paragraph>
            ) : null}
          </>
        )}
      </s-section>

      <s-section heading={COPY.closestToLimitHeading}>
        {closestToLimit.rows.length === 0 ? (
          <s-paragraph>
            {COPY.emptyClosestToLimit}{" "}
            <s-link href="/app/companies">{COPY.setALimit}</s-link>
          </s-paragraph>
        ) : (
          <ClosestToLimitTable rows={closestToLimit.rows} />
        )}
      </s-section>

      <s-section heading={COPY.feedHeading}>
        <s-paragraph>
          <s-text color="subdued">{COPY.feedIntro}</s-text>
        </s-paragraph>
        {feed.rows.length === 0 ? (
          <s-paragraph>{COPY.emptyFeed}</s-paragraph>
        ) : (
          <s-table
            variant="auto"
            paginate={feed.hasNextPage || feed.hasPreviousPage}
            hasNextPage={feed.hasNextPage}
            hasPreviousPage={feed.hasPreviousPage}
            onNextPage={() => {
              goToFeedPage(feed.page + 1);
            }}
            onPreviousPage={() => {
              goToFeedPage(feed.page - 1);
            }}
          >
            <s-table-header-row>
              <s-table-header>{COPY.feedHeaders[0]}</s-table-header>
              <s-table-header>{COPY.feedHeaders[1]}</s-table-header>
              <s-table-header listSlot="primary">
                {COPY.feedHeaders[2]}
              </s-table-header>
            </s-table-header-row>
            <s-table-body>
              {feed.rows.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>{row.when}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={row.badge.tone}>{row.badge.text}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{row.details}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading={COPY.remindersHeading}>
        <s-link slot="primary-action" href="/app/settings">
          {COPY.reminderSettings}
        </s-link>
        {!reminders.enabled ? (
          <s-paragraph>
            {COPY.remindersOffBefore}
            <s-link href="/app/settings">{COPY.reminderSettings}</s-link>
            {COPY.remindersOffAfter}
          </s-paragraph>
        ) : (
          <>
            <s-paragraph>
              {COPY.remindersOnSince(reminders.enabledSince ?? EM_DASH)}
            </s-paragraph>
            {reminders.rows.length === 0 ? (
              <s-paragraph>{COPY.emptyReminders}</s-paragraph>
            ) : (
              <s-table variant="auto">
                <s-table-header-row>
                  <s-table-header>{COPY.reminderHeaders[0]}</s-table-header>
                  <s-table-header listSlot="primary">
                    {COPY.reminderHeaders[1]}
                  </s-table-header>
                  <s-table-header>{COPY.reminderHeaders[2]}</s-table-header>
                  <s-table-header>{COPY.reminderHeaders[3]}</s-table-header>
                  <s-table-header>{COPY.reminderHeaders[4]}</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {reminders.rows.map((row) => (
                    <s-table-row key={row.id}>
                      <s-table-cell>{row.when}</s-table-cell>
                      <s-table-cell>{row.companyName}</s-table-cell>
                      <s-table-cell>{row.orderName}</s-table-cell>
                      <s-table-cell>{row.touchpoint}</s-table-cell>
                      <s-table-cell>
                        {row.badge.tooltip === null ? (
                          <s-badge tone={row.badge.tone}>
                            {row.badge.text}
                          </s-badge>
                        ) : (
                          <>
                            {/*
                              CATALOG SUBSTITUTION: `s-badge` carries no
                              `interestFor` in polaris-types 1.0.1, so the
                              tooltip hangs off an `s-text` wrapper — the
                              nearest primitive that does (hard rule 4). The
                              badge still carries its own visible text.
                            */}
                            <s-text interestFor={`reminder-${row.id}`}>
                              <s-badge tone={row.badge.tone}>
                                {row.badge.text}
                              </s-badge>
                            </s-text>
                            <s-tooltip id={`reminder-${row.id}`}>
                              {REMINDER_TOOLTIP_COPY[row.badge.tooltip]}
                            </s-tooltip>
                          </>
                        )}
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
