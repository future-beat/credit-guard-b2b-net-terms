import db from "../db.server";

/**
 * The shop-wide display currency (L-04, 06-UI-SPEC hard rule 9).
 *
 * Lifted verbatim out of `app/routes/app.companies.tsx` so the Companies table
 * and the dashboard read the same source: the most recently refetched ledger
 * order's currency. Every ledger amount is store currency already (D-07
 * `shopMoney`), so one shop-level answer is the correct one.
 *
 * Null (a shop with no ledger orders yet) means "format without a currency
 * code" — never guess a symbol.
 */
export async function resolveShopCurrency(
  shop: string,
): Promise<string | null> {
  const mostRecent = await db.ledgerOrder.findFirst({
    where: { shop },
    orderBy: { refetchedAt: "desc" },
    select: { currencyCode: true },
  });
  return mostRecent?.currencyCode ?? null;
}
