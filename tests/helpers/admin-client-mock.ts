import type { LedgerAdminClient } from "../../app/services/admin-client.server";

/**
 * Injectable fake Admin GraphQL client (Phase 2 shared test infrastructure).
 *
 * Every ledger code path reaches Shopify through
 * `admin-client.server.ts -> getAdminContext(shop)`. Tests `vi.mock` THAT module
 * and hand it one of these, which means `authenticate.webhook` stays real and
 * genuine HMAC verification is still exercised (Phase 1 convention).
 *
 * Fixtures are registered per GraphQL OPERATION NAME, parsed out of the query
 * text, so a test never has to care which module built the document or in what
 * order operations run.
 *
 * ```ts
 * const admin = createMockAdmin({
 *   OrderForLedger: makeOrderForLedgerResponse({ outstanding: "500.00" }),
 * });
 * expect(admin.callCount("OrderForLedger")).toBe(1);
 * ```
 *
 * A fixture may be:
 *  - a response body object — returned as-is (`{ data: ... }` shape);
 *  - a function of the call's variables — for responses that depend on the id;
 *  - an array — consumed one entry per call, the last entry repeating, which is
 *    how sequence/chaos tests express "first call says X, then Y".
 *
 * An unregistered operation throws rather than returning undefined: a silent
 * `{}` would surface far away as a confusing null-order deletion.
 */

export type AdminFixture =
  | unknown
  | ((variables: Record<string, unknown>) => unknown);

export interface AdminCall {
  operationName: string;
  query: string;
  variables: Record<string, unknown>;
}

export interface MockAdminClient extends LedgerAdminClient {
  /** Every call made, in order. */
  readonly calls: AdminCall[];
  /** Calls for one operation, or all calls when omitted. */
  callsFor(operationName?: string): AdminCall[];
  callCount(operationName?: string): number;
  /** Register or replace a fixture mid-test. */
  setFixture(operationName: string, fixture: AdminFixture): void;
  reset(): void;
}

/** `query OrderForLedger($id: ID!) { ... }` -> `OrderForLedger`. */
export function operationNameOf(query: string): string {
  const match = /\b(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(
    query,
  );
  return match ? match[1] : "anonymous";
}

/**
 * Default benign metafieldsSet success (03-01). The publish hook lives inside
 * `recomputeCompany`, so EVERY suite that drives a recompute now emits a
 * `PublishCompanyCredit` call — this default keeps those suites green without
 * registering a fixture, while throw-on-unregistered stays intact for every
 * other operation. An explicit fixture passed by a test always wins.
 * A factory (not a shared object) so no test can mutate another's response.
 */
function defaultPublishCompanyCreditResponse(): unknown {
  return {
    data: {
      metafieldsSet: {
        metafields: [
          {
            id: "gid://shopify/Metafield/1",
            key: "credit_v1",
            namespace: "app--000000",
            updatedAt: new Date().toISOString(),
          },
        ],
        userErrors: [],
      },
    },
  };
}

export function createMockAdmin(
  fixturesByOperationName: Record<string, AdminFixture> = {},
): MockAdminClient {
  const fixtures = new Map<string, AdminFixture>([
    ["PublishCompanyCredit", () => defaultPublishCompanyCreditResponse()],
    ...Object.entries(fixturesByOperationName),
  ]);
  const calls: AdminCall[] = [];

  function resolve(operationName: string, variables: Record<string, unknown>) {
    if (!fixtures.has(operationName)) {
      throw new Error(
        `admin-client-mock: no fixture registered for operation "${operationName}". ` +
          `Registered: ${[...fixtures.keys()].join(", ") || "(none)"}`,
      );
    }

    let fixture = fixtures.get(operationName);

    if (Array.isArray(fixture)) {
      const queue = fixture as unknown[];
      const priorCalls = calls.filter(
        (call) => call.operationName === operationName,
      ).length;
      // Last entry repeats, so a two-entry queue answers call 3 like call 2.
      fixture = queue[Math.min(priorCalls, queue.length - 1)];
    }

    return typeof fixture === "function"
      ? (fixture as (vars: Record<string, unknown>) => unknown)(variables)
      : fixture;
  }

  const client: MockAdminClient = {
    async graphql(query, options) {
      const variables = options?.variables ?? {};
      const operationName = operationNameOf(query);
      const body = resolve(operationName, variables);

      // Recorded AFTER resolution so an unregistered operation throws instead of
      // inflating the call log.
      calls.push({ operationName, query, variables });

      return { json: async () => body };
    },
    calls,
    callsFor(operationName?: string) {
      return operationName
        ? calls.filter((call) => call.operationName === operationName)
        : [...calls];
    },
    callCount(operationName?: string) {
      return client.callsFor(operationName).length;
    },
    setFixture(operationName: string, fixture: AdminFixture) {
      fixtures.set(operationName, fixture);
    },
    reset() {
      calls.length = 0;
    },
  };

  return client;
}
