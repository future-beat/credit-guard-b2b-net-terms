/**
 * The App Store review prompt's result vocabulary (LNCH-02).
 *
 * WHY THIS MODULE IMPORTS NOTHING. The browser validates the code Shopify
 * handed it BEFORE posting it back, so these literals ship inside the route
 * component and therefore into the client bundle. They cannot live in
 * `onboarding.server.ts`, which owns Prisma: a route that imported them from
 * there would drag the database client into the browser build. It imports
 * nothing itself for the same reason one step removed — a single import here
 * would be inherited by every route that composes from it, which is exactly the
 * 04-04 trap (a transitively server-only import that typechecks, passes every
 * unit test, and only fails at `react-router build`). A spec greps this file
 * for `import` to keep it that way. Same split as `app/block-messages.ts` and
 * `app/reminder-copy.ts`.
 *
 * THE VOCABULARY. Ten literals come from `@shopify/app-bridge-types@0.7.2`
 * (`"success"` plus the nine `ReviewRequestDeclinedCode` values). `"error"` is
 * ours: if `reviews.request()` throws, or App Bridge is not there at all, the
 * merchant must never see it, and the server still deserves to hear that we
 * tried.
 */

export const REVIEW_RESULT_CODES = [
  "success",
  "mobile-app",
  "already-reviewed",
  "annual-limit-reached",
  "cooldown-period",
  "merchant-ineligible",
  "recently-installed",
  "already-open",
  "open-in-progress",
  "cancelled",
  "error",
] as const;

export type ReviewResultCode = (typeof REVIEW_RESULT_CODES)[number];

/**
 * The three codes under which Shopify never evaluated the request at all — the
 * install is younger than 24 hours, or a modal is already up.
 *
 * B-01 (orchestrator-decided, UI-SPEC amendment 2026-08-22): these leave
 * `Shop.reviewPromptedAt` NULL so a later dashboard load may ask once more.
 * Every other outcome — including a decline and including a throw — stamps it
 * and closes the question for good. The earlier "record regardless" rule would
 * have stamped on `recently-installed`, and the guided setup drives a store's
 * first credit hold INSIDE that 24-hour window, so most merchants would never
 * have been asked at all. Nagging stays impossible either way: Shopify's own
 * limits are once per 60 days and three per year.
 */
export const REVIEW_NEVER_EVALUATED_CODES = [
  "recently-installed",
  "already-open",
  "open-in-progress",
] as const;

export function isReviewResultCode(value: unknown): value is ReviewResultCode {
  return (REVIEW_RESULT_CODES as readonly unknown[]).includes(value);
}

/** True when the outcome is one Shopify actually evaluated (B-01). */
export function stampsReviewPrompt(code: ReviewResultCode): boolean {
  return !(REVIEW_NEVER_EVALUATED_CODES as readonly string[]).includes(code);
}
