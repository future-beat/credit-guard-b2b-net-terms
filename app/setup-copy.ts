/**
 * The guided setup's copy and rendered shape (DASH-03) — the half of
 * `onboarding.server.ts` that the BROWSER needs.
 *
 * WHY THIS MODULE EXISTS, AND WHY IT IMPORTS NOTHING. The home route renders
 * these strings and walks these types in its component, which ships to the
 * client. Importing them from `services/onboarding.server.ts` — which owns
 * Prisma and the Admin client — typechecks, passes every unit test, and then
 * fails at `react-router build` with "Server-only module referenced by client".
 * That is the 04-04 trap, and it is why `app/block-messages.ts` and
 * `app/reminder-copy.ts` exist in the same shape. A spec greps this file for
 * `import` to keep it that way; the server module re-exports everything here so
 * server code still has a single import.
 *
 * Every string below is byte-exact contract from 06-UI-SPEC.md (§ Guided Setup
 * Contract, § Copywriting S1-S11). Keeping them here rather than in JSX is what
 * lets a spec pin them: a rule that survives only as a literal buried in a
 * component is a rule nobody checks.
 */

export const SETUP_COPY = {
  /** P3 — the section heading. */
  heading: "Set up Credit Guard",

  /** S1 — the progress line. */
  progress: (complete: number) => `${complete} of 3 complete`,
  progressAllDone: "All set",

  /** S2 / S3 / S4 — step 1. */
  step1Title: "Review your balances",
  step1BodyRunning: (orders: string, companies: string) =>
    `Importing your order history… ${orders} orders and ${companies} companies so far.`,
  step1BodyFinished: (companies: string, orders: string) =>
    `${companies} companies with ${orders} net-terms orders were imported. Check the balances look right before setting limits.`,
  step1BodyFailed:
    "Credit Guard couldn't finish importing your order history. Open the app again to retry; balances may be incomplete until then.",
  step1Button: "Looks right",
  step1Link: "Open companies",

  /** S5 — step 2. */
  step2Title: "Set your first credit limit",
  step2Body:
    "Companies stay observe-only until you set a limit. Start with the one company you most want to keep inside terms.",
  step2Button: "Set a limit",

  /** S6 / S7 / S8 — step 3. */
  step3TitleOn: "Enforcement is on",
  step3TitleOff: "Turn enforcement on",
  step3BodyActive:
    "Companies over their credit limit or with overdue invoices can't complete a new net-terms order. You can turn this off any time in Shopify Settings → Checkout → Checkout rules.",
  step3BodyDisabled:
    "Credit Guard's checkout rule is switched off in Shopify Settings → Checkout → Checkout rules. Turn it back on there to start enforcing limits.",
  step3BodyUnregistered:
    "Credit Guard hasn't been able to add its checkout rule yet. Reload the app to let it set itself up.",
  step3ButtonActive: "Check checkout messages",
  step3ButtonSettings: "Open settings",

  /** S9 / S10 / S11 — the dismiss button and the two action toasts. */
  doneButton: "Done",
  toastDismissed: "Setup complete",
  toastReviewed: "Balances marked as reviewed",
  toastFailed: "Couldn't save that. Try again.",
} as const;

/** The catalog icon names the guide uses — the complete list (UI-SPEC). */
export type SetupIconType =
  | "check-circle-filled"
  | "circle-dashed"
  | "alert-circle";

/** `s-icon` tones, which exclude `accent`/`custom` (polaris-types 1.0.1). */
export type SetupIconTone = "success" | "neutral" | "warning";

export type SetupStepState = "complete" | "current" | "todo" | "attention";

export interface SetupButton {
  label: string;
  /** Navigation buttons carry an href; action buttons carry an intent. */
  href?: string;
  intent?: string;
  disabled?: boolean;
  variant: "primary" | "secondary";
}

export interface SetupLink {
  label: string;
  href: string;
}

export interface SetupStep {
  id: 1 | 2 | 3;
  title: string;
  body: string;
  complete: boolean;
  state: SetupStepState;
  icon: { type: SetupIconType; tone: SetupIconTone };
  button: SetupButton | null;
  link?: SetupLink;
}

export interface SetupState {
  visible: boolean;
  steps: SetupStep[];
  completeCount: number;
  allDone: boolean;
  progressLabel: string;
}
