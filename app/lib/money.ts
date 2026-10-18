/**
 * The app's ONE money formatter (06-UI-SPEC § Money & Date Formatting Rules,
 * hard rule 9).
 *
 * Lifted verbatim out of `app/routes/app.companies.tsx` when the Phase 6
 * dashboard needed the same formatting: two pages formatting money with two
 * definitions of "formatted money" is how a total and a row silently disagree.
 * Pure and client-safe — no Prisma, no `db`, no server-only import — so a route
 * component may build it from loader data.
 */

/**
 * ONE formatter for every amount a page renders, built from the shop's ledger
 * currency. With no currency known yet the amount is still formatted to two
 * places with grouping — just without a symbol we'd be guessing.
 *
 * `Number()` here is DISPLAY ONLY. Every stored and submitted amount stays a
 * decimal string end to end; nothing this function touches is ever written
 * back.
 */
export function createMoneyFormatter(
  currencyCode: string | null,
): (value: string) => string {
  const format = new Intl.NumberFormat(undefined, {
    ...(currencyCode
      ? { style: "currency" as const, currency: currencyCode }
      : { style: "decimal" as const }),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (value: string) => format.format(Number(value));
}
