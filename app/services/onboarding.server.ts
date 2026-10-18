import db from "../db.server";
import {
  SETUP_COPY,
  type SetupState,
  type SetupStep,
} from "../setup-copy";
import {
  isReviewResultCode,
  stampsReviewPrompt,
  type ReviewResultCode,
} from "../review-codes";
import { readBackfillState, type BackfillState } from "./backfill.server";
import {
  EVENT_KIND,
  readValidationConfig,
  type ValidationStatus,
} from "./enforcement.server";
import { REMINDER_STATUS } from "./reminders.server";

/**
 * Re-exported so server code has one import for the whole onboarding surface,
 * while the literals themselves stay in a transport-free module the browser can
 * also import (see app/review-codes.ts).
 */
export {
  REVIEW_RESULT_CODES,
  REVIEW_NEVER_EVALUATED_CODES,
  isReviewResultCode,
  type ReviewResultCode,
} from "../review-codes";

/**
 * The guided setup (DASH-03, D6-03) — three steps a new install walks before
 * Credit Guard is doing anything for the merchant.
 *
 * WHAT IS STORED AND WHAT IS DERIVED. Only two facts need a column, because
 * only two are acts of a human rather than states of the world:
 * `Shop.onboardingReviewedAt` ("I looked at the imported balances") and
 * `Shop.onboardingDismissedAt` ("I'm done with this guide"). Steps 2 and 3
 * re-derive on every load — from `Company.creditLimit` and from Shopify's own
 * answer about our checkout rule — so they cannot go stale the way a cached
 * boolean would. A merchant who deletes every limit sees step 2 open again,
 * which is honest; after dismissal nothing reappears, which is BFS 4.2.2 #6.
 *
 * WHY THE COPY LIVES HERE. Every string below is byte-exact contract from
 * 06-UI-SPEC.md (§ Guided Setup Contract, § Copywriting S1-S11). Keeping them
 * in `SETUP_COPY` rather than in JSX is what lets a spec pin them: a rule that
 * survives only as a literal buried in a component is a rule nobody checks.
 *
 * THE ONE ADMIN CALL ON THE HOME PATH. Step 3 reports the LIVE status of our
 * Validation, which only Shopify can answer, so `loadSetupState` makes one
 * Admin GraphQL read — but ONLY while the guide is visible. Once the merchant
 * presses "Done" the home loader is a pure Postgres projection again, and a
 * Shopify outage can never take the dashboard with it (T-06-22). That ordering
 * is a load-bearing invariant, not an optimisation: the dismissed short-circuit
 * returns before any read that could hang.
 */

/* ------------------------------------------------------------------ *
 * Copy and rendered shape — in a transport-free module so the page can
 * import them without dragging Prisma into the client bundle (04-04).
 * ------------------------------------------------------------------ */

export {
  SETUP_COPY,
  type SetupButton,
  type SetupIconTone,
  type SetupIconType,
  type SetupLink,
  type SetupState,
  type SetupStep,
  type SetupStepState,
} from "../setup-copy";

/** What the guide needs to know about the world to derive itself. */
export interface SetupInput {
  backfill: BackfillState | null;
  reviewedAt: Date | null;
  hasLimit: boolean;
  validationGid: string | null;
  validation: "active" | "disabled" | "unregistered" | null;
  /** Only affects count grouping in step 1's body ("1,024 orders"). */
  locale?: string;
}

/** The state a dismissed guide reports — nothing to render, nothing to read. */
export const DISMISSED_SETUP_STATE: SetupState = {
  visible: false,
  steps: [],
  completeCount: 0,
  allDone: false,
  progressLabel: "",
};

/* ------------------------------------------------------------------ *
 * Derivation — pure, so the whole matrix is testable without a database.
 * ------------------------------------------------------------------ */

function formatCount(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale ?? "en-US").format(value);
}

/** Step 1's body says exactly what the import is doing right now. */
function step1Body(backfill: BackfillState | null, locale?: string): string {
  // Null means the cursor row has never been written: the backfill either never
  // started or lost its state. Both are the failed story from the merchant's
  // side — something did not finish — and the honest instruction is the same.
  if (backfill === null || backfill.status === "failed") {
    return SETUP_COPY.step1BodyFailed;
  }

  const orders = formatCount(backfill.orderCount, locale);
  const companies = formatCount(backfill.companyCount, locale);

  return backfill.status === "running"
    ? SETUP_COPY.step1BodyRunning(orders, companies)
    : SETUP_COPY.step1BodyFinished(companies, orders);
}

/**
 * The three rows, in order, with exactly one `variant: "primary"` button when
 * anything is still incomplete (UI-SPEC C1: the page has ONE primary CTA and it
 * is the current step's action).
 */
export function deriveSetupSteps(input: SetupInput): SetupStep[] {
  const running = input.backfill?.status === "running";

  const step1Complete = input.reviewedAt !== null;

  const steps: SetupStep[] = [
    {
      id: 1,
      title: SETUP_COPY.step1Title,
      body: step1Body(input.backfill, input.locale),
      complete: step1Complete,
      state: step1Complete ? "complete" : "todo",
      icon: step1Complete
        ? { type: "check-circle-filled", tone: "success" }
        : { type: "circle-dashed", tone: "neutral" },
      // A completed step keeps no button (UI-SPEC), and the "Open companies"
      // link goes with it: there is nothing left to go and review.
      button: step1Complete
        ? null
        : {
            label: SETUP_COPY.step1Button,
            intent: "mark-reviewed",
            // Marking half-imported balances "reviewed" would be a merchant
            // vouching for numbers that are still moving.
            disabled: running,
            variant: "secondary",
          },
      ...(step1Complete
        ? {}
        : { link: { label: SETUP_COPY.step1Link, href: "/app/companies" } }),
    },
    step2(input.hasLimit),
    step3(input, input.hasLimit),
  ];

  return assignPrimary(steps);
}

/**
 * Step 2 is DERIVED, never stored: "has this shop set a limit on anything?" is
 * a question the ledger answers on every load. A merchant who removes every
 * limit sees this step open again while the guide is visible, which is the
 * truth; a stored boolean would have lied.
 */
function step2(hasLimit: boolean): SetupStep {
  return {
    id: 2,
    title: SETUP_COPY.step2Title,
    body: SETUP_COPY.step2Body,
    complete: hasLimit,
    state: hasLimit ? "complete" : "todo",
    icon: hasLimit
      ? { type: "check-circle-filled", tone: "success" }
      : { type: "circle-dashed", tone: "neutral" },
    button: hasLimit
      ? null
      : {
          label: SETUP_COPY.step2Button,
          href: "/app/companies",
          variant: "secondary",
        },
  };
}

/**
 * Step 3 CONFIRMS a status; it does not offer a switch (D6-03).
 *
 * The app already registers its Validation on every load, so a button that
 * "turns enforcement on" would either duplicate that or lie about it. What the
 * merchant needs instead is the truth about the rule as SHOPIFY currently
 * reports it — live, not from our own `validationGid`, which a merchant who
 * deleted the rule in the admin has already made stale.
 *
 * I-06 (accepted): on a store where the merchant switched the rule off, this
 * step cannot complete from inside the app, so the guide persists with "Open
 * settings". That persistence IS the nudge — it is not a defect.
 */
function step3(
  input: Pick<SetupInput, "validationGid" | "validation">,
  step2Complete: boolean,
): SetupStep {
  // A null gid means the ensure-step has never succeeded, and a null status
  // means nobody asked. Both are the unregistered story.
  const status: ValidationStatus =
    input.validationGid === null ? "unregistered" : input.validation ?? "unregistered";

  const complete = status === "active" && step2Complete;
  const needsAction = status !== "active";

  const body =
    status === "active"
      ? SETUP_COPY.step3BodyActive
      : status === "disabled"
        ? SETUP_COPY.step3BodyDisabled
        : SETUP_COPY.step3BodyUnregistered;

  return {
    id: 3,
    title: complete ? SETUP_COPY.step3TitleOn : SETUP_COPY.step3TitleOff,
    body,
    complete,
    state: complete ? "complete" : needsAction ? "attention" : "todo",
    icon: complete
      ? { type: "check-circle-filled", tone: "success" }
      : needsAction
        ? { type: "alert-circle", tone: "warning" }
        : { type: "circle-dashed", tone: "neutral" },
    // The one button that survives completion: checking the copy a blocked
    // buyer sees stays useful forever (UI-SPEC button rule).
    button: {
      label:
        status === "active"
          ? SETUP_COPY.step3ButtonActive
          : SETUP_COPY.step3ButtonSettings,
      href: "/app/settings",
      variant: "secondary",
    },
  };
}

/**
 * Exactly one primary button, on the first incomplete step — and none at all
 * once every step is done, because the section's "Done" button is the primary
 * then (UI-SPEC Color § accent, C1).
 */
function assignPrimary(steps: SetupStep[]): SetupStep[] {
  const current = steps.find((step) => !step.complete);

  return steps.map((step) => {
    // Identity is captured BEFORE any copy is made — comparing a fresh object
    // to `current` would silently never match, and the page would lose its
    // only primary button.
    const isCurrent = step === current;
    const next: SetupStep =
      isCurrent && step.state === "todo" ? { ...step, state: "current" } : step;

    if (next.button === null) return next;
    return {
      ...next,
      button: {
        ...next.button,
        variant: isCurrent ? "primary" : "secondary",
      },
    };
  });
}

/** The full visible-guide state, composed from the three derived rows. */
export function deriveSetupState(input: SetupInput): SetupState {
  const steps = deriveSetupSteps(input);
  const completeCount = steps.filter((step) => step.complete).length;
  const allDone = completeCount === steps.length;

  return {
    visible: true,
    steps,
    completeCount,
    allDone,
    progressLabel: allDone
      ? SETUP_COPY.progressAllDone
      : SETUP_COPY.progress(completeCount),
  };
}

/**
 * The page's single primary call to action (UI-SPEC C1).
 *
 * Exported so a spec can assert the precedence — "Looks right" → "Set a limit"
 * → "Open settings" → "Done" → none — without rendering anything.
 */
export function primaryCta(state: SetupState): string | null {
  if (!state.visible) return null;
  if (state.allDone) return SETUP_COPY.doneButton;

  const primary = state.steps.find((step) => step.button?.variant === "primary");
  return primary?.button?.label ?? null;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * Everything the home loader needs to render (or skip) the guide.
 *
 * The dismissed short-circuit is FIRST and returns before any other read —
 * that is the outage-proofing contract, not a micro-optimisation.
 */
export interface OnboardingShopRow {
  onboardingReviewedAt: Date | null;
  onboardingDismissedAt: Date | null;
  reviewPromptedAt: Date | null;
  validationGid: string | null;
}

/** The one Shop read the home page's onboarding half needs. */
export async function readOnboardingShopRow(
  shop: string,
): Promise<OnboardingShopRow | null> {
  return db.shop.findUnique({
    where: { domain: shop },
    select: {
      onboardingReviewedAt: true,
      onboardingDismissedAt: true,
      reviewPromptedAt: true,
      validationGid: true,
    },
  });
}

export async function loadSetupState(
  shop: string,
  options: { locale?: string } = {},
): Promise<SetupState> {
  return setupStateFor(shop, await readOnboardingShopRow(shop), options.locale);
}

async function setupStateFor(
  shop: string,
  shopRow: OnboardingShopRow | null,
  locale?: string,
): Promise<SetupState> {
  if (shopRow?.onboardingDismissedAt) return DISMISSED_SETUP_STATE;

  const [backfill, limitCount, validation] = await Promise.all([
    readBackfillState(shop),
    db.company.count({ where: { shop, creditLimit: { not: null } } }),
    // `readValidationConfig` is non-throwing by contract — the `.catch` is the
    // belt to that braces, because step 3 must never be the reason a merchant
    // cannot see their own balances.
    readValidationConfig(shop).then(
      (config) => config.status,
      () => null,
    ),
  ]);

  return deriveSetupState({
    backfill,
    reviewedAt: shopRow?.onboardingReviewedAt ?? null,
    hasLimit: limitCount > 0,
    validationGid: shopRow?.validationGid ?? null,
    validation,
    locale,
  });
}

/**
 * Everything the home loader needs from this module, off ONE Shop read.
 *
 * The setup half and the review half both hinge on the same row, and issuing
 * that query twice on the app's most-loaded page for the sake of a tidier
 * signature is exactly the kind of small waste that never gets noticed again.
 */
export interface HomeOnboarding {
  setup: SetupState;
  reviewEligible: boolean;
}

export async function loadHomeOnboarding(
  shop: string,
  options: { locale?: string } = {},
): Promise<HomeOnboarding> {
  const shopRow = await readOnboardingShopRow(shop);

  const [setup, reviewEligible] = await Promise.all([
    setupStateFor(shop, shopRow, options.locale),
    reviewEligibility(shop, shopRow),
  ]);

  return { setup, reviewEligible };
}

/* ------------------------------------------------------------------ *
 * Writes — the only two facts the guide stores.
 * ------------------------------------------------------------------ */

export type SetupWriteResult =
  | { ok: true }
  | { ok: false; code: "backfill-running" | "not-complete" | "not-found" };

/**
 * Step 1's stamp. Idempotent by construction: the `null` guard in the WHERE
 * means a second press keeps the first timestamp rather than moving it.
 *
 * Refused while the import is still running — a merchant cannot vouch for
 * balances that are still arriving, and the button is disabled in the UI for
 * the same reason. The server checks anyway: a disabled button is a hint, not
 * a boundary (T-06-20).
 */
export async function markBalancesReviewed(
  shop: string,
  now: Date,
): Promise<SetupWriteResult> {
  const shopRow = await db.shop.findUnique({
    where: { domain: shop },
    select: { onboardingReviewedAt: true },
  });
  if (!shopRow) return { ok: false, code: "not-found" };

  const backfill = await readBackfillState(shop);
  if (backfill?.status === "running") {
    return { ok: false, code: "backfill-running" };
  }

  await db.shop.updateMany({
    where: { domain: shop, onboardingReviewedAt: null },
    data: { onboardingReviewedAt: now },
  });

  return { ok: true };
}

/**
 * Step 3's "Done" — the only way the guide ever goes away, and it goes away for
 * good (BFS 4.2.2 #6: onboarding must be removable once complete).
 *
 * The 3/3 check is RE-DERIVED here rather than trusted from the client: the
 * button only renders at 3/3, but a button is a hint and this is the boundary
 * (T-06-20). Idempotent — a second press keeps the first timestamp, and a
 * press on an already-dismissed guide is a no-op success rather than an error
 * the merchant cannot act on.
 */
export async function dismissOnboarding(
  shop: string,
  now: Date,
): Promise<SetupWriteResult> {
  const state = await loadSetupState(shop);
  if (!state.visible) return { ok: true };
  if (!state.allDone) return { ok: false, code: "not-complete" };

  await db.shop.updateMany({
    where: { domain: shop, onboardingDismissedAt: null },
    data: { onboardingDismissedAt: now },
  });

  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * The review moment (LNCH-02)
 * ------------------------------------------------------------------ */

/**
 * May we ask this merchant for a review right now?
 *
 * Two conditions, and both matter. We have never been evaluated
 * (`reviewPromptedAt` is null), AND something has actually WORKED for this
 * shop: a company went on credit hold, an order slipped past one, or a payment
 * reminder was really sent. A release, a bypass toggle, an unconfirmed send or
 * a failure are not success moments — asking off those would be asking a
 * merchant to rate an app that has not yet done its job.
 *
 * `shopRow` is passed in by the home loader, which has already read it.
 */
export async function reviewEligibility(
  shop: string,
  shopRow?: OnboardingShopRow | null,
): Promise<boolean> {
  const row =
    shopRow === undefined ? await readOnboardingShopRow(shop) : shopRow;
  if (!row || row.reviewPromptedAt !== null) return false;

  const [enforcement, reminder] = await Promise.all([
    db.enforcementEvent.findFirst({
      where: {
        shop,
        kind: { in: [EVENT_KIND.BLOCK_STATE_ENTERED, EVENT_KIND.BYPASSED_ORDER] },
      },
      select: { id: true },
    }),
    db.reminderLog.findFirst({
      where: { shop, status: REMINDER_STATUS.SENT },
      select: { id: true },
    }),
  ]);

  return enforcement !== null || reminder !== null;
}

export type ReviewResultOutcome =
  | { ok: true; stamped: boolean }
  | { ok: false; code: "invalid-code" };

/**
 * Record what Shopify said (B-01).
 *
 * Anything outside the known vocabulary is a forged post rather than a
 * mystery: the browser maps an unrecognised response to `"error"` before
 * submitting, so a code that reaches here unknown never came from App Bridge
 * (T-06-19). The stamp itself is idempotent — the `null` guard in the WHERE
 * keeps the first timestamp, so a double-submitted result cannot move it.
 */
export async function recordReviewPromptResult(
  shop: string,
  code: ReviewResultCode,
  now: Date,
): Promise<ReviewResultOutcome> {
  if (!isReviewResultCode(code)) return { ok: false, code: "invalid-code" };

  if (!stampsReviewPrompt(code)) return { ok: true, stamped: false };

  await db.shop.updateMany({
    where: { domain: shop, reviewPromptedAt: null },
    data: { reviewPromptedAt: now },
  });

  return { ok: true, stamped: true };
}
