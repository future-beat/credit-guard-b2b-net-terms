import * as Sentry from "@sentry/react-router";

import db from "../db.server";
import { LedgerGraphqlError, graphqlJson } from "./ledger.server";
import { forEachActiveShop } from "./scheduler.server";

/**
 * Payment reminders — the credit-aware dunning calendar (REMD-01, D5-01/D5-02).
 *
 * The app does NOT send email. Under D5-01 the only thing that leaves this
 * module is a `PaymentSchedule` GID the ledger already stores: Shopify resolves
 * the recipient (the company's main contact), renders the merchant's own
 * "Payment reminder" notification template with its canonical pay-now link, and
 * sends it from the merchant's authenticated sender. That is why this file has
 * no template, no address book and no email provider — and why PRIVACY.md's
 * "no customer personal data" posture survives a feature that emails customers.
 *
 * Three rules hold here, and for every reminder code path added later:
 *
 * 1. AT-MOST-ONCE, VIA CLAIM-THEN-SEND. A `ReminderLog` row is INSERTed with
 *    status SENDING *before* the mutation is called; the P2002 unique violation
 *    on `@@unique([shop, scheduleGid, touchpoint])` is the dedupe. Crashing
 *    between the claim and the send drops one reminder — harmless, the next
 *    touchpoint still fires. Sending before logging double-emails a real buyer,
 *    which is the failure that gets an app uninstalled (research Pattern 2 /
 *    Pitfall 3). Never reorder these two steps.
 * 2. THE LEASE IS HYGIENE, THE UNIQUE CONSTRAINT IS CORRECTNESS. Verbatim
 *    scheduler rule 2: `runExclusive` exists to stop Railway's deploy-overlap
 *    window from double-sending merchant-visible email, NOT to make the writes
 *    safe. Never reason "the lease held, therefore this can skip its claim."
 * 3. THE GATE COMES BEFORE THE WORK. `Shop.remindersEnabledAt` null means OFF,
 *    and off is the default for every shop that has ever existed (D5-02). The
 *    sweep returns before it queries a single schedule, so a deployment that
 *    carries this code to production cannot email anyone until a merchant
 *    opts in. Inert by construction, not by configuration.
 *
 * NO PERSONAL DATA, EVER. No GraphQL document in this file may name a field on
 * `Customer`, `CompanyContact`, `Order.email` or `Order.statusPageUrl` — those
 * are protected-customer-data Level 2 surfaces and reaching for one turns a
 * feature into a compliance project (research Pitfall 5). The reminder queries
 * touch `PaymentSchedule { id dueAt completedAt }` and nothing else.
 *
 * SHAPE: a PURE CORE decides, an I/O half executes. `deriveTouchpoints` and
 * `selectEligible` below take instants and return decisions — no database, no
 * clock, no network — so the entire REMD-01 calendar is testable to the
 * millisecond. Everything under the I/O line composes those two functions and
 * never re-decides what they decided. When a reminder goes to the wrong buyer
 * at the wrong moment, the bug is in the pure half and it is provable there.
 *
 * 4. NEVER WRITE LEDGER STATE. This module reads `LedgerSchedule` and writes
 *    `ReminderLog`, full stop. `recomputeCompany` is the sole writer of
 *    `Company.overdue` and every other credit field (ledger rule 3); a sweep
 *    that "helpfully" corrected exposure on its way past would give the app two
 *    disagreeing sources of truth for whether a buyer may check out.
 *
 * THE ORDER OF OPERATIONS IS THE FEATURE. Per schedule: derive -> select ->
 * write suppressions -> per-ORDER 24h guard -> cap -> claim -> live refetch ->
 * send -> classify -> resolve. Each step can only ever REDUCE what gets sent,
 * and the two that can silence a message entirely (the guard and the refetch)
 * both run before anything irreversible happens.
 */

/* ------------------------------------------------------------------ *
 * Cadence, lease identity, and the touchpoint calendar.
 * ------------------------------------------------------------------ */

/**
 * This sweep's OWN lease name — never one of the Phase-2 leases. The scheduler
 * module reserves this slot explicitly: "two different sweeps behind one lease
 * would let a slow reconciliation suppress reminder emails."
 */
export const REMINDER_SWEEP_LEASE = "reminder-sweep";

/**
 * Hourly at minute 30, deliberately offset from the minute-0 overdue sweep so a
 * long ledger pass never delays the dunning tick behind it. Hourly is the
 * resolution the touchpoint math needs: a threshold crossed at 14:05 sends at
 * 14:30 (D5-04 — instant math on `dueAt`, no shop-calendar/DST arithmetic).
 */
export const REMINDER_SWEEP_CRON = "30 * * * *";

/** Hours -> ms, for readable threshold arithmetic. */
const HOURS = 60 * 60 * 1000;

/**
 * The three moments a schedule can be chased at, relative to `dueAt` (D5-03,
 * D5-04).
 */
export const TOUCHPOINT = {
  /** `dueAt - 72h` — the pre-due nudge Shopify's native reminders cannot do. */
  DUE_SOON: "DUE_SOON",
  /** `dueAt` itself. */
  DUE: "DUE",
  /** `dueAt + 72h` (D5-03): the due-date mail gets room to work first. */
  OVERDUE: "OVERDUE",
} as const;

export type Touchpoint = (typeof TOUCHPOINT)[keyof typeof TOUCHPOINT];

/** Offset from `dueAt` at which the OVERDUE touchpoint becomes eligible (D5-03). */
export const OVERDUE_OFFSET_MS = 72 * HOURS;

/**
 * How far BEFORE `dueAt` the pre-due nudge fires (D5-04). Exactly 3x24h of
 * milliseconds — never "three calendar days". There is no shop timezone, no
 * DST correction and no calendar library anywhere in this module: a touchpoint
 * is a fixed distance in milliseconds from an instant Shopify gave us, so the
 * same schedule fires at the same absolute moment no matter where the merchant,
 * the buyer or the container happens to be. v1 buys that simplicity knowingly.
 */
export const DUE_SOON_LEAD_MS = 72 * HOURS;

/**
 * Severity, ascending. Position in this array IS the ranking used to pick the
 * single touchpoint that may send, so the array order is behaviour, not
 * presentation — reordering it changes which reminder a customer receives.
 */
export const TOUCHPOINT_SEVERITY: readonly Touchpoint[] = [
  TOUCHPOINT.DUE_SOON,
  TOUCHPOINT.DUE,
  TOUCHPOINT.OVERDUE,
] as const;

/** Signed offset from `dueAt` for each touchpoint (D5-03/D5-04). */
const TOUCHPOINT_OFFSET_MS: Record<Touchpoint, number> = {
  [TOUCHPOINT.DUE_SOON]: -DUE_SOON_LEAD_MS,
  [TOUCHPOINT.DUE]: 0,
  [TOUCHPOINT.OVERDUE]: OVERDUE_OFFSET_MS,
};

/**
 * `ReminderLog.status` values. Code-enforced rather than a database enum, the
 * same discipline as `LedgerOrder.attributionStatus` and `EnforcementEvent.kind`
 * — a new status must not need a migration.
 */
export const REMINDER_STATUS = {
  /** The claim. Written by the INSERT that wins the unique constraint. */
  SENDING: "SENDING",
  /** Shopify answered `success: true` with no userErrors. */
  SENT: "SENT",
  /**
   * The mutation was ISSUED and no parseable answer came back. Shopify may have
   * accepted and delivered it, so this row is TERMINAL: it is never re-claimed,
   * and the per-order guard treats it exactly like a SENT. Retrying it is the
   * double-dun that gets an app uninstalled (F-01).
   */
  SENT_UNCONFIRMED: "SENT_UNCONFIRMED",
  /** A PARSED refusal — nothing was sent, so retrying is safe and correct. */
  FAILED: "FAILED",
  /** Retries exhausted: three refusals against the same moment. */
  DEAD: "DEAD",
  /** The schedule was settled before the send could happen. */
  SUPPRESSED_PAID: "SUPPRESSED_PAID",
  /** A more severe touchpoint superseded this one while we were on duty. */
  SUPPRESSED_STALE: "SUPPRESSED_STALE",
  /**
   * The threshold was crossed BEFORE the merchant enabled reminders. Recorded,
   * never sent — this is the install-blast guard (research Pitfall 1).
   */
  SUPPRESSED_PREEXISTING: "SUPPRESSED_PREEXISTING",
  /**
   * Held back by the per-shop per-sweep send cap. NOT a decision — a "not this
   * sweep" marker. Each sweep DELETES the shop's DEFERRED rows before it does
   * anything else, so the touchpoint is re-derived from scratch. That is the
   * one mechanism (rather than re-claiming in place), because the unique
   * constraint would otherwise refuse the second claim and the moment would be
   * stranded forever.
   */
  DEFERRED: "DEFERRED",
} as const;

export type ReminderStatus =
  (typeof REMINDER_STATUS)[keyof typeof REMINDER_STATUS];

/**
 * WHY a send did not happen. A code-enforced token, never a raw Shopify
 * message: a message could carry order or buyer detail into a column this app
 * promises holds no customer personal data, and it would make the Phase-6
 * dashboard depend on Shopify's exact wording.
 */
export const FAILURE_REASON = {
  /** The platform's per-ORDER 24h limit (N1). Not our failure, not an attempt. */
  RATE_LIMITED: "RATE_LIMITED",
  /** A parsed refusal we do not otherwise recognise. Nothing was sent. */
  REFUSED: "REFUSED",
  /** No parseable answer to the send mutation — the ambiguous case. */
  TRANSPORT: "TRANSPORT",
  /** The pre-send re-read failed, so we never risked the send at all. */
  REFETCH: "REFETCH",
} as const;

export type FailureReason =
  (typeof FAILURE_REASON)[keyof typeof FAILURE_REASON];

/**
 * The two refusal messages 05-02 measured live, pinned to the SUBSTRING the
 * classifier keys on. They live next to the verbatim fixtures in
 * tests/reminders.test.ts, so if Shopify rewords either sentence exactly one
 * spec fails and names it — rather than a rate-limit refusal silently
 * reclassifying as a hard failure and burning a touchpoint's three attempts.
 *
 * Both arrive with `success: null` and code PAYMENT_REMINDER_SEND_UNSUCCESSFUL,
 * which is precisely why the message is the only thing worth reading.
 */
export const ALREADY_COMPLETED_MESSAGE = "already completed";
export const RATE_LIMIT_MESSAGE = "24hour period";

/**
 * Shopify allows ONE reminder per ORDER per 24 hours (05-02 N1, measured — and
 * per order, not per company). Everything that waits on that window waits 25h:
 * the 24h limit plus one hour of margin, because the sweep ticks hourly and a
 * retry that lands a minute early is refused with certainty.
 */
export const PER_ORDER_GUARD_MS = 25 * HOURS;

/** Three refusals against one moment and it is buried DEAD. */
export const MAX_SEND_ATTEMPTS = 3;

/**
 * The circuit breaker (Pitfall 1, T-05-01). Whatever bug, backfill or bad
 * migration ever makes a shop's whole order history look eligible at once, it
 * costs 50 messages and not 5,000. The remainder is DEFERRED and goes out on
 * later sweeps, oldest first.
 */
export const SEND_CAP_PER_SWEEP = 50;

/* ------------------------------------------------------------------ *
 * The pure core: what SHOULD happen to one schedule, decided without a
 * database, a clock, or a network. Everything below the I/O line composes
 * these two functions; nothing below them re-decides.
 * ------------------------------------------------------------------ */

/** One moment a schedule can be chased at, resolved to an absolute instant. */
export interface TouchpointInstant {
  touchpoint: Touchpoint;
  instant: Date;
}

/** A touchpoint that will be RECORDED and deliberately not sent. */
export interface SuppressedTouchpoint extends TouchpointInstant {
  status:
    | typeof REMINDER_STATUS.SUPPRESSED_PREEXISTING
    | typeof REMINDER_STATUS.SUPPRESSED_STALE;
}

/** The whole decision for one schedule: at most one send, plus the paper trail. */
export interface TouchpointSelection {
  /** The single touchpoint that may be sent, or null when none qualifies. */
  send: TouchpointInstant | null;
  /** Touchpoints to claim as suppressed so no later sweep reconsiders them. */
  suppress: SuppressedTouchpoint[];
}

const severityOf = (touchpoint: Touchpoint) =>
  TOUCHPOINT_SEVERITY.indexOf(touchpoint);

/**
 * The three instants for one schedule (D5-03, D5-04), in ascending severity.
 *
 * A schedule with no `dueAt` has no calendar to speak of, and a schedule that
 * is already settled has nothing left to chase — both derive NOTHING rather
 * than deriving instants a caller might later be tempted to act on.
 */
export function deriveTouchpoints(
  dueAt: Date | null | undefined,
  completedAt: Date | null | undefined = null,
): TouchpointInstant[] {
  if (!dueAt || completedAt) return [];

  return TOUCHPOINT_SEVERITY.map((touchpoint) => ({
    touchpoint,
    instant: new Date(dueAt.getTime() + TOUCHPOINT_OFFSET_MS[touchpoint]),
  }));
}

/**
 * Decide the single touchpoint that may send, and which crossed touchpoints get
 * recorded as suppressed instead (D5-02, research Pattern 1).
 *
 * Four rules, applied in this order — the order is the specification:
 *
 * 1. ALREADY LOGGED IS DONE. A touchpoint with a row is never revisited, in any
 *    state. That is what makes the sweep re-entrant: a row is a decision that
 *    has already been made, not a status to re-derive.
 * 2. STRICTLY CROSSED. `instant < now`. Equality is NOT past (D-04 discipline),
 *    so a threshold reached exactly at the sweep instant waits one tick.
 * 3. THE WATERMARK RUNS FIRST AND WINS (F-02). An instant older than
 *    `enabledAt` is SUPPRESSED_PREEXISTING even when a more severe touchpoint
 *    outranks it. PREEXISTING means "before the merchant asked us to act";
 *    STALE means "we were on duty and something more urgent overtook it". An
 *    instant that is both is the former, because the merchant's opt-in is the
 *    stronger statement — and because collapsing the two would make the
 *    Phase-6 feed unable to tell an install-blast guard from a catch-up.
 * 4. MOST SEVERE ONLY. Of what remains, the highest-severity touchpoint sends;
 *    every other one is SUPPRESSED_STALE. A five-day outage therefore owes the
 *    buyer ONE message — the current truth — not a three-message backlog.
 *
 * AT-MOST-ONCE IS THE CORRECT FAILURE DIRECTION HERE, and it is a product
 * decision rather than a limitation. REMD-01 asks for "exactly once per
 * moment"; under partition, a system must choose which way to be wrong. A
 * dropped reminder costs the merchant one nudge that the NEXT touchpoint (or
 * the next sweep) largely recovers. A duplicated one dunns a real buyer twice
 * for one invoice, which is the complaint that gets the app uninstalled and the
 * merchant embarrassed in front of their customer (research Pitfall 3). So
 * every ambiguity in this module resolves toward sending less.
 *
 * Suppression is classified AT ENCOUNTER TIME (D5-02): the sweep writes these
 * rows when it first sees them, so the decision is frozen in the log rather
 * than recomputed later against a watermark that may have moved.
 */
export function selectEligible(
  touchpoints: TouchpointInstant[],
  now: Date,
  enabledAt: Date | null,
  alreadyLogged: Iterable<Touchpoint> = [],
): TouchpointSelection {
  // Reminders off: no watermark, therefore no moment can qualify. The sweep
  // gates on this before it queries; this is defence in depth.
  if (enabledAt === null) return { send: null, suppress: [] };

  const logged = new Set(alreadyLogged);
  const suppress: SuppressedTouchpoint[] = [];
  const eligible: TouchpointInstant[] = [];

  for (const entry of touchpoints) {
    if (logged.has(entry.touchpoint)) continue;
    if (entry.instant.getTime() >= now.getTime()) continue;

    if (entry.instant.getTime() < enabledAt.getTime()) {
      suppress.push({
        ...entry,
        status: REMINDER_STATUS.SUPPRESSED_PREEXISTING,
      });
    } else {
      eligible.push(entry);
    }
  }

  const send = eligible.reduce<TouchpointInstant | null>(
    (most, entry) =>
      most === null || severityOf(entry.touchpoint) > severityOf(most.touchpoint)
        ? entry
        : most,
    null,
  );

  for (const entry of eligible) {
    if (entry !== send) {
      suppress.push({ ...entry, status: REMINDER_STATUS.SUPPRESSED_STALE });
    }
  }

  suppress.sort(
    (left, right) => severityOf(left.touchpoint) - severityOf(right.touchpoint),
  );

  return { send, suppress };
}

/* ------------------------------------------------------------------ *
 * The two Admin GraphQL documents this feature uses. Variables only.
 * ------------------------------------------------------------------ */

/**
 * THE send (D5-01). One GID in, `{ success, userErrors }` out; everything else
 * about the email — recipient, template, branding, pay-now link, deliverability
 * — is Shopify's.
 *
 * Requires the `write_orders` scope (live 2026-07 docs). `success` is nullable
 * in the schema and `userErrors` carries a single code,
 * PAYMENT_REMINDER_SEND_UNSUCCESSFUL; see `sendReminder` for why both halves
 * are checked.
 */
export const SEND_REMINDER_MUTATION = `#graphql
  mutation SendReminder($id: ID!) {
    paymentReminderSend(paymentScheduleId: $id) {
      success
      userErrors { field message }
    }
  }
`;

/**
 * Live pre-send state of a schedule — `PaymentSchedule` implements `Node`, and
 * `read_payment_terms` already covers the read. 05-03 calls this between the
 * claim and the send so a payment that landed after the sweep's DB query cannot
 * dun a customer who just paid; the constant lives here from day one so the
 * expansion adds a call site, not a contract.
 *
 * Deliberately three fields. Research called this document `ScheduleStillOpen`;
 * the operation name here matches the `ScheduleRefetch` transport label.
 */
export const SCHEDULE_REFETCH_QUERY = `#graphql
  query ScheduleRefetch($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on PaymentSchedule {
        id
        dueAt
        completedAt
      }
    }
  }
`;

interface PaymentReminderSendPayload {
  success?: boolean | null;
  userErrors?:
    | { code?: string | null; field?: string[] | null; message: string }[]
    | null;
}

interface PaymentReminderSendResponse {
  data?: { paymentReminderSend?: PaymentReminderSendPayload | null } | null;
}

interface ScheduleRefetchResponse {
  data?: {
    nodes?: ({ id?: string; completedAt?: string | null } | null)[] | null;
  } | null;
}

/**
 * What one send attempt earned. Deliberately not a boolean: the difference
 * between "Shopify refused" and "we never found out" is the difference between
 * retrying and never touching this moment again.
 */
export interface SendOutcome {
  /** The status the claim row is resolved to. */
  status: ReminderStatus;
  /** Token for the log; absent on success. */
  failureReason?: FailureReason;
  /** Whether this burns one of the three attempts. */
  consumesAttempt: boolean;
  /** Verbatim detail for the operator log. Never merchant- or buyer-facing. */
  reason?: string;
}

/**
 * Turn a parsed `paymentReminderSend` payload into an outcome.
 *
 * BRANCH ON userErrors CONTENT, NEVER ON `success` ALONE. 05-02 measured every
 * refusal this mutation makes and `success` came back **null** on all of them —
 * not `false`. A null is neither truthy nor a usable retry signal, so any
 * implementation that reads `success` first gets three different situations
 * wrong at once: it cannot tell a settled schedule from a rate limit, and it
 * cannot tell either of those from a genuine fault.
 *
 * So the order here is: errors first, classified by MESSAGE; only an EMPTY
 * `userErrors` earns a look at `success`, and only `success === true` is a send.
 *
 * THE EMPTY-userErrors TRAP. `success: false`/null with an empty `userErrors[]`
 * is a FAILURE, not a quiet pass — the same shape that burned the metafieldsSet
 * and validationUpdate call sites (03-01 / 04-05), where the failure lives
 * inside `data` and reading only the errors array reports a send that never
 * happened. A false SENT is worse than a failed one: it permanently consumes
 * the moment's claim, so the buyer is never chased at all.
 *
 * Unknown wording defaults to REFUSED rather than to anything clever. Guessing
 * that an unrecognised message is benign is how a real fault goes unnoticed.
 */
export function classifySendResponse(
  payload: PaymentReminderSendPayload | null | undefined,
): SendOutcome {
  if (!payload) {
    // Nothing parseable came back at all, so nothing can be ruled out —
    // including that Shopify accepted and delivered. Ambiguous, never retried.
    return {
      status: REMINDER_STATUS.SENT_UNCONFIRMED,
      failureReason: FAILURE_REASON.TRANSPORT,
      consumesAttempt: true,
      reason: "paymentReminderSend returned no payload",
    };
  }

  const userErrors = payload.userErrors ?? [];

  if (userErrors.length > 0) {
    const reason = userErrors.map((error) => error.message).join("; ");

    // E3: the just-paid race, lost to Shopify's own check. Benign and terminal
    // — the buyer paid, which is the outcome this whole feature wants.
    if (reason.includes(ALREADY_COMPLETED_MESSAGE)) {
      return {
        status: REMINDER_STATUS.SUPPRESSED_PAID,
        consumesAttempt: false,
        reason,
      };
    }

    // N1: something already wrote to this ORDER today — possibly a merchant's
    // own manual send, a Flow, or Shopify's native reminder, none of which this
    // log can see. Retriable once the window clears, and NOT a strike.
    if (reason.includes(RATE_LIMIT_MESSAGE)) {
      return {
        status: REMINDER_STATUS.FAILED,
        failureReason: FAILURE_REASON.RATE_LIMITED,
        consumesAttempt: false,
        reason,
      };
    }

    return {
      status: REMINDER_STATUS.FAILED,
      failureReason: FAILURE_REASON.REFUSED,
      consumesAttempt: true,
      reason,
    };
  }

  if (payload.success === true) return { status: REMINDER_STATUS.SENT, consumesAttempt: true };

  return {
    status: REMINDER_STATUS.FAILED,
    failureReason: FAILURE_REASON.REFUSED,
    consumesAttempt: true,
    reason: `paymentReminderSend returned success: ${String(
      payload.success ?? null,
    )} with no userErrors`,
  };
}

/**
 * The ONLY `extensions.code` values that PROVE `paymentReminderSend` never ran
 * (WINDOWS #21 / 05-VERIFICATION W2).
 *
 * Membership here is a factual claim — "Shopify did not mail the buyer" — and a
 * wrong claim is the double-dun this whole module exists to prevent. So the
 * list is closed, ordered, and pinned by a spec (T-06-07): widening it has to
 * be a deliberate, reviewed edit rather than a quiet append.
 *
 * GROUP A — execution gates. The Admin API rejects the request before the
 * mutation is reached:
 *  - `ACCESS_DENIED`   — the scope check. Measured live in 02-06 and again in
 *                        the post-release `write_orders` re-consent window;
 *                        this is the case that must stay retriable, or every
 *                        reminder for a shop is silently buried mid-re-consent.
 *  - `THROTTLED`       — the rate-limit refusal. The request is REJECTED, not
 *                        queued and not executed (shopify.dev, Admin API rate
 *                        limits).
 *  - `MAX_COST_EXCEEDED` — query-cost rejection, same doc, same stage: the cost
 *                        is computed and refused before any field resolves.
 *
 * GROUP B — static validation. Shopify's GraphQL layer is graphql-ruby, whose
 * StaticValidation pass runs over the DOCUMENT before execution begins and
 * reports `extensions.code` in lowerCamelCase (shopify.dev's GraphQL error
 * reference shows `"code": "undefinedField"`). A document that fails validation
 * is never executed, so nothing was sent. Each entry names the upstream rule
 * file under `lib/graphql/static_validation/rules/`:
 *  - `undefinedField`               — fields_are_defined_on_type.rb
 *  - `argumentNotAccepted`          — arguments_are_defined.rb
 *  - `missingRequiredArguments`     — required_arguments_are_present.rb
 *  - `argumentLiteralsIncompatible` — argument_literals_are_compatible.rb
 *  - `variableNotDefined`           — variables_are_used_and_defined.rb
 *  - `variableMismatch`             — variable_usages_are_allowed.rb
 *
 * TWO CANDIDATES WERE DROPPED rather than guessed, per the plan's instruction:
 * `variableUsagesAreAllowed` is the RULE name, not a code (its code is
 * `variableMismatch`, already listed); and `fieldConflict` / `selectionMismatch`
 * could not be checked against upstream from this environment — network egress
 * is blocked and graphql-ruby is a Ruby gem, absent from node_modules. Dropping
 * is the FAIL-SAFE direction: an omitted code costs at most one dropped
 * reminder, while a wrongly-included one mails a buyer twice.
 *
 * THE RULE: "not sent" is certain ONLY for codes in this list. Everything else
 * — `INTERNAL_SERVER_ERROR` above all, an absent code, an unknown string — is
 * AMBIGUOUS. Shopify answered HTTP 200 and may well have mailed the buyer
 * before whatever went wrong, so those take the SENT_UNCONFIRMED path: terminal,
 * never retried, bounded by the platform's per-order 24h limit, and captured to
 * Sentry by the existing ambiguous-branch capture in `resolveClaim` so a
 * systematic failure stays visible instead of turning into silence.
 */
export const RETRIABLE_GRAPHQL_CODES = [
  // Group A — execution gates.
  "ACCESS_DENIED",
  "THROTTLED",
  "MAX_COST_EXCEEDED",
  // Group B — graphql-ruby static validation.
  "undefinedField",
  "argumentNotAccepted",
  "missingRequiredArguments",
  "argumentLiteralsIncompatible",
  "variableNotDefined",
  "variableMismatch",
] as const;

const RETRIABLE_GRAPHQL_CODE_SET: ReadonlySet<string> = new Set(
  RETRIABLE_GRAPHQL_CODES,
);

/**
 * Does this GraphQL error prove nothing was sent?
 *
 * True only when the answer carries at least one error and EVERY one of them
 * names a code in the closed set. "Every", not "any": a batch that mixes a
 * known refusal with an unknown one is exactly as untrustworthy as the unknown
 * one alone, and reading it optimistically is how a buyer gets chased twice.
 *
 * Pure — it reads `error.errors` and nothing else — so the whole narrowing is
 * decided by data the transport already parsed.
 */
function isDefinitelyNotSent(error: LedgerGraphqlError): boolean {
  const errors = error.errors;
  if (!Array.isArray(errors) || errors.length === 0) return false;

  return errors.every((entry) => {
    const code = (entry as { extensions?: { code?: unknown } })?.extensions
      ?.code;
    return typeof code === "string" && RETRIABLE_GRAPHQL_CODE_SET.has(code);
  });
}

/**
 * Ask Shopify to send the reminder for one schedule. THE transport seam — the
 * whole engine above it is expressed in `SendOutcome`, so swapping how a
 * reminder is delivered (Pitfall 4's plan-gating escape hatch) changes this
 * function and nothing else.
 *
 * The two failure directions are NOT symmetric, and that asymmetry is the
 * point (F-01):
 *
 *  - A `LedgerGraphqlError` WHOSE EVERY CODE IS IN `RETRIABLE_GRAPHQL_CODES` is
 *    a complete, parsed answer that happens to be an error — the ACCESS_DENIED
 *    shape an unconsented `write_orders` produces, for instance. Shopify
 *    definitively did not send. Retriable, and it must be: burying these would
 *    silently drop every reminder for a shop during a re-consent window.
 *  - Any other throw is a timeout, a socket death, a 5xx — the mutation was
 *    issued and the answer was lost. Shopify may have accepted it and mailed a
 *    real buyer. That row is terminal.
 *
 * THE CLASS IS NOT THE SIGNAL, THE CODE IS (WINDOWS #21 / 05-VERIFICATION W2).
 * `graphqlJson` throws `LedgerGraphqlError` on ANY non-empty top-level
 * `errors[]`, before it ever looks at `data` — so the class covers both a
 * pre-execution refusal and an HTTP 200 that failed halfway through a mutation
 * that had already queued the email. Treating the whole class as retriable
 * (which this function did until 06-02) meant an `INTERNAL_SERVER_ERROR` was
 * re-sent 25h later on the chance it had not landed. `isDefinitelyNotSent`
 * splits the class along the only line that carries the fact.
 */
export async function sendReminder(
  shop: string,
  scheduleGid: string,
): Promise<SendOutcome> {
  let body: PaymentReminderSendResponse;

  try {
    body = await graphqlJson<PaymentReminderSendResponse>(
      shop,
      SEND_REMINDER_MUTATION,
      { variables: { id: scheduleGid }, label: "SendReminder" },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    if (error instanceof LedgerGraphqlError && isDefinitelyNotSent(error)) {
      return {
        status: REMINDER_STATUS.FAILED,
        failureReason: FAILURE_REASON.REFUSED,
        consumesAttempt: true,
        reason,
      };
    }

    return {
      status: REMINDER_STATUS.SENT_UNCONFIRMED,
      failureReason: FAILURE_REASON.TRANSPORT,
      consumesAttempt: true,
      reason,
    };
  }

  return classifySendResponse(body?.data?.paymentReminderSend);
}

/**
 * Re-read one schedule's live state immediately before the send.
 *
 * This is the last thing standing between a buyer who has just paid and a
 * dunning message (research Pattern 3). The sweep's own query may be seconds or
 * minutes old; this is not. A missing node is NOT read as payment — absence of
 * data is not evidence of settlement, and Shopify's own E3 check backstops the
 * remaining window anyway.
 */
async function refetchSchedule(
  shop: string,
  scheduleGid: string,
): Promise<{ completedAt?: string | null } | null> {
  const body = await graphqlJson<ScheduleRefetchResponse>(
    shop,
    SCHEDULE_REFETCH_QUERY,
    { variables: { ids: [scheduleGid] }, label: "ScheduleRefetch" },
  );

  return body?.data?.nodes?.[0] ?? null;
}

/* ------------------------------------------------------------------ *
 * The claim (rule 1) and its terminal marks.
 * ------------------------------------------------------------------ */

/** What the sweep knows about a schedule it may chase. Snapshots only. */
export interface ReminderCandidate {
  scheduleGid: string;
  dueAt: Date;
  orderGid: string;
  companyGid: string | null;
  companyName: string | null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Take the (shop, schedule, touchpoint) claim, or discover somebody already has
 * it. Returns the claimed row's id, or null when the unique constraint refused
 * the insert — which is not an error condition: it is the second container, or
 * the previous tick, correctly being told this moment is already accounted for.
 *
 * `status` is a parameter because a suppression is also a claim: writing
 * SUPPRESSED_PREEXISTING through this same path is what stops a later sweep
 * from re-evaluating and sending it (research Pitfall 1).
 */
export async function claimTouchpoint(
  shop: string,
  candidate: ReminderCandidate,
  touchpoint: Touchpoint,
  status: ReminderStatus = REMINDER_STATUS.SENDING,
  now: Date = new Date(),
): Promise<string | null> {
  try {
    const row = await db.reminderLog.create({
      data: {
        shop,
        scheduleGid: candidate.scheduleGid,
        orderGid: candidate.orderGid,
        companyGid: candidate.companyGid,
        companyName: candidate.companyName,
        touchpoint,
        status,
        // Stamped from the sweep's own clock, never the wall clock: the retry
        // backoff below compares against it, and an injected-`now` drive has to
        // behave exactly like a cron tick.
        updatedAt: now,
      },
      select: { id: true },
    });
    return row.id;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/**
 * Re-take a FAILED row atomically (F-03).
 *
 * A conditional `updateMany` rather than read-then-write, because 05-05 runs an
 * on-demand sweep alongside the cron tick BY DESIGN: two passes can both see
 * the same retriable row. Postgres re-evaluates the WHERE under READ COMMITTED
 * after the row lock is released, so the loser matches zero rows and backs off
 * silently. Exactly one pass proceeds to the mutation — the same guarantee the
 * unique constraint gives a fresh claim, expressed for a row that already
 * exists.
 *
 * The `updatedAt` clause is not decoration. It is what stops a minutes-scale
 * retry from walking straight into Shopify's per-order 24h refusal and burning
 * an attempt on a certainty.
 */
async function reclaimFailed(id: string, now: Date): Promise<boolean> {
  const result = await db.reminderLog.updateMany({
    where: {
      id,
      status: REMINDER_STATUS.FAILED,
      attempts: { lt: MAX_SEND_ATTEMPTS },
      updatedAt: { lt: new Date(now.getTime() - PER_ORDER_GUARD_MS) },
    },
    data: { status: REMINDER_STATUS.SENDING, updatedAt: now },
  });

  return result.count === 1;
}

/**
 * Retire a FAILED row that a more severe sibling has overtaken (WINDOWS #20).
 *
 * Conditional on the row still being FAILED, for the same reason
 * `reclaimFailed` is conditional: an on-demand sweep can run alongside the cron
 * tick, and an unconditional write could stomp a SENT that a concurrent pass
 * had just recorded — erasing the very evidence the per-order guard reads.
 * `attempts` is untouched: a suppression is a decision, not an attempt.
 */
async function markSuppressedStale(id: string, now: Date): Promise<void> {
  await db.reminderLog.updateMany({
    where: { id, status: REMINDER_STATUS.FAILED },
    data: { status: REMINDER_STATUS.SUPPRESSED_STALE, updatedAt: now },
  });
}

/** Shopify accepted the send. */
export async function markSent(id: string, now: Date = new Date()): Promise<void> {
  await db.reminderLog.update({
    where: { id },
    data: {
      status: REMINDER_STATUS.SENT,
      sentAt: now,
      attempts: { increment: 1 },
      updatedAt: now,
    },
  });
}

/**
 * Resolve a claim that did not become a send.
 *
 * ATTEMPTS ARE SPENT HERE AND NOWHERE ELSE — not on the claim, not on the
 * re-claim. One attempt means one answer from Shopify, so "three strikes" is
 * three refusals rather than three trips through the loop.
 *
 * A RATE_LIMITED refusal spends nothing (N1): the platform's own window is not
 * this app's failure, and counting it would bury a perfectly good touchpoint as
 * DEAD after three days of a merchant sending their own reminders.
 *
 * Reported at warning level while retries remain — the pre-consent
 * ACCESS_DENIED window after a scope release produces exactly this and is
 * expected operational noise (04-03 precedent) — and at error level when the
 * moment is buried, because a DEAD row is a buyer who will never be chased.
 */
export async function markFailed(
  id: string,
  shop: string,
  outcome: SendOutcome,
  now: Date = new Date(),
): Promise<void> {
  const current = await db.reminderLog.findUnique({
    where: { id },
    select: { attempts: true },
  });

  const attempts = (current?.attempts ?? 0) + (outcome.consumesAttempt ? 1 : 0);
  const exhausted = outcome.consumesAttempt && attempts >= MAX_SEND_ATTEMPTS;

  await db.reminderLog.update({
    where: { id },
    data: {
      status: exhausted ? REMINDER_STATUS.DEAD : REMINDER_STATUS.FAILED,
      attempts,
      failureReason: outcome.failureReason ?? FAILURE_REASON.REFUSED,
      updatedAt: now,
    },
  });

  Sentry.captureMessage(
    `Payment reminder send failed: ${outcome.reason ?? "unknown"}`,
    {
      level: exhausted ? "error" : "warning",
      tags: { sweep: REMINDER_SWEEP_LEASE, shop },
      extra: {
        reminderLogId: id,
        attempts,
        failureReason: outcome.failureReason,
        buried: exhausted,
      },
    },
  );
}

/**
 * Write the outcome of one attempt onto its claim row.
 *
 * The SENT_UNCONFIRMED branch stamps `sentAt` even though delivery is unknown,
 * and that is deliberate: the per-order 24h guard reads `sentAt`, and an
 * ambiguous send has to hold that order's slot exactly as firmly as a confirmed
 * one. Assuming it did NOT arrive is how a buyer gets chased twice in a day.
 */
async function resolveClaim(
  id: string,
  shop: string,
  outcome: SendOutcome,
  now: Date,
): Promise<void> {
  if (outcome.status === REMINDER_STATUS.SENT) {
    await markSent(id, now);
    return;
  }

  if (outcome.status === REMINDER_STATUS.SUPPRESSED_PAID) {
    await db.reminderLog.update({
      where: { id },
      data: { status: REMINDER_STATUS.SUPPRESSED_PAID, updatedAt: now },
    });
    return;
  }

  if (outcome.status === REMINDER_STATUS.SENT_UNCONFIRMED) {
    await db.reminderLog.update({
      where: { id },
      data: {
        status: REMINDER_STATUS.SENT_UNCONFIRMED,
        failureReason: outcome.failureReason ?? FAILURE_REASON.TRANSPORT,
        sentAt: now,
        attempts: { increment: 1 },
        updatedAt: now,
      },
    });

    Sentry.captureMessage(
      `Payment reminder outcome unknown, not retried: ${outcome.reason ?? "unknown"}`,
      {
        level: "error",
        tags: { sweep: REMINDER_SWEEP_LEASE, shop },
        extra: { reminderLogId: id },
      },
    );
    return;
  }

  await markFailed(id, shop, outcome, now);
}

/**
 * Which moments of these schedules already have a row, in ONE query.
 *
 * The pure core treats "already logged" as done in any state, so this
 * deliberately does not care what the status is — only that a decision exists.
 * One query per sweep rather than one per schedule: a shop with a thousand open
 * schedules is a good outcome, not a reason to make a thousand round trips.
 */
interface LoggedRow {
  id: string;
  touchpoint: Touchpoint;
  status: string;
  attempts: number;
  updatedAt: Date;
}

async function loggedRowsFor(
  shop: string,
  candidates: ReminderCandidate[],
): Promise<Map<string, LoggedRow[]>> {
  const rows = await db.reminderLog.findMany({
    where: {
      shop,
      scheduleGid: { in: candidates.map((candidate) => candidate.scheduleGid) },
    },
    select: {
      id: true,
      scheduleGid: true,
      touchpoint: true,
      status: true,
      attempts: true,
      updatedAt: true,
    },
  });

  const byScheduleGid = new Map<string, LoggedRow[]>();
  for (const row of rows) {
    const logged: LoggedRow = {
      id: row.id,
      touchpoint: row.touchpoint as Touchpoint,
      status: row.status,
      attempts: row.attempts,
      updatedAt: row.updatedAt,
    };

    const existing = byScheduleGid.get(row.scheduleGid);
    if (existing) existing.push(logged);
    else byScheduleGid.set(row.scheduleGid, [logged]);
  }

  return byScheduleGid;
}

/**
 * Orders this shop has already chased inside the platform's window (N1).
 *
 * One query for the whole sweep. SENT_UNCONFIRMED counts exactly as SENT does,
 * because an ambiguous send may well have arrived and a second one the same day
 * would be both refused by Shopify and — if it were not — a buyer chased twice.
 *
 * Compared against the sweep's injected `now` via `sentAt`, which this module
 * stamps from that same clock. Using the wall-clock `updatedAt` here would make
 * the guard behave differently under an injected-time drive than under cron,
 * which is precisely the class of bug this whole file injects `now` to avoid.
 */
async function ordersChasedRecently(
  shop: string,
  now: Date,
): Promise<Set<string>> {
  const rows = await db.reminderLog.findMany({
    where: {
      shop,
      status: {
        in: [REMINDER_STATUS.SENT, REMINDER_STATUS.SENT_UNCONFIRMED],
      },
      sentAt: { gte: new Date(now.getTime() - PER_ORDER_GUARD_MS) },
    },
    select: { orderGid: true },
  });

  return new Set(rows.map((row) => row.orderGid));
}

/**
 * Whether a schedule has a moment worth re-taking, and if so what to do with
 * it. Two outcomes rather than one row, because "outranked" is a DECISION the
 * sweep has to write down — returning `null` for it would leave the row FAILED
 * and let the next tick reach the same fork forever.
 */
type RetryDecision =
  | { kind: "retry"; row: LoggedRow }
  | { kind: "outranked"; row: LoggedRow };

/**
 * Is this FAILED row outranked by a moment that has already gone out?
 *
 * A sibling counts as "gone out" when it is SENT or SENT_UNCONFIRMED — the same
 * pairing `ordersChasedRecently` uses, and for the same reason: an ambiguous
 * send may well be sitting in the buyer's inbox, and this module always resolves
 * ambiguity toward sending less.
 *
 * STRICTLY higher severity only. The fence is one-directional by design: a DUE
 * that already went out must never stop the OVERDUE escalation, which is the
 * message the merchant is actually paying for.
 */
function outrankedBySentSibling(row: LoggedRow, rows: LoggedRow[]): boolean {
  const rank = severityOf(row.touchpoint);

  return rows.some(
    (sibling) =>
      severityOf(sibling.touchpoint) > rank &&
      (sibling.status === REMINDER_STATUS.SENT ||
        sibling.status === REMINDER_STATUS.SENT_UNCONFIRMED),
  );
}

/**
 * The most severe touchpoint on this schedule whose row is a retriable FAILED,
 * classified as either genuinely retriable or outranked.
 *
 * Only FAILED is retriable, and only after the per-order window has cleared.
 * Every other status is terminal on purpose: SENT and SUPPRESSED_* are done,
 * DEAD is buried, SENT_UNCONFIRMED is the ambiguous case that must never be
 * repeated, and an orphaned SENDING is a crash between claim and mark whose
 * outcome nobody can know — so it is left exactly where it is, costing at most
 * one dropped reminder.
 *
 * THE SEVERITY FENCE (WINDOWS #20 / 05-VERIFICATION W1). Waiting out the 25h
 * window is necessary but not sufficient: the schedule may have MOVED ON while
 * the row sat failed. If a strictly more severe moment was sent in the
 * meantime, re-claiming the lower one mails the buyer "your payment is due in
 * 3 days" AFTER they were already told it is due today. The unique constraint
 * never sees that — it is not a duplicate of any single moment — but it is a
 * message that CONTRADICTS one the buyer already holds, which is worse than
 * saying nothing. Such a row is reported as `outranked`, and the sweep marks it
 * SUPPRESSED_STALE rather than sending it.
 *
 * Rule 4 of `selectEligible` ("most severe only") already governs fresh
 * moments; this is that same rule applied across sweeps, where the comparison
 * is against rows an EARLIER pass wrote. Checking only the first (most severe)
 * retriable candidate is sufficient: anything below it is outranked by the very
 * same sibling, so successive sweeps retire the ladder from the top down.
 */
function retriableRow(
  touchpoints: TouchpointInstant[],
  rows: LoggedRow[],
  now: Date,
): RetryDecision | null {
  const byTouchpoint = new Map(rows.map((row) => [row.touchpoint, row]));
  const cutoff = now.getTime() - PER_ORDER_GUARD_MS;

  for (const entry of [...touchpoints].reverse()) {
    const row = byTouchpoint.get(entry.touchpoint);
    if (
      row &&
      row.status === REMINDER_STATUS.FAILED &&
      row.attempts < MAX_SEND_ATTEMPTS &&
      row.updatedAt.getTime() < cutoff
    ) {
      return outrankedBySentSibling(row, rows)
        ? { kind: "outranked", row }
        : { kind: "retry", row };
    }
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Eligibility — which schedules the calendar could speak about at all.
 * ------------------------------------------------------------------ */

/**
 * Open schedules on one shop with at least one touchpoint instant STRICTLY past
 * `now` — i.e. every schedule the dunning calendar could have anything to say
 * about at this instant.
 *
 * The bound is the EARLIEST touchpoint: DUE_SOON fires at `dueAt - 72h`, and
 * that instant is strictly past exactly when `dueAt < now + 72h`. Anything due
 * further out than that has not reached even its first moment, so the predicate
 * is pushed into SQL against the existing `LedgerSchedule @@index([shop, dueAt])`
 * — the same index that makes the hourly overdue sweep cheap — rather than
 * loading the shop's whole schedule book to discard most of it in JavaScript.
 * Which of the three moments actually applies is then decided purely, per
 * schedule, by `deriveTouchpoints`/`selectEligible`.
 *
 * Every filter is a "we would be embarrassed to write to this buyer" condition:
 * paid (`completedAt`), cancelled orders, orders with no payment terms, and
 * orders whose company attribution is not yet settled (UNRESOLVED could still
 * turn out to be a D2C order).
 *
 * COMPANY-ONLY IS A PRODUCT CHOICE, NOT A PLATFORM LIMIT. 05-02's E4 experiment
 * proved Shopify happily accepts a send for a net-terms schedule with no
 * purchasing company (it resolves the recipient from the order itself). We
 * still require `attributionStatus ATTRIBUTED` and a company, because v1 dunns
 * exactly the accounts whose credit this app manages: the ledger, the D5-02
 * watermark story, the Phase-6 dashboard and LNCH-02 are all company-framed,
 * and a reminder for an account the merchant cannot see in this app would have
 * no home in the UI. Extending to company-less net terms is REMD-04-adjacent
 * v2 work, and it is a filter change here — not an architecture change.
 *
 * NO PII is selected — order/company identifiers and the company NAME snapshot
 * only.
 */
export async function eligibleSchedules(
  shop: string,
  now: Date,
): Promise<ReminderCandidate[]> {
  const rows = await db.ledgerSchedule.findMany({
    where: {
      shop,
      completedAt: null,
      dueAt: { lt: new Date(now.getTime() + DUE_SOON_LEAD_MS) },
      order: {
        cancelledAt: null,
        hasPaymentTerms: true,
        attributionStatus: "ATTRIBUTED",
        companyId: { not: null },
      },
    },
    select: {
      scheduleGid: true,
      dueAt: true,
      order: {
        select: {
          orderGid: true,
          company: { select: { companyGid: true, name: true } },
        },
      },
    },
    // Oldest debt first, and deterministic: a container killed mid-sweep
    // resumes over the same sequence rather than a random one.
    orderBy: { dueAt: "asc" },
  });

  return rows.flatMap((row) =>
    row.dueAt === null
      ? []
      : [
          {
            scheduleGid: row.scheduleGid,
            dueAt: row.dueAt,
            orderGid: row.order.orderGid,
            companyGid: row.order.company?.companyGid ?? null,
            companyName: row.order.company?.name ?? null,
          },
        ],
  );
}

/* ------------------------------------------------------------------ *
 * The sweep.
 * ------------------------------------------------------------------ */

/**
 * One shop's dunning pass.
 *
 * The `Shop` read here is NOT a second shop enumerator and does not weaken CF-3:
 * `forEachActiveShop` above still decides WHICH shops exist for background work
 * (and therefore that this one is installed), while this single-row lookup by
 * the domain that enumerator handed us reads one merchant SETTING. There is no
 * `findMany` in this module and a source guard in tests/reminders.test.ts keeps
 * it that way.
 *
 * Returning on a null `remindersEnabledAt` BEFORE any schedule query is rule 3
 * and the whole safety story of the Wave-1 deploy: no enable path exists yet,
 * every row is null, so the production sweep does one indexed read per shop and
 * stops.
 */
async function sweepShop(shop: string, now: Date): Promise<void> {
  const settings = await db.shop.findUnique({
    where: { domain: shop },
    select: { remindersEnabledAt: true },
  });

  const enabledAt = settings?.remindersEnabledAt ?? null;
  if (enabledAt === null) return;

  // DEFERRED is a "not this sweep" marker, not a decision. Clearing it here is
  // the ONE mechanism (see REMINDER_STATUS.DEFERRED): the moment is re-derived
  // from scratch below, which the unique constraint would otherwise forbid.
  await db.reminderLog.deleteMany({
    where: { shop, status: REMINDER_STATUS.DEFERRED },
  });

  const candidates = await eligibleSchedules(shop, now);
  if (candidates.length === 0) return;

  const rowsByScheduleGid = await loggedRowsFor(shop, candidates);
  const chasedOrderGids = await ordersChasedRecently(shop, now);

  let sends = 0;

  for (const candidate of candidates) {
    const touchpoints = deriveTouchpoints(candidate.dueAt);
    const rows = rowsByScheduleGid.get(candidate.scheduleGid) ?? [];

    const selection = selectEligible(
      touchpoints,
      now,
      enabledAt,
      rows.map((row) => row.touchpoint),
    );

    // Record the suppressions FIRST. Each one is a claim on a moment this sweep
    // has decided not to act on, and writing it is what stops a later tick from
    // re-deriving that moment and reaching a different conclusion.
    for (const suppressed of selection.suppress) {
      await claimTouchpoint(
        shop,
        candidate,
        suppressed.touchpoint,
        suppressed.status,
        now,
      );
    }

    // Either a fresh moment has come due, or an earlier refusal has waited out
    // the window. Never both — a moment with a row is not selectable.
    const retry =
      selection.send === null ? retriableRow(touchpoints, rows, now) : null;

    // The severity fence (WINDOWS #20). Retiring the outranked row happens
    // BEFORE the per-order guard below: being overtaken is a permanent fact
    // about this schedule, not a "not right now" like the 24h window, so it
    // must not be re-decided on a later tick. No send is consumed and
    // `chasedOrderGids` is untouched — nothing was mailed.
    if (retry?.kind === "outranked") {
      await markSuppressedStale(retry.row.id, now);
      continue;
    }

    if (selection.send === null && retry === null) continue;

    // N1, BEFORE any claim (05-02, measured). Shopify allows one reminder per
    // ORDER per 24h, so a second schedule on an already-chased order would earn
    // a guaranteed refusal. Skipping it WITHOUT writing a row leaves the moment
    // clean to be re-derived once the window clears.
    if (chasedOrderGids.has(candidate.orderGid)) continue;

    if (sends >= SEND_CAP_PER_SWEEP) {
      // The breaker. Only a fresh moment is parked as DEFERRED; a retry simply
      // stays FAILED and comes back on its own next sweep.
      if (selection.send !== null) {
        await claimTouchpoint(
          shop,
          candidate,
          selection.send.touchpoint,
          REMINDER_STATUS.DEFERRED,
          now,
        );
      }
      continue;
    }

    const claimId =
      selection.send !== null
        ? await claimTouchpoint(
            shop,
            candidate,
            selection.send.touchpoint,
            REMINDER_STATUS.SENDING,
            now,
          )
        : (await reclaimFailed(retry!.row.id, now))
          ? retry!.row.id
          : null;

    // Lost the race — another pass owns this moment. Skip silently (rule 1).
    if (claimId === null) continue;

    if (await attemptSend(shop, candidate, claimId, now)) {
      sends += 1;
      // This order has now spent its slot in the platform's 24h window.
      chasedOrderGids.add(candidate.orderGid);
    }
  }
}

/**
 * Refetch, then send, then resolve the claim. Returns whether the mutation was
 * actually ISSUED — which is what the cap counts and what the per-order guard
 * keys on. A schedule suppressed at the refetch never reached Shopify, so it
 * consumes neither.
 */
async function attemptSend(
  shop: string,
  candidate: ReminderCandidate,
  claimId: string,
  now: Date,
): Promise<boolean> {
  let live: { completedAt?: string | null } | null;

  try {
    live = await refetchSchedule(shop, candidate.scheduleGid);
  } catch (error) {
    // Nothing was sent, so this is safely retriable — unlike a failure of the
    // send itself, which can never be repeated.
    await resolveClaim(
      claimId,
      shop,
      {
        status: REMINDER_STATUS.FAILED,
        failureReason: FAILURE_REASON.REFETCH,
        consumesAttempt: true,
        reason: error instanceof Error ? error.message : String(error),
      },
      now,
    );
    return false;
  }

  if (live?.completedAt) {
    // Paid between the sweep's query and this instant. The race is closed.
    await resolveClaim(
      claimId,
      shop,
      {
        status: REMINDER_STATUS.SUPPRESSED_PAID,
        consumesAttempt: false,
        reason: "settled before the send",
      },
      now,
    );
    return false;
  }

  await resolveClaim(
    claimId,
    shop,
    await sendReminder(shop, candidate.scheduleGid),
    now,
  );
  return true;
}

/**
 * The hourly reminder sweep (REMD-01). Registered in `SWEEP_SCHEDULE` on its
 * own lease; `now` is injected so threshold boundaries are testable to the
 * millisecond.
 */
export async function reminderSweep(now: Date = new Date()): Promise<void> {
  await forEachActiveShop(async (shop) => {
    await sweepShop(shop, now);
  });
}
