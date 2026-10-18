import { unauthenticated } from "../shopify.server";
import {
  classifyConstructionFailure,
  classifyRequestFailure,
  clearTokenFailures,
  recordTokenFailure,
} from "./token-health.server";

/**
 * The single seam through which background code reaches the Admin GraphQL API.
 *
 * Webhook handlers, sweeps and the install backfill all run OUTSIDE a merchant
 * request, so they cannot use `authenticate.admin`. `unauthenticated.admin(shop)`
 * builds a client from the stored offline session instead — verified against the
 * installed @shopify/shopify-app-react-router 1.1.0 types, which return
 * `{ session, admin }` where `admin.graphql(query, { variables })` resolves a
 * fetch Response (research assumption A9, RESOLVED).
 *
 * Everything else imports THIS module rather than `shopify.server` directly, for
 * two reasons:
 *
 * 1. It is the only place a background Admin client is constructed, so the day
 *    the library changes that helper there is exactly one line to update.
 * 2. It is the one module tests replace. `vi.mock` here gives a fake Admin API
 *    without mocking `authenticate.webhook` — real HMAC verification stays in
 *    the loop (Phase 1 convention).
 *
 * TRANSPORT CONTRACT (02-06, T-02-27): ledger code must NOT call
 * `getAdminContext(...).graphql` directly — every ledger-load-bearing query
 * goes through `graphqlJson()` in ledger.server.ts, which wraps this seam and
 * throws `LedgerGraphqlError` on any GraphQL `errors[]`. That wrapper lives in
 * ledger.server.ts (not here) so the established test seam survives unchanged:
 * suites replace THIS module with a factory exporting only `getAdminContext`,
 * and a wrapper defined here would be erased by that factory. Backfill and
 * reconciliation migrate onto `graphqlJson` in 02-07/02-08.
 *
 * TOKEN HEALTH (1.0.1, WINDOWS #30): the seam also hosts the strike counter in
 * token-health.server.ts, and it hosts it here precisely BECAUSE this is the
 * single place every client construction and every GraphQL call passes through
 * — so it is the only place that sees both the failure signal and the success
 * signal. It cannot live in `forEachActiveShop`'s catch: `publishCompanyCreditState`
 * (metafields.server.ts:325) swallows every error into Sentry and the reminder
 * refetch (reminders.server.ts:1319) swallows into a claim resolution, so a
 * dead token in the hourly overdue or reminder sweep never reaches that catch
 * at all.
 *
 * The seam's behaviour toward its callers is UNCHANGED: the bookkeeping runs in
 * its own try/catch and every error is rethrown exactly as thrown, so
 * `forEachActiveShop`'s per-shop swallow-but-log and the webhook routes'
 * `SessionNotFoundError` named-class catch both keep working on the real error.
 */

/**
 * The narrow slice of the Admin client the ledger actually uses.
 *
 * Deliberately structural rather than the library's `AdminApiContext`: test
 * doubles only have to provide `graphql`, and no test needs to synthesise a
 * whole session-bearing client.
 */
export interface LedgerAdminClient {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<{ json(): Promise<unknown> }>;
}

/**
 * Bookkeeping must never mask the call's real failure — the caller's own
 * handling (a named-class catch, a Sentry tag, a claim release) depends on
 * seeing the error Shopify actually threw.
 */
async function noteTokenFailure(
  shop: string,
  error: unknown,
  classify: (error: unknown) => Parameters<typeof recordTokenFailure>[1] | null,
): Promise<void> {
  const reason = classify(error);
  if (!reason) return;

  try {
    await recordTokenFailure(shop, reason);
  } catch (bookkeepingError) {
    console.error(
      `Token-health bookkeeping failed for ${shop} (WINDOWS #30):`,
      bookkeepingError,
    );
  }
}

/** Admin GraphQL client for a shop, built from its stored offline session. */
export async function getAdminContext(shop: string): Promise<LedgerAdminClient> {
  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shop));
  } catch (error) {
    await noteTokenFailure(shop, error, classifyConstructionFailure);
    throw error;
  }

  // The library's client is generic over codegen'd operations; narrowing it to
  // the structural interface above is the whole point of this seam.
  const client = admin as unknown as LedgerAdminClient;

  return {
    async graphql(query, options) {
      let response;
      try {
        response = await client.graphql(query, options);
      } catch (error) {
        await noteTokenFailure(shop, error, classifyRequestFailure);
        throw error;
      }

      // Any resolved call proves the token works — including a 200 carrying
      // GraphQL `errors[]`, which `graphqlJson` turns into a LedgerGraphqlError
      // one layer up. A no-op after the first success in this process.
      await clearTokenFailures(shop);

      return response;
    },
  };
}
