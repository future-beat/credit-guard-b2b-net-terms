/**
 * The reminder cadence, in the ONE sentence every surface has to agree on.
 *
 * WHY THIS MODULE EXISTS AT ALL. Two places describe the dunning schedule to a
 * merchant — the Settings card ("each of those invoices is chased at three
 * moments: …") and the dashboard's empty state ("Credit Guard emails a company
 * …") — and UI-SPEC R2 requires them to agree BYTE FOR BYTE. Two literals that
 * happen to match today are two literals that quietly disagree the first time
 * one is edited, and a merchant who reads two different cadences on two screens
 * of the same app trusts neither.
 *
 * WHY IT IS NOT A `.server` MODULE, AND WHY IT IMPORTS NOTHING. This string
 * ships to the browser inside route components, so it cannot live in
 * `services/reminders.server.ts` — that module owns Prisma, the Admin client and
 * the sweep, and importing it from a route would drag every one of them into the
 * client bundle. It also imports nothing itself, deliberately: an import here
 * would be inherited by every route that composes from it, which is exactly the
 * 04-04 build trap (a transitively server-only import that typechecks, passes
 * every unit test, and only fails at `react-router build`). A spec greps this
 * file for `import` to keep it that way. Same split, same reasoning as
 * `app/block-messages.ts`.
 *
 * THE FACT IT ENCODES. `DUE_SOON_LEAD_MS` and `OVERDUE_OFFSET_MS` are both 72h,
 * so the three moments are dueAt−72h, dueAt, dueAt+72h. Note "3 days after" and
 * not "when it's overdue": the OVERDUE touchpoint fires 72 hours PAST the due
 * date, not at the instant the invoice becomes overdue. If either offset ever
 * changes, this sentence changes with it — it is a claim about behaviour, not a
 * label.
 */
export const REMINDERS_CADENCE =
  "3 days before the due date, on the due date, and 3 days after";
