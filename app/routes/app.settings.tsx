import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import * as Sentry from "@sentry/react-router";

import { authenticate } from "../shopify.server";
// Server-only, and referenced ONLY inside `loader`/`action` (app.companies.tsx
// precedent). The reminders switch writes `Shop.remindersEnabledAt` straight
// through Prisma rather than through `services/reminders.server.ts`: that
// module is the SWEEP's, and nothing that sends email belongs on the request
// path of a merchant clicking a toggle.
import db from "../db.server";
// The pure half — safe in the browser bundle, which is why the cap and the
// validator live outside `enforcement.server.ts` (see app/block-messages.ts).
import {
  MAX_MESSAGE_LENGTH,
  validateMessage,
  type MessageRejection,
} from "../block-messages";
// The cadence sentence, shared with the dashboard's empty state so the two
// screens cannot drift (UI-SPEC R2). A plain, import-free module for the same
// reason block-messages is one — see app/reminder-copy.ts.
import { REMINDERS_CADENCE } from "../reminder-copy";
// Server-only, and referenced ONLY inside `loader`/`action` — React Router
// strips those from the client bundle, so nothing here reaches the browser.
import {
  readValidationConfig,
  updateValidationMessages,
} from "../services/enforcement.server";
import type {
  ValidationConfigState,
  ValidationStatus,
} from "../services/enforcement.server";

/**
 * The enforcement Settings page (ENFC-03) — the merchant's control over what a
 * blocked buyer reads, and the app's honest account of whether anything is
 * being enforced at all.
 *
 * THREE RULES, all load-bearing:
 *
 * 1. THE STATUS IS PLATFORM TRUTH, NEVER OUR OPTIMISM. All three states come
 *    from reading the Validation object back through the Admin API. A merchant
 *    can turn our rule off in Settings -> Checkout -> Checkout rules, and this
 *    page says so plainly rather than showing a green "protected" badge over a
 *    checkout nothing is guarding (research Pattern 2). An app that lies about
 *    enforcement is worse than an app that does not enforce: the merchant stops
 *    checking.
 *
 * 2. THE CAP IS SERVER-SIDE. `maxLength` on the textarea is a courtesy for
 *    typing; `validateMessage` in enforcement.server.ts is the actual gate
 *    (T-04-13). Everything the merchant submits reaches a stranger's checkout,
 *    so nothing here trusts the browser.
 *
 * 3. INTENTS ARE WHITELISTED, AND THE SHOP COMES FROM THE SESSION. Same
 *    discipline as app.companies.tsx: an unknown intent answers 400 having
 *    changed nothing, and the Validation GID is read only from the
 *    authenticated shop's own row — a forged form field cannot address another
 *    merchant's checkout rule (T-04-14).
 *
 * NOT ON THIS PAGE, DELIBERATELY: the enforcement event feed (what was blocked,
 * what was bypassed) and the currency-mismatch company list. Both are Phase 6
 * dashboard work (DASH-02, D4-02) and are recorded here so a future reader does
 * not mistake their absence for an oversight. The EnforcementEvent rows are
 * already being written by 04-02 — they are simply not surfaced yet.
 */

/* ------------------------------------------------------------------ *
 * Copy — plain, honest, no "protected"/"enforcing" language over a rule we
 * have not confirmed is running (03-UI-SPEC Copywriting Contract discipline).
 * ------------------------------------------------------------------ */

export const PAGE_HEADING = "Settings";

export const PAGE_INTRO =
  "Credit Guard blocks checkout for companies that are over their credit limit or have overdue invoices. These are the messages those buyers see.";

/** The three honest rule states. One banner, never two. */
export const STATUS_ACTIVE_HEADING = "Checkout enforcement is on";
export const STATUS_ACTIVE_BODY =
  "The credit check is live on your checkout. Companies over their credit limit or with overdue invoices can't complete a new net-terms order.";

export const STATUS_DISABLED_HEADING =
  "The enforcement rule is turned off in checkout settings";
export const STATUS_DISABLED_BODY =
  "Credit Guard's rule exists but is switched off, so nothing is being blocked right now. Turn it back on in Settings > Checkout > Checkout rules.";

export const STATUS_UNREGISTERED_HEADING = "Enforcement isn't set up yet";
export const STATUS_UNREGISTERED_BODY =
  "Credit Guard hasn't been able to add its checkout rule to your store yet. Open the app again after granting permissions — it sets itself up automatically.";

/** Section + field labels. The over-limit wording is D4-01's remaining-credit framing. */
export const MESSAGES_SECTION_HEADING = "Checkout block messages";
export const OVER_LIMIT_LABEL =
  "Message shown when an order would exceed remaining credit";
export const OVERDUE_LABEL = "Message shown when the account is overdue";
export const SAVE_LABEL = "Save messages";

/** Field errors and outcome copy. */
export const MESSAGE_REQUIRED_ERROR =
  "Enter the message buyers should see when their order is blocked.";
export const MESSAGE_TOO_LONG_ERROR = `Shorten this message to ${MAX_MESSAGE_LENGTH} characters or fewer.`;
export const MESSAGE_CONTROL_ERROR =
  "Remove any special characters — this message is shown as plain text at checkout.";
export const SAVE_FAILED_HEADING = "Couldn't save these messages";
export const SAVE_FAILED_BODY =
  "Your messages weren't saved, so buyers still see the previous ones. Check your connection and try again.";
export const SAVE_UNREGISTERED_BODY =
  "There's no checkout rule to save these messages to yet. Reload the app once permissions are granted, then try again.";
export const MESSAGES_SAVED_TOAST = "Block messages updated";

/** The accepted intents (rule 3). Anything else is a 400. */
export const SAVE_MESSAGES_INTENT = "save-messages";
export const REMINDERS_ENABLE_INTENT = "enable-reminders";
export const REMINDERS_DISABLE_INTENT = "disable-reminders";

/* ------------------------------------------------------------------ *
 * Payment reminders copy (REMD-01 / D5-02, D5-05)
 *
 * This copy is the feature. The switch below starts Shopify emailing real
 * buyers on the merchant's behalf, and every sentence here exists because a
 * merchant who does not read it gets a surprise they cannot undo: a duplicate
 * dunning email, a reminder that went to a stale address, or a reminder that
 * silently waited a day. Each line is traceable to something 05-02 MEASURED on
 * a live store — not to what the docs imply.
 * ------------------------------------------------------------------ */

export const REMINDERS_SECTION_HEADING = "Payment reminders";

/** The two honest states. Off is the default for every shop (D5-02). */
export const REMINDERS_OFF_STATUS =
  "Payment reminders are off. Credit Guard never emails your customers until you turn this on.";

/** Dated from the watermark itself, so the status cannot drift from the column. */
export function remindersOnStatus(enabledOn: string): string {
  return `Payment reminders are on since ${enabledOn}.`;
}

export const REMINDERS_ENABLE_LABEL = "Turn on payment reminders";
export const REMINDERS_DISABLE_LABEL = "Turn off payment reminders";

/**
 * What the emails actually are, who actually sends them (D5-03/D5-04), and
 * WHICH invoices are in scope.
 *
 * The eligibility clause is not decoration (WINDOWS #22 / 05-VERIFICATION W3).
 * This line used to read "each unpaid invoice is chased", which is not true:
 * `eligibleSchedules` requires `attributionStatus ATTRIBUTED` and a company, so
 * a net-terms order with no purchasing company is never emailed. A merchant who
 * believed the old sentence would wait for reminders that were never coming —
 * and telling them otherwise is an App Store 4.3 truthfulness exposure, not
 * merely a documentation gap. v1 company-only is a product choice (see
 * `eligibleSchedules`); saying so plainly costs nothing.
 *
 * The cadence is composed from the shared constant rather than spelled out, so
 * this card and the dashboard's empty state cannot disagree.
 */
export const REMINDERS_MOMENTS_BODY =
  "Reminders are sent by Shopify, from your store's own email address, using your Payment reminder notification template. Only net-terms orders attributed to a company in Credit Guard are chased — orders with no purchasing company aren't emailed. Each of those invoices is chased at three moments: " +
  REMINDERS_CADENCE +
  ". Each moment is sent at most once, and an invoice that has been paid is never chased again.";

/** D5-02 — the watermark, in the one sentence a merchant needs. */
export const REMINDERS_WATERMARK_BODY =
  "Only invoices whose reminder moments happen after you turn this on will be emailed — nothing is sent for older overdue invoices. Turning reminders off and on again starts a fresh line: the invoices that came due while they were off stay quiet.";

/**
 * D5-05 — the one risk no code can remove. No API reports whether the
 * merchant's native reminders are configured, so this is documented rather
 * than detected. The default is E5's MEASURED observation (05-02), not a guess.
 */
export const REMINDERS_DUPLICATE_HEADING =
  "Check Shopify's own payment reminders first";
export const REMINDERS_DUPLICATE_BODY =
  "Shopify can send its own scheduled payment reminders, set up under Settings > Notifications. They stay off until you configure them, so on most stores Credit Guard is the only sender. If you have already set them up, keep just one of the two switched on — running both means a buyer can receive two emails about the same invoice.";

/** N1 — a platform limit, proven per ORDER (not per company) in 05-02. */
export const REMINDERS_ONE_PER_DAY_BODY =
  "Shopify allows one payment reminder per order per day. If you — or a Flow automation — send a reminder for an order by hand, Credit Guard's reminder for that order waits until the next day.";

/** N2 — proven in 05-02, and impossible to fix in code under D5-01. */
export const REMINDERS_RECIPIENT_BODY =
  "Shopify decides who receives an order's reminders when the order is created. If you correct a contact's email address, orders already on the books keep sending to the old address — only new orders use the new one.";

/** Pitfall 6 + the 05-RESEARCH addendum: the template is Shopify's, and it adapts. */
export const REMINDERS_TEMPLATE_BODY =
  'The wording of these emails is Shopify\'s Payment reminder template, edited under Settings > Notifications > Payment reminder — not in this app. By default it adapts to the invoice: it reads "due in N days" before the due date and "N days overdue" after it. If you have customised that template, preview it there to see exactly what your buyers will read.';

export const REMINDERS_ENABLED_TOAST = "Payment reminders turned on";
export const REMINDERS_DISABLED_TOAST = "Payment reminders turned off";

export const REMINDERS_FAILED_HEADING = "Couldn't change this setting";
export const REMINDERS_FAILED_BODY =
  "The switch didn't move, so payment reminders are still in the state shown above. Check your connection and try again.";

/* ------------------------------------------------------------------ *
 * Loader
 * ------------------------------------------------------------------ */

export type SettingsLoaderData = ValidationConfigState & {
  /** ISO-8601, or null while reminders are off. Read from the column itself. */
  remindersEnabledAt: string | null;
};

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<SettingsLoaderData> => {
  const { session } = await authenticate.admin(request);

  const [config, shop] = await Promise.all([
    // Non-throwing by contract: a GraphQL blip degrades to "unregistered" with
    // the default copy rather than a 500 on the page the merchant came here to
    // use.
    readValidationConfig(session.shop),
    // The watermark is read from the COLUMN the sweep reads, never inferred
    // from anything this page happens to know. If the two ever disagree, the
    // page is wrong and the merchant's customers are the ones who find out.
    db.shop.findUnique({
      where: { domain: session.shop },
      select: { remindersEnabledAt: true },
    }),
  ]);

  return {
    ...config,
    remindersEnabledAt: shop?.remindersEnabledAt?.toISOString() ?? null,
  };
};

/* ------------------------------------------------------------------ *
 * Action
 * ------------------------------------------------------------------ */

export type SettingsActionResult =
  | {
      ok: true;
      intent:
        | typeof SAVE_MESSAGES_INTENT
        | typeof REMINDERS_ENABLE_INTENT
        | typeof REMINDERS_DISABLE_INTENT;
    }
  | {
      ok: false;
      code: "invalid" | "unregistered" | "save-failed" | "unknown-intent";
      fieldErrors?: { overLimit?: string; overdue?: string };
    };

/** Rejection reason -> the sentence the merchant reads on the field. */
export function fieldErrorFor(reason: MessageRejection): string {
  switch (reason) {
    case "too-long":
      return MESSAGE_TOO_LONG_ERROR;
    case "control":
      return MESSAGE_CONTROL_ERROR;
    // A missing field and a non-string field are the same thing to a merchant:
    // there is no message here.
    case "empty":
    case "not-a-string":
    default:
      return MESSAGE_REQUIRED_ERROR;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const form = await request.formData();
  const intent = form.get("intent");

  switch (intent) {
    case SAVE_MESSAGES_INTENT: {
      // `form.get` yields `string | File | null`; both non-string cases fall
      // through `validateMessage`'s type guard rather than being coerced. A
      // `String(...)` here would turn a null field into the four-character
      // message "null" and save it to a live checkout.
      const overLimit = validateMessage(form.get("overLimitMessage"));
      const overdue = validateMessage(form.get("overdueMessage"));

      if (!overLimit.ok || !overdue.ok) {
        // Rejected BEFORE any transport: an invalid submission issues no
        // mutation at all, so the copy buyers see is untouched.
        return data<SettingsActionResult>(
          {
            ok: false,
            code: "invalid",
            fieldErrors: {
              ...(overLimit.ok
                ? {}
                : { overLimit: fieldErrorFor(overLimit.reason) }),
              ...(overdue.ok ? {} : { overdue: fieldErrorFor(overdue.reason) }),
            },
          },
          { status: 422 },
        );
      }

      const result = await updateValidationMessages(shop, {
        overLimit: overLimit.value,
        overdue: overdue.value,
      });

      if (result.ok) {
        return data<SettingsActionResult>({
          ok: true,
          intent: SAVE_MESSAGES_INTENT,
        });
      }

      // userErrors and transport failures both arrive here as `save-failed`,
      // and both are reported as a failure — never swallowed into a success
      // toast over copy that never changed (T-04-15).
      const status =
        result.code === "unregistered"
          ? 409
          : result.code === "invalid"
            ? 422
            : 502;
      return data<SettingsActionResult>(
        { ok: false, code: result.code },
        { status },
      );
    }

    case REMINDERS_ENABLE_INTENT:
    case REMINDERS_DISABLE_INTENT: {
      /**
       * D5-02, and the mutation rule is the whole feature:
       *
       * ENABLING ALWAYS STAMPS A NEW `now` — including a re-enable after a
       * disable. The column is not a boolean with a creation date on it; it is
       * the sweep's suppression boundary. Preserving an older timestamp on
       * re-enable would mean every moment that passed while reminders were OFF
       * is suddenly behind the watermark and therefore fair game, and the
       * merchant who cautiously switched off for a fortnight would blast a
       * fortnight of dunning the moment they switched back on.
       *
       * DISABLING NULLS IT. Off is off, and it is also the install default —
       * so there is exactly one representation of "this shop sends nothing",
       * and the sweep gets to return before it queries anything.
       *
       * Written here, directly, and nowhere else: `reminders.server.ts` is the
       * sweep's module, and no code path outside this action may set this
       * column — a backfill or webhook that could enable reminders on the
       * merchant's behalf is the install blast wearing a different hat.
       */
      const remindersEnabledAt =
        intent === REMINDERS_ENABLE_INTENT ? new Date() : null;

      try {
        await db.shop.update({
          where: { domain: shop },
          data: { remindersEnabledAt },
        });
      } catch (error) {
        // A failed write is reported as a failure. Toasting success over a
        // switch that never moved is how a merchant comes to believe their
        // customers are being chased when nothing is (T-04-15's lesson).
        Sentry.captureException(error);
        return data<SettingsActionResult>(
          { ok: false, code: "save-failed" },
          { status: 502 },
        );
      }

      return data<SettingsActionResult>({ ok: true, intent });
    }

    default:
      // Rule 3: nothing above ran, nothing below will.
      return data<SettingsActionResult>(
        { ok: false, code: "unknown-intent" },
        { status: 400 },
      );
  }
};

/* ------------------------------------------------------------------ *
 * UI
 * ------------------------------------------------------------------ */

const STATUS_BANNERS: Record<
  ValidationStatus,
  { heading: string; body: string; tone: "success" | "warning" | "info" }
> = {
  active: {
    heading: STATUS_ACTIVE_HEADING,
    body: STATUS_ACTIVE_BODY,
    tone: "success",
  },
  // Warning, not critical: the merchant chose this, and the app is reporting
  // the consequence rather than scolding them for it.
  disabled: {
    heading: STATUS_DISABLED_HEADING,
    body: STATUS_DISABLED_BODY,
    tone: "warning",
  },
  unregistered: {
    heading: STATUS_UNREGISTERED_HEADING,
    body: STATUS_UNREGISTERED_BODY,
    tone: "info",
  },
};

function StatusBanner({ status }: { status: ValidationStatus }) {
  const banner = STATUS_BANNERS[status];

  return (
    <s-banner tone={banner.tone} heading={banner.heading}>
      <s-paragraph>{banner.body}</s-paragraph>
    </s-banner>
  );
}

/**
 * The reminders card (REMD-01). Deliberately its OWN fetcher: a failed toggle
 * must not raise the message-save banner, and toggling must not disable the
 * textareas mid-edit. Two independent controls, two independent outcomes.
 */
function PaymentReminders({
  remindersEnabledAt,
}: {
  remindersEnabledAt: string | null;
}) {
  const fetcher = useFetcher<SettingsActionResult>();
  const shopify = useAppBridge();

  const inFlight = fetcher.state !== "idle";
  const result = fetcher.data;

  const handled = useRef<SettingsActionResult | undefined>(undefined);
  useEffect(() => {
    if (fetcher.state !== "idle" || !result || handled.current === result) return;
    handled.current = result;

    if (result.ok) {
      shopify.toast.show(
        result.intent === REMINDERS_ENABLE_INTENT
          ? REMINDERS_ENABLED_TOAST
          : REMINDERS_DISABLED_TOAST,
      );
    }
  }, [fetcher.state, result, shopify]);

  const failed = !inFlight && result && !result.ok;

  // The status is the column, formatted — never a separate flag that could
  // disagree with what the sweep reads.
  const enabled = remindersEnabledAt !== null;
  const enabledOn = enabled
    ? new Date(remindersEnabledAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  const toggle = () => {
    fetcher.submit(
      {
        intent: enabled ? REMINDERS_DISABLE_INTENT : REMINDERS_ENABLE_INTENT,
      },
      { method: "post" },
    );
  };

  return (
    <s-section heading={REMINDERS_SECTION_HEADING}>
      <s-banner tone={enabled ? "success" : "info"}>
        <s-paragraph>
          {enabled ? remindersOnStatus(enabledOn) : REMINDERS_OFF_STATUS}
        </s-paragraph>
      </s-banner>

      {failed ? (
        <s-banner tone="critical" heading={REMINDERS_FAILED_HEADING}>
          <s-paragraph>{REMINDERS_FAILED_BODY}</s-paragraph>
        </s-banner>
      ) : null}

      <s-paragraph>{REMINDERS_MOMENTS_BODY}</s-paragraph>
      <s-paragraph>{REMINDERS_WATERMARK_BODY}</s-paragraph>

      <s-button
        variant={enabled ? "secondary" : "primary"}
        disabled={inFlight}
        onClick={toggle}
      >
        {enabled ? REMINDERS_DISABLE_LABEL : REMINDERS_ENABLE_LABEL}
      </s-button>

      {/*
        The three things a merchant learns the hard way otherwise. All of them
        are 05-02 measurements against a live store, and none of them can be
        detected or fixed in code — which is exactly why they are printed here,
        above the switch's consequences rather than in a help doc nobody opens.
      */}
      <s-banner tone="warning" heading={REMINDERS_DUPLICATE_HEADING}>
        <s-paragraph>{REMINDERS_DUPLICATE_BODY}</s-paragraph>
        <s-paragraph>{REMINDERS_ONE_PER_DAY_BODY}</s-paragraph>
      </s-banner>

      <s-paragraph>{REMINDERS_RECIPIENT_BODY}</s-paragraph>
      <s-paragraph>{REMINDERS_TEMPLATE_BODY}</s-paragraph>
    </s-section>
  );
}

export default function Settings() {
  const { status, messages, remindersEnabledAt } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<SettingsActionResult>();
  const shopify = useAppBridge();

  const [overLimit, setOverLimit] = useState(messages.overLimit);
  const [overdue, setOverdue] = useState(messages.overdue);

  const inFlight = fetcher.state !== "idle";
  const result = fetcher.data;

  // `fetcher.data` survives after the fetcher settles, so each outcome is
  // handled once by identity rather than re-firing its toast on every render
  // (the app.companies.tsx pattern).
  const handled = useRef<SettingsActionResult | undefined>(undefined);
  useEffect(() => {
    if (fetcher.state !== "idle" || !result || handled.current === result) return;
    handled.current = result;

    if (result.ok) {
      shopify.toast.show(MESSAGES_SAVED_TOAST);
    }
    // Failures deliberately do NOT toast: they render as a persistent banner or
    // a field error, with the merchant's typed text still on screen to fix.
  }, [fetcher.state, result, shopify]);

  const fieldErrors = !inFlight && result && !result.ok ? result.fieldErrors : undefined;
  const saveFailure =
    !inFlight && result && !result.ok && result.code !== "invalid"
      ? result.code
      : undefined;

  const save = () => {
    fetcher.submit(
      {
        intent: SAVE_MESSAGES_INTENT,
        overLimitMessage: overLimit,
        overdueMessage: overdue,
      },
      { method: "post" },
    );
  };

  return (
    <s-page heading={PAGE_HEADING}>
      <s-section>
        <s-paragraph>{PAGE_INTRO}</s-paragraph>
      </s-section>

      <StatusBanner status={status} />

      {saveFailure ? (
        <s-banner tone="critical" heading={SAVE_FAILED_HEADING}>
          <s-paragraph>
            {saveFailure === "unregistered"
              ? SAVE_UNREGISTERED_BODY
              : SAVE_FAILED_BODY}
          </s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading={MESSAGES_SECTION_HEADING}>
        <s-text-area
          label={OVER_LIMIT_LABEL}
          rows={3}
          value={overLimit}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={inFlight}
          error={fieldErrors?.overLimit}
          details={`${overLimit.trim().length}/${MAX_MESSAGE_LENGTH}`}
          onInput={(event) => {
            setOverLimit(
              (event.currentTarget as HTMLElementTagNameMap["s-text-area"]).value,
            );
          }}
        />

        <s-text-area
          label={OVERDUE_LABEL}
          rows={3}
          value={overdue}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={inFlight}
          error={fieldErrors?.overdue}
          details={`${overdue.trim().length}/${MAX_MESSAGE_LENGTH}`}
          onInput={(event) => {
            setOverdue(
              (event.currentTarget as HTMLElementTagNameMap["s-text-area"]).value,
            );
          }}
        />

        {/*
          One primary button, and it stays disabled in flight so an impatient
          double-click cannot issue two mutations against the same rule.
        */}
        <s-button variant="primary" disabled={inFlight} onClick={save}>
          {SAVE_LABEL}
        </s-button>
      </s-section>

      <PaymentReminders remindersEnabledAt={remindersEnabledAt} />

      {/*
        PHASE 6 (DASH-02, LNCH-02) LIVES BELOW THIS LINE — the enforcement event
        feed ("what got blocked, what got bypassed"), the D4-02 currency-mismatch
        company list, and the SENT-REMINDER FEED that reads ReminderLog.
        Deliberately not half-built here: 04-02 already writes the
        EnforcementEvent rows and 05-03's sweep writes the ReminderLog rows, so
        both datasets are accumulating while the surface waits for the dashboard
        phase. The reminder feed in particular is LNCH-02's first-reminder
        moment — its absence here is a schedule decision, not an oversight.
      */}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
