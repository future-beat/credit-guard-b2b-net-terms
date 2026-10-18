import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  data,
  useFetcher,
  useLoaderData,
  useRevalidator,
  useSearchParams,
} from "react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { createMoneyFormatter } from "../lib/money";
import { resolveShopCurrency } from "../services/shop-currency.server";
import {
  EVENT_KIND,
  recordEnforcementEvent,
} from "../services/enforcement.server";
import { recomputeCompany } from "../services/ledger.server";
import { shopDataComplete } from "../services/metafields.server";
import { readBackfillState } from "../services/backfill.server";

/**
 * The Companies settings page — the merchant's entire control plane over
 * enforcement (CRED-01, CRED-02, CRED-04, D-01/D-02/D-03).
 *
 * FOUR RULES, all of them load-bearing:
 *
 * 1. SHOP COMES FROM THE SESSION, NEVER FROM THE REQUEST BODY. `session.shop`
 *    is the tenant boundary; every Prisma WHERE on this page carries it, so a
 *    companyId forged from another merchant's store matches zero rows instead
 *    of granting a stranger write access to someone else's credit ceiling
 *    (T-03-01).
 *
 * 2. INTENTS ARE WHITELISTED. The action dispatches over a closed set and the
 *    default answers 400 having changed nothing — a typo'd or invented intent
 *    must never fall through to a silent success (T-03-02). Same discipline as
 *    the webhook routes' topic switch.
 *
 * 3. MONEY IS VALIDATED BY GRAMMAR, THEN CONSTRUCTED AS A DECIMAL — never
 *    parsed as a float, never coerced, never rounded (T-03-03). "1e9", "-0",
 *    "1,000" and "5.999" are rejected outright rather than silently becoming
 *    something the merchant did not type. The client's `min="0"` is advisory
 *    decoration; this is the real gate.
 *
 * 4. LIMIT WRITES USE VALUE-ECHO CAS, NOT LAST-WRITE-WINS. The form echoes the
 *    limit the row was RENDERED with, and that value is part of the update's
 *    WHERE clause. Zero rows matched means the stored limit moved under the
 *    merchant since the page painted, so the write is refused (409) rather than
 *    quietly overwriting a colleague's decision. An `updatedAt` token would be
 *    wrong here: `recomputeCompany` touches that column on every webhook and
 *    every hourly sweep, so routine ledger churn would produce false staleness
 *    on a field nobody edited (Pitfall 2).
 *
 * The loader reads the LOCAL ledger only — never the Admin API. The table is a
 * projection of rows Phase 2's ingest already owns, so painting this page costs
 * one database round trip and cannot be broken by a Shopify outage.
 */

/* ------------------------------------------------------------------ *
 * Copy — 03-UI-SPEC.md Copywriting Contract, rows 1-17.
 *
 * Byte-exact. Do not reword any string below without updating the spec: the
 * status vocabulary is a locked decision (D-03), and the honesty rule forbids
 * "protected"/"enforcing" language anywhere on this page — nothing is enforced
 * until the Phase 4 Function ships.
 * ------------------------------------------------------------------ */

/** Row 2. */
export const PAGE_INTRO =
  "Credit Guard tracks each company's outstanding net-terms balance. A company is observe-only until you set its credit limit.";

/** Row 3 — column headers, in D-01's locked order. */
export const COLUMN_HEADERS = [
  "Company",
  "Exposure",
  "Credit limit",
  "Utilization",
  "Status",
  "Bypass enforcement",
] as const;

/** Rows 4-5 — the edit affordance and the three edit-mode buttons. */
export const SET_LIMIT_LABEL = "Set limit";
export const SAVE_LIMIT_LABEL = "Save limit";
export const DISCARD_LABEL = "Discard";
export const REMOVE_LIMIT_LABEL = "Remove limit";

/** Row 6 — status vocabulary and the incomplete-data marker. */
export const STATUS_OVERDUE = "Overdue";
export const STATUS_OVER_LIMIT = "Over limit";
export const STATUS_WITHIN_LIMIT = "Within limit";
export const STATUS_OBSERVE_ONLY = "Observe only";
export const STATUS_BYPASSED = "Enforcement bypassed";
export const NO_LIMIT_LABEL = "No limit";
export const INCOMPLETE_MARKER = "· incomplete";
export const INCOMPLETE_TOOLTIP =
  "Some orders for this company couldn't be fully matched yet. This balance may be incomplete.";

/** Rows 7-9 — empty state and the backfill banner. */
export const EMPTY_STATE_HEADING = "No companies yet";
export const EMPTY_STATE_BODY =
  "Companies from your store's B2B orders will appear here automatically. Once they do, set a credit limit to control how much net-terms credit each company can use.";
export const BACKFILL_BANNER =
  "Credit Guard is still importing your order history. Company balances may be incomplete for a few minutes.";

/** Rows 10-17 — field errors and toasts. */
export const LIMIT_INVALID_ERROR = "Enter an amount of $0.00 or more.";
export const LIMIT_SAVE_FAILED_ERROR =
  "Couldn't save this limit. Check your connection and try again.";
export const LIMIT_STALE_TOAST =
  "This company was updated by someone else. The table has been refreshed — check the current value and try again.";
export const LIMIT_UPDATED_TOAST = "Credit limit updated";
export const LIMIT_REMOVED_TOAST = "Credit limit removed";
export const BYPASS_ON_TOAST = "Enforcement bypassed";
export const BYPASS_OFF_TOAST = "Bypass removed";
export const BYPASS_FAILED_TOAST = "Couldn't update bypass. Try again.";

/* ------------------------------------------------------------------ *
 * Loader
 * ------------------------------------------------------------------ */

/** UI-SPEC Layout contract: 50 rows a page; the whole ICP fits on page one. */
export const PAGE_SIZE = 50;

/**
 * One company as the table renders it. Decimals cross the wire as fixed-2
 * strings: `creditLimit: null` and `creditLimit: "0.00"` are different merchant
 * decisions (D-02) and JSON must not blur them.
 */
export interface CompanyRow {
  id: string;
  companyGid: string;
  name: string;
  exposure: string;
  overdue: boolean;
  creditLimit: string | null;
  bypassEnforcement: boolean;
}

export interface CompaniesPageData {
  companies: CompanyRow[];
  dataComplete: boolean;
  backfillRunning: boolean;
  currencyCode: string | null;
  page: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<CompaniesPageData> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const requestedPage = Number(new URL(request.url).searchParams.get("page"));
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const [rows, dataComplete, backfill, currencyCode] = await Promise.all([
    db.company.findMany({
      where: { shop },
      // Name is the merchant's sort; id is the tie-break that keeps equal names
      // in a stable order across revalidations instead of shuffling the table.
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      // One extra row is the cheapest possible "is there a next page".
      take: PAGE_SIZE + 1,
    }),
    shopDataComplete(shop),
    readBackfillState(shop),
    resolveShopCurrency(shop),
  ]);

  const hasNextPage = rows.length > PAGE_SIZE;

  return {
    companies: rows.slice(0, PAGE_SIZE).map((row) => ({
      id: row.id,
      companyGid: row.companyGid,
      name: row.name,
      exposure: row.exposure.toFixed(2),
      overdue: row.overdue,
      creditLimit: row.creditLimit === null ? null : row.creditLimit.toFixed(2),
      bypassEnforcement: row.bypassEnforcement,
    })),
    dataComplete,
    backfillRunning: backfill?.status === "running",
    currencyCode,
    page,
    hasNextPage,
    hasPreviousPage: page > 1,
  };
};

/* ------------------------------------------------------------------ *
 * Action
 * ------------------------------------------------------------------ */

/**
 * L-03 money grammar. Non-negative by construction (no sign is accepted at
 * all), at most two decimal places, at most 13 integer digits — comfortably
 * inside the column's `Decimal(19, 4)`. Everything a merchant might paste that
 * ISN'T this ("1e9", "-0", "1,000", " 100 ", "5.999") fails here and is
 * reported back, never rounded into something they didn't type.
 */
const MONEY_GRAMMAR = /^\d{1,13}(\.\d{1,2})?$/;

/** The empty string is the null sentinel — distinct from "0", which is a limit. */
function parseLimitInput(raw: string): Prisma.Decimal | null | "invalid" {
  if (raw === "") return null;
  if (!MONEY_GRAMMAR.test(raw)) return "invalid";
  return new Prisma.Decimal(raw);
}

export type ActionResult =
  | { ok: true; intent: "set-limit"; limitRemoved: boolean }
  | { ok: true; intent: "set-bypass"; bypass: boolean }
  | { ok: false; code: "invalid" | "stale" | "not-found" | "unknown-intent" };

function fail(
  code: Extract<ActionResult, { ok: false }>["code"],
  status: number,
) {
  return data<ActionResult>({ ok: false, code }, { status });
}

/**
 * Republish `credit_v1` for a company whose settings just changed (CRED-03's
 * settings path — the merchant's edit reaches checkout within this request).
 *
 * Deliberately swallowing: the DATABASE is the source of truth and the
 * metafield is a projection of it. `publishCompanyCreditState` is already
 * non-throwing, and the hourly dirty sweep retries anything that failed, so a
 * Shopify blip must not tell a merchant their limit didn't save when it did
 * (locked decision 3 — the toast reports the DB write, and makes no publish
 * claims).
 */
async function republish(shop: string, companyGid: string): Promise<void> {
  try {
    await recomputeCompany(shop, companyGid);
  } catch (error: unknown) {
    console.error(`Settings recompute failed for ${companyGid} on ${shop}:`, error);
    Sentry.captureException(error);
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();
  const intent = form.get("intent");
  const companyId = String(form.get("companyId") ?? "");

  // Rule 1: the row must belong to THIS shop before anything else happens. A
  // forged id from another store stops here having mutated nothing (T-03-01).
  // The mutations below still repeat `shop` in their WHERE — one check is a
  // convenience, two is the actual boundary.
  const company = companyId
    ? await db.company.findFirst({
        where: { id: companyId, shop },
        // The extra columns are the enforcement-event snapshot (ENFC-05): read
        // once, here, from the same shop-scoped query that establishes the
        // tenant boundary, so an audit row can never describe another store's
        // state.
        select: {
          id: true,
          companyGid: true,
          name: true,
          exposure: true,
          creditLimit: true,
          overdue: true,
        },
      })
    : null;

  switch (intent) {
    case "set-limit": {
      if (!company) return fail("not-found", 404);

      const next = parseLimitInput(String(form.get("limit") ?? ""));
      if (next === "invalid") return fail("invalid", 422);

      // The echo is merchant-supplied too, so it gets the same grammar.
      const rawEcho = String(form.get("previousLimit") ?? "");
      const previous = parseLimitInput(rawEcho);
      if (previous === "invalid") return fail("invalid", 422);

      // Rule 4. Prisma renders `creditLimit: null` as `IS NULL`, which is
      // exactly right for the never-set case: the echo matches only rows that
      // still have no limit.
      const { count } = await db.company.updateMany({
        where: { id: company.id, shop, creditLimit: previous },
        data: { creditLimit: next },
      });
      if (count === 0) return fail("stale", 409);

      await republish(shop, company.companyGid);

      return data<ActionResult>({
        ok: true,
        intent: "set-limit",
        limitRemoved: next === null,
      });
    }

    case "set-bypass": {
      if (!company) return fail("not-found", 404);

      // Strict coercion: only the two literals the switch submits are accepted,
      // so a truthy-looking "1" or "on" is a rejected request rather than a
      // guess about what the merchant meant.
      const raw = String(form.get("bypass") ?? "");
      if (raw !== "true" && raw !== "false") return fail("invalid", 400);
      const bypass = raw === "true";

      // Last-write-wins is fine for a boolean the merchant can see and flip
      // back instantly (UI-SPEC Bypass Toggle Contract) — no CAS here.
      const { count } = await db.company.updateMany({
        where: { id: company.id, shop },
        data: { bypassEnforcement: bypass },
      });
      if (count === 0) return fail("not-found", 404);

      // ENFC-05 (D4-03): the merchant's own act is an event in its own right —
      // "who turned enforcement off for this company, and when" is the first
      // question asked when a leaked order shows up.
      //
      // Written BEFORE republish so the feed reads in causal order: the audit
      // row, then whatever blocked-state transition it caused. This route
      // deliberately writes NO transition of its own — `blockedState` has one
      // writer (recomputeCompany), which `republish` calls one line down, and a
      // second writer here would be a state change the log could disagree with.
      //
      // `bypass` in the snapshot is the value the toggle LEFT BEHIND; the kind
      // already records which direction it moved. Non-throwing by contract, so
      // a bookkeeping failure can never tell a merchant their toggle did not
      // save when the row above says it did.
      await recordEnforcementEvent(shop, {
        companyGid: company.companyGid,
        companyName: company.name,
        kind: bypass ? EVENT_KIND.BYPASS_ENABLED : EVENT_KIND.BYPASS_DISABLED,
        exposure: company.exposure,
        limit: company.creditLimit,
        overdue: company.overdue,
        bypass,
      });

      await republish(shop, company.companyGid);

      return data<ActionResult>({ ok: true, intent: "set-bypass", bypass });
    }

    default:
      // Rule 2: nothing above ran, nothing below will.
      return fail("unknown-intent", 400);
  }
};

/* ------------------------------------------------------------------ *
 * Value rendering — 03-UI-SPEC.md Value Rendering Contract.
 * ------------------------------------------------------------------ */

/**
 * Fixed-2 money string -> integer cents.
 *
 * Comparisons and utilization run on these exact integers, never on floats:
 * "over limit" is strictly `exposure > limit`, so a company sitting exactly ON
 * its limit is within it and one more cent flips the badge. That boundary is
 * meaningless if a rounding artifact can move it.
 */
function cents(value: string): bigint {
  const negative = value.startsWith("-");
  const digits = (negative ? value.slice(1) : value).replace(".", "");
  return negative ? -BigInt(digits) : BigInt(digits);
}

export type PrimaryStatus =
  | "overdue"
  | "over-limit"
  | "within-limit"
  | "observe-only";

/**
 * Badge & Tone Semantics, in priority order. Overdue outranks everything
 * (late money is the page's highest-severity fact) and is shown regardless of
 * limit or bypass — a bypassed company keeps every indicator it had (D-03).
 */
export function primaryStatusOf(row: {
  exposure: string;
  overdue: boolean;
  creditLimit: string | null;
}): PrimaryStatus {
  if (row.overdue) return "overdue";
  if (row.creditLimit === null) return "observe-only";
  return cents(row.exposure) > cents(row.creditLimit)
    ? "over-limit"
    : "within-limit";
}

/**
 * Whole-percent utilization, or null when the ratio is undefined.
 *
 * No limit or a zero limit -> null (the Status column carries the meaning
 * instead); negative exposure against a real limit -> "0%"; anything past
 * 999% caps rather than stretching the column.
 */
export function utilizationLabel(
  exposure: string,
  creditLimit: string | null,
): string | null {
  if (creditLimit === null) return null;
  const limit = cents(creditLimit);
  if (limit <= 0n) return null;

  const owed = cents(exposure);
  if (owed <= 0n) return "0%";

  // Round-half-up in integers: (2a + b) / 2b, with a = owed * 100.
  const percent = (owed * 200n + limit) / (limit * 2n);
  return percent > 999n ? ">999%" : `${percent}%`;
}

/* ------------------------------------------------------------------ *
 * UI
 * ------------------------------------------------------------------ */

function StatusCell({ row }: { row: CompanyRow }) {
  const status = primaryStatusOf(row);

  return (
    <s-table-cell>
      {status === "overdue" ? (
        <s-badge tone="critical">{STATUS_OVERDUE}</s-badge>
      ) : null}
      {status === "over-limit" ? (
        <s-badge tone="warning">{STATUS_OVER_LIMIT}</s-badge>
      ) : null}
      {status === "within-limit" ? (
        <s-text color="subdued">{STATUS_WITHIN_LIMIT}</s-text>
      ) : null}
      {status === "observe-only" ? (
        <s-text color="subdued">{STATUS_OBSERVE_ONLY}</s-text>
      ) : null}
      {/*
        Second indicator, never a third. `caution` is the app-home catalog's
        "attention without alarm" tone (there is no `attention` tone) — a
        deliberate merchant choice reads as highlighted, not broken.
      */}
      {row.bypassEnforcement ? (
        <s-badge tone="caution">{STATUS_BYPASSED}</s-badge>
      ) : null}
    </s-table-cell>
  );
}

/**
 * The Credit limit cell in edit mode.
 *
 * Mounted only while this row is the one being edited, which is what makes the
 * "one row at a time" rule free: activating another row unmounts this and
 * discards the half-typed number, and at most one `Save limit` primary button
 * can exist on the page.
 *
 * CONFIRMED, NOT OPTIMISTIC. A credit limit changes what a merchant's
 * customers can buy, so the row does not pretend the save worked: the field and
 * buttons disable, the cell stays in edit mode until the server answers, and a
 * failure keeps the typed value on screen with the error beside it. Nothing the
 * merchant typed is ever silently lost.
 */
function LimitEditor({
  row,
  onDone,
}: {
  row: CompanyRow;
  onDone: () => void;
}) {
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const [value, setValue] = useState(row.creditLimit ?? "");
  const fieldRef = useRef<HTMLElementTagNameMap["s-money-field"] | null>(null);

  /**
   * The CAS echo, captured ONCE at mount. Reading `row.creditLimit` at submit
   * time would let a background revalidation quietly refresh the echo to
   * whatever the other editor just wrote — which is precisely the collision the
   * echo exists to catch.
   */
  const previousLimit = useRef(row.creditLimit ?? "").current;

  const inFlight = fetcher.state !== "idle";
  const result = fetcher.data;

  const save = useCallback(
    (next: string) => {
      fetcher.submit(
        {
          intent: "set-limit",
          companyId: row.id,
          limit: next,
          previousLimit,
        },
        { method: "post" },
      );
    },
    [fetcher, row.id, previousLimit],
  );

  // Entering edit mode puts the cursor where the merchant is about to type.
  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  // Enter saves, Escape discards — and blur does NOTHING. An accidental click
  // elsewhere must never commit a credit limit (UI-SPEC: explicit save only).
  // The listener is native rather than a wrapper element's `onKeyDown` so the
  // table cell keeps exactly the DOM Polaris expects; keydown is composed, so
  // it crosses the component's shadow boundary to reach us.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;

    const onKeyDown = (event: Event) => {
      const key = (event as KeyboardEvent).key;
      if (key === "Enter") {
        event.preventDefault();
        save(value);
      } else if (key === "Escape") {
        event.preventDefault();
        onDone();
      }
    };

    field.addEventListener("keydown", onKeyDown);
    return () => {
      field.removeEventListener("keydown", onKeyDown);
    };
  }, [save, value, onDone]);

  // `fetcher.data` survives after the fetcher settles, so each outcome is
  // handled once by identity rather than re-firing its toast on every render.
  const handled = useRef<ActionResult | undefined>(undefined);
  useEffect(() => {
    if (fetcher.state !== "idle" || !result || handled.current === result) return;
    handled.current = result;

    if (result.ok && result.intent === "set-limit") {
      shopify.toast.show(
        result.limitRemoved ? LIMIT_REMOVED_TOAST : LIMIT_UPDATED_TOAST,
      );
      onDone();
      return;
    }

    if (!result.ok && result.code === "stale") {
      // Someone else moved this limit. Show them the truth rather than their
      // stale intent: refresh the table, close the editor, say what happened.
      shopify.toast.show(LIMIT_STALE_TOAST, { isError: true });
      revalidator.revalidate();
      onDone();
    }
    // "invalid" and "not-found" deliberately stay in edit mode — the error
    // renders on the field and the typed value is still there to correct.
  }, [fetcher.state, result, shopify, revalidator, onDone]);

  const fieldError =
    !inFlight && result && !result.ok
      ? result.code === "invalid"
        ? LIMIT_INVALID_ERROR
        : result.code === "not-found"
          ? LIMIT_SAVE_FAILED_ERROR
          : undefined
      : undefined;

  return (
    <>
      <s-money-field
        ref={fieldRef}
        label={`Credit limit for ${row.name}`}
        labelAccessibilityVisibility="exclusive"
        min={0}
        value={value}
        disabled={inFlight}
        error={fieldError}
        onChange={(event) => {
          setValue(event.currentTarget.value);
        }}
      />
      <s-button
        variant="primary"
        disabled={inFlight}
        onClick={() => {
          save(value);
        }}
      >
        {SAVE_LIMIT_LABEL}
      </s-button>
      <s-button disabled={inFlight} onClick={onDone}>
        {DISCARD_LABEL}
      </s-button>
      {/* Only offered when there is something to remove. Instantly reversible,
          so it is deliberately unconfirmed. */}
      {row.creditLimit === null ? null : (
        <s-button
          variant="tertiary"
          disabled={inFlight}
          onClick={() => {
            save("");
          }}
        >
          {REMOVE_LIMIT_LABEL}
        </s-button>
      )}
    </>
  );
}

/**
 * The bypass toggle: optimistic, immediately saved, no confirmation.
 *
 * The optimistic value is read straight off the in-flight submission, so
 * revert-on-error needs no state machine — when the fetcher settles the switch
 * falls back to whatever the server says it is. The Status column's bypass
 * badge appearing or disappearing is the real confirmation; the toast is
 * courtesy.
 */
function BypassSwitch({ row }: { row: CompanyRow }) {
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();

  const pending = fetcher.formData?.get("bypass");
  const checked =
    typeof pending === "string" ? pending === "true" : row.bypassEnforcement;
  const inFlight = fetcher.state !== "idle";
  const result = fetcher.data;

  const handled = useRef<ActionResult | undefined>(undefined);
  useEffect(() => {
    if (fetcher.state !== "idle" || !result || handled.current === result) return;
    handled.current = result;

    if (result.ok && result.intent === "set-bypass") {
      shopify.toast.show(result.bypass ? BYPASS_ON_TOAST : BYPASS_OFF_TOAST);
    } else if (!result.ok) {
      shopify.toast.show(BYPASS_FAILED_TOAST, { isError: true });
    }
  }, [fetcher.state, result, shopify]);

  return (
    <s-switch
      label={`Bypass enforcement for ${row.name}`}
      labelAccessibilityVisibility="exclusive"
      accessibilityLabel={`Bypass enforcement for ${row.name}`}
      checked={checked}
      // Disabled in flight so an impatient double-click cannot fire twice.
      disabled={inFlight}
      onChange={(event) => {
        fetcher.submit(
          {
            intent: "set-bypass",
            companyId: row.id,
            bypass: String(event.currentTarget.checked),
          },
          { method: "post" },
        );
      }}
    />
  );
}

function CompanyTableRow({
  row,
  formatMoney,
  dataComplete,
  isEditing,
  onBeginEdit,
  onEndEdit,
}: {
  row: CompanyRow;
  formatMoney: (value: string) => string;
  dataComplete: boolean;
  isEditing: boolean;
  onBeginEdit: () => void;
  onEndEdit: () => void;
}) {
  const utilization = utilizationLabel(row.exposure, row.creditLimit);
  const tooltipId = `incomplete-${row.id}`;

  return (
    <s-table-row>
      {/* Names wrap rather than truncate: data integrity over tidiness. */}
      <s-table-cell>{row.name}</s-table-cell>

      <s-table-cell>
        {formatMoney(row.exposure)}
        {dataComplete ? null : (
          <>
            {" "}
            <s-text color="subdued" interestFor={tooltipId}>
              {INCOMPLETE_MARKER}
            </s-text>
            <s-tooltip id={tooltipId}>{INCOMPLETE_TOOLTIP}</s-tooltip>
          </>
        )}
      </s-table-cell>

      <s-table-cell>
        {/*
          D-02's rendering law: words for "no limit", a numeral for a zero
          limit. "No limit" changes nothing at checkout; "$0.00" blocks every
          new net-terms order once Phase 4 ships, so the two must never look
          alike.
        */}
        {isEditing ? (
          <LimitEditor row={row} onDone={onEndEdit} />
        ) : row.creditLimit === null ? (
          <>
            <s-text color="subdued">{NO_LIMIT_LABEL}</s-text>{" "}
            <s-link
              accessibilityLabel={`Edit credit limit for ${row.name}`}
              onClick={onBeginEdit}
            >
              {SET_LIMIT_LABEL}
            </s-link>
          </>
        ) : (
          <s-link
            accessibilityLabel={`Edit credit limit for ${row.name}`}
            onClick={onBeginEdit}
          >
            {formatMoney(row.creditLimit)}
          </s-link>
        )}
      </s-table-cell>

      <s-table-cell>
        {utilization === null ? (
          <s-text color="subdued">—</s-text>
        ) : (
          utilization
        )}
      </s-table-cell>

      <StatusCell row={row} />

      <s-table-cell>
        <BypassSwitch row={row} />
      </s-table-cell>
    </s-table-row>
  );
}

export default function Companies() {
  const {
    companies,
    dataComplete,
    backfillRunning,
    currencyCode,
    page,
    hasNextPage,
    hasPreviousPage,
  } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();

  // At most one row edits at a time (UI-SPEC): it keeps the one-primary-button
  // rule intact, and unmounting the previous editor is how "activating another
  // row cancels the current edit" happens for free.
  const [editingId, setEditingId] = useState<string | null>(null);
  const endEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const formatMoney = useMemo(
    () => createMoneyFormatter(currencyCode),
    [currencyCode],
  );

  const goToPage = (next: number) => {
    setSearchParams((params) => {
      params.set("page", String(next));
      return params;
    });
  };

  return (
    <s-page heading="Companies">
      <s-section>
        <s-paragraph>{PAGE_INTRO}</s-paragraph>
      </s-section>

      {/* The page's only partial-data signal; it disappears when the run ends. */}
      {backfillRunning ? (
        <s-banner tone="info">
          <s-paragraph>{BACKFILL_BANNER}</s-paragraph>
        </s-banner>
      ) : null}

      {companies.length === 0 ? (
        <s-section heading={EMPTY_STATE_HEADING}>
          <s-paragraph>{EMPTY_STATE_BODY}</s-paragraph>
        </s-section>
      ) : (
        <s-section>
          {/*
            `auto` collapses to the stacked list layout on narrow admin widths
            with Company as the primary slot — there is no second mobile layout
            to maintain. Pagination controls only exist past 50 companies, which
            the entire 5-50 ICP never reaches.
          */}
          <s-table
            variant="auto"
            paginate={hasNextPage || hasPreviousPage}
            hasNextPage={hasNextPage}
            hasPreviousPage={hasPreviousPage}
            onNextPage={() => {
              goToPage(page + 1);
            }}
            onPreviousPage={() => {
              goToPage(page - 1);
            }}
          >
            <s-table-header-row>
              <s-table-header listSlot="primary">
                {COLUMN_HEADERS[0]}
              </s-table-header>
              <s-table-header format="numeric">
                {COLUMN_HEADERS[1]}
              </s-table-header>
              <s-table-header format="numeric">
                {COLUMN_HEADERS[2]}
              </s-table-header>
              <s-table-header format="numeric">
                {COLUMN_HEADERS[3]}
              </s-table-header>
              <s-table-header>{COLUMN_HEADERS[4]}</s-table-header>
              <s-table-header>{COLUMN_HEADERS[5]}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {companies.map((row) => (
                <CompanyTableRow
                  key={row.id}
                  row={row}
                  formatMoney={formatMoney}
                  dataComplete={dataComplete}
                  isEditing={editingId === row.id}
                  onBeginEdit={() => {
                    setEditingId(row.id);
                  }}
                  onEndEdit={endEdit}
                />
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
